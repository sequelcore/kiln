import { z } from "zod";
import type {
  KilnConfigMutationProposal,
  KilnConfigMutationResult,
} from "./config-mutation.js";

/** Breaking revision for the cross-surface, secret-free settings information architecture. */
export const KILN_SETTINGS_SCHEMA_REVISION = 1 as const;

export const KILN_SETTINGS_SECTION_IDS = [
  "general",
  "providers",
  "models",
  "permissions",
  "tools",
  "usage-and-limits",
  "agents",
  "health",
  "advanced",
] as const;

export type KilnSettingsSectionId = typeof KILN_SETTINGS_SECTION_IDS[number];

export const KILN_SETTINGS_CONTROL_KINDS = [
  "text",
  "select",
  "toggle",
  "number",
  "list",
  "json",
  "timezone",
  "theme",
] as const;

export type KilnSettingsControlKind = typeof KILN_SETTINGS_CONTROL_KINDS[number];

export const KILN_SETTINGS_REJECTION_CODES = [
  "approval-required",
  "invalid-request",
  "invalid-configuration",
  "not-adopted",
  "alias-target",
  "revision-conflict",
  "write-conflict",
  "reconciliation-failed",
  "unknown",
] as const;

export type KilnSettingsRejectionCode = typeof KILN_SETTINGS_REJECTION_CODES[number];

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const RevisionSchema = z.union([DigestSchema, z.literal("absent")]);
const ScopeSchema = z.enum(["project", "global"]);
const ActivationSchema = z.enum(["hot", "next-turn", "next-session", "reconcile", "restart-required"]);
const HealthSchema = z.enum(["current", "stale", "drifted", "unknown"]);
const AuthorityImpactSchema = z.enum(["none", "expands-read", "expands-write", "unknown"]);
const OperationSchema = z.enum(["setting.set", "setting.reset"]);
const SafeDisplayTextSchema = z.string().min(1).refine(
  (value) => !hasUnsafeSettingsText(value),
  "Secret or absolute path text is not permitted in settings projections.",
);

/**
 * Public settings values are deliberately less permissive than the mutation
 * authority payload. A setting may carry arbitrary JSON for a curated JSON
 * control, but keys that conventionally carry credentials are never allowed
 * into this read model.
 */
const SecretFreeValueSchema = z.any().superRefine((value, context) => {
  validateSecretFreeValue(value, context, []);
});

function validateSecretFreeValue(value: unknown, context: z.RefinementCtx, path: (string | number)[]): void {
  if (typeof value === "string") {
    if (/(?:^|[=:;,\s])(token|secret|password|api[_-]?key|credential|private[_-]?key)(?:$|[=:;,\s])/iu.test(value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path, message: "Credential-like values are not permitted in settings projections." });
    }
    if (isAbsoluteOperatorPath(value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path, message: "Absolute operator paths are not permitted in settings projections." });
    }
    return;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateSecretFreeValue(entry, context, [...path, index]));
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/(?:secret|token|password|api[_-]?key|credential|private[_-]?key)/iu.test(key)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [...path, key], message: "Credential-like fields are not permitted in settings projections." });
      }
      validateSecretFreeValue(entry, context, [...path, key]);
    }
    return;
  }
  context.addIssue({ code: z.ZodIssueCode.custom, path, message: "Settings values must be JSON-compatible." });
}

function isAbsoluteOperatorPath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|private|tmp|var|workspace|mnt)(?:[\\/]|$))/u.test(value.trim());
}

function hasUnsafeSettingsText(value: string): boolean {
  return /(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|private|tmp|var|workspace|mnt)(?:[\\/]|$))/u.test(value)
    || /(?:^|[=:;,\s])(token|secret|password|api[_-]?key|credential|private[_-]?key)\s*[=:]/iu.test(value);
}

const SelectOptionSchema = z.object({
  value: SafeDisplayTextSchema,
  label: SafeDisplayTextSchema,
}).strict();

export const KilnSettingsControlSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text") }).strict(),
  z.object({ kind: z.literal("select"), options: z.array(SelectOptionSchema).min(1) }).strict(),
  z.object({ kind: z.literal("toggle") }).strict(),
  z.object({ kind: z.literal("number"), min: z.number().finite().optional(), max: z.number().finite().optional() }).strict(),
  z.object({ kind: z.literal("list"), itemKind: z.enum(["text", "number"]).default("text") }).strict(),
  z.object({ kind: z.literal("json") }).strict(),
  z.object({ kind: z.literal("timezone") }).strict(),
  z.object({ kind: z.literal("theme"), options: z.array(SelectOptionSchema).min(1).optional() }).strict(),
]);

