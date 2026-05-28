import { buildManagedAgentLifecycleEvidence, createSessionEvent } from "@kilnai/core";
import type {
  CanonicalAgentInvocationCancelledEvent,
  CanonicalAgentInvocationCompletedEvent,
  CanonicalAgentInvocationFailedEvent,
  CanonicalAgentInvocationStartedEvent,
  CanonicalSessionEvent,
  ManagedAgentAdmissionDecision,
  ManagedAgentCapabilitySnapshot,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentWriteAuthority,
  ManagedAgentWriteEvidence,
  SessionAgentInvocationEvidence,
  SessionEventSource,
} from "@kilnai/core";
import { defineManagedAgentWriteEvidence } from "@kilnai/core";
import type { RuntimeSession } from "../../session/runtime-session.js";
import {
  projectManagedInvocationAuthorityResources,
  projectManagedInvocationCapabilitySnapshotResources,
  projectManagedInvocationPublicResourceUri,
  projectManagedInvocationResourceLeaseResources,
} from "./resource-projection.js";

export interface AppendManagedInvocationSessionEventsInput {
  readonly session: RuntimeSession;
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: ManagedAgentAdmissionDecision;
  readonly record?: ManagedAgentInvocationRecord;
  readonly durationMs?: number;
  readonly timestamp?: Date;
}

export interface AppendManagedInvocationStartSessionEventsInput {
  readonly session: RuntimeSession;
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: ManagedAgentAdmissionDecision;
  readonly timestamp?: Date;
}

export interface AppendManagedInvocationTerminalSessionEventInput {
  readonly session: RuntimeSession;
  readonly request: ManagedAgentInvocationRequest;
  readonly record: ManagedAgentInvocationRecord;
  readonly durationMs?: number;
  readonly timestamp?: Date;
}

export interface AppendManagedInvocationRuntimeFailureSessionEventInput {
  readonly session: RuntimeSession;
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly errorMessage: string;
  readonly timestamp?: Date;
}

export function appendManagedInvocationSessionEvents(
  input: AppendManagedInvocationSessionEventsInput,
): readonly CanonicalSessionEvent[] {
  const startEvents = collectManagedInvocationStartEvents({
    ...input,
    ...(input.record ? { startLifecycleState: startedLifecycleState(input.record.lifecycleState) } : {}),
  });
  if (input.decision.status === "denied") {
    input.session.appendSessionEvents(startEvents.events);
    return startEvents.events;
  }

  if (!input.record) {
    throw new Error("Managed invocation record is required when admission is admitted");
  }

  const terminal = mapTerminalEvent({
    session: input.session,
    request: input.request,
    record: input.record,
    startedEventId: startEvents.startedEventId,
    sequence: startEvents.nextSequence,
    timestamp: startEvents.timestamp,
    durationMs: input.durationMs,
    source: startEvents.source,
  });
  const events = terminal ? [...startEvents.events, terminal] : startEvents.events;
  input.session.appendSessionEvents(events);
  return events;
}

export function appendManagedInvocationStartSessionEvents(
  input: AppendManagedInvocationStartSessionEventsInput,
): readonly CanonicalSessionEvent[] {
  const startEvents = collectManagedInvocationStartEvents(input);
  input.session.appendSessionEvents(startEvents.events);
  return startEvents.events;
}

export function appendManagedInvocationTerminalSessionEvent(
  input: AppendManagedInvocationTerminalSessionEventInput,
): readonly CanonicalSessionEvent[] {
  if (hasTerminalEvent(input.session, input.record.invocationId)) {
    return [];
  }
  const source = makeSource();
  const timestamp = input.timestamp ?? new Date();
  const startedEventId = latestStartedEventId(input.session, input.record.invocationId);
  const terminal = mapTerminalEvent({
    session: input.session,
    request: input.request,
    record: input.record,
    startedEventId,
    sequence: input.session.nextSessionEventSequence(),
    timestamp,
    durationMs: input.durationMs,
    source,
  });
  if (!terminal) {
    return [];
  }
  input.session.appendSessionEvents([terminal]);
  return [terminal];
}

