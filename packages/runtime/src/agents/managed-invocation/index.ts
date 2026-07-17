import { execFile } from "node:child_process";
import { access, mkdir, rmdir } from "node:fs/promises";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { createHash } from "node:crypto";
import { win32 as pathWin32 } from "node:path";
import { promisify } from "node:util";
import {
  buildManagedAgentAuthorityEvidence,
  assertManagedAgentResultHandoffContract,
  classifyManagedAgentAuthorityEvidence,
  defineManagedAgentCapabilitySnapshot,
  defineManagedAgentAdapterWriteAuthorityDescriptor,
  defineManagedAgentInvocationRecord,
  defineStructuredExecutionResult,
  defineVerificationUsageReport,
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
  ManagedAgentObservedRuntimeAuthorityEvidence,
  ManagedAgentLifecycleState,
  ManagedAgentResourceLeaseEvidence,
  ManagedAgentWorktreeConflictEvidence,
  ManagedAgentWorktreeReviewEvidence,
  StructuredExecutionResult,
} from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import {
  ManagedFilesystemRuntimeRecoveryStore,
  validateManagedAgentRuntimeRecoveryCheckpoint,
} from "./recovery-store.js";
import type {
  ManagedAgentRuntimeRecoveryCheckpoint,
  ManagedAgentRuntimeRecoveryLeaseStage,
  ManagedAgentRuntimeRecoveryStore,
  ManagedFilesystemRuntimeRecoveryStoreConfig,
} from "./recovery-store.js";
import { projectManagedInvocationRecordResources } from "./resource-projection.js";
import { buildManagedAgentCoordinationUsage } from "./coordination-usage.js";
export { buildManagedAgentCoordinationUsage } from "./coordination-usage.js";
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

function attachStructuredManagedResult(record: ManagedAgentInvocationRecord): ManagedAgentInvocationRecord {
  if (!record.resultHandoff) return record;
  const structuredResult = record.resultHandoff.structuredResult ?? [
    ...(record.replayResources ?? []).map((resource) => resource.text),
    record.resultHandoff.summary,
  ].map(parseStructuredManagedResult).find((candidate) => candidate !== undefined);
  if (!structuredResult) return record;
  const verificationUsage = record.resultHandoff.verificationUsage
    ?? deriveStructuredVerificationUsage(structuredResult);
  return {
    ...record,
    resultHandoff: {
      ...record.resultHandoff,
      structuredResult,
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

function parseStructuredManagedResult(text: string): StructuredExecutionResult | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
  try {
    return defineStructuredExecutionResult(JSON.parse(trimmed) as StructuredExecutionResult);
  } catch {
    return undefined;
  }
}
export {
  appendManagedInvocationSessionEvents,
} from "./session-events.js";
export type {
  AppendManagedInvocationSessionEventsInput,
} from "./session-events.js";
export {
  appendManagedInvocationPromptAdmissionSessionEvent,
  appendManagedInvocationPromptRecoverySessionEvent,
  ManagedInvocationPromptAdmissionConflictError,
} from "./prompt-admission.js";
export type {
  AppendManagedInvocationPromptAdmissionSessionEventInput,
  AppendManagedInvocationPromptRecoverySessionEventInput,
  ManagedInvocationPromptDeliveryState,
  ManagedInvocationPromptDeliveryMode,
} from "./prompt-admission.js";
export {
  runManagedAgentOrchestrationLifecycle,
} from "./orchestration-lifecycle.js";
export type {
  ManagedAgentOrchestrationBudgetAdmissionInput,
  ManagedAgentOrchestrationLifecycleChildRecord,
  ManagedAgentOrchestrationLifecycleInput,
  ManagedAgentOrchestrationLifecycleResult,
  ManagedAgentOrchestrationLifecycleRouteSelector,
} from "./orchestration-lifecycle.js";
export {
  createManagedAgentInvocationResourceProvider,
  isManagedAgentInvocationResourceProvider,
  MANAGED_AGENT_INVOCATION_RESOURCE_PROVIDER_KIND,
  withManagedAgentInvocationResourceProvider,
} from "./resource-provider.js";
export type {
  ManagedAgentInvocationResourceProviderInput,
} from "./resource-provider.js";
export {
  MANAGED_AGENT_RESOURCE_PREFIX,
  invocationResourceUri,
  managedInvocationPublicResourceUri,
  managedInvocationResourcePath,
  projectManagedInvocationRecordResources,
} from "./resource-projection.js";
export type {
  ManagedInvocationResourceProjectionOptions,
} from "./resource-projection.js";
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
  ManagedFilesystemRuntimeRecoveryStore,
  validateManagedAgentRuntimeRecoveryCheckpoint,
};
export type {
  ManagedAgentRuntimeRecoveryCheckpoint,
  ManagedAgentRuntimeRecoveryLeaseStage,
  ManagedAgentRuntimeRecoveryStore,
  ManagedFilesystemRuntimeRecoveryStoreConfig,
};
export {
  ManagedAgentRuntimeRecoveryDaemon,
} from "./recovery-daemon.js";
export type {
  ManagedAgentRuntimeRecoveryDaemonConfig,
  ManagedAgentRuntimeRecoveryDaemonRunInput,
  ManagedAgentRuntimeRecoveryDaemonRunResult,
  ManagedAgentRuntimeRecoveryDaemonService,
} from "./recovery-daemon.js";
export {
  ManagedCliHarnessAdapter,
} from "./cli-harness-adapter.js";
export type {
  ManagedCliHarnessAdapterConfig,
  ManagedCliHarnessFilesystemBoundaryConfig,
} from "./cli-harness-adapter.js";
export {
  ManagedRemoteHarnessAdapter,
} from "./remote-harness-adapter.js";
export type {
  ManagedRemoteHarnessAdapterConfig,
  ManagedRemoteHarnessTransport,
  ManagedRemoteHarnessTransportCancelInput,
  ManagedRemoteHarnessTransportInvokeInput,
} from "./remote-harness-adapter.js";
export {
  attachManagedInvocationSessionEventSink,
  createManagedAgentOrchestrateToolDefinition,
  createManagedAgentStartToolDefinition,
  createManagedInvocationToolAttachment,
  createManagedInvocationToolExecutor,
  createManagedInvocationLifecycleToolExecutors,
  resolveManagedInvocationService,
  withManagedInvocationService,
  MANAGED_AGENT_CANCEL_CAPABILITY,
  MANAGED_AGENT_CANCEL_TOOL,
  MANAGED_AGENT_CANCEL_TOOL_NAME,
  MANAGED_AGENT_JOIN_CAPABILITY,
  MANAGED_AGENT_JOIN_TOOL,
  MANAGED_AGENT_JOIN_TOOL_NAME,
  MANAGED_AGENT_LIST_CAPABILITY,
  MANAGED_AGENT_LIST_TOOL,
  MANAGED_AGENT_LIST_TOOL_NAME,
  MANAGED_AGENT_ORCHESTRATE_CAPABILITY,
  MANAGED_AGENT_ORCHESTRATE_TOOL,
  MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
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
  ManagedInvocationToolAttachment,
  ManagedInvocationToolOptions,
  ManagedInvocationToolOptionsWithService,
  ManagedInvocationToolRoute,
} from "./runtime-tool.js";
export { evaluateManagedInvocationCallerCapability } from "./caller-capability-policy.js";
export type { ManagedInvocationCallerCapabilityInput } from "./caller-capability-policy.js";
export { ManagedAgentRuntimeAdmissionError } from "./errors.js";

export interface ManagedAgentRuntimeInvocationInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly abortSignal: AbortSignal;
  readonly promptDelivery: ManagedAgentRuntimePromptDeliveryCoordinator;
  readonly progressObserver?: ManagedAgentRuntimeInvocationProgressObserver;
  readonly environment?: ManagedAgentEnvironmentVariables;
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
  readonly kind: "tool_authorized" | "tool_called" | "tool_result" | "tool_cache_hit" | "error";
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
}

export interface ManagedAgentRuntimeAuthorityObserver {
  observe(input: ManagedAgentRuntimeAuthorityObservationInput): Promise<ManagedAgentObservedRuntimeAuthorityEvidence>;
}

class ManagedAgentRuntimeAuthorityObservationError extends ManagedAgentRuntimeAdmissionError {}

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

export type ManagedAgentSandboxLeaseManagerInput = ManagedAgentWorktreeLeaseManagerInput;

export type ManagedAgentSandboxLeaseReleaseInput = ManagedAgentWorktreeLeaseReleaseInput;

