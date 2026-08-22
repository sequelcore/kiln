// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// prepareManagedInvocationRequest is a thin orchestrator over five steps:
//   1. admitManagedInvocationScope           - canonicalize/parse input, resolve requested authority, governed-scope admission
//   2. resolveManagedInvocationEconomicCommitment (economic-policy agent profiles only) -
//      collects economic candidates, commits a route through options.economicDispatch,
//      then recurses into this same pipeline ("already-admitted") with the committed route.
//   3. resolveManagedInvocationRouteAndCapability - agent profile / route hint validation,
//      route resolution, caller capability, evidence-realization + capacity checks
//   4. resolveManagedInvocationContextPhase       - context resolver + prompt assembly
//   5. buildManagedInvocationRequestRecord        - invocation id, authority approval, request record assembly
// Steps 3-5 are the fixed-route path; the economic-policy path (step 2) replaces
// them for one recursive call and then reuses their output.
import {
  defineManagedAgentInvocationRequest,
  admitManagedRoute,
  digestManagedEconomicValue,
  isKilnWorkGovernanceEvidence,
  resolveCommunicationIntent,
  resolveEvidenceRealization,
} from "@kilnai/core";
import type {
  CommunicationRequiredContent,
  DeliberationResolution,
  ManagedAgentCallerAttachmentIdentity,
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentProviderRoute,
  ManagedAgentRequestedAuthority,
} from "@kilnai/core";
import type { RuntimeBuiltinToolExecutionContext } from "../../../session/runtime-session-orchestrator.types.js";
import { resolveManagedInvocationAgentProfile } from "../agent-profile-catalog.js";
import {
  deriveManagedInvocationCallerAuthority,
  resolveManagedInvocationCallerIdentity,
} from "../caller-capability-policy.js";
import { appendManagedEconomicLifecycleSessionEvent } from "../session-events.js";
import { MANAGED_AGENT_START_TOOL_NAME } from "../tool-names.js";
import type { ManagedAgentRuntimeInvocationLifecycleOptions } from "../index.js";
import type {
  ManagedCommittedRouteMismatchEvidence,
  ManagedInvocationAgentCatalogEntry,
  ManagedInvocationContextResolution,
  ManagedInvocationExecutableRoute,
  ManagedInvocationRouteProfile,
  ManagedInvocationToolAttachment,
  ManagedInvocationToolInput,
  ManagedInvocationToolResult,
  ManagedInvocationToolRoute,
} from "./types.js";
import { resolveManagedInvocationRouteProfile } from "./profile-resolution.js";

function applyManagedAgentCommunication(
  parsed: ManagedInvocationToolInput,
  agentProfile: ManagedInvocationAgentCatalogEntry | undefined,
): ManagedInvocationToolInput {
  const invocation = parsed.providerRoute.communicationIntent;
  const agent = agentProfile?.communication;
  if (invocation && hasPreservedCommunicationAuthority(invocation)) return parsed;
  if (!invocation && !agent) return parsed;
  const requiredByAuthority = new Set<CommunicationRequiredContent>(
    (parsed.expectedEvidence ?? []).filter(isCommunicationRequiredContent),
  );
  if (parsed.requestedAuthority === "destructive") requiredByAuthority.add("approval-requirement");
  if (parsed.residualRiskRequired) requiredByAuthority.add("residual-risk");
  const communicationIntent = resolveCommunicationIntent([
    ...(invocation ? [{ source: "invocation" as const, intent: invocation.intent }] : []),
    ...(agent ? [{ source: "agent-profile" as const, intent: agent }] : []),
    ...(requiredByAuthority.size > 0
      ? [{ source: "safety-authority" as const, intent: { requiredContent: [...requiredByAuthority].sort() } }]
      : []),
  ]);
  return {
    ...parsed,
    providerRoute: { ...parsed.providerRoute, communicationIntent },
  };
}

function hasPreservedCommunicationAuthority(intent: import("@kilnai/core").ResolvedCommunicationIntent): boolean {
  const serialized = JSON.stringify(intent.authority);
  return ["agent-profile", "project", "global", "user", "safety-authority"].some((source) => serialized.includes(source));
}

function isCommunicationRequiredContent(value: string): value is CommunicationRequiredContent {
  return [
    "approval-requirement", "citation", "decision", "failure", "finding",
    "next-action", "residual-risk", "verification", "warning",
  ].includes(value);
}
import { unique } from "./catalog-descriptions.js";
import {
  buildRouteProfileConflictRecovery,
  resolveRoute,
  validateAgentRouteHint,
} from "./route-resolution.js";
import { resolveUnavailableRoute } from "./catalog-descriptions.js";
import {
  effectiveManagedInvocationReadRoots,
  missingManagedInvocationRequiredCapabilities,
  missingManagedInvocationRequiredReadPaths,
  missingManagedInvocationRequiredTools,
  requiresNetworkCapability,
} from "./evidence-validation.js";
import { buildManagedInvocationPresentationIntent } from "./result-projection.js";
import { managedInvocationRouteHealthReason, managedAgentDisplayName } from "./catalog-descriptions.js";
import {
  buildHandoffContract,
  buildInvocationId,
  buildManagedInvocationContextMetadata,
  errorResult,
  parseInput as parseManagedInvocationInput,
  readRecord,
  readText,
  readTextArray,
  resolveInvocationContext,
  resolveManagedInvocationParentTurnId,
  resolveManagedInvocationParentTurnOrdinal,
  resolveManagedInvocationRequestedAuthority,
  requestManagedInvocationAuthorityApproval,
  validateManagedInvocationRequestedAuthority,
} from "./input-parsing.js";
import { normalizeManagedInvocationCredentialRoute, publishManagedInvocationSessionEvents } from "./session-event-publishing.js";
import { resolveManagedInvocationRouteAuthority } from "./working-directory-lease.js";
import {
  collectManagedEconomicCandidates,
  digestManagedEconomicCandidateProfileAuthority,
} from "./economic-candidate-collection.js";
import type { ManagedEconomicCandidateSet } from "./economic-candidate-collection.js";

export interface PreparedManagedInvocationRequest {
  readonly context: RuntimeBuiltinToolExecutionContext;
  readonly parsed: ManagedInvocationToolInput;
  readonly canonicalizedRawInput: Record<string, unknown>;
  readonly route: ManagedInvocationExecutableRoute;
  readonly request: ReturnType<typeof defineManagedAgentInvocationRequest>;
  readonly capabilitySnapshotInput: ManagedAgentCapabilitySnapshotInput;
  readonly canonicalizedForbiddenInputFields?: readonly string[];
  readonly lifecycleOptions?: ManagedAgentRuntimeInvocationLifecycleOptions;
  readonly boundedWorkLifecycle?: import("./types.js").ManagedInvocationBoundedWorkLifecycle;
}

type PrepareFailure = { readonly ok: false; readonly result: ManagedInvocationToolResult };
type PrepareOutcome = { readonly ok: true; readonly prepared: PreparedManagedInvocationRequest } | PrepareFailure;

/** Sanitized rejection raised before an adapter can be constructed for the wrong commitment. */
export class ManagedCommittedRouteMismatchError extends Error {
  readonly code = "committed-route-mismatch" as const;
  readonly evidence: ManagedCommittedRouteMismatchEvidence;

