import type {
  OperatorManagedAgentExternalRuntimeAttachmentIdentity,
  OperatorManagedAgentResourceLeaseSnapshot,
  OperatorManagedEconomicAccountIdentity,
  OperatorManagedEconomicAmount,
  OperatorManagedEconomicBillingClass,
  OperatorManagedEconomicChildConsumption,
  OperatorManagedEconomicRejection,
  OperatorManagedEconomicEvidenceAuthority,
  OperatorManagedEconomicLifecycleTransition,
  OperatorManagedEconomicRouteIdentity,
  OperatorManagedEconomicProviderAllowance,
  OperatorManagedEconomicProviderAllowanceBucket,
  OperatorManagedEconomicSelectionReason,
  OperatorManagedEconomicSettlementKind,
  OperatorManagedEconomicTargetExplanation,
  OperatorManagedEconomicTerminalCause,
  OperatorManagedEconomicWorkLimitProgress,
  OperatorSessionEvent,
  OperatorSessionEventKind,
} from "./frames.js";
import type {
  OperatorEventTone,
} from "./operator-event-presentation.js";
import type { ToolResultResourceLinkPresentation } from "./operator-tool-result.js";
import {
  presentOperatorSessionEvent,
} from "./operator-event-presentation.js";
import type {
  OperatorCockpitActionTarget,
  OperatorGatewayTargetIdentity,
} from "./operator-cockpit-target.js";
import {
  OperatorGatewayTargetIdentitySchema,
} from "./operator-cockpit-target.js";
import {
  projectOperatorGovernedWorkItemSnapshot,
} from "./operator-governed-work.js";

export const OPERATOR_COCKPIT_ATTACH_TARGET_KINDS = [
  "local",
  "remote",
  "simulated-remote",
  "team",
  "cloud",
  "ci",
] as const;

export type OperatorCockpitAttachTargetKind = typeof OPERATOR_COCKPIT_ATTACH_TARGET_KINDS[number];

export interface OperatorCockpitAttachTarget {
  readonly instanceId: string;
  readonly label: string;
  readonly kind: OperatorCockpitAttachTargetKind;
  readonly gatewayUrl?: string;
  readonly gatewayTarget?: OperatorGatewayTargetIdentity;
}

export type OperatorCockpitAttachConnectionKind =
  | "operator-gateway"
  | "app-gateway"
  | "simulated-app-gateway";

export type OperatorCockpitAttachTransport =
  | "http-ws"
  | "simulated-http-ws";

export interface OperatorCockpitReadOnlyAttachPlanInput {
  readonly plannedAt: string;
  readonly attachTargets: readonly OperatorCockpitAttachTarget[];
}

export interface OperatorCockpitReadOnlyAttachPlanTarget {
  readonly instanceId: string;
  readonly label: string;
  readonly kind: OperatorCockpitAttachTargetKind;
  readonly gatewayTarget: OperatorGatewayTargetIdentity;
  readonly gatewayUrl: string;
  readonly connectionKind: OperatorCockpitAttachConnectionKind;
  readonly transport: OperatorCockpitAttachTransport;
  readonly connectionState: "planned";
  readonly mutationDispatch: "disabled";
}

export interface OperatorCockpitReadOnlyAttachPlan {
  readonly mode: "read-only";
  readonly plannedAt: string;
  readonly targetCount: number;
  readonly mutationDispatch: "disabled";
  readonly targets: readonly OperatorCockpitReadOnlyAttachPlanTarget[];
}

export interface OperatorCockpitReadOnlyProjectionInput {
  readonly projectedAt: string;
  readonly attachTargets: readonly OperatorCockpitAttachTarget[];
  readonly events: readonly OperatorSessionEvent[];
}

export interface NormalizeManagedAgentOperatorEventsOptions {
  readonly defaultInstanceId: string;
}

export interface ManagedAgentOperatorReplayEnvelope {
  readonly eventId: string;
  readonly kilnSessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly kind: string;
  readonly turnId?: string;
  readonly parentEventId?: string;
  readonly source?: OperatorSessionEvent["source"];
  readonly payload: Record<string, unknown>;
}

export interface OperatorCockpitInstanceProjection {
  readonly instanceId: string;
  readonly label: string;
  readonly kind: OperatorCockpitAttachTargetKind;
  readonly gatewayTarget: OperatorGatewayTargetIdentity;
  readonly gatewayUrl?: string;
  readonly sessionCount: number;
  readonly eventCount: number;
  readonly managedInvocationCount: number;
  readonly toolCallCount: number;
  readonly resourceLinkCount: number;
  readonly totalCostUsd: number;
}

export interface OperatorCockpitSessionProjection {
  readonly instanceId: string;
  readonly sessionId: string;
  readonly target: OperatorCockpitActionTarget;
  readonly eventCount: number;
  readonly managedInvocationCount: number;
  readonly toolCallCount: number;
  readonly resourceLinkCount: number;
  readonly totalCostUsd: number;
  readonly authority: string;
  readonly latestEventId: string;
  readonly latestEventTitle: string;
}

export interface OperatorCockpitResourceLinkProjection {
  readonly uri: string;
  readonly title?: string;
  readonly label?: string;
  readonly sequence?: number;
  readonly mimeType?: string;
  readonly size?: number;
  readonly relation?: string;
  readonly target: OperatorCockpitActionTarget;
}

export interface OperatorCockpitTimelineEntry {
  readonly eventId: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly kind: OperatorSessionEvent["kind"];
  readonly target: OperatorCockpitActionTarget;
  readonly title: string;
  readonly compactText: string;
  readonly tone: OperatorEventTone;
  readonly resourceLinks?: readonly OperatorCockpitResourceLinkProjection[];
}

export type OperatorCockpitInvocationStatus =
  | "requested"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export interface OperatorCockpitInvocationProjection {
  readonly managedInvocationId: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly target: OperatorCockpitActionTarget;
  readonly status: OperatorCockpitInvocationStatus;
  readonly lifecycleState?: string;
  readonly parentTurnId?: string;
  readonly childSessionId?: string;
  readonly childTurnId?: string;
  readonly routeId?: string;
  readonly routeSource?: string;
  readonly providerRoute?: string;
  readonly externalRuntimeAttachment?: OperatorManagedAgentExternalRuntimeAttachmentIdentity;
  readonly timeoutMs?: number;
  readonly timeoutSource?: string;
  readonly resourceLease?: OperatorCockpitInvocationResourceLeaseProjection;
  readonly accountLease?: OperatorCockpitInvocationAccountLeaseProjection;
  readonly transcript?: OperatorCockpitInvocationTranscriptProjection;
  readonly resultHandoff?: OperatorCockpitInvocationResultHandoffProjection;
  readonly managedInvocationRecovery?: OperatorCockpitManagedInvocationRecoveryProjection;
  readonly managedInvocationPhaseCompletion?: OperatorCockpitManagedInvocationPhaseCompletionProjection;
  readonly adoptionGate?: OperatorCockpitManagedOrchestrationAdoptionGateProjection;
  readonly promptAdmissionCount: number;
  readonly latestPromptAdmission?: OperatorCockpitInvocationPromptAdmissionProjection;
  readonly diagnosticPointers: readonly OperatorCockpitInvocationDiagnosticPointerProjection[];
  readonly sourceResourceUris: readonly string[];
  readonly evidenceResourceUris: readonly string[];
  readonly eventCount: number;
  readonly latestEventId: string;
  readonly title: string;
}

export interface OperatorCockpitInvocationPromptAdmissionProjection {
  readonly promptAdmissionId: string;
  readonly deliveryMode: "steer" | "queue";
  readonly deliveryState?: "available" | "queued" | "delivered" | "stale";
  readonly admissionState: "admitted";
  readonly inputSummary: string;
  readonly promptHash: string;
  readonly wakeRequested: boolean;
  readonly recovery?: {
    readonly reason: string;
    readonly recoveredAt: string;
    readonly eventId: string;
  };
  readonly eventId: string;
  readonly sequence: number;
  readonly timestamp: string;
}

export interface OperatorCockpitManagedInvocationRecoveryProjection {
  readonly status?: string;
  readonly reason?: string;
  readonly nextTool?: string;
  readonly thenTool?: string;
  readonly workItemId?: string;
  readonly evidenceToRecord: readonly string[];
  readonly requiredToolNames: readonly string[];
  readonly sourceResourceUris: readonly string[];
  readonly inspectionTool?: string;
  readonly blockedWorkItemUpdateInputTemplate?: Record<string, unknown>;
  readonly blockedWhen?: string;
}

export interface OperatorCockpitManagedInvocationPhaseCompletionProjection {
  readonly status?: string;
  readonly reason?: string;
  readonly nextTool?: string;
  readonly thenTool?: string;
  readonly workItemId?: string;
  readonly evidenceToRecord: readonly string[];
  readonly requiredToolNames: readonly string[];
  readonly sourceResourceUris: readonly string[];
}

interface ManagedInvocationPhaseActionFields {
  readonly status?: string;
  readonly reason?: string;
  readonly nextTool?: string;
  readonly thenTool?: string;
  readonly workItemId?: string;
  readonly evidenceToRecord: readonly string[];
  readonly requiredToolNames: readonly string[];
  readonly sourceResourceUris: readonly string[];
  readonly inspectionTool?: string;
}

export interface OperatorCockpitInvocationTranscriptProjection {
  readonly uri: string;
  readonly redacted?: boolean | "unknown";
  readonly truncated?: boolean | "unknown";
  readonly persisted?: boolean | "unknown";
  readonly retention?: "session" | "durable" | "external" | "unknown";
  readonly format?: string;
  readonly redaction?: string;
}

export interface OperatorCockpitInvocationResultHandoffProjection {
  readonly summary?: string;
  readonly resourceUris: readonly string[];
  readonly memoryWriteProposalUris: readonly string[];
}

export type OperatorCockpitManagedOrchestrationAdoptionGateStatus =
  | "not_required"
  | "pending_review"
  | "adopted"
  | "rejected"
  | "blocked";

export interface OperatorCockpitManagedOrchestrationAdoptionGateRejectionProjection {
  readonly gate: string;
  readonly summary?: string;
  readonly evidence: readonly string[];
  readonly completedAt?: string;
}

export interface OperatorCockpitManagedOrchestrationAdoptionGateProjection {
  readonly required: boolean;
  readonly status: OperatorCockpitManagedOrchestrationAdoptionGateStatus;
  readonly target?: string;
  readonly reason?: string;
  readonly orchestrationId?: string;
  readonly childId?: string;
  readonly mergePolicyMode?: string;
  readonly adoptedBy?: string;
  readonly adoptedAt?: string;
  readonly resourceUris: readonly string[];
  readonly rejection?: OperatorCockpitManagedOrchestrationAdoptionGateRejectionProjection;
  readonly blockingEvidence: readonly string[];
}

export interface OperatorCockpitInvocationDiagnosticPointerProjection {
  readonly uri: string;
  readonly kind?: "timeout" | "failure" | "adapter" | "cleanup";
}

export interface OperatorCockpitInvocationResourceLeaseProjection {
  readonly leaseId: string;
  readonly createdAt: string;
  readonly healthStatus: OperatorManagedAgentResourceLeaseSnapshot["healthStatus"];
  readonly cleanupStatus: OperatorManagedAgentResourceLeaseSnapshot["cleanupStatus"];
  readonly workingDirectoryPath: string;
  readonly workingDirectoryMode: OperatorManagedAgentResourceLeaseSnapshot["workingDirectoryMode"];
  readonly resourceUris: readonly string[];
  readonly diagnosticUris: readonly string[];
  readonly worktreeReview?: OperatorManagedAgentResourceLeaseSnapshot["worktreeReview"];
  readonly worktreeConflict?: OperatorManagedAgentResourceLeaseSnapshot["worktreeConflict"];
}

export interface OperatorCockpitInvocationAccountLeaseProjection {
  readonly leaseId: string;
  readonly accountPolicyId: string;
  readonly accountRef: string;
  readonly route: {
    readonly providerId: string;
    readonly providerModelId: string;
    readonly scope: string;
  };
  readonly jobId: string;
  readonly runtimeInvocationId: string;
  readonly credentialRevisionId: string;
  readonly selectionReason: string;
  readonly candidateRejections: readonly {
    readonly accountRef: string;
    readonly reason: string;
  }[];
  readonly usageEvidence?: {
    readonly health: "healthy" | "unhealthy";
    readonly freshness: "fresh" | "stale" | "missing";
    readonly availability?: "available" | "exhausted" | "unknown";
    readonly observedAt?: string;
    readonly validUntil?: string;
    readonly source?: "provider-endpoint" | "provider-response-headers" | "unknown";
    readonly confidence?: "authoritative" | "unknown";
  };
  readonly affinityOutcome?: string;
  readonly affinityCommitOutcome?: "won" | "already-matched" | "conflict";
  readonly acquiredAt: string;
  readonly lifecycleState: "held" | "settlement-pending" | "released" | "release-failed" | "leaked";
  readonly releasedAt?: string;
  readonly resourceUris: readonly string[];
  readonly diagnosticUris: readonly string[];
}

export type OperatorCockpitToolStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "unknown";

export interface OperatorCockpitToolSummaryProjection {
  readonly toolCallId: string;
  readonly toolCallScopeId: string;
  readonly toolName: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly target: OperatorCockpitActionTarget;
  readonly status: OperatorCockpitToolStatus;
  readonly eventCount: number;
  readonly resourceLinkCount: number;
  readonly resourceLinks: readonly OperatorCockpitResourceLinkProjection[];
  readonly externalFailure?: OperatorCockpitExternalToolFailureProjection;
  readonly latestEventId: string;
}

export interface OperatorCockpitExternalToolFailureProjection {
  readonly selector: string;
  readonly category: string;
  readonly attachment?: OperatorManagedAgentExternalRuntimeAttachmentIdentity;
  readonly diagnostic: string;
  readonly redacted: boolean;
  readonly blocked: boolean;
}

export interface OperatorCockpitCostProjection {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalUsd: number;
  readonly providerRoutes: readonly string[];
}

/**
 * Projected independently of `OperatorCockpitInvocationProjection`: a
 * `managed_economic_lifecycle` event's `jobId` has no durable join key back to a specific
 * managed-agent invocation today (jobId is a digest of session/turn/tool-call identity computed
 * independently in Runtime). Nesting this under an invocation would be a fabricated link, so it
 * is kept as its own top-level collection until Runtime carries an explicit join.
 */
export interface OperatorCockpitEconomicAttemptProjection {
  readonly jobId: string;
  readonly economicAttemptId: string;
  /** Best-effort cross-reference to a managed-agent invocation; absent on older events. */
  readonly invocationId?: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly parentTurnId?: string;
  readonly policyId: string;
  readonly policyRevision: string;
  readonly policyDigest: string;
  readonly transition: OperatorManagedEconomicLifecycleTransition;
  readonly commitmentId?: string;
  readonly reservationId?: string;
  readonly dispatchFenceId?: string;
  readonly selectedRoute?: OperatorManagedEconomicRouteIdentity;
  readonly selectedAccount?: OperatorManagedEconomicAccountIdentity;
  readonly selectedTarget?: OperatorManagedEconomicTargetExplanation;
  readonly billingClass?: OperatorManagedEconomicBillingClass;
  readonly providerAllowance?: OperatorManagedEconomicProviderAllowance;
  readonly workLimitProgress?: OperatorManagedEconomicWorkLimitProgress;
  readonly reservedAmount?: OperatorManagedEconomicAmount;
  readonly settledAmount?: OperatorManagedEconomicAmount;
  readonly perChildConsumption?: readonly OperatorManagedEconomicChildConsumption[];
  readonly evidenceFreshness?: "fresh" | "stale" | "missing" | "unknown";
  readonly terminalCause?: OperatorManagedEconomicTerminalCause;
  readonly settlementKind?: OperatorManagedEconomicSettlementKind;
  readonly settlementAuthority?: OperatorManagedEconomicEvidenceAuthority;
  readonly reason?: string;
  readonly rejections?: readonly OperatorManagedEconomicRejection[];
  readonly eventCount: number;
  readonly latestEventId: string;
}

/**
 * Why an event contributed no evidence to the projection.
 *
 * This projection recognizes three dispositions for an ingested event, and only the middle one
 * needed a name:
 *
 * 1. **Unplaceable** - the event carries no usable instance identity, or names an unattached
 *    instance. The whole projection is untrustworthy, so it throws (see `readRequiredString`).
 * 2. **Rejected** - the event is placeable, declares a recognized kind, and then violates that
 *    kind's own contract. It is recorded here and stays visible to the operator.
 * 3. **Not applicable** - the event carries no evidence of a given class, or is of a kind this
 *    projection does not fold. It is ignored by design and is not a rejection.
 *
 * Before this contract existed, 2 and 3 were both an unnamed `null` and were indistinguishable,
 * so a malformed event silently reduced the projection with no operator-visible trace.
 */
export type OperatorCockpitEvidenceRejectionReason =
  | "missing-required-field"
  | "invalid-discriminator"
  | "unsupported-version"
  | "contract-violation";

export interface OperatorCockpitEvidenceRejection {
  readonly eventId: string;
  readonly sequence: number;
  readonly kind: OperatorSessionEventKind;
  readonly reason: OperatorCockpitEvidenceRejectionReason;
  /**
   * The offending field's name. The offending *value* is never carried: this type is projected to
   * every operator surface, so echoing the payload would defeat the sanitization it exists to make
   * provable.
   */
  readonly field?: string;
}