export interface ManagedAgentSandboxLeaseManager {
  acquire(input: ManagedAgentSandboxLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence>;
  release(input: ManagedAgentSandboxLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence>;
}

export type ManagedAgentArtifactDirectoryLeaseManagerInput = ManagedAgentWorktreeLeaseManagerInput;

export type ManagedAgentArtifactDirectoryLeaseReleaseInput = ManagedAgentWorktreeLeaseReleaseInput;

export interface ManagedAgentArtifactDirectoryLeaseManager {
  acquire(input: ManagedAgentArtifactDirectoryLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence>;
  release(input: ManagedAgentArtifactDirectoryLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence>;
}

export type ManagedAgentDevServerPortLeaseManagerInput = ManagedAgentWorktreeLeaseManagerInput;

export type ManagedAgentDevServerPortLeaseReleaseInput = ManagedAgentWorktreeLeaseReleaseInput;

export interface ManagedAgentDevServerPortLeaseManager {
  acquire(input: ManagedAgentDevServerPortLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence>;
  release(input: ManagedAgentDevServerPortLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence>;
}

export type ManagedAgentEnvironmentVariables = Readonly<Record<string, string>>;

export type ManagedAgentEnvironmentLeaseManagerInput = ManagedAgentWorktreeLeaseManagerInput;

export interface ManagedAgentEnvironmentLease {
  readonly lease: ManagedAgentResourceLeaseEvidence;
  readonly environment: ManagedAgentEnvironmentVariables;
}

export type ManagedAgentEnvironmentLeaseReleaseInput = ManagedAgentWorktreeLeaseReleaseInput;

export interface ManagedAgentEnvironmentLeaseManager {
  acquire(input: ManagedAgentEnvironmentLeaseManagerInput): Promise<ManagedAgentEnvironmentLease>;
  release(input: ManagedAgentEnvironmentLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence>;
}

export type ManagedAgentCredentialRouteLeaseManagerInput = ManagedAgentWorktreeLeaseManagerInput;

export type ManagedAgentCredentialRouteLeaseReleaseInput = ManagedAgentWorktreeLeaseReleaseInput;

export interface ManagedAgentCredentialRouteLeaseManager {
  acquire(input: ManagedAgentCredentialRouteLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence>;
  release(input: ManagedAgentCredentialRouteLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence>;
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

export interface ManagedGitWorktreeLeaseManagerConfig {
  readonly repositoryPath: string;
  readonly worktreeRootPath: string;
  readonly ref?: string;
  readonly gitBinary?: string;
}

export interface ManagedFilesystemArtifactDirectoryLeaseManagerConfig {
  readonly artifactRootPath: string;
}

export interface ManagedInMemoryDevServerPortLeaseManagerConfig {
  readonly ports: readonly number[];
  readonly host?: string;
}

export type ManagedRuntimeEnvironmentBinding =
  | {
    readonly name: string;
    readonly value: string;
  }
  | {
    readonly name: string;
    readonly valueFrom: "dev-server-port";
  };

export interface ManagedRuntimeEnvironmentLeaseManagerConfig {
  readonly bindings: readonly ManagedRuntimeEnvironmentBinding[];
}

export interface ManagedRuntimeCredentialRouteLeaseManagerConfig {
  readonly allowedRouteIds?: readonly string[];
}

const execFileAsync = promisify(execFile);

export class ManagedAgentLeaseAcquireError extends ManagedAgentRuntimeAdmissionError {
  constructor(
    message: string,
    readonly sideEffected: boolean,
  ) {
    super(message);
  }
}

class ManagedAgentWorktreeLeaseAcquireError extends ManagedAgentLeaseAcquireError {}

export class ManagedAgentWorktreeReviewRequiredError extends ManagedAgentRuntimeAdmissionError {}

class ManagedAgentArtifactDirectoryLeaseAcquireError extends ManagedAgentLeaseAcquireError {}

class ManagedAgentDevServerPortLeaseAcquireError extends ManagedAgentLeaseAcquireError {}

class ManagedAgentEnvironmentLeaseAcquireError extends ManagedAgentLeaseAcquireError {}

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
      throw new ManagedAgentWorktreeReviewRequiredError("Managed git worktree lease is dirty; preserving worktree for review");
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

export class ManagedFilesystemArtifactDirectoryLeaseManager implements ManagedAgentArtifactDirectoryLeaseManager {
  private readonly artifactRootPath: string;

  constructor(config: ManagedFilesystemArtifactDirectoryLeaseManagerConfig) {
    this.artifactRootPath = config.artifactRootPath;
  }

  async acquire(input: ManagedAgentArtifactDirectoryLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence> {
    const artifactDirectoryPath = this.artifactDirectoryPath(input.request.invocationId);
    this.assertArtifactDirectoryPath(artifactDirectoryPath);
    await this.ensureArtifactDirectory(artifactDirectoryPath);
    return {
      ...input.lease,
      healthStatus: "healthy",
      cleanupStatus: "pending",
      resourceUris: uniqueStrings([
        ...input.lease.resourceUris,
        `kiln://artifacts/${input.request.invocationId}/artifact-directory`,
      ]),
    };
  }

  async release(input: ManagedAgentArtifactDirectoryLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence> {
    const artifactDirectoryPath = this.artifactDirectoryPath(input.request.invocationId);
    this.assertArtifactDirectoryPath(artifactDirectoryPath);
    try {
      await rmdir(artifactDirectoryPath);
    } catch (error) {
      if (!isNonEmptyDirectoryError(error)) {
        throw error;
      }
      return {
        ...input.lease,
        healthStatus: "leaked",
        cleanupStatus: "failed",
        diagnosticUris: uniqueStrings([
          ...input.lease.diagnosticUris,
          `kiln://artifacts/${input.request.invocationId}/artifact-directory-preserved`,
        ]),
      };
    }
    return {
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: uniqueStrings([
        ...input.lease.diagnosticUris,
        `kiln://artifacts/${input.request.invocationId}/artifact-directory-cleanup`,
      ]),
    };
  }

  private async ensureArtifactDirectory(path: string): Promise<void> {
    if (await pathExists(path)) {
      throw new ManagedAgentArtifactDirectoryLeaseAcquireError(
        "Managed artifact-directory lease path already exists; refusing to adopt unmanaged artifact directory",
        false,
      );
    }
    try {
      await mkdir(this.artifactRootPath, { recursive: true });
      await mkdir(path);
    } catch (error) {
      throw new ManagedAgentArtifactDirectoryLeaseAcquireError(toError(error).message, true);
    }
  }

  private artifactDirectoryPath(invocationId: string): string {
    return pathWin32.join(this.artifactRootPath, invocationId);
  }

  private assertArtifactDirectoryPath(path: string): void {
    const normalizedRoot = normalizeLeasePath(this.artifactRootPath);
    const normalizedPath = normalizeLeasePath(path);
    if (normalizedPath === normalizedRoot || !normalizedPath.startsWith(`${normalizedRoot}/`)) {
      throw new ManagedAgentArtifactDirectoryLeaseAcquireError(
        "Managed artifact-directory lease path is outside configured artifact root",
        false,
      );
    }
  }
}

export class ManagedInMemoryDevServerPortLeaseManager implements ManagedAgentDevServerPortLeaseManager {
  private readonly ports: readonly number[];
  private readonly host: string;
  private readonly leases = new Map<string, number>();
  private readonly pendingPorts = new Set<number>();

  constructor(config: ManagedInMemoryDevServerPortLeaseManagerConfig) {
    this.ports = uniqueNumbers(config.ports.map(validateDevServerPort));
    if (this.ports.length === 0) {
      throw new ManagedAgentRuntimeAdmissionError("Managed dev-server port lease manager requires at least one port");
    }
    this.host = config.host ?? "127.0.0.1";
  }

  async acquire(input: ManagedAgentDevServerPortLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence> {
    const port = await this.reserveAvailablePort();
    if (port === undefined) {
      throw new ManagedAgentDevServerPortLeaseAcquireError("No managed dev-server ports are available", false);
    }
    try {
      this.leases.set(input.request.invocationId, port);
      return {
        ...input.lease,
        healthStatus: "healthy",
        cleanupStatus: "pending",
        resourceUris: uniqueStrings([
          ...input.lease.resourceUris,
          devServerPortResourceUri(input.request.invocationId, port),
        ]),
      };
    } finally {
      this.pendingPorts.delete(port);
    }
  }

  async release(input: ManagedAgentDevServerPortLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence> {
    const port = this.leases.get(input.request.invocationId);
    if (port === undefined) {
      return input.lease;
    }
    this.leases.delete(input.request.invocationId);
    return {
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: uniqueStrings([
        ...input.lease.diagnosticUris,
        devServerPortReleaseUri(input.request.invocationId, port),
      ]),
    };
  }

  private async reserveAvailablePort(): Promise<number | undefined> {
    const leasedPorts = new Set(this.leases.values());
    for (const port of this.ports) {
      if (leasedPorts.has(port) || this.pendingPorts.has(port)) {
        continue;
      }
      this.pendingPorts.add(port);
      try {
        if (await canBindTcpPort(this.host, port)) {
          return port;
        }
      } catch (error) {
        this.pendingPorts.delete(port);
        throw error;
      }
      this.pendingPorts.delete(port);
    }
    return undefined;
  }
}

export class ManagedRuntimeEnvironmentLeaseManager implements ManagedAgentEnvironmentLeaseManager {
  private readonly bindings: readonly ManagedRuntimeEnvironmentBinding[];

  constructor(config: ManagedRuntimeEnvironmentLeaseManagerConfig) {
    if (config.bindings.length === 0) {
      throw new ManagedAgentRuntimeAdmissionError("Managed environment lease manager requires at least one binding");
    }
    this.bindings = config.bindings.map((binding) => ({
      ...binding,
      name: validateEnvironmentName(binding.name),
    }));
    assertNoEnvironmentNameCollisions(this.bindings.map((binding) => binding.name));
  }

  async acquire(input: ManagedAgentEnvironmentLeaseManagerInput): Promise<ManagedAgentEnvironmentLease> {
    const environment = Object.create(null) as Record<string, string>;
    for (const binding of this.bindings) {
      environment[binding.name] = this.resolveBindingValue(input, binding);
    }
    return {
      lease: {
        ...input.lease,
        healthStatus: "healthy",
        cleanupStatus: "pending",
        resourceUris: uniqueStrings([
          ...input.lease.resourceUris,
          ...this.bindings.map((binding) => environmentBindingResourceUri(input.request.invocationId, binding.name)),
        ]),
      },
      environment,
    };
  }

  async release(input: ManagedAgentEnvironmentLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence> {
    return {
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: uniqueStrings([
        ...input.lease.diagnosticUris,
        ...this.bindings.map((binding) => environmentBindingReleaseUri(input.request.invocationId, binding.name)),
      ]),
    };
  }

  private resolveBindingValue(
    input: ManagedAgentEnvironmentLeaseManagerInput,
    binding: ManagedRuntimeEnvironmentBinding,
  ): string {
    if ("value" in binding) {
      return binding.value;
    }
    const port = readDevServerPortLeaseValue(input.request.invocationId, input.lease.resourceUris);
    if (port === undefined) {
      throw new ManagedAgentEnvironmentLeaseAcquireError(
        "Managed environment binding requires a dev-server port lease",
        false,
      );
    }
    return String(port);
  }
}

export class ManagedRuntimeSandboxLeaseManager implements ManagedAgentSandboxLeaseManager {
  async acquire(input: ManagedAgentSandboxLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence> {
    if (input.request.authority.workingDirectory.mode !== "sandbox") {
      return input.lease;
    }
    return {
      ...input.lease,
      healthStatus: "healthy",
      cleanupStatus: "pending",
      resourceUris: uniqueStrings([
        ...input.lease.resourceUris,
        sandboxPolicyResourceUri(input.request.invocationId),
      ]),
    };
  }

  async release(input: ManagedAgentSandboxLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence> {
    if (input.request.authority.workingDirectory.mode !== "sandbox") {
      return input.lease;
    }
    return {
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: uniqueStrings([
        ...input.lease.diagnosticUris,
        sandboxPolicyReleaseUri(input.request.invocationId),
      ]),
    };
  }
}

export class ManagedRuntimeCredentialRouteLeaseManager implements ManagedAgentCredentialRouteLeaseManager {
  private readonly allowedRouteIds: ReadonlySet<string> | undefined;

  constructor(config: ManagedRuntimeCredentialRouteLeaseManagerConfig = {}) {
    this.allowedRouteIds = config.allowedRouteIds === undefined
      ? undefined
      : new Set(config.allowedRouteIds.map((routeId) => validateCredentialRouteId(routeId)));
  }

  async acquire(input: ManagedAgentCredentialRouteLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence> {
    const routeId = this.resolveRuntimeSelectedRouteId(input.request);
    if (routeId === undefined) {
      return input.lease;
    }
    return {
      ...input.lease,
      healthStatus: "healthy",
      cleanupStatus: "pending",
      resourceUris: uniqueStrings([
        ...input.lease.resourceUris,
        credentialRouteResourceUri(input.request.invocationId, routeId),
      ]),
    };
  }

  async release(input: ManagedAgentCredentialRouteLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence> {
    const routeId = this.resolveRuntimeSelectedRouteId(input.request);
    if (routeId === undefined) {
      return input.lease;
    }
    return {
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: uniqueStrings([
        ...input.lease.diagnosticUris,
        credentialRouteReleaseUri(input.request.invocationId, routeId),
      ]),
    };
  }

  private resolveRuntimeSelectedRouteId(request: ManagedAgentInvocationRequest): string | undefined {
    const credentialRoute = request.authority.credentialRoute;
    if (credentialRoute.mode !== "runtime-selected") {
      return undefined;
    }
    const routeId = validateCredentialRouteId(credentialRoute.routeId);
    if (this.allowedRouteIds !== undefined && !this.allowedRouteIds.has(routeId)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed credential route is not admitted by the credential route lease manager");
    }
    return routeId;
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

interface ManagedAgentRuntimeInvocationTerminal {
  readonly promise: Promise<Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>>;
  readonly resolve: (value: Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>) => void;
  readonly reject: (reason?: unknown) => void;
}

interface ManagedAgentRuntimeInvocationEntry {
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly adapter?: ManagedAgentRuntimeAdapter;
  lifecycleState: ManagedAgentLifecycleState;
  readonly startedAt: Date;
  readonly abortController: AbortController;
  runtimeLease?: ManagedAgentResourceLeaseEvidence;
  runtimeLeaseForRelease?: ManagedAgentResourceLeaseEvidence;
  runtimeEnvironment?: ManagedAgentEnvironmentVariables;
  environmentValueLeakingUris?: readonly string[];
  acquiredLeaseStages: ManagedAgentRuntimeLeaseStage[];
  releasedLeaseStages: ManagedAgentRuntimeLeaseStage[];
  promptInbox: ManagedAgentRuntimePromptAdmissionRecord[];
  progressEvents: ManagedAgentRuntimeInvocationProgressEvent[];
  adapterStarted: boolean;
  parentAbortCleanup?: () => void;
  leaseFinalization?: Promise<ManagedAgentInvocationRecord>;
  finishedAt?: Date;
  record?: ManagedAgentInvocationRecord;
  error?: Error;
  terminal?: ManagedAgentRuntimeInvocationTerminal;
  terminalObserver?: ManagedAgentRuntimeInvocationTerminalObserver;
  terminalObserverNotified?: boolean;
}

type ManagedAgentRuntimeLeaseStage = ManagedAgentRuntimeRecoveryLeaseStage;

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
    if (this.invocations.has(request.invocationId)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation is already registered");
    }

    const admittedSnapshotInput = this.options.authorityObserver === undefined
      ? capabilitySnapshotInputWithRuntimeAuthorityProjection(request, adapter, capabilitySnapshotInput, this.now())
      : await this.capabilitySnapshotInputWithObservedRuntimeAuthority(request, adapter, capabilitySnapshotInput);
    const decision = evaluateManagedAgentAdmission(request, adapter.descriptor, admittedSnapshotInput, {
      evaluatedAt: this.now().toISOString(),
    });
    if (decision.status === "denied") {
      return {
        status: "denied",
        decision: cloneJson(decision),
      };
    }
    const writeLeaseConflict = this.detectActiveWriteLeaseConflict(request, decision);
    if (writeLeaseConflict) {
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
      terminal,
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
        return this.completePreAdapterTerminalStart(entry, registeredDecision);
      }
    }
    try {
      await this.acquireRuntimeResourceLeases(entry);
    } catch (error) {
      if ((entry.lifecycleState === "cancelled" || entry.lifecycleState === "stale") && entry.record) {
        return this.completePreAdapterTerminalStart(entry, registeredDecision);
      }
      const runtimeError = toError(error);
      if (!this.shouldCompensateAcquireFailure(error, entry)) {
        this.invocations.delete(request.invocationId);
        terminal.reject(runtimeError);
        throw runtimeError;
      }
      entry.runtimeLease = entry.runtimeLease ?? registeredDecision.capabilitySnapshot.resourceLease;
      entry.runtimeLeaseForRelease = entry.runtimeLeaseForRelease ?? entry.runtimeLease;
      entry.finishedAt = new Date();
      entry.lifecycleState = "failed";
      entry.error = runtimeError;
      entry.record = await this.finalizeTerminalLeaseStages(
        entry,
        createFailedRecord(entry.request, entry.decision, runtimeError.message),
      );
      this.notifyTerminalObserver(entry);
      terminal.reject(runtimeError);
      throw runtimeError;
    }
    if (entry.lifecycleState === "cancelled" && entry.record) {
      return this.completePreAdapterTerminalStart(entry, registeredDecision);
    }
    if (entry.lifecycleState === "stale" && entry.record) {
      return this.completePreAdapterTerminalStart(entry, registeredDecision);
    }
    const authorityCheckedInvocation = this.assertPostStartAuthority(request, adapter, registeredDecision, abortController)
      .then(() => {
        entry.adapterStarted = true;
        return this.invokeAdmitted({
          request: cloneJson(registeredRequest),
          adapter,
          admission: cloneJson(registeredDecision),
          abortSignal: abortController.signal,
          promptDelivery: this.promptDeliveryCoordinator(registeredRequest.invocationId),
          progressObserver: (event) => this.recordProgress(entry, event),
          ...(entry.runtimeEnvironment !== undefined ? { environment: cloneJson(entry.runtimeEnvironment) } : {}),
        });
      });
    const adapterTerminal: Promise<Extract<ManagedAgentRuntimeInvocationResult, { readonly status: "completed" }>> = authorityCheckedInvocation.then(async (record) => {
      if (entry.lifecycleState === "failed" && entry.record) {
        const failedRecord = await this.currentTerminalRecord(entry);
        return {
          status: "completed",
          decision: registeredDecision,
          record: failedRecord,
        } as const;
      }
      if (entry.lifecycleState === "stale" && entry.record) {
        const staleRecord = await this.currentTerminalRecord(entry);
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
          entry.record = await this.finalizeTerminalLeaseStages(entry, mergeCancelledRecords(entry.record, registeredRecord));
          return {
            status: "completed",
            decision: registeredDecision,
            record: entry.record,
          } as const;
        }
        entry.record = await this.finalizeTerminalLeaseStages(entry, entry.record);
        return {
          status: "completed",
          decision: registeredDecision,
          record: entry.record,
        } as const;
      }
      const registeredRecord = cloneJson(record);
      entry.finishedAt = new Date();
      entry.lifecycleState = registeredRecord.lifecycleState;
      entry.record = await this.finalizeTerminalLeaseStages(entry, registeredRecord);
      return {
        status: "completed",
        decision: registeredDecision,
        record: entry.record,
      } as const;
    }, async (error: unknown) => {
      if (entry.lifecycleState === "failed" && entry.record) {
        const failedRecord = await this.currentTerminalRecord(entry);
        return {
          status: "completed",
          decision: registeredDecision,
          record: failedRecord,
        } as const;
      }
      if (entry.lifecycleState === "cancelled" && entry.record) {
        entry.record = await this.finalizeTerminalLeaseStages(entry, entry.record);
        return {
          status: "completed",
          decision: registeredDecision,
          record: entry.record,
        } as const;
      }
      const runtimeError = toError(error);
      if (entry.lifecycleState === "stale" && entry.record) {
        const staleRecord = await this.currentTerminalRecord(entry);
        return {
          status: "completed",
          decision: registeredDecision,
          record: staleRecord,
        } as const;
      }
      entry.finishedAt = new Date();
      entry.lifecycleState = "failed";
      entry.error = runtimeError;
      entry.record = await this.finalizeTerminalLeaseStages(
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
        this.notifyTerminalObserver(entry);
      },
      (error) => {
        terminal.reject(error);
        this.notifyTerminalObserver(entry);
      },
    );
    adapterTerminal.catch(() => undefined);

    return {
      status: "started",
      decision: cloneJson(registeredDecision),
      snapshot: snapshotInvocation(entry),
    };
  }

  private recordProgress(
    entry: ManagedAgentRuntimeInvocationEntry,
    event: ManagedAgentRuntimeInvocationProgressEvent,
  ): void {
    entry.progressEvents = [...entry.progressEvents, cloneJson(event)].slice(-100);
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
    if (isTerminalLifecycleState(entry.lifecycleState)) {
      throw new ManagedAgentRuntimeAdmissionError(`Managed agent runtime invocation is already terminal: ${entry.lifecycleState}`);
    }
    const prompt = validatePromptText(input.prompt);
    const admittedAt = input.admittedAt ?? new Date();
    assertValidRuntimeDate(admittedAt, "Managed agent prompt admission timestamp is invalid");
    const promptAdmissionId = input.promptAdmissionId
      ? validatePromptId(input.promptAdmissionId)
      : `runtime-prompt-${entry.request.invocationId}-${entry.promptInbox.length + 1}`;
    const existing = entry.promptInbox.find((record) => record.promptAdmissionId === promptAdmissionId);
    if (existing) {
      assertSameRuntimePromptAdmission(existing, {
        prompt,
        deliveryMode: input.deliveryMode,
        wakeRequested: input.wakeRequested,
        requestedBy: input.requestedBy,
        requestSource: input.requestSource,
      });
      return {
        status: "admitted",
        prompt: cloneJson(existing),
      };
    }
    const promptRecord: ManagedAgentRuntimePromptAdmissionRecord = {
      promptAdmissionId,
      invocationId: entry.request.invocationId,
      agentId: entry.request.agentId,
      parentSessionId: entry.request.parentSessionId,
      parentTurnId: entry.request.parentTurnId,
      prompt,
      inputSummary: summarizeRuntimePrompt(prompt),
      promptHash: hashRuntimePrompt(prompt),
      deliveryMode: input.deliveryMode,
      deliveryState: input.deliveryMode === "steer" ? "available" : "queued",
      wakeRequested: input.wakeRequested,
      ...(input.requestedBy !== undefined ? { requestedBy: input.requestedBy } : {}),
      ...(input.requestSource !== undefined ? { requestSource: input.requestSource } : {}),
      admittedAt: admittedAt.toISOString(),
      updatedAt: admittedAt.toISOString(),
    };
    entry.promptInbox.push(promptRecord);
    return {
      status: "admitted",
      prompt: cloneJson(promptRecord),
    };
  }

  claimPromptDeliveries(input: ManagedAgentRuntimePromptDeliveryClaimInput): ManagedAgentRuntimePromptDeliveryClaimResult {
    const entry = this.invocations.get(input.invocationId);
    if (!entry) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation is not registered");
    }
    const claimedAt = input.claimedAt ?? new Date();
    assertValidRuntimeDate(claimedAt, "Managed agent prompt delivery claim timestamp is invalid");
    const claimed: ManagedAgentRuntimePromptAdmissionRecord[] = [];
    for (const prompt of entry.promptInbox) {
      if (!isPromptClaimable(prompt, input.boundary)) {
        continue;
      }
      const mutablePrompt = prompt as {
        deliveryState: ManagedAgentRuntimePromptDeliveryState;
        deliveredAt?: string;
        updatedAt: string;
      };
      mutablePrompt.deliveryState = "delivered";
      mutablePrompt.deliveredAt = claimedAt.toISOString();
      mutablePrompt.updatedAt = claimedAt.toISOString();
      claimed.push(cloneJson(prompt));
    }
    return {
      claimed,
    };
  }

  recoverStuckPromptAdmissions(
    input: ManagedAgentRuntimePromptStuckRecoveryInput,
  ): ManagedAgentRuntimePromptStuckRecoveryResult {
    if (!Number.isFinite(input.staleAfterMs) || input.staleAfterMs <= 0) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent prompt stale threshold must be greater than zero");
    }
    const now = input.now ?? new Date();
    assertValidRuntimeDate(now, "Managed agent prompt recovery timestamp is invalid");
    const reason = stuckPromptRecoveryReason(input.reason);
    const recovered: ManagedAgentRuntimePromptAdmissionRecord[] = [];
    for (const entry of this.invocations.values()) {
      if (isTerminalLifecycleState(entry.lifecycleState)) {
        continue;
      }
      for (const prompt of entry.promptInbox) {
        if (prompt.deliveryState !== "available" && prompt.deliveryState !== "queued") {
          continue;
        }
        const ageMs = now.getTime() - new Date(prompt.admittedAt).getTime();
        if (ageMs < input.staleAfterMs) {
          continue;
        }
        const mutablePrompt = prompt as {
          deliveryState: ManagedAgentRuntimePromptDeliveryState;
          updatedAt: string;
          recovery?: {
            reason: string;
            recoveredAt: string;
          };
        };
        mutablePrompt.deliveryState = "stale";
        mutablePrompt.updatedAt = now.toISOString();
        mutablePrompt.recovery = {
          reason,
          recoveredAt: now.toISOString(),
        };
        recovered.push(cloneJson(prompt));
      }
    }
    return {
      recovered,
    };
  }

  async cancel(invocationId: string, reason = "Managed invocation cancelled."): Promise<ManagedAgentRuntimeInvocationCancelResult> {
    const entry = this.invocations.get(invocationId);
    if (!entry) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation is not registered");
    }
    if (entry.record?.lifecycleState === "cancelled") {
      const record = await this.currentTerminalRecord(entry);
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
        entry.finishedAt = new Date();
        entry.lifecycleState = "failed";
        entry.error = runtimeError;
        entry.record = await this.finalizeTerminalLeaseStages(
          entry,
          createFailedRecord(entry.request, entry.decision, `Managed invocation cancellation failed: ${runtimeError.message}`),
        );
        entry.terminal?.resolve({
          status: "completed",
          decision: entry.decision,
          record: entry.record,
        });
        this.notifyTerminalObserver(entry);
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
    entry.record = await this.finalizeTerminalLeaseStages(entry, entry.record);
    entry.terminal?.resolve({
      status: "completed",
      decision: entry.decision,
      record: entry.record,
    });
    this.notifyTerminalObserver(entry);
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
      entry.record = await this.finalizeTerminalLeaseStages(entry, entry.record);
      entry.terminal?.resolve({
        status: "completed",
        decision: entry.decision,
        record: entry.record,
      });
      this.notifyTerminalObserver(entry);
      recovered.push(snapshotInvocation(entry));
    }

    return {
      recovered: cloneJson(recovered),
    };
  }

  async recoverPersistedInvocations(
    input: ManagedAgentPersistentRecoveryInput = {},
  ): Promise<ManagedAgentStaleRecoveryResult> {
    if (!this.options.recoveryStore) {
      return { recovered: [] };
    }
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent persisted recovery timestamp is invalid");
    }
    const reason = persistedRecoveryReason(input.reason);
    const recovered: ManagedAgentRuntimeInvocationSnapshot[] = [];

    for (const recoverableCheckpoint of await this.options.recoveryStore.listRecoverable()) {
      const checkpoint = validateManagedAgentRuntimeRecoveryCheckpoint(recoverableCheckpoint);
      if (checkpoint.record !== undefined && isTerminalLifecycleState(checkpoint.lifecycleState)) {
        if (isRuntimeRecoveryCleanupResolved(checkpoint.record.resourceLease?.cleanupStatus)) {
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
        entry.record = await this.finalizeTerminalLeaseStages(entry, entry.record);
        entry.terminal?.resolve({ status: "completed", decision: entry.decision, record: entry.record });
        recovered.push(snapshotInvocation(entry));
        continue;
      }
      entry.abortController.abort(reason);
      entry.finishedAt = now;
      entry.lifecycleState = "recovered";
      entry.record = createRecoveredRecord(entry.request, entry.decision, reason);
      this.invocations.set(entry.request.invocationId, entry);
      entry.record = await this.finalizeTerminalLeaseStages(entry, entry.record);
      entry.terminal?.resolve({
        status: "completed",
        decision: entry.decision,
        record: entry.record,
      });
      this.notifyTerminalObserver(entry);
      recovered.push(snapshotInvocation(entry));
    }

    return {
      recovered: cloneJson(recovered),
    };
  }

  async invokeAdmitted(input: {
    readonly request: ManagedAgentInvocationRequest;
    readonly adapter: ManagedAgentRuntimeAdapter;
    readonly admission: ManagedAgentAdmissionDecision;
    readonly abortSignal?: AbortSignal;
    readonly promptDelivery?: ManagedAgentRuntimePromptDeliveryCoordinator;
    readonly progressObserver?: ManagedAgentRuntimeInvocationProgressObserver;
    readonly environment?: ManagedAgentEnvironmentVariables;
  }): Promise<ManagedAgentInvocationRecord> {
    const admission = this.requireRuntimeAdmission(input);
    const environment = input.environment === undefined ? undefined : validateManagedEnvironment(input.environment);
    const record = await input.adapter.invoke({
      request: input.request,
      admission,
      abortSignal: input.abortSignal ?? new AbortController().signal,
      promptDelivery: input.promptDelivery ?? this.promptDeliveryCoordinator(input.request.invocationId),
      ...(input.progressObserver !== undefined ? { progressObserver: input.progressObserver } : {}),
      ...(environment !== undefined ? { environment: cloneJson(environment) } : {}),
    });
    const canonicalRecord = attachStructuredManagedResult(record);
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
    assertManagedAgentResultHandoffContract(input.request.input.handoff, attributedRecord.resultHandoff);
    this.assertRecordWithinAdmission(attributedRecord, input.request, admission);
    return attributedRecord;
  }

  private async capabilitySnapshotInputWithObservedRuntimeAuthority(
    request: ManagedAgentInvocationRequest,
    adapter: ManagedAgentRuntimeAdapter,
    input: ManagedAgentCapabilitySnapshotInput,
  ): Promise<ManagedAgentCapabilitySnapshotInput> {
    const observedRuntime = await this.observeRuntimeAuthority({
      phase: "pre-start",
      request,
      adapter,
    });
    return {
      ...input,
      authorityEvidence: buildManagedAgentAuthorityEvidence({
        request,
        projectedSource: projectedAuthoritySourceForAdapter(adapter),
        ...(observedRuntime !== undefined ? { observedRuntime } : {}),
        evaluatedAt: this.now().toISOString(),
      }),
    };
  }

  private async assertPostStartAuthority(
    request: ManagedAgentInvocationRequest,
    adapter: ManagedAgentRuntimeAdapter,
    admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
    abortController: AbortController,
  ): Promise<void> {
    if (this.options.authorityObserver === undefined) return;
    const observedRuntime = await this.observeRuntimeAuthority({
      phase: "post-start",
      request,
      adapter,
    });
    const evidence = buildManagedAgentAuthorityEvidence({
      request,
      projectedSource: admission.capabilitySnapshot.authorityEvidence.projected.source,
      observedRuntime,
      evaluatedAt: this.now().toISOString(),
    });
    if (evidence.classification !== "current-verified") {
      const reason = `Managed child runtime authority changed after start: ${evidence.classification}`;
      abortController.abort(reason);
      await adapter.cancel?.({
        request: cloneJson(request),
        admission: cloneJson(admission),
        reason,
        abortSignal: abortController.signal,
      });
      throw new ManagedAgentRuntimeAuthorityObservationError(
        reason,
      );
    }
  }

  private async observeRuntimeAuthority(input: {
    readonly phase: ManagedAgentRuntimeAuthorityObservationInput["phase"];
    readonly request: ManagedAgentInvocationRequest;
    readonly adapter: ManagedAgentRuntimeAdapter;
  }): Promise<ManagedAgentObservedRuntimeAuthorityEvidence | undefined> {
    try {
      return await this.options.authorityObserver?.observe({
        phase: input.phase,
        request: cloneJson(input.request),
        adapterDescriptor: cloneJson(input.adapter.descriptor),
      });
    } catch (error) {
      const runtimeError = toError(error);
      return {
        source: "runtime-observation",
        proof: "failed",
        reason: `Managed child runtime authority observation failed during ${input.phase}: ${runtimeError.message}`,
      };
    }
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
    entry.record = await this.finalizeTerminalLeaseStages(entry, entry.record);
    entry.terminal?.resolve({
      status: "completed",
      decision,
      record: entry.record,
    });
    this.notifyTerminalObserver(entry);
    return {
      status: "started",
      decision: cloneJson(decision),
      snapshot: snapshotInvocation(entry),
    };
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
      { evaluatedAt: this.now().toISOString() },
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

  private detectActiveWriteLeaseConflict(
    request: ManagedAgentInvocationRequest,
    decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  ): Extract<ManagedAgentAdmissionDecision, { readonly status: "denied" }> | undefined {
    if (!isSameCheckoutWriteInvocation(request) && !isIsolatedWorktreeInvocation(request)) {
      return undefined;
    }

    for (const entry of this.invocations.values()) {
      if (isTerminalLifecycleState(entry.lifecycleState)) {
        continue;
      }
      if (isIsolatedWorktreeInvocation(request) && isIsolatedWorktreeInvocation(entry.request)) {
        if (samePath(entry.request.authority.workingDirectory.path, request.authority.workingDirectory.path)) {
          return deniedWriteLeaseConflictDecision({
            request,
            decision,
            active: entry,
            reason: "isolated-worktree-path-conflict",
          });
        }
        continue;
      }
      if (!isSameCheckoutWriteInvocation(request) || !isSameCheckoutWriteInvocation(entry.request)) {
        continue;
      }
      if (!samePath(entry.request.authority.workingDirectory.path, request.authority.workingDirectory.path)) {
        continue;
      }
      if (hasDisjointApprovedWorkspaceScope(entry.request, request)) {
        continue;
      }
      return deniedWriteLeaseConflictDecision({
        request,
        decision,
        active: entry,
        reason: "same-checkout-write-conflict",
      });
    }
    return undefined;
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
    if (record.agentId !== request.agentId) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record agent id does not match admitted request");
    }
    if (record.profile !== request.profile || record.profile !== admission.profile) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record profile does not match admitted request");
    }
    if (!sameJson(record.providerRoute, request.providerRoute)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record provider route does not match admitted request");
    }
    if (record.adapterKind !== request.adapterKind) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record adapter kind does not match admitted request");
    }
    if (record.executionMode !== request.executionMode) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent record execution mode does not match admitted request");
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

  private async acquireRuntimeResourceLeases(entry: ManagedAgentRuntimeInvocationEntry): Promise<void> {
    let lease = entry.decision.capabilitySnapshot.resourceLease;
    if (entry.request.authority.workingDirectory.mode === "isolated-worktree") {
      if (!this.options.worktreeLeaseManager) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent isolated worktree lease manager is required");
      }
      try {
        lease = validateResourceLease(entry.request, entry.decision, await this.options.worktreeLeaseManager.acquire({
          request: cloneJson(entry.request),
          decision: cloneJson(entry.decision),
          lease: cloneJson(lease),
        }));
      } catch (error) {
        if (isSideEffectedLeaseAcquireError(error)) {
          markLeaseStageAcquired(entry, "worktree");
          await this.saveRuntimeRecoveryCheckpoint(entry);
        }
        throw error;
      }
      markLeaseStageAcquired(entry, "worktree");
      entry.runtimeLease = lease;
      entry.runtimeLeaseForRelease = lease;
      await this.saveRuntimeRecoveryCheckpoint(entry);
    }
    if (entry.request.authority.workingDirectory.mode === "sandbox") {
      if (!this.options.sandboxLeaseManager) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent sandbox lease manager is required");
      }
      try {
        lease = validateResourceLease(entry.request, entry.decision, await this.options.sandboxLeaseManager.acquire({
          request: cloneJson(entry.request),
          decision: cloneJson(entry.decision),
          lease: cloneJson(lease),
        }));
      } catch (error) {
        if (isSideEffectedLeaseAcquireError(error)) {
          markLeaseStageAcquired(entry, "sandbox");
          await this.saveRuntimeRecoveryCheckpoint(entry);
        }
        throw error;
      }
      markLeaseStageAcquired(entry, "sandbox");
      entry.runtimeLease = lease;
      entry.runtimeLeaseForRelease = lease;
      await this.saveRuntimeRecoveryCheckpoint(entry);
    }
    if (this.options.artifactDirectoryLeaseManager) {
      try {
        lease = validateResourceLease(entry.request, entry.decision, await this.options.artifactDirectoryLeaseManager.acquire({
          request: cloneJson(entry.request),
          decision: cloneJson(entry.decision),
          lease: cloneJson(lease),
        }));
      } catch (error) {
        if (isSideEffectedLeaseAcquireError(error)) {
          markLeaseStageAcquired(entry, "artifact-directory");
          await this.saveRuntimeRecoveryCheckpoint(entry);
        }
        throw error;
      }
      markLeaseStageAcquired(entry, "artifact-directory");
      entry.runtimeLease = lease;
      entry.runtimeLeaseForRelease = lease;
      await this.saveRuntimeRecoveryCheckpoint(entry);
    }
    if (this.options.devServerPortLeaseManager) {
      try {
        lease = validateResourceLease(entry.request, entry.decision, await this.options.devServerPortLeaseManager.acquire({
          request: cloneJson(entry.request),
          decision: cloneJson(entry.decision),
          lease: cloneJson(lease),
        }));
      } catch (error) {
        if (isSideEffectedLeaseAcquireError(error)) {
          markLeaseStageAcquired(entry, "dev-server-port");
          await this.saveRuntimeRecoveryCheckpoint(entry);
        }
        throw error;
      }
      markLeaseStageAcquired(entry, "dev-server-port");
      entry.runtimeLease = lease;
      entry.runtimeLeaseForRelease = lease;
      await this.saveRuntimeRecoveryCheckpoint(entry);
    }
    if (this.options.environmentLeaseManager) {
      try {
        const previousLease = lease;
        const environmentLease = await this.options.environmentLeaseManager.acquire({
          request: cloneJson(entry.request),
          decision: cloneJson(entry.decision),
          lease: cloneJson(lease),
        });
        markLeaseStageAcquired(entry, "environment");
        lease = validateResourceLease(entry.request, entry.decision, environmentLease.lease);
        entry.runtimeLeaseForRelease = lease;
        await this.saveRuntimeRecoveryCheckpoint(entry);
        let environment: ManagedAgentEnvironmentVariables;
        try {
          environment = validateManagedEnvironment(environmentLease.environment);
        } catch (error) {
          entry.runtimeLease = lease;
          throw error;
        }
        entry.runtimeEnvironment = mergeManagedEnvironment(
          entry.runtimeEnvironment,
          environment,
        );
        const leakingUris = environmentLeaseUrisContainingValues(previousLease, lease, environment);
        if (leakingUris.length > 0) {
          entry.environmentValueLeakingUris = uniqueStrings([
            ...(entry.environmentValueLeakingUris ?? []),
            ...leakingUris,
          ]);
          throw new ManagedAgentRuntimeAdmissionError("Managed environment lease URI must not contain environment binding values");
        }
        entry.runtimeLease = lease;
      } catch (error) {
        if (isSideEffectedLeaseAcquireError(error)) {
          markLeaseStageAcquired(entry, "environment");
          await this.saveRuntimeRecoveryCheckpoint(entry);
        }
        throw error;
      }
    }
    if (entry.request.authority.credentialRoute.mode === "runtime-selected") {
      if (!this.options.credentialRouteLeaseManager) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent credential-route lease manager is required");
      }
      try {
        lease = validateResourceLease(entry.request, entry.decision, await this.options.credentialRouteLeaseManager.acquire({
          request: cloneJson(entry.request),
          decision: cloneJson(entry.decision),
          lease: cloneJson(lease),
        }));
      } catch (error) {
        if (isSideEffectedLeaseAcquireError(error)) {
          markLeaseStageAcquired(entry, "credential-route");
          await this.saveRuntimeRecoveryCheckpoint(entry);
        }
        throw error;
      }
      markLeaseStageAcquired(entry, "credential-route");
      entry.runtimeLease = lease;
      entry.runtimeLeaseForRelease = lease;
      await this.saveRuntimeRecoveryCheckpoint(entry);
    }
  }

  private async finalizeTerminalLeaseStages(
    entry: ManagedAgentRuntimeInvocationEntry,
    record: ManagedAgentInvocationRecord,
  ): Promise<ManagedAgentInvocationRecord> {
    const recordWasCurrent = record === entry.record;
    const finalize = async (): Promise<ManagedAgentInvocationRecord> => {
      const recordForFinalization = recordWasCurrent ? (entry.record ?? record) : record;
      const finalizedRecord = await this.finalizeTerminalLease(entry, recordForFinalization);
      entry.record = finalizedRecord;
      return finalizedRecord;
    };
    const previousFinalization = entry.leaseFinalization;
    const nextFinalization = previousFinalization
      ? previousFinalization.then(finalize, finalize)
      : finalize();
    entry.leaseFinalization = nextFinalization;
    try {
      return await nextFinalization;
    } finally {
      if (entry.leaseFinalization === nextFinalization) {
        entry.leaseFinalization = undefined;
      }
    }
  }

  private async currentTerminalRecord(entry: ManagedAgentRuntimeInvocationEntry): Promise<ManagedAgentInvocationRecord> {
    if (entry.leaseFinalization) {
      return entry.leaseFinalization;
    }
    if (entry.record) {
      return defineManagedAgentInvocationRecord(entry.record);
    }
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation has no terminal record");
  }

  private notifyTerminalObserver(entry: ManagedAgentRuntimeInvocationEntry): void {
    const observer = entry.terminalObserver;
    if (entry.terminalObserverNotified || observer === undefined || entry.record === undefined) {
      return;
    }
    entry.terminalObserverNotified = true;
    const durationMs = entry.finishedAt === undefined
      ? undefined
      : entry.finishedAt.getTime() - entry.startedAt.getTime();
    const notification: ManagedAgentRuntimeInvocationTerminalNotification = {
      request: cloneJson(entry.request),
      decision: cloneJson(entry.decision),
      record: cloneJson(entry.record),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
    void Promise.resolve()
      .then(() => observer(notification))
      .catch(() => undefined);
  }

  private async finalizeTerminalLease(
    entry: ManagedAgentRuntimeInvocationEntry,
    record: ManagedAgentInvocationRecord,
  ): Promise<ManagedAgentInvocationRecord> {
    const resourceLeaseForRelease = runtimeLeaseForTerminalRelease(entry, record);
    const leaseStagesToRelease = [...entry.acquiredLeaseStages]
      .reverse()
      .filter((stage) => !entry.releasedLeaseStages.includes(stage));
    if (!resourceLeaseForRelease || entry.acquiredLeaseStages.length === 0) {
      const finalizedRecord = projectManagedInvocationRecordResources(defineManagedAgentInvocationRecord(record));
      await this.saveOrDeleteRuntimeRecoveryCheckpoint(entry, finalizedRecord);
      return finalizedRecord;
    }
    let resourceLease = resourceLeaseForRelease;
    const diagnostics: Array<NonNullable<ManagedAgentInvocationRecord["diagnostics"]>[number]> = [...(record.diagnostics ?? [])];
    const cleanupFailureUris: string[] = [];
    for (const stage of leaseStagesToRelease) {
      entry.releasedLeaseStages.push(stage);
      try {
        const previousLease = resourceLease;
        resourceLease = mergeRuntimeLeaseRelease(
          previousLease,
          await this.releaseRuntimeResourceLeaseStage(stage, entry, record, resourceLease),
        );
        if (resourceLease.cleanupStatus === "failed") {
          const newDiagnosticUris = resourceLease.diagnosticUris.filter((uri) => !previousLease.diagnosticUris.includes(uri));
          diagnostics.push(
            ...newDiagnosticUris.map((uri) => ({
              uri,
              kind: "cleanup" as const,
            })),
          );
        }
      } catch (error) {
        const cleanupDiagnosticUri = `kiln://artifacts/${entry.request.invocationId}/${cleanupFailureResourceName(stage)}-cleanup-failed`;
        const worktreeReview = worktreeReviewEvidenceForCleanupFailure(stage, entry.request.invocationId, error);
        const worktreeReviewDiagnosticUris = worktreeReview?.diagnosticUris ?? [];
        cleanupFailureUris.push(cleanupDiagnosticUri);
        resourceLease = {
          ...resourceLease,
          healthStatus: "leaked",
          cleanupStatus: "failed",
          diagnosticUris: uniqueStrings([
            ...resourceLease.diagnosticUris,
            cleanupDiagnosticUri,
            ...worktreeReviewDiagnosticUris,
          ]),
          ...(worktreeReview !== undefined ? { worktreeReview } : {}),
        };
        diagnostics.push(
          {
            uri: cleanupDiagnosticUri,
            kind: "cleanup",
          },
          ...worktreeReviewDiagnosticUris.map((uri) => ({
            uri,
            kind: "cleanup" as const,
          })),
        );
      }
    }
    const terminalResourceLease = sanitizeEnvironmentLeaseEvidence(resourceLease, entry.environmentValueLeakingUris);
    const terminalDiagnostics = sanitizeEnvironmentDiagnostics(diagnostics, entry.environmentValueLeakingUris);
    const finalizedRecord = projectManagedInvocationRecordResources(
      defineManagedAgentInvocationRecord({
        ...record,
        resourceLease: {
          ...terminalResourceLease,
          ...(cleanupFailureUris.length > 0
            ? {
                healthStatus: "leaked" as const,
                cleanupStatus: "failed" as const,
                diagnosticUris: uniqueStrings([...terminalResourceLease.diagnosticUris, ...cleanupFailureUris]),
              }
            : {}),
        },
        ...(terminalDiagnostics.length > 0 ? { diagnostics: terminalDiagnostics } : {}),
      }),
    );
    await this.saveOrDeleteRuntimeRecoveryCheckpoint(entry, finalizedRecord);
    return finalizedRecord;
  }

  private async releaseRuntimeResourceLeaseStage(
    stage: ManagedAgentRuntimeLeaseStage,
    entry: ManagedAgentRuntimeInvocationEntry,
    record: ManagedAgentInvocationRecord,
    lease: ManagedAgentResourceLeaseEvidence,
  ): Promise<ManagedAgentResourceLeaseEvidence> {
    if (stage === "credential-route") {
      if (!this.options.credentialRouteLeaseManager) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent credential-route lease manager is required");
      }
      return validateResourceLease(entry.request, entry.decision, await this.options.credentialRouteLeaseManager.release({
        request: cloneJson(entry.request),
        decision: cloneJson(entry.decision),
        lease: cloneJson(lease),
        record: cloneJson(record),
      }));
    }
    if (stage === "environment") {
      if (!this.options.environmentLeaseManager) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent environment lease manager is required");
      }
      const releasedLease = validateResourceLease(entry.request, entry.decision, await this.options.environmentLeaseManager.release({
        request: cloneJson(entry.request),
        decision: cloneJson(entry.decision),
        lease: cloneJson(lease),
        record: cloneJson(record),
      }));
      if (entry.runtimeEnvironment !== undefined) {
        assertEnvironmentLeaseUrisDoNotContainValues(lease, releasedLease, entry.runtimeEnvironment);
      }
      return releasedLease;
    }
    if (stage === "dev-server-port") {
      if (!this.options.devServerPortLeaseManager) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent dev-server port lease manager is required");
      }
      return validateResourceLease(entry.request, entry.decision, await this.options.devServerPortLeaseManager.release({
        request: cloneJson(entry.request),
        decision: cloneJson(entry.decision),
        lease: cloneJson(lease),
        record: cloneJson(record),
      }));
    }
    if (stage === "artifact-directory") {
      if (!this.options.artifactDirectoryLeaseManager) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent artifact-directory lease manager is required");
      }
      return validateResourceLease(entry.request, entry.decision, await this.options.artifactDirectoryLeaseManager.release({
        request: cloneJson(entry.request),
        decision: cloneJson(entry.decision),
        lease: cloneJson(lease),
        record: cloneJson(record),
      }));
    }
    if (stage === "sandbox") {
      if (!this.options.sandboxLeaseManager) {
        throw new ManagedAgentRuntimeAdmissionError("Managed agent sandbox lease manager is required");
      }
      return validateResourceLease(entry.request, entry.decision, await this.options.sandboxLeaseManager.release({
        request: cloneJson(entry.request),
        decision: cloneJson(entry.decision),
        lease: cloneJson(lease),
        record: cloneJson(record),
      }));
    }
    if (!this.options.worktreeLeaseManager) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent isolated worktree lease manager is required");
    }
    return validateResourceLease(entry.request, entry.decision, await this.options.worktreeLeaseManager.release({
      request: cloneJson(entry.request),
      decision: cloneJson(entry.decision),
      lease: cloneJson(lease),
      record: cloneJson(record),
    }));
  }

  private shouldCompensateAcquireFailure(error: unknown, entry: ManagedAgentRuntimeInvocationEntry): boolean {
    if (entry.acquiredLeaseStages.length > 0) {
      return true;
    }
    if (error instanceof ManagedAgentRuntimeAdmissionError) {
      return false;
    }
    return false;
  }

  private async saveRuntimeRecoveryCheckpoint(entry: ManagedAgentRuntimeInvocationEntry): Promise<void> {
    if (!this.options.recoveryStore || entry.acquiredLeaseStages.length === 0) {
      return;
    }
    await this.options.recoveryStore.save(recoveryCheckpointFromInvocationEntry(entry));
  }

  private async saveOrDeleteRuntimeRecoveryCheckpoint(
    entry: ManagedAgentRuntimeInvocationEntry,
    record: ManagedAgentInvocationRecord,
  ): Promise<void> {
    if (!this.options.recoveryStore || entry.acquiredLeaseStages.length === 0) {
      return;
    }
    if (isRuntimeRecoveryCleanupResolved(record.resourceLease?.cleanupStatus)) {
      await this.options.recoveryStore.delete(entry.request.invocationId);
      return;
    }
    await this.options.recoveryStore.save(recoveryCheckpointFromInvocationEntry({
      ...entry,
      ...(record.resourceLease !== undefined ? { runtimeLease: record.resourceLease } : {}),
      record,
    }));
  }
}

function invocationEntryFromRecoveryCheckpoint(
  checkpoint: ManagedAgentRuntimeRecoveryCheckpoint,
): ManagedAgentRuntimeInvocationEntry {
  const validated = validateManagedAgentRuntimeRecoveryCheckpoint(checkpoint);
  const terminal = deferredTerminal();
  terminal.promise.catch(() => undefined);
  return {
    request: cloneJson(validated.request),
    decision: cloneJson(validated.decision),
    lifecycleState: validated.lifecycleState,
    startedAt: new Date(validated.startedAt),
    abortController: new AbortController(),
    runtimeLease: cloneJson(validated.runtimeLease),
    runtimeLeaseForRelease: cloneJson(validated.runtimeLeaseForRelease),
    acquiredLeaseStages: [...validated.acquiredLeaseStages],
    releasedLeaseStages: [...validated.releasedLeaseStages],
    promptInbox: [],
    progressEvents: [],
    adapterStarted: validated.adapterStarted,
    ...(validated.finishedAt !== undefined ? { finishedAt: new Date(validated.finishedAt) } : {}),
    ...(validated.record !== undefined ? { record: cloneJson(validated.record) } : {}),
    ...(validated.error !== undefined ? { error: new Error(validated.error.message) } : {}),
    terminal,
  };
}

function recoveryCheckpointFromInvocationEntry(
  entry: ManagedAgentRuntimeInvocationEntry,
): ManagedAgentRuntimeRecoveryCheckpoint {
  const runtimeLease = entry.runtimeLease ?? entry.decision.capabilitySnapshot.resourceLease;
  const runtimeLeaseForRelease = entry.runtimeLeaseForRelease ?? runtimeLease;
  return validateManagedAgentRuntimeRecoveryCheckpoint({
    version: 1,
    lifecycleState: entry.lifecycleState,
    request: cloneJson(entry.request),
    decision: cloneJson(entry.decision),
    startedAt: entry.startedAt.toISOString(),
    ...(entry.finishedAt !== undefined ? { finishedAt: entry.finishedAt.toISOString() } : {}),
    runtimeLease: cloneJson(runtimeLease),
    runtimeLeaseForRelease: cloneJson(runtimeLeaseForRelease),
    acquiredLeaseStages: [...entry.acquiredLeaseStages],
    releasedLeaseStages: [...entry.releasedLeaseStages],
    adapterStarted: entry.adapterStarted,
    ...(entry.record !== undefined ? { record: cloneJson(entry.record) } : {}),
    ...(entry.error !== undefined ? { error: { message: entry.error.message } } : {}),
    updatedAt: new Date().toISOString(),
  });
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
    ...(snapshotRecord(entry) !== undefined ? { record: cloneJson(snapshotRecord(entry)) } : {}),
    ...(entry.progressEvents.length > 0 ? { progressEvents: cloneJson(entry.progressEvents) } : {}),
    ...(entry.promptInbox.length > 0 ? { promptInbox: cloneJson(entry.promptInbox) } : {}),
    ...(entry.error !== undefined ? { error: { message: entry.error.message } } : {}),
  };
}

function snapshotRecord(entry: ManagedAgentRuntimeInvocationEntry): ManagedAgentInvocationRecord | undefined {
  if (entry.record === undefined || entry.leaseFinalization !== undefined) {
    return undefined;
  }
  return entry.record;
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

function createStaleRecord(
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
    lifecycleState: "stale",
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

function createRecoveredRecord(
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
    lifecycleState: "recovered",
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
  return state === "completed" ||
    state === "failed" ||
    state === "timed_out" ||
    state === "cancelled" ||
    state === "stale" ||
    state === "recovered";
}

function isRuntimeRecoveryCleanupResolved(
  cleanupStatus: ManagedAgentResourceLeaseEvidence["cleanupStatus"] | undefined,
): boolean {
  return cleanupStatus === "completed" || cleanupStatus === "not-required";
}

function worktreeReviewEvidenceForCleanupFailure(
  stage: ManagedAgentRuntimeLeaseStage,
  invocationId: string,
  error: unknown,
): ManagedAgentWorktreeReviewEvidence | undefined {
  if (stage !== "worktree" || !(error instanceof ManagedAgentWorktreeReviewRequiredError)) {
    return undefined;
  }
  return {
    status: "required",
    reason: "dirty-worktree-preserved",
    resourceUris: [`kiln://artifacts/${invocationId}/worktree-review`],
    diagnosticUris: [`kiln://artifacts/${invocationId}/worktree-review-required`],
  };
}

function deniedWriteLeaseConflictDecision(input: {
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly active: ManagedAgentRuntimeInvocationEntry;
  readonly reason: ManagedAgentWorktreeConflictEvidence["reason"];
}): Extract<ManagedAgentAdmissionDecision, { readonly status: "denied" }> {
  const activeInvocationId = input.active.request.invocationId;
  const lease = input.decision.capabilitySnapshot.resourceLease;
  const diagnosticUri = `kiln://artifacts/${input.request.invocationId}/worktree-conflict`;
  const conflict: ManagedAgentWorktreeConflictEvidence = {
    status: "blocked",
    reason: input.reason,
    requestedInvocationId: input.request.invocationId,
    conflictingInvocationId: activeInvocationId,
    workingDirectoryPath: input.request.authority.workingDirectory.path,
    workingDirectoryMode: input.request.authority.workingDirectory.mode,
    policyId: "managed-agent.worktree.single-active-writer",
    retryAfterInvocationIds: [activeInvocationId],
    resourceUris: [],
    diagnosticUris: [diagnosticUri],
  };
  const resourceLease: ManagedAgentResourceLeaseEvidence = defineManagedAgentCapabilitySnapshot({
    ...input.decision.capabilitySnapshot,
    resourceLease: {
      ...lease,
      healthStatus: "stale",
      cleanupStatus: "not-required",
      diagnosticUris: uniqueStrings([...lease.diagnosticUris, diagnosticUri]),
      worktreeConflict: conflict,
    },
  }).resourceLease;
  return {
    status: "denied",
    invocationId: input.request.invocationId,
    profile: input.request.profile,
    routeId: input.decision.capabilitySnapshot.routeId,
    routeSource: input.decision.capabilitySnapshot.routeSource,
    reason: `Managed agent ${input.reason}: ${activeInvocationId} already holds ${input.request.authority.workingDirectory.path}`,
    missingCapabilities: ["resourceLease.worktreeConflict"],
    resourceLease,
  };
}

function isSameCheckoutWriteInvocation(request: ManagedAgentInvocationRequest): boolean {
  return request.authority.toolAuthority.writeAllowed === true &&
    (request.authority.workingDirectory.mode === "workspace-write" ||
      request.authority.workingDirectory.mode === "sandbox");
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

function validatePromptText(value: string): string {
  if (typeof value !== "string") {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent prompt must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent prompt is required");
  }
  return trimmed;
}

function validatePromptId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent prompt admission id is required");
  }
  return trimmed;
}

function assertValidRuntimeDate(value: Date, message: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new ManagedAgentRuntimeAdmissionError(message);
  }
}

function summarizeRuntimePrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/gu, " ").trim();
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
}

function hashRuntimePrompt(prompt: string): string {
  return `sha256:${createHash("sha256").update(prompt, "utf8").digest("hex")}`;
}

function assertSameRuntimePromptAdmission(
  existing: ManagedAgentRuntimePromptAdmissionRecord,
  candidate: {
    readonly prompt: string;
    readonly deliveryMode: ManagedAgentRuntimePromptDeliveryMode;
    readonly wakeRequested: boolean;
    readonly requestedBy?: string;
    readonly requestSource?: string;
  },
): void {
  if (
    existing.prompt !== candidate.prompt ||
    existing.deliveryMode !== candidate.deliveryMode ||
    existing.wakeRequested !== candidate.wakeRequested ||
    existing.requestedBy !== candidate.requestedBy ||
    existing.requestSource !== candidate.requestSource
  ) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent prompt admission id already exists with different evidence");
  }
}

function isPromptClaimable(
  prompt: ManagedAgentRuntimePromptAdmissionRecord,
  boundary: ManagedAgentRuntimePromptDeliveryBoundary,
): boolean {
  if (prompt.deliveryState === "available") {
    return boundary === "immediate" || boundary === "safe-turn";
  }
  if (prompt.deliveryState === "queued") {
    return boundary === "safe-turn";
  }
  return false;
}

function stuckPromptRecoveryReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "Managed invocation prompt marked stale by runtime recovery.";
}

function staleRecoveryReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "Managed invocation marked stale by runtime recovery.";
}

function persistedRecoveryReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "Managed invocation recovered after runtime restart.";
}