  constructor(evidence: ManagedCommittedRouteMismatchEvidence) {
    super("Committed managed route does not match the configured execution target.");
    this.name = "ManagedCommittedRouteMismatchError";
    this.evidence = {
      code: "committed-route-mismatch",
      expected: sanitizeCommittedRouteIdentity(evidence.expected),
      committed: sanitizeCommittedRouteIdentity(evidence.committed),
    };
  }
}

function sanitizeCommittedRouteIdentity(
  identity: ManagedCommittedRouteMismatchEvidence["expected"],
): ManagedCommittedRouteMismatchEvidence["expected"] {
  return {
    routeId: sanitizeCommittedRouteIdentityValue(identity.routeId),
    providerId: sanitizeCommittedRouteIdentityValue(identity.providerId),
    modelId: sanitizeCommittedRouteIdentityValue(identity.modelId),
  };
}

function sanitizeCommittedRouteIdentityValue(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._:/-]/gu, "-").replace(/-+/gu, "-").replace(/^-|-$/gu, "");
  return sanitized.length > 0 ? sanitized.slice(0, 128) : "unknown";
}

export function canonicalizeManagedInvocationRawInput(
  rawInput: Record<string, unknown>,
  routes: readonly ManagedInvocationToolRoute[],
): {
  readonly input: Record<string, unknown>;
  readonly canonicalizedForbiddenInputFields: readonly string[];
} {
  const forbiddenInputFields = readTextArray(rawInput.forbiddenInputFields) ?? [];
  const routeOwnsAgentSelection = forbiddenInputFields.includes("agentProfile");
  if (!routeOwnsAgentSelection) {
    return { input: rawInput, canonicalizedForbiddenInputFields: [] };
  }

  const canonicalizedForbiddenInputFields: string[] = [];
  const providerRoute = readRecord(rawInput.providerRoute);
  const routeId = readText(rawInput.routeId);
  const providerId = readText(providerRoute?.providerId);
  const route = routeId && providerId
    ? routes.find((candidate) => candidate.routeId === routeId && candidate.providerId === providerId)
    : undefined;
  const nextProviderRoute = providerRoute && route
    ? routeOwnedProviderRoute(providerRoute, route.model)
    : providerRoute;
  if (readText(rawInput.agentProfile)) {
    canonicalizedForbiddenInputFields.push("agentProfile");
  }
  const withoutAgentProfile = Object.fromEntries(
    Object.entries(rawInput).filter(([key]) => key !== "agentProfile"),
  );
  return {
    input: {
      ...withoutAgentProfile,
      ...(nextProviderRoute ? { providerRoute: nextProviderRoute } : {}),
    },
    canonicalizedForbiddenInputFields: unique(canonicalizedForbiddenInputFields),
  };
}

function routeOwnedProviderRoute(
  providerRoute: Record<string, unknown>,
  routeModel: string | undefined,
): Record<string, unknown> {
  const providerRouteWithoutModel = Object.fromEntries(
    Object.entries(providerRoute).filter(([key]) => key !== "model"),
  );
  return {
    ...providerRouteWithoutModel,
    ...(routeModel ? { model: routeModel } : {}),
  };
}

/** Phase 1: canonicalize/parse raw input, resolve requested authority, admit governed scope. */
function admitManagedInvocationScope(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext,
  attachment: ManagedInvocationToolAttachment,
  toolName: string,
  scopeAdmission: "required" | "already-admitted",
):
  | {
      readonly ok: true;
      readonly canonicalizedRawInput: ReturnType<typeof canonicalizeManagedInvocationRawInput>;
      readonly parsed: ManagedInvocationToolInput;
      readonly requestedAuthority: ManagedAgentRequestedAuthority;
    }
  | PrepareFailure {
  const { options } = attachment;
  const canonicalizedRawInput = canonicalizeManagedInvocationRawInput(rawInput, options.routes);
  const parsed = parseManagedInvocationInput(canonicalizedRawInput.input, toolName);
  if (!parsed.ok) {
    return { ok: false, result: errorResult(parsed.error, {}, toolName) };
  }
  const requestedAuthority = resolveManagedInvocationRequestedAuthority(
    parsed.input.requestedAuthority,
    context.effectiveTurnAuthority?.requestedAuthority,
  );

  if (scopeAdmission === "required" && parsed.input.goalRunId) {
    const admission = attachment.governedScopeAdmission?.({
      parentSessionId: context.session.id,
      goalRunId: parsed.input.goalRunId,
      profile: parsed.input.profile,
      requestedAuthority,
      ...(parsed.input.workItemId ? { workItemId: parsed.input.workItemId } : {}),
      ...(parsed.input.attemptId ? { attemptId: parsed.input.attemptId } : {}),
    });
    if (!admission) {
      return {
        ok: false,
        result: errorResult(
          "Managed invocation governed scope cannot be verified on this runtime surface.",
          {
            errorCode: "governed_scope_admission_unavailable",
            status: "denied",
          },
          toolName,
        ),
      };
    }
    if (!admission.admitted) {
      return {
        ok: false,
        result: errorResult(admission.message, {
          errorCode: admission.code,
          status: "denied",
          ...(admission.suggestedNextTool ? { suggestedNextTool: admission.suggestedNextTool } : {}),
        }, toolName),
      };
    }
  }

  return { ok: true, canonicalizedRawInput, parsed: parsed.input, requestedAuthority };
}

/**
 * Economic-policy branch: resolves a durable route commitment for a
 * configured agent profile's economic policy (candidate collection ->
 * options.economicDispatch.prepare), then recurses into
 * prepareManagedInvocationRequest ("already-admitted") with the committed
 * route substituted in, so the recursive call runs the normal fixed-route
 * steps 3-5 against a concrete adapter.
 */
