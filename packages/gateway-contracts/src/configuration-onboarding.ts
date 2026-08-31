import { z } from "zod";

/**
 * Secret-free configuration onboarding wire contracts.
 *
 * Onboarding reports the current readiness of one project against the already
 * admitted global V7 target catalog. It does not carry credentials, evidence
 * payloads, machine paths, or a second provider policy vocabulary.
 */
export const KILN_CONFIGURATION_ONBOARDING_STATUSES = ["ready", "blocked", "complete"] as const;
export const KILN_CONFIGURATION_ONBOARDING_RESULT_STATUSES = ["committed", "partial", "rejected", "blocked"] as const;
export const KILN_CONFIGURATION_ONBOARDING_SCOPES = ["project"] as const;
/** Slice 5 only admits the canonical safe baseline; broader authority belongs to Settings. */
export const KILN_CONFIGURATION_ONBOARDING_POSTURES = ["read-only"] as const;
export const KILN_CONFIGURATION_ONBOARDING_BLOCKER_CODES = [
  "global-config-unavailable",
  "global-config-invalid",
  "target-unavailable",
  "target-not-admitted",
  "project-config-invalid",
  "permission-posture-unavailable",
  "mutation-rejected",
] as const;

const identifier = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const text = z.string().trim().min(1).max(512);
const diagnostic = z.object({
  severity: z.enum(["error", "warning"]),
  field: text,
  message: text,
}).strict();

export const KilnConfigurationOnboardingTargetSchema = z.object({
  id: identifier,
  label: text,
  providerId: identifier,
  providerModelId: text,
  selected: z.boolean(),
}).strict();
export type KilnConfigurationOnboardingTarget = z.infer<typeof KilnConfigurationOnboardingTargetSchema>;

export const KilnConfigurationOnboardingBlockerSchema = z.object({
  code: z.enum(KILN_CONFIGURATION_ONBOARDING_BLOCKER_CODES),
  message: text,
}).strict();
export type KilnConfigurationOnboardingBlocker = z.infer<typeof KilnConfigurationOnboardingBlockerSchema>;

export const KilnConfigurationOnboardingSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(KILN_CONFIGURATION_ONBOARDING_STATUSES),
  scope: z.literal("project"),
  posture: z.enum(KILN_CONFIGURATION_ONBOARDING_POSTURES),
  targets: z.array(KilnConfigurationOnboardingTargetSchema).max(256),
  defaultTargetId: identifier.nullable(),
  blockers: z.array(KilnConfigurationOnboardingBlockerSchema).max(32),
  nextAction: text.nullable(),
}).strict();
export type KilnConfigurationOnboardingSnapshot = z.infer<typeof KilnConfigurationOnboardingSnapshotSchema>;

export const KilnConfigurationOnboardingApplyRequestSchema = z.object({
  schemaVersion: z.literal(1),
  scope: z.literal("project"),
  posture: z.enum(KILN_CONFIGURATION_ONBOARDING_POSTURES),
  targetId: identifier.nullable(),
}).strict();
export type KilnConfigurationOnboardingApplyRequest = z.infer<typeof KilnConfigurationOnboardingApplyRequestSchema>;

export const KilnConfigurationOnboardingMutationSummarySchema = z.object({
  outcome: z.enum(["committed", "committed-reconciliation-failed", "rejected"]),
  replayed: z.boolean(),
  diagnostics: z.array(diagnostic).max(64),
}).strict();
export type KilnConfigurationOnboardingMutationSummary = z.infer<typeof KilnConfigurationOnboardingMutationSummarySchema>;

export const KilnConfigurationOnboardingResultSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(KILN_CONFIGURATION_ONBOARDING_RESULT_STATUSES),
  projectAdoption: KilnConfigurationOnboardingMutationSummarySchema.nullable(),
  targetSelection: KilnConfigurationOnboardingMutationSummarySchema.nullable(),
  blockers: z.array(KilnConfigurationOnboardingBlockerSchema).max(32),
  nextAction: text.nullable(),
}).strict();
export type KilnConfigurationOnboardingResult = z.infer<typeof KilnConfigurationOnboardingResultSchema>;
