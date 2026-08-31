import type {
  ManagedAccountLeaseEvidence,
  ManagedAgentAdapterDescriptor,
  ManagedAgentAdmissionDecision,
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentLifecycleState,
  ManagedAgentObservedRuntimeAuthorityEvidence,
  ManagedAgentResourceLeaseEvidence,
  ManagedEconomicCommitment,
  ManagedEconomicExecutionReport,
  ManagedEconomicSettlement,
  ExecutionSessionBindingEvidence,
  StructuredExecutionResult,
} from "@kilnai/core";
import {
  assertManagedAgentResultHandoffContract,
  classifyManagedAgentAuthorityEvidence,
  defineManagedAgentInvocationRecord,
  defineVerificationUsageReport,
  evaluateManagedAgentAdmission,
} from "@kilnai/core";
import type { EffectiveAuthorityAdmissionBundle } from "../../session/effective-authority-admission-bundle.js";
import type { ManagedAgentArtifactDirectoryLeaseManager } from "./artifact-directory-lease-manager.js";
import {
  type ManagedAttendedTrustedExecutionContext,
  requireManagedAttendedTrustedExecution,
} from "./attended-trusted-execution.js";
import {
  assertManagedChildAuthorityAdmissionBoundary,
  type ManagedChildAuthorityAdmissionContract,
} from "./child-authority-admission.js";
import { buildManagedAgentCoordinationUsage } from "./coordination-usage.js";
import type { ManagedAgentCredentialRouteLeaseManager } from "./credential-route-lease-manager.js";
import type { ManagedAgentDevServerPortLeaseManager } from "./dev-server-port-lease-manager.js";
import { ManagedEconomicLifecycleTimeoutError } from "./economic-dispatch-coordinator.js";
import type {
  ManagedAgentEnvironmentLeaseManager,
  ManagedAgentEnvironmentVariables,
} from "./environment-lease-manager.js";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import type {
  ManagedExternalInvocationActionClaim,
  ManagedExternalInvocationActionClaimContext,
} from "./external-invocation-action-claim.js";
import {
  isInternalConsumedWriteApproval,
  type ManagedAgentRuntimeConsumedWriteApproval,
} from "./internal-consumed-write-approval.js";
import {
  assertRecordWithinAdmission,
  detectActiveWriteLeaseConflict,
  requireRuntimeAdmission,
} from "./invocation-admission-guard.js";
import {
  assertManagedEconomicCommitmentMatchesRequest,
  assertPostStartAuthority,
  capabilitySnapshotInputWithObservedRuntimeAuthority,
  capabilitySnapshotInputWithRuntimeAuthorityProjection,
  ManagedAgentRuntimeAuthorityObservationError,
  managedInvocationAbortReason,
  requiresRuntimeAuthorityProof,
} from "./invocation-authority-guard.js";
import { validateManagedEnvironment } from "./invocation-environment.js";
import {
  acquireRuntimeResourceLeases,
  currentTerminalRecord,
  finalizeTerminalLeaseStages,
  saveRuntimeRecoveryCheckpoint,
  shouldCompensateAcquireFailure,
} from "./invocation-lease-lifecycle.js";
import {
  appendProgressEvent,
  deferredTerminal,
  isTerminalLifecycleState,
  MANAGED_AGENT_OWNER_TIMEOUT_SETTLEMENT_GRACE_MS,
  notifyTerminalObserver,
  registerAdapterCompletionOnEntry,
  snapshotInvocation,
  waitForOwnerShutdownExecutionSettlement,
} from "./invocation-lifecycle-events.js";
import {
  admitPrompt as admitPromptOnEntry,
  assertValidRuntimeDate,
  claimPromptDeliveries as claimPromptDeliveriesOnEntry,
  recoverStuckPromptAdmissions as recoverStuckPromptAdmissionsOnInvocations,
} from "./invocation-prompt-delivery.js";
import {
  createCancelledRecord,
  createFailedRecord,
  createRecoveredRecord,
  createStaleRecord,
  mergeCancelledRecords,
} from "./invocation-records.js";
import {
  economicDispatchCheckpoint,
  invocationEntryFromRecoveryCheckpoint,
  isRuntimeRecoveryCleanupResolved,
  mergeRecoveredAccountLeases,
  persistedRecoveryReason,
  staleRecoveryReason,
} from "./invocation-recovery-checkpoint.js";
import type {
  ManagedAgentRuntimeEconomicDispatchCheckpoint,
  ManagedAgentRuntimeRecoveryLeaseStage,
  ManagedAgentRuntimeRecoveryStore,
} from "./recovery-store.js";
import { validateManagedAgentRuntimeRecoveryCheckpoint } from "./recovery-store.js";
import { cloneJson, toError } from "./runtime-primitives.js";
import type { ManagedAgentSandboxLeaseManager } from "./sandbox-lease-manager.js";
import type { ManagedAgentWorktreeLeaseManager } from "./worktree-lease-manager.js";

export { MANAGED_AGENT_OWNER_TIMEOUT_SETTLEMENT_GRACE_MS };

/** Runtime-owned evidence attached after Core validates the canonical record. */
export type ManagedAgentRuntimeInvocationRecord = ManagedAgentInvocationRecord & {
  readonly authorityAdmission?: EffectiveAuthorityAdmissionBundle;
};

function attachRuntimeAuthorityAdmission(
  record: ManagedAgentInvocationRecord,
  authorityAdmission: EffectiveAuthorityAdmissionBundle | undefined,
): ManagedAgentRuntimeInvocationRecord {
  return authorityAdmission === undefined ? record : { ...record, authorityAdmission };
}

function attachStructuredVerificationUsage(record: ManagedAgentInvocationRecord): ManagedAgentInvocationRecord {
  const structuredResult = record.resultHandoff?.structuredResult;
  if (!record.resultHandoff || !structuredResult || record.resultHandoff.verificationUsage) return record;
  const verificationUsage = deriveStructuredVerificationUsage(structuredResult);
  return {
    ...record,
    resultHandoff: {
      ...record.resultHandoff,
      ...(verificationUsage ? { verificationUsage } : {}),
    },
  };
}

function deriveStructuredVerificationUsage(structuredResult: StructuredExecutionResult) {
  if (structuredResult.verificationResults.length === 0) return undefined;
  return defineVerificationUsageReport({
    version: "verification-usage-v1",
    attempts: structuredResult.verificationResults.map((result) => {
      const providerFree = result.method === "deterministic" || result.method === "human-review";
      return {
        requirementId: result.requirementId,
        method: result.method,
        status: result.status,
        providerTokenClass: "input" as const,
        tokens: providerFree
          ? { value: 0 as const, source: "estimated" as const }
          : { value: "unknown" as const, source: "unknown" as const },
        costUsd:
          result.method === "deterministic"
            ? { value: 0 as const, source: "estimated" as const }
            : { value: "unknown" as const, source: "unknown" as const },
        latencyMs: { value: "unknown" as const, source: "unknown" as const },
        evidenceUris: result.evidenceUris,
      };
    }),
  });
}

export interface ManagedAgentRuntimeInvocationInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly abortSignal: AbortSignal;
  readonly workLimits?: {
    readonly maxTurns?: number;
    readonly maxDurationMs?: number;
    readonly maxConcurrency?: number;
  };
  readonly promptDelivery: ManagedAgentRuntimePromptDeliveryCoordinator;
  readonly progressObserver?: ManagedAgentRuntimeInvocationProgressObserver;
  readonly consumedWriteApproval?: ManagedAgentRuntimeConsumedWriteApproval;
  /** Narrow parent-turn authority contract committed before child dispatch. */
  readonly childAuthorityAdmission?: ManagedChildAuthorityAdmissionContract;
  /** Process-local attended destructive authority; never persisted or cloned. */
  readonly attendedTrustedExecution?: ManagedAttendedTrustedExecutionContext;
  /** Composition-owned claim boundary required by every external harness adapter. */
  readonly externalActionClaim?: ManagedExternalInvocationActionClaimContext;
  readonly environment?: ManagedAgentEnvironmentVariables;
  readonly registerAdapterCompletion: (completion: PromiseLike<unknown>) => void;
  /** Persists the exact external action claim before the adapter crosses its transport boundary. */
  readonly registerExternalActionClaim?: (claim: ManagedExternalInvocationActionClaim) => Promise<void>;
  readonly registerEconomicSettlement?: (settlement: PromiseLike<ManagedEconomicSettlement>) => void;
  readonly createEconomicSettlement?: (report: ManagedEconomicExecutionReport) => ManagedEconomicSettlement;
}

export interface ManagedAgentRuntimeCancellationInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly reason: string;
  readonly abortSignal: AbortSignal;
  readonly childAuthorityAdmission?: ManagedChildAuthorityAdmissionContract;
  readonly externalActionClaim?: ManagedExternalInvocationActionClaimContext;
}

export type ManagedAgentRuntimeCancellationResult =
  | { readonly status: "requested" }
  | { readonly status: "not-started" }
  | { readonly status: "not-active" };

export interface ManagedAgentRuntimeInvocationTerminalNotification {
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly record: ManagedAgentRuntimeInvocationRecord;
  readonly durationMs?: number;
}

export interface ManagedAgentRuntimeInvocationProgressEvent {
  readonly eventId: string;
  readonly kind: "tool_authorized" | "tool_called" | "tool_result" | "tool_cache_hit" | "error" | "provider_transport";
  readonly recordedAt: string;
  readonly summary: string;
  readonly toolName?: string;
  readonly success?: boolean;
  readonly isError?: boolean;
  readonly durationMs?: number;
  readonly resultSummary?: string;
  readonly metadata?: Record<string, unknown>;
}

export type ManagedAgentRuntimeInvocationProgressObserver = (
  event: ManagedAgentRuntimeInvocationProgressEvent,
) => void | Promise<void>;

export type ManagedAgentRuntimeInvocationTerminalObserver = (
  notification: ManagedAgentRuntimeInvocationTerminalNotification,
) => void | Promise<void>;

export interface ManagedAgentRuntimeInvocationLifecycleOptions {
  readonly abortSignal?: AbortSignal;
  readonly workLimits?: ManagedAgentRuntimeInvocationInput["workLimits"];
  readonly terminalObserver?: ManagedAgentRuntimeInvocationTerminalObserver;
  readonly consumedWriteApproval?: ManagedAgentRuntimeConsumedWriteApproval;
  /** Narrow parent-turn authority contract committed before child dispatch. */
  readonly childAuthorityAdmission?: ManagedChildAuthorityAdmissionContract;
  /** Process-local attended destructive authority; never persisted or cloned. */
  readonly attendedTrustedExecution?: ManagedAttendedTrustedExecutionContext;
  /** Runtime-only identity for the attached surface that owns child cleanup. */
  readonly owner?: object;
  readonly economicDispatch?: {
    readonly commitment: ManagedEconomicCommitment;
    readonly dispatchFenceId: string;
    readonly recordExecutionSettlementPending: (reason: string) => void;
    readonly createExecutionSettlement: (report: ManagedEconomicExecutionReport) => ManagedEconomicSettlement;
    readonly registerEconomicSettlement: (settlement: PromiseLike<ManagedEconomicSettlement>) => void;
  };
}

export interface ManagedAgentRuntimeAdapter {
  readonly descriptor: ManagedAgentAdapterDescriptor;
  /** Exact secret-free binding materialized after account commitment. */
  readonly executionBinding?: Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>;
  invoke(input: ManagedAgentRuntimeInvocationInput): Promise<ManagedAgentInvocationRecord>;
  cancel?(input: ManagedAgentRuntimeCancellationInput): Promise<ManagedAgentRuntimeCancellationResult>;
}

export interface ManagedAgentRuntimeAuthorityObservationInput {
  readonly phase: "pre-start" | "post-start" | "recovery";
  readonly request: ManagedAgentInvocationRequest;
  readonly adapterDescriptor: ManagedAgentAdapterDescriptor;
  readonly abortSignal?: AbortSignal;
}

export interface ManagedAgentRuntimeAuthorityObserver {
  observe(input: ManagedAgentRuntimeAuthorityObservationInput): Promise<ManagedAgentObservedRuntimeAuthorityEvidence>;
}

export interface RuntimeManagedAgentInvocationServiceOptions {
  readonly worktreeLeaseManager?: ManagedAgentWorktreeLeaseManager;
  readonly sandboxLeaseManager?: ManagedAgentSandboxLeaseManager;
  readonly artifactDirectoryLeaseManager?: ManagedAgentArtifactDirectoryLeaseManager;
  readonly devServerPortLeaseManager?: ManagedAgentDevServerPortLeaseManager;
  readonly environmentLeaseManager?: ManagedAgentEnvironmentLeaseManager;
  readonly credentialRouteLeaseManager?: ManagedAgentCredentialRouteLeaseManager;
  readonly recoveryStore?: ManagedAgentRuntimeRecoveryStore;
  readonly authorityObserver?: ManagedAgentRuntimeAuthorityObserver;
  /** Durable owner for CLI/remote external action claims. */
  readonly externalActionClaim?: ManagedExternalInvocationActionClaimContext;
  readonly clock?: () => Date;
}

/** Honest remote nonterminal evidence while authoritative terminal state is unproved. */
export type ManagedAgentRuntimeResultPendingEvidence =
  | {
      readonly outcome: "unknown";
      readonly basis: "cancellation-request";
      readonly observedAt: string;
      readonly reason: string;
      readonly cancellation: {
        readonly requestOutcome: "acknowledged" | "unknown" | "not-requested";
        readonly failureMessage?: string;
      };
    }
  | {
      readonly outcome: "unknown";
      readonly basis: "external-action-claim";
      readonly observedAt: string;
      readonly reason: string;
      readonly externalClaimId: ManagedExternalInvocationActionClaim["claimId"];
    };

export interface ManagedAgentRuntimeInvocationSnapshot {
  readonly invocationId: string;
  readonly agentId: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
  readonly access: ManagedAgentInvocationRequest["access"];
  readonly providerRoute: ManagedAgentInvocationRequest["providerRoute"];
  readonly adapterKind: ManagedAgentInvocationRequest["adapterKind"];
  readonly executionMode: ManagedAgentInvocationRequest["executionMode"];
  readonly authorityProfileId: string;
  readonly lifecycleState: ManagedAgentLifecycleState;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly record?: ManagedAgentRuntimeInvocationRecord;
  readonly progressEvents?: readonly ManagedAgentRuntimeInvocationProgressEvent[];
  readonly promptInbox?: readonly ManagedAgentRuntimePromptAdmissionRecord[];
  readonly error?: {
    readonly message: string;
  };
  readonly resultPending?: ManagedAgentRuntimeResultPendingEvidence;
}

