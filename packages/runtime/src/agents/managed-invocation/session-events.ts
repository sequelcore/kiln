import { posix, win32 } from "node:path";
import {
  buildManagedAgentLifecycleEvidence,
  createSessionEvent,
  isManagedAgentWorkspaceVolumeRoot,
} from "@kilnai/core";
import type {
  CanonicalAgentInvocationCancelledEvent,
  CanonicalAgentInvocationCompletedEvent,
  CanonicalAgentInvocationFailedEvent,
  CanonicalAgentInvocationStartedEvent,
  CanonicalSessionEvent,
  ManagedAgentAuthorityProfile,
  ManagedAgentAdmissionDecision,
  ManagedAgentCapabilitySnapshot,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentWriteAuthority,
  ManagedAgentWriteEvidence,
  ManagedEconomicAccountIdentity,
  ManagedEconomicCommitment,
  ManagedEconomicEvidenceIdentity,
  ManagedEconomicPolicyIdentity,
  ManagedEconomicRouteIdentity,
  ManagedEconomicSettlement,
  SessionAgentInvocationEvidence,
  SessionEventSource,
  SessionManagedEconomicAccountIdentity,
  SessionManagedEconomicBillingClass,
  SessionManagedEconomicChildConsumption,
  SessionManagedEconomicProviderAllowance,
  SessionManagedEconomicRejection,
  SessionManagedEconomicSelectionReason,
  SessionManagedEconomicLifecycleTransition,
  SessionManagedEconomicRouteIdentity,
  SessionManagedEconomicTerminalCause,
  SessionManagedEconomicWorkLimitProgress,
} from "@kilnai/core";
import { defineManagedAgentWriteEvidence } from "@kilnai/core";
import type { RuntimeSession } from "../../session/runtime-session.js";
import type { EffectiveAuthorityAdmissionBundle } from "../../session/effective-authority-admission-bundle.js";
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
    const events = projectDurableSessionEvents(
      startEvents.events,
      input.request.authority.workingDirectory.path,
    );
    input.session.appendSessionEvents(events);
    return events;
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
  const events = projectDurableSessionEvents(
    terminal ? [...startEvents.events, terminal] : startEvents.events,
    input.request.authority.workingDirectory.path,
  );
  input.session.appendSessionEvents(events);
  return events;
}

export function appendManagedInvocationStartSessionEvents(
  input: AppendManagedInvocationStartSessionEventsInput,
): readonly CanonicalSessionEvent[] {
  const startEvents = collectManagedInvocationStartEvents(input);
  const events = projectDurableSessionEvents(
    startEvents.events,
    input.request.authority.workingDirectory.path,
  );
  input.session.appendSessionEvents(events);
  return events;
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
  const events = projectDurableSessionEvents(
    [terminal],
    input.request.authority.workingDirectory.path,
  );
  input.session.appendSessionEvents(events);
  return events;
}

/** Appends newer durable evidence for an already-projected terminal invocation. */
export function appendManagedInvocationTerminalEvidenceSessionEvent(
  input: AppendManagedInvocationTerminalSessionEventInput,
): readonly CanonicalSessionEvent[] {
  if (!hasTerminalEvent(input.session, input.record.invocationId)) {
    throw new Error("Managed invocation terminal evidence enrichment requires an existing terminal event");
  }
  const source = makeSource();
  const terminal = mapTerminalEvent({
    session: input.session,
    request: input.request,
    record: input.record,
    startedEventId: latestStartedEventId(input.session, input.record.invocationId),
    sequence: input.session.nextSessionEventSequence(),
    timestamp: input.timestamp ?? new Date(),
    durationMs: input.durationMs,
    source,
  });
  if (!terminal) return [];
  const events = projectDurableSessionEvents(
    [terminal],
    input.request.authority.workingDirectory.path,
  );
  input.session.appendSessionEvents(events);
  return events;
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
  const event = projectDurableSessionEvent(createSessionEvent<"agent_invocation_failed">({
    kilnSessionId: input.session.id,
    sequence: input.session.nextSessionEventSequence(),
    kind: "agent_invocation_failed",
    turnId: input.request.parentTurnId,
    ...(startedEventId !== undefined ? { parentEventId: startedEventId } : {}),
    invocationId: input.request.invocationId,
    agentId: input.request.agentId,
    parentSessionId: input.request.parentSessionId,
    ...managedInvocationIdentity(
      input.request,
      undefined,
      admittedCapabilitySnapshot(input.decision, input.request.authority.workingDirectory.path),
    ),
    lifecycleState: "failed",
    errorCode: "ENGINE_FAILURE",
    errorMessage: input.errorMessage,
    retriable: true,
    source,
    timestamp,
  }), input.request.authority.workingDirectory.path);
  input.session.appendSessionEvents([event]);
  return [event];
}

