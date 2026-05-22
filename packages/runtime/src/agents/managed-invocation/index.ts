import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { win32 as pathWin32 } from "node:path";
import { promisify } from "node:util";
import {
  defineManagedAgentCapabilitySnapshot,
  defineManagedAgentAdapterWriteAuthorityDescriptor,
  defineManagedAgentInvocationRecord,
  evaluateManagedAgentAdmission,
  isManagedAgentWriteAuthorityProfile,
} from "@kilnai/core";
import type {
  ManagedAgentAdapterDescriptor,
  ManagedAgentAdmissionDecision,
  ManagedAgentCapabilitySnapshot,
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentLifecycleState,
  ManagedAgentResourceLeaseEvidence,
} from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
export {
  admitManagedChildContextAndCredentials,
} from "./context-credential-admission.js";
export type {
  ManagedChildContextCredentialAdmissionInput,
  ManagedChildContextCredentialAdmissionResult,
  ManagedChildContextCredentialEvidence,
  ManagedChildCredentialRouteInput,
  ManagedChildExplicitAuthority,
  ManagedChildGovernedContext,
  ManagedChildParentAuthoritySnapshot,
} from "./context-credential-admission.js";
export {
  appendManagedInvocationSessionEvents,
} from "./session-events.js";
export type {
  AppendManagedInvocationSessionEventsInput,
} from "./session-events.js";
export {
  collectManagedAgentLiveWriteDecisionEvidence,
  collectManagedAgentLiveWriteEvidence,
  normalizeManagedAgentLiveWriteChanges,
} from "./live-write-event-bridge.js";
export type {
  ManagedAgentLiveWriteDecision,
  ManagedAgentLiveWriteDecisionEvidenceInput,
  ManagedAgentLiveWriteDecisionSource,
  ManagedAgentLiveWriteDecisionStatus,
  ManagedAgentLiveWriteEventBridgeInput,
  ManagedAgentLiveWriteEventBridgeResult,
  ManagedAgentLiveWriteChange,
  ManagedAgentLiveWriteChangeSource,
} from "./live-write-event-bridge.js";
export {
  ManagedDirectProviderRuntimeAdapter,
  type ManagedDirectProviderRuntimeAdapterConfig,
} from "./direct-runtime-adapter.js";
export {
  ManagedCliHarnessAdapter,
} from "./cli-harness-adapter.js";
export type {
  ManagedCliHarnessAdapterConfig,
  ManagedCliHarnessFilesystemBoundaryConfig,
} from "./cli-harness-adapter.js";
export {
  attachManagedInvocationSessionEventSink,
  createManagedAgentStartToolDefinition,
  createManagedInvocationToolExecutor,
  createManagedInvocationLifecycleToolExecutors,
  MANAGED_AGENT_CANCEL_CAPABILITY,
  MANAGED_AGENT_CANCEL_TOOL,
  MANAGED_AGENT_CANCEL_TOOL_NAME,
  MANAGED_AGENT_JOIN_CAPABILITY,
  MANAGED_AGENT_JOIN_TOOL,
  MANAGED_AGENT_JOIN_TOOL_NAME,
  MANAGED_AGENT_LIST_CAPABILITY,
  MANAGED_AGENT_LIST_TOOL,
  MANAGED_AGENT_LIST_TOOL_NAME,
  MANAGED_AGENT_INVOKE_CAPABILITY,
  MANAGED_AGENT_INVOKE_TOOL,
  MANAGED_AGENT_INVOKE_TOOL_NAME,
  MANAGED_AGENT_START_CAPABILITY,
  MANAGED_AGENT_START_TOOL,
  MANAGED_AGENT_START_TOOL_NAME,
  MANAGED_AGENT_STATUS_CAPABILITY,
  MANAGED_AGENT_STATUS_TOOL,
  MANAGED_AGENT_STATUS_TOOL_NAME,
} from "./runtime-tool.js";
export type {
  ManagedInvocationContextResolution,
  ManagedInvocationContextResolver,
  ManagedInvocationContextResolverInput,
  ManagedInvocationSessionEventSink,
  ManagedInvocationAgentCatalogEntry,
  ManagedInvocationRouteProfile,
  ManagedInvocationToolOptions,
  ManagedInvocationToolRoute,
} from "./runtime-tool.js";
export { ManagedAgentRuntimeAdmissionError } from "./errors.js";

export interface ManagedAgentRuntimeInvocationInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly abortSignal: AbortSignal;
}

export interface ManagedAgentRuntimeAdapter {
  readonly descriptor: ManagedAgentAdapterDescriptor;
  invoke(input: ManagedAgentRuntimeInvocationInput): Promise<ManagedAgentInvocationRecord>;
}

export interface ManagedAgentWorktreeLeaseManagerInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly lease: ManagedAgentResourceLeaseEvidence;
}

export interface ManagedAgentWorktreeLeaseReleaseInput extends ManagedAgentWorktreeLeaseManagerInput {
  readonly record: ManagedAgentInvocationRecord;
}

export interface ManagedAgentWorktreeLeaseManager {
  acquire(input: ManagedAgentWorktreeLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence>;
  release(input: ManagedAgentWorktreeLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence>;
}

export interface RuntimeManagedAgentInvocationServiceOptions {
  readonly worktreeLeaseManager?: ManagedAgentWorktreeLeaseManager;
}

export interface ManagedGitWorktreeLeaseManagerConfig {
  readonly repositoryPath: string;
  readonly worktreeRootPath: string;
  readonly ref?: string;
  readonly gitBinary?: string;
}

const execFileAsync = promisify(execFile);

class ManagedAgentWorktreeLeaseAcquireError extends ManagedAgentRuntimeAdmissionError {
  constructor(
    message: string,
    readonly sideEffected: boolean,
  ) {
    super(message);
  }
}

export class ManagedGitWorktreeLeaseManager implements ManagedAgentWorktreeLeaseManager {
  private readonly repositoryPath: string;
  private readonly worktreeRootPath: string;
  private readonly ref: string;
  private readonly gitBinary: string;

  constructor(config: ManagedGitWorktreeLeaseManagerConfig) {
    this.repositoryPath = config.repositoryPath;
    this.worktreeRootPath = config.worktreeRootPath;
    this.ref = config.ref ?? "HEAD";
    this.gitBinary = config.gitBinary ?? "git";
  }

  async acquire(input: ManagedAgentWorktreeLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence> {
    if (input.lease.workingDirectoryMode !== "isolated-worktree") {
      throw new ManagedAgentRuntimeAdmissionError("Managed git worktree lease manager only supports isolated worktree leases");
    }
    this.assertWorktreePath(input.lease.workingDirectoryPath);
    await this.ensureWorktree(input.lease.workingDirectoryPath);
    return {
      ...input.lease,
      healthStatus: "healthy",
      cleanupStatus: "pending",
      resourceUris: uniqueStrings([
        ...input.lease.resourceUris,
        `kiln://artifacts/${input.request.invocationId}/worktree-lease`,
      ]),
    };
  }

  async release(input: ManagedAgentWorktreeLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence> {
    this.assertWorktreePath(input.lease.workingDirectoryPath);
    const dirtyStatus = await this.git(["-C", input.lease.workingDirectoryPath, "status", "--porcelain"]);
    if (dirtyStatus.trim().length > 0) {
      throw new ManagedAgentRuntimeAdmissionError("Managed git worktree lease is dirty; preserving worktree for review");
    }
    await this.git(["-C", this.repositoryPath, "worktree", "remove", input.lease.workingDirectoryPath]);
    return {
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: uniqueStrings([
        ...input.lease.diagnosticUris,
        `kiln://artifacts/${input.request.invocationId}/worktree-cleanup`,
      ]),
    };
  }

  private async ensureWorktree(path: string): Promise<void> {
    if (await pathExists(path)) {
      throw new ManagedAgentWorktreeLeaseAcquireError(
        "Managed git worktree lease path already exists; refusing to adopt unmanaged checkout",
        false,
      );
    }
    try {
      await this.git(["-C", this.repositoryPath, "worktree", "add", "--detach", path, this.ref]);
    } catch (error) {
      throw new ManagedAgentWorktreeLeaseAcquireError(toError(error).message, true);
    }
  }

  private assertWorktreePath(path: string): void {
    const normalizedRoot = normalizeLeasePath(this.worktreeRootPath);
    const normalizedPath = normalizeLeasePath(path);
    if (normalizedPath === normalizedRoot || !normalizedPath.startsWith(`${normalizedRoot}/`)) {
      throw new ManagedAgentWorktreeLeaseAcquireError(
        "Managed git worktree lease path is outside configured worktree root",
        false,
      );
    }
  }

  private async git(args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync(this.gitBinary, [...args], {
      windowsHide: true,
    });
    return stdout.toString();
  }
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
  readonly error?: {
    readonly message: string;
  };
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

interface ManagedAgentRuntimeInvocationEntry {
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  lifecycleState: ManagedAgentLifecycleState;
  readonly startedAt: Date;
  readonly abortController: AbortController;
  worktreeLease?: ManagedAgentResourceLeaseEvidence;
  finishedAt?: Date;
  record?: ManagedAgentInvocationRecord;
  error?: Error;
  terminal?: Promise<Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>>;
}

export class RuntimeManagedAgentInvocationService {
  private readonly invocations = new Map<string, ManagedAgentRuntimeInvocationEntry>();

  constructor(private readonly options: RuntimeManagedAgentInvocationServiceOptions = {}) {}

  async invoke(
    request: ManagedAgentInvocationRequest,
    adapter: ManagedAgentRuntimeAdapter,
    capabilitySnapshotInput: ManagedAgentCapabilitySnapshotInput = {},
  ): Promise<ManagedAgentRuntimeInvocationResult> {
    const started = await this.start(request, adapter, capabilitySnapshotInput);
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
    capabilitySnapshotInput: ManagedAgentCapabilitySnapshotInput = {},
  ): Promise<ManagedAgentRuntimeInvocationStartResult> {
    if (this.invocations.has(request.invocationId)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation is already registered");
    }

    const decision = evaluateManagedAgentAdmission(request, adapter.descriptor, capabilitySnapshotInput);
    if (decision.status === "denied") {
      return {
        status: "denied",
        decision: cloneJson(decision),
      };
    }
    this.assertNoActiveWriteLeaseConflict(request);

    const registeredRequest = cloneJson(request);
    const registeredDecision = cloneJson(decision);
    const terminal = deferredTerminal();
    const abortController = new AbortController();
    const entry: ManagedAgentRuntimeInvocationEntry = {
      request: registeredRequest,
      decision: registeredDecision,
      lifecycleState: "running",
      startedAt: new Date(),
      abortController,
      terminal: terminal.promise,
    };
    terminal.promise.catch(() => undefined);
    this.invocations.set(request.invocationId, entry);
    try {
      entry.worktreeLease = await this.acquireWorktreeLease(registeredRequest, registeredDecision);
    } catch (error) {
      const runtimeError = toError(error);
      if (!this.shouldCompensateAcquireFailure(error)) {
        this.invocations.delete(request.invocationId);
        terminal.reject(runtimeError);
        throw runtimeError;
      }
      entry.worktreeLease = registeredDecision.capabilitySnapshot.resourceLease;
      entry.finishedAt = new Date();
      entry.lifecycleState = "failed";
      entry.error = runtimeError;
      entry.record = await this.finalizeTerminalLease(
        entry,
        createFailedRecord(entry.request, entry.decision, runtimeError.message),
      );
      terminal.reject(runtimeError);
      throw runtimeError;
    }
    if (entry.lifecycleState === "cancelled" && entry.record) {
      entry.record = await this.finalizeTerminalLease(entry, entry.record);
      terminal.resolve({
        status: "completed",
        decision: registeredDecision,
        record: entry.record,
      });
      return {
        status: "started",
        decision: cloneJson(registeredDecision),
        snapshot: snapshotInvocation(entry),
      };
    }
    const adapterTerminal: Promise<Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>> = this.invokeAdmitted({
      request: cloneJson(registeredRequest),
      adapter,
      admission: cloneJson(registeredDecision),
      abortSignal: abortController.signal,
    }).then(async (record) => {
      if (entry.lifecycleState === "cancelled" && entry.record) {
        if (record.lifecycleState === "cancelled") {
          const registeredRecord = cloneJson(record);
          entry.finishedAt = new Date();
          entry.record = await this.finalizeTerminalLease(entry, mergeCancelledRecords(entry.record, registeredRecord));
          return {
            status: "completed",
            decision: registeredDecision,
            record: entry.record,
          } as const;
        }
        entry.record = await this.finalizeTerminalLease(entry, entry.record);
        return {
          status: "completed",
          decision: registeredDecision,
          record: entry.record,
        } as const;
      }
      const registeredRecord = cloneJson(record);
      entry.finishedAt = new Date();
      entry.lifecycleState = registeredRecord.lifecycleState;
      entry.record = await this.finalizeTerminalLease(entry, registeredRecord);
      return {
        status: "completed",
        decision: registeredDecision,
        record: entry.record,
      } as const;
    }, async (error: unknown) => {
      if (entry.lifecycleState === "cancelled" && entry.record) {
        entry.record = await this.finalizeTerminalLease(entry, entry.record);
        return {
          status: "completed",
          decision: registeredDecision,
          record: entry.record,
        } as const;
      }
      const runtimeError = toError(error);
      entry.finishedAt = new Date();
      entry.lifecycleState = "failed";
      entry.error = runtimeError;
      entry.record = await this.finalizeTerminalLease(
        entry,
        createFailedRecord(entry.request, entry.decision, runtimeError.message),
      );
      throw runtimeError;
    });
    adapterTerminal.then(terminal.resolve, terminal.reject);
    adapterTerminal.catch(() => undefined);

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

  async cancel(invocationId: string, reason = "Managed invocation cancelled."): Promise<ManagedAgentRuntimeInvocationCancelResult> {
    const entry = this.invocations.get(invocationId);
    if (!entry) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation is not registered");
    }
    if (entry.record?.lifecycleState === "cancelled") {
      return {
        status: "cancelled",
        decision: cloneJson(entry.decision),
        record: cloneJson(entry.record),
      };
    }
    if (isTerminalLifecycleState(entry.lifecycleState)) {
      throw new ManagedAgentRuntimeAdmissionError(`Managed agent runtime invocation is already terminal: ${entry.lifecycleState}`);
    }

    entry.abortController.abort(reason);
    entry.finishedAt = new Date();
    entry.lifecycleState = "cancelled";
    entry.record = createCancelledRecord(entry.request, entry.decision, reason);
    return {
      status: "cancelled",
      decision: cloneJson(entry.decision),
      record: cloneJson(entry.record),
    };
  }

  async join(invocationId: string): Promise<ManagedAgentRuntimeInvocationResult> {
    const entry = this.invocations.get(invocationId);
    if (!entry) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation is not registered");
    }
    if (!entry.terminal) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation has no terminal wait handle");
    }
    const result = await entry.terminal;
    return {
      status: "completed",
      decision: cloneJson(result.decision),
      record: cloneJson(result.record),
    };
  }

  async invokeAdmitted(input: {
    readonly request: ManagedAgentInvocationRequest;
    readonly adapter: ManagedAgentRuntimeAdapter;
    readonly admission: ManagedAgentAdmissionDecision;
    readonly abortSignal?: AbortSignal;
  }): Promise<ManagedAgentInvocationRecord> {
    const admission = this.requireRuntimeAdmission(input);
    const record = await input.adapter.invoke({
      request: input.request,
      admission,
      abortSignal: input.abortSignal ?? new AbortController().signal,
    });
    this.assertRecordWithinAdmission(record, input.request, admission);
    return record;
  }

  private requireRuntimeAdmission(input: {
    readonly request: ManagedAgentInvocationRequest;
    readonly adapter: ManagedAgentRuntimeAdapter;
    readonly admission: ManagedAgentAdmissionDecision;
  }): Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }> {
    if (input.admission.status !== "admitted") {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation requires an admitted decision");
    }
    if (input.admission.adapterDescriptorId !== input.adapter.descriptor.adapterDescriptorId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent admission adapter descriptor does not match runtime adapter");
    }
    if (input.admission.invocationId !== input.request.invocationId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent admission invocation id does not match request");
    }
    if (input.admission.profile !== input.request.profile) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent admission profile does not match request");
    }

    const runtimeDecision = evaluateManagedAgentAdmission(
      input.request,
      input.adapter.descriptor,
      snapshotInputFromAdmission(input.admission.capabilitySnapshot),
    );
    if (runtimeDecision.status !== "admitted") {
      throw new ManagedAgentRuntimeAdmissionError(`Managed agent runtime admission no longer satisfies adapter policy: ${runtimeDecision.reason}`);
    }
    if (!sameJson(runtimeDecision, input.admission)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime admission must match the current core admission decision");
    }

    this.assertWriteAdmissionSupported(input.request, input.adapter.descriptor, input.admission);
    return input.admission;
  }

  private assertWriteAdmissionSupported(
    request: ManagedAgentInvocationRequest,
    descriptor: ManagedAgentAdapterDescriptor,
    admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  ): void {
    if (request.profile === "foundation-readonly-plan") {
      if (request.authority.writeAuthority !== undefined || admission.writeAuthority !== undefined) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent read-only runtime invocation cannot carry write authority");
      }
      return;
    }

    if (!isManagedAgentWriteAuthorityProfile(request.profile)) {
      return;
    }

    if (request.authority.writeAuthority === undefined || admission.writeAuthority === undefined) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent write runtime invocation requires admitted write authority");
    }
    if (!sameJson(request.authority.writeAuthority, admission.writeAuthority)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent admitted write authority does not match request authority");
    }