async function resolveManagedInvocationEconomicCommitment(input: {
  readonly rawInput: Record<string, unknown>;
  readonly context: RuntimeBuiltinToolExecutionContext;
  readonly attachment: ManagedInvocationToolAttachment;
  readonly toolName: string;
  readonly parsed: ManagedInvocationToolInput;
  readonly requestedAuthority: ManagedAgentRequestedAuthority;
  readonly canonicalizedRawInput: ReturnType<typeof canonicalizeManagedInvocationRawInput>;
  readonly agentProfile: ManagedInvocationAgentCatalogEntry;
  readonly economicPolicyId: string;
  readonly economicPolicyRevision: string;
  readonly invocationId: string;
}): Promise<PrepareOutcome> {
  const {
    rawInput, context, attachment, toolName, parsed, requestedAuthority,
    canonicalizedRawInput, agentProfile, economicPolicyId, economicPolicyRevision, invocationId,
  } = input;
  const { options, callerIdentity } = attachment;

  const economicProviderRoute: ManagedAgentProviderRoute = {
    ...parsed.providerRoute,
    ...(agentProfile.providerRoute?.providerId && !parsed.providerRoute.providerId
      ? { providerId: agentProfile.providerRoute.providerId }
      : {}),
    ...(agentProfile.providerRoute?.model && !parsed.providerRoute.model
      ? { model: agentProfile.providerRoute.model }
      : {}),
    ...(agentProfile.providerRoute?.deliberationIntent && !parsed.providerRoute.deliberationIntent
      ? { deliberationIntent: agentProfile.providerRoute.deliberationIntent }
      : {}),
  };
  const authorityAdmission = validateManagedInvocationRequestedAuthority(
    requestedAuthority,
    parsed.profile,
    toolName,
  );
  if (!authorityAdmission.ok) {
    return {
      ok: false,
      result: errorResult(authorityAdmission.error, {
        profile: parsed.profile,
        requestedAuthority,
        economicPolicyId,
      }, toolName),
    };
  }
  const contextResolution = await resolveInvocationContext(parsed, options, undefined);
  if (!contextResolution.ok) {
    return {
      ok: false,
      result: errorResult(contextResolution.error, {
        profile: parsed.profile,
        economicPolicyId,
        status: contextResolution.status,
        context: buildManagedInvocationContextMetadata(parsed, contextResolution.resolution),
      }, toolName),
    };
  }
  const authorityApproval = await requestManagedInvocationAuthorityApproval({
    requestedAuthority,
    target: {
      kind: "economic-policy",
      economicPolicyId,
    },
    profile: parsed.profile,
    context,
    toolName,
  });
  if (!authorityApproval.ok) {
    return {
      ok: false,
      result: errorResult(authorityApproval.error, {
        profile: parsed.profile,
        requestedAuthority,
        economicPolicyId,
      }, toolName),
    };
  }

  const candidateSet: ManagedEconomicCandidateSet = collectManagedEconomicCandidates({
    economicPolicyId,
    economicPolicyRevision,
    configuredAgentProfileId: agentProfile.name,
    authorityProfileId: agentProfile.authorityProfileId,
    invocationId,
    admissionProfileId: parsed.profile,
    ...(parsed.routeId ? { routeId: parsed.routeId } : {}),
    ...(economicProviderRoute.providerId
      ? { providerRoute: economicProviderRoute }
      : {}),
    callerIdentity,
    ...(parsed.requiredToolNames
      ? { requiredToolNames: parsed.requiredToolNames }
      : {}),
    ...(parsed.requiredReadPaths
      ? { requiredReadPaths: parsed.requiredReadPaths }
      : {}),
    requestedAuthority,
    requiresNetwork: (parsed.requiredToolNames ?? []).some(requiresNetworkCapability),
    requiresWrite: parsed.profile !== "foundation-readonly-plan",
  }, options.routes, options.unavailableRoutes);
  if (candidateSet.candidates.length === 0) {
    return {
      ok: false,
      result: errorResult(
        "Managed economic authority denied every admitted candidate before commitment.",
        { errorCode: "economic_commitment_unavailable", status: "denied", candidateSet },
        toolName,
      ),
    };
  }
  if (!options.economicDispatch) {
    return {
      ok: false,
      result: errorResult(
        "Managed economic invocation requires a durable route commitment before execution.",
        { errorCode: "economic_commitment_unavailable", status: "denied", candidateSet },
        toolName,
      ),
    };
  }
  const economicIdentity = digestManagedEconomicValue({
    parentSessionId: context.session.id,
    parentTurnId: context.turnId ?? context.toolCall.id,
    authorityProfileId: agentProfile.authorityProfileId,
    invocationId,
    toolCallId: context.toolCall.id,
    configuredAgentProfileId: agentProfile.name,
    profile: parsed.profile,
    task: parsed.task,
    summary: parsed.summary,
    deliberationIntent: economicProviderRoute.deliberationIntent ?? null,
    communicationIntentIdentity: economicProviderRoute.communicationIntent?.identity ?? null,
    candidateSet,
  }).slice("sha256:".length);
  const economicPreparation = await options.economicDispatch.prepare({
    candidateSet,
    jobId: `managed-economic-job:${economicIdentity}`,
    economicAttemptId: `economic-attempt:${economicIdentity}`,
    intentFingerprint: digestManagedEconomicValue({ candidateSet, economicIdentity }),
    adoptedDecisionAt: context.session.createdAt.toISOString(),
    parentSessionId: context.session.id,
    parentTurnId: context.turnId ?? context.toolCall.id,
    authorityProfileId: agentProfile.authorityProfileId,
    invocationId,
    ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
    ...(agentProfile.workLimits?.maxDurationMs !== undefined
      ? { workLimitDurationMs: agentProfile.workLimits.maxDurationMs }
      : {}),
    ...(agentProfile.economicSpendApproval === "required"
      ? {
          validateAndConsumeApprovalBeforeFence: async ({ commitment }: { readonly commitment: import("@kilnai/core").ManagedEconomicCommitment }) => {
            const comparablePaidAmounts = commitment.reservation.amounts.filter((amount) =>
              amount.scheme.kind !== "unit" && BigInt(amount.atoms) !== 0n);
            if (comparablePaidAmounts.length === 0) return;
            if (!context.requestApproval) {
              throw new Error("Managed economic invocation requires approval before fencing a comparable paid reservation.");
            }
            const approval = await context.requestApproval(
              `Managed agent '${agentProfile.name}' requests approval before reserving comparable paid usage on target '${commitment.reservation.selectedIdentity.route.routeId}'.`,
            );
            if (!approval.approved) {
              throw new Error(`Managed economic paid-usage approval denied: ${approval.reason ?? "approval denied"}`);
            }
          },
        }
      : {}),
    validateExecutionProfile: async ({ commitment }) => {
      const selected = commitment.reservation.selectedIdentity.route;
      const selectedCandidate = candidateSet.candidates.find((candidate) =>
        candidate.routeId === selected.routeId
        && candidate.providerId === selected.providerId
        && candidate.model === selected.modelId);
      const selectedRoute = options.routes.find((route) =>
        route.routeId === selected.routeId
        && route.providerId === selected.providerId
        && route.model === selected.modelId);
      const executionProfile = selectedRoute
        ? resolveManagedInvocationRouteProfile(selectedRoute, parsed.profile, agentProfile)
        : undefined;
      if (
        !selectedCandidate
        || !executionProfile
        || selectedCandidate.profileAuthorityDigest !== digestManagedEconomicCandidateProfileAuthority(executionProfile, invocationId)
      ) {
        throw new Error("identity-revision-conflict: managed profile authority changed after economic dispatch fence");
      }
    },
    ...(options.workspaceRoot ? {
      lifecycleEvents: {
        record: (recordInput) => {
          const events = appendManagedEconomicLifecycleSessionEvent({
            session: context.session,
            workspaceRoot: options.workspaceRoot!,
            ...(context.turnId !== undefined ? { turnId: context.turnId } : {}),
            jobId: `managed-economic-job:${economicIdentity}`,
            economicAttemptId: `economic-attempt:${economicIdentity}`,
            invocationId,
            ...recordInput,
          });
          void publishManagedInvocationSessionEvents(options, context, events);
        },
      },
    } : {}),
  });
  if (economicPreparation.status !== "prepared") {
    return {
      ok: false,
      result: errorResult(
        economicPreparation.status === "already-dispatched"
          ? "Managed economic invocation was already dispatch-fenced; replay will not dispatch it again."
          : "Managed economic authority denied every admitted candidate.",
        {
          errorCode: economicPreparation.status === "already-dispatched"
            ? "managed_economic_replay_fenced"
            : "economic_commitment_unavailable",
          status: "denied",
          candidateSet,
        },
        toolName,
      ),
    };
  }
  const selected = economicPreparation.commitment.reservation.selectedIdentity.route;
  const selectedCandidate = candidateSet.candidates.find((candidate) =>
    candidate.routeId === selected.routeId
    && candidate.providerId === selected.providerId
    && candidate.model === selected.modelId);
  if (!selectedCandidate) {
    await economicPreparation.recordExecutionSettlementPending("committed-candidate-unavailable");
    throw new ManagedCommittedRouteMismatchError({
      code: "committed-route-mismatch",
      expected: { routeId: selected.routeId, providerId: selected.providerId, modelId: selected.modelId },
      committed: { routeId: selected.routeId, providerId: selected.providerId, modelId: selected.modelId },
    });
  }
  const committedRoute = options.routes.find((route) =>
    route.routeId === selected.routeId
    && route.providerId === selected.providerId
    && route.model === selected.modelId);
  if (!committedRoute) {
    await economicPreparation.recordExecutionSettlementPending("committed-route-unavailable");
    throw new ManagedCommittedRouteMismatchError({
      code: "committed-route-mismatch",
      expected: { routeId: selected.routeId, providerId: selected.providerId, modelId: selected.modelId },
      committed: { routeId: selected.routeId, providerId: selected.providerId, modelId: selected.modelId },
    });
  }
  const fixedAgentCatalog = options.agentCatalog?.map((entry) => {
    if (entry.name !== agentProfile.name) return entry;
    const {
      economicPolicyId: _economicPolicyId,
      economicPolicyRevision: _economicPolicyRevision,
      economicPolicyCandidateRouteIds: _economicPolicyCandidateRouteIds,
      ...fixed
    } = entry;
    return {
      ...fixed,
      routeId: selected.routeId,
      providerRoute: {
        providerId: selected.providerId,
        model: selected.modelId,
        ...(economicProviderRoute.deliberationIntent
          ? { deliberationIntent: economicProviderRoute.deliberationIntent }
          : {}),
        ...(economicProviderRoute.communicationIntent
          ? { communicationIntent: economicProviderRoute.communicationIntent }
          : {}),
      },
    };
  });
  let recursivelyPrepared: PrepareOutcome;
  try {
    recursivelyPrepared = await prepareManagedInvocationRequest({
      ...rawInput,
      routeId: selected.routeId,
      providerRoute: {
        ...economicProviderRoute,
        ...(economicProviderRoute.communicationIntent
          ? { communicationIntent: economicProviderRoute.communicationIntent.intent }
          : {}),
        providerId: selected.providerId,
        model: selected.modelId,
      },
    }, context, {
      ...attachment,
      options: {
        ...options,
        routes: options.routes.map((route) => route.routeId === committedRoute.routeId
          ? { ...route, createAdapter: async () => economicPreparation.adapter }
          : route),
        ...(fixedAgentCatalog ? { agentCatalog: fixedAgentCatalog } : {}),
      },
    }, toolName, "already-admitted", selectedCandidate.deliberationResolution);
  } catch (error) {
    await economicPreparation.recordExecutionSettlementPending("postcommit-request-realization-failed");
    throw error;
  }
  if (!recursivelyPrepared.ok) {
    await economicPreparation.recordExecutionSettlementPending("postcommit-request-denied");
    return recursivelyPrepared;
  }
  return {
    ok: true,
    prepared: {
      ...recursivelyPrepared.prepared,
      canonicalizedRawInput: canonicalizedRawInput.input,
      lifecycleOptions: {
        abortSignal: economicPreparation.abortSignal,
        ...(attachment.childAuthorityAdmission
          ? { childAuthorityAdmission: attachment.childAuthorityAdmission }
          : {}),
        ...(agentProfile.workLimits ? { workLimits: agentProfile.workLimits } : {}),
        ...(options.workspaceRoot && agentProfile.workLimits
          ? {
              terminalObserver: (notification) => {
                const maxTurnsExhausted = notification.record.stopReason === "tool_round_budget_exhausted"
                  && agentProfile.workLimits?.maxTurns !== undefined;
                const durationExhausted = notification.record.stopReason === "managed-economic-duration-limit"
                  && agentProfile.workLimits?.maxDurationMs !== undefined;
                if (!maxTurnsExhausted && !durationExhausted) return;
                const progress = maxTurnsExhausted
                  ? {
                      dimension: "turns" as const,
                      consumed: agentProfile.workLimits!.maxTurns!,
                      limit: agentProfile.workLimits!.maxTurns!,
                      status: "exhausted" as const,
                    }
                  : {
                      dimension: "duration-ms" as const,
                      consumed: notification.durationMs ?? agentProfile.workLimits!.maxDurationMs!,
                      limit: agentProfile.workLimits!.maxDurationMs!,
                      status: "exhausted" as const,
                    };
                const events = appendManagedEconomicLifecycleSessionEvent({
                  session: context.session,
                  workspaceRoot: options.workspaceRoot!,
                  ...(context.turnId !== undefined ? { turnId: context.turnId } : {}),
                  jobId: `managed-economic-job:${economicIdentity}`,
                  economicAttemptId: `economic-attempt:${economicIdentity}`,
                  invocationId,
                  transition: durationExhausted ? "settlement-pending" : "released",
                  policy: economicPreparation.commitment.reservation.policy,
                  commitment: economicPreparation.commitment,
                  dispatchFenceId: economicPreparation.dispatchFenceId,
                  workLimitProgress: progress,
                  terminalCause: "work-limit-exhaustion",
                });
                void publishManagedInvocationSessionEvents(options, context, events);
              },
            }
          : {}),
        economicDispatch: {
          commitment: economicPreparation.commitment,
          dispatchFenceId: economicPreparation.dispatchFenceId,
          recordExecutionSettlementPending: economicPreparation.recordExecutionSettlementPending,
          createExecutionSettlement: economicPreparation.createExecutionSettlement,
          registerEconomicSettlement: economicPreparation.registerEconomicSettlement,
        },
      },
    },
  };
}