export interface AppendManagedEconomicLifecycleSessionEventInput {
  readonly session: RuntimeSession;
  readonly workspaceRoot: string;
  readonly turnId?: string;
  readonly transition: SessionManagedEconomicLifecycleTransition;
  readonly jobId: string;
  readonly economicAttemptId: string;
  readonly invocationId?: string;
  readonly policy: ManagedEconomicPolicyIdentity;
  readonly commitment?: ManagedEconomicCommitment;
  readonly dispatchFenceId?: string;
  readonly settlement?: ManagedEconomicSettlement;
  readonly selectionReason?: SessionManagedEconomicSelectionReason;
  readonly workLimitProgress?: SessionManagedEconomicWorkLimitProgress;
  readonly terminalCause?: SessionManagedEconomicTerminalCause;
  readonly reason?: string;
  readonly rejections?: readonly SessionManagedEconomicRejection[];
  readonly timestamp?: Date;
}

export function appendManagedEconomicLifecycleSessionEvent(
  input: AppendManagedEconomicLifecycleSessionEventInput,
): readonly CanonicalSessionEvent[] {
  const selectedIdentity = input.commitment?.reservation.selectedIdentity;
  const settlementAuthority = settlementAuthorityOf(input.settlement);
  const timestamp = input.timestamp ?? new Date();
  const providerAllowance = selectedIdentity
    ? providerAllowanceOf(selectedIdentity.account, timestamp)
    : undefined;
  const reservedAmount = comparableReservedAmount(input.commitment);
  const settledAmount = comparableSettledAmount(input.settlement);
  const billingClass = billingClassOf(selectedIdentity?.route, input.settlement);
  const perChildConsumption = perChildConsumptionOf(input, settledAmount);
  const selectionReason = input.selectionReason ?? selectionReasonOf(input.commitment);
  const terminalCause = input.terminalCause ?? terminalCauseOf(input);
  const evidenceFreshness = evidenceFreshnessOf(input.settlement, providerAllowance, timestamp);
  const event = projectDurableSessionEvent(createSessionEvent<"managed_economic_lifecycle">({
    kilnSessionId: input.session.id,
    sequence: input.session.nextSessionEventSequence(),
    kind: "managed_economic_lifecycle",
    ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
    source: makeSource(),
    timestamp,
    jobId: input.jobId,
    economicAttemptId: input.economicAttemptId,
    evidenceVersion: 1,
    ...(input.invocationId !== undefined ? { invocationId: input.invocationId } : {}),
    transition: input.transition,
    policyId: input.policy.policyId,
    policyRevision: input.policy.policyRevision,
    policyDigest: input.policy.policyDigest,
    ...(input.commitment ? {
      commitmentId: input.commitment.commitmentId,
      reservationId: input.commitment.reservation.reservationId,
    } : {}),
    ...(input.dispatchFenceId !== undefined ? { dispatchFenceId: input.dispatchFenceId } : {}),
    ...(selectedIdentity ? { selectedRoute: projectManagedEconomicRouteIdentity(selectedIdentity.route) } : {}),
    ...(selectedIdentity ? { selectedAccount: projectManagedEconomicAccountIdentity(selectedIdentity.account) } : {}),
    ...(selectedIdentity ? {
      selectedTarget: {
        targetId: selectedIdentity.route.routeId,
        providerId: selectedIdentity.route.providerId,
        modelId: selectedIdentity.route.modelId,
        reason: selectionReason,
      },
    } : {}),
    ...(billingClass !== undefined ? { billingClass } : {}),
    ...(providerAllowance !== undefined ? { providerAllowance } : {}),
    ...(input.workLimitProgress !== undefined ? { workLimitProgress: input.workLimitProgress } : {}),
    ...(reservedAmount !== undefined ? { reservedAmount } : {}),
    ...(settledAmount !== undefined ? { settledAmount } : {}),
    ...(perChildConsumption !== undefined ? { perChildConsumption: [perChildConsumption] } : {}),
    ...(evidenceFreshness !== undefined ? { evidenceFreshness } : {}),
    ...(terminalCause !== undefined ? { terminalCause } : {}),
    ...(input.settlement ? { settlementKind: input.settlement.kind } : {}),
    ...(settlementAuthority !== undefined ? { settlementAuthority } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.transition === "denied" ? { rejections: input.rejections ?? [] } : {}),
  }), input.workspaceRoot);
  input.session.appendSessionEvents([event]);
  return [event];
}

