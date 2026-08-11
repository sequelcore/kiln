import {
  assertManagedAgentResultHandoffContract,
  classifyManagedAgentAuthorityEvidence,
  defineManagedAgentInvocationRecord,
  defineVerificationUsageReport,
  evaluateManagedAgentAdmission,
} from "@kilnai/core";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentAdmissionDecision,
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAccountLeaseEvidence,
  ManagedAgentObservedRuntimeAuthorityEvidence,
  ManagedAgentLifecycleState,
  ManagedAgentResourceLeaseEvidence,
  ManagedEconomicCommitment,
  ManagedEconomicExecutionReport,
  ManagedEconomicSettlement,
  StructuredExecutionResult,
} from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import { ManagedEconomicLifecycleTimeoutError } from "./economic-dispatch-coordinator.js";
import {
  isInternalConsumedWriteApproval,
  type ManagedAgentRuntimeConsumedWriteApproval,
} from "./internal-consumed-write-approval.js";
import { validateManagedAgentRuntimeRecoveryCheckpoint } from "./recovery-store.js";
import type {
  ManagedAgentRuntimeEconomicDispatchCheckpoint,
  ManagedAgentRuntimeRecoveryLeaseStage,
  ManagedAgentRuntimeRecoveryStore,
} from "./recovery-store.js";
import { buildManagedAgentCoordinationUsage } from "./coordination-usage.js";
import { cloneJson, toError } from "./runtime-primitives.js";
import type { ManagedAgentEnvironmentVariables } from "./environment-lease-manager.js";
import { validateManagedEnvironment } from "./invocation-environment.js";
import type { ManagedAgentWorktreeLeaseManager } from "./worktree-lease-manager.js";
import type { ManagedAgentSandboxLeaseManager } from "./sandbox-lease-manager.js";
import type { ManagedAgentArtifactDirectoryLeaseManager } from "./artifact-directory-lease-manager.js";
import type { ManagedAgentDevServerPortLeaseManager } from "./dev-server-port-lease-manager.js";
import type { ManagedAgentEnvironmentLeaseManager } from "./environment-lease-manager.js";
import type { ManagedAgentCredentialRouteLeaseManager } from "./credential-route-lease-manager.js";
import {
  ManagedAgentRuntimeAuthorityObservationError,
  assertManagedEconomicCommitmentMatchesRequest,
  assertPostStartAuthority,
  capabilitySnapshotInputWithObservedRuntimeAuthority,
  capabilitySnapshotInputWithRuntimeAuthorityProjection,
  managedInvocationAbortReason,
  requiresRuntimeAuthorityProof,
} from "./invocation-authority-guard.js";
import {
  assertRecordWithinAdmission,
  detectActiveWriteLeaseConflict,
  requireRuntimeAdmission,
} from "./invocation-admission-guard.js";
import {
  acquireRuntimeResourceLeases,
  currentTerminalRecord,
  finalizeTerminalLeaseStages,
  saveRuntimeRecoveryCheckpoint,
  shouldCompensateAcquireFailure,
} from "./invocation-lease-lifecycle.js";
import {
  economicDispatchCheckpoint,
  invocationEntryFromRecoveryCheckpoint,
  isRuntimeRecoveryCleanupResolved,
  mergeRecoveredAccountLeases,
  persistedRecoveryReason,
  staleRecoveryReason,
} from "./invocation-recovery-checkpoint.js";
import {
  createCancelledRecord,
  createFailedRecord,
  createRecoveredRecord,
  createStaleRecord,
  mergeCancelledRecords,
} from "./invocation-records.js";
import {
  MANAGED_AGENT_OWNER_TIMEOUT_SETTLEMENT_GRACE_MS,
  appendProgressEvent,
  deferredTerminal,
  isTerminalLifecycleState,
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

export { MANAGED_AGENT_OWNER_TIMEOUT_SETTLEMENT_GRACE_MS };

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
        costUsd: result.method === "deterministic"
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
  readonly promptDelivery: ManagedAgentRuntimePromptDeliveryCoordinator;
  readonly progressObserver?: ManagedAgentRuntimeInvocationProgressObserver;
  readonly consumedWriteApproval?: ManagedAgentRuntimeConsumedWriteApproval;
  readonly environment?: ManagedAgentEnvironmentVariables;
  readonly registerAdapterCompletion: (completion: PromiseLike<unknown>) => void;
  readonly registerEconomicSettlement?: (
    settlement: PromiseLike<ManagedEconomicSettlement>,
  ) => void;
  readonly createEconomicSettlement?: (
    report: ManagedEconomicExecutionReport,
  ) => ManagedEconomicSettlement;
}

export interface ManagedAgentRuntimeCancellationInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly reason: string;
  readonly abortSignal: AbortSignal;
}

export interface ManagedAgentRuntimeInvocationTerminalNotification {
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly record: ManagedAgentInvocationRecord;
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
  readonly terminalObserver?: ManagedAgentRuntimeInvocationTerminalObserver;
  readonly consumedWriteApproval?: ManagedAgentRuntimeConsumedWriteApproval;
  /** Runtime-only identity for the attached surface that owns child cleanup. */
  readonly owner?: object;
  readonly economicDispatch?: {
    readonly commitment: ManagedEconomicCommitment;
    readonly dispatchFenceId: string;
    readonly recordExecutionSettlementPending: (reason: string) => void;
    readonly createExecutionSettlement: (
      report: ManagedEconomicExecutionReport,
    ) => ManagedEconomicSettlement;
    readonly registerEconomicSettlement: (
      settlement: PromiseLike<ManagedEconomicSettlement>,
    ) => void;
  };
}

export interface ManagedAgentRuntimeAdapter {
  readonly descriptor: ManagedAgentAdapterDescriptor;
  invoke(input: ManagedAgentRuntimeInvocationInput): Promise<ManagedAgentInvocationRecord>;
  cancel?(input: ManagedAgentRuntimeCancellationInput): Promise<void>;
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
  readonly clock?: () => Date;
}

export interface ManagedAgentRuntimeInvocationSnapshot {
  readonly invocationId: string;
  readonly agentId: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
  readonly profile: ManagedAgentInvocationRequest["profile"];
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
  readonly record?: ManagedAgentInvocationRecord;
  readonly progressEvents?: readonly ManagedAgentRuntimeInvocationProgressEvent[];
  readonly promptInbox?: readonly ManagedAgentRuntimePromptAdmissionRecord[];
  readonly error?: {
    readonly message: string;
  };
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
    readonly record: ManagedAgentInvocationRecord;
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

export type ManagedAgentRuntimeInvocationCancelResult = {
  readonly status: "cancelled";
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly record: ManagedAgentInvocationRecord;
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
  readonly owner?: object;
}

export class RuntimeManagedAgentInvocationService {
  private readonly invocations = new Map<string, ManagedAgentRuntimeInvocationEntry>();