    const writeCapabilities = defineManagedAgentAdapterWriteAuthorityDescriptor(descriptor.writeAuthority);
    if (!writeCapabilities.proposalSupported || !writeCapabilities.scopeReduction) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime adapter cannot enforce write proposal scope");
    }
    if (request.profile === "foundation-apply-approved-writes") {
      if (!writeCapabilities.approvedApplySupported || !writeCapabilities.cleanupEvidence || !writeCapabilities.rollbackEvidence) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime adapter cannot enforce approved-write authority");
      }
    }
    if (
      (request.profile === "foundation-memory-write-proposals" ||
        request.authority.writeAuthority.scope.memory.mode !== "none" ||
        request.authority.memoryScope.access === "write-proposals") &&
      !writeCapabilities.memoryProposalSupported
    ) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime adapter cannot enforce memory write proposals");
    }
  }

  private assertNoActiveWriteLeaseConflict(request: ManagedAgentInvocationRequest): void {
    if (!isWorkspaceWriteInvocation(request) && !isIsolatedWorktreeInvocation(request)) {
      return;
    }

    for (const entry of this.invocations.values()) {
      if (isTerminalLifecycleState(entry.lifecycleState)) {
        continue;
      }
      if (isIsolatedWorktreeInvocation(request) && isIsolatedWorktreeInvocation(entry.request)) {
        if (samePath(entry.request.authority.workingDirectory.path, request.authority.workingDirectory.path)) {
          throw new ManagedAgentRuntimeAdmissionError(
            `Managed agent isolated worktree path conflict: ${entry.request.invocationId} already holds ${request.authority.workingDirectory.path}`,
          );
        }
        continue;
      }
      if (!isWorkspaceWriteInvocation(request) || !isWorkspaceWriteInvocation(entry.request)) {
        continue;
      }
      if (!samePath(entry.request.authority.workingDirectory.path, request.authority.workingDirectory.path)) {
        continue;
      }
      if (hasDisjointApprovedWorkspaceScope(entry.request, request)) {
        continue;
      }
      throw new ManagedAgentRuntimeAdmissionError(
        `Managed agent same-checkout parallel write conflict: ${entry.request.invocationId} already holds ${request.authority.workingDirectory.path}`,
      );
    }
  }

  private assertRecordWithinAdmission(
    record: ManagedAgentInvocationRecord,
    request: ManagedAgentInvocationRequest,
    admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  ): void {
    if (record.invocationId !== request.invocationId || record.invocationId !== admission.invocationId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record invocation id does not match admitted request");
    }
    if (record.parentSessionId !== request.parentSessionId || record.parentTurnId !== request.parentTurnId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record parent lineage does not match request");
    }
    if (record.profile !== request.profile || record.profile !== admission.profile) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record profile does not match admitted request");
    }
    if (record.authority.authorityProfileId !== admission.authorityProfileId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record authority profile does not match admission");
    }
    if (!sameJson(record.authority, request.authority)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned authority outside the admitted request");
    }
    if (!sameJson(record.capabilitySnapshot, admission.capabilitySnapshot)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned capability snapshot outside the admitted request");
    }

    if (admission.writeAuthority === undefined) {
      if (record.authority.writeAuthority !== undefined) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned write authority for a non-write admission");
      }
      const nonDeniedWriteEvidence = record.writeEvidence?.filter((evidence) => evidence.kind !== "write-authority-denied") ?? [];
      if (nonDeniedWriteEvidence.length > 0) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned write evidence for a non-write admission");
      }
      if ((record.resultHandoff?.memoryWriteProposalUris.length ?? 0) > 0) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned memory write proposals for a non-write admission");
      }
      return;
    }

    if (record.authority.writeAuthority === undefined) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter dropped admitted write authority from the record");
    }
    if (!sameJson(record.authority.writeAuthority, admission.writeAuthority)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter broadened or changed admitted write authority");
    }
  }

  private async acquireWorktreeLease(
    request: ManagedAgentInvocationRequest,
    decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  ): Promise<ManagedAgentResourceLeaseEvidence | undefined> {
    if (request.authority.workingDirectory.mode !== "isolated-worktree") {
      return undefined;
    }
    if (!this.options.worktreeLeaseManager) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent isolated worktree lease manager is required");
    }
    return validateResourceLease(request, decision, await this.options.worktreeLeaseManager.acquire({
      request: cloneJson(request),
      decision: cloneJson(decision),
      lease: cloneJson(decision.capabilitySnapshot.resourceLease),
    }));
  }

  private async finalizeTerminalLease(
    entry: ManagedAgentRuntimeInvocationEntry,
    record: ManagedAgentInvocationRecord,
  ): Promise<ManagedAgentInvocationRecord> {
    if (!entry.worktreeLease || !this.options.worktreeLeaseManager) {
      return defineManagedAgentInvocationRecord(record);
    }
    try {
      const resourceLease = validateResourceLease(entry.request, entry.decision, await this.options.worktreeLeaseManager.release({
        request: cloneJson(entry.request),
        decision: cloneJson(entry.decision),
        lease: cloneJson(entry.worktreeLease),
        record: cloneJson(record),
      }));
      return defineManagedAgentInvocationRecord({
        ...record,
        resourceLease,
      });
    } catch {
      const cleanupDiagnosticUri = `kiln://artifacts/${entry.request.invocationId}/worktree-lease-cleanup-failed`;
      return defineManagedAgentInvocationRecord({
        ...record,
        resourceLease: {
          ...entry.worktreeLease,
          healthStatus: "leaked",
          cleanupStatus: "failed",
          diagnosticUris: uniqueStrings([...entry.worktreeLease.diagnosticUris, cleanupDiagnosticUri]),
        },
        diagnostics: [
          ...(record.diagnostics ?? []),
          {
            uri: cleanupDiagnosticUri,
            kind: "cleanup",
          },
        ],
      });
    }
  }

  private shouldCompensateAcquireFailure(error: unknown): boolean {
    if (this.options.worktreeLeaseManager === undefined) {
      return false;
    }
    if (error instanceof ManagedAgentWorktreeLeaseAcquireError) {
      return error.sideEffected;
    }
    if (error instanceof ManagedAgentRuntimeAdmissionError) {
      return false;
    }
    return true;
  }
}

