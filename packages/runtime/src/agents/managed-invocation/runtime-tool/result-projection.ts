// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// Projecting snapshot/record into tool output + metadata + PresentationIntent,
// incl. timeout/authority/progress-event projection.
import {
  defineManagedAgentInvocationRequest,
  projectStructuredExecutionResult,
} from "@kilnai/core";
import type {
  ManagedAgentAdmissionDecision,
  ManagedAgentAuthorityProfile,
  ManagedAgentInvocationContextMode,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentAdmissionProfile,
  ManagedAgentRouteSource,
  WorkItemPauseRequirement,
} from "@kilnai/core";
import type { PresentationIntent } from "@kilnai/gateway-contracts";
import {
  MANAGED_AGENT_JOIN_TOOL_NAME,
} from "../tool-names.js";
import {
  buildManagedInvocationPhaseCompletion,
  buildManagedInvocationPhaseHandoffRecovery,
  buildManagedInvocationPhaseRecovery,
  managedInvocationFailureReasonFromStatus,
} from "../phase-recovery.js";
import {
  projectManagedInvocationAuthorityResources,
  projectManagedInvocationPublicResourceUri,
} from "../resource-projection.js";
import type {
  ManagedAgentRuntimeInvocationSnapshot,
} from "../index.js";
import type { ManagedInvocationPauseRequirementResolver, ManagedInvocationToolResult } from "./types.js";
import { hasSubstantiveManagedInvocationEvidence } from "./evidence-validation.js";
import { errorResult, readText } from "./input-parsing.js";

export function visibleManagedInvocationSnapshot(
  snapshot: ManagedAgentRuntimeInvocationSnapshot | undefined,
  sessionId: string,
  toolName: string,
): { readonly ok: true; readonly snapshot: ManagedAgentRuntimeInvocationSnapshot } | { readonly ok: false; readonly result: ManagedInvocationToolResult } {
  if (!snapshot || snapshot.parentSessionId !== sessionId) {
    return {
      ok: false,
      result: errorResult("Managed invocation is not registered for this runtime session.", {
        status: "not_found",
      }, toolName),
    };
  }
  return { ok: true, snapshot };
}

export function managedInvocationSnapshotResult(
  toolName: string,
  snapshot: ManagedAgentRuntimeInvocationSnapshot,
): ManagedInvocationToolResult {
  const projected = projectManagedInvocationSnapshot(snapshot);
  return {
    output: JSON.stringify(projected, null, 2),
    isError: false,
    metadata: {
      toolName,
      kind: "managed-invocation",
      status: projected.lifecycleState,
      lifecycleState: projected.lifecycleState,
      ...projected,
    },
  };
}

export function projectManagedInvocationSnapshot(snapshot: ManagedAgentRuntimeInvocationSnapshot): Record<string, unknown> {
  const capabilitySnapshot = snapshot.decision.capabilitySnapshot;
  const authoritySnapshot = projectManagedInvocationAuthoritySnapshot(snapshot.request.authority);
  return {
    invocationId: snapshot.invocationId,
    agentId: snapshot.agentId,
    parentSessionId: snapshot.parentSessionId,
    parentTurnId: snapshot.parentTurnId,
    routeId: capabilitySnapshot.routeId,
    routeSource: capabilitySnapshot.routeSource,
    ...projectManagedInvocationTimeoutEvidence(capabilitySnapshot.authorityProfile),
    ...projectManagedInvocationChildLineage(snapshot.record),
    profile: snapshot.profile,
    providerRoute: snapshot.providerRoute,
    adapterKind: snapshot.adapterKind,
    executionMode: snapshot.executionMode,
    authorityProfileId: snapshot.authorityProfileId,
    authoritySnapshot,
    lifecycleState: snapshot.lifecycleState,
    startedAt: snapshot.startedAt,
    ...(snapshot.finishedAt ? { finishedAt: snapshot.finishedAt } : {}),
    ...(snapshot.durationMs !== undefined ? { durationMs: snapshot.durationMs } : {}),
    ...(snapshot.progressEvents && snapshot.progressEvents.length > 0
      ? {
          progressEventCount: snapshot.progressEvents.length,
          recentProgressEvents: projectManagedInvocationRecentProgressEvents(snapshot.progressEvents),
        }
      : {}),
    terminalEvidenceAvailable: snapshot.record !== undefined || snapshot.error !== undefined,
  };
}

