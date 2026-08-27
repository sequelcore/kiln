import { z } from "zod";
import { ModelCatalogSchema } from "./model-catalog.js";

const text = z.string().trim().min(1).max(512);
const canonical = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const instant = z.string().datetime({ offset: true });
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const classification = z.enum(["public", "internal", "confidential", "restricted"]);
const billingClass = z.enum(["subscription", "included", "free", "metered", "unknown"]);
const capabilityPosture = z.enum(["kiln-executable", "text-only"]);

const discoveryIdentity = z.object({
  providerId: canonical,
  providerRouteId: text,
  providerModelId: text,
}).strict();

const guidedFields = {
  requestId: canonical,
  expectedRevision: digest,
  discoveryIdentity,
  label: text.optional(),
  dataClassification: classification,
  dataPolicyConfirmed: z.literal(true),
} as const;

const previewRequest = z.object({
  ...guidedFields,
  action: z.literal("preview"),
}).strict();

const applyRequest = z.object({
  ...guidedFields,
  action: z.literal("apply"),
  proposalId: canonical,
  operatorApproved: z.literal(true),
}).strict();

/** Operator-authored intent for the target wizard. All durable material is server-derived. */
export const ExecutionTargetWizardRequestSchema = z.discriminatedUnion("action", [previewRequest, applyRequest]);
export type ExecutionTargetWizardRequest = z.infer<typeof ExecutionTargetWizardRequestSchema>;
export const ExecutionTargetWizardApplyRequestSchema = applyRequest;
export type ExecutionTargetWizardApplyRequest = z.infer<typeof ExecutionTargetWizardApplyRequestSchema>;

const safeDiagnostic = z.object({
  severity: z.enum(["error", "warning"]),
  code: canonical,
  message: text,
}).strict();

const normalizedTarget = z.object({
  targetId: canonical,
  label: text,
  providerId: canonical,
  providerModelId: text,
  accountPolicyId: canonical,
  eligibleAccountCount: z.number().int().positive(),
  dataClassification: classification,
  billingClass,
  capabilityPosture,
  discoveryExpiresAt: instant,
  evidenceExpiresAt: instant,
}).strict();

/** Secret-free projection of the existing target.create proposal. */
export const ExecutionTargetWizardProposalSchema = z.object({
  proposalId: canonical,
  operation: z.literal("target.create"),
  scope: z.literal("global"),
  status: z.enum(["valid", "invalid"]),
  baseRevision: digest,
  authorityImpact: z.enum(["none", "expands-read", "expands-write", "unknown"]),
  approvalRequired: z.literal(true),
  approvalStatus: z.enum(["required", "approved"]),
  activation: z.enum(["hot", "next-turn", "next-session", "reconcile", "restart-required"]),
  owners: z.array(canonical).max(64),
  reconciliationTargets: z.array(canonical).max(64),
  diagnostics: z.array(safeDiagnostic).max(32),
  rollback: z.object({ restorable: z.boolean(), summary: text }).strict(),
  target: normalizedTarget,
}).strict();
export type ExecutionTargetWizardProposal = z.infer<typeof ExecutionTargetWizardProposalSchema>;

const resultAction = z.enum([
  "none",
  "approve-and-apply",
  "refresh-and-retry",
  "select-current-model",
  "configure-account",
  "review-data-policy",
  "review-economics",
  "refresh-catalog",
]);

const rejectionCode = z.enum([
  "TARGET_DISCOVERY_STALE",
  "TARGET_IDENTITY_CHANGED",
  "TARGET_REVISION_CONFLICT",
  "TARGET_ACCOUNT_UNAVAILABLE",
  "TARGET_DATA_POLICY_UNAVAILABLE",
  "TARGET_ECONOMICS_UNAVAILABLE",
  "TARGET_AUTHORITY_APPROVAL_REQUIRED",
  "TARGET_CREATE_REJECTED",
]);

const resultBase = {
  type: z.literal("execution_target_wizard_result"),
  requestId: canonical,
  message: text,
};

const previewed = z.object({
  ...resultBase,
  status: z.literal("previewed"),
  code: z.literal("EXECUTION_TARGET_PREVIEWED"),
  action: z.literal("approve-and-apply"),
  proposal: ExecutionTargetWizardProposalSchema,
}).strict();

const created = z.object({
  ...resultBase,
  status: z.literal("created"),
  code: z.literal("EXECUTION_TARGET_CREATED"),
  action: z.literal("none"),
  revision: digest,
  proposal: ExecutionTargetWizardProposalSchema,
  modelCatalog: ModelCatalogSchema,
}).strict();

const committedRefreshFailed = z.object({
  ...resultBase,
  status: z.literal("committed-refresh-failed"),
  code: z.literal("EXECUTION_TARGET_COMMITTED_REFRESH_FAILED"),
  action: z.literal("refresh-catalog"),
  revision: digest,
  proposal: ExecutionTargetWizardProposalSchema,
}).strict();

const rejected = z.object({
  ...resultBase,
  status: z.literal("rejected"),
  code: rejectionCode,
  action: resultAction.exclude(["none", "approve-and-apply"]),
  diagnostics: z.array(safeDiagnostic).max(32).optional(),
  proposal: ExecutionTargetWizardProposalSchema.optional(),
}).strict();

/** Safe correlated result for preview, commit, refresh failure, or rejection. */
export const ExecutionTargetWizardResultSchema = z.discriminatedUnion("status", [previewed, created, committedRefreshFailed, rejected]);
export type ExecutionTargetWizardResult = z.infer<typeof ExecutionTargetWizardResultSchema>;