function snapshotInvocation(entry: ManagedAgentRuntimeInvocationEntry): ManagedAgentRuntimeInvocationSnapshot {
  return {
    invocationId: entry.request.invocationId,
    agentId: entry.request.agentId,
    parentSessionId: entry.request.parentSessionId,
    parentTurnId: entry.request.parentTurnId,
    profile: entry.request.profile,
    providerRoute: cloneJson(entry.request.providerRoute),
    adapterKind: entry.request.adapterKind,
    executionMode: entry.request.executionMode,
    authorityProfileId: entry.request.authority.authorityProfileId,
    lifecycleState: entry.lifecycleState,
    startedAt: entry.startedAt.toISOString(),
    ...(entry.finishedAt !== undefined ? { finishedAt: entry.finishedAt.toISOString() } : {}),
    ...(entry.finishedAt !== undefined ? { durationMs: entry.finishedAt.getTime() - entry.startedAt.getTime() } : {}),
    request: cloneJson(entry.request),
    decision: cloneJson(entry.decision),
    ...(entry.record !== undefined ? { record: cloneJson(entry.record) } : {}),
    ...(entry.error !== undefined ? { error: { message: entry.error.message } } : {}),
  };
}

function createCancelledRecord(
  request: ManagedAgentInvocationRequest,
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  reason: string,
): ManagedAgentInvocationRecord {
  return defineManagedAgentInvocationRecord({
    invocationId: request.invocationId,
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    parentTurnId: request.parentTurnId,
    profile: request.profile,
    lifecycleState: "cancelled",
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    authority: request.authority,
    capabilitySnapshot: decision.capabilitySnapshot,
    resultHandoff: {
      summary: reason,
      resourceUris: [],
      memoryWriteProposalUris: [],
    },
  });
}

