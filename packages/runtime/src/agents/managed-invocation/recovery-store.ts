import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  defineManagedAgentCapabilitySnapshot,
  defineManagedAccountLeaseEvidence,
  defineManagedAgentInvocationRecord,
  defineManagedAgentInvocationRequest,
} from "@kilnai/core";
import type {
  ManagedAgentAdmissionDecision,
  ManagedAgentCapabilitySnapshot,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentLifecycleState,
  ManagedAccountLeaseEvidence,
  ManagedAgentResourceLeaseEvidence,
} from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";

export type ManagedAgentRuntimeRecoveryLeaseStage =
  | "worktree"
  | "sandbox"
  | "artifact-directory"
  | "dev-server-port"
  | "environment"
  | "credential-route";

export interface ManagedAgentRuntimeRecoveryCheckpoint {
  readonly version: 2;
  readonly lifecycleState: ManagedAgentLifecycleState;
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly runtimeLease: ManagedAgentResourceLeaseEvidence;
  readonly runtimeLeaseForRelease: ManagedAgentResourceLeaseEvidence;
  readonly acquiredLeaseStages: readonly ManagedAgentRuntimeRecoveryLeaseStage[];
  readonly releasedLeaseStages: readonly ManagedAgentRuntimeRecoveryLeaseStage[];
  readonly adapterStarted: boolean;
  readonly accountLease?: ManagedAccountLeaseEvidence;
  readonly record?: ManagedAgentInvocationRecord;
  readonly error?: {
    readonly message: string;
  };
  readonly updatedAt: string;
}

export interface ManagedAgentRuntimeRecoveryStore {
  save(checkpoint: ManagedAgentRuntimeRecoveryCheckpoint): Promise<void>;
  delete(invocationId: string): Promise<void>;
  listRecoverable(): Promise<readonly ManagedAgentRuntimeRecoveryCheckpoint[]>;
}

export interface ManagedFilesystemRuntimeRecoveryStoreConfig {
  readonly rootPath: string;
}

export class ManagedFilesystemRuntimeRecoveryStore implements ManagedAgentRuntimeRecoveryStore {
  private readonly rootPath: string;
  private mutation: Promise<void> = Promise.resolve();

  constructor(config: ManagedFilesystemRuntimeRecoveryStoreConfig) {
    if (config.rootPath.trim().length === 0) {
      throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery store root path is required");
    }
    this.rootPath = resolve(config.rootPath);
  }

  async save(checkpoint: ManagedAgentRuntimeRecoveryCheckpoint): Promise<void> {
    const validated = validateManagedAgentRuntimeRecoveryCheckpoint(checkpoint);
    await this.enqueueMutation(async () => {
      await mkdir(this.rootPath, { recursive: true });
      const rootPath = await this.resolvedRootPath();
      const targetPath = this.checkpointPath(rootPath, validated.request.invocationId);
      const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
      await rename(tempPath, targetPath);
    });
  }