export function managedInvocationSnapshotErrorMetadata(
  snapshot: ManagedAgentRuntimeInvocationSnapshot,
): Record<string, unknown> {
  const capabilitySnapshot = snapshot.decision.capabilitySnapshot;
  return {
    invocationId: snapshot.invocationId,
    agentId: snapshot.agentId,
    parentSessionId: snapshot.parentSessionId,
    parentTurnId: snapshot.parentTurnId,
    routeId: capabilitySnapshot.routeId,
    routeSource: capabilitySnapshot.routeSource,
    ...projectManagedInvocationTimeoutEvidence(capabilitySnapshot.authorityProfile),
    ...projectManagedInvocationChildLineage(snapshot.record),
    profile: snapshot.profile,
    providerRoute: snapshot.providerRoute,
    adapterKind: snapshot.adapterKind,
    executionMode: snapshot.executionMode,
    authorityProfileId: snapshot.authorityProfileId,
  };
}

export function terminalManagedInvocationResult(input: {
  readonly toolName: string;
  readonly rawInput: Record<string, unknown>;
  readonly routeId: string;
  readonly voiceProfile?: string;
  readonly contextMode?: ManagedAgentInvocationContextMode;
  readonly request: ReturnType<typeof defineManagedAgentInvocationRequest>;
  readonly record: ManagedAgentInvocationRecord;
  readonly pauseRequirementResolver?: ManagedInvocationPauseRequirementResolver;
  readonly expectedTerminalLifecycleState?: ManagedAgentInvocationRecord["lifecycleState"];
  readonly progressEvents?: ManagedAgentRuntimeInvocationSnapshot["progressEvents"];
  readonly canonicalizedForbiddenInputFields?: readonly string[];
  readonly sessionEventIds: readonly string[];
}): ManagedInvocationToolResult {
  const summary = input.record.resultHandoff?.summary ?? `Managed invocation ${input.record.lifecycleState}.`;
  const acceptedTerminalLifecycleState = input.toolName === MANAGED_AGENT_JOIN_TOOL_NAME
    || input.record.lifecycleState === "completed"
    || input.record.lifecycleState === input.expectedTerminalLifecycleState;
  const terminalError = !acceptedTerminalLifecycleState;
  const priorPauseRequirements = resolvePriorPauseRequirements(
    input.pauseRequirementResolver,
    input.rawInput,
    input.request,
  );
  const recovery = terminalError
      ? buildManagedInvocationPhaseRecovery(
          input.rawInput,
          managedInvocationFailureReasonFromStatus(input.record.lifecycleState),
          input.record.resultHandoff,
          {
            priorPauseRequirements,
            recoveryInvocationId: input.record.invocationId,
          },
        )
    : undefined;
  const shouldValidateSubstantiveHandoff = !terminalError && input.record.lifecycleState === "completed";
  const handoffRecovery = !shouldValidateSubstantiveHandoff
    ? undefined
    : buildManagedInvocationPhaseHandoffRecovery(input.rawInput, input.record.resultHandoff, {
        priorPauseRequirements,
        recoveryInvocationId: input.record.invocationId,
      });
  const phaseCompletion = !shouldValidateSubstantiveHandoff
    ? undefined
    : buildManagedInvocationPhaseCompletion(input.rawInput, input.record.resultHandoff, input.record.invocationId);
  const handoffError = handoffRecovery !== undefined;
  const projectedStatus = handoffError ? "handoff_not_substantive" : input.record.lifecycleState;
  const resourceLease = input.record.resourceLease ?? input.record.capabilitySnapshot.resourceLease;
  const routeSource = input.record.capabilitySnapshot.routeSource;
  const timeoutEvidence = projectManagedInvocationTimeoutEvidence(input.record.capabilitySnapshot.authorityProfile);
  const authoritySnapshot = projectManagedInvocationAuthoritySnapshot(input.record.authority);
  const childLineage = projectManagedInvocationChildLineage(input.record);
  const progressEventCount = input.progressEvents?.length ?? 0;
  const recentProgressEvents = projectManagedInvocationRecentProgressEvents(input.progressEvents);
  const resourceLinks = projectManagedInvocationResultResourceLinks(input.record);
  const structuredEvidence = input.record.resultHandoff !== undefined
    || input.record.transcript !== undefined
    || resourceLease !== undefined
    || (input.record.diagnostics !== undefined && input.record.diagnostics.length > 0)
    || recentProgressEvents.length > 0;
  const outputVerbosity = input.request.input.handoff?.outputVerbosity ?? "standard";
  const projectedResultHandoff = input.record.resultHandoff
    ? {
        ...input.record.resultHandoff,
        ...(input.record.resultHandoff.structuredResult
          ? { structuredResult: projectStructuredExecutionResult(input.record.resultHandoff.structuredResult, outputVerbosity) }
          : {}),
      }
    : undefined;
  return {
    output: recovery || handoffRecovery || phaseCompletion || structuredEvidence
      ? JSON.stringify({
          status: projectedStatus,
          summary,
          invocationId: input.record.invocationId,
          routeId: input.routeId,
          routeSource,
          parentSessionId: input.record.parentSessionId,
          parentTurnId: input.record.parentTurnId,
          ...childLineage,
          ...timeoutEvidence,
          authoritySnapshot,
          ...(projectedResultHandoff ? { resultHandoff: projectedResultHandoff } : {}),
          ...(input.record.transcript ? { transcript: input.record.transcript } : {}),
          ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
          ...(resourceLease ? { resourceLease } : {}),
          ...(input.record.diagnostics ? { diagnostics: input.record.diagnostics } : {}),
          ...(recentProgressEvents.length > 0 ? { progressEventCount, recentProgressEvents } : {}),
          ...(recovery ? { recovery } : {}),
          ...(handoffRecovery ? { recovery: handoffRecovery } : {}),
          ...(phaseCompletion ? { phaseCompletion } : {}),
        }, null, 2)
      : summary,
    isError: terminalError || handoffError,
    metadata: {
      toolName: input.toolName,
      kind: "managed-invocation",
      invocationId: input.record.invocationId,
      routeId: input.routeId,
      routeSource,
      parentSessionId: input.record.parentSessionId,
      parentTurnId: input.record.parentTurnId,
      ...childLineage,
      ...timeoutEvidence,
      status: projectedStatus,
      lifecycleState: input.record.lifecycleState,
      profile: input.record.profile,
      providerRoute: input.record.providerRoute,
      ...(input.voiceProfile ? { voiceProfile: input.voiceProfile } : {}),
      adapterKind: input.record.adapterKind,
      executionMode: input.record.executionMode,
      requestedAuthority: input.request.requestedAuthority,
      authorityProfileId: input.record.authority.authorityProfileId,
      authoritySnapshot,
      capabilitySnapshot: input.record.capabilitySnapshot,
      context: input.request.input.context,
      ...(input.canonicalizedForbiddenInputFields
        ? { canonicalizedForbiddenInputFields: input.canonicalizedForbiddenInputFields }
        : {}),
      ...(input.request.input.handoff ? { handoffContract: input.request.input.handoff } : {}),
      resultHandoff: projectedResultHandoff,
      transcript: input.record.transcript,
      ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
      ...(recentProgressEvents.length > 0 ? { progressEventCount, recentProgressEvents } : {}),
      ...(resourceLease ? { resourceLease } : {}),
      ...(input.record.diagnostics ? { diagnostics: input.record.diagnostics } : {}),
      ...(recovery ? { managedInvocationRecovery: recovery } : {}),
      ...(handoffRecovery ? { managedInvocationRecovery: handoffRecovery } : {}),
      ...(phaseCompletion ? { managedInvocationPhaseCompletion: phaseCompletion } : {}),
      sessionEventIds: input.sessionEventIds,
      presentationIntent: buildManagedInvocationPresentationIntent({
        sourceToolName: input.toolName,
        routeId: input.routeId,
        routeSource,
        profile: input.record.profile,
        providerId: input.record.providerRoute.providerId,
        model: input.record.providerRoute.model,
        contextMode: input.contextMode,
        status: projectedStatus,
        substantiveEvidence: hasSubstantiveManagedInvocationEvidence(input.record) && !handoffError,
        failureReason: terminalError || handoffError ? summary : undefined,
      }),
    },
  };
}