/** Phase 3: resolve agent profile + route, evaluate caller capability, and validate route capacity. */
async function resolveManagedInvocationRouteAndCapability(
  parsed: ManagedInvocationToolInput,
  requestedAuthority: ManagedAgentRequestedAuthority,
  attachment: ManagedInvocationToolAttachment,
  context: RuntimeBuiltinToolExecutionContext,
  toolName: string,
): Promise<
  | {
      readonly ok: true;
      readonly route: ManagedInvocationExecutableRoute;
      readonly profileDefaults: ManagedInvocationRouteProfile;
    }
  | PrepareFailure> {
  const { options, callerIdentity } = attachment;
  if (!parsed.providerRoute.providerId) {
    return {
      ok: false,
      result: errorResult(`${toolName} requires providerRoute.providerId for a fixed-route invocation.`, {}, toolName),
    };
  }
  const agentProfile = resolveManagedInvocationAgentProfile(options, parsed.agentProfile);
  const agentRouteValidation = validateAgentRouteHint(parsed, agentProfile, toolName);
  if (!agentRouteValidation.ok) {
    const recovery = buildRouteProfileConflictRecovery(parsed, agentRouteValidation, context, toolName);
    return {
      ok: false,
      result: errorResult(recovery.output, recovery.metadata, toolName),
    };
  }
  const routeResolution = resolveRoute(options.routes, parsed, agentProfile);
  if (routeResolution.status === "ambiguous") {
    return { ok: false, result: errorResult(routeResolution.reason, {}, toolName) };
  }
  if (routeResolution.status === "missing") {
    const unavailableRoute = resolveUnavailableRoute(options.unavailableRoutes ?? [], parsed);
    if (unavailableRoute) {
      return {
        ok: false,
        result: errorResult(
          `Managed invocation route '${unavailableRoute.routeId}' is unavailable for provider '${parsed.providerRoute.providerId}' and profile '${parsed.profile}': ${unavailableRoute.reason}`,
          {
            routeId: unavailableRoute.routeId,
            routeSource: unavailableRoute.routeSource,
            profile: parsed.profile,
            providerRoute: {
              providerId: unavailableRoute.providerId,
              ...(unavailableRoute.model ? { model: unavailableRoute.model } : {}),
            },
            status: "unavailable",
            presentationIntent: buildManagedInvocationPresentationIntent({
              sourceToolName: toolName,
              routeId: unavailableRoute.routeId,
              routeSource: unavailableRoute.routeSource,
              profile: parsed.profile,
              providerId: unavailableRoute.providerId,
              model: unavailableRoute.model,
              status: "unavailable",
              substantiveEvidence: false,
              failureReason: unavailableRoute.reason,
            }),
          },
          toolName,
        ),
      };
    }
    return {
      ok: false,
      result: errorResult(`No managed invocation route is configured for provider '${parsed.providerRoute.providerId}' and profile '${parsed.profile}'.`, {}, toolName),
    };
  }
  const route = routeResolution.route;
  const profileDefaults = resolveManagedInvocationRouteProfile(route, parsed.profile, agentProfile);
  if (!profileDefaults) return { ok: false, result: errorResult(`Managed invocation route '${route.routeId}' does not allow profile '${parsed.profile}'.`, {}, toolName) };
  const capabilityIdentityMismatch = managedRouteCapabilityIdentityMismatch(route);
  if (capabilityIdentityMismatch) {
    return {
      ok: false,
      result: errorResult("Managed invocation route capability identity does not match its configured target.", {
        errorCode: "route_capability_identity_mismatch",
        status: "denied",
        routeId: route.routeId,
        routeSource: route.routeSource,
        admissionReasons: [{ code: "route-capability-identity-mismatch" }],
      }, toolName),
    };
  }
  const requestedRouteAuthority = requestedAuthority === "auto" ? "read_only" : requestedAuthority;
  if (route.capability.capacity.kind === "policy-bound") {
    return {
      ok: false,
      result: errorResult("Managed invocation policy-bound capacity requires an economic commitment.", {
        errorCode: "policy_bound_capacity_requires_economic_commitment",
        status: "denied",
        routeId: route.routeId,
        routeSource: route.routeSource,
      }, toolName),
    };
  }
  const routeDeclaresEvidenceRealizations = Object.keys(profileDefaults.evidenceRealizations ?? {}).length > 0;
  const admission = admitManagedRoute({
    route: route.capability,
    work: {
      evaluatedAt: new Date().toISOString(), profile: parsed.profile, requestedAuthority: requestedRouteAuthority,
      requiredToolNames: routeDeclaresEvidenceRealizations ? [] : (parsed.requiredToolNames ?? []), requiresRecursion: false,
      requiresAttachments: parsed.externalRuntimeAttachment !== undefined,
      requiresWrite: requestedRouteAuthority === "destructive",
      ...(parsed.externalRuntimeAttachment ? { requestedExternalRuntimeAttachment: { kind: "external-runtime" as const, ...parsed.externalRuntimeAttachment } } : {}),
      minimumProof: "configured",
    },
    caller: deriveManagedInvocationCallerAuthority({ callerIdentity, routeAllowedToolNames: profileDefaults.allowedToolNames }),
  });
  if (admission.status !== "admitted") {
    return {
      ok: false,
      result: errorResult(
        `Managed invocation denied: ${admission.reasons.map((reason) => reason.code).join(", ")}`,
        {
          routeId: route.routeId,
          routeSource: route.routeSource,
          profile: parsed.profile,
          providerRoute: {
            providerId: route.providerId,
            ...(route.model ? { model: route.model } : {}),
          },
          status: "denied",
          callerIdentity,
          admissionReasons: admission.reasons,
        },
        toolName,
      ),
    };
  }

  // Roadmap 01 Slice 1 - Evidence Realization Contract. Strictly opt-in per
  // route: only activates when this route's own profile declares at least
  // one evidenceRealizations entry. A route that declares nothing keeps
  // exactly its pre-Slice-1 behavior (requiredToolNames alone governs
  // admission) - this must never change behavior for routes that never
  // asked for capability-aware realization. A route that does declare
  // realizations gets its declared (or the stable default) tools resolved
  // against its own admitted capabilities instead of trusting whatever
  // tool names a caller computed ahead of time - that blind trust on
  // "bash" was the original bug: it rejected MCP-only routes regardless of
  // their own qualified capabilities.
  const expectedEvidence = (parsed.expectedEvidence ?? []).filter(isKilnWorkGovernanceEvidence);
  const evidenceRealization = routeDeclaresEvidenceRealizations && expectedEvidence.length > 0
    ? resolveEvidenceRealization({
        routeId: route.routeId,
        expectedEvidence,
        declaredRealizations: profileDefaults.evidenceRealizations,
        admittedToolNames: profileDefaults.allowedToolNames,
      })
    : undefined;

  if (evidenceRealization && !evidenceRealization.ok) {
    const pause = evidenceRealization.pause;
    return {
      ok: false,
      result: errorResult(
        `Managed invocation route '${route.routeId}' cannot execute this phase because it lacks a realization for: ${pause.unrealizedEvidence.join(", ")}.`,
        {
          routeId: route.routeId,
          routeSource: route.routeSource,
          profile: parsed.profile,
          status: "capability_pause",
          capabilityPause: pause,
          allowedToolNames: profileDefaults.allowedToolNames,
          presentationIntent: buildManagedInvocationPresentationIntent({
            sourceToolName: toolName,
            routeId: route.routeId,
            routeSource: route.routeSource,
            profile: parsed.profile,
            providerId: route.providerId,
            model: route.model,
            contextMode: parsed.contextMode,
            status: "unavailable",
            substantiveEvidence: false,
            failureReason: `No admitted realization for: ${pause.unrealizedEvidence.join(", ")}`,
          }),
        },
        toolName,
      ),
    };
  }

  // Only a route that opted in (declared evidenceRealizations) and whose
  // resolution succeeded gets its required tools replaced by the resolved
  // set; every other route keeps trusting requiredToolNames exactly as
  // before Slice 1.
  const effectiveRequiredToolNames = evidenceRealization?.ok
    ? evidenceRealization.requiredToolNames
    : (parsed.requiredToolNames ?? []);

  const missingRequiredTools = missingManagedInvocationRequiredTools(
    effectiveRequiredToolNames,
    profileDefaults.allowedToolNames,
  );
  if (missingRequiredTools.length > 0) {
    return {
      ok: false,
      result: errorResult(
        `Managed invocation route '${route.routeId}' cannot execute this phase because it lacks required tools: ${missingRequiredTools.join(", ")}.`,
        {
          routeId: route.routeId,
          routeSource: route.routeSource,
          profile: parsed.profile,
          status: "unavailable",
          missingRequiredTools,
          requiredToolNames: effectiveRequiredToolNames,
          allowedToolNames: profileDefaults.allowedToolNames,
          presentationIntent: buildManagedInvocationPresentationIntent({
            sourceToolName: toolName,
            routeId: route.routeId,
            routeSource: route.routeSource,
            profile: parsed.profile,
            providerId: route.providerId,
            model: route.model,
            contextMode: parsed.contextMode,
            status: "unavailable",
            substantiveEvidence: false,
            failureReason: `Missing required route tools: ${missingRequiredTools.join(", ")}`,
          }),
        },
        toolName,
      ),
    };
  }

  const missingRequiredCapabilities = missingManagedInvocationRequiredCapabilities(
    effectiveRequiredToolNames,
    profileDefaults,
  );
  if (missingRequiredCapabilities.length > 0) {
    return {
      ok: false,
      result: errorResult(
        `Managed invocation route '${route.routeId}' cannot execute this phase because it lacks required capabilities: ${missingRequiredCapabilities.join(", ")}.`,
        {
          routeId: route.routeId,
          routeSource: route.routeSource,
          profile: parsed.profile,
          status: "unavailable",
          missingRequiredCapabilities,
          requiredToolNames: effectiveRequiredToolNames,
          presentationIntent: buildManagedInvocationPresentationIntent({
            sourceToolName: toolName,
            routeId: route.routeId,
            routeSource: route.routeSource,
            profile: parsed.profile,
            providerId: route.providerId,
            model: route.model,
            contextMode: parsed.contextMode,
            status: "unavailable",
            substantiveEvidence: false,
            failureReason: `Missing required route capabilities: ${missingRequiredCapabilities.join(", ")}`,
          }),
        },
        toolName,
      ),
    };
  }

  const missingRequiredReadPaths = missingManagedInvocationRequiredReadPaths(
    parsed.requiredReadPaths ?? [],
    profileDefaults,
  );
  if (missingRequiredReadPaths.length > 0) {
    return {
      ok: false,
      result: errorResult(
        `Managed invocation route '${route.routeId}' cannot execute this phase because it cannot read required paths: ${missingRequiredReadPaths.join(", ")}.`,
        {
          routeId: route.routeId,
          routeSource: route.routeSource,
          profile: parsed.profile,
          status: "unavailable",
          missingRequiredReadPaths,
          requiredReadPaths: parsed.requiredReadPaths ?? [],
          allowedReadPaths: effectiveManagedInvocationReadRoots(profileDefaults),
          deniedReadPaths: profileDefaults.readAuthority?.workspace.deniedPaths ?? [],
          presentationIntent: buildManagedInvocationPresentationIntent({
            sourceToolName: toolName,
            routeId: route.routeId,
            routeSource: route.routeSource,
            profile: parsed.profile,
            providerId: route.providerId,
            model: route.model,
            contextMode: parsed.contextMode,
            status: "unavailable",
            substantiveEvidence: false,
            failureReason: `Missing required read authority: ${missingRequiredReadPaths.join(", ")}`,
          }),
        },
        toolName,
      ),
    };
  }

  const authorityAdmission = validateManagedInvocationRequestedAuthority(requestedAuthority, parsed.profile, toolName);
  if (!authorityAdmission.ok) {
    return {
      ok: false,
      result: errorResult(authorityAdmission.error, {
        profile: parsed.profile,
        requestedAuthority,
        routeId: route.routeId,
        routeSource: route.routeSource,
      }, toolName),
    };
  }

  const adapter = await route.createAdapter?.();
  if (!adapter) return { ok: false, result: errorResult("Managed invocation adapter is unavailable after admission.", { errorCode: "adapter_unavailable", status: "denied" }, toolName) };
  if (!managedAdapterMatchesRouteCapability(adapter, route)) {
    return {
      ok: false,
      result: errorResult("Managed invocation adapter does not match the admitted route capability.", {
        errorCode: "route_capability_adapter_mismatch",
        status: "denied",
        routeId: route.routeId,
        routeSource: route.routeSource,
        admissionReasons: [{ code: "route-capability-adapter-mismatch" }],
      }, toolName),
    };
  }
  const executableRoute: ManagedInvocationExecutableRoute = { ...route, adapter };
  return { ok: true, route: executableRoute, profileDefaults };
}

