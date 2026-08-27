export const GENTLE_REVIEW_OBSERVATION_SCHEMA = "kiln.gentle-review-observation/v2" as const;
export const GENTLE_REVIEW_CONTRACT = "gentle-ai.review-integration/v2" as const;
export const GENTLE_REVIEW_CAPABILITIES_SCHEMA = "gentle-ai.review-integration.capabilities/v2.2" as const;
export const GENTLE_REVIEW_STATUS_SCHEMA = "gentle-ai.review-integration.status/v5" as const;

export interface GentleReviewObservation {
  readonly schema: typeof GENTLE_REVIEW_OBSERVATION_SCHEMA;
  readonly toolName: "gentle_review";
  readonly kind: "inferential_review";
  readonly engine: {
    readonly name: "gentle-ai";
    readonly version: string;
    readonly releaseChannel: "stable" | "prerelease";
    readonly executableDigest: string;
  };
  readonly contract: {
    readonly id: typeof GENTLE_REVIEW_CONTRACT;
    readonly protocol: { readonly major: 2; readonly minor: 2 };
    readonly capabilitiesSchema: typeof GENTLE_REVIEW_CAPABILITIES_SCHEMA;
    readonly statusSchema: typeof GENTLE_REVIEW_STATUS_SCHEMA;
  };
  readonly candidate: {
    readonly targetIdentity: string;
    readonly projection: "workspace";
    readonly baseTree: string;
    readonly candidateTree: string;
    readonly pathsDigest: string;
    readonly paths: readonly string[];
  };
  readonly authority: {
    readonly lineageId: string;
    readonly state: string;
    readonly generation: number;
    readonly revision: string;
  };
  readonly outcome: {
    readonly applicability: string;
    readonly action: string;
    readonly replayability: string;
    readonly nextTransition?: { readonly kind: "execute" | "collect" | "stop"; readonly reasonCode: string };
  };
  readonly findings: readonly [];
  readonly establishes: readonly [];
}

export function gentleReviewObservation(
  value: Omit<GentleReviewObservation, "schema" | "toolName" | "kind" | "contract" | "findings" | "establishes">,
): GentleReviewObservation {
  return parseGentleReviewObservation({
    schema: GENTLE_REVIEW_OBSERVATION_SCHEMA,
    toolName: "gentle_review",
    kind: "inferential_review",
    contract: {
      id: GENTLE_REVIEW_CONTRACT,
      protocol: { major: 2, minor: 2 },
      capabilitiesSchema: GENTLE_REVIEW_CAPABILITIES_SCHEMA,
      statusSchema: GENTLE_REVIEW_STATUS_SCHEMA,
    },
    findings: [],
    establishes: [],
    ...value,
  });
}

export function parseGentleReviewObservation(value: unknown): GentleReviewObservation {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      [
        "schema",
        "toolName",
        "kind",
        "engine",
        "contract",
        "candidate",
        "authority",
        "outcome",
        "findings",
        "establishes",
      ],
    )
  )
    throw new Error("Gentle review observation has an invalid shape or extra field");
  if (
    value.schema !== GENTLE_REVIEW_OBSERVATION_SCHEMA ||
    value.toolName !== "gentle_review" ||
    value.kind !== "inferential_review"
  )
    throw new Error("Gentle review observation identity is invalid");
  const engine = parseEngine(value.engine);
  parseContract(value.contract);
  const candidate = parseCandidate(value.candidate);
  const authority = parseAuthority(value.authority);
  const outcome = parseOutcome(value.outcome);
  if (
    !Array.isArray(value.findings) ||
    value.findings.length !== 0 ||
    !Array.isArray(value.establishes) ||
    value.establishes.length !== 0
  )
    throw new Error("Gentle review findings and establishes must be empty for status observations");
  return Object.freeze({
    schema: GENTLE_REVIEW_OBSERVATION_SCHEMA,
    toolName: "gentle_review",
    kind: "inferential_review",
    engine: Object.freeze(engine),
    contract: Object.freeze({
      id: GENTLE_REVIEW_CONTRACT,
      protocol: Object.freeze({ major: 2 as const, minor: 2 as const }),
      capabilitiesSchema: GENTLE_REVIEW_CAPABILITIES_SCHEMA,
      statusSchema: GENTLE_REVIEW_STATUS_SCHEMA,
    }),
    candidate: Object.freeze({ ...candidate, paths: Object.freeze([...candidate.paths]) }),
    authority: Object.freeze(authority),
    outcome: Object.freeze({
      ...outcome,
      ...(outcome.nextTransition === undefined ? {} : { nextTransition: Object.freeze(outcome.nextTransition) }),
    }),
    findings: Object.freeze([]) as readonly [],
    establishes: Object.freeze([]) as readonly [],
  });
}

