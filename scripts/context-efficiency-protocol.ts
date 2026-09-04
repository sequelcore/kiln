import { createHash } from "node:crypto";

export const CONTEXT_EFFICIENCY_MANIFEST_SCHEMA_VERSION =
  "kiln-context-efficiency-post-fix-manifest-v1" as const;
export const CONTEXT_EFFICIENCY_PROTOCOL_DIGEST_METHOD =
  "sha256 of canonical claim, identity, design, tasks, evidence, gates, and retention with the protocol digest fields omitted" as const;

export type ContextEfficiencyJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ContextEfficiencyJsonValue[]
  | { readonly [key: string]: ContextEfficiencyJsonValue | undefined };

type ContextEfficiencyJsonObject = { readonly [key: string]: ContextEfficiencyJsonValue | undefined };

export interface ContextEfficiencyRuntimeIdentity {
  readonly targetId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly deliberationLevel: string;
  readonly fallback: string;
  readonly mcp: string;
  readonly concurrency: number;
}

export interface ContextEfficiencyFreshAccountPolicy {
  readonly plan: string;
  readonly evidenceState: "fresh";
  readonly allowedAccountIds: readonly string[];
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly source: string;
  readonly confidence: string;
}

export interface ContextEfficiencyHardwareIdentity {
  readonly platform: string;
  readonly architecture: string;
  readonly cpuModel: string;
  readonly logicalCpuCount: number;
  readonly totalMemoryBytes: number;
}

export interface ContextEfficiencyExecutionIdentityOverrides {
  readonly startingCommit: string;
  readonly sourceContractDigest: string;
  readonly sourceContractPaths: readonly string[];
  readonly inputContractDigest: string;
  readonly inputContractPaths: readonly string[];
  readonly compiledContractDigest: string;
  readonly compiledContractPaths: readonly string[];
  readonly configurationRevisionId: string;
  readonly bunVersion: string;
  readonly toolProjectionRecipeDigest: string;
  readonly toolFixtureSeed: string;
  readonly runtime: ContextEfficiencyRuntimeIdentity;
  readonly plusAccountPolicy: ContextEfficiencyFreshAccountPolicy;
  readonly hardware: ContextEfficiencyHardwareIdentity;
}

export interface ContextEfficiencyFrozenProtocolManifest {
  readonly schemaVersion: typeof CONTEXT_EFFICIENCY_MANIFEST_SCHEMA_VERSION;
  readonly status: "frozen_uncollected";
  readonly claim: ContextEfficiencyJsonObject;
  readonly identity: {
    readonly repository: string;
    readonly startingCommit: string;
    readonly configurationRevisionId: string;
    readonly protocolContractDigest: string;
    readonly protocolContractDigestMethod: typeof CONTEXT_EFFICIENCY_PROTOCOL_DIGEST_METHOD;
    readonly sourceContractDigest: string;
    readonly sourceContractDigestMethod: string;
    readonly sourceContractPaths: readonly string[];
    readonly inputContractDigest: string;
    readonly inputContractDigestMethod: string;
    readonly inputContractPaths: readonly string[];
    readonly compiledContractDigest: string;
    readonly compiledContractPaths: readonly string[];
    readonly targetId: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly deliberationLevel: string;
    readonly fallback: string;
    readonly mcp: string;
    readonly concurrency: number;
    readonly bunVersion: string;
    readonly toolProjectionRecipeDigest: string;
    readonly toolFixtureSeed: string;
    readonly plusAccountPolicy: ContextEfficiencyFreshAccountPolicy;
    readonly hardware: ContextEfficiencyHardwareIdentity;
  };
  readonly design: ContextEfficiencyJsonObject;
  readonly tasks: readonly ContextEfficiencyJsonValue[];
  readonly requiredPerPhysicalRequestEvidence: readonly ContextEfficiencyJsonValue[];
  readonly hardGates: readonly ContextEfficiencyJsonValue[];
  readonly retention: ContextEfficiencyJsonObject;
  readonly collectionReadiness: {
    readonly status: "frozen_uncollected";
    readonly missing: readonly string[];
    readonly priorAttempts: readonly [];
  };
}

/**
 * Canonical JSON hash shared by freezing, verification, and report binding.
 * This deliberately matches the existing diagnostic stableStringify behavior:
 * array order is retained; object keys use localeCompare; undefined object
 * fields are omitted.
 */