function managedRouteCapabilityIdentityMismatch(route: ManagedInvocationToolRoute): boolean {
  return route.capability.identity.routeId !== route.routeId
    || route.capability.target.providerId !== route.providerId
    || route.capability.target.modelId !== route.model;
}

function managedAdapterMatchesRouteCapability(
  adapter: ManagedInvocationExecutableRoute["adapter"],
  route: ManagedInvocationToolRoute,
): boolean {
  const adapterKind = managedRouteAdapterKind(adapter);
  return adapter.descriptor.providerId === route.providerId
    && adapterKind !== undefined
    && adapterKind === route.capability.adapter.kind;
}

function managedRouteAdapterKind(
  adapter: ManagedInvocationExecutableRoute["adapter"],
): ManagedInvocationToolRoute["capability"]["adapter"]["kind"] | undefined {
  const modes = adapter.descriptor.supportedExecutionModes;
  if (modes.length !== 1) return undefined;
  const [mode] = modes;
  if (adapter.descriptor.adapterKind === "direct") {
    return mode === "direct-provider" ? "direct-provider" : undefined;
  }
  if (adapter.descriptor.adapterKind !== "harness") return undefined;
  if (mode === "local-harness") return "native-harness";
  if (mode === "cli-harness") return "cli-harness";
  if (mode === "remote-harness") return "governed-external-runtime";
  return undefined;
}