export function appendManagedInvocationRuntimeFailureSessionEvent(
  input: AppendManagedInvocationRuntimeFailureSessionEventInput,
): readonly CanonicalSessionEvent[] {
  if (hasTerminalEvent(input.session, input.request.invocationId)) {
    return [];
  }
  const source = makeSource();
  const timestamp = input.timestamp ?? new Date();
  const startedEventId = latestStartedEventId(input.session, input.request.invocationId);
  const event = createSessionEvent<"agent_invocation_failed">({
    kilnSessionId: input.session.id,
    sequence: input.session.nextSessionEventSequence(),
    kind: "agent_invocation_failed",
    turnId: input.request.parentTurnId,
    ...(startedEventId !== undefined ? { parentEventId: startedEventId } : {}),
    invocationId: input.request.invocationId,
    agentId: input.request.agentId,
    parentSessionId: input.request.parentSessionId,
    ...managedInvocationIdentity(input.request, undefined, admittedCapabilitySnapshot(input.decision)),
    lifecycleState: "failed",
    errorCode: "ENGINE_FAILURE",
    errorMessage: input.errorMessage,
    retriable: true,
    source,
    timestamp,
  });
  input.session.appendSessionEvents([event]);
  return [event];
}

function collectManagedInvocationStartEvents(
  input: AppendManagedInvocationStartSessionEventsInput & {
    readonly startLifecycleState?: ManagedAgentInvocationRecord["lifecycleState"];
  },
): {
  readonly events: readonly CanonicalSessionEvent[];
  readonly nextSequence: number;
  readonly timestamp: Date;
  readonly source: SessionEventSource;
  readonly startedEventId?: string;
} {
  const source = makeSource();
  const timestamp = input.timestamp ?? new Date();
  const events: CanonicalSessionEvent[] = [];
  let sequence = input.session.nextSessionEventSequence();
  const nextSequence = () => sequence++;

  const requested = createSessionEvent<"agent_invocation_requested">({
    kilnSessionId: input.session.id,
    sequence: nextSequence(),
    kind: "agent_invocation_requested",
    turnId: input.request.parentTurnId,
    invocationId: input.request.invocationId,
    agentId: input.request.agentId,
    parentSessionId: input.request.parentSessionId,
    requestedBy: input.request.requestedBy,
    requestSource: input.request.requestSource,
    ...managedInvocationIdentity(input.request, undefined, admittedCapabilitySnapshot(input.decision)),
    ...(input.decision.status === "denied"
      ? { routeId: input.decision.routeId, routeSource: input.decision.routeSource }
      : {}),
    lifecycleState: "pending",
    inputSummary: input.request.input.summary,
    source,
    timestamp,
  });
  events.push(requested);

  if (input.decision.status === "denied") {
    const evidence = collectDeniedEvidence(input.request, input.decision, timestamp);
    events.push(createSessionEvent<"agent_invocation_failed">({
      kilnSessionId: input.session.id,
      sequence: nextSequence(),
      kind: "agent_invocation_failed",
      turnId: input.request.parentTurnId,
      parentEventId: requested.eventId,
      invocationId: input.request.invocationId,
      agentId: input.request.agentId,
      parentSessionId: input.request.parentSessionId,
      ...managedInvocationIdentity(input.request),
      routeId: input.decision.routeId,
      routeSource: input.decision.routeSource,
      lifecycleState: "failed",
      errorCode: "ADMISSION_DENIED",
      errorMessage: formatAdmissionDenied(input.decision),
      retriable: false,
      ...(evidence !== undefined ? { managedInvocationEvidence: evidence } : {}),
      source,
      timestamp,
    }));
    return {
      events,
      nextSequence: sequence,
      timestamp,
      source,
    };
  }

  const started = createSessionEvent<"agent_invocation_started">({
    kilnSessionId: input.session.id,
    sequence: nextSequence(),
    kind: "agent_invocation_started",
    turnId: input.request.parentTurnId,
    parentEventId: requested.eventId,
    invocationId: input.request.invocationId,
    agentId: input.request.agentId,
    parentSessionId: input.request.parentSessionId,
    ...managedInvocationIdentity(input.request, undefined, admittedCapabilitySnapshot(input.decision)),
    lifecycleState: input.startLifecycleState ?? "running",
    attempt: 1,
    source,
    timestamp,
  });
  events.push(started);

  return {
    events,
    nextSequence: sequence,
    timestamp,
    source,
    startedEventId: started.eventId,
  };
}