export type ManagedAgentRuntimePromptDeliveryMode = "steer" | "queue";
export type ManagedAgentRuntimePromptDeliveryState = "available" | "queued" | "delivered" | "stale";
export type ManagedAgentRuntimePromptDeliveryBoundary = "immediate" | "safe-turn";

export interface ManagedAgentRuntimePromptAdmissionRecord {
  readonly promptAdmissionId: string;
  readonly invocationId: string;
  readonly agentId: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
  readonly prompt: string;
  readonly inputSummary: string;
  readonly promptHash: string;
  readonly deliveryMode: ManagedAgentRuntimePromptDeliveryMode;
  readonly deliveryState: ManagedAgentRuntimePromptDeliveryState;
  readonly wakeRequested: boolean;
  readonly requestedBy?: string;
  readonly requestSource?: string;
  readonly admittedAt: string;
  readonly updatedAt: string;
  readonly deliveredAt?: string;
  readonly recovery?: {
    readonly reason: string;
    readonly recoveredAt: string;
  };
}

export interface ManagedAgentRuntimePromptAdmissionInput {
  readonly invocationId: string;
  readonly promptAdmissionId?: string;
  readonly prompt: string;
  readonly deliveryMode: ManagedAgentRuntimePromptDeliveryMode;
  readonly wakeRequested: boolean;
  readonly requestedBy?: string;
  readonly requestSource?: string;
  readonly admittedAt?: Date;
}

export interface ManagedAgentRuntimePromptAdmissionResult {
  readonly status: "admitted";
  readonly prompt: ManagedAgentRuntimePromptAdmissionRecord;
}

export interface ManagedAgentRuntimePromptDeliveryClaimInput {
  readonly invocationId: string;
  readonly boundary: ManagedAgentRuntimePromptDeliveryBoundary;
  readonly claimedAt?: Date;
}

export interface ManagedAgentRuntimePromptDeliveryClaimResult {
  readonly claimed: readonly ManagedAgentRuntimePromptAdmissionRecord[];
}

export interface ManagedAgentRuntimePromptDeliveryCoordinator {
  claim(input: {
    readonly boundary: ManagedAgentRuntimePromptDeliveryBoundary;
    readonly claimedAt?: Date;
  }): ManagedAgentRuntimePromptDeliveryClaimResult;
}

export interface ManagedAgentRuntimePromptStuckRecoveryInput {
  readonly staleAfterMs: number;
  readonly now?: Date;
  readonly reason?: string;
}

export interface ManagedAgentRuntimePromptStuckRecoveryResult {
  readonly recovered: readonly ManagedAgentRuntimePromptAdmissionRecord[];
}

export type ManagedAgentRuntimeInvocationResult =
  | {
      readonly status: "completed";
      readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
      readonly record: ManagedAgentRuntimeInvocationRecord;
    }
  | {
      readonly status: "denied";
      readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "denied" }>;
    };

export type ManagedAgentRuntimeInvocationStartResult =
  | {
      readonly status: "started";
      readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
      readonly snapshot: ManagedAgentRuntimeInvocationSnapshot;
    }
  | {
      readonly status: "denied";
      readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "denied" }>;
    };

export type ManagedAgentRuntimeInvocationCancelResult =
  | {
      readonly status: "cancelled";
      readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
      readonly record: ManagedAgentRuntimeInvocationRecord;
    }
  | {
      readonly status: "result_pending";
      readonly outcome: "unknown";
      readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
      readonly cancellation: Extract<
        ManagedAgentRuntimeResultPendingEvidence,
        { readonly basis: "cancellation-request" }
      >["cancellation"];
    };

export interface ManagedAgentStaleRecoveryInput {
  readonly staleAfterMs: number;
  readonly now?: Date;
  readonly reason?: string;
}

export interface ManagedAgentPersistentRecoveryInput {
  readonly now?: Date;
  readonly reason?: string;
}

export interface ManagedAgentStaleRecoveryResult {
  readonly recovered: readonly ManagedAgentRuntimeInvocationSnapshot[];
}

export interface ManagedAgentPersistentRecoveryResult extends ManagedAgentStaleRecoveryResult {
  readonly accountLeases: readonly ManagedAccountLeaseEvidence[];
}

export interface ManagedAgentRuntimeInvocationTerminal {
  readonly promise: Promise<Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>>;
  readonly resolve: (value: Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>) => void;
  readonly reject: (reason?: unknown) => void;
}

export interface ManagedAgentRuntimeInvocationEntry {
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  adapter?: ManagedAgentRuntimeAdapter;
  lifecycleState: ManagedAgentLifecycleState;
  readonly startedAt: Date;
  readonly abortController: AbortController;
  runtimeLease?: ManagedAgentResourceLeaseEvidence;
  runtimeLeaseForRelease?: ManagedAgentResourceLeaseEvidence;
  runtimeEnvironment?: ManagedAgentEnvironmentVariables;
  environmentValueLeakingUris?: readonly string[];
  acquiredLeaseStages: ManagedAgentRuntimeRecoveryLeaseStage[];
  releasedLeaseStages: ManagedAgentRuntimeRecoveryLeaseStage[];
  promptInbox: ManagedAgentRuntimePromptAdmissionRecord[];
  progressEvents: ManagedAgentRuntimeInvocationProgressEvent[];
  adapterStarted: boolean;
  economicDispatch?: ManagedAgentRuntimeEconomicDispatchCheckpoint;
  parentAbortCleanup?: () => void;
  leaseFinalization?: Promise<ManagedAgentInvocationRecord>;
  finishedAt?: Date;
  record?: ManagedAgentInvocationRecord;
  error?: Error;
  terminal?: ManagedAgentRuntimeInvocationTerminal;
  terminalObserver?: ManagedAgentRuntimeInvocationTerminalObserver;
  terminalObserverNotified?: boolean;
  terminalObserverSettlement?: Promise<void>;
  adapterCompletion?: Promise<void>;
  adapterSettlement?: Promise<void>;
  resultPending?: ManagedAgentRuntimeResultPendingEvidence;
  externalActionClaim?: ManagedExternalInvocationActionClaim;
  readonly owner?: object;
  readonly childAuthorityAdmission?: ManagedChildAuthorityAdmissionContract;
}

export class RuntimeManagedAgentInvocationService {
  private readonly invocations = new Map<string, ManagedAgentRuntimeInvocationEntry>();
  private externalActionClaim: ManagedExternalInvocationActionClaimContext | undefined;
  #closed = false;

  constructor(private readonly options: RuntimeManagedAgentInvocationServiceOptions = {}) {
    this.externalActionClaim = options.externalActionClaim;
  }

  /** Releases composition-owned external action-claim state exactly once. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.externalActionClaim?.store.close();
  }

  /** Composition guard for routes whose adapter can cause an external effect. */
  assertExternalActionClaimConfigured(): void {
    if (this.externalActionClaim === undefined) {
      throw new ManagedAgentRuntimeAdmissionError(
        "Managed external harness routes require a durable external action-claim store.",
      );
    }
  }

  hasExternalActionClaimConfigured(): boolean {
    return this.externalActionClaim !== undefined;
  }