export type KilnSettingsControl = z.infer<typeof KilnSettingsControlSchema>;

const EffectiveValueSchema = z.object({
  value: SecretFreeValueSchema.optional(),
  redacted: z.object({ present: z.literal(true) }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.value === undefined && value.redacted === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "An effective setting must expose a public value or redacted presence." });
  }
  if (value.value !== undefined && value.redacted !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "An effective setting cannot expose both a value and redacted presence." });
  }
});

const WriteTargetSchema = z.object({
  scope: ScopeSchema,
  document: z.enum(["project-config", "global-config"]),
  override: z.enum(["inherited", "overridden"]),
  modified: z.boolean(),
  current: EffectiveValueSchema.optional(),
  owners: z.array(SafeDisplayTextSchema),
  authorityImpact: AuthorityImpactSchema,
  approvalRequired: z.boolean(),
  activation: ActivationSchema,
}).strict();

const CapabilitiesSchema = z.object({
  read: z.literal(true),
  set: z.boolean(),
  reset: z.boolean(),
}).strict();

const RevisionsSchema = z.object({
  global: RevisionSchema.optional(),
  project: RevisionSchema.optional(),
  effective: z.number().int().positive().optional(),
}).strict();

const SettingsSectionSchema = z.object({
  id: z.enum(KILN_SETTINGS_SECTION_IDS),
  label: SafeDisplayTextSchema,
  description: SafeDisplayTextSchema,
  entryKeys: z.array(SafeDisplayTextSchema),
}).strict();

const SettingsEntrySchema = z.object({
  key: SafeDisplayTextSchema,
  identity: z.string().regex(/^\/[A-Za-z0-9_~./-]+$/u),
  section: z.enum(KILN_SETTINGS_SECTION_IDS),
  label: SafeDisplayTextSchema,
  description: SafeDisplayTextSchema,
  searchTerms: z.array(SafeDisplayTextSchema),
  control: KilnSettingsControlSchema,
  supportedScopes: z.array(ScopeSchema).min(1),
  effective: EffectiveValueSchema,
  source: z.enum(["default", "global", "project", "composed"]),
  override: z.enum(["inherited", "overridden"]),
  inherited: z.boolean(),
  modified: z.boolean(),
  writeTargets: z.array(WriteTargetSchema).min(1),
  owners: z.array(SafeDisplayTextSchema),
  authorityImpact: AuthorityImpactSchema,
  approvalRequired: z.boolean(),
  activation: ActivationSchema,
  health: HealthSchema,
  capabilities: CapabilitiesSchema,
  revisions: RevisionsSchema,
}).strict().superRefine((entry, context) => {
  if (entry.inherited === (entry.override === "overridden")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["override"], message: "Inherited and override state must agree." });
  }
  if (entry.modified !== entry.writeTargets.some((target) => target.modified)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["modified"], message: "Modified state must summarize every write scope." });
  }
  for (const target of entry.writeTargets) {
    if (!entry.supportedScopes.includes(target.scope)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["writeTargets"], message: "Write targets must be within supported scopes." });
    }
    if (target.modified !== (target.current !== undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["writeTargets"], message: "Modified write scopes must carry their current safe value or redacted presence." });
    }
  }
});

export const KilnSettingsSnapshotSchema = z.object({
  schemaRevision: z.literal(KILN_SETTINGS_SCHEMA_REVISION),
  generatedAt: z.string().datetime(),
  health: HealthSchema,
  sections: z.array(SettingsSectionSchema),
  entries: z.array(SettingsEntrySchema),
  revisions: RevisionsSchema,
  modifiedCount: z.number().int().nonnegative(),
}).strict().superRefine((snapshot, context) => {
  const sectionIds = snapshot.sections.map((section) => section.id);
  if (sectionIds.length !== KILN_SETTINGS_SECTION_IDS.length || new Set(sectionIds).size !== sectionIds.length
    || KILN_SETTINGS_SECTION_IDS.some((id) => !sectionIds.includes(id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections"], message: "The settings snapshot must publish all nine sections exactly once." });
  }
  if (snapshot.modifiedCount !== snapshot.entries.filter((entry) => entry.modified).length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["modifiedCount"], message: "modifiedCount must match entry state." });
  }
  const expectedKeys = new Set(snapshot.entries.map((entry) => entry.key));
  for (const section of snapshot.sections) {
    if (section.entryKeys.some((key) => !expectedKeys.has(key))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections"], message: "Section entryKeys must reference published entries." });
    }
  }
});

