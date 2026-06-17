/**
 * Canonical action-effect model for tool governance.
 *
 * One canonical internal vocabulary for semantic action effects.
 * Used as the sole input to tool-authority derivation.
 * External MCP annotations are interoperability hints only;
 * they must not grant authority.
 *
 * Invariant: there is one canonical action-effect type,
 * one canonical authority derivation function,
 * and no surface maintains a private authority mapping.
 */

// --- Value types ---

/** Whether a tool observes or mutates state. */
export type OperationType = "observe" | "mutate";

/** Boundaries a tool can affect. Sorted arrays for JSON serialization and comparison. */
export type BoundaryType =
  | "process"
  | "workspace"
  | "machine"
  | "network"
  | "external-system";

/** How reversible a tool's effects are. */
export type ReversibilityType =
  | "reversible"
  | "compensatable"
  | "irreversible"
  | "unknown";

/** What data the tool may expose outside the workspace. */
export type DataEgressType =
  | "none"
  | "metadata"
  | "project-data"
  | "sensitive-data"
  | "unknown";

/** What identity context the tool uses. */
export type IdentityUseType =
  | "none"
  | "authenticated"
  | "privileged"
  | "unknown";

/** Consequence categories a tool may produce. */
export type ConsequenceType =
  | "local-state"
  | "external-state"
  | "financial"
  | "legal"
  | "security"
  | "unknown";

/** Idempotency classification. */
export type IdempotencyType =
  | "idempotent"
  | "conditionally-idempotent"
  | "non-idempotent"
  | "unknown";

// --- Envelope and resolved types ---

/**
 * Declared effect envelope: the maximum semantic effects a tool can produce.
 * Catalog-time, immutable, core-owned.
 * Used for discovery, conservative projections, and validation.
 */
export interface ActionEffectEnvelope {
  readonly operation: OperationType;
  readonly boundaries: readonly BoundaryType[];
  readonly reversibility: ReversibilityType;
  readonly dataEgress: DataEgressType;
  readonly identityUse: IdentityUseType;
  readonly consequences: readonly ConsequenceType[];
  readonly idempotency: IdempotencyType;
}

/**
 * Resolved invocation effect: the effects proposed by one validated invocation
 * with concrete input. Determined before authority resolution and before
 * execution. Must be equal to or narrower than the declared effect envelope.
 *
 * Every field must satisfy the narrowing invariant:
 * - operation: observe ⊂ mutate (observe is narrower than mutate)
 * - boundaries: resolved ⊆ envelope
 * - reversibility: reversible ⊂ compensatable ⊂ irreversible (or unknown)
 * - dataEgress: none ⊂ metadata ⊂ project-data ⊂ sensitive-data (or unknown)
 * - identityUse: none ⊂ authenticated ⊂ privileged (or unknown)
 * - consequences: resolved ⊆ envelope
 * - idempotency: idempotent ⊂ conditionally-idempotent ⊂ non-idempotent (or unknown)
 */
export interface ResolvedInvocationEffect extends ActionEffectEnvelope {}

/** Authority level matching existing AuthorizationLevel. */
export type ActionEffectAuthorityLevel = 1 | 2 | 3 | 4;

/**
 * Authority policy for conservative default behavior.
 * One owner, one policy center.
 */
export interface ActionEffectPolicy {
  readonly defaultLevel: ActionEffectAuthorityLevel;
  readonly requireApprovalForUnknown: boolean;
}

/** Default policy: unknown effects require approval unless an explicit caller policy overrides it. */
export const DEFAULT_ACTION_EFFECT_POLICY: ActionEffectPolicy = {
  defaultLevel: 3,
  requireApprovalForUnknown: true,
} as const;

/**
 * Conservative default envelope for unannotated or unknown tools.
 * Assumes the worst: mutate, all boundaries, irreversible, unknown egress,
 * unknown identity, unknown consequences, unknown idempotency.
 */
export const CONSERVATIVE_UNKNOWN_ENVELOPE: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace", "machine", "network", "external-system"],
  reversibility: "unknown",
  dataEgress: "unknown",
  identityUse: "unknown",
  consequences: ["unknown"],
  idempotency: "unknown",
} as const;

/**
 * Conservative envelope for external MCP tools.
 * MCP hints are untrusted interoperability hints, so this function never narrows
 * the trusted maximum effect. Trusted external-tool declarations must come from
 * operator/project policy or an integration adapter declaration, not from an
 * MCP server's self-description.
 */
export function conservativeEnvelopeFromExternalHints(_hints?: {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}): ActionEffectEnvelope {
  return CONSERVATIVE_UNKNOWN_ENVELOPE;
}