  /**
   * Attaches the composition-owned durable claim boundary before a route is
   * exposed.  Route catalogs can discover an external harness after the
   * service was first composed, so the boundary must be attachable without
   * replacing the service (and its lease/recovery state).
   */
  configureExternalActionClaim(context: ManagedExternalInvocationActionClaimContext): void {
    if (this.#closed) {
      throw new ManagedAgentRuntimeAdmissionError(
        "Cannot configure an external action-claim store after the managed invocation service is closed.",
      );
    }
    if (this.externalActionClaim !== undefined && this.externalActionClaim !== context) {
      throw new ManagedAgentRuntimeAdmissionError(
        "Managed invocation service cannot be rebound to a different external action-claim store.",
      );
    }
    this.externalActionClaim = context;
  }

  async invoke(
    request: ManagedAgentInvocationRequest,
    adapter: ManagedAgentRuntimeAdapter,
    capabilitySnapshotInput: ManagedAgentCapabilitySnapshotInput,
    lifecycleOptions: ManagedAgentRuntimeInvocationLifecycleOptions = {},
  ): Promise<ManagedAgentRuntimeInvocationResult> {
    const started = await this.start(request, adapter, capabilitySnapshotInput, lifecycleOptions);
    if (started.status === "denied") {
      return {
        status: "denied",
        decision: started.decision,
      };
    }
    return this.join(started.snapshot.invocationId);
  }

  async start(
    request: ManagedAgentInvocationRequest,
    adapter: ManagedAgentRuntimeAdapter,
    capabilitySnapshotInput: ManagedAgentCapabilitySnapshotInput,
    lifecycleOptions: ManagedAgentRuntimeInvocationLifecycleOptions = {},
  ): Promise<ManagedAgentRuntimeInvocationStartResult> {
    if (this.#closed) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation service is closed");
    }
    const recordEconomicPending = async (reason: string): Promise<void> => {
      await lifecycleOptions.economicDispatch?.recordExecutionSettlementPending(reason);
    };
    let committedAuthorityAdmission: EffectiveAuthorityAdmissionBundle | undefined;
    let attendedTrustedExecution: ManagedAttendedTrustedExecutionContext | undefined;
    try {
      if (this.invocations.has(request.invocationId)) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation is already registered");
      }
      if (request.authority.credentialRoute.mode === "account-leased" && !lifecycleOptions.economicDispatch) {
        throw new ManagedAgentRuntimeAdmissionError(
          "Runtime-selected managed invocation requires a durable economic commitment and postcommit dispatch support.",
        );
      }
      if (lifecycleOptions.economicDispatch) {
        assertManagedEconomicCommitmentMatchesRequest(
          request,
          capabilitySnapshotInput.routeId,
          lifecycleOptions.economicDispatch.commitment,
        );
      }
      if (lifecycleOptions.consumedWriteApproval) {
        assertConsumedWriteApproval(request, capabilitySnapshotInput.routeId, lifecycleOptions.consumedWriteApproval);
      }
      if (lifecycleOptions.childAuthorityAdmission) {
        committedAuthorityAdmission = assertManagedChildAuthorityAdmissionBoundary({
          bundle: lifecycleOptions.childAuthorityAdmission.bundle,
          request,
          ...(lifecycleOptions.economicDispatch
            ? { economicCommitmentId: lifecycleOptions.economicDispatch.commitment.commitmentId }
            : {}),
        });
      }
      attendedTrustedExecution = requireManagedAttendedTrustedExecution({
        now: this.now(),
        request,
        adapterDescriptor: adapter.descriptor,
        capabilitySnapshotInput,
        ...(committedAuthorityAdmission === undefined
          ? {}
          : { childAuthorityAdmission: { bundle: committedAuthorityAdmission } }),
        economicDispatchPresent: lifecycleOptions.economicDispatch !== undefined,
        ...(lifecycleOptions.attendedTrustedExecution === undefined
          ? {}
          : { context: lifecycleOptions.attendedTrustedExecution }),
      });
    } catch (error) {
      await recordEconomicPending("runtime-prestart-validation-failed");
      throw error;
    }

    let admittedSnapshotInput: ManagedAgentCapabilitySnapshotInput;
    try {
      admittedSnapshotInput =
        this.options.authorityObserver === undefined
          ? capabilitySnapshotInputWithRuntimeAuthorityProjection(request, adapter, capabilitySnapshotInput, this.now())
          : await capabilitySnapshotInputWithObservedRuntimeAuthority(
              this.options,
              () => this.now(),
              request,
              adapter,
              capabilitySnapshotInput,
              lifecycleOptions.abortSignal,
            );
    } catch (error) {
      await recordEconomicPending("runtime-authority-observation-failed");
      throw error;
    }
    const decision = evaluateManagedAgentAdmission(request, adapter.descriptor, admittedSnapshotInput, {
      evaluatedAt: this.now().toISOString(),
    });
    if (decision.status === "denied") {
      await recordEconomicPending("runtime-admission-denied");
      return {
        status: "denied",
        decision: cloneJson(decision),
      };
    }
    const writeLeaseConflict = detectActiveWriteLeaseConflict(this.invocations, request, decision);
    if (writeLeaseConflict) {
      await recordEconomicPending("runtime-write-lease-conflict");
      return {
        status: "denied",
        decision: cloneJson(writeLeaseConflict),
      };
    }