function mapTerminalEvent(input: {
  readonly session: RuntimeSession;
  readonly request: ManagedAgentInvocationRequest;
  readonly record: ManagedAgentInvocationRecord;
  readonly startedEventId?: string;
  readonly sequence: number;
  readonly timestamp: Date;
  readonly durationMs?: number;
  readonly source: SessionEventSource;
}): CanonicalAgentInvocationCompletedEvent | CanonicalAgentInvocationFailedEvent | CanonicalAgentInvocationCancelledEvent | undefined {
  const evidence = collectEvidence(input.record);
  const lineage = input.startedEventId !== undefined ? { parentEventId: input.startedEventId } : {};
  switch (input.record.lifecycleState) {
    case "completed":
      return createSessionEvent<"agent_invocation_completed">({
        kilnSessionId: input.session.id,
        sequence: input.sequence,
        kind: "agent_invocation_completed",
        turnId: input.record.parentTurnId,
        ...lineage,
        invocationId: input.record.invocationId,
        agentId: input.record.agentId,
        parentSessionId: input.record.parentSessionId,
        ...managedInvocationIdentity(input.record, input.request),
        lifecycleState: input.record.lifecycleState,
        durationMs: input.durationMs,
        resultSummary: input.record.resultHandoff?.summary,
        ...(evidence !== undefined ? { managedInvocationEvidence: evidence } : {}),
        source: input.source,
        timestamp: input.timestamp,
      });
    case "cancelled":
      return createSessionEvent<"agent_invocation_cancelled">({
        kilnSessionId: input.session.id,
        sequence: input.sequence,
        kind: "agent_invocation_cancelled",
        turnId: input.record.parentTurnId,
        ...lineage,
        invocationId: input.record.invocationId,
        agentId: input.record.agentId,
        parentSessionId: input.record.parentSessionId,
        ...managedInvocationIdentity(input.record, input.request),
        lifecycleState: input.record.lifecycleState,
        reason: input.record.resultHandoff?.summary ?? "Managed invocation cancelled.",
        cancelledBy: "runtime",
        ...(evidence !== undefined ? { managedInvocationEvidence: evidence } : {}),
        source: input.source,
        timestamp: input.timestamp,
      });
    case "timed_out":
      return createSessionEvent<"agent_invocation_failed">({
        kilnSessionId: input.session.id,
        sequence: input.sequence,
        kind: "agent_invocation_failed",
        turnId: input.record.parentTurnId,
        ...lineage,
        invocationId: input.record.invocationId,
        agentId: input.record.agentId,
        parentSessionId: input.record.parentSessionId,
        ...managedInvocationIdentity(input.record, input.request),
        lifecycleState: input.record.lifecycleState,
        errorCode: "ENGINE_TIMEOUT",
        errorMessage: "Managed invocation timed out.",
        retriable: true,
        ...(evidence !== undefined ? { managedInvocationEvidence: evidence } : {}),
        source: input.source,
        timestamp: input.timestamp,
      });
    case "failed":
      return createSessionEvent<"agent_invocation_failed">({
        kilnSessionId: input.session.id,
        sequence: input.sequence,
        kind: "agent_invocation_failed",
        turnId: input.record.parentTurnId,
        ...lineage,
        invocationId: input.record.invocationId,
        agentId: input.record.agentId,
        parentSessionId: input.record.parentSessionId,
        ...managedInvocationIdentity(input.record, input.request),
        lifecycleState: input.record.lifecycleState,
        errorCode: "ENGINE_FAILURE",
        errorMessage: input.record.resultHandoff?.summary ?? "Managed invocation failed.",
        retriable: true,
        ...(evidence !== undefined ? { managedInvocationEvidence: evidence } : {}),
        source: input.source,
        timestamp: input.timestamp,
      });
    case "stale":
      return createSessionEvent<"agent_invocation_failed">({
        kilnSessionId: input.session.id,
        sequence: input.sequence,
        kind: "agent_invocation_failed",
        turnId: input.record.parentTurnId,
        ...lineage,
        invocationId: input.record.invocationId,
        agentId: input.record.agentId,
        parentSessionId: input.record.parentSessionId,
        ...managedInvocationIdentity(input.record, input.request),
        lifecycleState: input.record.lifecycleState,
        errorCode: "ENGINE_STALE",
        errorMessage: input.record.resultHandoff?.summary ?? "Managed invocation marked stale by runtime recovery.",
        retriable: true,
        ...(evidence !== undefined ? { managedInvocationEvidence: evidence } : {}),
        source: input.source,
        timestamp: input.timestamp,
      });
    case "recovered":
      return createSessionEvent<"agent_invocation_failed">({
        kilnSessionId: input.session.id,
        sequence: input.sequence,
        kind: "agent_invocation_failed",
        turnId: input.record.parentTurnId,
        ...lineage,
        invocationId: input.record.invocationId,
        agentId: input.record.agentId,
        parentSessionId: input.record.parentSessionId,
        ...managedInvocationIdentity(input.record, input.request),
        lifecycleState: input.record.lifecycleState,
        errorCode: "ENGINE_RECOVERED",
        errorMessage: input.record.resultHandoff?.summary ?? "Managed invocation recovered after runtime restart.",
        retriable: true,
        ...(evidence !== undefined ? { managedInvocationEvidence: evidence } : {}),
        source: input.source,
        timestamp: input.timestamp,
      });
    default:
      return undefined;
  }
}

