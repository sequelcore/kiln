import { createSessionEvent } from "@kilnai/core";
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
  SessionAgentInvocationEvidence,
  SessionEventSource,
} from "@kilnai/core";
import { defineManagedAgentWriteEvidence } from "@kilnai/core";
import type { RuntimeSession } from "../../session/runtime-session.js";

export interface AppendManagedInvocationSessionEventsInput {
  readonly session: RuntimeSession;
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: ManagedAgentAdmissionDecision;
  readonly record?: ManagedAgentInvocationRecord;
  readonly durationMs?: number;
  readonly timestamp?: Date;
}

export function appendManagedInvocationSessionEvents(
  input: AppendManagedInvocationSessionEventsInput,
): readonly CanonicalSessionEvent[] {
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
    inputSummary: input.request.input.summary,
    source,
    timestamp,
  });
  events.push(requested);

  if (input.decision.status === "denied") {
    const evidence = collectDeniedEvidence(input.request, input.decision, timestamp);
    const denied = createSessionEvent<"agent_invocation_failed">({
      kilnSessionId: input.session.id,
      sequence: nextSequence(),
      kind: "agent_invocation_failed",
      turnId: input.request.parentTurnId,
      parentEventId: requested.eventId,
      invocationId: input.request.invocationId,
      agentId: input.request.agentId,
      parentSessionId: input.request.parentSessionId,
      ...managedInvocationIdentity(input.request),
      errorCode: "ADMISSION_DENIED",
      errorMessage: formatAdmissionDenied(input.decision),
      retriable: false,
      ...(evidence !== undefined ? { managedInvocationEvidence: evidence } : {}),
      source,
      timestamp,
    });
    events.push(denied);
    input.session.appendSessionEvents(events);
    return events;
  }

  if (!input.record) {
    throw new Error("Managed invocation record is required when admission is admitted");
  }

  const started = createSessionEvent<"agent_invocation_started">({
    kilnSessionId: input.session.id,
    sequence: nextSequence(),
    kind: "agent_invocation_started",
    turnId: input.record.parentTurnId,
    parentEventId: requested.eventId,
    invocationId: input.record.invocationId,
    agentId: input.record.agentId,
    parentSessionId: input.record.parentSessionId,
    ...managedInvocationIdentity(input.record, input.request),
    attempt: 1,
    source,
    timestamp,
  });
  events.push(started);

  const terminal = mapTerminalEvent({
    session: input.session,
    request: input.request,
    record: input.record,
    started,
    sequence: nextSequence(),
    timestamp,
    durationMs: input.durationMs,
    source,
  });
  if (terminal) {
    events.push(terminal);
  }

  input.session.appendSessionEvents(events);
  return events;
}

function mapTerminalEvent(input: {
  readonly session: RuntimeSession;
  readonly request: ManagedAgentInvocationRequest;
  readonly record: ManagedAgentInvocationRecord;
  readonly started: CanonicalAgentInvocationStartedEvent;
  readonly sequence: number;
  readonly timestamp: Date;
  readonly durationMs?: number;
  readonly source: SessionEventSource;
}): CanonicalAgentInvocationCompletedEvent | CanonicalAgentInvocationFailedEvent | CanonicalAgentInvocationCancelledEvent | undefined {
  const evidence = collectEvidence(input.record);
  switch (input.record.lifecycleState) {
    case "completed":
      return createSessionEvent<"agent_invocation_completed">({
        kilnSessionId: input.session.id,
        sequence: input.sequence,
        kind: "agent_invocation_completed",
        turnId: input.record.parentTurnId,
        parentEventId: input.started.eventId,
        invocationId: input.record.invocationId,
        agentId: input.record.agentId,
        parentSessionId: input.record.parentSessionId,
        ...managedInvocationIdentity(input.record, input.request),
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
        parentEventId: input.started.eventId,
        invocationId: input.record.invocationId,
        agentId: input.record.agentId,
        parentSessionId: input.record.parentSessionId,
        ...managedInvocationIdentity(input.record, input.request),
        reason: "Managed invocation cancelled.",
        cancelledBy: "runtime",
        ...(evidence !== undefined ? { managedInvocationEvidence: evidence } : {}),
        source: input.source,
        timestamp: input.timestamp,
      });
    case "timed-out":
      return createSessionEvent<"agent_invocation_failed">({
        kilnSessionId: input.session.id,
        sequence: input.sequence,
        kind: "agent_invocation_failed",
        turnId: input.record.parentTurnId,
        parentEventId: input.started.eventId,
        invocationId: input.record.invocationId,
        agentId: input.record.agentId,
        parentSessionId: input.record.parentSessionId,
        ...managedInvocationIdentity(input.record, input.request),
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
        parentEventId: input.started.eventId,
        invocationId: input.record.invocationId,
        agentId: input.record.agentId,
        parentSessionId: input.record.parentSessionId,
        ...managedInvocationIdentity(input.record, input.request),
        errorCode: "ENGINE_FAILURE",
        errorMessage: "Managed invocation failed.",
        retriable: true,
        ...(evidence !== undefined ? { managedInvocationEvidence: evidence } : {}),
        source: input.source,
        timestamp: input.timestamp,
      });
    default:
      return undefined;
  }
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
): Pick<CanonicalAgentInvocationStartedEvent, "profile" | "providerRoute" | "adapterKind" | "executionMode" | "authorityProfileId" | "capabilitySnapshot" | "invocationContext"> {
  const invocationContext = "input" in source
    ? source.input.context
    : request?.input.context;
  const snapshot = "capabilitySnapshot" in source
    ? source.capabilitySnapshot
    : capabilitySnapshot;
  return {
    profile: source.profile,
    providerRoute: source.providerRoute,
    adapterKind: source.adapterKind,
    executionMode: source.executionMode,
    authorityProfileId: source.authority.authorityProfileId,
    ...(snapshot ? { capabilitySnapshot: snapshot } : {}),
    ...(invocationContext ? { invocationContext } : {}),
  };
}

function admittedCapabilitySnapshot(
  decision: ManagedAgentAdmissionDecision,
): ManagedAgentCapabilitySnapshot | undefined {
  return decision.status === "admitted" ? decision.capabilitySnapshot : undefined;
}

function collectEvidence(record: ManagedAgentInvocationRecord): SessionAgentInvocationEvidence | undefined {
  const evidence: {
    childSessionId?: string;
    childTurnId?: string;
    transcript?: SessionAgentInvocationEvidence["transcript"];
    diagnostics?: SessionAgentInvocationEvidence["diagnostics"];
    usage?: SessionAgentInvocationEvidence["usage"];
    resultHandoff?: SessionAgentInvocationEvidence["resultHandoff"];
    writeAuthority?: SessionAgentInvocationEvidence["writeAuthority"];
    writeEvidence?: SessionAgentInvocationEvidence["writeEvidence"];
  } = {};
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
  if (!request.authority.writeAuthority) {
    return undefined;
  }
  return {
    writeAuthority: request.authority.writeAuthority,
    writeEvidence: [
      defineManagedAgentWriteEvidence({
        evidenceId: `${request.invocationId}:write-authority-denied`,
        invocationId: request.invocationId,
        kind: "write-authority-denied",
        summary: formatAdmissionDenied(decision),
        resourceUris: [],
        recordedAt: timestamp.toISOString(),
      }),
    ],
  };
}

function makeSource(): SessionEventSource {
  return {
    actor: "runtime",
    surface: "runtime",
    component: "managed-invocation",
  };
}
