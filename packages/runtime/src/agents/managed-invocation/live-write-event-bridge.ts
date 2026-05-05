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

export type ManagedAgentLiveWriteChangeSource =
  | "cli-session"
  | "session-diff"
  | "patch-update"
  | "tool-result";

export interface ManagedAgentLiveWriteChange {
  readonly source: ManagedAgentLiveWriteChangeSource;
  readonly path: string;
  readonly changeType: Extract<CliSessionEvent, { readonly type: "file_changed" }>["changeType"];
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
  readonly diffPreview?: string;
  readonly diffTruncated?: boolean;
}

export type ManagedAgentLiveWriteDecisionSource =
  | "permission-event"
  | "approval-event"
  | "patch-approval"
  | "tool-result";

export type ManagedAgentLiveWriteDecisionStatus = "approved" | "denied";

export interface ManagedAgentLiveWriteDecision {
  readonly source: ManagedAgentLiveWriteDecisionSource;
  readonly status: ManagedAgentLiveWriteDecisionStatus;
  readonly providerRequestId?: string;
  readonly actor?: string;
  readonly reason: string;
  readonly resourceUris?: readonly string[];
}

export interface ManagedAgentLiveWriteDecisionEvidenceInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly decisions: readonly ManagedAgentLiveWriteDecision[];
  readonly recordedAt?: string;
}

export interface ManagedAgentLiveWriteEventBridgeResult {
  readonly evidence: readonly ManagedAgentWriteEvidence[];
  readonly attemptResourceUris: readonly string[];
}

export function normalizeManagedAgentLiveWriteChanges(
  changes: readonly ManagedAgentLiveWriteChange[],
): Extract<CliSessionEvent, { readonly type: "file_changed" }>[] {
  return changes.map((change) => ({
    type: "file_changed",
    path: requireText(change.path, "Managed live write change path is required"),
    changeType: change.changeType,
    ...(change.linesAdded !== undefined ? { linesAdded: requireNonNegativeInteger(change.linesAdded, "Managed live write added line count is invalid") } : {}),
    ...(change.linesRemoved !== undefined ? { linesRemoved: requireNonNegativeInteger(change.linesRemoved, "Managed live write removed line count is invalid") } : {}),
    ...(change.diffPreview !== undefined ? { diffPreview: requireText(change.diffPreview, "Managed live write diff preview is required") } : {}),
    ...(change.diffTruncated !== undefined ? { diffTruncated: change.diffTruncated === true } : {}),
  }));
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

export function collectManagedAgentLiveWriteDecisionEvidence(
  input: ManagedAgentLiveWriteDecisionEvidenceInput,
): ManagedAgentWriteEvidence[] {
  return input.decisions.map((decision, index) => {
    const ordinal = requireDecisionOrdinal(decision.providerRequestId, index + 1);
    const actor = decision.actor !== undefined
      ? requireText(decision.actor, "Managed live write decision actor is required")
      : "operator";
    const reason = requireText(decision.reason, "Managed live write decision reason is required");
    const recordedAt = input.recordedAt ?? new Date().toISOString();
    const writeAuthority = input.request.authority.writeAuthority;

    if (decision.status === "approved") {
      if (writeAuthority === undefined || writeAuthority.scope.workspace.mode !== "apply-approved") {
        throw new ManagedAgentRuntimeAdmissionError("Managed live write approval requires admitted apply-approved write authority");
      }

      const proposalId = `${input.request.invocationId}:write-proposal:${ordinal}`;
      const decisionId = `${input.request.invocationId}:write-decision:${ordinal}`;
      return defineManagedAgentWriteEvidence({
        evidenceId: `${decisionId}:evidence`,
        invocationId: input.request.invocationId,
        kind: "write-proposal-approved",
        proposalId,
        decisionId,
        summary: `Live write decision approved by ${actor}: ${reason}`,
        resourceUris: decision.resourceUris?.map((uri) => requireText(uri, "Managed live write decision resource uri is required"))
          ?? [managedInvocationUri(input.request.invocationId, `write-decisions/${ordinal}`)],
        recordedAt,
      });
    }

    if (decision.status === "denied") {
      if (writeAuthority === undefined) {
        return defineManagedAgentWriteEvidence({
          evidenceId: `${input.request.invocationId}:write-authority-denied:${ordinal}`,
          invocationId: input.request.invocationId,
          kind: "write-authority-denied",
          summary: `Live write authority denied by ${actor}: ${reason}`,
          resourceUris: decision.resourceUris?.map((uri) => requireText(uri, "Managed live write denial resource uri is required"))
            ?? [managedInvocationUri(input.request.invocationId, `write-denials/${ordinal}`)],
          recordedAt,
        });
      }

      const proposalId = `${input.request.invocationId}:write-proposal:${ordinal}`;
      const decisionId = `${input.request.invocationId}:write-decision:${ordinal}`;
      return defineManagedAgentWriteEvidence({
        evidenceId: `${decisionId}:evidence`,
        invocationId: input.request.invocationId,
        kind: "write-proposal-denied",
        proposalId,
        decisionId,
        summary: `Live write decision denied by ${actor}: ${reason}`,
        resourceUris: decision.resourceUris?.map((uri) => requireText(uri, "Managed live write decision resource uri is required"))
          ?? [managedInvocationUri(input.request.invocationId, `write-decisions/${ordinal}`)],
        recordedAt,
      });
    }

    throw new ManagedAgentRuntimeAdmissionError(`Unsupported managed live write decision status: ${decision.status as string}`);
  });
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

function requireNonNegativeInteger(value: number, message: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ManagedAgentRuntimeAdmissionError(message);
  }
  return value;
}

function requireDecisionOrdinal(providerRequestId: string | undefined, fallback: number): string {
  if (providerRequestId === undefined) {
    return fallback.toString();
  }
  return requireText(providerRequestId, "Managed live write provider request id is required");
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