  constructor(private readonly options: RuntimeManagedAgentInvocationServiceOptions = {}) {}

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
    const recordEconomicPending = async (reason: string): Promise<void> => {
      await lifecycleOptions.economicDispatch?.recordExecutionSettlementPending(reason);
    };
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
        assertConsumedWriteApproval(
          request,
          capabilitySnapshotInput.routeId,
          lifecycleOptions.consumedWriteApproval,
        );
      }
    } catch (error) {
      await recordEconomicPending("runtime-prestart-validation-failed");
      throw error;
    }

    let admittedSnapshotInput: ManagedAgentCapabilitySnapshotInput;
    try {
      admittedSnapshotInput = this.options.authorityObserver === undefined
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
      ...(lifecycleOptions.terminalObserver !== undefined
        ? { terminalObserver: lifecycleOptions.terminalObserver }
        : {}),
    };
    terminal.promise.catch(() => undefined);
    this.invocations.set(request.invocationId, entry);
    entry.parentAbortCleanup = this.bindParentAbortSignal(entry, lifecycleOptions.abortSignal);
    terminal.promise.finally(() => {
      entry.parentAbortCleanup?.();
      entry.parentAbortCleanup = undefined;
    }).catch(() => undefined);
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
    const authorityCheckedInvocation = assertPostStartAuthority(this.options, () => this.now(), request, executableAdapter, registeredDecision, abortController)
      .then(() => {
        entry.adapterStarted = true;
        const invoke = () => this.invokeAdmitted({
          request: cloneJson(registeredRequest),
          adapter: executableAdapter,
          admission: cloneJson(registeredDecision),
          abortSignal: abortController.signal,
          promptDelivery: this.promptDeliveryCoordinator(registeredRequest.invocationId),
          progressObserver: (event) => appendProgressEvent(entry, event),
          ...(lifecycleOptions.consumedWriteApproval
            ? { consumedWriteApproval: lifecycleOptions.consumedWriteApproval }
            : {}),
          registerAdapterCompletion: (completion) => {
            registerAdapterCompletionOnEntry(entry, completion);
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
        const reason = dispatchPhase === "poststart-authority"
          ? "runtime-poststart-authority-failed"
          : dispatchPhase === "recovery-checkpoint"
            ? "runtime-recovery-checkpoint-failed"
            : "runtime-adapter-execution-failed";
        await recordEconomicPending(reason);
        signalDispatchReady();
        throw error;
      });
    const adapterTerminal: Promise<Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>> = authorityCheckedInvocation.then(async (record) => {
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
          entry.record = await finalizeTerminalLeaseStages(this.options, entry, mergeCancelledRecords(entry.record, registeredRecord));
          return {
            status: "completed",
            decision: registeredDecision,
            record: entry.record,
          } as const;
        }
        entry.record = await finalizeTerminalLeaseStages(this.options, entry, entry.record);
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
    }, async (error: unknown) => {
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
    });
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

  claimPromptDeliveries(input: ManagedAgentRuntimePromptDeliveryClaimInput): ManagedAgentRuntimePromptDeliveryClaimResult {
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

  async cancel(invocationId: string, reason = "Managed invocation cancelled."): Promise<ManagedAgentRuntimeInvocationCancelResult> {
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
    if (isTerminalLifecycleState(entry.lifecycleState)) {
      throw new ManagedAgentRuntimeAdmissionError(`Managed agent runtime invocation is already terminal: ${entry.lifecycleState}`);
    }

    if (entry.adapterStarted && entry.adapter?.cancel !== undefined) {
      try {
        await entry.adapter.cancel({
          request: cloneJson(entry.request),
          admission: cloneJson(entry.decision),
          reason,
          abortSignal: new AbortController().signal,
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
          createFailedRecord(entry.request, entry.decision, `Managed invocation cancellation failed: ${runtimeError.message}`),
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
    await Promise.all(ownedEntries.map(async (entry) => {
      await waitForOwnerShutdownExecutionSettlement(entry);
      await entry.adapterSettlement;
      await entry.leaseFinalization;
      await entry.terminalObserverSettlement;
    }));

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
      if (isTerminalLifecycleState(entry.lifecycleState)) {
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
      ? (await this.options.recoveryStore.listRecoverable())
        .map(validateManagedAgentRuntimeRecoveryCheckpoint)
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
        const accountLeaseResolved = checkpoint.accountLease === undefined
          || checkpoint.accountLease.lifecycleState === "released";
        if (
          isRuntimeRecoveryCleanupResolved(checkpoint.record.resourceLease?.cleanupStatus)
          && accountLeaseResolved
        ) {
          await this.options.recoveryStore.delete(checkpoint.request.invocationId);
        }
        continue;
      }
      if (
        this.invocations.has(checkpoint.request.invocationId)
      ) {
        continue;
      }
      const entry = invocationEntryFromRecoveryCheckpoint(checkpoint);
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
    readonly promptDelivery?: ManagedAgentRuntimePromptDeliveryCoordinator;
    readonly progressObserver?: ManagedAgentRuntimeInvocationProgressObserver;
    readonly consumedWriteApproval?: ManagedAgentRuntimeConsumedWriteApproval;
    readonly environment?: ManagedAgentEnvironmentVariables;
    readonly registerAdapterCompletion?: (completion: PromiseLike<unknown>) => void;
    readonly registerEconomicSettlement?: (
      settlement: PromiseLike<ManagedEconomicSettlement>,
    ) => void;
    readonly createEconomicSettlement?: (
      report: ManagedEconomicExecutionReport,
    ) => ManagedEconomicSettlement;
  }): Promise<ManagedAgentInvocationRecord> {
    const admission = requireRuntimeAdmission(input, () => this.now());
    const environment = input.environment === undefined ? undefined : validateManagedEnvironment(input.environment);
    const record = await input.adapter.invoke({
      request: input.request,
      admission,
      abortSignal: input.abortSignal ?? new AbortController().signal,
      promptDelivery: input.promptDelivery ?? this.promptDeliveryCoordinator(input.request.invocationId),
      ...(input.progressObserver !== undefined ? { progressObserver: input.progressObserver } : {}),
      ...(input.consumedWriteApproval !== undefined
        ? { consumedWriteApproval: input.consumedWriteApproval }
        : {}),
      ...(environment !== undefined ? { environment: cloneJson(environment) } : {}),
      registerAdapterCompletion: input.registerAdapterCompletion ?? (() => undefined),
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
    assertManagedAgentResultHandoffContract(input.request.input.handoff, attributedRecord);
    assertRecordWithinAdmission(attributedRecord, input.request, admission);
    return attributedRecord;
  }

  private now(): Date {
    const now = this.options.clock?.() ?? new Date();
    assertValidRuntimeDate(now, "Managed authority observation clock is invalid");
    return now;
  }

  private promptDeliveryCoordinator(invocationId: string): ManagedAgentRuntimePromptDeliveryCoordinator {
    return {
      claim: (input) => this.claimPromptDeliveries({
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
      void this.cancel(entry.request.invocationId, managedInvocationAbortReason(abortSignal.reason))
        .catch(() => undefined);
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

function assertConsumedWriteApproval(
  request: ManagedAgentInvocationRequest,
  routeId: string,
  approval: ManagedAgentRuntimeConsumedWriteApproval,
): void {
  const writeAuthority = request.authority.writeAuthority;
  const binding = approval.binding;
  if (
    !isInternalConsumedWriteApproval(approval)
    || request.profile !== "foundation-apply-approved-writes"
    || request.authority.toolAuthority.writeAllowed !== true
    || writeAuthority?.profile !== request.profile
    || writeAuthority.scope.workspace.mode !== "apply-approved"
    || writeAuthority.approval.mode !== "required-before-apply"
    || writeAuthority.approval.evidenceRequired !== true
    || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/u.test(approval.approvalId)
    || approval.consumerId !== request.invocationId
    || !Number.isFinite(Date.parse(approval.consumedAt))
    || binding.jobId !== request.invocationId.replace(/^managed-job:/u, "")
    || binding.callerId !== request.requestedBy
    || binding.configuredAgentProfileId !== request.agentId
    || binding.admissionProfileId !== request.profile
    || binding.routeId !== routeId
    || binding.providerId !== request.providerRoute?.providerId
    || binding.model !== request.providerRoute?.model
  ) {
    throw new ManagedAgentRuntimeAdmissionError(
      "Consumed managed write approval does not match the exact approved-write invocation authority.",
    );
  }
}