function resolvePriorPauseRequirements(
  resolver: ManagedInvocationPauseRequirementResolver | undefined,
  rawInput: Record<string, unknown>,
  request: ManagedAgentInvocationRequest,
): readonly WorkItemPauseRequirement[] | undefined {
  const scopeWorkItemId = request.executionScope?.kind === "work_item"
    ? request.executionScope.workItemId
    : undefined;
  const workItemId = readText(rawInput.workItemId) ?? scopeWorkItemId;
  return workItemId ? resolver?.(workItemId) : undefined;
}

function projectManagedInvocationResultResourceLinks(
  record: ManagedAgentInvocationRecord,
): readonly {
  readonly uri: string;
  readonly title?: string;
  readonly relation?: string;
}[] {
  const links = new Map<string, { readonly uri: string; readonly title?: string; readonly relation?: string }>();
  const addLink = (uri: string | undefined, title: string, relation: string) => {
    if (!uri || uri.trim().length === 0 || links.has(uri)) {
      return;
    }
    links.set(uri, { uri, title, relation });
  };
  addLink(record.transcript?.uri, "Managed invocation transcript", "events");
  for (const [index, uri] of (record.resultHandoff?.resourceUris ?? []).entries()) {
    addLink(uri, `Managed invocation result ${index + 1}`, "summary");
  }
  for (const [index, uri] of (record.resultHandoff?.memoryWriteProposalUris ?? []).entries()) {
    addLink(uri, `Managed invocation memory proposal ${index + 1}`, "source");
  }
  return [...links.values()];
}