const VALID_OPERATIONS = new Set<OperationType>(["observe", "mutate"]);
const VALID_BOUNDARIES = new Set<BoundaryType>([
  "process",
  "workspace",
  "machine",
  "network",
  "external-system",
]);
const VALID_REVERSIBILITIES = new Set<ReversibilityType>([
  "reversible",
  "compensatable",
  "irreversible",
  "unknown",
]);
const VALID_DATA_EGRESS = new Set<DataEgressType>([
  "none",
  "metadata",
  "project-data",
  "sensitive-data",
  "unknown",
]);
const VALID_IDENTITY_USE = new Set<IdentityUseType>([
  "none",
  "authenticated",
  "privileged",
  "unknown",
]);
const VALID_CONSEQUENCES = new Set<ConsequenceType>([
  "local-state",
  "external-state",
  "financial",
  "legal",
  "security",
  "unknown",
]);
const VALID_IDEMPOTENCY = new Set<IdempotencyType>([
  "idempotent",
  "conditionally-idempotent",
  "non-idempotent",
  "unknown",
]);

const BOUNDARY_ORDER: readonly BoundaryType[] = [
  "process",
  "workspace",
  "machine",
  "network",
  "external-system",
];
const CONSEQUENCE_ORDER: readonly ConsequenceType[] = [
  "local-state",
  "external-state",
  "financial",
  "legal",
  "security",
  "unknown",
];

export function normalizeActionEffectEnvelope(input: unknown): ActionEffectEnvelope | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (!isMember(record.operation, VALID_OPERATIONS)) return undefined;
  if (!isMember(record.reversibility, VALID_REVERSIBILITIES)) return undefined;
  if (!isMember(record.dataEgress, VALID_DATA_EGRESS)) return undefined;
  if (!isMember(record.identityUse, VALID_IDENTITY_USE)) return undefined;
  if (!isMember(record.idempotency, VALID_IDEMPOTENCY)) return undefined;
  const boundaries = normalizeUniqueArray(record.boundaries, VALID_BOUNDARIES, BOUNDARY_ORDER);
  const consequences = normalizeUniqueArray(record.consequences, VALID_CONSEQUENCES, CONSEQUENCE_ORDER);
  if (!boundaries) return undefined;
  if (!consequences) return undefined;
  return Object.freeze({
    operation: record.operation,
    boundaries: Object.freeze(boundaries),
    reversibility: record.reversibility,
    dataEgress: record.dataEgress,
    identityUse: record.identityUse,
    consequences: Object.freeze(consequences),
    idempotency: record.idempotency,
  });
}

function isMember<T extends string>(value: unknown, members: ReadonlySet<T>): value is T {
  return typeof value === "string" && members.has(value as T);
}

function normalizeUniqueArray<T extends string>(
  value: unknown,
  members: ReadonlySet<T>,
  order: readonly T[],
): readonly T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const unique = new Set<T>();
  for (const item of value) {
    if (!isMember(item, members)) return undefined;
    if (unique.has(item)) return undefined;
    unique.add(item);
  }
  return order.filter((item) => unique.has(item));
}

// --- Narrowing validation ---

const OPERATION_NARROWING_ORDER: readonly OperationType[] = ["observe", "mutate"];
const REVERSIBILITY_NARROWING_ORDER: readonly ReversibilityType[] = [
  "reversible",
  "compensatable",
  "irreversible",
  "unknown",
];
const DATA_EGRESS_NARROWING_ORDER: readonly DataEgressType[] = [
  "none",
  "metadata",
  "project-data",
  "sensitive-data",
  "unknown",
];
const IDENTITY_USE_NARROWING_ORDER: readonly IdentityUseType[] = [
  "none",
  "authenticated",
  "privileged",
  "unknown",
];
const IDEMPOTENCY_NARROWING_ORDER: readonly IdempotencyType[] = [
  "idempotent",
  "conditionally-idempotent",
  "non-idempotent",
  "unknown",
];

/**
 * Returns true if `narrower` is equal to or narrower than `wider`
 * for scalar dimensions. "Narrower" means less severe or more constrained.
 */
function isNarrowerOrEqual<T extends string>(
  narrower: T,
  wider: T,
  order: readonly T[],
): boolean {
  if (narrower === wider) return true;
  return order.indexOf(narrower) <= order.indexOf(wider);
}

/**
 * Returns true if `narrower` boundaries are a subset of or equal to `wider` boundaries.
 */
function isSubsetOrEqual<T extends string>(
  narrower: readonly T[],
  wider: readonly T[],
): boolean {
  const widerSet = new Set(wider);
  return narrower.every((b) => widerSet.has(b));
}

/**
 * Validates that a resolved invocation effect is equal to or narrower than
 * its declared effect envelope. Returns true if valid.
 */