/** Phase 4: resolve context (agent profile / skills / work classification) and assemble the child prompt. */
async function resolveManagedInvocationContextPhase(
  parsed: ManagedInvocationToolInput,
  options: ManagedInvocationToolAttachment["options"],
  route: ManagedInvocationExecutableRoute,
  toolName: string,
): Promise<
  | {
      readonly ok: true;
      readonly prompt: string;
      readonly resolution: ManagedInvocationContextResolution;
      readonly contextMetadata: ReturnType<typeof buildManagedInvocationContextMetadata>;
    }
  | PrepareFailure
> {
  const contextResolution = await resolveInvocationContext(parsed, options, route);
  if (!contextResolution.ok) {
    const contextMetadata = buildManagedInvocationContextMetadata(parsed, contextResolution.resolution);
    return {
      ok: false,
      result: errorResult(contextResolution.error, {
        routeId: route.routeId,
        routeSource: route.routeSource,
        profile: parsed.profile,
        providerRoute: {
          providerId: route.providerId,
          ...(route.model ? { model: route.model } : {}),
          ...(route.surface ? { surface: route.surface } : {}),
        },
        status: contextResolution.status,
        context: contextMetadata,
        presentationIntent: buildManagedInvocationPresentationIntent({
          sourceToolName: toolName,
          routeId: route.routeId,
          routeSource: route.routeSource,
          profile: parsed.profile,
          providerId: route.providerId,
          model: route.model,
          contextMode: parsed.contextMode,
          status: contextResolution.status,
          substantiveEvidence: false,
          failureReason: contextResolution.error,
        }),
      }, toolName),
    };
  }
  const prompt = contextResolution.resolution.promptPrefix
    ? `${contextResolution.resolution.promptPrefix}\n\nTask:\n${parsed.task}`
    : parsed.task;
  const contextMetadata = buildManagedInvocationContextMetadata(parsed, contextResolution.resolution);
  return { ok: true, prompt, resolution: contextResolution.resolution, contextMetadata };
}

