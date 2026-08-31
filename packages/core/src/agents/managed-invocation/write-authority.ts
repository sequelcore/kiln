import { defineMemoryScope } from "../../memory/domain/scope.js";
import type { MemoryScope } from "../../memory/domain/scope.js";

export type ManagedAgentWriteMode = "none" | "propose" | "apply-approved";

export type ManagedAgentArtifactWriteRetention = "none" | "session" | "durable" | "external";

export type ManagedAgentMemoryWriteOperation =
  | "create"
  | "update"
  | "archive"
  | "forget"
  | "redact"
  | "promote";

export type ManagedAgentWriteApprovalMode = "none" | "required-before-apply" | "policy-approved";

export type ManagedAgentWriteRiskLevel = "low" | "medium" | "high";

export type ManagedAgentWriteDecisionStatus = "approved" | "denied" | "reduced" | "superseded";

export type ManagedAgentWriteAttemptStatus =
  | "started"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed-out"
  | "rolled-back"
  | "cleanup-pending";

export type ManagedAgentWriteCleanupStatus =
  | "not-required"
  | "completed"
  | "pending"
  | "failed"
  | "unknown";

export type ManagedAgentWriteEvidenceKind =
  | "write-authority-requested"
  | "write-authority-admitted"
  | "write-authority-denied"
  | "write-proposal-created"
  | "write-proposal-approved"
  | "write-proposal-denied"
  | "write-attempt-started"
  | "write-attempt-completed"
  | "write-attempt-failed"
  | "write-attempt-cancelled"
  | "write-attempt-timed-out"
  | "write-attempt-rolled-back"
  | "write-cleanup-pending";

export interface ManagedAgentWorkspaceWriteScope {
  readonly mode: ManagedAgentWriteMode;
  readonly allowedPaths: readonly string[];
  readonly deniedPaths: readonly string[];
}

export interface ManagedAgentMemoryWriteScope {
  readonly operations: readonly ManagedAgentMemoryWriteOperation[];
}

export interface ManagedAgentArtifactWriteScope {
  readonly mode: ManagedAgentWriteMode;
  readonly resourceUris: readonly string[];
  readonly retention: ManagedAgentArtifactWriteRetention;
}

export interface ManagedAgentToolWriteScope {
  readonly allowedToolNames: readonly string[];
  readonly deniedToolNames: readonly string[];
}

export interface ManagedAgentWriteScope {
  readonly workspace: ManagedAgentWorkspaceWriteScope;
  readonly memory: ManagedAgentMemoryWriteScope;
  readonly artifacts: ManagedAgentArtifactWriteScope;
  readonly tools: ManagedAgentToolWriteScope;
}

export interface ManagedAgentWriteApproval {
  readonly mode: ManagedAgentWriteApprovalMode;
  readonly evidenceRequired: boolean;
  readonly approver?: string;
  readonly evidenceUris?: readonly string[];
}

export interface ManagedAgentWriteAuthority {
  readonly scope: ManagedAgentWriteScope;
  readonly approval: ManagedAgentWriteApproval;
}

export interface ManagedAgentAdapterWriteAuthorityDescriptor {
  readonly proposalSupported: boolean;
  readonly approvedApplySupported: boolean;
  readonly memoryProposalSupported: boolean;
  readonly rollbackEvidence: boolean;
  readonly cleanupEvidence: boolean;
  readonly scopeReduction: boolean;
}

export type ManagedAgentWriteTarget =
  | {
    readonly kind: "workspace-path";
    readonly path: string;
  }
  | {
    readonly kind: "memory";
    readonly scope: MemoryScope;
    readonly operation: ManagedAgentMemoryWriteOperation;
    readonly recordId?: string;
  }
  | {
    readonly kind: "artifact";
    readonly uri: string;
  }
  | {
    readonly kind: "resource";
    readonly uri: string;
  }
  | {
    readonly kind: "tool";
    readonly toolName: string;
  };

export interface ManagedAgentWriteRisk {
  readonly level: ManagedAgentWriteRiskLevel;
  readonly reasons: readonly string[];
}