function createFailedRecord(
  request: ManagedAgentInvocationRequest,
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  reason: string,
): ManagedAgentInvocationRecord {
  return defineManagedAgentInvocationRecord({
    invocationId: request.invocationId,
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    parentTurnId: request.parentTurnId,
    profile: request.profile,
    lifecycleState: "failed",
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    authority: request.authority,
    capabilitySnapshot: decision.capabilitySnapshot,
    resultHandoff: {
      summary: reason,
      resourceUris: [],
      memoryWriteProposalUris: [],
    },
  });
}

function mergeCancelledRecords(
  runtimeRecord: ManagedAgentInvocationRecord,
  adapterRecord: ManagedAgentInvocationRecord,
): ManagedAgentInvocationRecord {
  const runtimeHandoff = runtimeRecord.resultHandoff;
  const adapterHandoff = adapterRecord.resultHandoff;
  return defineManagedAgentInvocationRecord({
    ...adapterRecord,
    lifecycleState: "cancelled",
    ...(runtimeRecord.resourceLease !== undefined
      ? { resourceLease: runtimeRecord.resourceLease }
      : adapterRecord.resourceLease !== undefined
        ? { resourceLease: adapterRecord.resourceLease }
        : {}),
    resultHandoff: {
      summary: runtimeHandoff?.summary ?? adapterHandoff?.summary ?? "Managed invocation cancelled.",
      resourceUris: adapterHandoff?.resourceUris ?? runtimeHandoff?.resourceUris ?? [],
      memoryWriteProposalUris: adapterHandoff?.memoryWriteProposalUris ?? runtimeHandoff?.memoryWriteProposalUris ?? [],
    },
  });
}