export function isValidNarrowing(
  resolved: ResolvedInvocationEffect,
  envelope: ActionEffectEnvelope,
): boolean {
  const normalizedResolved = normalizeActionEffectEnvelope(resolved);
  const normalizedEnvelope = normalizeActionEffectEnvelope(envelope);
  if (!normalizedResolved || !normalizedEnvelope) {
    return false;
  }
  resolved = normalizedResolved;
  envelope = normalizedEnvelope;
  if (!isNarrowerOrEqual(resolved.operation, envelope.operation, OPERATION_NARROWING_ORDER)) {
    return false;
  }
  if (!isSubsetOrEqual(resolved.boundaries, envelope.boundaries)) {
    return false;
  }
  if (
    !isNarrowerOrEqual(resolved.reversibility, envelope.reversibility, REVERSIBILITY_NARROWING_ORDER)
  ) {
    return false;
  }
  if (!isNarrowerOrEqual(resolved.dataEgress, envelope.dataEgress, DATA_EGRESS_NARROWING_ORDER)) {
    return false;
  }
  if (!isNarrowerOrEqual(resolved.identityUse, envelope.identityUse, IDENTITY_USE_NARROWING_ORDER)) {
    return false;
  }
  if (!isSubsetOrEqual(resolved.consequences, envelope.consequences)) {
    return false;
  }
  if (!isNarrowerOrEqual(resolved.idempotency, envelope.idempotency, IDEMPOTENCY_NARROWING_ORDER)) {
    return false;
  }
  return true;
}

// --- Authority derivation ---

/**
 * Canonical authority derivation from a resolved invocation effect.
 * This is the one policy function. All surfaces must consume its output.
 *
 * Authority rules:
 * - observe tools without sensitive consequences: level 1 (auto-execute)
 * - idempotent/compensatable mutations without sensitive egress: level 1-2
 * - unknown effects with requireApprovalForUnknown: level 3 (confirm)
 * - irreversible mutations with external consequences: level 4 (always confirm)
 * - destructive tools (irreversible + external): level 4
 * - conservative unknown: level 2 or 3 depending on policy
 *
 * Invariant: This function is the only authority derivation path.
 * No surface may re-derive authority from annotations or hints.
 */
export function deriveAuthorityFromEffect(
  resolved: ResolvedInvocationEffect,
  policy: ActionEffectPolicy = DEFAULT_ACTION_EFFECT_POLICY,
): { level: ActionEffectAuthorityLevel; allowed: boolean; requiresApproval: boolean; reason: string } {
  const normalized = normalizeActionEffectEnvelope(resolved);
  if (!normalized) {
    return {
      level: 4,
      allowed: false,
      requiresApproval: true,
      reason: "Malformed action effect requires confirmation",
    };
  }
  resolved = normalized;
  const { operation, reversibility, dataEgress, consequences, idempotency, boundaries, identityUse } =
    resolved;

  // Irreversible mutations with external/system impact → always confirm
  const hasExternalImpact =
    boundaries.includes("external-system") ||
    boundaries.includes("network") ||
    consequences.includes("external-state") ||
    consequences.includes("financial") ||
    consequences.includes("legal") ||
    consequences.includes("security");
  const hasSensitiveEgress =
    dataEgress === "sensitive-data" || dataEgress === "unknown";
  const hasPrivilegedIdentity =
    identityUse === "privileged" || identityUse === "unknown";

  if (operation === "mutate" && reversibility === "irreversible" && (hasExternalImpact || hasSensitiveEgress)) {
    return {
      level: 4,
      allowed: false,
      requiresApproval: true,
      reason: "Irreversible mutation with external impact or sensitive egress requires confirmation",
    };
  }

  // Privileged identity → always confirm
  if (hasPrivilegedIdentity) {
    return {
      level: 4,
      allowed: false,
      requiresApproval: true,
      reason: "Privileged or unknown identity use requires confirmation",
    };
  }

  if (
    reversibility === "unknown" ||
    dataEgress === "unknown" ||
    idempotency === "unknown" ||
    consequences.includes("unknown")
  ) {
    if (policy.requireApprovalForUnknown) {
      return {
        level: 3,
        allowed: false,
        requiresApproval: true,
        reason: "Unknown effects require confirmation",
      };
    }
    return {
      level: policy.defaultLevel,
      allowed: policy.defaultLevel < 3,
      requiresApproval: policy.defaultLevel >= 3,
      reason: "Unknown effects, explicit override policy applied",
    };
  }

  // Pure observe with no sensitive egress and no privileged identity → auto-execute
  if (operation === "observe" && !hasSensitiveEgress && !hasExternalImpact) {
    return {
      level: 1,
      allowed: true,
      requiresApproval: false,
      reason: "Read-only observation, auto-execute",
    };
  }

  // Observe with sensitive egress or external impact → audited
  if (operation === "observe" && (hasSensitiveEgress || hasExternalImpact)) {
    return {
      level: 2,
      allowed: true,
      requiresApproval: false,
      reason: "Observation with external access, audited execution",
    };
  }

  // Mutations: reversible & idempotent → audited
  if (operation === "mutate" && reversibility === "reversible" && idempotency === "idempotent" && !hasSensitiveEgress) {
    return {
      level: 1,
      allowed: true,
      requiresApproval: false,
      reason: "Reversible idempotent mutation, auto-execute",
    };
  }

  // Mutations: compensatable, no sensitive egress, no privileged identity → audited
  if (
    operation === "mutate" &&
    (reversibility === "reversible" || reversibility === "compensatable") &&
    !hasSensitiveEgress
  ) {
    return {
      level: 2,
      allowed: true,
      requiresApproval: false,
      reason: "Reversible or compensatable mutation, audited execution",
    };
  }

  // Irreversible mutations without external impact → confirm
  if (operation === "mutate" && reversibility === "irreversible" && !hasExternalImpact && !hasSensitiveEgress) {
    return {
      level: 4,
      allowed: false,
      requiresApproval: true,
      reason: "Irreversible workspace mutation requires confirmation",
    };
  }

  // Default fallback: audited
  return {
    level: 2,
    allowed: true,
    requiresApproval: false,
    reason: "Audited execution",
  };
}