function managedInvocationAbortReason(reason: unknown): string {
  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason;
  }
  if (reason instanceof Error && reason.message.trim().length > 0) {
    return reason.message;
  }
  return "Parent runtime turn interrupted.";
}

function isSideEffectedLeaseAcquireError(error: unknown): boolean {
  return error instanceof ManagedAgentLeaseAcquireError && error.sideEffected;
}

function markLeaseStageAcquired(
  entry: ManagedAgentRuntimeInvocationEntry,
  stage: ManagedAgentRuntimeLeaseStage,
): void {
  if (!entry.acquiredLeaseStages.includes(stage)) {
    entry.acquiredLeaseStages.push(stage);
  }
}

function isNonEmptyDirectoryError(error: unknown): boolean {
  return isNodeError(error) && (error.code === "ENOTEMPTY" || error.code === "EEXIST");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deferredTerminal(): ManagedAgentRuntimeInvocationTerminal {
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
  if (lease.worktreeReview !== undefined) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent worktree review evidence is runtime-owned");
  }
  if (lease.worktreeConflict !== undefined) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent worktree conflict evidence is runtime-owned");
  }
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

function cleanupFailureResourceName(stage: ManagedAgentRuntimeLeaseStage): string {
  switch (stage) {
    case "worktree":
      return "worktree-lease";
    case "sandbox":
      return "sandbox-policy";
    case "artifact-directory":
      return "artifact-directory";
    case "dev-server-port":
      return "dev-server-port";
    case "environment":
      return "environment";
    case "credential-route":
      return "credential-route";
  }

  const unreachableStage: never = stage;
  return unreachableStage;
}