export interface ManagedAgentWriteProposal {
  readonly proposalId: string;
  readonly invocationId: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
  readonly childSessionId?: string;
  readonly target: ManagedAgentWriteTarget;
  readonly summary: string;
  readonly evidenceUris: readonly string[];
  readonly risk: ManagedAgentWriteRisk;
  readonly createdAt: string;
}

export interface ManagedAgentWriteDecision {
  readonly decisionId: string;
  readonly proposalId: string;
  readonly invocationId: string;
  readonly status: ManagedAgentWriteDecisionStatus;
  readonly decidedBy: string;
  readonly reason: string;
  readonly scope?: ManagedAgentWriteScope;
  readonly decidedAt: string;
}

export interface ManagedAgentWriteAttempt {
  readonly attemptId: string;
  readonly proposalId: string;
  readonly decisionId: string;
  readonly invocationId: string;
  readonly status: ManagedAgentWriteAttemptStatus;
  readonly target: ManagedAgentWriteTarget;
  readonly evidenceUris: readonly string[];
  readonly rollbackUri?: string;
  readonly cleanupStatus: ManagedAgentWriteCleanupStatus;
}

export interface ManagedAgentWriteEvidence {
  readonly evidenceId: string;
  readonly invocationId: string;
  readonly kind: ManagedAgentWriteEvidenceKind;
  readonly proposalId?: string;
  readonly decisionId?: string;
  readonly attemptId?: string;
  readonly summary: string;
  readonly resourceUris: readonly string[];
  readonly recordedAt: string;
}

export function defineManagedAgentWriteScope(input: ManagedAgentWriteScope): ManagedAgentWriteScope {
  return {
    workspace: {
      mode: requireWriteMode(input.workspace.mode),
      allowedPaths: input.workspace.allowedPaths.map((path) => requireText(path, "Managed write workspace path is required")),
      deniedPaths: input.workspace.deniedPaths.map((path) => requireText(path, "Managed denied workspace path is required")),
    },
    memory: {
      operations: input.memory.operations.map(requireMemoryOperation),
    },
    artifacts: {
      mode: requireWriteMode(input.artifacts.mode),
      resourceUris: input.artifacts.resourceUris.map((uri) => requireText(uri, "Managed write artifact/resource uri is required")),
      retention: requireArtifactRetention(input.artifacts.retention),
    },
    tools: {
      allowedToolNames: input.tools.allowedToolNames.map((name) => requireText(name, "Managed write allowed tool name is required")),
      deniedToolNames: input.tools.deniedToolNames.map((name) => requireText(name, "Managed write denied tool name is required")),
    },
  };
}

export function defineManagedAgentWriteAuthority(input: ManagedAgentWriteAuthority): ManagedAgentWriteAuthority {
  return {
    scope: defineManagedAgentWriteScope(input.scope),
    approval: {
      mode: requireApprovalMode(input.approval.mode),
      evidenceRequired: input.approval.evidenceRequired === true,
      ...(input.approval.approver !== undefined ? { approver: requireText(input.approval.approver, "Managed write approver is required") } : {}),
      ...(input.approval.evidenceUris !== undefined
        ? { evidenceUris: input.approval.evidenceUris.map((uri) => requireText(uri, "Managed write approval evidence uri is required")) }
        : {}),
    },
  };
}

export function defineManagedAgentAdapterWriteAuthorityDescriptor(
  input?: ManagedAgentAdapterWriteAuthorityDescriptor,
): ManagedAgentAdapterWriteAuthorityDescriptor {
  return {
    proposalSupported: input?.proposalSupported === true,
    approvedApplySupported: input?.approvedApplySupported === true,
    memoryProposalSupported: input?.memoryProposalSupported === true,
    rollbackEvidence: input?.rollbackEvidence === true,
    cleanupEvidence: input?.cleanupEvidence === true,
    scopeReduction: input?.scopeReduction === true,
  };
}