function isTerminalLifecycleState(state: ManagedAgentLifecycleState): boolean {
  return state === "completed" || state === "failed" || state === "timed_out" || state === "cancelled";
}

function isWorkspaceWriteInvocation(request: ManagedAgentInvocationRequest): boolean {
  return request.authority.toolAuthority.writeAllowed === true &&
    request.authority.workingDirectory.mode === "workspace-write";
}

function isIsolatedWorktreeInvocation(request: ManagedAgentInvocationRequest): boolean {
  return request.authority.toolAuthority.writeAllowed === true &&
    request.authority.workingDirectory.mode === "isolated-worktree";
}

function hasDisjointApprovedWorkspaceScope(
  active: ManagedAgentInvocationRequest,
  incoming: ManagedAgentInvocationRequest,
): boolean {
  const activeWorkspace = active.authority.writeAuthority?.scope.workspace;
  const incomingWorkspace = incoming.authority.writeAuthority?.scope.workspace;
  if (
    activeWorkspace?.mode !== "apply-approved" ||
    incomingWorkspace?.mode !== "apply-approved" ||
    activeWorkspace.allowedPaths.length === 0 ||
    incomingWorkspace.allowedPaths.length === 0
  ) {
    return false;
  }

  return activeWorkspace.allowedPaths.every((activePath) =>
    incomingWorkspace.allowedPaths.every((incomingPath) => !pathsOverlap(activePath, incomingPath))
  );
}