export function isGentleReviewObservation(value: unknown): value is GentleReviewObservation {
  try {
    parseGentleReviewObservation(value);
    return true;
  } catch {
    return false;
  }
}

function parseEngine(value: unknown): GentleReviewObservation["engine"] {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["name", "version", "releaseChannel", "executableDigest"]) ||
    value.name !== "gentle-ai" ||
    !isVersion(value.version) ||
    (value.releaseChannel !== "stable" && value.releaseChannel !== "prerelease") ||
    !isDigest(value.executableDigest)
  )
    throw new Error("Gentle review engine identity is invalid");
  return {
    name: "gentle-ai",
    version: value.version,
    releaseChannel: value.releaseChannel,
    executableDigest: value.executableDigest,
  };
}
function parseContract(value: unknown): void {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["id", "protocol", "capabilitiesSchema", "statusSchema"]) ||
    value.id !== GENTLE_REVIEW_CONTRACT ||
    value.capabilitiesSchema !== GENTLE_REVIEW_CAPABILITIES_SCHEMA ||
    value.statusSchema !== GENTLE_REVIEW_STATUS_SCHEMA ||
    !isRecord(value.protocol) ||
    !hasOnlyKeys(value.protocol, ["major", "minor"]) ||
    value.protocol.major !== 2 ||
    value.protocol.minor !== 2
  )
    throw new Error("Gentle review contract identity is invalid");
}
function parseCandidate(value: unknown): GentleReviewObservation["candidate"] {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["targetIdentity", "projection", "baseTree", "candidateTree", "pathsDigest", "paths"]) ||
    !isDigest(value.targetIdentity) ||
    value.projection !== "workspace" ||
    !isTree(value.baseTree) ||
    !isTree(value.candidateTree) ||
    !isDigest(value.pathsDigest) ||
    !Array.isArray(value.paths) ||
    value.paths.length > 1000 ||
    value.paths.some((path) => !isPortablePath(path))
  )
    throw new Error("Gentle review candidate binding is invalid");
  return {
    targetIdentity: value.targetIdentity,
    projection: "workspace",
    baseTree: value.baseTree,
    candidateTree: value.candidateTree,
    pathsDigest: value.pathsDigest,
    paths: [...value.paths] as string[],
  };
}
function parseAuthority(value: unknown): NonNullable<GentleReviewObservation["authority"]> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["lineageId", "state", "generation", "revision"]) ||
    !isText(value.lineageId) ||
    !isText(value.state) ||
    !isPositiveInteger(value.generation) ||
    !isDigest(value.revision)
  )
    throw new Error("Gentle review authority identity is invalid");
  return { lineageId: value.lineageId, state: value.state, generation: value.generation, revision: value.revision };
}
function parseOutcome(value: unknown): GentleReviewObservation["outcome"] {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["applicability", "action", "replayability"], ["nextTransition"]) ||
    !isText(value.applicability) ||
    !isText(value.action) ||
    !isText(value.replayability)
  )
    throw new Error("Gentle review outcome is invalid");
  const transition = value.nextTransition;
  if (transition === undefined)
    return { applicability: value.applicability, action: value.action, replayability: value.replayability };
  if (
    !isRecord(transition) ||
    !hasOnlyKeys(transition, ["kind", "reasonCode"]) ||
    (transition.kind !== "execute" && transition.kind !== "collect" && transition.kind !== "stop") ||
    typeof transition.reasonCode !== "string" ||
    !/^[a-z0-9_]+$/u.test(transition.reasonCode)
  )
    throw new Error("Gentle review next transition is invalid");
  return {
    applicability: value.applicability,
    action: value.action,
    replayability: value.replayability,
    nextTransition: { kind: transition.kind, reasonCode: transition.reasonCode },
  };
}
function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4000 && value.trim() === value;
}
function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}
function isTree(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/u.test(value);
}
function isVersion(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(value);
}
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function isPortablePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}
