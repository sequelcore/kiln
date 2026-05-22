import {
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
  finishedAt?: Date;
  record?: ManagedAgentInvocationRecord;
  error?: Error;
  terminal?: Promise<Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>>;
}

export class RuntimeManagedAgentInvocationService {
  private readonly invocations = new Map<string, ManagedAgentRuntimeInvocationEntry>();

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
    const abortController = new AbortController();
    const entry: ManagedAgentRuntimeInvocationEntry = {
      request: registeredRequest,
      decision: registeredDecision,
      lifecycleState: "running",
      startedAt: new Date(),
      abortController,
    };
    const adapterTerminal: Promise<Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>> = this.invokeAdmitted({
      request: cloneJson(registeredRequest),
      adapter,
      admission: cloneJson(registeredDecision),
      abortSignal: abortController.signal,
    }).then((record) => {
      if (entry.lifecycleState === "cancelled" && entry.record) {
        if (record.lifecycleState === "cancelled") {
          const registeredRecord = cloneJson(record);
          entry.finishedAt = new Date();
          entry.record = mergeCancelledRecords(entry.record, registeredRecord);
          return {
            status: "completed",
            decision: registeredDecision,
            record: entry.record,
          } as const;
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
      entry.record = registeredRecord;
      return {
        status: "completed",
        decision: registeredDecision,
        record: registeredRecord,
      } as const;
    }, (error: unknown) => {
      if (entry.lifecycleState === "cancelled" && entry.record) {
        return {
          status: "completed",
          decision: registeredDecision,
          record: entry.record,
        } as const;
      }
      entry.finishedAt = new Date();
      entry.lifecycleState = "failed";
      entry.error = toError(error);
      throw entry.error;
    });
    entry.terminal = adapterTerminal;
    adapterTerminal.catch(() => undefined);
    this.invocations.set(request.invocationId, entry);

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
    if (!isWorkspaceWriteInvocation(request)) {
      return;
    }

    for (const entry of this.invocations.values()) {
      if (isTerminalLifecycleState(entry.lifecycleState) || !isWorkspaceWriteInvocation(entry.request)) {
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

function mergeCancelledRecords(
  runtimeRecord: ManagedAgentInvocationRecord,
  adapterRecord: ManagedAgentInvocationRecord,
): ManagedAgentInvocationRecord {
  const runtimeHandoff = runtimeRecord.resultHandoff;
  const adapterHandoff = adapterRecord.resultHandoff;
  return defineManagedAgentInvocationRecord({
    ...adapterRecord,
    lifecycleState: "cancelled",
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
  return value.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
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