function devServerPortResourceUri(invocationId: string, port: number): string {
  return `kiln://artifacts/${invocationId}/dev-server-port/${port}`;
}

function devServerPortReleaseUri(invocationId: string, port: number): string {
  return `kiln://artifacts/${invocationId}/dev-server-port-release/${port}`;
}

function environmentBindingResourceUri(invocationId: string, name: string): string {
  return `kiln://artifacts/${invocationId}/environment/${name}`;
}

function environmentBindingReleaseUri(invocationId: string, name: string): string {
  return `kiln://artifacts/${invocationId}/environment-release/${name}`;
}

function sandboxPolicyResourceUri(invocationId: string): string {
  return `kiln://artifacts/${invocationId}/sandbox-policy`;
}

function sandboxPolicyReleaseUri(invocationId: string): string {
  return `kiln://artifacts/${invocationId}/sandbox-policy-release`;
}

function credentialRouteResourceUri(invocationId: string, routeId: string): string {
  return `kiln://artifacts/${invocationId}/credential-route/${encodeURIComponent(routeId)}`;
}

function credentialRouteReleaseUri(invocationId: string, routeId: string): string {
  return `kiln://artifacts/${invocationId}/credential-route-release/${encodeURIComponent(routeId)}`;
}

function validateCredentialRouteId(routeId: string): string {
  const normalized = routeId.trim();
  if (normalized.length === 0) {
    throw new ManagedAgentRuntimeAdmissionError("Managed credential route id is required");
  }
  return normalized;
}

function validateDevServerPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ManagedAgentRuntimeAdmissionError("Managed dev-server port must be an integer from 1 to 65535");
  }
  return port;
}

function readDevServerPortLeaseValue(invocationId: string, resourceUris: readonly string[]): number | undefined {
  for (let index = resourceUris.length - 1; index >= 0; index -= 1) {
    const uri = resourceUris[index]!;
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== "kiln:" || parsed.hostname !== "artifacts") {
        continue;
      }
      const pathSegments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
      if (pathSegments.length !== 3 || pathSegments[0] !== invocationId || pathSegments[1] !== "dev-server-port") {
        continue;
      }
      return validateDevServerPort(Number(pathSegments[2]));
    } catch {
      continue;
    }
  }
  return undefined;
}

function validateManagedEnvironment(environment: ManagedAgentEnvironmentVariables): ManagedAgentEnvironmentVariables {
  if (environment === null || typeof environment !== "object" || Array.isArray(environment)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed environment bindings must be a string map");
  }
  const validated = Object.create(null) as Record<string, string>;
  for (const [name, value] of Object.entries(environment)) {
    validated[validateEnvironmentName(name)] = validateEnvironmentValue(value);
  }
  assertNoEnvironmentNameCollisions(Object.keys(validated));
  return validated;
}