export function projectManagedInvocationTimeoutEvidence(authority: ManagedAgentAuthorityProfile): Record<string, unknown> {
  return {
    timeoutMs: authority.timeoutMs,
    ...(authority.timeoutSource ? { timeoutSource: authority.timeoutSource } : {}),
  };
}

export function projectManagedInvocationAuthoritySnapshot(authority: ManagedAgentAuthorityProfile): ManagedAgentAuthorityProfile {
  return projectManagedInvocationAuthorityResources(authority, projectManagedInvocationPublicResourceUri);
}

export function projectManagedInvocationChildLineage(record: ManagedAgentInvocationRecord | undefined): Record<string, unknown> {
  return {
    ...(record?.childSessionId ? { childSessionId: record.childSessionId } : {}),
    ...(record?.childTurnId ? { childTurnId: record.childTurnId } : {}),
  };
}

export function buildManagedInvocationPresentationIntent(input: {
  readonly sourceToolName: string;
  readonly routeId: string;
  readonly routeSource: ManagedAgentRouteSource;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly providerId: string;
  readonly model?: string;
  readonly contextMode?: ManagedAgentInvocationContextMode;
  readonly status: string;
  readonly substantiveEvidence: boolean;
  readonly failureReason?: string;
}): PresentationIntent {
  return {
    kind: "comparison_table",
    title: "Managed child invocation",
    summary: `${input.routeId} ${input.status}`,
    source: input.sourceToolName,
    confidence: input.substantiveEvidence ? "high" : "medium",
    columns: [
      { key: "routeId", label: "Route", valueKind: "text" },
      { key: "routeSource", label: "Source", valueKind: "text" },
      { key: "provider", label: "Provider", valueKind: "text" },
      { key: "model", label: "Model", valueKind: "text" },
      { key: "profile", label: "Profile", valueKind: "text" },
      { key: "contextMode", label: "Context", valueKind: "text" },
      { key: "status", label: "Status", valueKind: "status" },
      { key: "substantiveEvidence", label: "Evidence", valueKind: "boolean" },
      { key: "failureReason", label: "Failure", valueKind: "text" },
    ],
    rows: [{
      routeId: input.routeId,
      routeSource: input.routeSource,
      provider: input.providerId,
      model: input.model ?? "",
      profile: input.profile,
      contextMode: input.contextMode ?? "",
      status: input.status,
      substantiveEvidence: input.substantiveEvidence,
      failureReason: boundedPresentationText(input.failureReason ?? ""),
    }],
  };
}

const MANAGED_INVOCATION_RECENT_PROGRESS_LIMIT = 8;

function projectManagedInvocationRecentProgressEvents(
  progressEvents: ManagedAgentRuntimeInvocationSnapshot["progressEvents"] | undefined,
): readonly Record<string, unknown>[] {
  return (progressEvents ?? []).slice(-MANAGED_INVOCATION_RECENT_PROGRESS_LIMIT).map((event) => ({
    eventId: event.eventId,
    kind: event.kind,
    recordedAt: event.recordedAt,
    summary: boundedProgressText(event.summary),
    ...(event.toolName ? { toolName: event.toolName } : {}),
    ...(event.success !== undefined ? { success: event.success } : {}),
    ...(event.isError !== undefined ? { isError: event.isError } : {}),
    ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
  }));
}

function boundedProgressText(value: string): string {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}

function boundedPresentationText(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

export function formatManagedInvocationAdmissionDenied(
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "denied" }>,
): string {
  const suffix = decision.missingCapabilities.length > 0
    ? ` missingCapabilities=${decision.missingCapabilities.join(",")}`
    : "";
  return `${decision.reason}${suffix}`;
}