function hasTerminalEvent(session: RuntimeSession, invocationId: string): boolean {
  return session.sessionEvents.some((event) =>
    "invocationId" in event &&
    event.invocationId === invocationId &&
    (
      event.kind === "agent_invocation_completed" ||
      event.kind === "agent_invocation_failed" ||
      event.kind === "agent_invocation_cancelled"
    )
  );
}

function latestStartedEventId(session: RuntimeSession, invocationId: string): string | undefined {
  return [...session.sessionEvents]
    .reverse()
    .find((event) =>
      event.kind === "agent_invocation_started" &&
      "invocationId" in event &&
      event.invocationId === invocationId
    )
    ?.eventId;
}

function startedLifecycleState(
  lifecycleState: ManagedAgentInvocationRecord["lifecycleState"],
): ManagedAgentInvocationRecord["lifecycleState"] {
  if (
    lifecycleState === "completed" ||
    lifecycleState === "failed" ||
    lifecycleState === "timed_out" ||
    lifecycleState === "cancelled" ||
    lifecycleState === "stale" ||
    lifecycleState === "recovered"
  ) {
    return "running";
  }
  return lifecycleState;
}

function formatAdmissionDenied(decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "denied" }>): string {
  const suffix = decision.missingCapabilities.length > 0
    ? ` missingCapabilities=${decision.missingCapabilities.join(",")}`
    : "";
  return `${decision.reason}${suffix}`;
}

function managedInvocationIdentity(
  source: ManagedAgentInvocationRequest | ManagedAgentInvocationRecord,
  request?: ManagedAgentInvocationRequest,
  capabilitySnapshot?: ManagedAgentCapabilitySnapshot,
): Pick<CanonicalAgentInvocationStartedEvent, "parentTurnId" | "routeId" | "routeSource" | "profile" | "providerRoute" | "adapterKind" | "executionMode" | "requestedAuthority" | "authorityProfileId" | "capabilitySnapshot" | "invocationContext" | "handoffContract"> {
  const invocationContext = "input" in source
    ? source.input.context
    : request?.input.context;
  const handoffContract = "input" in source
    ? source.input.handoff
    : request?.input.handoff;
  const snapshot = "capabilitySnapshot" in source
    ? source.capabilitySnapshot
    : capabilitySnapshot;
  return {
    parentTurnId: source.parentTurnId,
    ...(snapshot ? { routeId: snapshot.routeId, routeSource: snapshot.routeSource } : {}),
    profile: source.profile,
    providerRoute: source.providerRoute,
    adapterKind: source.adapterKind,
    executionMode: source.executionMode,
    ...(("requestedAuthority" in source && source.requestedAuthority)
      ? { requestedAuthority: source.requestedAuthority }
      : request?.requestedAuthority
        ? { requestedAuthority: request.requestedAuthority }
        : {}),
    authorityProfileId: source.authority.authorityProfileId,
    ...(snapshot ? { capabilitySnapshot: snapshot } : {}),
    ...(invocationContext ? { invocationContext } : {}),
    ...(handoffContract ? { handoffContract } : {}),
  };
}