function mergeManagedEnvironment(
  existing: ManagedAgentEnvironmentVariables | undefined,
  incoming: ManagedAgentEnvironmentVariables,
): ManagedAgentEnvironmentVariables {
  if (existing === undefined) {
    return incoming;
  }
  const environment = Object.assign(Object.create(null), existing, incoming) as Record<string, string>;
  assertNoEnvironmentNameCollisions(Object.keys(environment));
  return environment;
}

function assertEnvironmentLeaseUrisDoNotContainValues(
  previousLease: ManagedAgentResourceLeaseEvidence,
  candidateLease: ManagedAgentResourceLeaseEvidence,
  environment: ManagedAgentEnvironmentVariables,
): void {
  if (environmentLeaseUrisContainingValues(previousLease, candidateLease, environment).length > 0) {
    throw new ManagedAgentRuntimeAdmissionError("Managed environment lease URI must not contain environment binding values");
  }
}

function environmentLeaseUrisContainingValues(
  previousLease: ManagedAgentResourceLeaseEvidence,
  candidateLease: ManagedAgentResourceLeaseEvidence,
  environment: ManagedAgentEnvironmentVariables,
): readonly string[] {
  const environmentValues = environmentValueFragments(environment);
  if (environmentValues.length === 0) {
    return [];
  }
  const previousUris = new Set([...previousLease.resourceUris, ...previousLease.diagnosticUris]);
  return [...candidateLease.resourceUris, ...candidateLease.diagnosticUris]
    .filter((uri) => !previousUris.has(uri) && uriContainsEnvironmentValue(uri, environmentValues));
}

