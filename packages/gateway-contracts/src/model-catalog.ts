import { z } from "zod";

export const EXECUTION_TARGET_REASON_CODES = [
  "configured",
  "target-not-configured",
  "missing-provider",
  "missing-model",
  "missing-credentials",
  "credential-unavailable",
  "provider-unavailable",
  "model-unavailable",
  "target-evidence-pending",
  "target-health-unknown",
  "target-health-unavailable",
  "account-unavailable",
  "account-capacity-exhausted",
  "quota-exhausted",
  "quota-stale",
  "quota-unknown",
  "policy-denied",
  "catalog-stale",
  "catalog-failed",
  "unknown",
] as const;

export const EXECUTION_TARGET_REPAIR_ACTIONS = [
  "authenticate-provider",
  "refresh-model-catalog",
  "retry-target",
  "review-target-configuration",
  "select-another-model",
  "check-provider",
  "check-account",
] as const;

export type ExecutionTargetAvailability = "available" | "unavailable" | "unresolved";
export type ExecutionTargetReasonCode = typeof EXECUTION_TARGET_REASON_CODES[number];
export type ExecutionTargetRepairAction = typeof EXECUTION_TARGET_REPAIR_ACTIONS[number];
export type ModelDiscoveryState = "observed" | "stale" | "failed";
export type ModelEligibilityState = "eligible" | "ineligible" | "unknown";
export type ModelAvailabilityState = "available" | "unavailable" | "unknown";
export type ModelAccess = "subscription" | "harness" | "api" | "local";
export type ModelModality = "text" | "image" | "audio" | "video" | "pdf";

export interface ModelCapabilities {
  readonly inputModalities: readonly ModelModality[];
  readonly outputModalities: readonly ModelModality[];
  readonly tools: boolean;
  readonly structuredOutput: boolean;
  readonly reasoning: boolean;
  readonly streaming?: boolean;
  readonly parallelToolCalls?: boolean;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
}

export type ExecutionTargetCost =
  | {
      readonly kind: "metered";
      readonly currency: string;
      readonly inputPerMillion?: number;
      readonly outputPerMillion?: number;
      readonly cachedInputPerMillion?: number;
    }
  | { readonly kind: "subscription" | "included" | "free" }
  | { readonly kind: "unknown"; readonly reason?: string };

export interface ModelCatalogProvenance {
  readonly field: string;
  readonly source: string;
  readonly observedAt: string;
}

export interface ModelExecutionTarget {
  readonly targetId: string;
  readonly label: string;
  readonly access: ModelAccess;
  readonly availability: ExecutionTargetAvailability;
  readonly reasonCodes: readonly ExecutionTargetReasonCode[];
  readonly repairActions: readonly ExecutionTargetRepairAction[];
  readonly eligibleAccountCount: number;
  readonly accountOverrideIds: readonly string[];
  readonly cost: ExecutionTargetCost;
}

export interface ModelCatalogEntry {
  readonly providerId: string;
  readonly providerRouteId: string;
  readonly providerModelId: string;
  readonly access: ModelAccess;
  readonly family: string;
  readonly displayName?: string;
  readonly releaseDate?: string;
  readonly lifecycle?: "active" | "deprecated" | "unknown";
  readonly discovery: ModelDiscoveryState;
  readonly eligibility: ModelEligibilityState;
  readonly availability: ModelAvailabilityState;
  readonly capabilities?: ModelCapabilities;
  readonly provenance: readonly ModelCatalogProvenance[];
  readonly targets: readonly ModelExecutionTarget[];
}

export interface ModelCatalog {
  readonly observedAt: string;
  readonly revision?: string;
  readonly models: readonly ModelCatalogEntry[];
}

export interface ExecutionTargetSelectionIntent {
  readonly targetId: string;
  readonly accountOverrideId?: string;
}

export interface ExecutionTargetChanged {
  readonly type: "execution_target_changed";
  readonly targetId: string;
  readonly requestId: string;
  readonly providerId?: string;
  readonly providerModelId?: string;
}

