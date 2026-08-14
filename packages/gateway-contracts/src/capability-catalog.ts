import { z } from "zod";

export const CAPABILITY_KINDS = [
  "portable-tool",
  "hosted-tool",
  "harness-native-tool",
  "agent-backed",
] as const;

export const CAPABILITY_PERMISSIONS = [
  "workspace-read",
  "workspace-write",
  "machine-execution",
  "network-access",
  "external-state",
  "credential-use",
] as const;

export const CAPABILITY_CALLER_IDS = [
  "kiln-runtime",
  "kiln-cli",
  "kiln-gui",
  "kiln-tui",
  "kiln-sdk",
  "kiln-widget",
  "codex",
  "claude",
  "opencode-v2",
] as const;

export const CAPABILITY_CATALOG_REASONS = [
  "duplicate-identity",
  "revision-drift",
  "schema-mismatch",
  "unsupported-effect",
  "stale-evidence",
  "unavailable-evidence",
  "contradictory-evidence",
  "malformed-descriptor",
  "secret-bearing-field",
] as const;

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}(?:\.[a-z0-9][a-z0-9_-]{0,62})+$/u;
const REVISION_PATTERN = /^(?:v\d+|v?\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?|sha256:[a-f0-9]{64})$/u;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const CREDENTIAL_SIGNATURE_PATTERNS = [
  /(?:^|[._:/+\-])(?:sk|pk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{8,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])AIza[0-9A-Za-z_-]{20,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])glpat-[0-9A-Za-z_-]{10,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])xox[baprs]-[0-9A-Za-z-]{10,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])AKIA[0-9A-Z]{16}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?=$|[.:/+])/u,
] as const;
const MAX_CALLERS = CAPABILITY_CALLER_IDS.length;
const MAX_ARTIFACTS = 32;

const DigestSchema = z.string().regex(DIGEST_PATTERN);
const hasCredentialSignature = (value: string): boolean =>
  CREDENTIAL_SIGNATURE_PATTERNS.some((pattern) => pattern.test(value));
const CapabilityIdSchema = z.string().regex(CAPABILITY_ID_PATTERN).max(127).refine(
  (value) => !hasCredentialSignature(value),
  "capability identifier must not contain a credential signature",
);
const RevisionSchema = z.string().regex(REVISION_PATTERN).max(127);
const TimestampSchema = z.string().datetime({ offset: true });

const ArtifactSchema = z.object({
  mediaType: z.string().regex(MEDIA_TYPE_PATTERN).max(128).refine(
    (value) => !hasCredentialSignature(value),
    "artifact media type must not contain a credential signature",
  ),
  schemaDigest: DigestSchema.optional(),
}).strict();

const EffectSchema = z.object({
  operation: z.enum(["observe", "mutate"]),
  boundaries: z.array(z.enum(["process", "workspace", "machine", "network", "external-system"])).max(5),
  reversibility: z.enum(["reversible", "compensatable", "irreversible", "unknown"]),
  dataEgress: z.enum(["none", "metadata", "project-data", "sensitive-data", "unknown"]),
  identityUse: z.enum(["none", "authenticated", "privileged", "unknown"]),
  consequences: z.array(z.enum(["local-state", "external-state", "financial", "legal", "security", "unknown"])).max(6),
  idempotency: z.enum(["idempotent", "conditionally-idempotent", "non-idempotent", "unknown"]),
}).strict().superRefine((effect, context) => {
  if (new Set(effect.boundaries).size !== effect.boundaries.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "effect boundaries must be unique" });
  }
  if (new Set(effect.consequences).size !== effect.consequences.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "effect consequences must be unique" });
  }
  if (effect.reversibility === "unknown"
    || effect.dataEgress === "unknown"
    || effect.identityUse === "unknown"
    || effect.consequences.includes("unknown")
    || effect.idempotency === "unknown") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "admitted capability effects must be fully known" });
  }
});

const FreshnessSchema = z.object({
  status: z.literal("available"),
  observedAt: TimestampSchema,
  validUntil: TimestampSchema,
}).strict().superRefine((freshness, context) => {
  if (Date.parse(freshness.validUntil) <= Date.parse(freshness.observedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "freshness validity must follow observation" });
  }
});