export function digestContextEfficiencyCanonicalValue(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(parseJsonValue(value, "canonical digest input")), "utf8").digest("hex")}`;
}

/** Selects exactly the fields covered by the current source-contract verifier. */
export function digestContextEfficiencyProtocol(manifest: unknown): string {
  return digestContextEfficiencyCanonicalValue(selectProtocolContract(manifest));
}

/**
 * Freezes a preregistered template with fresh execution evidence. Collection
 * history is intentionally discarded: it belongs to the old cohort and can
 * never be repurposed as a new control result.
 */
export function freezeContextEfficiencyProtocol(input: {
  readonly template: unknown;
  readonly execution: ContextEfficiencyExecutionIdentityOverrides;
  readonly now?: Date;
}): ContextEfficiencyFrozenProtocolManifest {
  const template = parseTemplate(input.template);
  assertExecutionIdentity(input.execution, input.now ?? new Date());
  const identityWithoutDigest = {
    repository: template.repository,
    startingCommit: input.execution.startingCommit,
    configurationRevisionId: input.execution.configurationRevisionId,
    sourceContractDigest: input.execution.sourceContractDigest,
    sourceContractDigestMethod: "sha256 of sorted '<path> <git-blob-id>' rows for the frozen source contract",
    sourceContractPaths: [...input.execution.sourceContractPaths],
    inputContractDigest: input.execution.inputContractDigest,
    inputContractDigestMethod: "sha256 of sorted '<path> <git-blob-id>' rows for committed benchmark inputs and fixtures",
    inputContractPaths: [...input.execution.inputContractPaths],
    compiledContractDigest: input.execution.compiledContractDigest,
    compiledContractPaths: [...input.execution.compiledContractPaths],
    targetId: input.execution.runtime.targetId,
    providerId: input.execution.runtime.providerId,
    modelId: input.execution.runtime.modelId,
    deliberationLevel: input.execution.runtime.deliberationLevel,
    fallback: input.execution.runtime.fallback,
    mcp: input.execution.runtime.mcp,
    concurrency: input.execution.runtime.concurrency,
    bunVersion: input.execution.bunVersion,
    toolProjectionRecipeDigest: input.execution.toolProjectionRecipeDigest,
    toolFixtureSeed: input.execution.toolFixtureSeed,
    plusAccountPolicy: input.execution.plusAccountPolicy,
    hardware: input.execution.hardware,
  };
  const unsigned = {
    schemaVersion: CONTEXT_EFFICIENCY_MANIFEST_SCHEMA_VERSION,
    status: "frozen_uncollected" as const,
    claim: template.claim,
    identity: {
      ...identityWithoutDigest,
      protocolContractDigest: "sha256:pending",
      protocolContractDigestMethod: CONTEXT_EFFICIENCY_PROTOCOL_DIGEST_METHOD,
    },
    design: template.design,
    tasks: template.tasks,
    requiredPerPhysicalRequestEvidence: template.requiredPerPhysicalRequestEvidence,
    hardGates: template.hardGates,
    retention: template.retention,
    collectionReadiness: {
      status: "frozen_uncollected" as const,
      missing: [] as const,
      priorAttempts: [] as const,
    },
  };
  const protocolContractDigest = digestContextEfficiencyProtocol(unsigned);
  return {
    ...unsigned,
    identity: { ...unsigned.identity, protocolContractDigest },
  };
}

function selectProtocolContract(manifest: unknown): ContextEfficiencyJsonObject {
  const record = requireObject(manifest, "context-efficiency manifest");
  const identity = requireObject(record.schemaVersion === CONTEXT_EFFICIENCY_MANIFEST_SCHEMA_VERSION
    ? record.identity
    : undefined, "context-efficiency manifest identity");
  const protocolIdentity = Object.fromEntries(Object.entries(identity)
    .filter(([key]) => key !== "protocolContractDigest" && key !== "protocolContractDigestMethod")
    .map(([key, value]) => [key, parseJsonValue(value, `identity.${key}`)]));
  return {
    schemaVersion: CONTEXT_EFFICIENCY_MANIFEST_SCHEMA_VERSION,
    claim: parseRequiredObject(record.claim, "context-efficiency claim"),
    identity: protocolIdentity,
    design: parseRequiredObject(record.design, "context-efficiency design"),
    tasks: parseRequiredArray(record.tasks, "context-efficiency tasks"),
    requiredPerPhysicalRequestEvidence: parseRequiredArray(
      record.requiredPerPhysicalRequestEvidence,
      "context-efficiency physical request evidence",
    ),
    hardGates: parseRequiredArray(record.hardGates, "context-efficiency hard gates"),
    retention: parseRequiredObject(record.retention, "context-efficiency retention"),
  };
}

function parseTemplate(value: unknown): {
  readonly repository: string;
  readonly claim: ContextEfficiencyJsonObject;
  readonly design: ContextEfficiencyJsonObject;
  readonly tasks: readonly ContextEfficiencyJsonValue[];
  readonly requiredPerPhysicalRequestEvidence: readonly ContextEfficiencyJsonValue[];
  readonly hardGates: readonly ContextEfficiencyJsonValue[];
  readonly retention: ContextEfficiencyJsonObject;
} {
  const record = requireObject(value, "context-efficiency preregistration template");
  if (record.schemaVersion !== CONTEXT_EFFICIENCY_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Expected '${CONTEXT_EFFICIENCY_MANIFEST_SCHEMA_VERSION}' preregistration template.`);
  }
  const identity = requireObject(record.identity, "context-efficiency preregistration identity");
  return {
    repository: requireString(identity.repository, "context-efficiency repository"),
    claim: parseRequiredObject(record.claim, "context-efficiency claim"),
    design: parseRequiredObject(record.design, "context-efficiency design"),
    tasks: parseRequiredArray(record.tasks, "context-efficiency tasks"),
    requiredPerPhysicalRequestEvidence: parseRequiredArray(
      record.requiredPerPhysicalRequestEvidence,
      "context-efficiency physical request evidence",
    ),
    hardGates: parseRequiredArray(record.hardGates, "context-efficiency hard gates"),
    retention: parseRequiredObject(record.retention, "context-efficiency retention"),
  };
}