function admittedCapabilitySnapshot(
  decision: ManagedAgentAdmissionDecision,
): ManagedAgentCapabilitySnapshot | undefined {
  return decision.status === "admitted"
    ? projectManagedInvocationCapabilitySnapshotResources(
        decision.capabilitySnapshot,
        projectManagedInvocationPublicResourceUri,
      )
    : undefined;
}

function collectEvidence(record: ManagedAgentInvocationRecord): SessionAgentInvocationEvidence | undefined {
  const evidence: {
    lifecycle?: SessionAgentInvocationEvidence["lifecycle"];
    childSessionId?: string;
    childTurnId?: string;
    transcript?: SessionAgentInvocationEvidence["transcript"];
    diagnostics?: SessionAgentInvocationEvidence["diagnostics"];
    usage?: SessionAgentInvocationEvidence["usage"];
    resultHandoff?: SessionAgentInvocationEvidence["resultHandoff"];
    writeAuthority?: SessionAgentInvocationEvidence["writeAuthority"];
    writeEvidence?: SessionAgentInvocationEvidence["writeEvidence"];
  } = {};
  evidence.lifecycle = buildManagedAgentLifecycleEvidence(record);
  if (record.childSessionId) {
    evidence.childSessionId = record.childSessionId;
  }
  if (record.childTurnId) {
    evidence.childTurnId = record.childTurnId;
  }
  if (record.transcript) {
    evidence.transcript = record.transcript;
  }
  if (record.diagnostics && record.diagnostics.length > 0) {
    evidence.diagnostics = record.diagnostics;
  }
  if (record.usage) {
    evidence.usage = record.usage;
  }
  if (record.resultHandoff) {
    evidence.resultHandoff = record.resultHandoff;
  }
  if (record.authority.writeAuthority) {
    evidence.writeAuthority = record.authority.writeAuthority;
  }
  if (record.writeEvidence && record.writeEvidence.length > 0) {
    evidence.writeEvidence = record.writeEvidence;
  }
  return Object.keys(evidence).length > 0 ? evidence : undefined;
}

function collectDeniedEvidence(
  request: ManagedAgentInvocationRequest,
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "denied" }>,
  timestamp: Date,
): SessionAgentInvocationEvidence | undefined {
  const evidence: {
    lifecycle?: SessionAgentInvocationEvidence["lifecycle"];
    writeAuthority?: ManagedAgentWriteAuthority;
    writeEvidence?: readonly ManagedAgentWriteEvidence[];
  } = {};
  if (decision.resourceLease !== undefined) {
    const resourceLease = projectManagedInvocationResourceLeaseResources(
      decision.resourceLease,
      projectManagedInvocationPublicResourceUri,
    );
    evidence.lifecycle = {
      lifecycleState: "failed",
      invocationId: request.invocationId,
      parentSessionId: request.parentSessionId,
      parentTurnId: request.parentTurnId,
      routeId: decision.routeId,
      routeSource: decision.routeSource,
      providerId: request.providerRoute.providerId,
      ...(request.providerRoute.model !== undefined ? { model: request.providerRoute.model } : {}),
      profile: request.profile,
      contextMode: request.input.context?.mode ?? "isolated",
      authorityProfileId: request.authority.authorityProfileId,
      resourceLease,
      diagnosticUris: resourceLease.diagnosticUris,
      handoffResourceUris: [],
    };
  }
  if (request.authority.writeAuthority) {
    const writeAuthority = projectManagedInvocationAuthorityResources(
      request.authority,
      projectManagedInvocationPublicResourceUri,
    ).writeAuthority;
    if (writeAuthority) {
      evidence.writeAuthority = writeAuthority;
    }
    evidence.writeEvidence = [
      defineManagedAgentWriteEvidence({
        evidenceId: `${request.invocationId}:write-authority-denied`,
        invocationId: request.invocationId,
        kind: "write-authority-denied",
        summary: formatAdmissionDenied(decision),
        resourceUris: [],
        recordedAt: timestamp.toISOString(),
      }),
    ];
  }
  return Object.keys(evidence).length > 0 ? evidence : undefined;
}

function makeSource(): SessionEventSource {
  return {
    actor: "runtime",
    surface: "runtime",
    component: "managed-invocation",
  };
}