    const registeredRequest = cloneJson(request);
    const registeredDecision = cloneJson(decision);
    const terminal = deferredTerminal();
    const abortController = new AbortController();
    const entry: ManagedAgentRuntimeInvocationEntry = {
      request: registeredRequest,
      decision: registeredDecision,
      adapter,
      lifecycleState: "running",
      startedAt: new Date(),
      abortController,
      acquiredLeaseStages: [],
      releasedLeaseStages: [],
      promptInbox: [],
      progressEvents: [],
      adapterStarted: false,
      ...(lifecycleOptions.economicDispatch !== undefined
        ? { economicDispatch: economicDispatchCheckpoint(lifecycleOptions.economicDispatch) }
        : {}),
      terminal,
      ...(lifecycleOptions.owner !== undefined ? { owner: lifecycleOptions.owner } : {}),
      ...(committedAuthorityAdmission !== undefined
        ? { childAuthorityAdmission: { bundle: committedAuthorityAdmission } }
        : {}),
      ...(lifecycleOptions.terminalObserver !== undefined
        ? { terminalObserver: lifecycleOptions.terminalObserver }
        : {}),
    };
    terminal.promise.catch(() => undefined);
    this.invocations.set(request.invocationId, entry);
    entry.parentAbortCleanup = this.bindParentAbortSignal(entry, lifecycleOptions.abortSignal);
    terminal.promise
      .finally(() => {
        entry.parentAbortCleanup?.();
        entry.parentAbortCleanup = undefined;
      })
      .catch(() => undefined);
    if (lifecycleOptions.abortSignal?.aborted) {
      await this.cancel(request.invocationId, managedInvocationAbortReason(lifecycleOptions.abortSignal.reason));
      if (entry.lifecycleState === "cancelled" && entry.record) {
        await recordEconomicPending("runtime-cancelled-before-adapter-start");
        return this.completePreAdapterTerminalStart(entry, registeredDecision);
      }
    }
    try {
      await acquireRuntimeResourceLeases(this.options, entry);
    } catch (error) {
      await recordEconomicPending("runtime-resource-lease-acquisition-failed");
      if ((entry.lifecycleState === "cancelled" || entry.lifecycleState === "stale") && entry.record) {
        return this.completePreAdapterTerminalStart(entry, registeredDecision);
      }
      const runtimeError = toError(error);
      if (!shouldCompensateAcquireFailure(entry)) {
        this.invocations.delete(request.invocationId);
        terminal.reject(runtimeError);
        throw runtimeError;
      }
      entry.runtimeLease = entry.runtimeLease ?? registeredDecision.capabilitySnapshot.resourceLease;
      entry.runtimeLeaseForRelease = entry.runtimeLeaseForRelease ?? entry.runtimeLease;
      entry.finishedAt = new Date();
      entry.lifecycleState = "failed";
      entry.error = runtimeError;
      entry.record = await finalizeTerminalLeaseStages(
        this.options,
        entry,
        createFailedRecord(entry.request, entry.decision, runtimeError.message),
      );
      notifyTerminalObserver(entry);
      terminal.reject(runtimeError);
      throw runtimeError;
    }
    if (entry.lifecycleState === "cancelled" && entry.record) {
      await recordEconomicPending("runtime-cancelled-before-adapter-start");
      return this.completePreAdapterTerminalStart(entry, registeredDecision);
    }
    if (entry.lifecycleState === "stale" && entry.record) {
      await recordEconomicPending("runtime-stale-before-adapter-start");
      return this.completePreAdapterTerminalStart(entry, registeredDecision);
    }
    const executableAdapter = entry.adapter;
    if (executableAdapter === undefined) {
      await recordEconomicPending("runtime-adapter-unavailable");
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation has no executable adapter");
    }
    let signalDispatchReady!: () => void;
    const dispatchReady = new Promise<void>((resolve) => {
      signalDispatchReady = resolve;
    });
    let dispatchPhase: "poststart-authority" | "recovery-checkpoint" | "adapter-execution" = "poststart-authority";
    const authorityCheckedInvocation = assertPostStartAuthority(
      this.options,
      () => this.now(),
      request,
      executableAdapter,
      registeredDecision,
      abortController,
    )
      .then(() => {
        entry.adapterStarted = true;
        const invoke = () =>
          this.invokeAdmitted({
            request: cloneJson(registeredRequest),
            adapter: executableAdapter,
            admission: cloneJson(registeredDecision),
            abortSignal: abortController.signal,
            ...(lifecycleOptions.workLimits ? { workLimits: lifecycleOptions.workLimits } : {}),
            promptDelivery: this.promptDeliveryCoordinator(registeredRequest.invocationId),
            progressObserver: (event) => appendProgressEvent(entry, event),
            ...(lifecycleOptions.consumedWriteApproval
              ? { consumedWriteApproval: lifecycleOptions.consumedWriteApproval }
              : {}),
            ...(committedAuthorityAdmission !== undefined
              ? { childAuthorityAdmission: { bundle: committedAuthorityAdmission } }
              : {}),
            ...(attendedTrustedExecution !== undefined ? { attendedTrustedExecution } : {}),
            ...(this.externalActionClaim !== undefined ? { externalActionClaim: this.externalActionClaim } : {}),
            registerAdapterCompletion: (completion) => {
              registerAdapterCompletionOnEntry(entry, completion);
            },
            registerExternalActionClaim: async (claim) => {
              if (claim.invocationId !== entry.request.invocationId || claim.effectKind !== "remote-invoke") {
                throw new ManagedAgentRuntimeAdmissionError(
                  "Managed remote invocation registered a contradictory external action claim.",
                );
              }
              entry.externalActionClaim = cloneJson(claim);
              try {
                await saveRuntimeRecoveryCheckpoint(this.options, entry);
              } catch (error) {
                delete entry.externalActionClaim;
                throw error;
              }
            },
            ...(lifecycleOptions.economicDispatch
              ? {
                  registerEconomicSettlement: lifecycleOptions.economicDispatch.registerEconomicSettlement,
                  createEconomicSettlement: lifecycleOptions.economicDispatch.createExecutionSettlement,
                }
              : {}),
            ...(entry.runtimeEnvironment !== undefined ? { environment: cloneJson(entry.runtimeEnvironment) } : {}),
          });
        const beginInvocation = () => {
          dispatchPhase = "adapter-execution";
          signalDispatchReady();
          return invoke();
        };
        if (!this.options.recoveryStore) return beginInvocation();
        dispatchPhase = "recovery-checkpoint";
        return saveRuntimeRecoveryCheckpoint(this.options, entry).then(beginInvocation);
      })
      .catch(async (error: unknown) => {
        const reason =
          dispatchPhase === "poststart-authority"
            ? "runtime-poststart-authority-failed"
            : dispatchPhase === "recovery-checkpoint"
              ? "runtime-recovery-checkpoint-failed"
              : "runtime-adapter-execution-failed";
        await recordEconomicPending(reason);
        signalDispatchReady();
        throw error;
      });
    const adapterTerminal: Promise<Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>> =
      authorityCheckedInvocation.then(
        async (record) => {
          delete entry.resultPending;
          if (entry.lifecycleState === "failed" && entry.record) {
            const failedRecord = await currentTerminalRecord(entry);
            return {
              status: "completed",
              decision: registeredDecision,
              record: failedRecord,
            } as const;
          }
          if (entry.lifecycleState === "stale" && entry.record) {
            const staleRecord = await currentTerminalRecord(entry);
            return {
              status: "completed",
              decision: registeredDecision,
              record: staleRecord,
            } as const;
          }
          if (entry.lifecycleState === "cancelled" && entry.record) {
            if (record.lifecycleState === "cancelled") {
              const registeredRecord = cloneJson(record);
              entry.finishedAt = new Date();
              entry.record = await finalizeTerminalLeaseStages(
                this.options,
                entry,
                mergeCancelledRecords(entry.record, registeredRecord),
              );
              return {
                status: "completed",
                decision: registeredDecision,
                record: entry.record,
              } as const;
            }
            if (record.lifecycleState === "failed") {
              // An external harness may have consumed its action claim before the
              // parent cancellation was observed. Preserve its explicit
              // failed/unknown terminal record and evidence; successful or
              // recovered late output cannot overwrite Runtime cancellation.
              entry.finishedAt = new Date();
              entry.lifecycleState = record.lifecycleState;
              entry.record = await finalizeTerminalLeaseStages(this.options, entry, cloneJson(record));
            } else {
              entry.record = await finalizeTerminalLeaseStages(this.options, entry, entry.record);
            }
            return {
              status: "completed",
              decision: registeredDecision,
              record: entry.record,
            } as const;
          }
          const registeredRecord = cloneJson(record);
          entry.finishedAt = new Date();
          entry.lifecycleState = registeredRecord.lifecycleState;
          entry.record = await finalizeTerminalLeaseStages(this.options, entry, registeredRecord);
          return {
            status: "completed",
            decision: registeredDecision,
            record: entry.record,
          } as const;
        },
        async (error: unknown) => {
          if (entry.lifecycleState === "failed" && entry.record) {
            const failedRecord = await currentTerminalRecord(entry);
            return {
              status: "completed",
              decision: registeredDecision,
              record: failedRecord,
            } as const;
          }
          if (entry.lifecycleState === "cancelled" && entry.record) {
            entry.record = await finalizeTerminalLeaseStages(this.options, entry, entry.record);
            return {
              status: "completed",
              decision: registeredDecision,
              record: entry.record,
            } as const;
          }
          const runtimeError = toError(error);
          if (entry.resultPending !== undefined) {
            entry.error = runtimeError;
            await saveRuntimeRecoveryCheckpoint(this.options, entry);
            return new Promise<never>(() => undefined);
          }
          if (entry.lifecycleState === "stale" && entry.record) {
            const staleRecord = await currentTerminalRecord(entry);
            return {
              status: "completed",
              decision: registeredDecision,
              record: staleRecord,
            } as const;
          }
          entry.finishedAt = new Date();
          entry.lifecycleState = "failed";
          entry.error = runtimeError;
          entry.record = await finalizeTerminalLeaseStages(
            this.options,
            entry,
            createFailedRecord(entry.request, entry.decision, runtimeError.message),
          );
          if (runtimeError instanceof ManagedAgentRuntimeAuthorityObservationError) {
            return {
              status: "completed",
              decision: registeredDecision,
              record: entry.record,
            } as const;
          }
          throw runtimeError;
        },
      );
    adapterTerminal.then(
      (result) => {
        terminal.resolve(result);
        notifyTerminalObserver(entry);
      },
      (error) => {
        terminal.reject(error);
        notifyTerminalObserver(entry);
      },
    );
    adapterTerminal.catch(() => undefined);
    entry.adapterSettlement = adapterTerminal.then(
      () => undefined,
      () => undefined,
    );
    if (this.options.recoveryStore) {
      await dispatchReady;
    }