export type KilnSettingsSnapshot = z.infer<typeof KilnSettingsSnapshotSchema>;
export type KilnSettingsEntry = KilnSettingsSnapshot["entries"][number];
export type KilnSettingsSection = KilnSettingsSnapshot["sections"][number];

const SettingSetRequestSchema = z.object({
  operation: z.literal("setting.set"),
  scope: ScopeSchema,
  key: z.string().min(1),
  expectedRevision: RevisionSchema,
  value: SecretFreeValueSchema.refine((value) => value !== undefined, "A setting.set request requires a value."),
}).strict();

const SettingResetRequestSchema = z.object({
  operation: z.literal("setting.reset"),
  scope: ScopeSchema,
  key: z.string().min(1),
  expectedRevision: RevisionSchema,
}).strict();

export const KilnSettingsProposalRequestSchema = z.discriminatedUnion("operation", [
  SettingSetRequestSchema,
  SettingResetRequestSchema,
]);

export type KilnSettingsProposalRequest = z.infer<typeof KilnSettingsProposalRequestSchema>;

const SafeDiagnosticSchema = z.object({
  severity: z.enum(["error", "warning"]),
  code: SafeDisplayTextSchema,
  message: SafeDisplayTextSchema,
}).strict();

const ReconciliationSummarySchema = z.object({
  target: SafeDisplayTextSchema,
  status: z.enum(["ok", "failed", "skipped"]),
  summary: SafeDisplayTextSchema,
  errors: z.array(SafeDisplayTextSchema),
}).strict();

export const KilnSettingsProposalProjectionSchema = z.object({
  proposalId: SafeDisplayTextSchema,
  createdAt: z.string().datetime(),
  scope: ScopeSchema,
  operation: OperationSchema,
  key: SafeDisplayTextSchema,
  status: z.enum(["valid", "invalid"]),
  baseRevision: RevisionSchema,
  affectedOwners: z.array(SafeDisplayTextSchema),
  reconciliation: z.array(ReconciliationSummarySchema),
  authorityImpact: AuthorityImpactSchema,
  approvalRequired: z.boolean(),
  activation: ActivationSchema,
  diagnostics: z.array(SafeDiagnosticSchema),
  rollback: z.object({ restorable: z.boolean(), summary: SafeDisplayTextSchema }).strict(),
}).strict();

export type KilnSettingsProposalProjection = z.infer<typeof KilnSettingsProposalProjectionSchema>;

export const KilnSettingsApplyRequestSchema = z.object({
  proposalId: SafeDisplayTextSchema,
  approvalId: z.string().min(1).optional(),
}).strict();

export type KilnSettingsApplyRequest = z.infer<typeof KilnSettingsApplyRequestSchema>;

export const KilnSettingsMutationResultSchema = z.object({
  proposalId: SafeDisplayTextSchema,
  scope: ScopeSchema,
  operation: OperationSchema,
  outcome: z.enum(["committed", "committed-reconciliation-failed", "rejected"]),
  rejectionCode: z.enum(KILN_SETTINGS_REJECTION_CODES).nullable(),
  committedRevision: RevisionSchema.nullable(),
  activation: ActivationSchema,
  reconciliation: z.array(ReconciliationSummarySchema),
  diagnostics: z.array(SafeDiagnosticSchema),
  replayed: z.boolean(),
  readBack: z.object({ schemaRevision: z.number().int().positive().nullable(), verified: z.boolean() }).strict(),
}).strict().superRefine((result, context) => {
  if (result.outcome === "rejected" && result.rejectionCode === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rejectionCode"], message: "Rejected mutations require a stable rejection code." });
  }
  if (result.outcome !== "rejected" && result.rejectionCode !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rejectionCode"], message: "Committed mutations cannot carry a rejection code." });
  }
});

export type KilnSettingsMutationResult = z.infer<typeof KilnSettingsMutationResultSchema>;

