import { z } from "zod";

export type VerifiedEfficiencyActionKind =
  | "cache"
  | "context_allocation"
  | "delegation"
  | "memory"
  | "output_allocation"
  | "progressive_loading"
  | "routing"
  | "verification_allocation";

export interface VerifiedEfficiencyVolume {
  readonly tokens: number;
  readonly costUsd: number;
}

export interface VerifiedEfficiencyEvidenceProjection {
  readonly schemaVersion: "verified-efficiency-evidence-v1";
  readonly sessionId: string;
  readonly turnId?: string;
  readonly observedAt: string;
  readonly provider: {
    readonly providerId: string;
    readonly modelId: string;
    readonly billingMode: string;
  };
  readonly policy: {
    readonly owner: string;
    readonly policyId: string;
    readonly configurationHash: string;
  };
  readonly totals: {
    readonly providerTotalTokens: number;
    readonly providerTotalCostUsd: number;
    readonly measured: VerifiedEfficiencyVolume;
    readonly estimated: VerifiedEfficiencyVolume;
    readonly cached: VerifiedEfficiencyVolume;
    readonly unknown: VerifiedEfficiencyVolume;
    readonly cacheWritten: VerifiedEfficiencyVolume;
    readonly avoided: VerifiedEfficiencyVolume;
  };
  readonly outcome: "succeeded" | "failed" | "unknown";
  readonly verification: {
    readonly status: "passed" | "failed" | "not_run" | "unknown";
    readonly results: readonly {
      readonly verificationResultId: string;
      readonly status: "passed" | "failed" | "unknown";
      readonly method: string;
      readonly evidenceUris: readonly string[];
    }[];
  };
  readonly actions: readonly {
    readonly actionId: string;
    readonly kind: VerifiedEfficiencyActionKind;
    readonly decision: string;
    readonly evidenceUris: readonly string[];
  }[];
  readonly savings: readonly {
    readonly savingId: string;
    readonly actionId: string;
    readonly verificationResultId: string;
    readonly tokens: number;
    readonly costUsd: number;
    readonly comparisonHash: string;
    readonly evidenceUris: readonly string[];
  }[];
  readonly evidenceUris: readonly string[];
}

const nonEmpty = z.string().trim().min(1);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const canonicalEvidenceUri = z.string().regex(/^kiln:\/\/(artifacts|memory)\//u);
const kilnEvidenceUri = z.string().regex(/^kiln:\/\//u);
const evidenceUris = z.array(canonicalEvidenceUri).min(1);
const volume = z.object({
  tokens: z.number().int().nonnegative(),
  costUsd: z.number().finite().nonnegative(),
}).strict();
const verificationResult = z.object({
  verificationResultId: nonEmpty,
  status: z.enum(["passed", "failed", "unknown"]),
  method: nonEmpty,
  evidenceUris: z.array(kilnEvidenceUri).min(1),
}).strict();
const action = z.object({
  actionId: nonEmpty,
  kind: z.enum([
    "cache",
    "context_allocation",
    "delegation",
    "memory",
    "output_allocation",
    "progressive_loading",
    "routing",
    "verification_allocation",
  ]),
  decision: nonEmpty,
  evidenceUris: z.array(kilnEvidenceUri).min(1),
}).strict();
const saving = z.object({
  savingId: nonEmpty,
  actionId: nonEmpty,
  verificationResultId: nonEmpty,
  tokens: z.number().int().nonnegative(),
  costUsd: z.number().finite().nonnegative(),
  comparisonHash: hash,
  evidenceUris,
}).strict();

export const VerifiedEfficiencyEvidenceProjectionSchema: z.ZodType<VerifiedEfficiencyEvidenceProjection> = z.object({
  schemaVersion: z.literal("verified-efficiency-evidence-v1"),
  sessionId: nonEmpty,
  turnId: nonEmpty.optional(),
  observedAt: z.string().datetime({ offset: true }),
  provider: z.object({
    providerId: nonEmpty,
    modelId: nonEmpty,
    billingMode: nonEmpty,
  }).strict(),
  policy: z.object({
    owner: nonEmpty,
    policyId: nonEmpty,
    configurationHash: hash,
  }).strict(),
  totals: z.object({
    providerTotalTokens: z.number().int().nonnegative(),
    providerTotalCostUsd: z.number().finite().nonnegative(),
    measured: volume,
    estimated: volume,
    cached: volume,
    unknown: volume,
    cacheWritten: volume,
    avoided: volume,
  }).strict(),
  outcome: z.enum(["succeeded", "failed", "unknown"]),
  verification: z.object({
    status: z.enum(["passed", "failed", "not_run", "unknown"]),
    results: z.array(verificationResult),
  }).strict(),
  actions: z.array(action),
  savings: z.array(saving),
  evidenceUris: z.array(kilnEvidenceUri),
}).strict().superRefine((value, ctx) => {
  const accountedTokens = value.totals.measured.tokens
    + value.totals.estimated.tokens
    + value.totals.cached.tokens
    + value.totals.unknown.tokens
    + value.totals.cacheWritten.tokens;
  if (accountedTokens !== value.totals.providerTotalTokens) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Efficiency token categories must equal provider totals" });
  }
  const accountedCost = value.totals.measured.costUsd
    + value.totals.estimated.costUsd
    + value.totals.cached.costUsd
    + value.totals.unknown.costUsd
    + value.totals.cacheWritten.costUsd;
  if (Math.abs(accountedCost - value.totals.providerTotalCostUsd) > 1e-9) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Efficiency cost categories must equal provider totals" });
  }
  const avoidedTokens = value.savings.reduce((total, entry) => total + entry.tokens, 0);
  const avoidedCostUsd = value.savings.reduce((total, entry) => total + entry.costUsd, 0);
  if (avoidedTokens !== value.totals.avoided.tokens || Math.abs(avoidedCostUsd - value.totals.avoided.costUsd) > 1e-9) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Avoided totals must equal paired saving evidence" });
  }
  const actionIds = new Set(value.actions.map((entry) => entry.actionId));
  const verificationById = new Map(value.verification.results.map((entry) => [entry.verificationResultId, entry]));
  for (const entry of value.savings) {
    if (!actionIds.has(entry.actionId) || verificationById.get(entry.verificationResultId)?.status !== "passed") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Avoided savings require an action and passing linked verification" });
    }
  }
  const expectedVerification = value.verification.results.length === 0
    ? "not_run"
    : value.verification.results.some((entry) => entry.status === "failed")
      ? "failed"
      : value.verification.results.some((entry) => entry.status === "unknown")
        ? "unknown"
        : "passed";
  if (value.verification.status !== expectedVerification) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Verification summary must agree with results" });
  }
  for (const [label, ids] of [
    ["action", value.actions.map((entry) => entry.actionId)],
    ["verification", value.verification.results.map((entry) => entry.verificationResultId)],
    ["saving", value.savings.map((entry) => entry.savingId)],
  ] as const) {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate ${label} identity` });
    }
  }
});

export function formatVerifiedEfficiencyEvidence(projection: VerifiedEfficiencyEvidenceProjection): string {
  return `Efficiency: ${projection.totals.measured.tokens} measured`
    + ` · ${projection.totals.estimated.tokens} estimated`
    + ` · ${projection.totals.cached.tokens} cached`
    + ` · ${projection.totals.avoided.tokens} avoided`
    + ` · verification ${projection.verification.status}`
    + ` · ${projection.policy.policyId}`;
}