function samePath(left: string, right: string): boolean {
  return normalizeLeasePath(left) === normalizeLeasePath(right);
}

function pathsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeLeasePath(left);
  const normalizedRight = normalizeLeasePath(right);
  return normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`);
}

function normalizeLeasePath(value: string): string {
  const normalized = pathWin32.normalize(value.replace(/\//gu, "\\")).replace(/\\/gu, "/");
  return normalized.replace(/\/+$/u, "").toLowerCase();
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deferredTerminal(): {
  readonly promise: Promise<Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>>;
  readonly resolve: (value: Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function validateResourceLease(
  request: ManagedAgentInvocationRequest,
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  lease: ManagedAgentResourceLeaseEvidence,
): ManagedAgentResourceLeaseEvidence {
  const admittedLease = decision.capabilitySnapshot.resourceLease;
  if (lease.leaseId !== admittedLease.leaseId) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime lease id does not match admission");
  }
  if (lease.createdAt !== admittedLease.createdAt) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime lease creation timestamp does not match admission");
  }
  if (lease.workingDirectoryMode !== admittedLease.workingDirectoryMode) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime lease working directory mode does not match admission");
  }
  if (!samePath(lease.workingDirectoryPath, admittedLease.workingDirectoryPath)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime lease working directory path does not match admission");
  }
  assertLeaseUrisWithinInvocation("resource", request.invocationId, admittedLease.resourceUris, lease.resourceUris);
  assertLeaseUrisWithinInvocation("diagnostic", request.invocationId, admittedLease.diagnosticUris, lease.diagnosticUris);
  return defineManagedAgentCapabilitySnapshot({
    ...decision.capabilitySnapshot,
    resourceLease: lease,
  }).resourceLease;
}

function assertLeaseUrisWithinInvocation(
  kind: string,
  invocationId: string,
  admittedUris: readonly string[],
  candidateUris: readonly string[],
): void {
  for (const uri of admittedUris) {
    if (!candidateUris.includes(uri)) {
      throw new ManagedAgentRuntimeAdmissionError(`Managed agent runtime lease dropped admitted ${kind} uri`);
    }
  }
  for (const uri of candidateUris) {
    if (admittedUris.includes(uri)) {
      continue;
    }
    if (!isInvocationArtifactUri(uri, invocationId)) {
      throw new ManagedAgentRuntimeAdmissionError(`Managed agent runtime lease ${kind} uri is outside invocation artifacts`);
    }
  }
}

function isInvocationArtifactUri(uri: string, invocationId: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "kiln:" || parsed.hostname !== "artifacts") {
      return false;
    }
    const pathSegments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
    return pathSegments.length > 1 && pathSegments[0] === invocationId;
  } catch {
    return false;
  }
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function snapshotInputFromAdmission(snapshot: ManagedAgentCapabilitySnapshot): ManagedAgentCapabilitySnapshotInput {
  return {
    capturedAt: snapshot.capturedAt,
    routeId: snapshot.routeId,
    routeHealth: snapshot.routeHealth,
    providerModelProof: snapshot.providerModelProof,
    resourcePlane: snapshot.resourcePlane,
    resourceLease: snapshot.resourceLease,
    childIdentity: snapshot.childIdentity,
  };
}