  async delete(invocationId: string): Promise<void> {
    await this.enqueueMutation(async () => {
      try {
        const rootPath = await this.resolvedRootPath();
        await unlink(this.checkpointPath(rootPath, invocationId));
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
          throw error;
        }
      }
    });
  }

  async listRecoverable(): Promise<readonly ManagedAgentRuntimeRecoveryCheckpoint[]> {
    await this.mutation;
    let fileNames: string[];
    try {
      fileNames = await readdir(this.rootPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const rootPath = await this.resolvedRootPath();
    const checkpoints: ManagedAgentRuntimeRecoveryCheckpoint[] = [];
    for (const fileName of fileNames.sort()) {
      if (!fileName.endsWith(".json")) {
        continue;
      }
      const checkpointPath = this.childPath(rootPath, fileName);
      try {
        const stat = await lstat(checkpointPath);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint must be a regular file");
        }
        decodeCheckpointFileName(fileName);
        const parsed = JSON.parse(await readFile(checkpointPath, "utf-8")) as unknown;
        checkpoints.push(validateManagedAgentRuntimeRecoveryCheckpoint(parsed));
      } catch (error) {
        await this.quarantineInvalidCheckpoint(rootPath, fileName, checkpointPath, error);
      }
    }
    return checkpoints;
  }

  private async resolvedRootPath(): Promise<string> {
    return realpath(this.rootPath);
  }

  private checkpointPath(rootPath: string, invocationId: string): string {
    return this.childPath(rootPath, `${encodeURIComponent(invocationId)}.json`);
  }

  private childPath(rootPath: string, fileName: string): string {
    const path = resolve(rootPath, fileName);
    if (path !== rootPath && !path.startsWith(`${rootPath}\\`) && !path.startsWith(`${rootPath}/`)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint path escapes the recovery root");
    }
    return path;
  }

  private async quarantineInvalidCheckpoint(
    rootPath: string,
    fileName: string,
    checkpointPath: string,
    error: unknown,
  ): Promise<void> {
    const quarantineRoot = this.childPath(rootPath, "quarantine");
    await mkdir(quarantineRoot, { recursive: true });
    const quarantinedAt = new Date().toISOString();
    const quarantineFileName = `${quarantinedAt.replace(/[:.]/g, "-")}.${fileName}`;
    const quarantinePath = this.childPath(quarantineRoot, quarantineFileName);
    try {
      await rename(checkpointPath, quarantinePath);
    } catch (renameError) {
      if (isNodeError(renameError) && renameError.code === "ENOENT") {
        return;
      }
      throw renameError;
    }
    await writeFile(`${quarantinePath}.metadata.json`, `${JSON.stringify({
      originalFileName: fileName,
      quarantinedAt,
      reason: error instanceof Error ? error.message : "Managed runtime recovery checkpoint is invalid",
    }, null, 2)}\n`, "utf-8");
  }

  private async enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const pending = this.mutation.then(operation, operation);
    this.mutation = pending.catch(() => undefined);
    await pending;
  }
}

export function validateManagedAgentRuntimeRecoveryCheckpoint(input: unknown): ManagedAgentRuntimeRecoveryCheckpoint {
  if (!isRecord(input)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint must be an object");
  }
  if (input.version !== 2) {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint version is not supported");
  }
  if (
    input.lifecycleState !== "running" &&
    input.lifecycleState !== "completed" &&
    input.lifecycleState !== "failed" &&
    input.lifecycleState !== "timed_out" &&
    input.lifecycleState !== "cancelled" &&
    input.lifecycleState !== "stale" &&
    input.lifecycleState !== "recovered"
  ) {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint lifecycle state is not recoverable");
  }

  const rawDecision = isRecord(input.decision) ? input.decision : {};
  const rawCapabilitySnapshot = isRecord(rawDecision.capabilitySnapshot)
    ? rawDecision.capabilitySnapshot
    : {};
  if (typeof rawCapabilitySnapshot.routeSource !== "string") {
    throw new ManagedAgentRuntimeAdmissionError("Unsupported managed capability snapshot route source");
  }
  const rawRequest = isRecord(input.request) ? input.request : {};
  const rawAuthority = isRecord(rawRequest.authority) ? rawRequest.authority : {};
  if (Object.prototype.hasOwnProperty.call(rawAuthority, "timeoutSource")) {
    throw new ManagedAgentRuntimeAdmissionError("Unsupported managed invocation timeout source");
  }
  const decision = validateAdmittedDecision(input.decision);
  const request = defineManagedAgentInvocationRequest(input.request as ManagedAgentInvocationRequest);
  const checkpoint: ManagedAgentRuntimeRecoveryCheckpoint = {
    version: 2,
    lifecycleState: input.lifecycleState,
    request,
    decision,
    startedAt: validateIsoTimestamp(input.startedAt, "Managed runtime recovery checkpoint start timestamp is required"),
    ...(input.finishedAt !== undefined
      ? { finishedAt: validateIsoTimestamp(input.finishedAt, "Managed runtime recovery checkpoint finish timestamp is invalid") }
      : {}),
    runtimeLease: validateLease(decision, input.runtimeLease),
    runtimeLeaseForRelease: validateLease(decision, input.runtimeLeaseForRelease),
    acquiredLeaseStages: validateLeaseStages(input.acquiredLeaseStages, "Managed runtime recovery checkpoint requires acquired lease stages"),
    releasedLeaseStages: validateLeaseStages(input.releasedLeaseStages, "Managed runtime recovery checkpoint requires released lease stages"),
    adapterStarted: input.adapterStarted === true,
    ...(input.accountLease !== undefined
      ? { accountLease: defineManagedAccountLeaseEvidence(input.accountLease as ManagedAccountLeaseEvidence) }
      : {}),
    ...(input.record !== undefined ? { record: defineManagedAgentInvocationRecord(input.record as ManagedAgentInvocationRecord) } : {}),
    ...(isRecord(input.error) && typeof input.error.message === "string" ? { error: { message: input.error.message } } : {}),
    updatedAt: validateIsoTimestamp(input.updatedAt, "Managed runtime recovery checkpoint update timestamp is required"),
  };
  if (isTerminalRecoveryLifecycleState(checkpoint.lifecycleState)) {
    if (checkpoint.record === undefined) {
      throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery terminal checkpoint requires an invocation record");
    }
    if (checkpoint.record.lifecycleState !== checkpoint.lifecycleState) {
      throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint record lifecycle does not match checkpoint state");
    }
  }
  if (checkpoint.acquiredLeaseStages.length === 0) {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint requires an acquired lease stage");
  }
  if (checkpoint.decision.invocationId !== checkpoint.request.invocationId) {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint decision invocation id does not match request");
  }
  if (checkpoint.decision.profile !== checkpoint.request.profile) {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint decision profile does not match request");
  }
  if (checkpoint.decision.authorityProfileId !== checkpoint.request.authority.authorityProfileId) {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint decision authority profile does not match request");
  }
  if (
    checkpoint.request.authority.credentialRoute.mode === "account-leased"
    && checkpoint.adapterStarted
    && checkpoint.accountLease === undefined
  ) {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint requires account lease evidence");
  }
  if (
    checkpoint.accountLease !== undefined
    && checkpoint.accountLease.runtimeInvocationId !== checkpoint.request.invocationId
  ) {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery account lease invocation identity does not match");
  }
  return checkpoint;
}