function sanitizeEnvironmentLeaseEvidence(
  lease: ManagedAgentResourceLeaseEvidence,
  rejectedUris: readonly string[] | undefined,
): ManagedAgentResourceLeaseEvidence {
  if (rejectedUris === undefined || rejectedUris.length === 0) {
    return lease;
  }
  const rejectedUriSet = new Set(rejectedUris);
  return {
    ...lease,
    resourceUris: lease.resourceUris.filter((uri) => !rejectedUriSet.has(uri)),
    diagnosticUris: lease.diagnosticUris.filter((uri) => !rejectedUriSet.has(uri)),
  };
}

function sanitizeEnvironmentDiagnostics(
  diagnostics: readonly NonNullable<ManagedAgentInvocationRecord["diagnostics"]>[number][],
  rejectedUris: readonly string[] | undefined,
): readonly NonNullable<ManagedAgentInvocationRecord["diagnostics"]>[number][] {
  if (rejectedUris === undefined || rejectedUris.length === 0) {
    return diagnostics;
  }
  const rejectedUriSet = new Set(rejectedUris);
  return diagnostics.filter((diagnostic) => !rejectedUriSet.has(diagnostic.uri));
}

function environmentValueFragments(environment: ManagedAgentEnvironmentVariables): readonly string[] {
  return Object.values(environment).filter((value) => value.length > 0);
}

