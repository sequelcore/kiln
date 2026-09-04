import { z } from "zod";

const nonNegativeInteger = z.number().int().nonnegative();
const contentIdentity = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const intentSource = z.enum([
  "safety-authority", "user", "artifact-contract", "response-skill", "invocation",
  "agent-profile", "project", "global", "provider-default",
]);
const requiredContent = z.enum([
  "approval-requirement", "citation", "decision", "failure", "finding",
  "next-action", "residual-risk", "verification", "warning",
]);
const contractReference = z.object({ id: z.string().trim().min(1), revision: z.string().trim().min(1) }).strict();
const interactionProfile = z.object({
  id: z.string().trim().min(1),
  revision: z.string().trim().min(1),
  behaviors: z.array(z.enum([
    "audience-calibrated", "findings-first", "next-action-explicit",
    "outcome-first", "plain-language", "state-visible",
  ])),
}).strict();
const resolvedIntent = z.object({
  version: z.literal("v1"),
  intent: z.object({
    responseDetail: z.enum(["provider-default", "concise", "standard", "detailed"]),
    interactionProfile: interactionProfile.optional(),
    locale: z.string().trim().min(1).optional(),
    requiredContent: z.array(requiredContent),
    artifactContract: contractReference.optional(),
    responseSkills: z.array(contractReference),
    onUnsupported: z.enum(["deny", "omit"]),
  }).strict(),
  authority: z.object({
    responseDetail: intentSource,
    interactionProfile: intentSource.optional(),
    locale: intentSource.optional(),
    artifactContract: intentSource.optional(),
    responseSkills: z.array(intentSource),
    onUnsupported: intentSource,
    requiredContent: z.record(requiredContent, z.array(intentSource)),
  }).strict(),
  identity: contentIdentity,
}).strict();
const capabilityEvidence = z.object({
  sourceIdentity: z.string().trim().min(1),
  sourceRevision: z.string().trim().min(1),
  observedAt: z.string().datetime(),
}).strict();
const projectionResolution = <T extends z.ZodTypeAny>(value: T) => z.object({
  requested: value.optional(),
  effective: value.optional(),
  status: z.enum(["exact", "not-requested"]),
  mechanism: z.enum(["prompt", "contract-reference", "none"]),
}).strict();
export const CommunicationResolutionSchema = z.object({
  version: z.literal("v1"),
  requested: resolvedIntent,
  execution: z.object({
    routeId: z.string().trim().min(1).optional(),
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1),
    surface: z.enum(["cli", "gui", "tui", "sdk", "runtime", "managed-child", "replay", "standalone-harness"]),
    harness: z.string().trim().min(1).optional(),
  }).strict(),
  responseDetail: z.object({
    requested: z.enum(["provider-default", "concise", "standard", "detailed"]),
    effective: z.enum(["provider-default", "concise", "standard", "detailed"]).optional(),
    status: z.enum(["exact", "prompt-fallback", "defaulted", "unsupported"]),
    mechanism: z.enum(["native", "prompt", "default", "none"]),
    nativeValue: z.string().optional(),
    evaluationId: z.string().optional(),
    reason: z.enum(["not-requested", "provider-default", "capability-unknown", "detail-unsupported", "profile-unsupported"]).optional(),
  }).strict(),
  interactionProfile: z.object({
    requestedProfileId: z.string().optional(),
    effectiveProfileId: z.string().optional(),
    status: z.enum(["exact", "translated", "prompt-fallback", "defaulted", "unsupported"]),
    mechanism: z.enum(["native", "prompt", "default", "none"]),
    nativeValue: z.string().optional(),
    evaluationId: z.string().optional(),
    reason: z.enum(["not-requested", "provider-default", "capability-unknown", "detail-unsupported", "profile-unsupported"]).optional(),
  }).strict(),
  locale: projectionResolution(z.string()),
  requiredContent: projectionResolution(z.array(requiredContent)),
  artifactContract: projectionResolution(contractReference),
  responseSkills: projectionResolution(z.array(contractReference)),
  capabilityEvidence: capabilityEvidence.optional(),
  semanticLoss: z.array(z.string()),
  identity: contentIdentity,
}).strict();

export const EffectivePromptObservationSchema = z.object({
  version: z.literal("v1"),
  requestIndex: nonNegativeInteger,
  providerId: z.string().trim().min(1),
  modelId: z.string().trim().min(1),
  estimatedTokens: nonNegativeInteger,
  componentCount: nonNegativeInteger,
  componentScopeCounts: z.object({
    static: nonNegativeInteger,
    dynamic: nonNegativeInteger,
    deferred: nonNegativeInteger,
  }).strict(),
  communicationResolution: CommunicationResolutionSchema.optional(),
  evidenceIdentity: contentIdentity,
}).strict().superRefine((value, ctx) => {
  const scopeTotal = value.componentScopeCounts.static
    + value.componentScopeCounts.dynamic
    + value.componentScopeCounts.deferred;
  if (scopeTotal !== value.componentCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Effective prompt component counts must agree." });
  }
});

export type EffectivePromptObservation = z.infer<typeof EffectivePromptObservationSchema>;

export function formatEffectivePromptObservation(observation: EffectivePromptObservation): string {
  const componentLabel = observation.componentCount === 1 ? "component" : "components";
  return `Effective prompt: ${observation.estimatedTokens} tokens, ${observation.componentCount} ${componentLabel} · ${observation.providerId}/${observation.modelId} · request ${observation.requestIndex + 1}`;
}