function projectManagedEconomicAmount(amount: import("@kilnai/core").ManagedEconomicAmount) {
  return {
    atoms: amount.atoms,
    scale: amount.scale,
    unit: amount.unit,
    scheme: amount.scheme,
  };
}

function comparableReservedAmount(
  commitment: ManagedEconomicCommitment | undefined,
) {
  const amount = commitment?.reservation.amounts.length === 1
    ? commitment.reservation.amounts[0]
    : undefined;
  return amount && amount.scheme.kind !== "unit" ? projectManagedEconomicAmount(amount) : undefined;
}

function comparableSettledAmount(settlement: ManagedEconomicSettlement | undefined) {
  if (settlement?.kind !== "charged") return undefined;
  return settlement.charge.scheme.kind !== "unit"
    ? projectManagedEconomicAmount(settlement.charge)
    : undefined;
}

function billingClassOf(
  route: ManagedEconomicRouteIdentity | undefined,
  settlement: ManagedEconomicSettlement | undefined,
): SessionManagedEconomicBillingClass | undefined {
  if (!settlement) return route?.priceClass;
  if (settlement.kind === "pending" || settlement.kind === "leaked") return route?.priceClass ?? "unknown";
  return settlement.kind === "charged" ? "metered" : settlement.kind;
}

function providerAllowanceOf(
  account: ManagedEconomicAccountIdentity,
  at: Date,
): SessionManagedEconomicProviderAllowance | undefined {
  if (account.kind !== "account-bound" || !account.quotaEvidence) return undefined;
  const quota = account.quotaEvidence;
  const evidenceFreshness = quota.evidence
    ? freshnessForEvidence(quota.evidence, at)
    : "missing" as const;
  if (quota.kind === "unlimited") {
    return { status: "unlimited", evidenceFreshness };
  }
  if (quota.kind === "unknown") {
    return { status: "unknown", evidenceFreshness };
  }
  return {
    status: quota.exhaustionReason ? "exhausted" : "available",
    evidenceFreshness,
    buckets: quota.buckets.map((bucket) => ({
      dimension: bucket.dimension,
      remaining: bucket.remaining ? projectManagedEconomicAmount(bucket.remaining) : null,
      resetsAt: bucket.resetsAt,
    })),
  };
}

function freshnessForEvidence(
  evidence: import("@kilnai/core").ManagedEconomicEvidenceIdentity,
  at: Date,
): "fresh" | "stale" | "unknown" {
  const validUntil = Date.parse(evidence.validUntil);
  const observedAt = Date.parse(evidence.observedAt);
  if (!Number.isFinite(validUntil) || !Number.isFinite(observedAt)) return "unknown";
  return at.getTime() <= validUntil && observedAt <= at.getTime() ? "fresh" : "stale";
}

function evidenceFreshnessOf(
  settlement: ManagedEconomicSettlement | undefined,
  providerAllowance: SessionManagedEconomicProviderAllowance | undefined,
  at: Date,
): "fresh" | "stale" | "missing" | "unknown" | undefined {
  if (settlement && "evidence" in settlement && settlement.evidence) {
    return freshnessForEvidence(settlement.evidence, at);
  }
  return providerAllowance?.evidenceFreshness;
}