export function defineManagedAgentWriteProposal(input: ManagedAgentWriteProposal): ManagedAgentWriteProposal {
  return {
    proposalId: requireText(input.proposalId, "Managed write proposal id is required"),
    invocationId: requireText(input.invocationId, "Managed write proposal invocation id is required"),
    parentSessionId: requireText(input.parentSessionId, "Managed write proposal parent session id is required"),
    parentTurnId: requireText(input.parentTurnId, "Managed write proposal parent turn id is required"),
    ...(input.childSessionId !== undefined ? { childSessionId: requireText(input.childSessionId, "Managed write proposal child session id is required") } : {}),
    target: requireWriteTarget(input.target),
    summary: requireText(input.summary, "Managed write proposal summary is required"),
    evidenceUris: input.evidenceUris.map((uri) => requireText(uri, "Managed write proposal evidence uri is required")),
    risk: {
      level: requireRiskLevel(input.risk.level),
      reasons: input.risk.reasons.map((reason) => requireText(reason, "Managed write risk reason is required")),
    },
    createdAt: requireText(input.createdAt, "Managed write proposal createdAt is required"),
  };
}

export function defineManagedAgentWriteDecision(input: ManagedAgentWriteDecision): ManagedAgentWriteDecision {
  return {
    decisionId: requireText(input.decisionId, "Managed write decision id is required"),
    proposalId: requireText(input.proposalId, "Managed write decision proposal id is required"),
    invocationId: requireText(input.invocationId, "Managed write decision invocation id is required"),
    status: requireDecisionStatus(input.status),
    decidedBy: requireText(input.decidedBy, "Managed write decision actor is required"),
    reason: requireText(input.reason, "Managed write decision reason is required"),
    ...(input.scope !== undefined ? { scope: defineManagedAgentWriteScope(input.scope) } : {}),
    decidedAt: requireText(input.decidedAt, "Managed write decision decidedAt is required"),
  };
}

export function defineManagedAgentWriteAttempt(input: ManagedAgentWriteAttempt): ManagedAgentWriteAttempt {
  return {
    attemptId: requireText(input.attemptId, "Managed write attempt id is required"),
    proposalId: requireText(input.proposalId, "Managed write attempt proposal id is required"),
    decisionId: requireText(input.decisionId, "Managed write attempt decision id is required"),
    invocationId: requireText(input.invocationId, "Managed write attempt invocation id is required"),
    status: requireAttemptStatus(input.status),
    target: requireWriteTarget(input.target),
    evidenceUris: input.evidenceUris.map((uri) => requireText(uri, "Managed write attempt evidence uri is required")),
    ...(input.rollbackUri !== undefined ? { rollbackUri: requireText(input.rollbackUri, "Managed write rollback uri is required") } : {}),
    cleanupStatus: requireCleanupStatus(input.cleanupStatus),
  };
}

export function defineManagedAgentWriteEvidence(input: ManagedAgentWriteEvidence): ManagedAgentWriteEvidence {
  return {
    evidenceId: requireText(input.evidenceId, "Managed write evidence id is required"),
    invocationId: requireText(input.invocationId, "Managed write evidence invocation id is required"),
    kind: requireEvidenceKind(input.kind),
    ...(input.proposalId !== undefined ? { proposalId: requireText(input.proposalId, "Managed write evidence proposal id is required") } : {}),
    ...(input.decisionId !== undefined ? { decisionId: requireText(input.decisionId, "Managed write evidence decision id is required") } : {}),
    ...(input.attemptId !== undefined ? { attemptId: requireText(input.attemptId, "Managed write evidence attempt id is required") } : {}),
    summary: requireText(input.summary, "Managed write evidence summary is required"),
    resourceUris: input.resourceUris.map((uri) => requireText(uri, "Managed write evidence resource uri is required")),
    recordedAt: requireText(input.recordedAt, "Managed write evidence recordedAt is required"),
  };
}

