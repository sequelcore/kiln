import type { OperatorSurfaceKind } from "./operator-surface-capability.js";

export const KILN_CONFIG_CHANGE_OPERATIONS = [
  "skill.upsert",
  "agent.upsert",
  "agent.attach_skills",
  "context_governance.adapt",
] as const;

export type KilnConfigChangeOperation = typeof KILN_CONFIG_CHANGE_OPERATIONS[number];
export type KilnConfigChangeApprovalSurface = Extract<
  OperatorSurfaceKind,
  "cli" | "tui" | "gui" | "native" | "sdk" | "runtime"
>;

export interface KilnConfigValidationDiagnostic {
  readonly severity: "error" | "warning";
  readonly field: string;
  readonly message: string;
}

export interface KilnConfigChangeProposal {
  readonly proposalId: string;
  readonly createdAt: string;
  readonly operation: KilnConfigChangeOperation;
  readonly status: "valid" | "invalid";
  readonly normalizedPayload: Record<string, unknown>;
  readonly affectedCanonicalPaths: readonly string[];
  readonly nativeProjectionEffects: readonly string[];
  readonly authorityImpact: "none" | "expands-read" | "expands-write" | "unknown";
  readonly diagnostics: readonly KilnConfigValidationDiagnostic[];
  readonly previewDiff: string;
  readonly rollbackHint: string;
}

export interface KilnConfigChangeApproval {
  readonly approvalId: string;
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly surface: KilnConfigChangeApprovalSurface;
}

export interface KilnConfigAppliedWrite {
  readonly path: string;
  readonly previousHash: string | null;
  readonly nextHash: string;
}

export interface KilnConfigProjectionEffectResult {
  readonly target: "native-agents" | "native-skills" | "repo-shims";
  readonly status: "ok" | "failed" | "skipped";
  readonly summary: string;
  readonly errors: readonly string[];
}

export interface KilnConfigApplyResult {
  readonly proposalId: string;
  readonly approvalId: string;
  readonly appliedAt: string;
  readonly status: "applied" | "failed";
  readonly appliedWrites: readonly KilnConfigAppliedWrite[];
  readonly projectionEffects: readonly KilnConfigProjectionEffectResult[];
  readonly diagnostics: readonly KilnConfigValidationDiagnostic[];
}