function perChildConsumptionOf(
  input: AppendManagedEconomicLifecycleSessionEventInput,
  settledAmount: ReturnType<typeof comparableSettledAmount>,
): SessionManagedEconomicChildConsumption | undefined {
  if (!input.invocationId || !input.settlement || !("units" in input.settlement)) return undefined;
  return {
    childId: input.invocationId,
    units: input.settlement.units.map(projectManagedEconomicAmount),
    ...(settledAmount ? { settledAmount } : {}),
    comparability: settledAmount ? "comparable" : "not-comparable",
  };
}

function terminalCauseOf(
  input: AppendManagedEconomicLifecycleSessionEventInput,
): SessionManagedEconomicTerminalCause | undefined {
  if (input.transition === "denied") {
    if ((input.rejections ?? []).some((rejection) =>
      rejection.stage === "economic-selection" && rejection.reason === "ceiling-exceeded")) {
      return "spend-denial";
    }
    if ((input.rejections ?? []).some((rejection) =>
      rejection.stage === "account-selection" && rejection.reason === "unhealthy")) {
      return "provider-exhaustion";
    }
    if ((input.rejections ?? []).length === 0) return "unknown";
    return "technical-failure";
  }
  if (input.transition === "release-failed" || input.transition === "leaked") return "technical-failure";
  if (input.settlement?.kind === "unknown" || input.settlement?.kind === "leaked") {
    return "technical-failure";
  }
  if (input.settlement?.kind === "charged" || input.settlement?.kind === "estimated"
    || input.settlement?.kind === "subscription"
    || input.settlement?.kind === "included" || input.settlement?.kind === "free") {
    return "completed";
  }
  if (input.transition === "released") return "cancelled";
  return undefined;
}

function selectionReasonOf(
  commitment: ManagedEconomicCommitment | undefined,
): SessionManagedEconomicSelectionReason {
  if (!commitment) return "runtime-authority-selection";
  const reasons = [
    ...commitment.notSelected.map((candidate) => candidate.reason),
    ...commitment.rejected.map(() => "rejected" as const),
  ];
  if (reasons.length === 0) return "only-admitted-target";
  if (reasons.includes("higher-comparison-domain-rank") || reasons.includes("higher-priority-rank")) {
    return "configured-target-order";
  }
  if (reasons.includes("higher-worst-case-reservation")) return "lower-comparable-reservation";
  if (reasons.includes("stable-route-id-order") || reasons.includes("stable-capacity-identity-order")) {
    return "stable-identity-order";
  }
  return "runtime-authority-selection";
}

function projectManagedEconomicRouteIdentity(
  route: ManagedEconomicRouteIdentity,
): SessionManagedEconomicRouteIdentity {
  return {
    routeId: route.routeId,
    providerId: route.providerId,
    modelId: route.modelId,
    adapterCapabilityId: route.adapterCapabilityId,
    adapterCapabilityVersion: route.adapterCapabilityVersion,
    ...(route.priceClass !== undefined ? { priceClass: route.priceClass } : {}),
  };
}

function projectManagedEconomicAccountIdentity(
  account: ManagedEconomicAccountIdentity,
): SessionManagedEconomicAccountIdentity {
  if (account.kind === "accountless") {
    return { kind: "accountless" };
  }
  return {
    kind: "account-bound",
    capacityIdentity: account.capacityIdentity,
    creditPosture: account.creditPosture,
    overagePosture: account.overagePosture,
  };
}