    return {
      status: "started",
      decision: cloneJson(registeredDecision),
      snapshot: snapshotInvocation(entry),
    };
  }

  status(invocationId: string): ManagedAgentRuntimeInvocationSnapshot | undefined {
    const entry = this.invocations.get(invocationId);
    return entry ? snapshotInvocation(entry) : undefined;
  }

  list(): readonly ManagedAgentRuntimeInvocationSnapshot[] {
    return Array.from(this.invocations.values(), snapshotInvocation);
  }

  admitPrompt(input: ManagedAgentRuntimePromptAdmissionInput): ManagedAgentRuntimePromptAdmissionResult {
    const entry = this.invocations.get(input.invocationId);
    if (!entry) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation is not registered");
    }
    return admitPromptOnEntry(entry, input);
  }

  claimPromptDeliveries(
    input: ManagedAgentRuntimePromptDeliveryClaimInput,
  ): ManagedAgentRuntimePromptDeliveryClaimResult {
    const entry = this.invocations.get(input.invocationId);
    if (!entry) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation is not registered");
    }
    return claimPromptDeliveriesOnEntry(entry, input);
  }

  recoverStuckPromptAdmissions(
    input: ManagedAgentRuntimePromptStuckRecoveryInput,
  ): ManagedAgentRuntimePromptStuckRecoveryResult {
    return recoverStuckPromptAdmissionsOnInvocations(this.invocations, input);
  }

  async cancel(
    invocationId: string,
    reason = "Managed invocation cancelled.",
  ): Promise<ManagedAgentRuntimeInvocationCancelResult> {
    const entry = this.invocations.get(invocationId);
    if (!entry) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation is not registered");
    }
    if (entry.record?.lifecycleState === "cancelled") {
      const record = await currentTerminalRecord(entry);
      return {
        status: "cancelled",
        decision: cloneJson(entry.decision),
        record: cloneJson(record),
      };
    }
    if (entry.resultPending !== undefined) {
      return resultPendingCancellation(entry);
    }
    if (isTerminalLifecycleState(entry.lifecycleState)) {
      throw new ManagedAgentRuntimeAdmissionError(
        `Managed agent runtime invocation is already terminal: ${entry.lifecycleState}`,
      );
    }

    if (entry.adapterStarted && entry.request.executionMode === "remote-harness") {
      let cancellation: Extract<
        ManagedAgentRuntimeResultPendingEvidence,
        { readonly basis: "cancellation-request" }
      >["cancellation"];
      if (entry.adapter?.cancel === undefined) {
        cancellation = {
          requestOutcome: "not-requested",
          failureMessage: "Remote adapter does not expose a cancellation request port.",
        };
      } else {
        try {
          const cancellationResult = await entry.adapter.cancel({
            request: cloneJson(entry.request),
            admission: cloneJson(entry.decision),
            reason,
            abortSignal: new AbortController().signal,
            ...(entry.childAuthorityAdmission !== undefined
              ? { childAuthorityAdmission: entry.childAuthorityAdmission }
              : {}),
            ...(this.externalActionClaim !== undefined ? { externalActionClaim: this.externalActionClaim } : {}),
          });
          if (cancellationResult.status === "not-started") {
            entry.abortController.abort(reason);
            entry.finishedAt = new Date();
            entry.lifecycleState = "cancelled";
            entry.record = await finalizeTerminalLeaseStages(
              this.options,
              entry,
              createCancelledRecord(entry.request, entry.decision, reason),
            );
            entry.terminal?.resolve({ status: "completed", decision: entry.decision, record: entry.record });
            notifyTerminalObserver(entry);
            return {
              status: "cancelled",
              decision: cloneJson(entry.decision),
              record: cloneJson(entry.record),
            };
          }
          cancellation =
            cancellationResult.status === "requested"
              ? { requestOutcome: "acknowledged" }
              : {
                  requestOutcome: "not-requested",
                  failureMessage:
                    "Remote invocation was no longer active before a cancellation action could be claimed.",
                };
        } catch (error) {
          cancellation = {
            requestOutcome: "unknown",
            failureMessage: toError(error).message,
          };
        }
      }
      entry.resultPending = {
        outcome: "unknown",
        basis: "cancellation-request",
        observedAt: this.now().toISOString(),
        reason,
        cancellation,
      };
      await saveRuntimeRecoveryCheckpoint(this.options, entry);
      return resultPendingCancellation(entry);
    }

    if (entry.adapterStarted && entry.adapter?.cancel !== undefined) {
      try {
        await entry.adapter.cancel({
          request: cloneJson(entry.request),
          admission: cloneJson(entry.decision),
          reason,
          abortSignal: new AbortController().signal,
          ...(entry.childAuthorityAdmission !== undefined
            ? { childAuthorityAdmission: entry.childAuthorityAdmission }
            : {}),
          ...(this.externalActionClaim !== undefined ? { externalActionClaim: this.externalActionClaim } : {}),
        });
      } catch (error) {
        const runtimeError = toError(error);
        entry.abortController.abort(reason);
        entry.finishedAt = new Date();
        entry.lifecycleState = "failed";
        entry.error = runtimeError;
        entry.record = await finalizeTerminalLeaseStages(
          this.options,
          entry,
          createFailedRecord(
            entry.request,
            entry.decision,
            `Managed invocation cancellation failed: ${runtimeError.message}`,
          ),
        );
        entry.terminal?.resolve({
          status: "completed",
          decision: entry.decision,
          record: entry.record,
        });
        notifyTerminalObserver(entry);
        throw runtimeError;
      }
    }

    entry.abortController.abort(reason);
    entry.finishedAt = new Date();
    entry.lifecycleState = "cancelled";
    entry.record = createCancelledRecord(entry.request, entry.decision, reason);
    if (!entry.adapterStarted) {
      return {
        status: "cancelled",
        decision: cloneJson(entry.decision),
        record: cloneJson(entry.record),
      };
    }
    entry.record = await finalizeTerminalLeaseStages(this.options, entry, entry.record);
    entry.terminal?.resolve({
      status: "completed",
      decision: entry.decision,
      record: entry.record,
    });
    notifyTerminalObserver(entry);
    return {
      status: "cancelled",
      decision: cloneJson(entry.decision),
      record: cloneJson(entry.record),
    };
  }

  async shutdownOwner(
    owner: object,
    reason = "Managed invocation owner disposed.",
  ): Promise<readonly ManagedAgentRuntimeInvocationSnapshot[]> {
    const ownedEntries = [...this.invocations.values()].filter((entry) => entry.owner === owner);
    const activeEntries = ownedEntries.filter((entry) => !isTerminalLifecycleState(entry.lifecycleState));

    await Promise.allSettled(activeEntries.map((entry) => this.cancel(entry.request.invocationId, reason)));
    await Promise.all(
      ownedEntries.map(async (entry) => {
        if (entry.resultPending !== undefined) {
          await saveRuntimeRecoveryCheckpoint(this.options, entry);
          return;
        }
        await waitForOwnerShutdownExecutionSettlement(entry);
        await entry.adapterSettlement;
        await entry.leaseFinalization;
        await entry.terminalObserverSettlement;
      }),
    );

    return ownedEntries.map(snapshotInvocation);
  }

  async join(invocationId: string): Promise<ManagedAgentRuntimeInvocationResult> {
    const entry = this.invocations.get(invocationId);
    if (!entry) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation is not registered");
    }
    if (!entry.terminal) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation has no terminal wait handle");
    }
    const result = await entry.terminal.promise;
    const record = entry.record ?? result.record;
    return {
      status: "completed",
      decision: cloneJson(result.decision),
      record: cloneJson(record),
    };
  }

  async recoverStaleInvocations(input: ManagedAgentStaleRecoveryInput): Promise<ManagedAgentStaleRecoveryResult> {
    if (!Number.isFinite(input.staleAfterMs) || input.staleAfterMs <= 0) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent stale threshold must be greater than zero");
    }
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent stale recovery timestamp is invalid");
    }
    const reason = staleRecoveryReason(input.reason);
    const recovered: ManagedAgentRuntimeInvocationSnapshot[] = [];

    for (const entry of this.invocations.values()) {
      if (isTerminalLifecycleState(entry.lifecycleState) || entry.resultPending !== undefined) {
        continue;
      }
      const ageMs = now.getTime() - entry.startedAt.getTime();
      if (ageMs < input.staleAfterMs) {
        continue;
      }
      entry.abortController.abort(reason);
      entry.finishedAt = now;
      entry.lifecycleState = "stale";
      entry.record = createStaleRecord(entry.request, entry.decision, reason);
      entry.record = await finalizeTerminalLeaseStages(this.options, entry, entry.record);
      entry.terminal?.resolve({
        status: "completed",
        decision: entry.decision,
        record: entry.record,
      });
      notifyTerminalObserver(entry);
      recovered.push(snapshotInvocation(entry));
    }

    return {
      recovered: cloneJson(recovered),
    };
  }

  async recoverPersistedInvocations(
    input: ManagedAgentPersistentRecoveryInput = {},
  ): Promise<ManagedAgentPersistentRecoveryResult> {
    const recoverableCheckpoints = this.options.recoveryStore
      ? (await this.options.recoveryStore.listRecoverable()).map(validateManagedAgentRuntimeRecoveryCheckpoint)
      : [];
    if (!this.options.recoveryStore) {
      return { recovered: [], accountLeases: [] };
    }
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent persisted recovery timestamp is invalid");
    }
    const reason = persistedRecoveryReason(input.reason);
    const recovered: ManagedAgentRuntimeInvocationSnapshot[] = [];

    for (const checkpoint of recoverableCheckpoints) {
      if (checkpoint.record !== undefined && isTerminalLifecycleState(checkpoint.lifecycleState)) {
        const accountLeaseResolved =
          checkpoint.accountLease === undefined || checkpoint.accountLease.lifecycleState === "released";
        if (isRuntimeRecoveryCleanupResolved(checkpoint.record.resourceLease?.cleanupStatus) && accountLeaseResolved) {
          await this.options.recoveryStore.delete(checkpoint.request.invocationId);
        }
        continue;
      }
      if (this.invocations.has(checkpoint.request.invocationId)) {
        continue;
      }
      const entry = invocationEntryFromRecoveryCheckpoint(checkpoint);
      if (entry.resultPending === undefined && entry.externalActionClaim?.effectKind === "remote-invoke") {
        entry.resultPending = {
          outcome: "unknown",
          basis: "external-action-claim",
          observedAt: checkpoint.updatedAt,
          reason:
            "Remote invocation crossed its durable action-claim boundary without authoritative terminal evidence.",
          externalClaimId: entry.externalActionClaim.claimId,
        };
      }
      if (entry.resultPending !== undefined) {
        this.invocations.set(entry.request.invocationId, entry);
        recovered.push(snapshotInvocation(entry));
        continue;
      }
      const recoveryAuthority = classifyManagedAgentAuthorityEvidence(
        entry.decision.capabilitySnapshot.authorityEvidence,
        now.toISOString(),
      );
      if (requiresRuntimeAuthorityProof(entry.request) && recoveryAuthority.classification !== "current-verified") {
        entry.finishedAt = now;
        entry.lifecycleState = "failed";
        entry.record = createFailedRecord(
          entry.request,
          entry.decision,
          `Managed child authority evidence is ${recoveryAuthority.classification}; observe authority again before replay.`,
        );
        this.invocations.set(entry.request.invocationId, entry);
        entry.record = await finalizeTerminalLeaseStages(this.options, entry, entry.record);
        entry.terminal?.resolve({ status: "completed", decision: entry.decision, record: entry.record });
        recovered.push(snapshotInvocation(entry));
        continue;
      }
      entry.abortController.abort(reason);
      entry.finishedAt = now;
      entry.lifecycleState = "recovered";
      entry.record = createRecoveredRecord(entry.request, entry.decision, reason);
      this.invocations.set(entry.request.invocationId, entry);
      entry.record = await finalizeTerminalLeaseStages(this.options, entry, entry.record);
      entry.terminal?.resolve({
        status: "completed",
        decision: entry.decision,
        record: entry.record,
      });
      notifyTerminalObserver(entry);
      recovered.push(snapshotInvocation(entry));
    }

    return {
      recovered: cloneJson(recovered),
      accountLeases: cloneJson(mergeRecoveredAccountLeases([], recovered)),
    };
  }

  async invokeAdmitted(input: {
    readonly request: ManagedAgentInvocationRequest;
    readonly adapter: ManagedAgentRuntimeAdapter;
    readonly admission: ManagedAgentAdmissionDecision;
    readonly abortSignal?: AbortSignal;
    readonly workLimits?: ManagedAgentRuntimeInvocationInput["workLimits"];
    readonly promptDelivery?: ManagedAgentRuntimePromptDeliveryCoordinator;
    readonly progressObserver?: ManagedAgentRuntimeInvocationProgressObserver;
    readonly consumedWriteApproval?: ManagedAgentRuntimeConsumedWriteApproval;
    readonly childAuthorityAdmission?: ManagedChildAuthorityAdmissionContract;
    readonly attendedTrustedExecution?: ManagedAttendedTrustedExecutionContext;
    readonly environment?: ManagedAgentEnvironmentVariables;
    readonly registerAdapterCompletion?: (completion: PromiseLike<unknown>) => void;
    readonly registerExternalActionClaim?: (claim: ManagedExternalInvocationActionClaim) => Promise<void>;
    readonly registerEconomicSettlement?: (settlement: PromiseLike<ManagedEconomicSettlement>) => void;
    readonly createEconomicSettlement?: (report: ManagedEconomicExecutionReport) => ManagedEconomicSettlement;
  }): Promise<ManagedAgentInvocationRecord> {
    const admission = requireRuntimeAdmission(input, () => this.now());
    const attendedTrustedExecution = requireManagedAttendedTrustedExecution({
      now: this.now(),
      request: input.request,
      adapterDescriptor: input.adapter.descriptor,
      capabilitySnapshotInput: admission.capabilitySnapshot,
      ...(input.childAuthorityAdmission === undefined
        ? {}
        : { childAuthorityAdmission: input.childAuthorityAdmission }),
      economicDispatchPresent: false,
      ...(input.attendedTrustedExecution === undefined ? {} : { context: input.attendedTrustedExecution }),
    });
    const environment = input.environment === undefined ? undefined : validateManagedEnvironment(input.environment);
    const record = await input.adapter.invoke({
      request: input.request,
      admission,
      abortSignal: input.abortSignal ?? new AbortController().signal,
      ...(input.workLimits ? { workLimits: input.workLimits } : {}),
      promptDelivery: input.promptDelivery ?? this.promptDeliveryCoordinator(input.request.invocationId),
      ...(input.progressObserver !== undefined ? { progressObserver: input.progressObserver } : {}),
      ...(input.consumedWriteApproval !== undefined ? { consumedWriteApproval: input.consumedWriteApproval } : {}),
      ...(input.childAuthorityAdmission !== undefined
        ? { childAuthorityAdmission: input.childAuthorityAdmission }
        : {}),
      ...(attendedTrustedExecution !== undefined ? { attendedTrustedExecution } : {}),
      ...(this.externalActionClaim !== undefined ? { externalActionClaim: this.externalActionClaim } : {}),
      ...(environment !== undefined ? { environment: cloneJson(environment) } : {}),
      registerAdapterCompletion: input.registerAdapterCompletion ?? (() => undefined),
      ...(input.registerExternalActionClaim === undefined
        ? {}
        : { registerExternalActionClaim: input.registerExternalActionClaim }),
      ...(input.registerEconomicSettlement === undefined
        ? {}
        : { registerEconomicSettlement: input.registerEconomicSettlement }),
      ...(input.createEconomicSettlement === undefined
        ? {}
        : { createEconomicSettlement: input.createEconomicSettlement }),
    });
    const canonicalRecord = attachStructuredVerificationUsage(record);
    const attributedRecord = defineManagedAgentInvocationRecord({
      ...canonicalRecord,
      coordinationUsage: buildManagedAgentCoordinationUsage({
        invocationId: input.request.invocationId,
        ...(canonicalRecord.childSessionId ? { childSessionId: canonicalRecord.childSessionId } : {}),
        parentPrompt: input.request.input.prompt ?? input.request.input.summary,
        sourceResourceUris: admission.capabilitySnapshot.resourcePlane.resourceUris,
        ...(canonicalRecord.resultHandoff ? { resultHandoff: canonicalRecord.resultHandoff } : {}),
      }),
    });
    const runtimeRecord = attachRuntimeAuthorityAdmission(attributedRecord, input.childAuthorityAdmission?.bundle);
    assertManagedAgentResultHandoffContract(input.request.input.handoff, runtimeRecord);
    assertRecordWithinAdmission(runtimeRecord, input.request, admission);
    return runtimeRecord;
  }

  private now(): Date {
    const now = this.options.clock?.() ?? new Date();
    assertValidRuntimeDate(now, "Managed authority observation clock is invalid");
    return now;
  }

  private promptDeliveryCoordinator(invocationId: string): ManagedAgentRuntimePromptDeliveryCoordinator {
    return {
      claim: (input) =>
        this.claimPromptDeliveries({
          invocationId,
          boundary: input.boundary,
          ...(input.claimedAt !== undefined ? { claimedAt: input.claimedAt } : {}),
        }),
    };
  }

  private bindParentAbortSignal(
    entry: ManagedAgentRuntimeInvocationEntry,
    abortSignal: AbortSignal | undefined,
  ): (() => void) | undefined {
    if (!abortSignal) {
      return undefined;
    }
    const onAbort = (): void => {
      if (abortSignal.reason instanceof ManagedEconomicLifecycleTimeoutError) {
        // Preserve adapter ownership of the terminal timeout record and its replay evidence.
        entry.abortController.abort(abortSignal.reason);
        return;
      }
      void this.cancel(entry.request.invocationId, managedInvocationAbortReason(abortSignal.reason)).catch(
        () => undefined,
      );
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
    return () => abortSignal.removeEventListener("abort", onAbort);
  }

  private async completePreAdapterTerminalStart(
    entry: ManagedAgentRuntimeInvocationEntry,
    decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  ): Promise<ManagedAgentRuntimeInvocationStartResult> {
    if (!entry.record) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation has no terminal record");
    }
    entry.record = await finalizeTerminalLeaseStages(this.options, entry, entry.record);
    entry.terminal?.resolve({
      status: "completed",
      decision,
      record: entry.record,
    });
    notifyTerminalObserver(entry);
    return {
      status: "started",
      decision: cloneJson(decision),
      snapshot: snapshotInvocation(entry),
    };
  }
}