function assertExecutionIdentity(identity: ContextEfficiencyExecutionIdentityOverrides, now: Date): void {
  if (Number.isNaN(now.getTime())) throw new Error("Freeze reference time must be valid.");
  assertCommit(identity.startingCommit);
  for (const [label, value] of [
    ["source contract", identity.sourceContractDigest],
    ["input contract", identity.inputContractDigest],
    ["compiled contract", identity.compiledContractDigest],
    ["configuration revision", identity.configurationRevisionId],
    ["tool projection recipe", identity.toolProjectionRecipeDigest],
  ] as const) assertDigest(value, label);
  assertPathList(identity.sourceContractPaths, "source contract");
  assertPathList(identity.inputContractPaths, "input contract");
  assertPathList(identity.compiledContractPaths, "compiled contract");
  assertNonEmpty(identity.bunVersion, "Bun version");
  assertNonEmpty(identity.toolFixtureSeed, "tool fixture seed");
  for (const [label, value] of Object.entries(identity.runtime)) {
    if (label === "concurrency") {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Runtime concurrency must be a positive integer.");
    } else {
      assertNonEmpty(value, `runtime ${label}`);
    }
  }
  const policy = identity.plusAccountPolicy;
  if (policy.evidenceState !== "fresh") throw new Error("Account policy evidence must be fresh when freezing.");
  if (policy.plan !== "plus") throw new Error("Account policy plan must be plus when freezing.");
  assertPathList(policy.allowedAccountIds, "account policy account");
  const observedAt = parseTimestamp(policy.observedAt, "account policy observedAt");
  const expiresAt = parseTimestamp(policy.expiresAt, "account policy expiresAt");
  if (observedAt.getTime() > now.getTime()) throw new Error("Account policy observedAt cannot be in the future.");
  if (expiresAt.getTime() <= observedAt.getTime()) throw new Error("Account policy expiresAt must be after observedAt.");
  if (expiresAt.getTime() <= now.getTime()) throw new Error("Account policy evidence is expired.");
  if (policy.source !== "provider-endpoint") throw new Error("Account policy source must be provider-endpoint when freezing.");
  if (policy.confidence !== "authoritative") throw new Error("Account policy confidence must be authoritative when freezing.");
  for (const [label, value] of [
    ["hardware platform", identity.hardware.platform],
    ["hardware architecture", identity.hardware.architecture],
    ["hardware CPU model", identity.hardware.cpuModel],
  ] as const) assertNonEmpty(value, label);
  for (const [label, value] of [
    ["hardware logical CPU count", identity.hardware.logicalCpuCount],
    ["hardware total memory bytes", identity.hardware.totalMemoryBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseRequiredObject(value: unknown, label: string): ContextEfficiencyJsonObject {
  const record = requireObject(value, label);
  return parseJsonValue(record, label) as ContextEfficiencyJsonObject;
}

function parseRequiredArray(value: unknown, label: string): readonly ContextEfficiencyJsonValue[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((entry, index) => parseJsonValue(entry, `${label}[${index}]`));
}

function parseJsonValue(value: unknown, label: string): ContextEfficiencyJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} must contain only finite JSON numbers.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => parseJsonValue(entry, `${label}[${index}]`));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, parseJsonValue(entry, `${label}.${key}`)]));
  }
  throw new Error(`${label} must contain JSON-compatible values only.`);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function assertCommit(value: string): void {
  if (!/^[a-f0-9]{40}$/iu.test(value)) throw new Error("Starting commit must be a 40-character Git revision.");
}

function assertDigest(value: string, label: string): void {
  if (!/^sha256:[a-f0-9]{64}$/iu.test(value)) throw new Error(`${label} must be a SHA-256 digest.`);
}

function assertPathList(values: readonly string[], label: string): void {
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error(`${label} paths must be a non-empty unique list.`);
  }
  values.forEach((value) => assertNonEmpty(value, `${label} path`));
}

function assertNonEmpty(value: unknown, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be non-empty.`);
}

function parseTimestamp(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp with milliseconds.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a valid ISO-8601 UTC timestamp.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