function settlementAuthorityOf(
  settlement: ManagedEconomicSettlement | undefined,
): ManagedEconomicEvidenceIdentity["authority"] | undefined {
  if (!settlement || !("evidence" in settlement) || !settlement.evidence) {
    return undefined;
  }
  return settlement.evidence.authority;
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
    ...managedInvocationIdentity(
      input.request,
      undefined,
      admittedCapabilitySnapshot(input.decision, input.request.authority.workingDirectory.path),
    ),
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
    ...managedInvocationIdentity(
      input.request,
      undefined,
      admittedCapabilitySnapshot(input.decision, input.request.authority.workingDirectory.path),
    ),
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

function formatAdmissionDenied(
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "denied" }>,
): string {
  const suffix = decision.missingCapabilities.length > 0
    ? ` missingCapabilities=${decision.missingCapabilities.join(",")}`
    : "";
  return `${decision.reason}${suffix}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function managedInvocationIdentity(
  source: ManagedAgentInvocationRequest | ManagedAgentInvocationRecord,
  request?: ManagedAgentInvocationRequest,
  capabilitySnapshot?: ManagedAgentCapabilitySnapshot,
): Pick<CanonicalAgentInvocationStartedEvent, "parentTurnId" | "routeId" | "routeSource" | "access" | "providerRoute" | "adapterKind" | "executionMode" | "requestedAuthority" | "authorityProfileId" | "capabilitySnapshot" | "invocationContext" | "handoffContract" | "executionScope"> {
  const invocationContext = "input" in source
    ? source.input.context
    : request?.input.context;
  const handoffContract = "input" in source
    ? source.input.handoff
    : request?.input.handoff;
  const snapshot = "capabilitySnapshot" in source
    ? request
      ? projectDurableCapabilitySnapshot(
          source.capabilitySnapshot,
          request.authority.workingDirectory.path,
        )
      : source.capabilitySnapshot
    : capabilitySnapshot;
  const executionScope = "executionScope" in source
    ? source.executionScope
    : request?.executionScope;
  return {
    parentTurnId: source.parentTurnId,
    ...(snapshot ? { routeId: snapshot.routeId, routeSource: snapshot.routeSource } : {}),
    access: source.access,
    providerRoute: source.providerRoute,
    adapterKind: source.adapterKind,
    executionMode: source.executionMode,
    ...(("requestedAuthority" in source && source.requestedAuthority)
      ? { requestedAuthority: source.requestedAuthority }
      : request?.requestedAuthority
        ? { requestedAuthority: request.requestedAuthority }
        : {}),
    authorityProfileId: source.authority.authorityProfileId,
    ...(executionScope ? { executionScope } : {}),
    ...(snapshot ? { capabilitySnapshot: snapshot } : {}),
    ...(invocationContext ? { invocationContext } : {}),
    ...(handoffContract ? { handoffContract } : {}),
  };
}

function admittedCapabilitySnapshot(
  decision: ManagedAgentAdmissionDecision,
  workspaceRoot: string,
): ManagedAgentCapabilitySnapshot | undefined {
  return decision.status === "admitted"
    ? projectDurableCapabilitySnapshot(decision.capabilitySnapshot, workspaceRoot)
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
    coordinationUsage?: SessionAgentInvocationEvidence["coordinationUsage"];
    resultHandoff?: SessionAgentInvocationEvidence["resultHandoff"];
    writeAuthority?: SessionAgentInvocationEvidence["writeAuthority"];
    writeEvidence?: SessionAgentInvocationEvidence["writeEvidence"];
    /** Runtime-owned, secret-free parent admission carried with the child event. */
    authorityAdmission?: EffectiveAuthorityAdmissionBundle;
  } = {};
  const authorityAdmission = (record as ManagedAgentInvocationRecord & {
    readonly authorityAdmission?: EffectiveAuthorityAdmissionBundle;
  }).authorityAdmission;
  if (authorityAdmission !== undefined) {
    evidence.authorityAdmission = authorityAdmission;
  }
  const lifecycle = buildManagedAgentLifecycleEvidence(record);
  evidence.lifecycle = {
    ...lifecycle,
    resourceLease: projectDurableResourceLease(
      lifecycle.resourceLease,
      record.authority.workingDirectory.path,
    ),
    sourceResourceUris: record.capabilitySnapshot.resourcePlane.resourceUris,
  };
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
  if (record.coordinationUsage) {
    evidence.coordinationUsage = record.coordinationUsage;
  }
  if (record.resultHandoff) {
    evidence.resultHandoff = record.resultHandoff;
  }
  if (record.authority.writeAuthority) {
    evidence.writeAuthority = projectDurableAuthority(
      record.authority,
      record.authority.workingDirectory.path,
    ).writeAuthority;
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
    const durableResourceLease = projectDurableResourceLease(
      resourceLease,
      request.authority.workingDirectory.path,
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
      access: request.access,
      contextMode: request.input.context?.mode ?? "isolated",
      authorityProfileId: request.authority.authorityProfileId,
      resourceLease: durableResourceLease,
      sourceResourceUris: request.input.resourceUris ?? [],
      diagnosticUris: durableResourceLease.diagnosticUris,
      handoffResourceUris: [],
    };
  }
  if (request.authority.writeAuthority) {
    const writeAuthority = projectDurableAuthority(
      request.authority,
      request.authority.workingDirectory.path,
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

function projectDurableCapabilitySnapshot(
  snapshot: ManagedAgentCapabilitySnapshot,
  workspaceRoot: string,
): ManagedAgentCapabilitySnapshot {
  const projected = projectManagedInvocationCapabilitySnapshotResources(
    snapshot,
    projectManagedInvocationPublicResourceUri,
  );
  return {
    ...projected,
    ...(projected.authorityProfile !== undefined
      ? {
          authorityProfile: projectDurableAuthority(projected.authorityProfile, workspaceRoot),
        }
      : {}),
    resourceLease: projectDurableResourceLease(projected.resourceLease, workspaceRoot),
  };
}

function projectDurableAuthority(
  authority: ManagedAgentAuthorityProfile,
  workspaceRoot: string,
): ManagedAgentAuthorityProfile {
  const projected = projectManagedInvocationAuthorityResources(
    authority,
    projectManagedInvocationPublicResourceUri,
  );
  return {
    ...projected,
    workingDirectory: {
      ...projected.workingDirectory,
      path: portableWorkspacePath(projected.workingDirectory.path, workspaceRoot),
    },
    ...(projected.readAuthority !== undefined
      ? {
          readAuthority: {
            workspace: {
              allowedPaths: projected.readAuthority.workspace.allowedPaths.map(
                (path) => portableWorkspacePath(path, workspaceRoot),
              ),
              deniedPaths: projected.readAuthority.workspace.deniedPaths.map(
                (path) => portableWorkspacePath(path, workspaceRoot),
              ),
            },
          },
        }
      : {}),
    ...(projected.writeAuthority !== undefined
      ? {
          writeAuthority: {
            ...projected.writeAuthority,
            scope: {
              ...projected.writeAuthority.scope,
              workspace: {
                ...projected.writeAuthority.scope.workspace,
                allowedPaths: projected.writeAuthority.scope.workspace.allowedPaths.map(
                  (path) => portableWorkspacePath(path, workspaceRoot),
                ),
                deniedPaths: projected.writeAuthority.scope.workspace.deniedPaths.map(
                  (path) => portableWorkspacePath(path, workspaceRoot),
                ),
              },
            },
          },
        }
      : {}),
  };
}

function projectDurableResourceLease(
  lease: ManagedAgentCapabilitySnapshot["resourceLease"],
  workspaceRoot: string,
): ManagedAgentCapabilitySnapshot["resourceLease"] {
  return {
    ...lease,
    workingDirectoryPath: portableWorkspacePath(lease.workingDirectoryPath, workspaceRoot),
    ...(lease.worktreeConflict !== undefined
      ? {
          worktreeConflict: {
            ...lease.worktreeConflict,
            workingDirectoryPath: portableWorkspacePath(
              lease.worktreeConflict.workingDirectoryPath,
              workspaceRoot,
            ),
          },
        }
      : {}),
  };
}

function projectDurableSessionEvents(
  events: readonly CanonicalSessionEvent[],
  workspaceRoot: string,
): readonly CanonicalSessionEvent[] {
  return events.map((event) => projectDurableSessionEvent(event, workspaceRoot));
}

function projectDurableSessionEvent(
  event: CanonicalSessionEvent,
  workspaceRoot: string,
): CanonicalSessionEvent {
  if (isManagedAgentWorkspaceVolumeRoot(workspaceRoot)) {
    throw new Error("Managed invocation durable events reject filesystem volume root workspaces");
  }
  return projectDurableValue(event, workspaceRoot) as CanonicalSessionEvent;
}

function projectDurableValue(value: unknown, workspaceRoot: string): unknown {
  if (typeof value === "string") {
    return redactWorkspaceReferences(value, workspaceRoot);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => projectDurableValue(entry, workspaceRoot));
  }
  if (value instanceof Date || value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      projectDurableValue(entry, workspaceRoot),
    ]),
  );
}

function portableWorkspacePath(path: string, workspaceRoot: string): string {
  const pathDialect = absolutePathDialect(path);
  if (pathDialect === undefined) {
    return path.replaceAll("\\", "/");
  }
  if (absolutePathDialect(workspaceRoot) !== pathDialect) {
    return "<external-workspace>";
  }
  const pathApi = pathDialect === "windows" ? win32 : posix;
  const workspaceRelative = pathApi.relative(
    pathApi.resolve(normalizeAbsolutePath(workspaceRoot, pathDialect)),
    pathApi.resolve(normalizeAbsolutePath(path, pathDialect)),
  );
  if (workspaceRelative === "") {
    return ".";
  }
  if (
    pathApi.isAbsolute(workspaceRelative)
    || workspaceRelative === ".."
    || workspaceRelative.startsWith(`..${pathApi.sep}`)
  ) {
    return "<external-workspace>";
  }
  return workspaceRelative.split(pathApi.sep).join("/");
}

function redactWorkspaceReferences(value: string, workspaceRoot: string): string {
  const pattern = createWorkspaceRootReferencePattern(workspaceRoot);
  return pattern === undefined ? value : value.replace(pattern, ".");
}

export function createWorkspaceRootReferencePattern(workspaceRoot: string): RegExp | undefined {
  const dialect = absolutePathDialect(workspaceRoot);
  if (dialect === undefined) {
    return undefined;
  }
  const normalizedRoot = normalizeAbsolutePath(workspaceRoot, dialect).replaceAll("\\", "/");
  const canonical = normalizedRoot === "/" || /^[A-Za-z]:\/$/u.test(normalizedRoot)
    ? normalizedRoot
    : normalizedRoot.replace(/\/+$/gu, "");
  let rootSource: string;
  if (dialect === "windows" && /^[A-Za-z]:\//u.test(canonical)) {
    const drive = canonical.slice(0, 2);
    const segments = canonical.slice(3).split("/").filter(Boolean);
    rootSource = `(?:[\\\\/]{2}\\?[\\\\/])?${escapeRegExp(drive)}${
      segments.map((segment) => `[\\\\/]${escapeRegExp(segment)}`).join("")
    }`;
  } else if (dialect === "windows" && canonical.startsWith("//")) {
    const segments = canonical.slice(2).split("/").filter(Boolean);
    rootSource = `[\\\\/]{2}(?:\\?[\\\\/]UNC[\\\\/])?${
      segments.map((segment, index) =>
        `${index === 0 ? "" : "[\\\\/]"}${escapeRegExp(segment)}`
      ).join("")
    }`;
  } else {
    const segments = canonical.slice(1).split("/").filter(Boolean);
    rootSource = `[\\\\/]${segments.map((segment, index) =>
      `${index === 0 ? "" : "[\\\\/]"}${escapeRegExp(segment)}`
    ).join("")}`;
  }
  const boundary = String.raw`(?=$|[\\/]|[^\p{L}\p{N}._-]|[.](?:$|[^\p{L}\p{N}_-]))`;
  return new RegExp(`${rootSource}${boundary}`, dialect === "windows" ? "giu" : "gu");
}

function normalizeAbsolutePath(value: string, dialect: "windows" | "posix"): string {
  if (dialect === "posix") {
    return posix.normalize(value.replaceAll("\\", "/"));
  }
  const windowsPath = value.replaceAll("/", "\\");
  if (/^\\\\\?\\UNC\\/iu.test(windowsPath)) {
    return win32.normalize(`\\\\${windowsPath.slice("\\\\?\\UNC\\".length)}`);
  }
  if (/^\\\\\?\\/u.test(windowsPath)) {
    return win32.normalize(windowsPath.slice("\\\\?\\".length));
  }
  return win32.normalize(windowsPath);
}

function absolutePathDialect(value: string): "windows" | "posix" | undefined {
  if (
    /^[A-Za-z]:[\\/]/u.test(value)
    || /^[\\/]{2}\?[\\/](?:UNC[\\/])?[A-Za-z]:?[\\/]/iu.test(value)
    || /^[\\/]{2}(?:\?[\\/]UNC[\\/])?[^\\/]+[\\/][^\\/]+/iu.test(value)
  ) {
    return "windows";
  }
  return value.startsWith("/") ? "posix" : undefined;
}

function makeSource(): SessionEventSource {
  return {
    actor: "runtime",
    surface: "runtime",
    component: "managed-invocation",
  };
}