/** Phase 5: allocate the invocation id, request authority approval, and assemble the invocation request record. */
async function buildManagedInvocationRequestRecord(input: {
  readonly attachment: ManagedInvocationToolAttachment;
  readonly context: RuntimeBuiltinToolExecutionContext;
  readonly options: ManagedInvocationToolAttachment["options"];
  readonly callerIdentity: ManagedAgentCallerAttachmentIdentity;
  readonly canonicalizedRawInput: ReturnType<typeof canonicalizeManagedInvocationRawInput>;
  readonly parsed: ManagedInvocationToolInput;
  readonly requestedAuthority: ManagedAgentRequestedAuthority;
  readonly route: ManagedInvocationExecutableRoute;
  readonly profileDefaults: ManagedInvocationRouteProfile;
  readonly prompt: string;
  readonly resolution: ManagedInvocationContextResolution;
  readonly contextMetadata: ReturnType<typeof buildManagedInvocationContextMetadata>;
  readonly toolName: string;
  readonly parentTurnId: string;
  readonly invocationId: string;
  readonly admittedDeliberationResolution?: DeliberationResolution;
}): Promise<PrepareOutcome> {
  const {
    attachment, context, options, callerIdentity, canonicalizedRawInput, parsed, requestedAuthority,
    route, profileDefaults, prompt, resolution, contextMetadata,
    toolName, parentTurnId, invocationId, admittedDeliberationResolution,
  } = input;
  const { adapter } = route;
  const agentProfile = resolveManagedInvocationAgentProfile(options, parsed.agentProfile);

  const resolvedAuthority = resolveManagedInvocationRouteAuthority(profileDefaults, invocationId);
  const handoffContract = buildHandoffContract(parsed);
  const authorityApproval = await requestManagedInvocationAuthorityApproval({
    requestedAuthority,
    target: { kind: "route", routeId: route.routeId },
    profile: parsed.profile,
    context,
    toolName,
  });
  if (!authorityApproval.ok) {
    return {
      ok: false,
      result: errorResult(authorityApproval.error, {
        profile: parsed.profile,
        requestedAuthority,
        routeId: route.routeId,
      }, toolName),
    };
  }

  if (context.executionScope?.managedInvocationId) {
    return {
      ok: false,
      result: errorResult(
        "Nested managed delegation is unavailable for a bounded child runtime because descendant accounting authority was not propagated.",
        { errorCode: "bounded_work_nested_delegation_unavailable", status: "denied" },
        toolName,
      ),
    };
  }
  if (
    context.executionScope?.kind === "work_item"
    && (
      parsed.goalRunId !== context.executionScope.goalRunId
      || parsed.workItemId !== context.executionScope.workItemId
      || (context.executionScope.attemptId !== undefined && parsed.attemptId !== context.executionScope.attemptId)
    )
  ) {
    return {
      ok: false,
      result: errorResult(
        "Managed invocation attribution must match the runtime-owned bounded work scope.",
        { errorCode: "bounded_work_inherited_scope_mismatch", status: "denied" },
        toolName,
      ),
    };
  }

  let boundedWorkAdmission: Extract<
    import("./types.js").ManagedInvocationBoundedWorkAdmissionResult,
    { readonly admitted: true }
  > | undefined;
  if (parsed.goalRunId) {
    if (!parsed.workItemId) {
      return {
        ok: false,
        result: errorResult("Managed bounded work requires a work item identity.", {
          errorCode: "bounded_work_attribution_required",
          status: "denied",
        }, toolName),
      };
    }
    const admission = attachment.boundedWorkAdmission;
    if (!admission) {
      return {
        ok: false,
        result: errorResult("Managed bounded work authority is unavailable on this runtime surface.", {
          errorCode: "bounded_work_admission_unavailable",
          status: "denied",
        }, toolName),
      };
    }
    const result = admission({
      parentSessionId: context.session.id,
      goalRunId: parsed.goalRunId,
      workItemId: parsed.workItemId,
      ...(parsed.attemptId ? { attemptId: parsed.attemptId } : {}),
      invocationId,
      routeId: route.routeId,
      harnessId: `${adapter.descriptor.adapterKind}:${adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness"}`,
      workspaceRoot: resolvedAuthority.workingDirectory.path,
      routeWriteAllowedPaths: resolvedAuthority.writeAuthority?.scope.workspace.allowedPaths ?? [],
      routeWriteDeniedPaths: resolvedAuthority.writeAuthority?.scope.workspace.deniedPaths ?? [],
      writeRequested: profileDefaults.writeAllowed === true,
      requestedEffects: parsed.boundedWorkEffects ?? [],
      childDepth: 1,
    });
    if (!result.admitted) {
      return {
        ok: false,
        result: errorResult(result.message, {
          errorCode: result.code,
          status: "denied",
          ...(result.suggestedNextTool ? { suggestedNextTool: result.suggestedNextTool } : {}),
        }, toolName),
      };
    }
    boundedWorkAdmission = result;
  }

  const executionScope = parsed.workItemId
    ? {
        kind: "work_item" as const,
        goalRunId: parsed.goalRunId!,
        workItemId: parsed.workItemId,
        ...(parsed.attemptId ? { attemptId: parsed.attemptId } : {}),
        managedInvocationId: invocationId,
      }
    : parsed.goalRunId
      ? { kind: "goal" as const, goalRunId: parsed.goalRunId, managedInvocationId: invocationId }
      : undefined;
  const request = defineManagedAgentInvocationRequest({
    invocationId,
    agentId: `${route.routeId}:${parsed.profile}`,
    parentSessionId: context.session.id,
    parentTurnId,
    profile: parsed.profile,
    requestedBy: options.requestedBy ?? "assistant",
    requestSource: options.requestSource ?? "runtime-tool",
    executionIntent: toolName === MANAGED_AGENT_START_TOOL_NAME
      ? { attendance: "unattended", lifecycle: "background" }
      : { attendance: "attended", lifecycle: "foreground" },
    requestedAuthority,
    ...(authorityApproval.authorityApproval ? { authorityApproval: authorityApproval.authorityApproval } : {}),
    providerRoute: {
      providerId: route.providerId,
      surface: route.surface ?? adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
      ...(parsed.providerRoute.model ?? route.model ? { model: parsed.providerRoute.model ?? route.model } : {}),
      ...(parsed.providerRoute.deliberationIntent ? { deliberationIntent: parsed.providerRoute.deliberationIntent } : {}),
      ...(admittedDeliberationResolution ? { deliberationResolution: admittedDeliberationResolution } : {}),
      ...(parsed.providerRoute.communicationIntent ? { communicationIntent: parsed.providerRoute.communicationIntent } : {}),
    },
    adapterKind: adapter.descriptor.adapterKind,
    executionMode: adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
    ...(executionScope ? { executionScope } : {}),
    ...(parsed.externalRuntimeAttachment
      ? {
          externalRuntimeAttachment: {
            kind: "external-runtime" as const,
            runtimeId: parsed.externalRuntimeAttachment.runtimeId,
            attachmentId: parsed.externalRuntimeAttachment.attachmentId,
          },
        }
      : {}),
    authority: {
      authorityProfileId: profileDefaults.authorityProfileId,
      permissionProfile: profileDefaults.permissionProfile,
      toolAuthority: {
        allowedToolNames: profileDefaults.allowedToolNames,
        writeAllowed: profileDefaults.writeAllowed === true,
        networkAllowed: profileDefaults.networkAllowed === true,
      },
      workingDirectory: resolvedAuthority.workingDirectory,
      timeoutMs: profileDefaults.timeoutMs,
      ...(profileDefaults.timeoutSource ? { timeoutSource: profileDefaults.timeoutSource } : {}),
      credentialRoute: normalizeManagedInvocationCredentialRoute(profileDefaults.credentialRoute),
      memoryScope: profileDefaults.memoryScope,
      ...(profileDefaults.readAuthority ? { readAuthority: profileDefaults.readAuthority } : {}),
      ...(resolvedAuthority.writeAuthority
        ? {
            writeAuthority: boundedWorkAdmission
              ? {
                  ...resolvedAuthority.writeAuthority,
                  scope: {
                    ...resolvedAuthority.writeAuthority.scope,
                    workspace: {
                      ...resolvedAuthority.writeAuthority.scope.workspace,
                      allowedPaths: boundedWorkAdmission.workspaceAuthority.allowedPaths,
                      deniedPaths: boundedWorkAdmission.workspaceAuthority.deniedPaths,
                    },
                  },
                }
              : resolvedAuthority.writeAuthority,
          }
        : {}),
    },
    input: {
      summary: parsed.summary,
      prompt,
      ...(parsed.resourceUris ? { resourceUris: parsed.resourceUris } : {}),
      context: contextMetadata,
      ...(handoffContract ? { handoff: handoffContract } : {}),
    },
  });

  return {
    ok: true,
    prepared: {
      context,
      parsed,
      canonicalizedRawInput: canonicalizedRawInput.input,
      route,
      request,
      capabilitySnapshotInput: {
        routeId: route.routeId,
        routeSource: route.routeSource,
        callerIdentity,
        ...(route.externalRuntimeAttachment ? { externalRuntimeAttachment: route.externalRuntimeAttachment } : {}),
        routeHealth: {
          status: "healthy",
          reason: managedInvocationRouteHealthReason(profileDefaults, route.routeSource),
        },
        providerModelProof: {
          ...(route.providerModelProof ?? {
            status: "live-proven",
            source: "managed-invocation-route-health",
            requiresToolCalls: adapter.descriptor.adapterKind === "direct",
          }),
        },
        resourcePlane: {
          available: true,
          resourceUris: parsed.resourceUris ?? [],
          reason: parsed.resourceUris && parsed.resourceUris.length > 0
            ? "Governed resource URIs admitted by runtime context selection."
            : "No governed resources requested.",
        },
        childIdentity: {
          agentId: `${route.routeId}:${parsed.profile}`,
          ...(parsed.agentProfile ? { requestedAgentProfile: parsed.agentProfile } : {}),
          ...(resolution.admittedAgentProfile ? { admittedAgentProfile: resolution.admittedAgentProfile } : {}),
          ...(managedAgentDisplayName(options, resolution.admittedAgentProfile ?? parsed.agentProfile)
            ? { displayName: managedAgentDisplayName(options, resolution.admittedAgentProfile ?? parsed.agentProfile) }
            : {}),
          ...(route.voiceProfile ? { voiceProfile: route.voiceProfile } : {}),
        },
      },
      ...(boundedWorkAdmission ? { boundedWorkLifecycle: boundedWorkAdmission.lifecycle } : {}),
      ...(agentProfile?.workLimits || attachment.childAuthorityAdmission
        ? {
            lifecycleOptions: {
              ...(attachment.childAuthorityAdmission
                ? { childAuthorityAdmission: attachment.childAuthorityAdmission }
                : {}),
              ...(agentProfile?.workLimits ? { workLimits: agentProfile.workLimits } : {}),
            },
          }
        : {}),
      ...(canonicalizedRawInput.canonicalizedForbiddenInputFields.length > 0
        ? { canonicalizedForbiddenInputFields: canonicalizedRawInput.canonicalizedForbiddenInputFields }
        : {}),
    },
  };
}