function isTerminalRecoveryLifecycleState(state: ManagedAgentLifecycleState): boolean {
  return state !== "running";
}

function validateAdmittedDecision(input: unknown): Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }> {
  if (!isRecord(input) || input.status !== "admitted") {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint requires an admitted decision");
  }
  return {
    ...input,
    status: "admitted",
    capabilitySnapshot: defineManagedAgentCapabilitySnapshot(input.capabilitySnapshot as ManagedAgentCapabilitySnapshot),
  } as Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
}

function validateLease(
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  input: unknown,
): ManagedAgentResourceLeaseEvidence {
  if (!isRecord(input)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint requires runtime lease evidence");
  }
  return defineManagedAgentCapabilitySnapshot({
    ...decision.capabilitySnapshot,
    resourceLease: input as unknown as ManagedAgentResourceLeaseEvidence,
  }).resourceLease;
}

function validateLeaseStages(
  input: unknown,
  message: string,
): readonly ManagedAgentRuntimeRecoveryLeaseStage[] {
  if (!Array.isArray(input)) {
    throw new ManagedAgentRuntimeAdmissionError(message);
  }
  const stages: ManagedAgentRuntimeRecoveryLeaseStage[] = [];
  for (const stage of input) {
    if (
      stage !== "worktree" &&
      stage !== "sandbox" &&
      stage !== "artifact-directory" &&
      stage !== "dev-server-port" &&
      stage !== "environment" &&
      stage !== "credential-route"
    ) {
      throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint contains an unsupported lease stage");
    }
    if (!stages.includes(stage)) {
      stages.push(stage);
    }
  }
  return stages;
}

function decodeCheckpointFileName(fileName: string): string {
  if (!fileName.endsWith(".json")) {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint file name is invalid");
  }
  try {
    const invocationId = decodeURIComponent(fileName.slice(0, -".json".length));
    if (`${encodeURIComponent(invocationId)}.json` !== fileName) {
      throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint file name is invalid");
    }
    return invocationId;
  } catch {
    throw new ManagedAgentRuntimeAdmissionError("Managed runtime recovery checkpoint file name is invalid");
  }
}

function validateIsoTimestamp(input: unknown, message: string): string {
  if (typeof input !== "string" || Number.isNaN(Date.parse(input))) {
    throw new ManagedAgentRuntimeAdmissionError(message);
  }
  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
