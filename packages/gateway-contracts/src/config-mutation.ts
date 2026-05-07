export const KILN_CONFIG_CHANGE_OPERATIONS = [
  "skill.upsert",
  "agent.upsert",
  "agent.attach_skills",
] as const;

export type KilnConfigChangeOperation = typeof KILN_CONFIG_CHANGE_OPERATIONS[number];

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