function resultPendingCancellation(
  entry: ManagedAgentRuntimeInvocationEntry,
): Extract<ManagedAgentRuntimeInvocationCancelResult, { readonly status: "result_pending" }> {
  if (entry.resultPending === undefined) {
    throw new ManagedAgentRuntimeAdmissionError("Managed remote invocation has no result-pending evidence");
  }
  return {
    status: "result_pending",
    outcome: "unknown",
    decision: cloneJson(entry.decision),
    cancellation:
      entry.resultPending.basis === "cancellation-request"
        ? cloneJson(entry.resultPending.cancellation)
        : {
            requestOutcome: "not-requested",
            failureMessage: "This recovered remote invocation has no durable cancellation-request evidence.",
          },
  };
}

function assertConsumedWriteApproval(
  request: ManagedAgentInvocationRequest,
  routeId: string,
  approval: ManagedAgentRuntimeConsumedWriteApproval,
): void {
  const writeAuthority = request.authority.writeAuthority;
  const binding = approval.binding;
  if (
    !isInternalConsumedWriteApproval(approval) ||
    request.access !== "approved-write" ||
    request.authority.toolAuthority.writeAllowed !== true ||
    writeAuthority === undefined ||
    writeAuthority.scope.workspace.mode !== "apply-approved" ||
    writeAuthority.approval.mode !== "required-before-apply" ||
    writeAuthority.approval.evidenceRequired !== true ||
    !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/u.test(approval.approvalId) ||
    approval.consumerId !== request.invocationId ||
    !Number.isFinite(Date.parse(approval.consumedAt)) ||
    request.invocationId !== `agent-task:${binding.jobId}` ||
    binding.callerId !== request.requestedBy ||
    binding.configuredAgentProfileId !== request.agentId ||
    binding.access !== request.access ||
    binding.routeId !== routeId ||
    binding.providerId !== request.providerRoute?.providerId ||
    binding.model !== request.providerRoute?.model
  ) {
    throw new ManagedAgentRuntimeAdmissionError(
      "Consumed managed write approval does not match the exact approved-write invocation authority.",
    );
  }
}