export interface ExecutionTargetChangeFailed {
  readonly type: "execution_target_change_failed";
  readonly targetId: string;
  readonly requestId: string;
  readonly reasonCode: ExecutionTargetReasonCode;
  readonly reason: string;
  readonly repairActions: readonly ExecutionTargetRepairAction[];
}

const requiredText = z.string().trim().min(1);
const canonicalId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const instant = z.string().datetime({ offset: true });
const modality = z.enum(["text", "image", "audio", "video", "pdf"]);

export const ExecutionTargetReasonCodeSchema = z.enum(EXECUTION_TARGET_REASON_CODES);
export const ExecutionTargetRepairActionSchema = z.enum(EXECUTION_TARGET_REPAIR_ACTIONS);

export const ModelCapabilitiesSchema: z.ZodType<ModelCapabilities> = z.object({
  inputModalities: z.array(modality),
  outputModalities: z.array(modality),
  tools: z.boolean(),
  structuredOutput: z.boolean(),
  reasoning: z.boolean(),
  streaming: z.boolean().optional(),
  parallelToolCalls: z.boolean().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
}).strict();

const MeteredExecutionTargetCostSchema = z.object({
  kind: z.literal("metered"),
  currency: requiredText,
  inputPerMillion: z.number().nonnegative().optional(),
  outputPerMillion: z.number().nonnegative().optional(),
  cachedInputPerMillion: z.number().nonnegative().optional(),
}).strict();
const FlatExecutionTargetCostSchema = z.object({
  kind: z.enum(["subscription", "included", "free"]),
}).strict();
const UnknownExecutionTargetCostSchema = z.object({
  kind: z.literal("unknown"),
  reason: requiredText.optional(),
}).strict();
export const ExecutionTargetCostSchema: z.ZodType<ExecutionTargetCost> = z.union([
  MeteredExecutionTargetCostSchema,
  FlatExecutionTargetCostSchema,
  UnknownExecutionTargetCostSchema,
]);

export const ModelCatalogProvenanceSchema: z.ZodType<ModelCatalogProvenance> = z.object({
  field: requiredText,
  source: requiredText,
  observedAt: instant,
}).strict();

export const ModelExecutionTargetSchema: z.ZodType<ModelExecutionTarget> = z.object({
  targetId: canonicalId,
  label: requiredText,
  access: z.enum(["subscription", "harness", "api", "local"]),
  availability: z.enum(["available", "unavailable", "unresolved"]),
  reasonCodes: z.array(ExecutionTargetReasonCodeSchema),
  repairActions: z.array(ExecutionTargetRepairActionSchema),
  eligibleAccountCount: z.number().int().nonnegative(),
  accountOverrideIds: z.array(canonicalId),
  cost: ExecutionTargetCostSchema,
}).strict();

export const ModelCatalogEntrySchema: z.ZodType<ModelCatalogEntry> = z.object({
  providerId: canonicalId,
  providerRouteId: requiredText,
  providerModelId: requiredText,
  access: z.enum(["subscription", "harness", "api", "local"]),
  family: requiredText,
  displayName: requiredText.optional(),
  releaseDate: z.string().regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u).optional(),
  lifecycle: z.enum(["active", "deprecated", "unknown"]).optional(),
  discovery: z.enum(["observed", "stale", "failed"]),
  eligibility: z.enum(["eligible", "ineligible", "unknown"]),
  availability: z.enum(["available", "unavailable", "unknown"]),
  capabilities: ModelCapabilitiesSchema.optional(),
  provenance: z.array(ModelCatalogProvenanceSchema),
  targets: z.array(ModelExecutionTargetSchema),
}).strict();

export const ModelCatalogSchema: z.ZodType<ModelCatalog> = z.object({
  observedAt: instant,
  revision: requiredText.optional(),
  models: z.array(ModelCatalogEntrySchema),
}).strict();

export const ExecutionTargetSelectionIntentSchema: z.ZodType<ExecutionTargetSelectionIntent> = z.object({
  targetId: canonicalId,
  accountOverrideId: canonicalId.optional(),
}).strict();