const LimitsSchema = z.object({
  maxInputBytes: z.number().int().positive().max(16 * 1024 * 1024),
  maxOutputBytes: z.number().int().positive().max(64 * 1024 * 1024),
  maxDurationMs: z.number().int().positive().max(86_400_000),
  maxArtifacts: z.number().int().nonnegative().max(256),
}).strict();

export const CapabilityCatalogEntrySchema = z.object({
  capabilityId: CapabilityIdSchema,
  revision: RevisionSchema,
  descriptorDigest: DigestSchema,
  kind: z.enum(CAPABILITY_KINDS),
  owner: z.object({
    kind: z.enum(["kiln", "provider", "harness", "service", "agent"]),
    identityDigest: DigestSchema,
  }).strict(),
  inputSchemaDigest: DigestSchema,
  outputSchemaDigest: DigestSchema,
  artifacts: z.array(ArtifactSchema).max(MAX_ARTIFACTS),
  effect: EffectSchema,
  permissions: z.array(z.enum(CAPABILITY_PERMISSIONS)).max(CAPABILITY_PERMISSIONS.length),
  approval: z.enum(["none", "conditional", "required"]),
  network: z.enum(["none", "restricted", "open"]),
  data: z.object({
    input: z.enum(["public", "internal", "sensitive"]),
    output: z.enum(["public", "internal", "sensitive"]),
    retention: z.enum(["none", "ephemeral", "persistent"]),
  }).strict(),
  supportedCallers: z.array(z.enum(CAPABILITY_CALLER_IDS)).min(1).max(MAX_CALLERS),
  freshness: FreshnessSchema,
  provenance: z.object({
    sourceType: z.enum(["kiln", "harness", "provider", "protocol", "operator"]),
    sourceIdentityDigest: DigestSchema,
    sourceDigest: DigestSchema,
  }).strict(),
  limits: LimitsSchema,
}).strict().superRefine((entry, context) => {
  if (new Set(entry.permissions).size !== entry.permissions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "permissions must be unique" });
  }
  if (new Set(entry.supportedCallers).size !== entry.supportedCallers.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "supported callers must be unique" });
  }
});

export const CapabilityCatalogRejectionSchema = z.object({
  capabilityId: CapabilityIdSchema.optional(),
  revision: RevisionSchema.optional(),
  descriptorDigest: DigestSchema.optional(),
  status: z.literal("ineligible"),
  reasons: z.array(z.enum(CAPABILITY_CATALOG_REASONS)).min(1).max(CAPABILITY_CATALOG_REASONS.length),
}).strict().superRefine((decision, context) => {
  if (new Set(decision.reasons).size !== decision.reasons.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "rejection reasons must be unique" });
  }
});

export const CapabilityCatalogProjectionSchema = z.object({
  schema: z.literal("kiln.capability-catalog/v1"),
  observedAt: TimestampSchema,
  catalogDigest: DigestSchema,
  entries: z.array(CapabilityCatalogEntrySchema).max(10_000),
  rejections: z.array(CapabilityCatalogRejectionSchema).max(10_000),
}).strict().superRefine((catalog, context) => {
  const identities = new Set<string>();
  const observedAt = Date.parse(catalog.observedAt);
  for (const [index, entry] of catalog.entries.entries()) {
    const identity = `${entry.capabilityId}\0${entry.revision}`;
    if (identities.has(identity)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries", index], message: "capability identity must be unique" });
    }
    identities.add(identity);
    if (Date.parse(entry.freshness.observedAt) > observedAt || Date.parse(entry.freshness.validUntil) <= observedAt) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["entries", index, "freshness"], message: "admitted capability evidence must be current at catalog observation" });
    }
  }
  for (const [index, rejection] of catalog.rejections.entries()) {
    if (!rejection.capabilityId || !rejection.revision) continue;
    const identity = `${rejection.capabilityId}\0${rejection.revision}`;
    if (identities.has(identity)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["rejections", index], message: "capability identity must appear only once across the catalog" });
    }
    identities.add(identity);
  }
});

export type CapabilityCatalogEntry = z.infer<typeof CapabilityCatalogEntrySchema>;
export type CapabilityCatalogRejection = z.infer<typeof CapabilityCatalogRejectionSchema>;
export type CapabilityCatalogProjection = z.infer<typeof CapabilityCatalogProjectionSchema>;