/**
 * Derive a catalog authority projection from an effect envelope.
 * This replaces the old `authorityForTool()` which derived from booleans.
 */
export function catalogAuthorityFromEnvelope(envelope: ActionEffectEnvelope): "read_only" | "destructive" | "standard" {
  if (envelope.operation === "observe" && envelope.dataEgress === "none") {
    return "read_only";
  }
  if (
    envelope.operation === "mutate" &&
    envelope.reversibility === "irreversible" &&
    (envelope.boundaries.includes("workspace") || envelope.boundaries.includes("machine"))
  ) {
    return "destructive";
  }
  return "standard";
}

/**
 * Derive human-readable tags from an effect envelope.
 * Replaces the old boolean-derived tags.
 */
export function tagsFromEnvelope(envelope: ActionEffectEnvelope): readonly string[] {
  const tags: string[] = [];
  if (envelope.operation === "observe") {
    tags.push("read-only");
  }
  if (envelope.idempotency === "idempotent") {
    tags.push("idempotent");
  }
  if (
    envelope.operation === "mutate" &&
    envelope.reversibility === "irreversible"
  ) {
    tags.push("destructive");
  }
  if (envelope.boundaries.includes("network") || envelope.boundaries.includes("external-system")) {
    tags.push("external");
  }
  if (envelope.dataEgress !== "none") {
    tags.push("egress");
  }
  return tags;
}

/**
 * Resolver type for input-sensitive tools.
 * Takes tool name, validated input, and the declared envelope,
 * returns a resolved invocation effect that must be equal to or narrower
 * than the envelope. Resolvers describe effects; they must not return
 * allowed/denied decisions.
 */
export type InvocationEffectResolver = (
  toolName: string,
  input: Record<string, unknown>,
  envelope: ActionEffectEnvelope,
) => ResolvedInvocationEffect;

/**
 * Registry of input-sensitive resolvers.
 * Tools without a resolver use their envelope as-is (static classification).
 */
export type InvocationEffectResolverRegistry = ReadonlyMap<
  string,
  InvocationEffectResolver
>;

/**
 * Resolve an invocation effect for a tool call.
 * If a resolver exists, calls it and validates narrowing.
 * If no resolver exists, returns the envelope as-is (static classification).
 * If the resolver returns an invalid narrowing, returns the envelope conservatively.
 */
export function resolveInvocationEffect(
  toolName: string,
  input: Record<string, unknown>,
  envelope: ActionEffectEnvelope,
  resolvers?: InvocationEffectResolverRegistry,
): ResolvedInvocationEffect {
  const normalizedEnvelope = normalizeActionEffectEnvelope(envelope);
  if (!normalizedEnvelope) {
    throw new Error(`Malformed declared action-effect envelope for tool "${toolName}"`);
  }
  if (!resolvers) {
    return normalizedEnvelope;
  }
  const resolver = resolvers.get(toolName);
  if (!resolver) {
    return normalizedEnvelope;
  }
  const resolved = normalizeActionEffectEnvelope(resolver(toolName, input, normalizedEnvelope));
  if (!resolved) {
    throw new Error(`Malformed resolved action effect for tool "${toolName}"`);
  }
  if (!isValidNarrowing(resolved, normalizedEnvelope)) {
    throw new Error(`Resolved action effect exceeds declared envelope for tool "${toolName}"`);
  }
  return resolved;
}