export interface OperatorCockpitReadOnlyProjection {
  readonly mode: "read-only";
  readonly projectedAt: string;
  readonly instances: readonly OperatorCockpitInstanceProjection[];
  readonly sessions: readonly OperatorCockpitSessionProjection[];
  readonly timeline: readonly OperatorCockpitTimelineEntry[];
  readonly invocations: readonly OperatorCockpitInvocationProjection[];
  readonly toolSummaries: readonly OperatorCockpitToolSummaryProjection[];
  readonly economicAttempts: readonly OperatorCockpitEconomicAttemptProjection[];
  /**
   * Evidence this projection ingested but could not fold. Non-empty means the projection is a
   * degraded view of the session and every operator surface must say so: a cockpit that silently
   * under-reports is worse than one that reports its own gaps.
   */
  readonly unprojectableEvidence: readonly OperatorCockpitEvidenceRejection[];
  readonly cost: OperatorCockpitCostProjection;
}

interface InstanceAccumulator {
  readonly target: OperatorCockpitAttachTarget;
  readonly sessions: Set<string>;
  readonly invocations: Set<string>;
  readonly tools: Set<string>;
  readonly resourceLinks: Set<string>;
  eventCount: number;
  totalCostUsd: number;
}

interface SessionAccumulator {
  readonly instanceId: string;
  readonly sessionId: string;
  readonly invocations: Set<string>;
  readonly tools: Set<string>;
  readonly resourceLinks: Set<string>;
  eventCount: number;
  totalCostUsd: number;
  authority: string;
  latestEventId: string;
  latestEventTitle: string;
}

interface InvocationAccumulator {
  readonly managedInvocationId: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly target: OperatorCockpitActionTarget;
  readonly diagnosticPointers: Map<string, OperatorCockpitInvocationDiagnosticPointerProjection>;
  readonly sourceResourceUris: Set<string>;
  readonly evidenceResourceUris: Set<string>;
  status: OperatorCockpitInvocationStatus;
  lifecycleState?: string;
  parentTurnId?: string;
  childSessionId?: string;
  childTurnId?: string;
  routeId?: string;
  routeSource?: string;
  providerRoute?: string;
  externalRuntimeAttachment?: OperatorManagedAgentExternalRuntimeAttachmentIdentity;
  timeoutMs?: number;
  timeoutSource?: string;
  resourceLease?: OperatorCockpitInvocationResourceLeaseProjection;
  accountLease?: OperatorCockpitInvocationAccountLeaseProjection;
  transcript?: OperatorCockpitInvocationTranscriptProjection;
  resultHandoff?: OperatorCockpitInvocationResultHandoffProjection;
  managedInvocationRecovery?: OperatorCockpitManagedInvocationRecoveryProjection;
  managedInvocationPhaseCompletion?: OperatorCockpitManagedInvocationPhaseCompletionProjection;
  adoptionGate?: OperatorCockpitManagedOrchestrationAdoptionGateProjection;
  readonly promptAdmissions: Map<string, OperatorCockpitInvocationPromptAdmissionProjection>;
  eventCount: number;
  latestEventId: string;
  title: string;
}

interface EconomicAttemptAccumulator {
  readonly jobId: string;
  readonly instanceId: string;
  readonly sessionId: string;
  economicAttemptId: string;
  invocationId?: string;
  parentTurnId?: string;
  policyId: string;
  policyRevision: string;
  policyDigest: string;
  transition: OperatorManagedEconomicLifecycleTransition;
  commitmentId?: string;
  reservationId?: string;
  dispatchFenceId?: string;
  selectedRoute?: OperatorManagedEconomicRouteIdentity;
  selectedAccount?: OperatorManagedEconomicAccountIdentity;
  selectedTarget?: OperatorManagedEconomicTargetExplanation;
  billingClass?: OperatorManagedEconomicBillingClass;
  providerAllowance?: OperatorManagedEconomicProviderAllowance;
  workLimitProgress?: OperatorManagedEconomicWorkLimitProgress;
  reservedAmount?: OperatorManagedEconomicAmount;
  settledAmount?: OperatorManagedEconomicAmount;
  perChildConsumption?: readonly OperatorManagedEconomicChildConsumption[];
  evidenceFreshness?: "fresh" | "stale" | "missing" | "unknown";
  terminalCause?: OperatorManagedEconomicTerminalCause;
  settlementKind?: OperatorManagedEconomicSettlementKind;
  settlementAuthority?: OperatorManagedEconomicEvidenceAuthority;
  reason?: string;
  rejections?: readonly OperatorManagedEconomicRejection[];
  eventCount: number;
  latestEventId: string;
}

interface ToolAccumulator {
  readonly toolCallId: string;
  readonly toolCallScopeId: string;
  readonly toolName: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly target: OperatorCockpitActionTarget;
  readonly resourceLinks: Map<string, OperatorCockpitResourceLinkProjection>;
  externalFailure?: OperatorCockpitExternalToolFailureProjection;
  status: OperatorCockpitToolStatus;
  eventCount: number;
  latestEventId: string;
}

interface ManagedAgentToolReplayState extends NormalizeManagedAgentOperatorEventsOptions {
  readonly terminalInvocationPriorities: Map<string, number>;
  readonly replayedInvocationEventKeys: Set<string>;
}

const CANONICAL_MANAGED_AGENT_REPLAY_PRIORITY = Number.POSITIVE_INFINITY;
const MANAGED_AGENT_LIST_REPLAY_PRIORITY = 10;
const MANAGED_AGENT_TOOL_REPLAY_PRIORITY = 20;
const MANAGED_AGENT_JOIN_REPLAY_PRIORITY = 30;

export function createOperatorCockpitReadOnlyAttachPlan(
  input: OperatorCockpitReadOnlyAttachPlanInput,
): OperatorCockpitReadOnlyAttachPlan {
  createAttachTargetMap(input.attachTargets);

  const targets = input.attachTargets.map((target) => ({
    instanceId: target.instanceId,
    label: target.label,
    kind: target.kind,
    gatewayTarget: normalizeGatewayTargetIdentity(target),
    gatewayUrl: readAttachGatewayUrl(target),
    connectionKind: connectionKindForAttachTarget(target),
    transport: target.kind === "simulated-remote" ? "simulated-http-ws" : "http-ws",
    connectionState: "planned",
    mutationDispatch: "disabled",
  } satisfies OperatorCockpitReadOnlyAttachPlanTarget));

  return {
    mode: "read-only",
    plannedAt: input.plannedAt,
    targetCount: targets.length,
    mutationDispatch: "disabled",
    targets,
  };
}