/**
 * Projects an internal proposal into the public settings wire contract. Paths,
 * normalized payload, and preview bytes intentionally have no representation
 * in the result type.
 */
export function projectKilnSettingsProposal(
  proposal: KilnConfigMutationProposal,
): KilnSettingsProposalProjection {
  if (proposal.operation !== "setting.set" && proposal.operation !== "setting.reset") {
    throw new Error(`Settings projection only accepts setting operations; received ${proposal.operation}.`);
  }
  const key = typeof proposal.normalizedPayload.key === "string" ? proposal.normalizedPayload.key : "unknown";
  return KilnSettingsProposalProjectionSchema.parse({
    proposalId: proposal.proposalId,
    createdAt: proposal.createdAt,
    scope: proposal.scope,
    operation: proposal.operation,
    key,
    status: proposal.status,
    baseRevision: proposal.baseRevision,
    affectedOwners: proposal.affectedOwners,
    reconciliation: proposal.reconciliationTargets.map((target) => ({
      target,
      status: "skipped",
      summary: "Pending configuration commit.",
      errors: [],
    })),
    authorityImpact: proposal.authorityImpact,
    approvalRequired: proposal.approvalRequired,
    activation: proposal.activation,
    diagnostics: proposal.diagnostics.map(projectDiagnostic),
    rollback: {
      restorable: proposal.rollback.restorable,
      summary: sanitizeSettingsText(proposal.rollback.summary),
    },
  });
}

/** Projects a durable settlement plus read-back evidence without exposing writes or paths. */
export function projectKilnSettingsMutationResult(
  result: KilnConfigMutationResult,
): KilnSettingsMutationResult {
  const settlement = result.settlement;
  const rejectionCode = settlement.outcome === "rejected" ? rejectionCodeFor(settlement.diagnostics) : null;
  return KilnSettingsMutationResultSchema.parse({
    proposalId: settlement.proposalId,
    scope: settlement.scope,
    operation: settlement.operation,
    outcome: settlement.outcome,
    rejectionCode,
    committedRevision: settlement.committedRevision,
    activation: settlement.activation,
    reconciliation: settlement.reconciliationEffects.map((effect) => ({
      target: effect.target,
      status: effect.status,
      summary: sanitizeSettingsText(effect.summary),
      errors: effect.errors.map(sanitizeSettingsText),
    })),
    diagnostics: settlement.diagnostics.map(projectDiagnostic),
    replayed: result.replayed,
    readBack: {
      schemaRevision: result.readBackSchemaRevision,
      verified: result.readBackVerified,
    },
  });
}

function projectDiagnostic(diagnostic: { readonly severity: "error" | "warning"; readonly field: string; readonly message: string }): z.infer<typeof SafeDiagnosticSchema> {
  const safeField = sanitizeSettingsText(diagnostic.field);
  return {
    severity: diagnostic.severity,
    code: safeField.replace(/[^a-z0-9.-]+/giu, "-").replace(/^-+|-+$/gu, "") || "configuration",
    message: sanitizeSettingsText(diagnostic.message),
  };
}

function rejectionCodeFor(diagnostics: readonly { readonly field: string; readonly message: string }[]): KilnSettingsRejectionCode {
  const text = diagnostics.map((diagnostic) => `${diagnostic.field} ${diagnostic.message}`).join(" ").toLowerCase();
  if (/approval|approved/u.test(text)) return "approval-required";
  if (/revision|stale/u.test(text)) return "revision-conflict";
  if (/alias/u.test(text)) return "alias-target";
  if (/reconcil/u.test(text)) return "reconciliation-failed";
  if (/not been adopted|not initialized|not been initialized|adoption/u.test(text)) return "not-adopted";
  if (/write|atomic|lock/u.test(text)) return "write-conflict";
  if (/schema|configuration|invalid|unknown|must be|expected/u.test(text)) return "invalid-configuration";
  return "unknown";
}

function sanitizeSettingsText(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^,;\r\n]*/gu, "<path>")
    .replace(/\\\\[^,;\r\n]*/gu, "<path>")
    .replace(/(^|[\s('"=])\/[^,;\r\n]*/gu, "$1<path>")
    .replace(/\b(?:token|secret|password|api[_-]?key|credential|private[_-]?key)\s*[=:]\s*[^\s,;]+/giu, "<redacted>")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 512);
}
