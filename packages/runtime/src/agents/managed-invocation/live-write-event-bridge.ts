import {
  defineManagedAgentWriteEvidence,
} from "@kilnai/core";
import type {
  ManagedAgentInvocationRequest,
  ManagedAgentWriteEvidence,
} from "@kilnai/core";
import type { CliSessionEvent } from "../../execution/cli-session-contract.js";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";

export interface ManagedAgentLiveWriteEventBridgeInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly fileChanges: readonly Extract<CliSessionEvent, { readonly type: "file_changed" }>[];
  readonly recordedAt?: string;
}

export interface ManagedAgentLiveWriteEventBridgeResult {
  readonly evidence: readonly ManagedAgentWriteEvidence[];
  readonly attemptResourceUris: readonly string[];
}

export function collectManagedAgentLiveWriteEvidence(
  input: ManagedAgentLiveWriteEventBridgeInput,
): ManagedAgentLiveWriteEventBridgeResult {
  if (input.fileChanges.length === 0) {
    return {
      evidence: [],
      attemptResourceUris: [],
    };
  }

  const writeAuthority = input.request.authority.writeAuthority;
  if (writeAuthority === undefined || writeAuthority.scope.workspace.mode !== "apply-approved") {
    throw new ManagedAgentRuntimeAdmissionError("Managed live write events require admitted apply-approved write authority");
  }

  const evidence = input.fileChanges.flatMap((change, index) => {
    assertPathWithinWriteAuthority(
      change.path,
      writeAuthority.scope.workspace.allowedPaths,
      writeAuthority.scope.workspace.deniedPaths,
    );

    const ordinal = index + 1;
    const proposalId = `${input.request.invocationId}:write-proposal:${ordinal}`;
    const decisionId = `${input.request.invocationId}:write-decision:${ordinal}`;
    const attemptId = `${input.request.invocationId}:write-attempt:${ordinal}`;
    const proposalUri = managedInvocationUri(input.request.invocationId, `write-proposals/${ordinal}`);
    const decisionUri = managedInvocationUri(input.request.invocationId, `write-decisions/${ordinal}`);
    const attemptUri = managedInvocationUri(input.request.invocationId, `write-attempts/${ordinal}`);
    const recordedAt = input.recordedAt ?? new Date().toISOString();
    const summary = `${change.changeType} ${change.path}`;

    return [
      defineManagedAgentWriteEvidence({
        evidenceId: `${proposalId}:evidence`,
        invocationId: input.request.invocationId,
        kind: "write-proposal-created",
        proposalId,
        summary: `Workspace write proposal recorded for ${summary}`,
        resourceUris: [proposalUri],
        recordedAt,
      }),
      defineManagedAgentWriteEvidence({
        evidenceId: `${decisionId}:evidence`,
        invocationId: input.request.invocationId,
        kind: "write-proposal-approved",
        proposalId,
        decisionId,
        summary: `Workspace write proposal approved for ${summary}`,
        resourceUris: [decisionUri],
        recordedAt,
      }),
      defineManagedAgentWriteEvidence({
        evidenceId: `${attemptId}:evidence`,
        invocationId: input.request.invocationId,
        kind: "write-attempt-completed",
        proposalId,
        decisionId,
        attemptId,
        summary: `Workspace write attempt completed for ${summary}`,
        resourceUris: [attemptUri],
        recordedAt,
      }),
    ];
  });

  return {
    evidence,
    attemptResourceUris: evidence
      .filter((item) => item.kind === "write-attempt-completed")
      .flatMap((item) => item.resourceUris),
  };
}

function assertPathWithinWriteAuthority(path: string, allowedPaths: readonly string[], deniedPaths: readonly string[]): void {
  const normalizedPath = normalizePath(path);
  const denied = deniedPaths.some((deniedPath) => isSameOrChildPath(normalizedPath, normalizePath(deniedPath)));
  if (denied) {
    throw new ManagedAgentRuntimeAdmissionError(`Managed live write path is denied: ${path}`);
  }
  const allowed = allowedPaths.some((allowedPath) => isSameOrChildPath(normalizedPath, normalizePath(allowedPath)));
  if (!allowed) {
    throw new ManagedAgentRuntimeAdmissionError(`Managed live write path is outside admitted scope: ${path}`);
  }
}

function isSameOrChildPath(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

function normalizePath(path: string): string {
  return requireText(path, "Managed live write file path is required").replace(/\\/g, "/").replace(/\/+$/, "");
}

function managedInvocationUri(invocationId: string, resource: string): string {
  return `kiln://managed-invocations/${invocationId}/${resource}`;
}

function requireText(value: string | undefined, message: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new ManagedAgentRuntimeAdmissionError(message);
  }
  return trimmed;
}