export function projectOperatorCockpitReadOnlyView(
  input: OperatorCockpitReadOnlyProjectionInput,
): OperatorCockpitReadOnlyProjection {
  const attachTargets = createAttachTargetMap(input.attachTargets);
  const instances = new Map<string, InstanceAccumulator>();
  for (const target of input.attachTargets) {
    instances.set(target.instanceId, {
      target,
      sessions: new Set<string>(),
      invocations: new Set<string>(),
      tools: new Set<string>(),
      resourceLinks: new Set<string>(),
      eventCount: 0,
      totalCostUsd: 0,
    });
  }

  const sessions = new Map<string, SessionAccumulator>();
  const invocations = new Map<string, InvocationAccumulator>();
  const adoptionGates = new Map<string, OperatorCockpitManagedOrchestrationAdoptionGateProjection>();
  const tools = new Map<string, ToolAccumulator>();
  const economicAttempts = new Map<string, EconomicAttemptAccumulator>();
  const unprojectableEvidence: OperatorCockpitEvidenceRejection[] = [];
  const providerRoutes = new Set<string>();
  const timeline: OperatorCockpitTimelineEntry[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let totalUsd = 0;

  for (const event of [...input.events].sort(compareEvents)) {
    const payload = asRecord(event.payload);
    const instanceId = readRequiredString(payload.instanceId, `event ${event.eventId} instanceId`);
    if (!attachTargets.has(instanceId)) {
      throw new Error(`Operator cockpit event ${event.eventId} references unattached instance ${instanceId}.`);
    }
    const instance = instances.get(instanceId);
    if (!instance) {
      throw new Error(`Operator cockpit attach target ${instanceId} was not initialized.`);
    }
    const sessionId = readString(payload.sessionId) ?? event.kilnSessionId;
    const managedInvocationId = readString(payload.managedInvocationId);
    const toolCallId = readString(payload.toolCallId);
    const toolCallScopeId = readString(payload.toolCallScopeId);
    const toolName = readString(payload.toolName);
    if (
      (event.kind === "tool_call_started" || event.kind === "tool_call_completed")
      && (!toolCallId || !toolCallScopeId)
    ) {
      throw new TypeError(`Operator cockpit tool event ${event.eventId} requires scoped tool identity.`);
    }
    const gatewayTarget = normalizeGatewayTargetIdentity(instance.target);
    const target: OperatorCockpitActionTarget = {
      gatewayTargetId: gatewayTarget.targetId,
      instanceId,
      sessionId,
      eventId: event.eventId,
      ...(managedInvocationId ? { managedInvocationId } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(toolCallScopeId ? { toolCallScopeId } : {}),
    };
    const presentation = presentOperatorSessionEvent(event);
    const costDeltaUsd = readCostDeltaUsd(payload);
    const resourceLinks = projectResourceLinks(
      presentation.toolPresentation?.resourceLinks ?? [],
      target,
    );
    const adoptionGateResult = readManagedOrchestrationAdoptionGate(payload.managedOrchestrationAdoptionGate);
    if (adoptionGateResult && isEvidenceRejection(adoptionGateResult)) {
      pushEvidenceRejection(unprojectableEvidence, event, adoptionGateResult);
    }
    const adoptionGate = adoptionGateResult && !isEvidenceRejection(adoptionGateResult) ? adoptionGateResult : null;

    instance.eventCount += 1;
    instance.sessions.add(sessionId);
    instance.totalCostUsd += costDeltaUsd;
    addResourceUris(instance.resourceLinks, resourceLinks);

    const session = getOrCreateSession(sessions, {
      instanceId,
      sessionId,
      latestEventId: event.eventId,
      latestEventTitle: presentation.title,
    });
    session.eventCount += 1;
    session.totalCostUsd += costDeltaUsd;
    session.latestEventId = event.eventId;
    session.latestEventTitle = presentation.title;
    session.authority = readAuthority(payload) ?? session.authority;
    addResourceUris(session.resourceLinks, resourceLinks);

    if (adoptionGate?.childId) {
      const adoptionKey = projectionKey(instanceId, sessionId, adoptionGate.childId);
      adoptionGates.set(adoptionKey, adoptionGate);
      const invocation = invocations.get(adoptionKey);
      if (invocation) {
        invocation.adoptionGate = adoptionGate;
        addEvidenceResourceUris(invocation, adoptionGate.resourceUris);
        addEvidenceResourceUris(invocation, adoptionGate.rejection?.evidence ?? []);
      }
    }

    if (managedInvocationId) {
      const managedInvocationKey = projectionKey(sessionId, managedInvocationId);
      const adoptionKey = projectionKey(instanceId, sessionId, managedInvocationId);
      const invocationTarget: OperatorCockpitActionTarget = {
        gatewayTargetId: gatewayTarget.targetId,
        instanceId,
        sessionId,
        eventId: event.eventId,
        managedInvocationId,
      };
      const invocation = getOrCreateInvocation(invocations, {
        managedInvocationId,
        instanceId,
        sessionId,
        target: invocationTarget,
        latestEventId: event.eventId,
        title: presentation.title,
      });
      invocation.eventCount += 1;
      invocation.latestEventId = event.eventId;
      invocation.title = presentation.title;
      invocation.lifecycleState = readString(payload.lifecycleState) ?? invocation.lifecycleState;
      invocation.parentTurnId = readString(payload.parentTurnId) ?? event.turnId ?? invocation.parentTurnId;
      invocation.childSessionId = readChildSessionId(payload) ?? invocation.childSessionId;
      invocation.childTurnId = readChildTurnId(payload) ?? invocation.childTurnId;
      invocation.routeId = readRouteId(payload) ?? invocation.routeId;
      invocation.routeSource = readRouteSource(payload) ?? invocation.routeSource;
      invocation.providerRoute = readProviderRoute(payload) ?? invocation.providerRoute;
      invocation.externalRuntimeAttachment = readExternalRuntimeAttachment(payload)
        ?? invocation.externalRuntimeAttachment;
      invocation.timeoutMs = readTimeoutMs(payload) ?? invocation.timeoutMs;
      invocation.timeoutSource = readTimeoutSource(payload) ?? invocation.timeoutSource;

      const resourceLeaseResult = readResourceLease(payload);
      if (resourceLeaseResult && isEvidenceRejection(resourceLeaseResult)) {
        pushEvidenceRejection(unprojectableEvidence, event, resourceLeaseResult);
      } else {
        invocation.resourceLease = resourceLeaseResult ?? invocation.resourceLease;
      }

      const accountLeaseResult = readAccountLease(payload);
      if (accountLeaseResult && isEvidenceRejection(accountLeaseResult)) {
        pushEvidenceRejection(unprojectableEvidence, event, accountLeaseResult);
      } else {
        invocation.accountLease = accountLeaseResult ?? invocation.accountLease;
      }

      const managedInvocationRecoveryResult = readManagedInvocationRecovery(payload.managedInvocationRecovery);
      if (managedInvocationRecoveryResult && isEvidenceRejection(managedInvocationRecoveryResult)) {
        pushEvidenceRejection(unprojectableEvidence, event, managedInvocationRecoveryResult);
      } else {
        invocation.managedInvocationRecovery = managedInvocationRecoveryResult ?? invocation.managedInvocationRecovery;
      }

      const managedInvocationPhaseCompletionResult = readManagedInvocationPhaseCompletion(payload.managedInvocationPhaseCompletion);
      if (managedInvocationPhaseCompletionResult && isEvidenceRejection(managedInvocationPhaseCompletionResult)) {
        pushEvidenceRejection(unprojectableEvidence, event, managedInvocationPhaseCompletionResult);
      } else {
        invocation.managedInvocationPhaseCompletion = managedInvocationPhaseCompletionResult
          ?? invocation.managedInvocationPhaseCompletion;
      }

      addEvidenceResourceUris(invocation, invocation.managedInvocationRecovery?.sourceResourceUris ?? []);
      addEvidenceResourceUris(invocation, invocation.managedInvocationPhaseCompletion?.sourceResourceUris ?? []);
      applyManagedInvocationEvidence(invocation, payload, event, unprojectableEvidence);
      const promptAdmissionResult = readPromptAdmission(event, payload);
      if (promptAdmissionResult && isEvidenceRejection(promptAdmissionResult)) {
        pushEvidenceRejection(unprojectableEvidence, event, promptAdmissionResult);
      } else if (promptAdmissionResult) {
        const existingPromptAdmission = invocation.promptAdmissions.get(promptAdmissionResult.promptAdmissionId);
        invocation.promptAdmissions.set(promptAdmissionResult.promptAdmissionId, existingPromptAdmission
          ? mergePromptAdmission(existingPromptAdmission, promptAdmissionResult)
          : promptAdmissionResult);
      }
      const pendingAdoptionGate = adoptionGates.get(adoptionKey);
      if (pendingAdoptionGate) {
        invocation.adoptionGate = pendingAdoptionGate;
        addEvidenceResourceUris(invocation, pendingAdoptionGate.resourceUris);
        addEvidenceResourceUris(invocation, pendingAdoptionGate.rejection?.evidence ?? []);
      }
      if (
        event.kind !== "agent_invocation_prompt_admitted" &&
        event.kind !== "agent_invocation_prompt_recovered"
      ) {
        invocation.status = readInvocationStatus(event, payload);
      }
      instance.invocations.add(managedInvocationKey);
      session.invocations.add(managedInvocationId);
    }

    if (event.kind === "managed_economic_lifecycle") {
      const core = readEconomicAttemptCore(payload);
      if ("reason" in core) {
        unprojectableEvidence.push({
          eventId: event.eventId,
          sequence: event.sequence,
          kind: event.kind,
          reason: core.reason,
          field: core.field,
        });
      } else {
        const { jobId, economicAttemptId, transition, policyId, policyRevision, policyDigest } = core;
        const attempt = getOrCreateEconomicAttempt(economicAttempts, {
          jobId,
          instanceId,
          sessionId,
          economicAttemptId,
          policyId,
          policyRevision,
          policyDigest,
          transition,
          latestEventId: event.eventId,
        });
        attempt.eventCount += 1;
        attempt.latestEventId = event.eventId;
        attempt.economicAttemptId = economicAttemptId;
        attempt.transition = transition;
        attempt.policyId = policyId;
        attempt.policyRevision = policyRevision;
        attempt.policyDigest = policyDigest;
        attempt.parentTurnId = readString(payload.parentTurnId) ?? event.turnId ?? attempt.parentTurnId;
        attempt.invocationId = readString(payload.invocationId) ?? attempt.invocationId;
        attempt.commitmentId = readString(payload.commitmentId) ?? attempt.commitmentId;
        attempt.reservationId = readString(payload.reservationId) ?? attempt.reservationId;
        attempt.dispatchFenceId = readString(payload.dispatchFenceId) ?? attempt.dispatchFenceId;
        const selectedRoute = readManagedEconomicRoute(payload.selectedRoute);
        if (isEvidenceRejection(selectedRoute)) {
          pushEvidenceRejection(unprojectableEvidence, event, selectedRoute);
        } else if (selectedRoute !== undefined) {
          attempt.selectedRoute = selectedRoute;
        }
        const selectedAccount = readManagedEconomicAccount(payload.selectedAccount);
        if (isEvidenceRejection(selectedAccount)) {
          pushEvidenceRejection(unprojectableEvidence, event, selectedAccount);
        } else if (selectedAccount !== undefined) {
          attempt.selectedAccount = selectedAccount;
        }
        const selectedTarget = readManagedEconomicSelectedTarget(payload.selectedTarget);
        if (isEvidenceRejection(selectedTarget)) {
          pushEvidenceRejection(unprojectableEvidence, event, selectedTarget);
        } else if (selectedTarget !== undefined) {
          attempt.selectedTarget = selectedTarget;
        }
        const billingClass = readManagedEconomicBillingClass(payload.billingClass);
        if (isEvidenceRejection(billingClass)) {
          pushEvidenceRejection(unprojectableEvidence, event, billingClass);
        } else if (billingClass !== undefined) {
          attempt.billingClass = billingClass;
        }
        const providerAllowance = readManagedEconomicProviderAllowance(payload.providerAllowance);
        if (isEvidenceRejection(providerAllowance)) {
          pushEvidenceRejection(unprojectableEvidence, event, providerAllowance);
        } else if (providerAllowance !== undefined) {
          attempt.providerAllowance = providerAllowance;
        }
        const workLimitProgress = readManagedEconomicWorkLimitProgress(payload.workLimitProgress);
        if (isEvidenceRejection(workLimitProgress)) {
          pushEvidenceRejection(unprojectableEvidence, event, workLimitProgress);
        } else if (workLimitProgress !== undefined) {
          attempt.workLimitProgress = workLimitProgress;
        }
        const reservedAmount = readManagedEconomicAmount(payload.reservedAmount, "reservedAmount");
        if (isEvidenceRejection(reservedAmount)) {
          pushEvidenceRejection(unprojectableEvidence, event, reservedAmount);
        } else if (reservedAmount !== undefined) {
          attempt.reservedAmount = reservedAmount;
        }
        const settledAmount = readManagedEconomicAmount(payload.settledAmount, "settledAmount");
        if (isEvidenceRejection(settledAmount)) {
          pushEvidenceRejection(unprojectableEvidence, event, settledAmount);
        } else if (settledAmount !== undefined) {
          attempt.settledAmount = settledAmount;
        }
        const perChildConsumption = readManagedEconomicChildConsumption(payload.perChildConsumption);
        if (isEvidenceRejection(perChildConsumption)) {
          pushEvidenceRejection(unprojectableEvidence, event, perChildConsumption);
        } else if (perChildConsumption !== undefined) {
          attempt.perChildConsumption = mergePerChildConsumption(
            attempt.perChildConsumption,
            perChildConsumption,
          );
        }
        const evidenceFreshness = readManagedEconomicEvidenceFreshness(payload.evidenceFreshness);
        if (isEvidenceRejection(evidenceFreshness)) {
          pushEvidenceRejection(unprojectableEvidence, event, evidenceFreshness);
        } else if (evidenceFreshness !== undefined) {
          attempt.evidenceFreshness = worseEvidenceFreshness(attempt.evidenceFreshness, evidenceFreshness);
        }
        const terminalCause = readManagedEconomicTerminalCause(payload.terminalCause);
        if (isEvidenceRejection(terminalCause)) {
          pushEvidenceRejection(unprojectableEvidence, event, terminalCause);
        } else if (terminalCause !== undefined) {
          attempt.terminalCause = mergeTerminalCause(attempt.terminalCause, terminalCause);
        }
        const settlement = readManagedEconomicSettlement(payload);
        if (isEvidenceRejection(settlement)) {
          pushEvidenceRejection(unprojectableEvidence, event, settlement);
        } else if (settlement !== null) {
          attempt.settlementKind = settlement.kind;
          attempt.settlementAuthority = settlement.authority;
        }
        attempt.reason = readString(payload.reason) ?? attempt.reason;
        const rejectionsResult = readManagedEconomicRejections(payload.rejections, transition);
        if (rejectionsResult && isEvidenceRejection(rejectionsResult)) {
          pushEvidenceRejection(unprojectableEvidence, event, rejectionsResult);
        } else if (rejectionsResult !== null) {
          attempt.rejections = rejectionsResult;
        }
      }
    }

    if (toolCallId && toolCallScopeId && toolName) {
      const toolTarget: OperatorCockpitActionTarget = {
        gatewayTargetId: gatewayTarget.targetId,
        instanceId,
        sessionId,
        eventId: event.eventId,
        ...(managedInvocationId ? { managedInvocationId } : {}),
        toolCallId,
        toolCallScopeId,
      };
      const tool = getOrCreateTool(tools, {
        toolCallId,
        toolCallScopeId,
        toolName,
        instanceId,
        sessionId,
        target: toolTarget,
        latestEventId: event.eventId,
      });
      tool.eventCount += 1;
      tool.latestEventId = event.eventId;
      tool.status = readToolStatus(event, payload);
      const externalToolFailureResult = readExternalToolFailure(payload);
      if (externalToolFailureResult && isEvidenceRejection(externalToolFailureResult)) {
        pushEvidenceRejection(unprojectableEvidence, event, externalToolFailureResult);
      } else {
        tool.externalFailure = externalToolFailureResult ?? tool.externalFailure;
      }
      addResourceLinks(tool.resourceLinks, resourceLinks);
      const identityKey = projectionKey(toolCallScopeId, toolCallId);
      instance.tools.add(identityKey);
      session.tools.add(identityKey);
    }

    inputTokens += readNumber(payload.inputTokens) ?? 0;
    outputTokens += readNumber(payload.outputTokens) ?? 0;
    totalUsd += costDeltaUsd;
    const providerRoute = readProviderRoute(payload);
    if (providerRoute) {
      providerRoutes.add(providerRoute);
    }

    timeline.push({
      eventId: event.eventId,
      instanceId,
      sessionId,
      sequence: event.sequence,
      timestamp: event.timestamp,
      kind: event.kind,
      target,
      title: presentation.title,
      compactText: presentation.compactText ?? presentation.title,
      tone: presentation.tone,
      ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    });
  }

  return {
    mode: "read-only",
    projectedAt: input.projectedAt,
    instances: Array.from(instances.values()).map(projectInstance).sort(compareByInstanceId),
    sessions: Array.from(sessions.values()).map(projectSession).sort(compareByInstanceThenSession),
    timeline,
    invocations: Array.from(invocations.values()).map(projectInvocation).sort(compareByInstanceThenSessionThenInvocation),
    toolSummaries: Array.from(tools.values()).map(projectTool).sort(compareByInstanceThenSessionThenTool),
    economicAttempts: Array.from(economicAttempts.values()).map(projectEconomicAttempt).sort(compareEconomicAttempts),
    unprojectableEvidence,
    cost: {
      inputTokens,
      outputTokens,
      totalUsd,
      providerRoutes: Array.from(providerRoutes).sort(),
    },
  };
}

function createAttachTargetMap(
  targets: readonly OperatorCockpitAttachTarget[],
): ReadonlyMap<string, OperatorCockpitAttachTarget> {
  if (targets.length === 0) {
    throw new Error("Operator cockpit read-only projection requires at least one attach target.");
  }
  const byId = new Map<string, OperatorCockpitAttachTarget>();
  for (const target of targets) {
    if (target.instanceId.trim().length === 0) {
      throw new Error("Operator cockpit attach target requires instanceId.");
    }
    if (target.label.trim().length === 0) {
      throw new Error(`Operator cockpit attach target ${target.instanceId} requires label.`);
    }
    if (!isAttachTargetKind(target.kind)) {
      throw new Error(`Operator cockpit attach target ${target.instanceId} uses unsupported kind.`);
    }
    if (byId.has(target.instanceId)) {
      throw new Error(`Operator cockpit attach target ${target.instanceId} is duplicated.`);
    }
    byId.set(target.instanceId, target);
  }
  return byId;
}

function isAttachTargetKind(value: unknown): value is OperatorCockpitAttachTargetKind {
  return typeof value === "string"
    && OPERATOR_COCKPIT_ATTACH_TARGET_KINDS.includes(value as OperatorCockpitAttachTargetKind);
}

function readAttachGatewayUrl(target: OperatorCockpitAttachTarget): string {
  const gatewayUrl = target.gatewayUrl?.trim();
  if (!gatewayUrl) {
    throw new Error(`Operator cockpit attach target ${target.instanceId} requires gatewayUrl.`);
  }

  const parsed = parseGatewayUrl(gatewayUrl, target.instanceId);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Operator cockpit attach target ${target.instanceId} gatewayUrl must use http:// or https://.`);
  }
  return gatewayUrl;
}

function parseGatewayUrl(value: string, instanceId: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Operator cockpit attach target ${instanceId} gatewayUrl must be a valid URL.`);
  }
}

function connectionKindForAttachTarget(
  target: OperatorCockpitAttachTarget,
): OperatorCockpitAttachConnectionKind {
  const gatewayTarget = normalizeGatewayTargetIdentity(target);
  if (gatewayTarget.kind === "local-operator-gateway") return "operator-gateway";
  if (gatewayTarget.kind === "simulated-app-gateway") return "simulated-app-gateway";
  return "app-gateway";
}

function normalizeGatewayTargetIdentity(
  target: OperatorCockpitAttachTarget,
): OperatorGatewayTargetIdentity {
  if (target.gatewayTarget) {
    return OperatorGatewayTargetIdentitySchema.parse({
      ...target.gatewayTarget,
      label: target.gatewayTarget.label ?? target.label,
      gatewayUrl: target.gatewayTarget.gatewayUrl ?? target.gatewayUrl,
    });
  }

  if (target.kind === "local") {
    return {
      targetId: target.instanceId,
      kind: "local-operator-gateway",
      trust: "local",
      label: target.label,
      gatewayUrl: target.gatewayUrl,
    };
  }

  if (target.kind === "simulated-remote") {
    return {
      targetId: target.instanceId,
      kind: "simulated-app-gateway",
      trust: "simulated",
      label: target.label,
      gatewayUrl: target.gatewayUrl,
    };
  }

  return {
    targetId: target.instanceId,
    kind: "remote-app-gateway",
    trust: "remote",
    label: target.label,
    gatewayUrl: target.gatewayUrl,
  };
}

function getOrCreateSession(
  sessions: Map<string, SessionAccumulator>,
  input: {
    readonly instanceId: string;
    readonly sessionId: string;
    readonly latestEventId: string;
    readonly latestEventTitle: string;
  },
): SessionAccumulator {
  const key = projectionKey(input.instanceId, input.sessionId);
  const existing = sessions.get(key);
  if (existing) return existing;
  const created: SessionAccumulator = {
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    invocations: new Set<string>(),
    tools: new Set<string>(),
    resourceLinks: new Set<string>(),
    eventCount: 0,
    totalCostUsd: 0,
    authority: "unknown",
    latestEventId: input.latestEventId,
    latestEventTitle: input.latestEventTitle,
  };
  sessions.set(key, created);
  return created;
}

function getOrCreateInvocation(
  invocations: Map<string, InvocationAccumulator>,
  input: {
    readonly managedInvocationId: string;
    readonly instanceId: string;
    readonly sessionId: string;
    readonly target: OperatorCockpitActionTarget;
    readonly latestEventId: string;
    readonly title: string;
  },
): InvocationAccumulator {
  const key = projectionKey(input.instanceId, input.sessionId, input.managedInvocationId);
  const existing = invocations.get(key);
  if (existing) return existing;
  const created: InvocationAccumulator = {
    managedInvocationId: input.managedInvocationId,
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    target: input.target,
    diagnosticPointers: new Map<string, OperatorCockpitInvocationDiagnosticPointerProjection>(),
    sourceResourceUris: new Set<string>(),
    evidenceResourceUris: new Set<string>(),
    promptAdmissions: new Map<string, OperatorCockpitInvocationPromptAdmissionProjection>(),
    status: "unknown",
    eventCount: 0,
    latestEventId: input.latestEventId,
    title: input.title,
  };
  invocations.set(key, created);
  return created;
}

function readManagedEconomicTransition(
  value: unknown,
): OperatorManagedEconomicLifecycleTransition | null {
  return value === "denied"
    || value === "held"
    || value === "dispatch-fenced"
    || value === "settlement-pending"
    || value === "released"
    || value === "release-failed"
    || value === "leaked"
    ? value
    : null;
}

interface EconomicAttemptCore {
  readonly jobId: string;
  readonly economicAttemptId: string;
  readonly transition: OperatorManagedEconomicLifecycleTransition;
  readonly policyId: string;
  readonly policyRevision: string;
  readonly policyDigest: string;
}

interface EconomicAttemptRejectionCause {
  readonly reason: OperatorCockpitEvidenceRejectionReason;
  readonly field: string;
}

/**
 * Parses the fields a `managed_economic_lifecycle` payload declares as required. Returns the
 * offending field's name rather than discarding the event, so the caller can record a rejection:
 * economic lifecycle events are authority evidence, and an authority record that vanishes is
 * indistinguishable from one that never existed.
 */
function readEconomicAttemptCore(
  payload: Record<string, unknown>,
): EconomicAttemptCore | EconomicAttemptRejectionCause {
  if (payload.evidenceVersion === undefined) {
    return { reason: "missing-required-field", field: "evidenceVersion" };
  }
  if (typeof payload.evidenceVersion !== "number" || !Number.isInteger(payload.evidenceVersion)) {
    return { reason: "contract-violation", field: "evidenceVersion" };
  }
  if (payload.evidenceVersion !== 1) {
    return { reason: "unsupported-version", field: "evidenceVersion" };
  }
  const jobId = readString(payload.jobId);
  if (!jobId) return { reason: "missing-required-field", field: "jobId" };
  const economicAttemptId = readString(payload.economicAttemptId);
  if (!economicAttemptId) return { reason: "missing-required-field", field: "economicAttemptId" };
  const policyId = readString(payload.policyId);
  if (!policyId) return { reason: "missing-required-field", field: "policyId" };
  const policyRevision = readString(payload.policyRevision);
  if (!policyRevision) return { reason: "missing-required-field", field: "policyRevision" };
  const policyDigest = readString(payload.policyDigest);
  if (!policyDigest) return { reason: "missing-required-field", field: "policyDigest" };
  if (!readString(payload.transition)) return { reason: "missing-required-field", field: "transition" };
  const transition = readManagedEconomicTransition(payload.transition);
  if (!transition) return { reason: "invalid-discriminator", field: "transition" };
  return { jobId, economicAttemptId, transition, policyId, policyRevision, policyDigest };
}

function readManagedEconomicRejections(
  value: unknown,
  transition: OperatorManagedEconomicLifecycleTransition,
): readonly OperatorManagedEconomicRejection[] | EvidenceRejectionCause | null {
  if (value === undefined) {
    return transition === "denied"
      ? evidenceRejection("missing-required-field", "rejections")
      : null;
  }
  if (transition !== "denied" || !Array.isArray(value)) {
    return evidenceRejection("contract-violation", "rejections");
  }

  const rejections: OperatorManagedEconomicRejection[] = [];
  for (const rejection of value) {
    const record = asRecord(rejection);
    const stage = record.stage;
    if (stage === "economic-selection") {
      const routeId = readString(record.routeId);
      if (!hasOnlyKeys(record, ["stage", "routeId", "reason"])
        || !routeId || !isManagedEconomicCoreRejectionReason(record.reason)) {
        return evidenceRejection("contract-violation", "rejections");
      }
      rejections.push({ stage, routeId, reason: record.reason });
      continue;
    }
    if (stage === "account-selection") {
      const routeId = readString(record.routeId);
      if (!hasOnlyKeys(record, ["stage", "routeId", "reason", "count"])
        || !routeId || !isManagedEconomicAccountSelectionRejectionReason(record.reason)
        || !isPositiveInteger(record.count)) {
        return evidenceRejection("contract-violation", "rejections");
      }
      rejections.push({ stage, routeId, reason: record.reason, count: record.count });
      continue;
    }
    if (stage === "local-capacity") {
      const routeId = readString(record.routeId);
      if (!hasOnlyKeys(record, ["stage", "routeId", "reason"])
        || !routeId || !isManagedEconomicLocalCapacityRejectionReason(record.reason)) {
        return evidenceRejection("contract-violation", "rejections");
      }
      rejections.push({ stage, routeId, reason: record.reason });
      continue;
    }
    if (stage === "commitment-conflict" && hasOnlyKeys(record, ["stage", "reason"])
      && isManagedEconomicCommitmentConflictReason(record.reason)) {
      rejections.push({ stage, reason: record.reason });
      continue;
    }
    return evidenceRejection("contract-violation", "rejections");
  }
  return rejections;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isManagedEconomicCoreRejectionReason(
  value: unknown,
): value is Extract<OperatorManagedEconomicRejection, { readonly stage: "economic-selection" }>["reason"] {
  return value === "quota-evidence-missing" || value === "quota-evidence-stale"
    || value === "price-evidence-missing" || value === "price-evidence-stale"
    || value === "comparison-domain-incompatible" || value === "execution-envelope-unbounded"
    || value === "ceiling-exceeded";
}

function isManagedEconomicAccountSelectionRejectionReason(
  value: unknown,
): value is Extract<OperatorManagedEconomicRejection, { readonly stage: "account-selection" }>["reason"] {
  return value === "unhealthy" || value === "incompatible-route" || value === "reserved-for-new-work"
    || value === "lease-conflict" || value === "dispatcher-unavailable";
}

function isManagedEconomicLocalCapacityRejectionReason(
  value: unknown,
): value is Extract<OperatorManagedEconomicRejection, { readonly stage: "local-capacity" }>["reason"] {
  return value === "route-capacity-exhausted" || value === "comparison-domain-incompatible";
}

function isManagedEconomicCommitmentConflictReason(
  value: unknown,
): value is Extract<OperatorManagedEconomicRejection, { readonly stage: "commitment-conflict" }>["reason"] {
  return value === "idempotency-conflict" || value === "identity-revision-conflict";
}

function getOrCreateEconomicAttempt(
  economicAttempts: Map<string, EconomicAttemptAccumulator>,
  input: {
    readonly jobId: string;
    readonly instanceId: string;
    readonly sessionId: string;
    readonly economicAttemptId: string;
    readonly policyId: string;
    readonly policyRevision: string;
    readonly policyDigest: string;
    readonly transition: OperatorManagedEconomicLifecycleTransition;
    readonly latestEventId: string;
  },
): EconomicAttemptAccumulator {
  const key = projectionKey(input.instanceId, input.sessionId, input.jobId);
  const existing = economicAttempts.get(key);
  if (existing) return existing;
  const created: EconomicAttemptAccumulator = {
    jobId: input.jobId,
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    economicAttemptId: input.economicAttemptId,
    policyId: input.policyId,
    policyRevision: input.policyRevision,
    policyDigest: input.policyDigest,
    transition: input.transition,
    eventCount: 0,
    latestEventId: input.latestEventId,
  };
  economicAttempts.set(key, created);
  return created;
}

function getOrCreateTool(
  tools: Map<string, ToolAccumulator>,
  input: {
    readonly toolCallId: string;
    readonly toolCallScopeId: string;
    readonly toolName: string;
    readonly instanceId: string;
    readonly sessionId: string;
    readonly target: OperatorCockpitActionTarget;
    readonly latestEventId: string;
  },
): ToolAccumulator {
  const key = projectionKey(input.instanceId, input.sessionId, input.toolCallScopeId, input.toolCallId);
  const existing = tools.get(key);
  if (existing) return existing;
  const created: ToolAccumulator = {
    toolCallId: input.toolCallId,
    toolCallScopeId: input.toolCallScopeId,
    toolName: input.toolName,
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    target: input.target,
    resourceLinks: new Map<string, OperatorCockpitResourceLinkProjection>(),
    status: "unknown",
    eventCount: 0,
    latestEventId: input.latestEventId,
  };
  tools.set(key, created);
  return created;
}

function projectEconomicAttempt(input: EconomicAttemptAccumulator): OperatorCockpitEconomicAttemptProjection {
  return {
    jobId: input.jobId,
    economicAttemptId: input.economicAttemptId,
    ...(input.invocationId !== undefined ? { invocationId: input.invocationId } : {}),
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    ...(input.parentTurnId !== undefined ? { parentTurnId: input.parentTurnId } : {}),
    policyId: input.policyId,
    policyRevision: input.policyRevision,
    policyDigest: input.policyDigest,
    transition: input.transition,
    ...(input.commitmentId !== undefined ? { commitmentId: input.commitmentId } : {}),
    ...(input.reservationId !== undefined ? { reservationId: input.reservationId } : {}),
    ...(input.dispatchFenceId !== undefined ? { dispatchFenceId: input.dispatchFenceId } : {}),
    ...(input.selectedRoute !== undefined ? { selectedRoute: input.selectedRoute } : {}),
    ...(input.selectedAccount !== undefined ? { selectedAccount: input.selectedAccount } : {}),
    ...(input.selectedTarget !== undefined ? { selectedTarget: input.selectedTarget } : {}),
    ...(input.billingClass !== undefined ? { billingClass: input.billingClass } : {}),
    ...(input.providerAllowance !== undefined ? { providerAllowance: input.providerAllowance } : {}),
    ...(input.workLimitProgress !== undefined ? { workLimitProgress: input.workLimitProgress } : {}),
    ...(input.reservedAmount !== undefined ? { reservedAmount: input.reservedAmount } : {}),
    ...(input.settledAmount !== undefined ? { settledAmount: input.settledAmount } : {}),
    ...(input.perChildConsumption !== undefined ? { perChildConsumption: input.perChildConsumption } : {}),
    ...(input.evidenceFreshness !== undefined ? { evidenceFreshness: input.evidenceFreshness } : {}),
    ...(input.terminalCause !== undefined ? { terminalCause: input.terminalCause } : {}),
    ...(input.settlementKind !== undefined ? { settlementKind: input.settlementKind } : {}),
    ...(input.settlementAuthority !== undefined ? { settlementAuthority: input.settlementAuthority } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.rejections !== undefined ? { rejections: input.rejections } : {}),
    eventCount: input.eventCount,
    latestEventId: input.latestEventId,
  };
}

function compareEconomicAttempts(
  a: OperatorCockpitEconomicAttemptProjection,
  b: OperatorCockpitEconomicAttemptProjection,
): number {
  return a.instanceId === b.instanceId
    ? a.sessionId === b.sessionId
      ? a.jobId.localeCompare(b.jobId)
      : a.sessionId.localeCompare(b.sessionId)
    : a.instanceId.localeCompare(b.instanceId);
}

function projectInstance(input: InstanceAccumulator): OperatorCockpitInstanceProjection {
  return {
    instanceId: input.target.instanceId,
    label: input.target.label,
    kind: input.target.kind,
    gatewayTarget: normalizeGatewayTargetIdentity(input.target),
    gatewayUrl: input.target.gatewayUrl,
    sessionCount: input.sessions.size,
    eventCount: input.eventCount,
    managedInvocationCount: input.invocations.size,
    toolCallCount: input.tools.size,
    resourceLinkCount: input.resourceLinks.size,
    totalCostUsd: input.totalCostUsd,
  };
}

function projectSession(input: SessionAccumulator): OperatorCockpitSessionProjection {
  return {
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    target: {
      instanceId: input.instanceId,
      sessionId: input.sessionId,
    },
    eventCount: input.eventCount,
    managedInvocationCount: input.invocations.size,
    toolCallCount: input.tools.size,
    resourceLinkCount: input.resourceLinks.size,
    totalCostUsd: input.totalCostUsd,
    authority: input.authority,
    latestEventId: input.latestEventId,
    latestEventTitle: input.latestEventTitle,
  };
}

function projectInvocation(input: InvocationAccumulator): OperatorCockpitInvocationProjection {
  const latestAdmission = latestPromptAdmission(input.promptAdmissions);
  return {
    managedInvocationId: input.managedInvocationId,
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    target: input.target,
    status: input.status,
    ...(input.lifecycleState !== undefined ? { lifecycleState: input.lifecycleState } : {}),
    ...(input.parentTurnId !== undefined ? { parentTurnId: input.parentTurnId } : {}),
    ...(input.childSessionId !== undefined ? { childSessionId: input.childSessionId } : {}),
    ...(input.childTurnId !== undefined ? { childTurnId: input.childTurnId } : {}),
    ...(input.routeId !== undefined ? { routeId: input.routeId } : {}),
    ...(input.routeSource !== undefined ? { routeSource: input.routeSource } : {}),
    ...(input.providerRoute !== undefined ? { providerRoute: input.providerRoute } : {}),
    ...(input.externalRuntimeAttachment !== undefined
      ? { externalRuntimeAttachment: input.externalRuntimeAttachment }
      : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.timeoutSource !== undefined ? { timeoutSource: input.timeoutSource } : {}),
    ...(input.resourceLease !== undefined ? { resourceLease: input.resourceLease } : {}),
    ...(input.accountLease !== undefined ? { accountLease: input.accountLease } : {}),
    ...(input.transcript !== undefined ? { transcript: input.transcript } : {}),
    ...(input.resultHandoff !== undefined ? { resultHandoff: input.resultHandoff } : {}),
    ...(input.managedInvocationRecovery !== undefined ? { managedInvocationRecovery: input.managedInvocationRecovery } : {}),
    ...(input.managedInvocationPhaseCompletion !== undefined ? { managedInvocationPhaseCompletion: input.managedInvocationPhaseCompletion } : {}),
    ...(input.adoptionGate !== undefined ? { adoptionGate: input.adoptionGate } : {}),
    promptAdmissionCount: input.promptAdmissions.size,
    ...(latestAdmission !== undefined ? { latestPromptAdmission: latestAdmission } : {}),
    diagnosticPointers: Array.from(input.diagnosticPointers.values()).sort(compareDiagnosticPointers),
    sourceResourceUris: Array.from(input.sourceResourceUris).sort(),
    evidenceResourceUris: Array.from(input.evidenceResourceUris).sort(),
    eventCount: input.eventCount,
    latestEventId: input.latestEventId,
    title: input.title,
  };
}

function projectTool(input: ToolAccumulator): OperatorCockpitToolSummaryProjection {
  return {
    toolCallId: input.toolCallId,
    toolCallScopeId: input.toolCallScopeId,
    toolName: input.toolName,
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    target: input.target,
    status: input.status,
    eventCount: input.eventCount,
    resourceLinkCount: input.resourceLinks.size,
    resourceLinks: Array.from(input.resourceLinks.values()).sort(compareResourceLinks),
    ...(input.externalFailure !== undefined ? { externalFailure: input.externalFailure } : {}),
    latestEventId: input.latestEventId,
  };
}

function projectResourceLinks(
  links: readonly ToolResultResourceLinkPresentation[],
  target: OperatorCockpitActionTarget,
): readonly OperatorCockpitResourceLinkProjection[] {
  return links.map((link) => ({
    uri: link.uri,
    ...(link.title ? { title: link.title } : {}),
    ...(link.label ? { label: link.label } : {}),
    ...(link.sequence !== undefined ? { sequence: link.sequence } : {}),
    ...(link.mimeType ? { mimeType: link.mimeType } : {}),
    ...(link.size !== undefined ? { size: link.size } : {}),
    ...(link.relation ? { relation: link.relation } : {}),
    target: {
      ...target,
      resourceUri: link.uri,
    },
  }));
}

function addResourceUris(
  target: Set<string>,
  resourceLinks: readonly OperatorCockpitResourceLinkProjection[],
): void {
  for (const resourceLink of resourceLinks) {
    target.add(resourceLink.uri);
  }
}

function addResourceLinks(
  target: Map<string, OperatorCockpitResourceLinkProjection>,
  resourceLinks: readonly OperatorCockpitResourceLinkProjection[],
): void {
  for (const resourceLink of resourceLinks) {
    target.set(resourceLink.uri, resourceLink);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readRequiredString(value: unknown, field: string): string {
  const text = readString(value);
  if (!text) {
    throw new Error(`Operator cockpit projection requires ${field}.`);
  }
  return text;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readRequiredStringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length === value.length ? strings : null;
}

function readCostDeltaUsd(payload: Record<string, unknown>): number {
  const cost = asRecord(payload.cost);
  return readNumber(cost.deltaUsd) ?? readNumber(payload.deltaUsd) ?? 0;
}

function readProviderRoute(payload: Record<string, unknown>): string | null {
  const providerRoute = asRecord(payload.providerRoute);
  const provider = readString(payload.provider) ?? readString(providerRoute.providerId);
  const model = readString(payload.model) ?? readString(providerRoute.model);
  if (!provider) return null;
  return model ? `${provider}/${model}` : provider;
}

/**
 * A tier-2 evidence reader's verdict that its input is present but violates its own declared
 * shape. Distinct from the readers' plain `null`, which means "no evidence of this class was
 * offered" (tier 3, not a defect). Tagged with `__evidenceRejection` rather than discriminated by
 * the presence of a `reason` or `field` key alone, because several of the success types below
 * (recovery, phase completion, adoption gate) legitimately carry their own `reason` field.
 */
interface EvidenceRejectionCause {
  readonly __evidenceRejection: true;
  readonly reason: OperatorCockpitEvidenceRejectionReason;
  readonly field: string;
}

function evidenceRejection(
  reason: OperatorCockpitEvidenceRejectionReason,
  field: string,
): EvidenceRejectionCause {
  return { __evidenceRejection: true, reason, field };
}

function isEvidenceRejection(value: unknown): value is EvidenceRejectionCause {
  return isRecordValue(value) && value.__evidenceRejection === true;
}

function pushEvidenceRejection(
  unprojectableEvidence: OperatorCockpitEvidenceRejection[],
  event: OperatorSessionEvent,
  cause: EvidenceRejectionCause,
): void {
  unprojectableEvidence.push({
    eventId: event.eventId,
    sequence: event.sequence,
    kind: event.kind,
    reason: cause.reason,
    field: cause.field,
  });
}

function readPromptAdmission(
  event: OperatorSessionEvent,
  payload: Record<string, unknown>,
): OperatorCockpitInvocationPromptAdmissionProjection | EvidenceRejectionCause | null {
  if (
    event.kind !== "agent_invocation_prompt_admitted" &&
    event.kind !== "agent_invocation_prompt_recovered"
  ) {
    return null;
  }
  const promptAdmissionId = readString(payload.promptAdmissionId);
  if (!promptAdmissionId) {
    return evidenceRejection("missing-required-field", "promptAdmissionId");
  }
  if (payload.deliveryMode !== undefined && !readPromptDeliveryMode(payload.deliveryMode)) {
    return evidenceRejection("invalid-discriminator", "deliveryMode");
  }
  const deliveryMode = readPromptDeliveryMode(payload.deliveryMode);
  if (!deliveryMode) {
    return evidenceRejection("missing-required-field", "deliveryMode");
  }
  if (payload.deliveryState !== undefined && !readPromptDeliveryState(payload.deliveryState)) {
    return evidenceRejection("invalid-discriminator", "deliveryState");
  }
  const deliveryState = readPromptDeliveryState(payload.deliveryState);
  if (event.kind === "agent_invocation_prompt_recovered") {
    if (!deliveryState) {
      return evidenceRejection("missing-required-field", "deliveryState");
    }
    const recoveryReason = readString(payload.recoveryReason);
    if (!recoveryReason) {
      return evidenceRejection("missing-required-field", "recoveryReason");
    }
    const recoveredAt = readString(payload.recoveredAt);
    if (!recoveredAt) {
      return evidenceRejection("missing-required-field", "recoveredAt");
    }
    const recovery = {
      reason: recoveryReason,
      recoveredAt,
      eventId: event.eventId,
    };
    return {
      promptAdmissionId,
      deliveryMode,
      deliveryState,
      admissionState: "admitted",
      inputSummary: readString(payload.inputSummary) ?? "",
      promptHash: readString(payload.promptHash) ?? "",
      wakeRequested: typeof payload.wakeRequested === "boolean" ? payload.wakeRequested : false,
      recovery,
      eventId: event.eventId,
      sequence: event.sequence,
      timestamp: event.timestamp,
    };
  }
  if (payload.admissionState !== undefined && !readPromptAdmissionState(payload.admissionState)) {
    return evidenceRejection("invalid-discriminator", "admissionState");
  }
  const admissionState = readPromptAdmissionState(payload.admissionState);
  if (!admissionState) {
    return evidenceRejection("missing-required-field", "admissionState");
  }
  const inputSummary = readString(payload.inputSummary);
  if (!inputSummary) {
    return evidenceRejection("missing-required-field", "inputSummary");
  }
  const promptHash = readString(payload.promptHash);
  if (!promptHash) {
    return evidenceRejection("missing-required-field", "promptHash");
  }
  if (typeof payload.wakeRequested !== "boolean") {
    return evidenceRejection("missing-required-field", "wakeRequested");
  }
  return {
    promptAdmissionId,
    deliveryMode,
    ...(deliveryState !== null ? { deliveryState } : {}),
    admissionState,
    inputSummary,
    promptHash,
    wakeRequested: payload.wakeRequested,
    eventId: event.eventId,
    sequence: event.sequence,
    timestamp: event.timestamp,
  };
}

function readPromptDeliveryMode(value: unknown): "steer" | "queue" | null {
  return value === "steer" || value === "queue" ? value : null;
}

function readPromptDeliveryState(value: unknown): "available" | "queued" | "delivered" | "stale" | null {
  return value === "available" || value === "queued" || value === "delivered" || value === "stale" ? value : null;
}

function readPromptAdmissionState(value: unknown): "admitted" | null {
  return value === "admitted" ? value : null;
}

function latestPromptAdmission(
  admissions: ReadonlyMap<string, OperatorCockpitInvocationPromptAdmissionProjection>,
): OperatorCockpitInvocationPromptAdmissionProjection | undefined {
  return Array.from(admissions.values()).sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return right.sequence - left.sequence;
    }
    const timestampCompare = right.timestamp.localeCompare(left.timestamp);
    return timestampCompare === 0 ? right.eventId.localeCompare(left.eventId) : timestampCompare;
  })[0];
}

function mergePromptAdmission(
  existing: OperatorCockpitInvocationPromptAdmissionProjection,
  incoming: OperatorCockpitInvocationPromptAdmissionProjection,
): OperatorCockpitInvocationPromptAdmissionProjection {
  return {
    ...existing,
    ...incoming,
    inputSummary: incoming.inputSummary.length > 0 ? incoming.inputSummary : existing.inputSummary,
    promptHash: incoming.promptHash.length > 0 ? incoming.promptHash : existing.promptHash,
    wakeRequested: incoming.wakeRequested || existing.wakeRequested,
    ...(incoming.deliveryState !== undefined || existing.deliveryState !== undefined
      ? { deliveryState: incoming.deliveryState ?? existing.deliveryState }
      : {}),
    ...(incoming.recovery !== undefined || existing.recovery !== undefined
      ? { recovery: incoming.recovery ?? existing.recovery }
      : {}),
  };
}

function readRouteId(payload: Record<string, unknown>): string | null {
  const capabilitySnapshot = asRecord(payload.capabilitySnapshot);
  const evidence = asRecord(payload.managedInvocationEvidence);
  const lifecycle = asRecord(evidence.lifecycle);
  return readString(payload.routeId)
    ?? readString(capabilitySnapshot.routeId)
    ?? readString(lifecycle.routeId);
}

function readRouteSource(payload: Record<string, unknown>): string | null {
  const capabilitySnapshot = asRecord(payload.capabilitySnapshot);
  const evidence = asRecord(payload.managedInvocationEvidence);
  const lifecycle = asRecord(evidence.lifecycle);
  return readString(payload.routeSource)
    ?? readString(capabilitySnapshot.routeSource)
    ?? readString(lifecycle.routeSource);
}

function readExternalRuntimeAttachment(
  payload: Record<string, unknown>,
): OperatorManagedAgentExternalRuntimeAttachmentIdentity | null {
  const capabilitySnapshot = asRecord(payload.capabilitySnapshot);
  const evidence = asRecord(payload.managedInvocationEvidence);
  const lifecycle = asRecord(evidence.lifecycle);
  return readExternalRuntimeAttachmentValue(capabilitySnapshot.externalRuntimeAttachment)
    ?? readExternalRuntimeAttachmentValue(lifecycle.externalRuntimeAttachment);
}

function readExternalRuntimeAttachmentValue(
  value: unknown,
): OperatorManagedAgentExternalRuntimeAttachmentIdentity | null {
  const record = asRecord(value);
  const runtimeId = readString(record.runtimeId);
  const attachmentId = readString(record.attachmentId);
  if (record.kind !== "external-runtime" || !runtimeId || !attachmentId) {
    return null;
  }
  return {
    kind: "external-runtime",
    runtimeId,
    attachmentId,
  };
}

function readExternalToolFailure(
  payload: Record<string, unknown>,
): OperatorCockpitExternalToolFailureProjection | EvidenceRejectionCause | null {
  const metadata = asRecord(payload.metadata);
  if (metadata.kind !== "external_tool_failure") {
    return null;
  }
  const selector = readString(metadata.selector);
  if (!selector) {
    return evidenceRejection("missing-required-field", "metadata.selector");
  }
  if (!selector.startsWith("mcp:")) {
    return evidenceRejection("contract-violation", "metadata.selector");
  }
  const category = readString(metadata.category);
  if (!category) {
    return evidenceRejection("missing-required-field", "metadata.category");
  }
  const diagnostic = readString(metadata.diagnostic);
  if (!diagnostic) {
    return evidenceRejection("missing-required-field", "metadata.diagnostic");
  }
  if (typeof metadata.redacted !== "boolean") {
    return evidenceRejection("missing-required-field", "metadata.redacted");
  }
  if (typeof metadata.blocked !== "boolean") {
    return evidenceRejection("missing-required-field", "metadata.blocked");
  }
  const attachment = readExternalRuntimeAttachmentValue(metadata.attachment);
  return {
    selector,
    category,
    ...(attachment ? { attachment } : {}),
    diagnostic,
    redacted: metadata.redacted,
    blocked: metadata.blocked,
  };
}

function readChildSessionId(payload: Record<string, unknown>): string | null {
  const evidence = asRecord(payload.managedInvocationEvidence);
  return readString(payload.childSessionId)
    ?? readString(evidence.childSessionId);
}

function readChildTurnId(payload: Record<string, unknown>): string | null {
  const evidence = asRecord(payload.managedInvocationEvidence);
  return readString(payload.childTurnId)
    ?? readString(evidence.childTurnId);
}

function readTimeoutMs(payload: Record<string, unknown>): number | null {
  const capabilitySnapshot = asRecord(payload.capabilitySnapshot);
  const authorityProfile = asRecord(capabilitySnapshot.authorityProfile);
  const evidence = asRecord(payload.managedInvocationEvidence);
  const lifecycle = asRecord(evidence.lifecycle);
  return readNumber(payload.timeoutMs)
    ?? readNumber(lifecycle.timeoutMs)
    ?? readNumber(authorityProfile.timeoutMs);
}

function readTimeoutSource(payload: Record<string, unknown>): string | null {
  const capabilitySnapshot = asRecord(payload.capabilitySnapshot);
  const authorityProfile = asRecord(capabilitySnapshot.authorityProfile);
  const evidence = asRecord(payload.managedInvocationEvidence);
  const lifecycle = asRecord(evidence.lifecycle);
  return readString(payload.timeoutSource)
    ?? readString(lifecycle.timeoutSource)
    ?? readString(authorityProfile.timeoutSource);
}

function readResourceLease(
  payload: Record<string, unknown>,
): OperatorCockpitInvocationResourceLeaseProjection | EvidenceRejectionCause | null {
  const capabilitySnapshot = asRecord(payload.capabilitySnapshot);
  const evidence = asRecord(payload.managedInvocationEvidence);
  const lifecycle = asRecord(evidence.lifecycle);
  const snapshotLease = asRecord(capabilitySnapshot.resourceLease);
  const lifecycleLease = asRecord(lifecycle.resourceLease);
  const leasePresent = isRecordValue(lifecycle.resourceLease) || isRecordValue(capabilitySnapshot.resourceLease);
  if (!leasePresent) {
    return null;
  }
  const lease = isRecordValue(lifecycle.resourceLease) ? lifecycleLease : snapshotLease;

  const leaseId = readString(lease.leaseId);
  if (!leaseId) return evidenceRejection("missing-required-field", "resourceLease.leaseId");
  const createdAt = readString(lease.createdAt);
  if (!createdAt) return evidenceRejection("missing-required-field", "resourceLease.createdAt");
  if (lease.healthStatus === undefined) {
    return evidenceRejection("missing-required-field", "resourceLease.healthStatus");
  }
  const healthStatus = readLeaseHealthStatus(lease.healthStatus);
  if (!healthStatus) return evidenceRejection("invalid-discriminator", "resourceLease.healthStatus");
  if (lease.cleanupStatus === undefined) {
    return evidenceRejection("missing-required-field", "resourceLease.cleanupStatus");
  }
  const cleanupStatus = readLeaseCleanupStatus(lease.cleanupStatus);
  if (!cleanupStatus) return evidenceRejection("invalid-discriminator", "resourceLease.cleanupStatus");
  const workingDirectoryPath = readString(lease.workingDirectoryPath);
  if (!workingDirectoryPath) return evidenceRejection("missing-required-field", "resourceLease.workingDirectoryPath");
  if (lease.workingDirectoryMode === undefined) {
    return evidenceRejection("missing-required-field", "resourceLease.workingDirectoryMode");
  }
  const workingDirectoryMode = readWorkingDirectoryMode(lease.workingDirectoryMode);
  if (!workingDirectoryMode) return evidenceRejection("invalid-discriminator", "resourceLease.workingDirectoryMode");
  if (!Array.isArray(lease.resourceUris)) {
    return evidenceRejection("missing-required-field", "resourceLease.resourceUris");
  }
  const resourceUris = readRequiredStringList(lease.resourceUris);
  if (!resourceUris) return evidenceRejection("contract-violation", "resourceLease.resourceUris");
  if (!Array.isArray(lease.diagnosticUris)) {
    return evidenceRejection("missing-required-field", "resourceLease.diagnosticUris");
  }
  const diagnosticUris = readRequiredStringList(lease.diagnosticUris);
  if (!diagnosticUris) return evidenceRejection("contract-violation", "resourceLease.diagnosticUris");
  const worktreeReview = readWorktreeReview(lease.worktreeReview);
  if (worktreeReview && isEvidenceRejection(worktreeReview)) return worktreeReview;
  const worktreeConflict = readWorktreeConflict(lease.worktreeConflict);
  if (worktreeConflict && isEvidenceRejection(worktreeConflict)) return worktreeConflict;
  return {
    leaseId,
    createdAt,
    healthStatus,
    cleanupStatus,
    workingDirectoryPath,
    workingDirectoryMode,
    resourceUris,
    diagnosticUris,
    ...(worktreeReview !== undefined ? { worktreeReview } : {}),
    ...(worktreeConflict !== undefined ? { worktreeConflict } : {}),
  };
}

function readManagedEconomicRoute(
  value: unknown,
): OperatorManagedEconomicRouteIdentity | EvidenceRejectionCause | undefined {
  if (value === undefined) return undefined;
  const route = asRecord(value);
  const fields = ["routeId", "providerId", "modelId", "adapterCapabilityId", "adapterCapabilityVersion", "priceClass"];
  if (!hasOnlyKeys(route, fields)) return evidenceRejection("contract-violation", "selectedRoute");
  const routeId = readString(route.routeId);
  const providerId = readString(route.providerId);
  const modelId = readString(route.modelId);
  const adapterCapabilityId = readString(route.adapterCapabilityId);
  const adapterCapabilityVersion = readString(route.adapterCapabilityVersion);
  const priceClass = route.priceClass === undefined
    ? undefined
    : readManagedEconomicBillingClass(route.priceClass);
  if (isEvidenceRejection(priceClass)) return priceClass;
  if (route.priceClass !== undefined && priceClass === undefined) {
    return evidenceRejection("invalid-discriminator", "selectedRoute.priceClass");
  }
  if (!routeId || !providerId || !modelId || !adapterCapabilityId || !adapterCapabilityVersion) {
    return evidenceRejection("missing-required-field", "selectedRoute");
  }
  return {
    routeId,
    providerId,
    modelId,
    adapterCapabilityId,
    adapterCapabilityVersion,
    ...(priceClass !== undefined ? { priceClass } : {}),
  };
}

function mergePerChildConsumption(
  existing: readonly OperatorManagedEconomicChildConsumption[] | undefined,
  incoming: readonly OperatorManagedEconomicChildConsumption[],
): readonly OperatorManagedEconomicChildConsumption[] {
  const merged = new Map<string, OperatorManagedEconomicChildConsumption>();
  for (const child of existing ?? []) merged.set(child.childId, child);
  for (const child of incoming) merged.set(child.childId, child);
  return [...merged.values()];
}

function worseEvidenceFreshness(
  existing: "fresh" | "stale" | "missing" | "unknown" | undefined,
  incoming: "fresh" | "stale" | "missing" | "unknown",
): "fresh" | "stale" | "missing" | "unknown" {
  const rank: Record<"fresh" | "stale" | "missing" | "unknown", number> = {
    fresh: 0,
    unknown: 1,
    stale: 2,
    missing: 3,
  };
  if (existing === undefined) return incoming;
  return rank[incoming] >= rank[existing] ? incoming : existing;
}

function mergeTerminalCause(
  existing: OperatorManagedEconomicTerminalCause | undefined,
  incoming: OperatorManagedEconomicTerminalCause,
): OperatorManagedEconomicTerminalCause {
  if (existing === undefined) return incoming;
  const priority: Record<OperatorManagedEconomicTerminalCause, number> = {
    "work-limit-exhaustion": 6,
    "provider-exhaustion": 5,
    "spend-denial": 5,
    "technical-failure": 4,
    unknown: 3,
    cancelled: 2,
    completed: 1,
  };
  return priority[incoming] >= priority[existing] ? incoming : existing;
}

function readManagedEconomicAccount(
  value: unknown,
): OperatorManagedEconomicAccountIdentity | EvidenceRejectionCause | undefined {
  if (value === undefined) return undefined;
  const account = asRecord(value);
  const kind = account.kind;
  if (kind !== "account-bound" && kind !== "accountless") {
    return evidenceRejection("invalid-discriminator", "selectedAccount");
  }
  if (kind === "accountless") {
    return hasOnlyKeys(account, ["kind"])
      ? { kind }
      : evidenceRejection("contract-violation", "selectedAccount");
  }
  const fields = ["kind", "capacityIdentity", "creditPosture", "overagePosture"];
  if (!hasOnlyKeys(account, fields)) return evidenceRejection("contract-violation", "selectedAccount");
  const capacityIdentity = readString(account.capacityIdentity);
  const creditPosture = account.creditPosture;
  const overagePosture = account.overagePosture;
  if (!capacityIdentity || (creditPosture !== "disabled" && creditPosture !== "committed")
    || (overagePosture !== "disabled" && overagePosture !== "committed")) {
    return evidenceRejection("missing-required-field", "selectedAccount");
  }
  return {
    kind,
    capacityIdentity,
    creditPosture,
    overagePosture,
  };
}

function readManagedEconomicSelectedTarget(
  value: unknown,
): OperatorManagedEconomicTargetExplanation | EvidenceRejectionCause | undefined {
  if (value === undefined) return undefined;
  const target = asRecord(value);
  if (!hasOnlyKeys(target, ["targetId", "providerId", "modelId", "reason"])) {
    return evidenceRejection("contract-violation", "selectedTarget");
  }
  const targetId = readString(target.targetId);
  const providerId = readString(target.providerId);
  const modelId = readString(target.modelId);
  const reason = readManagedEconomicSelectionReason(target.reason);
  if (!targetId || !providerId || !modelId || !reason) {
    return evidenceRejection("missing-required-field", "selectedTarget");
  }
  return { targetId, providerId, modelId, reason };
}

function readManagedEconomicSelectionReason(
  value: unknown,
): OperatorManagedEconomicSelectionReason | undefined {
  return value === "only-admitted-target" || value === "configured-target-order"
    || value === "lower-comparable-reservation" || value === "stable-identity-order"
    || value === "runtime-authority-selection"
    ? value
    : undefined;
}

function readManagedEconomicBillingClass(
  value: unknown,
): OperatorManagedEconomicBillingClass | EvidenceRejectionCause | undefined {
  if (value === undefined) return undefined;
  if (value === "subscription" || value === "included" || value === "free"
    || value === "metered" || value === "estimated" || value === "unknown") {
    return value;
  }
  return evidenceRejection("invalid-discriminator", "billingClass");
}

function readManagedEconomicProviderAllowance(
  value: unknown,
): OperatorManagedEconomicProviderAllowance | EvidenceRejectionCause | undefined {
  if (value === undefined) return undefined;
  const allowance = asRecord(value);
  if (!hasOnlyKeys(allowance, ["status", "evidenceFreshness", "buckets"])) {
    return evidenceRejection("contract-violation", "providerAllowance");
  }
  const status = allowance.status;
  if (status !== "available" && status !== "exhausted" && status !== "unlimited" && status !== "unknown") {
    return evidenceRejection("invalid-discriminator", "providerAllowance.status");
  }
  const evidenceFreshness = readManagedEconomicEvidenceFreshness(allowance.evidenceFreshness);
  if (!evidenceFreshness || isEvidenceRejection(evidenceFreshness)) {
    return evidenceRejection("invalid-discriminator", "providerAllowance.evidenceFreshness");
  }
  if (allowance.buckets === undefined) return { status, evidenceFreshness };
  if (!Array.isArray(allowance.buckets)) return evidenceRejection("contract-violation", "providerAllowance.buckets");
  const buckets: OperatorManagedEconomicProviderAllowanceBucket[] = [];
  for (const valueOfBucket of allowance.buckets) {
    const bucket = asRecord(valueOfBucket);
    if (!hasOnlyKeys(bucket, ["dimension", "remaining", "resetsAt"])) {
      return evidenceRejection("contract-violation", "providerAllowance.buckets");
    }
    const dimension = readString(bucket.dimension);
    if (!dimension || (bucket.resetsAt !== null && readString(bucket.resetsAt) === null)) {
      return evidenceRejection("missing-required-field", "providerAllowance.buckets");
    }
    const remaining = bucket.remaining === null
      ? null
      : readManagedEconomicAmount(bucket.remaining, "providerAllowance.buckets.remaining");
    if (remaining === undefined || isEvidenceRejection(remaining)) {
      return isEvidenceRejection(remaining)
        ? remaining
        : evidenceRejection("missing-required-field", "providerAllowance.buckets.remaining");
    }
    buckets.push({ dimension, remaining, resetsAt: bucket.resetsAt === null ? null : readString(bucket.resetsAt) });
  }
  return { status, evidenceFreshness, buckets };
}

function readManagedEconomicWorkLimitProgress(
  value: unknown,
): OperatorManagedEconomicWorkLimitProgress | EvidenceRejectionCause | undefined {
  if (value === undefined) return undefined;
  const progress = asRecord(value);
  if (!hasOnlyKeys(progress, ["dimension", "consumed", "limit", "status"])) {
    return evidenceRejection("contract-violation", "workLimitProgress");
  }
  const dimension = progress.dimension;
  const status = progress.status;
  if (dimension !== "turns" && dimension !== "duration-ms" && dimension !== "concurrency" && dimension !== "nesting") {
    return evidenceRejection("invalid-discriminator", "workLimitProgress.dimension");
  }
  if (status !== "within-limit" && status !== "exhausted" && status !== "unknown") {
    return evidenceRejection("invalid-discriminator", "workLimitProgress.status");
  }
  const consumed = readNonNegativeSafeInteger(progress.consumed);
  const limit = readPositiveSafeInteger(progress.limit);
  if (consumed === undefined || limit === undefined || consumed > limit) {
    return evidenceRejection("contract-violation", "workLimitProgress");
  }
  return { dimension, consumed, limit, status };
}

function readManagedEconomicAmount(
  value: unknown,
  field: string,
): OperatorManagedEconomicAmount | EvidenceRejectionCause | undefined {
  if (value === undefined) return undefined;
  const amount = asRecord(value);
  if (!hasOnlyKeys(amount, ["atoms", "scale", "unit", "scheme"])) {
    return evidenceRejection("contract-violation", field);
  }
  const atoms = readString(amount.atoms);
  const scale = readNonNegativeSafeInteger(amount.scale);
  const unit = readString(amount.unit);
  const scheme = asRecord(amount.scheme);
  if (!atoms || !/^(?:0|[1-9][0-9]*)$/u.test(atoms) || scale === undefined || scale > 18 || !unit) {
    return evidenceRejection("contract-violation", field);
  }
  if (scheme.kind === "unit") {
    if (!hasOnlyKeys(scheme, ["kind"])) return evidenceRejection("contract-violation", `${field}.scheme`);
    return { atoms, scale, unit, scheme: { kind: "unit" } };
  }
  if (scheme.kind === "currency") {
    const currency = readString(scheme.currency);
    if (!currency || !hasOnlyKeys(scheme, ["kind", "currency"])) {
      return evidenceRejection("contract-violation", `${field}.scheme`);
    }
    return { atoms, scale, unit, scheme: { kind: "currency", currency } };
  }
  if (scheme.kind === "credit") {
    const creditSchemeId = readString(scheme.creditSchemeId);
    if (!creditSchemeId || !hasOnlyKeys(scheme, ["kind", "creditSchemeId"])) {
      return evidenceRejection("contract-violation", `${field}.scheme`);
    }
    return { atoms, scale, unit, scheme: { kind: "credit", creditSchemeId } };
  }
  return evidenceRejection("invalid-discriminator", `${field}.scheme.kind`);
}

function readManagedEconomicChildConsumption(
  value: unknown,
): readonly OperatorManagedEconomicChildConsumption[] | EvidenceRejectionCause | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return evidenceRejection("contract-violation", "perChildConsumption");
  const children: OperatorManagedEconomicChildConsumption[] = [];
  for (const valueOfChild of value) {
    const child = asRecord(valueOfChild);
    if (!hasOnlyKeys(child, ["childId", "units", "settledAmount", "comparability"])) {
      return evidenceRejection("contract-violation", "perChildConsumption");
    }
    const childId = readString(child.childId);
    const comparability = child.comparability;
    if (!childId || (comparability !== "comparable" && comparability !== "not-comparable" && comparability !== "unknown")) {
      return evidenceRejection("contract-violation", "perChildConsumption");
    }
    let units: OperatorManagedEconomicAmount[] | undefined;
    if (child.units !== undefined) {
      if (!Array.isArray(child.units)) return evidenceRejection("contract-violation", "perChildConsumption.units");
      units = [];
      for (const valueOfUnit of child.units) {
        const unit = readManagedEconomicAmount(valueOfUnit, "perChildConsumption.units");
        if (unit === undefined || isEvidenceRejection(unit)) {
          return isEvidenceRejection(unit) ? unit : evidenceRejection("contract-violation", "perChildConsumption.units");
        }
        units.push(unit);
      }
    }
    const settledAmount = readManagedEconomicAmount(child.settledAmount, "perChildConsumption.settledAmount");
    if (isEvidenceRejection(settledAmount)) return settledAmount;
    children.push({
      childId,
      ...(units ? { units } : {}),
      ...(settledAmount ? { settledAmount } : {}),
      comparability,
    });
  }
  return children;
}

function readManagedEconomicEvidenceFreshness(
  value: unknown,
): "fresh" | "stale" | "missing" | "unknown" | EvidenceRejectionCause | undefined {
  if (value === undefined) return undefined;
  if (value === "fresh" || value === "stale" || value === "missing" || value === "unknown") return value;
  return evidenceRejection("invalid-discriminator", "evidenceFreshness");
}

function readManagedEconomicTerminalCause(
  value: unknown,
): OperatorManagedEconomicTerminalCause | EvidenceRejectionCause | undefined {
  if (value === undefined) return undefined;
  if (value === "work-limit-exhaustion" || value === "provider-exhaustion" || value === "spend-denial"
    || value === "technical-failure" || value === "completed" || value === "cancelled" || value === "unknown") {
    return value;
  }
  return evidenceRejection("invalid-discriminator", "terminalCause");
}

function readNonNegativeSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function readPositiveSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function readManagedEconomicSettlement(
  payload: Record<string, unknown>,
): { readonly kind: OperatorManagedEconomicSettlementKind; readonly authority?: OperatorManagedEconomicEvidenceAuthority }
  | EvidenceRejectionCause
  | null {
  const hasKind = payload.settlementKind !== undefined;
  const hasAuthority = payload.settlementAuthority !== undefined;
  if (!hasKind && !hasAuthority) return null;
  if (!hasKind) return evidenceRejection("contract-violation", "settlementKind");

  const kind = readManagedEconomicSettlementKind(payload.settlementKind);
  if (!kind) return evidenceRejection("invalid-discriminator", "settlementKind");
  if (!hasAuthority) return { kind };

  const authority = readManagedEconomicEvidenceAuthority(payload.settlementAuthority);
  if (!authority || kind === "pending" || kind === "leaked") {
    return evidenceRejection("contract-violation", "settlementAuthority");
  }
  return { kind, authority };
}

function readManagedEconomicSettlementKind(value: unknown): OperatorManagedEconomicSettlementKind | undefined {
  return value === "charged" || value === "estimated" || value === "subscription"
    || value === "included" || value === "free" || value === "unknown"
    || value === "pending" || value === "leaked"
    ? value
    : undefined;
}

function readManagedEconomicEvidenceAuthority(value: unknown): OperatorManagedEconomicEvidenceAuthority | undefined {
  return value === "provider-reported" || value === "configured" || value === "calculated-estimate"
    ? value
    : undefined;
}

function readAccountLease(
  payload: Record<string, unknown>,
): OperatorCockpitInvocationAccountLeaseProjection | EvidenceRejectionCause | null {
  const evidence = asRecord(payload.managedInvocationEvidence);
  const lifecycle = asRecord(evidence.lifecycle);
  if (!isRecordValue(lifecycle.accountLease)) {
    return null;
  }
  const lease = asRecord(lifecycle.accountLease);
  const route = asRecord(lease.route);

  const leaseId = readString(lease.leaseId);
  if (!leaseId) return evidenceRejection("missing-required-field", "accountLease.leaseId");
  const accountPolicyId = readString(lease.accountPolicyId);
  if (!accountPolicyId) return evidenceRejection("missing-required-field", "accountLease.accountPolicyId");
  const accountRef = readString(lease.accountRef);
  if (!accountRef) return evidenceRejection("missing-required-field", "accountLease.accountRef");
  const providerId = readString(route.providerId);
  if (!providerId) return evidenceRejection("missing-required-field", "accountLease.route.providerId");
  const providerModelId = readString(route.providerModelId);
  if (!providerModelId) return evidenceRejection("missing-required-field", "accountLease.route.providerModelId");
  const scope = readString(route.scope);
  if (!scope) return evidenceRejection("missing-required-field", "accountLease.route.scope");
  const jobId = readString(lease.jobId);
  if (!jobId) return evidenceRejection("missing-required-field", "accountLease.jobId");
  const runtimeInvocationId = readString(lease.runtimeInvocationId);
  if (!runtimeInvocationId) return evidenceRejection("missing-required-field", "accountLease.runtimeInvocationId");
  const credentialRevisionId = readString(lease.credentialRevisionId);
  if (!credentialRevisionId) return evidenceRejection("missing-required-field", "accountLease.credentialRevisionId");
  if (!/^[a-f0-9]{64}$/u.test(credentialRevisionId)) {
    return evidenceRejection("contract-violation", "accountLease.credentialRevisionId");
  }
  const selectionReason = readString(lease.selectionReason);
  if (!selectionReason) return evidenceRejection("missing-required-field", "accountLease.selectionReason");
  const candidateRejections = readAccountLeaseCandidateRejections(lease.candidateRejections);
  if (candidateRejections === null) {
    return evidenceRejection("contract-violation", "accountLease.candidateRejections");
  }
  const acquiredAt = readString(lease.acquiredAt);
  if (!acquiredAt) return evidenceRejection("missing-required-field", "accountLease.acquiredAt");
  if (lease.lifecycleState === undefined) {
    return evidenceRejection("missing-required-field", "accountLease.lifecycleState");
  }
  const lifecycleState = readAccountLeaseLifecycleState(lease.lifecycleState);
  if (!lifecycleState) return evidenceRejection("invalid-discriminator", "accountLease.lifecycleState");
  const usageEvidence = readAccountLeaseUsageEvidence(lease.usageEvidence);
  if (usageEvidence === null) {
    return evidenceRejection("contract-violation", "accountLease.usageEvidence");
  }
  const affinityCommitOutcome = readAccountAffinityCommitOutcome(lease.affinityCommitOutcome);
  if (affinityCommitOutcome === null) {
    return evidenceRejection("invalid-discriminator", "accountLease.affinityCommitOutcome");
  }
  if (affinityCommitOutcome !== undefined && lifecycleState !== "released") {
    return evidenceRejection("contract-violation", "accountLease.affinityCommitOutcome");
  }
  if (!Array.isArray(lease.resourceUris)) {
    return evidenceRejection("missing-required-field", "accountLease.resourceUris");
  }
  const resourceUris = readRequiredStringList(lease.resourceUris);
  if (!resourceUris) return evidenceRejection("contract-violation", "accountLease.resourceUris");
  if (!Array.isArray(lease.diagnosticUris)) {
    return evidenceRejection("missing-required-field", "accountLease.diagnosticUris");
  }
  const diagnosticUris = readRequiredStringList(lease.diagnosticUris);
  if (!diagnosticUris) return evidenceRejection("contract-violation", "accountLease.diagnosticUris");
  const releasedAt = readString(lease.releasedAt) ?? undefined;
  if ((lifecycleState === "released") !== (releasedAt !== undefined)) {
    return evidenceRejection("contract-violation", "accountLease.releasedAt");
  }
  return {
    leaseId,
    accountPolicyId,
    accountRef,
    route: { providerId, providerModelId, scope },
    jobId,
    runtimeInvocationId,
    credentialRevisionId,
    selectionReason,
    candidateRejections,
    ...(usageEvidence !== undefined ? { usageEvidence } : {}),
    ...(readString(lease.affinityOutcome) ? { affinityOutcome: readString(lease.affinityOutcome)! } : {}),
    ...(affinityCommitOutcome !== undefined ? { affinityCommitOutcome } : {}),
    acquiredAt,
    lifecycleState,
    ...(releasedAt ? { releasedAt } : {}),
    resourceUris,
    diagnosticUris,
  };
}

function readAccountLeaseUsageEvidence(
  value: unknown,
): OperatorCockpitInvocationAccountLeaseProjection["usageEvidence"] | null {
  if (value === undefined) return undefined;
  const usage = asRecord(value);
  const health = usage.health;
  const freshness = usage.freshness;
  if (
    (health !== "healthy" && health !== "unhealthy")
    || (freshness !== "fresh" && freshness !== "stale" && freshness !== "missing")
  ) {
    return null;
  }
  if (freshness === "missing") {
    return health === "healthy" && Object.keys(usage).length === 2
      ? { health, freshness }
      : null;
  }
  const availability = usage.availability;
  const observedAt = readString(usage.observedAt);
  const validUntil = readString(usage.validUntil);
  const source = usage.source;
  const confidence = usage.confidence;
  if (
    (availability !== "available" && availability !== "exhausted" && availability !== "unknown")
    || !observedAt
    || !validUntil
    || !Number.isFinite(Date.parse(observedAt))
    || !Number.isFinite(Date.parse(validUntil))
    || Date.parse(validUntil) < Date.parse(observedAt)
    || (source !== "provider-endpoint" && source !== "provider-response-headers" && source !== "unknown")
    || (confidence !== "authoritative" && confidence !== "unknown")
    || health !== (freshness === "fresh" && availability === "exhausted" ? "unhealthy" : "healthy")
  ) {
    return null;
  }
  return { health, freshness, availability, observedAt, validUntil, source, confidence };
}

function readAccountLeaseCandidateRejections(
  value: unknown,
): OperatorCockpitInvocationAccountLeaseProjection["candidateRejections"] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const rejections = value.map((entry) => {
    const rejection = asRecord(entry);
    const accountRef = readString(rejection.account);
    const reason = readString(rejection.reason);
    return accountRef && reason ? { accountRef, reason } : null;
  });
  return rejections.some((entry) => entry === null)
    ? null
    : rejections as OperatorCockpitInvocationAccountLeaseProjection["candidateRejections"];
}

function readAccountLeaseLifecycleState(
  value: unknown,
): OperatorCockpitInvocationAccountLeaseProjection["lifecycleState"] | null {
  return value === "held"
    || value === "settlement-pending"
    || value === "released"
    || value === "release-failed"
    || value === "leaked"
    ? value
    : null;
}

function readAccountAffinityCommitOutcome(
  value: unknown,
): OperatorCockpitInvocationAccountLeaseProjection["affinityCommitOutcome"] | null {
  if (value === undefined) return undefined;
  return value === "won" || value === "already-matched" || value === "conflict"
    ? value
    : null;
}

function applyManagedInvocationEvidence(
  invocation: InvocationAccumulator,
  payload: Record<string, unknown>,
  event: OperatorSessionEvent,
  unprojectableEvidence: OperatorCockpitEvidenceRejection[],
): void {
  const evidence = asRecord(payload.managedInvocationEvidence);
  if (Object.keys(evidence).length === 0) {
    const lease = invocation.resourceLease;
    if (lease) {
      addEvidenceResourceUris(invocation, [
        ...lease.resourceUris,
        ...lease.diagnosticUris,
        ...(lease.worktreeReview?.resourceUris ?? []),
        ...(lease.worktreeReview?.diagnosticUris ?? []),
        ...(lease.worktreeConflict?.resourceUris ?? []),
        ...(lease.worktreeConflict?.diagnosticUris ?? []),
      ]);
    }
    return;
  }

  const lifecycle = asRecord(evidence.lifecycle);
  const sourceResourceUris = readOptionalStringList(
    lifecycle.sourceResourceUris,
    "managedInvocationEvidence.lifecycle.sourceResourceUris",
  );
  if (isEvidenceRejection(sourceResourceUris)) {
    pushEvidenceRejection(unprojectableEvidence, event, sourceResourceUris);
  } else {
    addSourceResourceUris(invocation, sourceResourceUris);
    addEvidenceResourceUris(invocation, sourceResourceUris);
  }

  const transcriptResult = readInvocationTranscript(evidence.transcript);
  if (transcriptResult && isEvidenceRejection(transcriptResult)) {
    pushEvidenceRejection(unprojectableEvidence, event, transcriptResult);
  } else if (transcriptResult) {
    invocation.transcript = transcriptResult;
    addEvidenceResourceUris(invocation, [transcriptResult.uri]);
  }

  const handoffResult = readInvocationResultHandoff(evidence.resultHandoff);
  if (handoffResult && isEvidenceRejection(handoffResult)) {
    pushEvidenceRejection(unprojectableEvidence, event, handoffResult);
  } else if (handoffResult) {
    invocation.resultHandoff = handoffResult;
    addEvidenceResourceUris(invocation, [
      ...handoffResult.resourceUris,
      ...handoffResult.memoryWriteProposalUris,
    ]);
  }

  for (const diagnostic of readDiagnosticPointers(evidence.diagnostics)) {
    invocation.diagnosticPointers.set(diagnostic.uri, diagnostic);
    addEvidenceResourceUris(invocation, [diagnostic.uri]);
  }

  const writeEvidenceResourceUris = readWriteEvidenceResourceUris(evidence.writeEvidence);
  if (isEvidenceRejection(writeEvidenceResourceUris)) {
    pushEvidenceRejection(unprojectableEvidence, event, writeEvidenceResourceUris);
  } else {
    addEvidenceResourceUris(invocation, writeEvidenceResourceUris);
  }

  const lease = invocation.resourceLease;
  if (lease) {
    addEvidenceResourceUris(invocation, [
      ...lease.resourceUris,
      ...lease.diagnosticUris,
      ...(lease.worktreeReview?.resourceUris ?? []),
      ...(lease.worktreeReview?.diagnosticUris ?? []),
      ...(lease.worktreeConflict?.resourceUris ?? []),
      ...(lease.worktreeConflict?.diagnosticUris ?? []),
    ]);
  }
  if (invocation.accountLease) {
    addEvidenceResourceUris(invocation, [
      ...invocation.accountLease.resourceUris,
      ...invocation.accountLease.diagnosticUris,
    ]);
  }
}

function readInvocationTranscript(
  value: unknown,
): OperatorCockpitInvocationTranscriptProjection | EvidenceRejectionCause | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecordValue(value)) {
    return evidenceRejection("contract-violation", "transcript");
  }
  const uri = readString(value.uri);
  if (!uri) {
    return evidenceRejection("missing-required-field", "transcript.uri");
  }
  const redacted = readBooleanOrUnknown(value.redacted);
  const truncated = readBooleanOrUnknown(value.truncated);
  const persisted = readBooleanOrUnknown(value.persisted);
  const retention = readTranscriptRetention(value.retention);
  const format = readString(value.format) ?? undefined;
  const redaction = readString(value.redaction) ?? undefined;
  return {
    uri,
    ...(redacted !== undefined ? { redacted } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
    ...(persisted !== undefined ? { persisted } : {}),
    ...(retention !== undefined ? { retention } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(redaction !== undefined ? { redaction } : {}),
  };
}

function readInvocationResultHandoff(
  value: unknown,
): OperatorCockpitInvocationResultHandoffProjection | EvidenceRejectionCause | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecordValue(value)) {
    return evidenceRejection("contract-violation", "resultHandoff");
  }
  const summary = readString(value.summary) ?? undefined;
  const resourceUris = readOptionalStringList(value.resourceUris, "resultHandoff.resourceUris");
  if (isEvidenceRejection(resourceUris)) return resourceUris;
  const memoryWriteProposalUris = readOptionalStringList(
    value.memoryWriteProposalUris,
    "resultHandoff.memoryWriteProposalUris",
  );
  if (isEvidenceRejection(memoryWriteProposalUris)) return memoryWriteProposalUris;
  if (!summary && resourceUris.length === 0 && memoryWriteProposalUris.length === 0) {
    return null;
  }
  return {
    ...(summary !== undefined ? { summary } : {}),
    resourceUris,
    memoryWriteProposalUris,
  };
}

function readManagedInvocationRecovery(
  value: unknown,
): OperatorCockpitManagedInvocationRecoveryProjection | EvidenceRejectionCause | null {
  const fields = readManagedInvocationPhaseActionFields(value, "managedInvocationRecovery");
  if (!fields || isEvidenceRejection(fields)) {
    return fields;
  }
  const record = value as Record<string, unknown>;
  const blockedWorkItemUpdateInputTemplate = isRecordValue(record.blockedWorkItemUpdateInputTemplate)
    ? record.blockedWorkItemUpdateInputTemplate
    : undefined;
  const blockedWhen = readString(record.blockedWhen) ?? undefined;
  return {
    ...fields,
    ...(blockedWorkItemUpdateInputTemplate !== undefined ? { blockedWorkItemUpdateInputTemplate } : {}),
    ...(blockedWhen !== undefined ? { blockedWhen } : {}),
  };
}

function readManagedInvocationPhaseCompletion(
  value: unknown,
): OperatorCockpitManagedInvocationPhaseCompletionProjection | EvidenceRejectionCause | null {
  const fields = readManagedInvocationPhaseActionFields(value, "managedInvocationPhaseCompletion");
  if (!fields || isEvidenceRejection(fields)) {
    return fields;
  }
  return {
    ...(fields.status !== undefined ? { status: fields.status } : {}),
    ...(fields.reason !== undefined ? { reason: fields.reason } : {}),
    ...(fields.nextTool !== undefined ? { nextTool: fields.nextTool } : {}),
    ...(fields.thenTool !== undefined ? { thenTool: fields.thenTool } : {}),
    ...(fields.workItemId !== undefined ? { workItemId: fields.workItemId } : {}),
    evidenceToRecord: fields.evidenceToRecord,
    requiredToolNames: fields.requiredToolNames,
    sourceResourceUris: fields.sourceResourceUris,
  };
}

function readManagedInvocationPhaseActionFields(
  value: unknown,
  fieldPrefix: string,
): ManagedInvocationPhaseActionFields | EvidenceRejectionCause | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecordValue(value)) {
    return evidenceRejection("contract-violation", fieldPrefix);
  }
  const evidenceToRecord = readOptionalStringList(value.evidenceToRecord, `${fieldPrefix}.evidenceToRecord`);
  if (isEvidenceRejection(evidenceToRecord)) return evidenceToRecord;
  const requiredToolNames = readOptionalStringList(value.requiredToolNames, `${fieldPrefix}.requiredToolNames`);
  if (isEvidenceRejection(requiredToolNames)) return requiredToolNames;
  const sourceResourceUris = readOptionalStringList(value.sourceResourceUris, `${fieldPrefix}.sourceResourceUris`);
  if (isEvidenceRejection(sourceResourceUris)) return sourceResourceUris;
  const status = readString(value.status) ?? undefined;
  const reason = readString(value.reason) ?? undefined;
  const nextTool = readString(value.nextTool) ?? undefined;
  const thenTool = readString(value.thenTool) ?? undefined;
  const workItemId = readString(value.workItemId) ?? undefined;
  const inspectionTool = readString(value.inspectionTool) ?? undefined;
  if (
    !status
    && !reason
    && !nextTool
    && !thenTool
    && !workItemId
    && !inspectionTool
    && evidenceToRecord.length === 0
    && requiredToolNames.length === 0
    && sourceResourceUris.length === 0
  ) {
    return null;
  }
  return {
    ...(status !== undefined ? { status } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(nextTool !== undefined ? { nextTool } : {}),
    ...(thenTool !== undefined ? { thenTool } : {}),
    ...(workItemId !== undefined ? { workItemId } : {}),
    evidenceToRecord,
    requiredToolNames,
    sourceResourceUris,
    ...(inspectionTool !== undefined ? { inspectionTool } : {}),
  };
}

function readWriteEvidenceResourceUris(value: unknown): readonly string[] | EvidenceRejectionCause {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) return evidenceRejection("contract-violation", "managedInvocationEvidence.writeEvidence");
  const resourceUris: string[] = [];
  for (const item of value) {
    if (!isRecordValue(item)) return evidenceRejection("contract-violation", "managedInvocationEvidence.writeEvidence");
    const itemResourceUris = readOptionalStringList(item.resourceUris, "managedInvocationEvidence.writeEvidence.resourceUris");
    if (isEvidenceRejection(itemResourceUris)) return itemResourceUris;
    resourceUris.push(...itemResourceUris);
  }
  return resourceUris;
}

function readManagedOrchestrationAdoptionGate(
  value: unknown,
): OperatorCockpitManagedOrchestrationAdoptionGateProjection | EvidenceRejectionCause | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecordValue(value)) {
    return evidenceRejection("contract-violation", "managedOrchestrationAdoptionGate");
  }
  if (value.required === undefined) {
    return evidenceRejection("missing-required-field", "managedOrchestrationAdoptionGate.required");
  }
  if (typeof value.required !== "boolean") {
    return evidenceRejection("contract-violation", "managedOrchestrationAdoptionGate.required");
  }
  if (value.status === undefined) {
    return evidenceRejection("missing-required-field", "managedOrchestrationAdoptionGate.status");
  }
  const status = readManagedOrchestrationAdoptionGateStatus(value.status);
  if (!status) {
    return evidenceRejection("invalid-discriminator", "managedOrchestrationAdoptionGate.status");
  }
  if (!Array.isArray(value.resourceUris)) {
    return evidenceRejection("missing-required-field", "managedOrchestrationAdoptionGate.resourceUris");
  }
  const resourceUris = readRequiredStringList(value.resourceUris);
  if (!resourceUris) {
    return evidenceRejection("contract-violation", "managedOrchestrationAdoptionGate.resourceUris");
  }
  if (!Array.isArray(value.blockingEvidence)) {
    return evidenceRejection("missing-required-field", "managedOrchestrationAdoptionGate.blockingEvidence");
  }
  const blockingEvidence = readRequiredStringList(value.blockingEvidence);
  if (!blockingEvidence) {
    return evidenceRejection("contract-violation", "managedOrchestrationAdoptionGate.blockingEvidence");
  }
  const rejection = readManagedOrchestrationAdoptionGateRejection(value.rejection);
  if (value.rejection !== undefined && !rejection) {
    return evidenceRejection("contract-violation", "managedOrchestrationAdoptionGate.rejection");
  }
  if (value.childId === undefined) {
    return evidenceRejection("missing-required-field", "managedOrchestrationAdoptionGate.childId");
  }
  const childId = readString(value.childId);
  if (!childId) {
    return evidenceRejection("contract-violation", "managedOrchestrationAdoptionGate.childId");
  }
  const target = readString(value.target) ?? undefined;
  const reason = readString(value.reason) ?? undefined;
  const orchestrationId = readString(value.orchestrationId) ?? undefined;
  const mergePolicyMode = readString(value.mergePolicyMode) ?? undefined;
  const adoptedBy = readString(value.adoptedBy) ?? undefined;
  const adoptedAt = readString(value.adoptedAt) ?? undefined;
  return {
    required: value.required,
    status,
    ...(target !== undefined ? { target } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(orchestrationId !== undefined ? { orchestrationId } : {}),
    childId,
    ...(mergePolicyMode !== undefined ? { mergePolicyMode } : {}),
    ...(adoptedBy !== undefined ? { adoptedBy } : {}),
    ...(adoptedAt !== undefined ? { adoptedAt } : {}),
    resourceUris,
    ...(rejection !== undefined ? { rejection } : {}),
    blockingEvidence,
  };
}

function readManagedOrchestrationAdoptionGateStatus(
  value: unknown,
): OperatorCockpitManagedOrchestrationAdoptionGateStatus | null {
  if (
    value === "not_required"
    || value === "pending_review"
    || value === "adopted"
    || value === "rejected"
    || value === "blocked"
  ) {
    return value;
  }
  return null;
}

function readManagedOrchestrationAdoptionGateRejection(
  value: unknown,
): OperatorCockpitManagedOrchestrationAdoptionGateRejectionProjection | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecordValue(value)) {
    return undefined;
  }
  const gate = readString(value.gate);
  const evidence = readRequiredStringList(value.evidence);
  if (!gate || !evidence) {
    return undefined;
  }
  const summary = readString(value.summary) ?? undefined;
  const completedAt = readString(value.completedAt) ?? undefined;
  return {
    gate,
    ...(summary !== undefined ? { summary } : {}),
    evidence,
    ...(completedAt !== undefined ? { completedAt } : {}),
  };
}

function readDiagnosticPointers(value: unknown): readonly OperatorCockpitInvocationDiagnosticPointerProjection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecordValue(item)) {
      return [];
    }
    const uri = readString(item.uri);
    if (!uri) {
      return [];
    }
    const kind = readDiagnosticKind(item.kind);
    return [{
      uri,
      ...(kind !== undefined ? { kind } : {}),
    }];
  });
}

function readBooleanOrUnknown(value: unknown): boolean | "unknown" | undefined {
  if (typeof value === "boolean" || value === "unknown") {
    return value;
  }
  return undefined;
}

function readTranscriptRetention(value: unknown): OperatorCockpitInvocationTranscriptProjection["retention"] | undefined {
  if (value === "session" || value === "durable" || value === "external" || value === "unknown") {
    return value;
  }
  return undefined;
}

function readDiagnosticKind(value: unknown): OperatorCockpitInvocationDiagnosticPointerProjection["kind"] | undefined {
  if (value === "timeout" || value === "failure" || value === "adapter" || value === "cleanup") {
    return value;
  }
  return undefined;
}

function readOptionalStringList(value: unknown, field: string): readonly string[] | EvidenceRejectionCause {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => readString(item) === null)) {
    return evidenceRejection("contract-violation", field);
  }
  return value as readonly string[];
}

function addEvidenceResourceUris(
  invocation: InvocationAccumulator,
  resourceUris: readonly string[],
): void {
  for (const uri of resourceUris) {
    if (uri.trim().length > 0) {
      invocation.evidenceResourceUris.add(uri);
    }
  }
}

function addSourceResourceUris(
  invocation: InvocationAccumulator,
  resourceUris: readonly string[],
): void {
  for (const uri of resourceUris) {
    if (uri.trim().length > 0) {
      invocation.sourceResourceUris.add(uri);
    }
  }
}

function readWorktreeReview(
  value: unknown,
): OperatorManagedAgentResourceLeaseSnapshot["worktreeReview"] | EvidenceRejectionCause | undefined {
  if (value === undefined) return undefined;
  if (!isRecordValue(value)) return evidenceRejection("contract-violation", "resourceLease.worktreeReview");
  const status = value.status === "required" ? value.status : null;
  const reason = value.reason === "dirty-worktree-preserved" ? value.reason : null;
  const resourceUris = readRequiredStringList(value.resourceUris);
  const diagnosticUris = readRequiredStringList(value.diagnosticUris);
  if (!status || !reason || !resourceUris || !diagnosticUris) return evidenceRejection("contract-violation", "resourceLease.worktreeReview");
  return {
    status,
    reason,
    resourceUris,
    diagnosticUris,
  };
}

function readWorktreeConflict(
  value: unknown,
): OperatorManagedAgentResourceLeaseSnapshot["worktreeConflict"] | EvidenceRejectionCause | undefined {
  if (value === undefined) return undefined;
  if (!isRecordValue(value)) return evidenceRejection("contract-violation", "resourceLease.worktreeConflict");
  const status = value.status === "blocked" ? value.status : null;
  const reason = value.reason === "same-checkout-write-conflict" || value.reason === "isolated-worktree-path-conflict"
    ? value.reason
    : null;
  const requestedInvocationId = readString(value.requestedInvocationId);
  const conflictingInvocationId = readString(value.conflictingInvocationId);
  const workingDirectoryPath = readString(value.workingDirectoryPath);
  const workingDirectoryMode = readWorkingDirectoryMode(value.workingDirectoryMode);
  const policyId = value.policyId === "managed-agent.worktree.single-active-writer" ? value.policyId : null;
  const retryAfterInvocationIds = readRequiredStringList(value.retryAfterInvocationIds);
  const resourceUris = readRequiredStringList(value.resourceUris);
  const diagnosticUris = readRequiredStringList(value.diagnosticUris);
  if (
    !status
    || !reason
    || !requestedInvocationId
    || !conflictingInvocationId
    || !workingDirectoryPath
    || !workingDirectoryMode
    || !policyId
    || !retryAfterInvocationIds
    || !resourceUris
    || !diagnosticUris
  ) return evidenceRejection("contract-violation", "resourceLease.worktreeConflict");
  return {
    status,
    reason,
    requestedInvocationId,
    conflictingInvocationId,
    workingDirectoryPath,
    workingDirectoryMode,
    policyId,
    retryAfterInvocationIds,
    resourceUris,
    diagnosticUris,
  };
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWorkingDirectoryMode(value: unknown): OperatorManagedAgentResourceLeaseSnapshot["workingDirectoryMode"] | null {
  if (value === "read-only" || value === "workspace-write" || value === "isolated-worktree" || value === "sandbox") {
    return value;
  }
  return null;
}

function readLeaseHealthStatus(value: unknown): OperatorManagedAgentResourceLeaseSnapshot["healthStatus"] | null {
  if (value === "healthy" || value === "stale" || value === "released" || value === "leaked") {
    return value;
  }
  return null;
}

function readLeaseCleanupStatus(value: unknown): OperatorManagedAgentResourceLeaseSnapshot["cleanupStatus"] | null {
  if (value === "not-required" || value === "pending" || value === "completed" || value === "failed" || value === "unknown") {
    return value;
  }
  return null;
}

function readAuthority(payload: Record<string, unknown>): string | null {
  const authorityStatus = asRecord(payload.authorityStatus);
  return readString(payload.requestedAuthority)
    ?? readString(payload.effectiveAuthority)
    ?? readString(payload.authorityProfileId)
    ?? readString(authorityStatus.effective);
}

export function normalizeManagedAgentOperatorReplayEvents(
  events: readonly ManagedAgentOperatorReplayEnvelope[],
  options: NormalizeManagedAgentOperatorEventsOptions,
): readonly OperatorSessionEvent[] {
  return normalizeManagedAgentOperatorEvents(
    events.flatMap((event) => toManagedAgentOperatorReplayEvent(event)),
    options,
  );
}

export function normalizeManagedAgentOperatorEvents(
  events: readonly OperatorSessionEvent[],
  options: NormalizeManagedAgentOperatorEventsOptions,
): readonly OperatorSessionEvent[] {
  const orderedEvents = [...events].sort(compareEvents);
  const canonicalEvents = orderedEvents.flatMap((event) => normalizeCanonicalManagedAgentEvent(event, options));
  const canonicalInvocationEventKeys = canonicalEvents
    .map((event) => {
      const invocationId = readString(asRecord(event.payload).managedInvocationId);
      return invocationId ? projectionKey(invocationId, event.kind) : null;
    })
    .filter((eventKey): eventKey is string => eventKey !== null);
  const terminalInvocationPriorities = new Map(canonicalEvents
    .filter((event) => isTerminalManagedAgentEventKind(event.kind))
    .map((event) => readString(asRecord(event.payload).managedInvocationId))
    .filter((invocationId): invocationId is string => invocationId !== null)
    .map((invocationId) => [invocationId, CANONICAL_MANAGED_AGENT_REPLAY_PRIORITY] as const));
  const replayState: ManagedAgentToolReplayState = {
    ...options,
    terminalInvocationPriorities,
    replayedInvocationEventKeys: new Set(canonicalInvocationEventKeys),
  };
  const toolEvents = orderedEvents.flatMap((event) => normalizeManagedAgentToolEvidenceEvent(event, replayState));
  return [...canonicalEvents, ...toolEvents].sort(compareEvents);
}

function toManagedAgentOperatorReplayEvent(
  event: ManagedAgentOperatorReplayEnvelope,
): readonly OperatorSessionEvent[] {
  if (!matchesManagedAgentReplayEnvelopeSession(event) || !isManagedAgentReplayEventKind(event.kind)) {
    return [];
  }
  return [{
    eventId: event.eventId,
    kilnSessionId: event.kilnSessionId,
    sequence: event.sequence,
    timestamp: event.timestamp,
    kind: event.kind,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.parentEventId ? { parentEventId: event.parentEventId } : {}),
    ...(event.source ? { source: event.source } : {}),
    payload: event.payload,
  }];
}

function normalizeCanonicalManagedAgentEvent(
  event: OperatorSessionEvent,
  options: NormalizeManagedAgentOperatorEventsOptions,
): readonly OperatorSessionEvent[] {
  const payload = asRecord(event.payload);
  if (MANAGED_AGENT_EVENT_KINDS.includes(event.kind)) {
    const managedInvocationId = readString(payload.managedInvocationId) ?? readString(payload.invocationId);
    if (!managedInvocationId) {
      return [];
    }
    return [{
      ...event,
      payload: {
        ...payload,
        instanceId: readString(payload.instanceId) ?? options.defaultInstanceId,
        sessionId: readString(payload.sessionId) ?? event.kilnSessionId,
        managedInvocationId,
      },
    }];
  }
  if (MANAGED_AGENT_WORK_ITEM_EVENT_KINDS.includes(event.kind)) {
    const gate = asRecord(payload.managedOrchestrationAdoptionGate);
    const workItem = projectOperatorGovernedWorkItemSnapshot({
      workItem: payload.workItem,
      evidence: payload,
      sessionId: readString(payload.sessionId) ?? event.kilnSessionId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      observedAt: event.timestamp,
    });
    if (!workItem && !isManagedOrchestrationAdoptionGate(gate)) {
      return [];
    }
    return [{
      ...event,
      payload: {
        ...payload,
        instanceId: readString(payload.instanceId) ?? options.defaultInstanceId,
        sessionId: readString(payload.sessionId) ?? event.kilnSessionId,
      },
    }];
  }
  if (
    MANAGED_AGENT_GOVERNANCE_REPLAY_EVENT_KINDS.includes(event.kind)
    || isManagedExternalToolReplayEvent(event.kind, payload)
  ) {
    return [{
      ...event,
      payload: {
        ...payload,
        instanceId: readString(payload.instanceId) ?? options.defaultInstanceId,
        sessionId: readString(payload.sessionId) ?? event.kilnSessionId,
      },
    }];
  }
  return [];
}

function normalizeManagedAgentToolEvidenceEvent(
  event: OperatorSessionEvent,
  state: ManagedAgentToolReplayState,
): readonly OperatorSessionEvent[] {
  if (event.kind !== "tool_call_completed") {
    return [];
  }
  const payload = asRecord(event.payload);
  const toolName = readString(payload.toolName);
  if (!toolName?.startsWith("managed_agent.")) {
    return [];
  }
  if (toolName === "managed_agent.list") {
    return normalizeManagedAgentListSnapshotEvents(event, payload, state);
  }
  if (
    toolName !== "managed_agent.start" &&
    toolName !== "managed_agent.invoke" &&
    toolName !== "managed_agent.join" &&
    toolName !== "managed_agent.cancel"
  ) {
    return [];
  }
  const metadata = asRecord(payload.metadata);
  if (readString(metadata.kind) !== "managed-invocation") {
    return [];
  }
  const invocationId = readString(metadata.managedInvocationId) ?? readString(metadata.invocationId);
  if (!invocationId) {
    return [];
  }
  const lifecycleState = managedToolLifecycleState(metadata);
  const kind = managedToolLifecycleEventKind(toolName, lifecycleState);
  if (!kind) {
    return [];
  }
  if (!claimSyntheticManagedAgentEvent(state, invocationId, kind, managedToolReplayPriority(toolName))) {
    return [];
  }
  return [toSyntheticManagedAgentEvent(event, kind, managedToolMetadataPayload(event, metadata, invocationId, state), invocationId)];
}

function normalizeManagedAgentListSnapshotEvents(
  event: OperatorSessionEvent,
  payload: Record<string, unknown>,
  state: ManagedAgentToolReplayState,
): readonly OperatorSessionEvent[] {
  const output = readString(payload.output);
  if (!output) {
    return [];
  }
  const parsed = parseJsonRecord(output);
  const invocations = Array.isArray(parsed.invocations) ? parsed.invocations.map(asRecord) : [];
  const events: OperatorSessionEvent[] = [];
  for (const item of invocations) {
    const invocationId = readString(item.managedInvocationId) ?? readString(item.invocationId);
    if (!invocationId) {
      continue;
    }
    const lifecycleState = readString(item.lifecycleState);
    const kind = managedToolLifecycleEventKind("managed_agent.list", lifecycleState);
    if (!kind) {
      continue;
    }
    if (!claimSyntheticManagedAgentEvent(state, invocationId, kind, MANAGED_AGENT_LIST_REPLAY_PRIORITY)) {
      continue;
    }
    events.push(toSyntheticManagedAgentEvent(event, kind, managedListItemPayload(event, item, invocationId, state), invocationId));
  }
  return events;
}

function claimSyntheticManagedAgentEvent(
  state: ManagedAgentToolReplayState,
  invocationId: string,
  kind: OperatorSessionEventKind,
  replayPriority: number,
): boolean {
  if (isTerminalManagedAgentEventKind(kind)) {
    const terminalPriority = state.terminalInvocationPriorities.get(invocationId);
    if (terminalPriority !== undefined && terminalPriority >= replayPriority) {
      return false;
    }
    state.terminalInvocationPriorities.set(invocationId, replayPriority);
    return true;
  }
  if (state.terminalInvocationPriorities.has(invocationId)) {
    return false;
  }

  const replayKey = projectionKey(invocationId, kind);
  if (state.replayedInvocationEventKeys.has(replayKey)) {
    return false;
  }
  state.replayedInvocationEventKeys.add(replayKey);
  return true;
}

function managedToolReplayPriority(toolName: string): number {
  return toolName === "managed_agent.join"
    ? MANAGED_AGENT_JOIN_REPLAY_PRIORITY
    : MANAGED_AGENT_TOOL_REPLAY_PRIORITY;
}

function managedToolLifecycleEventKind(
  toolName: string,
  lifecycleState: string | null | undefined,
): OperatorSessionEventKind | undefined {
  if (toolName === "managed_agent.start") {
    return "agent_invocation_started";
  }
  switch (lifecycleState) {
    case "running":
    case "pending":
      return "agent_invocation_started";
    case "completed":
      return "agent_invocation_completed";
    case "cancelled":
      return "agent_invocation_cancelled";
    case "failed":
    case "route_profile_conflict":
    case "handoff_not_substantive":
    case "timed_out":
    case "stale":
    case "recovered":
      return "agent_invocation_failed";
    default:
      return undefined;
  }
}

function lifecycleStateFromManagedToolStatus(status: string | null): string | undefined {
  return status ?? undefined;
}

function managedToolLifecycleState(metadata: Record<string, unknown>): string | undefined {
  const statusLifecycleState = lifecycleStateFromManagedToolStatus(readString(metadata.status) ?? null);
  if (statusLifecycleState === "handoff_not_substantive") {
    return statusLifecycleState;
  }
  return readString(metadata.lifecycleState) ?? statusLifecycleState;
}

function managedToolMetadataPayload(
  event: OperatorSessionEvent,
  metadata: Record<string, unknown>,
  invocationId: string,
  options: NormalizeManagedAgentOperatorEventsOptions,
): Record<string, unknown> {
  const capabilitySnapshot = asRecord(metadata.capabilitySnapshot);
  const authorityProfile = asRecord(capabilitySnapshot.authorityProfile);
  const resultHandoff = asRecord(metadata.resultHandoff);
  const transcript = asRecord(metadata.transcript);
  const resourceLease = asRecord(metadata.resourceLease);
  const lifecycleState = managedToolLifecycleState(metadata);
  const timeoutMs = readNumber(metadata.timeoutMs) ?? readNumber(authorityProfile.timeoutMs) ?? undefined;
  const timeoutSource = readString(metadata.timeoutSource) ?? readString(authorityProfile.timeoutSource) ?? undefined;
  const childSessionId = readString(metadata.childSessionId) ?? undefined;
  const childTurnId = readString(metadata.childTurnId) ?? undefined;
  const evidence = compactRecord({
    lifecycle: compactRecord({
      lifecycleState,
      invocationId,
      parentSessionId: readString(metadata.parentSessionId) ?? event.kilnSessionId,
      parentTurnId: readString(metadata.parentTurnId) ?? event.turnId,
      routeId: readString(metadata.routeId) ?? readString(capabilitySnapshot.routeId),
      routeSource: readString(metadata.routeSource) ?? readString(capabilitySnapshot.routeSource),
      providerId: readString(asRecord(metadata.providerRoute).providerId),
      model: readString(asRecord(metadata.providerRoute).model),
      access: readString(metadata.access),
      contextMode: readString(asRecord(metadata.context).mode) ?? readString(capabilitySnapshot.contextMode),
      authorityProfileId: readString(metadata.authorityProfileId),
      timeoutMs,
      timeoutSource,
      resourceLease: Object.keys(resourceLease).length > 0 ? resourceLease : undefined,
      sourceResourceUris: readStringArray(metadata.sourceResourceUris),
      diagnosticUris: readStringArray(metadata.diagnosticUris),
      handoffResourceUris: readStringArray(resultHandoff.resourceUris),
    }),
    childSessionId,
    childTurnId,
    transcript: Object.keys(transcript).length > 0 ? transcript : undefined,
    diagnostics: readRecordArray(metadata.diagnostics),
    usage: asOptionalRecord(metadata.usage),
    resultHandoff: Object.keys(resultHandoff).length > 0 ? resultHandoff : undefined,
    writeAuthority: asOptionalRecord(asRecord(metadata.authority).writeAuthority),
    writeEvidence: readRecordArray(metadata.writeEvidence),
  });
  return compactRecord({
    instanceId: readString(metadata.instanceId) ?? options.defaultInstanceId,
    sessionId: readString(metadata.sessionId) ?? event.kilnSessionId,
    managedInvocationId: invocationId,
    invocationId,
    agentId: readString(metadata.agentId) ?? managedToolAgentId(metadata),
    parentSessionId: readString(metadata.parentSessionId) ?? event.kilnSessionId,
    parentTurnId: readString(metadata.parentTurnId) ?? event.turnId,
    routeId: readString(metadata.routeId) ?? readString(capabilitySnapshot.routeId),
    routeSource: readString(metadata.routeSource) ?? readString(capabilitySnapshot.routeSource),
    timeoutMs,
    timeoutSource,
    childSessionId,
    childTurnId,
    access: readString(metadata.access),
    providerRoute: asOptionalRecord(metadata.providerRoute),
    adapterKind: readString(metadata.adapterKind),
    executionMode: readString(metadata.executionMode),
    requestedAuthority: readString(metadata.requestedAuthority),
    authorityProfileId: readString(metadata.authorityProfileId),
    capabilitySnapshot: Object.keys(capabilitySnapshot).length > 0 ? capabilitySnapshot : undefined,
    invocationContext: asOptionalRecord(metadata.context),
    handoffContract: asOptionalRecord(metadata.handoffContract),
    lifecycleState,
    status: readString(metadata.status),
    resultSummary: readString(resultHandoff.summary),
    managedInvocationRecovery: asOptionalRecord(metadata.managedInvocationRecovery),
    managedInvocationPhaseCompletion: asOptionalRecord(metadata.managedInvocationPhaseCompletion),
    managedInvocationEvidence: Object.keys(evidence).length > 0 ? evidence : undefined,
  });
}

function managedListItemPayload(
  event: OperatorSessionEvent,
  item: Record<string, unknown>,
  invocationId: string,
  options: NormalizeManagedAgentOperatorEventsOptions,
): Record<string, unknown> {
  const timeoutMs = readNumber(item.timeoutMs) ?? undefined;
  const timeoutSource = readString(item.timeoutSource) ?? undefined;
  const childSessionId = readString(item.childSessionId) ?? undefined;
  const childTurnId = readString(item.childTurnId) ?? undefined;
  return compactRecord({
    instanceId: readString(item.instanceId) ?? options.defaultInstanceId,
    sessionId: readString(item.sessionId) ?? event.kilnSessionId,
    managedInvocationId: invocationId,
    invocationId,
    agentId: readString(item.agentId),
    parentSessionId: readString(item.parentSessionId) ?? event.kilnSessionId,
    parentTurnId: readString(item.parentTurnId) ?? event.turnId,
    routeId: readString(item.routeId),
    routeSource: readString(item.routeSource),
    timeoutMs,
    timeoutSource,
    childSessionId,
    childTurnId,
    access: readString(item.access),
    providerRoute: asOptionalRecord(item.providerRoute),
    adapterKind: readString(item.adapterKind),
    executionMode: readString(item.executionMode),
    requestedAuthority: readString(item.requestedAuthority),
    authorityProfileId: readString(item.authorityProfileId),
    lifecycleState: readString(item.lifecycleState),
    resultSummary: readString(item.resultSummary),
  });
}

function toSyntheticManagedAgentEvent(
  event: OperatorSessionEvent,
  kind: OperatorSessionEventKind,
  payload: Record<string, unknown>,
  invocationId: string,
): OperatorSessionEvent {
  return {
    eventId: `${event.eventId}:managed:${invocationId}:${kind}`,
    kilnSessionId: event.kilnSessionId,
    sequence: event.sequence,
    timestamp: event.timestamp,
    kind,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.source ? { source: event.source } : {}),
    payload,
  };
}

const MANAGED_AGENT_EVENT_KINDS: readonly OperatorSessionEventKind[] = [
  "agent_invocation_requested",
  "agent_invocation_prompt_admitted",
  "agent_invocation_prompt_recovered",
  "agent_invocation_started",
  "agent_invocation_completed",
  "agent_invocation_failed",
  "agent_invocation_cancelled",
];

const MANAGED_AGENT_WORK_ITEM_EVENT_KINDS: readonly OperatorSessionEventKind[] = [
  "work_item_updated",
  "work_item_execution_started",
  "work_item_execution_finished",
];

const MANAGED_AGENT_GOVERNANCE_REPLAY_EVENT_KINDS: readonly OperatorSessionEventKind[] = [
  "approval_requested",
  "approval_resolved",
  "goal.created",
  "goal.updated",
  "goal.completed",
  "goal.failed",
  "goal.cancelled",
  "assistant_message",
  "error_recorded",
  "turn_completed",
  "managed_economic_lifecycle",
];

function isManagedAgentReplayEventKind(kind: string): kind is OperatorSessionEventKind {
  return kind === "tool_call_started"
    || kind === "tool_call_completed"
    || MANAGED_AGENT_EVENT_KINDS.includes(kind as OperatorSessionEventKind)
    || MANAGED_AGENT_WORK_ITEM_EVENT_KINDS.includes(kind as OperatorSessionEventKind)
    || MANAGED_AGENT_GOVERNANCE_REPLAY_EVENT_KINDS.includes(kind as OperatorSessionEventKind);
}

function isManagedExternalToolReplayEvent(
  kind: OperatorSessionEventKind,
  payload: Record<string, unknown>,
): boolean {
  return (kind === "tool_call_started" || kind === "tool_call_completed")
    && readString(payload.toolName)?.startsWith("mcp:") === true
    && readString(payload.managedInvocationId) !== null
    && readString(payload.toolCallId) !== null
    && readString(payload.toolCallScopeId) !== null;
}

function matchesManagedAgentReplayEnvelopeSession(event: ManagedAgentOperatorReplayEnvelope): boolean {
  const payloadSessionId = readString(event.payload.sessionId);
  return payloadSessionId === null || payloadSessionId === event.kilnSessionId;
}

function isTerminalManagedAgentEventKind(kind: string): boolean {
  return kind === "agent_invocation_completed"
    || kind === "agent_invocation_failed"
    || kind === "agent_invocation_cancelled";
}

function isManagedOrchestrationAdoptionGate(value: Record<string, unknown>): boolean {
  return typeof value.required === "boolean"
    && isAdoptionGateStatus(value.status)
    && readString(value.childId) !== null
    && isStringArray(value.resourceUris)
    && isStringArray(value.blockingEvidence)
    && (value.rejection === undefined || isAdoptionGateRejection(value.rejection));
}

function isAdoptionGateStatus(value: unknown): boolean {
  return value === "not_required"
    || value === "pending_review"
    || value === "adopted"
    || value === "rejected"
    || value === "blocked";
}

function isAdoptionGateRejection(value: unknown): boolean {
  const rejection = asRecord(value);
  return readString(rejection.gate) !== null
    && isStringArray(rejection.evidence)
    && (rejection.summary === undefined || readString(rejection.summary) !== null)
    && (rejection.completedAt === undefined || readString(rejection.completedAt) !== null);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function readStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function readRecordArray(value: unknown): readonly Record<string, unknown>[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    ? value as readonly Record<string, unknown>[]
    : undefined;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  return Object.keys(record).length > 0 ? record : undefined;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function managedToolAgentId(metadata: Record<string, unknown>): string | undefined {
  const routeId = readString(metadata.routeId);
  const access = readString(metadata.access);
  return routeId && access ? `${routeId}:${access}` : undefined;
}

function readInvocationStatus(
  event: OperatorSessionEvent,
  payload: Record<string, unknown>,
): OperatorCockpitInvocationStatus {
  const status = readString(payload.status);
  if (status === "running" || status === "completed" || status === "failed" || status === "cancelled" || status === "requested") {
    return status;
  }
  if (event.kind === "agent_invocation_started") return "running";
  if (event.kind === "agent_invocation_completed") return "completed";
  if (event.kind === "agent_invocation_failed") return "failed";
  if (event.kind === "agent_invocation_cancelled") return "cancelled";
  if (event.kind === "agent_invocation_requested") return "requested";
  return "unknown";
}

function readToolStatus(
  event: OperatorSessionEvent,
  payload: Record<string, unknown>,
): OperatorCockpitToolStatus {
  const status = asRecord(payload.status);
  const state = readString(payload.state) ?? readString(status.state);
  if (state === "succeeded" || state === "failed" || state === "running") return state;
  if (readExternalToolFailure(payload)) return "failed";
  if (event.kind === "tool_call_started") return "running";
  if (event.kind === "tool_call_completed") return "succeeded";
  return "unknown";
}

function compareEvents(a: OperatorSessionEvent, b: OperatorSessionEvent): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  const timestampCompare = a.timestamp.localeCompare(b.timestamp);
  return timestampCompare === 0 ? a.eventId.localeCompare(b.eventId) : timestampCompare;
}

function projectionKey(...parts: readonly string[]): string {
  return parts.join("\u001f");
}

function compareByInstanceId(
  a: OperatorCockpitInstanceProjection,
  b: OperatorCockpitInstanceProjection,
): number {
  return a.instanceId.localeCompare(b.instanceId);
}

function compareByInstanceThenSession(
  a: OperatorCockpitSessionProjection,
  b: OperatorCockpitSessionProjection,
): number {
  const instanceCompare = a.instanceId.localeCompare(b.instanceId);
  return instanceCompare === 0 ? a.sessionId.localeCompare(b.sessionId) : instanceCompare;
}

function compareByInstanceThenSessionThenInvocation(
  a: OperatorCockpitInvocationProjection,
  b: OperatorCockpitInvocationProjection,
): number {
  const sessionCompare = compareProjectionLocation(a, b);
  return sessionCompare === 0 ? a.managedInvocationId.localeCompare(b.managedInvocationId) : sessionCompare;
}

function compareByInstanceThenSessionThenTool(
  a: OperatorCockpitToolSummaryProjection,
  b: OperatorCockpitToolSummaryProjection,
): number {
  const sessionCompare = compareProjectionLocation(a, b);
  return sessionCompare === 0 ? a.toolCallId.localeCompare(b.toolCallId) : sessionCompare;
}

function compareResourceLinks(
  a: OperatorCockpitResourceLinkProjection,
  b: OperatorCockpitResourceLinkProjection,
): number {
  return a.uri.localeCompare(b.uri);
}

function compareDiagnosticPointers(
  a: OperatorCockpitInvocationDiagnosticPointerProjection,
  b: OperatorCockpitInvocationDiagnosticPointerProjection,
): number {
  return a.uri.localeCompare(b.uri);
}

function compareProjectionLocation(
  a: { readonly instanceId: string; readonly sessionId: string },
  b: { readonly instanceId: string; readonly sessionId: string },
): number {
  const instanceCompare = a.instanceId.localeCompare(b.instanceId);
  return instanceCompare === 0 ? a.sessionId.localeCompare(b.sessionId) : instanceCompare;
}