function uriContainsEnvironmentValue(uri: string, environmentValues: readonly string[]): boolean {
  return environmentValues.some((value) => uri.includes(value) || uri.includes(encodeURIComponent(value)));
}

function validateEnvironmentName(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed environment binding name must be a portable environment variable name");
  }
  if (isReservedEnvironmentBindingName(name)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed environment binding name is a reserved environment binding name");
  }
  return name;
}

function validateEnvironmentValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new ManagedAgentRuntimeAdmissionError("Managed environment binding value must be a string");
  }
  return value;
}

function assertNoEnvironmentNameCollisions(names: readonly string[]): void {
  const normalizedNames = new Set<string>();
  for (const name of names) {
    const normalizedName = name.toUpperCase();
    if (normalizedNames.has(normalizedName)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed environment binding names must not collide case-insensitively");
    }
    normalizedNames.add(normalizedName);
  }
}

function isReservedEnvironmentBindingName(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return normalizedName === "__proto__" || normalizedName === "prototype" || normalizedName === "constructor";
}

async function canBindTcpPort(host: string, port: number): Promise<boolean> {
  const server = createServer();
  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    const settle = async (available: boolean, error?: Error): Promise<void> => {
      if (settled) {
        return;
      }
      settled = true;
      server.removeAllListeners("error");
      server.removeAllListeners("listening");
      try {
        if (server.listening) {
          await closeTcpServer(server);
        }
      } catch (closeError) {
        reject(toError(closeError));
        return;
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(available);
    };
    server.once("error", (error) => {
      if (isTcpPortInUseError(error)) {
        void settle(false);
        return;
      }
      void settle(false, new ManagedAgentDevServerPortLeaseAcquireError(
        `Managed dev-server port probe failed for ${host}:${port}: ${toError(error).message}`,
        false,
      ));
    });
    server.once("listening", () => {
      void settle(true);
    });
    try {
      server.listen(port, host);
    } catch (error) {
      void settle(false, new ManagedAgentDevServerPortLeaseAcquireError(
        `Managed dev-server port probe failed for ${host}:${port}: ${toError(error).message}`,
        false,
      ));
    }
  });
}

function isTcpPortInUseError(error: unknown): boolean {
  return isNodeError(error) && error.code === "EADDRINUSE";
}

async function closeTcpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function runtimeLeaseForTerminalRelease(
  entry: ManagedAgentRuntimeInvocationEntry,
  record: ManagedAgentInvocationRecord,
): ManagedAgentResourceLeaseEvidence | undefined {
  const runtimeLease = entry.runtimeLeaseForRelease ?? entry.runtimeLease;
  if (runtimeLease && record.resourceLease) {
    return mergeRuntimeLeaseRelease(runtimeLease, record.resourceLease);
  }
  return runtimeLease ?? record.resourceLease;
}

function mergeRuntimeLeaseRelease(
  previousLease: ManagedAgentResourceLeaseEvidence,
  releasedLease: ManagedAgentResourceLeaseEvidence,
): ManagedAgentResourceLeaseEvidence {
  const hasFailedCleanup = previousLease.cleanupStatus === "failed" || releasedLease.cleanupStatus === "failed";
  const hasLeakedHealth = previousLease.healthStatus === "leaked" || releasedLease.healthStatus === "leaked";
  return {
    ...releasedLease,
    healthStatus: hasLeakedHealth ? "leaked" : releasedLease.healthStatus,
    cleanupStatus: hasFailedCleanup ? "failed" : releasedLease.cleanupStatus,
    resourceUris: uniqueStrings([...previousLease.resourceUris, ...releasedLease.resourceUris]),
    diagnosticUris: uniqueStrings([...previousLease.diagnosticUris, ...releasedLease.diagnosticUris]),
    ...(releasedLease.worktreeReview !== undefined || previousLease.worktreeReview !== undefined
      ? { worktreeReview: releasedLease.worktreeReview ?? previousLease.worktreeReview }
      : {}),
    ...(releasedLease.worktreeConflict !== undefined || previousLease.worktreeConflict !== undefined
      ? { worktreeConflict: releasedLease.worktreeConflict ?? previousLease.worktreeConflict }
      : {}),
  };
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values));
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
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
    routeSource: snapshot.routeSource,
    ...(snapshot.callerIdentity ? { callerIdentity: snapshot.callerIdentity } : {}),
    ...(snapshot.invocationCapabilityEvidence
      ? { invocationCapabilityEvidence: snapshot.invocationCapabilityEvidence }
      : {}),
    routeHealth: snapshot.routeHealth,
    providerModelProof: snapshot.providerModelProof,
    authorityEvidence: snapshot.authorityEvidence,
    resourcePlane: snapshot.resourcePlane,
    resourceLease: snapshot.resourceLease,
    childIdentity: snapshot.childIdentity,
  };
}

function projectedAuthoritySourceForAdapter(
  adapter: ManagedAgentRuntimeAdapter,
): Parameters<typeof buildManagedAgentAuthorityEvidence>[0]["projectedSource"] {
  if (adapter.descriptor.adapterKind === "harness" && adapter.descriptor.supportedExecutionModes.includes("cli-harness")) {
    return "cli-harness-session-factory";
  }
  if (adapter.descriptor.supportedExecutionModes.includes("remote-harness")) {
    return "remote-harness-adapter";
  }
  return "direct-provider-adapter";
}

function capabilitySnapshotInputWithRuntimeAuthorityProjection(
  request: ManagedAgentInvocationRequest,
  adapter: ManagedAgentRuntimeAdapter,
  input: ManagedAgentCapabilitySnapshotInput,
  evaluatedAt: Date,
): ManagedAgentCapabilitySnapshotInput {
  return {
    ...input,
    authorityEvidence: buildManagedAgentAuthorityEvidence({
      request,
      projectedSource: projectedAuthoritySourceForAdapter(adapter),
      evaluatedAt: evaluatedAt.toISOString(),
    }),
  };
}

function requiresRuntimeAuthorityProof(request: ManagedAgentInvocationRequest): boolean {
  return request.executionIntent?.attendance === "unattended" || request.executionIntent?.lifecycle !== "foreground";
}