function requireWriteTarget(input: ManagedAgentWriteTarget): ManagedAgentWriteTarget {
  switch (input.kind) {
    case "workspace-path":
      return { kind: "workspace-path", path: requireText(input.path, "Managed write target path is required") };
    case "memory":
      return {
        kind: "memory",
        scope: defineMemoryScope(input.scope),
        operation: requireMemoryOperation(input.operation),
        ...(input.recordId !== undefined ? { recordId: requireText(input.recordId, "Managed write target memory record id is required") } : {}),
      };
    case "artifact":
      return { kind: "artifact", uri: requireText(input.uri, "Managed write target artifact uri is required") };
    case "resource":
      return { kind: "resource", uri: requireText(input.uri, "Managed write target resource uri is required") };
    case "tool":
      return { kind: "tool", toolName: requireText(input.toolName, "Managed write target tool name is required") };
    default:
      throw new Error(`Unsupported managed write target kind: ${(input as { readonly kind?: string }).kind ?? ""}`);
  }
}

function requireWriteMode(value: ManagedAgentWriteMode): ManagedAgentWriteMode {
  if (value !== "none" && value !== "propose" && value !== "apply-approved") {
    throw new Error(`Unsupported managed write mode: ${value as string}`);
  }
  return value;
}

function requireMemoryOperation(value: ManagedAgentMemoryWriteOperation): ManagedAgentMemoryWriteOperation {
  if (value !== "create" && value !== "update" && value !== "archive" && value !== "forget" && value !== "redact" && value !== "promote") {
    throw new Error(`Unsupported managed memory write operation: ${value as string}`);
  }
  return value;
}

function requireArtifactRetention(value: ManagedAgentArtifactWriteRetention): ManagedAgentArtifactWriteRetention {
  if (value !== "none" && value !== "session" && value !== "durable" && value !== "external") {
    throw new Error(`Unsupported managed artifact write retention: ${value as string}`);
  }
  return value;
}

function requireApprovalMode(value: ManagedAgentWriteApprovalMode): ManagedAgentWriteApprovalMode {
  if (value !== "none" && value !== "required-before-apply" && value !== "policy-approved") {
    throw new Error(`Unsupported managed write approval mode: ${value as string}`);
  }
  return value;
}

function requireRiskLevel(value: ManagedAgentWriteRiskLevel): ManagedAgentWriteRiskLevel {
  if (value !== "low" && value !== "medium" && value !== "high") {
    throw new Error(`Unsupported managed write risk level: ${value as string}`);
  }
  return value;
}

function requireDecisionStatus(value: ManagedAgentWriteDecisionStatus): ManagedAgentWriteDecisionStatus {
  if (value !== "approved" && value !== "denied" && value !== "reduced" && value !== "superseded") {
    throw new Error(`Unsupported managed write decision status: ${value as string}`);
  }
  return value;
}

function requireAttemptStatus(value: ManagedAgentWriteAttemptStatus): ManagedAgentWriteAttemptStatus {
  if (value !== "started" && value !== "completed" && value !== "failed" && value !== "cancelled" && value !== "timed-out" && value !== "rolled-back" && value !== "cleanup-pending") {
    throw new Error(`Unsupported managed write attempt status: ${value as string}`);
  }
  return value;
}

function requireCleanupStatus(value: ManagedAgentWriteCleanupStatus): ManagedAgentWriteCleanupStatus {
  if (value !== "not-required" && value !== "completed" && value !== "pending" && value !== "failed" && value !== "unknown") {
    throw new Error(`Unsupported managed write cleanup status: ${value as string}`);
  }
  return value;
}

function requireEvidenceKind(value: ManagedAgentWriteEvidenceKind): ManagedAgentWriteEvidenceKind {
  const kinds: readonly ManagedAgentWriteEvidenceKind[] = [
    "write-authority-requested",
    "write-authority-admitted",
    "write-authority-denied",
    "write-proposal-created",
    "write-proposal-approved",
    "write-proposal-denied",
    "write-attempt-started",
    "write-attempt-completed",
    "write-attempt-failed",
    "write-attempt-cancelled",
    "write-attempt-timed-out",
    "write-attempt-rolled-back",
    "write-cleanup-pending",
  ];
  if (!kinds.includes(value)) {
    throw new Error(`Unsupported managed write evidence kind: ${value as string}`);
  }
  return value;
}

function requireText(value: string | undefined, message: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}
