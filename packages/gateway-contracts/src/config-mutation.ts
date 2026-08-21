import type { OperatorSurfaceKind } from "./operator-surface-capability.js";

/**
 * Configuration Mutation Authority V2.
 *
 * One governed lifecycle owns every canonical configuration write, for both the
 * project and global scopes. Surfaces submit desired intent through a typed
 * operation; they never author revisions, evidence, or file bytes themselves.
 */
export const KILN_CONFIG_MUTATION_OPERATIONS = [
  "skill.upsert",
  "agent.upsert",
  "agent.attach_skills",
  "context_governance.adapt",
  "setting.set",
  "setting.reset",
  "project.adopt",
  "target.select",
  "target.create",
  "native.import",
  "mutation.rollback",
] as const;

export type KilnConfigMutationOperation = typeof KILN_CONFIG_MUTATION_OPERATIONS[number];

/** Canonical configuration family a mutation targets. Each scope owns its own revision fence. */
export type KilnConfigMutationScope = "project" | "global";

/** When a committed change actually governs execution. */
export type KilnConfigActivationClass =
  | "hot"
  | "next-turn"
  | "next-session"
  | "reconcile"
  | "restart-required";

/**
 * Authority delta between the current and proposed configuration. Derived by
 * comparing evaluated authority, never inferred from the operation name.
 */
export type KilnConfigAuthorityImpact = "none" | "expands-read" | "expands-write" | "unknown";

export type KilnConfigApprovalSurface = Extract<
  OperatorSurfaceKind,
  "cli" | "tui" | "gui" | "sdk" | "runtime"
>;

export interface KilnConfigValidationDiagnostic {
  readonly severity: "error" | "warning";
  readonly field: string;
  readonly message: string;
}

/**
 * Whether, and to what, a committed mutation can be restored. The token that
 * `mutation.rollback` accepts is minted at settlement, not at proposal time.
 */
export interface KilnConfigRollbackEvidence {
  /** False when the proposal will not commit, so nothing becomes restorable. */
  readonly restorable: boolean;
  readonly summary: string;
}

export interface KilnConfigMutationProposal {
  readonly proposalId: string;
  readonly createdAt: string;
  readonly scope: KilnConfigMutationScope;
  readonly operation: KilnConfigMutationOperation;
  readonly status: "valid" | "invalid";
  /** Revision the proposal was derived from; apply rejects a different base. */
  readonly baseRevision: string;
  readonly normalizedPayload: Record<string, unknown>;
  /** Bounded contexts that own the affected material. */
  readonly affectedOwners: readonly string[];
  readonly affectedCanonicalPaths: readonly string[];
  /** Reconciliation targets the single reconciliation owner must converge after commit. */
  readonly reconciliationTargets: readonly KilnConfigReconciliationTarget[];
  readonly authorityImpact: KilnConfigAuthorityImpact;
  /** True when authority expands; apply then requires a matching durable approval. */
  readonly approvalRequired: boolean;
  readonly activation: KilnConfigActivationClass;
  readonly diagnostics: readonly KilnConfigValidationDiagnostic[];
  readonly previewDiff: string;
  readonly rollback: KilnConfigRollbackEvidence;
}

export interface KilnConfigMutationApproval {
  readonly approvalId: string;
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly surface: KilnConfigApprovalSurface;
}

export interface KilnConfigAppliedWrite {
  readonly path: string;
  readonly previousHash: string | null;
  readonly nextHash: string;
}

export type KilnConfigReconciliationTarget =
  | "native-agents"
  | "native-skills"
  | "native-permissions"
  | "repo-shims"
  | "execution-routes";

export interface KilnConfigReconciliationEffect {
  readonly target: KilnConfigReconciliationTarget;
  readonly status: "ok" | "failed" | "skipped";
  readonly summary: string;
  readonly errors: readonly string[];
}

/**
 * Honest terminal outcome. A committed write whose reconciliation failed is
 * never reported as a rejection, and a rejection never leaves partial writes.
 */
export type KilnConfigMutationOutcome =
  | "committed"
  | "committed-reconciliation-failed"
  | "rejected";

/**
 * Durable terminal record of one mutation, keyed by proposal identity. A retried
 * apply returns the stored settlement instead of writing again.
 *
 * It records committed revision and reconciliation evidence only. Effective
 * state is a projection and is never persisted here as authority.
 */
export interface KilnConfigMutationSettlement {
  readonly proposalId: string;
  readonly approvalId: string | null;
  readonly scope: KilnConfigMutationScope;
  /** Null when the proposal could not be read, so no operation was ever identified. */
  readonly operation: KilnConfigMutationOperation | null;
  readonly settledAt: string;
  readonly outcome: KilnConfigMutationOutcome;
  readonly baseRevision: string;
  readonly committedRevision: string | null;
  readonly appliedWrites: readonly KilnConfigAppliedWrite[];
  readonly reconciliationEffects: readonly KilnConfigReconciliationEffect[];
  readonly diagnostics: readonly KilnConfigValidationDiagnostic[];
  readonly rollbackToken: string | null;
  readonly activation: KilnConfigActivationClass;
}

/**
 * Apply result returned to surfaces: the durable settlement plus a freshly
 * derived read-back of effective state. `replayed` is true when the settlement
 * came from durable storage because the operation had already committed.
 */
export interface KilnConfigMutationResult {
  readonly settlement: KilnConfigMutationSettlement;
  readonly replayed: boolean;
  /** Schema revision of the effective-state read-back, or null when unavailable. */
  readonly readBackSchemaRevision: number | null;
  /** True when the committed revision was observed in effective state after apply. */
  readonly readBackVerified: boolean;
}