export async function prepareManagedInvocationRequest(
  rawInput: Record<string, unknown>,
  context: RuntimeBuiltinToolExecutionContext | undefined,
  attachment: ManagedInvocationToolAttachment,
  toolName: string,
  scopeAdmission: "required" | "already-admitted" = "required",
  admittedDeliberationResolution?: DeliberationResolution,
): Promise<PrepareOutcome> {
  const { options } = attachment;
  if (!context) {
    return { ok: false, result: errorResult(`${toolName} requires runtime session context.`, {}, toolName) };
  }

  const callerResolution = resolveManagedInvocationCallerIdentity(
    attachment.callerIdentity,
    context.effectiveTurnAuthority,
  );
  if (!callerResolution.ok) {
    return {
      ok: false,
      result: errorResult(callerResolution.reason, {
        errorCode: "managed_parent_authority_unavailable",
        status: "denied",
      }, toolName),
    };
  }
  const effectiveAttachment: ManagedInvocationToolAttachment = callerResolution.callerIdentity
    ? { ...attachment, callerIdentity: callerResolution.callerIdentity }
    : attachment;
  const { callerIdentity } = effectiveAttachment;

  // Computed once, from `context` alone, so it is identical whether read here (for the economic
  // commitment path) or in phase 5 below (the fixed-route path and the "already-admitted"
  // recursive call reached after economic commitment): none of the inputs to
  // `resolveManagedInvocationParentTurnId`/`resolveManagedInvocationParentTurnOrdinal`/
  // `buildInvocationId` change within this function.
  const parentTurnId = resolveManagedInvocationParentTurnId(context);
  const invocationId = buildInvocationId(
    context.session.id,
    resolveManagedInvocationParentTurnOrdinal(parentTurnId, context.session.userTurnCount),
    context.toolCall.id,
  );

  const scopeOutcome = admitManagedInvocationScope(rawInput, context, attachment, toolName, scopeAdmission);
  if (!scopeOutcome.ok) return scopeOutcome;
  const { canonicalizedRawInput, parsed: scopedParsed, requestedAuthority } = scopeOutcome;

  const agentProfile = resolveManagedInvocationAgentProfile(options, scopedParsed.agentProfile);
  const parsed = applyManagedAgentCommunication(scopedParsed, agentProfile);
  if (agentProfile?.economicPolicyId && agentProfile.economicPolicyRevision) {
    return resolveManagedInvocationEconomicCommitment({
      rawInput,
      context,
      attachment: effectiveAttachment,
      toolName,
      parsed,
      requestedAuthority,
      canonicalizedRawInput,
      agentProfile,
      economicPolicyId: agentProfile.economicPolicyId,
      economicPolicyRevision: agentProfile.economicPolicyRevision,
      invocationId,
    });
  }

  const routeOutcome = await resolveManagedInvocationRouteAndCapability(parsed, requestedAuthority, effectiveAttachment, context, toolName);
  if (!routeOutcome.ok) return routeOutcome;
  const { route, profileDefaults } = routeOutcome;

  const contextOutcome = await resolveManagedInvocationContextPhase(parsed, options, route, toolName);
  if (!contextOutcome.ok) return contextOutcome;
  const { prompt, resolution, contextMetadata } = contextOutcome;

  return buildManagedInvocationRequestRecord({
    attachment: effectiveAttachment,
    context,
    options,
    callerIdentity,
    canonicalizedRawInput,
    parsed,
    requestedAuthority,
    route,
    profileDefaults,
    prompt,
    resolution,
    contextMetadata,
    toolName,
    parentTurnId,
    invocationId,
    admittedDeliberationResolution,
  });
}
