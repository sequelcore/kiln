import { Ajv2020 } from "ajv/dist/2020.js";
import { isProxy } from "node:util/types";
import { sha256ContentIdentity } from "../content-addressing/content-identity.js";

/** The JSON Schema dialect used by capability declarations. */
export const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema" as const;

/** Revision for the canonical capability JSON-Schema digest contract. */
export const CAPABILITY_JSON_SCHEMA_DIGEST_REVISION = "kiln.capability-json-schema/v1" as const;

/** A schema digest is content identity, not a provider or adapter identity. */
export type CapabilityJsonSchemaDigest = `sha256:${string}`;

/** Explicit sentinels for schema absence; neither is the digest of `{}`. */
export const CAPABILITY_INPUT_SCHEMA_ABSENT_DIGEST = sha256ContentIdentity(
  `${CAPABILITY_JSON_SCHEMA_DIGEST_REVISION}/input/absent`,
) as CapabilityJsonSchemaDigest;
export const CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST = sha256ContentIdentity(
  `${CAPABILITY_JSON_SCHEMA_DIGEST_REVISION}/output/absent`,
) as CapabilityJsonSchemaDigest;

/** Reference handling posture for an already-settled capability schema. */
export type JsonSchemaReferencePolicy = "internal-only" | "none";

/** Stable failure categories returned by JSON Schema safety inspection. */
export type JsonSchemaSafetyReason =
  | "malformed"
  | "limits"
  | "reference"
  | "secret"
  | "prompt-injection";

/** Bounded inspection limits. All values are inclusive maxima. */
export interface JsonSchemaSafetyLimits {
  readonly maxBytes: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxStringUnits: number;
}

/** Options controlling one JSON Schema safety inspection. */
export interface JsonSchemaSafetyOptions extends Partial<JsonSchemaSafetyLimits> {
  /** Whether a schema root must declare `type: "object"`. */
  readonly requireObjectType?: boolean;
  /** Whether fragment-only references may remain in the settled schema. */
  readonly referencePolicy?: JsonSchemaReferencePolicy;
  /** Whether `$schema` must explicitly identify JSON Schema 2020-12. */
  readonly requireSchemaDialect?: boolean;
}

export const DEFAULT_JSON_SCHEMA_SAFETY_LIMITS: JsonSchemaSafetyLimits = Object.freeze({
  maxBytes: 256 * 1024,
  maxNodes: 4_096,
  maxDepth: 32,
  maxStringUnits: 131_072,
});

export interface JsonSchemaSafetySuccess {
  readonly ok: true;
  /** An inert null-prototype clone; the caller never receives the source object. */
  readonly value: Readonly<Record<string, unknown>>;
}

export interface JsonSchemaSafetyFailure {
  readonly ok: false;
  readonly reason: JsonSchemaSafetyReason;
}

export type JsonSchemaSafetyResult = JsonSchemaSafetySuccess | JsonSchemaSafetyFailure;

export type CapabilityJsonSchemaDirection = "input" | "output";

export type CapabilityJsonSchemaDigestResult =
  | {
    readonly ok: true;
    readonly present: true;
    readonly value: Readonly<Record<string, unknown>>;
    readonly digest: CapabilityJsonSchemaDigest;
  }
  | {
    readonly ok: true;
    readonly present: false;
    readonly digest: CapabilityJsonSchemaDigest;
  }
  | JsonSchemaSafetyFailure;

const JSON_SCHEMA_VALIDATOR = new Ajv2020({
  allErrors: false,
  strict: false,
  validateFormats: false,
});

const REFERENCE_KEYS = new Set(["$ref", "$dynamicRef", "$recursiveRef"]);
const SCHEMA_MAP_KEYS = new Set(["$defs", "definitions", "dependentSchemas", "patternProperties", "properties"]);
const SCHEMA_VALUE_KEYS = new Set([
  "additionalItems",
  "additionalProperties",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);
const SCHEMA_ARRAY_KEYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const ACTUAL_VALUE_KEYS = new Set(["const", "default", "enum", "example", "examples"]);
const PROPERTY_NAME_ARRAY_KEYS = new Set(["dependentRequired", "required"]);

// These patterns intentionally track capability-catalog secret inspection. The
// JSON Schema adapter must not silently admit a declaration that the catalog
// later rejects, while schema property names are handled separately below.
const SECRET_KEY_PATTERN = /(?:^|[_-])(authorization|cookie|credential|password|passwd|private[_-]?key|secret|token|api[_-]?key|access[_-]?key|command|endpoint|environment|env|path)(?:$|[_-])/iu;
const SECRET_COMPACT_KEYS = new Set([
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "password",
  "passwd",
  "privatekey",
  "secret",
  "token",
  "apitoken",
  "apikey",
  "accesskey",
  "command",
  "endpoint",
  "environment",
  "env",
  "path",
]);
const SECRET_VALUE_PATTERNS = [
  /(?:^|[._:/+\-])Bearer\s+\S+/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?:^|[._:/+\-])[a-z][a-z0-9+.-]*:\/\/[^/@\s]+:[^/@\s]+@/iu,
  /(?:^|[._:/+\-])(?:sk|pk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{8,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])AIza[0-9A-Za-z_-]{20,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])glpat-[0-9A-Za-z_-]{10,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])xox[baprs]-[0-9A-Za-z-]{10,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])AKIA[0-9A-Z]{16}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?=$|[.:/+])/u,
  /(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/iu,
] as const;

const PROMPT_INJECTION_PATTERNS = [
  /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|system|developer)\s+(?:instructions?|rules?)/iu,
  /(?:reveal|exfiltrat(?:e|ion|ing)?|dump|print|show|repeat)\s+(?:the\s+)?(?:secret|token|credential|system prompt|hidden prompt|instructions?|rules?|guidelines?)/iu,
  /(?:you are now|act as|pretend to be)\s+(?:an?\s+)?(?:system|developer|assistant|admin|unrestricted)/iu,
  /<\/?(?:system|developer|assistant|instructions?)\b[^>]*>/iu,
  /(?:system\s+override|new\s+(?:system\s+)?instructions?)\s*:/iu,
  /(?:jailbreak|prompt\s+injection)/iu,
  /\[(?:INST|SYS)\]/u,
  /<\|(?:system|developer|assistant|user)\|>/u,
] as const;

interface NormalizedOptions {
  readonly limits: JsonSchemaSafetyLimits;
  readonly requireObjectType: boolean;
  readonly referencePolicy: JsonSchemaReferencePolicy;
  readonly requireSchemaDialect: boolean;
}

interface InspectionFlags {
  reference: boolean;
  secret: boolean;
  promptInjection: boolean;
}

type InspectionContext = "schema" | "schema-map" | "data" | "property-names";

class CloneFailure extends TypeError {
  constructor(readonly reason: "malformed" | "limits") {
    super(`JSON Schema source is ${reason}.`);
  }
}

/**
 * Clone and validate one untrusted JSON Schema declaration.
 *
 * The source is inspected through property descriptors only. Accessors,
 * executable values, cycles, proxies that cannot be inspected safely, and
 * exotic objects are rejected before any schema policy is applied. The
 * returned object is a null-prototype clone containing only inert data.
 */
export function validateJsonSchemaSafety(
  value: unknown,
  options: JsonSchemaSafetyOptions = {},
): JsonSchemaSafetyResult {
  const normalized = normalizeOptions(options);
  let cloned: unknown;
  try {
    cloned = cloneInert(value, normalized.limits);
  } catch (error) {
    return { ok: false, reason: error instanceof CloneFailure ? error.reason : "malformed" };
  }
  if (!isPlainRecord(cloned)) return { ok: false, reason: "malformed" };

  let serialized: string;
  try {
    serialized = stableStringify(cloned);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (byteLength(serialized) > normalized.limits.maxBytes) return { ok: false, reason: "limits" };

  const flags: InspectionFlags = { reference: false, secret: false, promptInjection: false };
  inspectContent(cloned, "schema", false, flags, normalized.referencePolicy);
  if (flags.reference) return { ok: false, reason: "reference" };
  if (flags.promptInjection) return { ok: false, reason: "prompt-injection" };
  if (flags.secret) return { ok: false, reason: "secret" };

  if (normalized.requireSchemaDialect && cloned.$schema !== JSON_SCHEMA_2020_12) {
    return { ok: false, reason: "malformed" };
  }
  if (cloned.$schema !== undefined && cloned.$schema !== JSON_SCHEMA_2020_12) {
    return { ok: false, reason: "malformed" };
  }
  if (normalized.requireObjectType && cloned.type !== "object") {
    return { ok: false, reason: "malformed" };
  }

  try {
    if (!JSON_SCHEMA_VALIDATOR.validateSchema(cloned)) return { ok: false, reason: "malformed" };
  } catch {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, value: cloned };
}

/**
 * Validate, normalize, and digest one capability schema through the shared
 * safety boundary. `present: false` is the only representation of absence;
 * an explicitly present `undefined` value is malformed. Descriptions and
 * source-facing tags are annotations and are excluded from the digest while
 * remaining accepted by the safety validator.
 */
export function normalizeAndDigestCapabilityJsonSchema(
  value: unknown,
  direction: CapabilityJsonSchemaDirection,
  options: JsonSchemaSafetyOptions & { readonly present?: boolean } = {},
): CapabilityJsonSchemaDigestResult {
  const present = options.present ?? value !== undefined;
  if (!present) {
    return {
      ok: true,
      present: false,
      digest: direction === "input"
        ? CAPABILITY_INPUT_SCHEMA_ABSENT_DIGEST
        : CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
    };
  }
  const checked = validateJsonSchemaSafety(value, options);
  if (!checked.ok) return checked;
  return {
    ok: true,
    present: true,
    value: checked.value,
    digest: sha256ContentIdentity(canonicalSchemaStringify(checked.value)) as CapabilityJsonSchemaDigest,
  };
}

/** Digest a validated schema value without reintroducing adapter-local rules. */
export function digestNormalizedCapabilityJsonSchema(
  value: Readonly<Record<string, unknown>>,
): CapabilityJsonSchemaDigest {
  return sha256ContentIdentity(canonicalSchemaStringify(value)) as CapabilityJsonSchemaDigest;
}

function normalizeOptions(options: JsonSchemaSafetyOptions): NormalizedOptions {
  const limits = {
    maxBytes: options.maxBytes ?? DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxBytes,
    maxNodes: options.maxNodes ?? DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxNodes,
    maxDepth: options.maxDepth ?? DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxDepth,
    maxStringUnits: options.maxStringUnits ?? DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxStringUnits,
  };
  for (const limit of Object.values(limits)) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("JSON Schema safety limits must be positive safe integers.");
  }
  return {
    limits,
    requireObjectType: options.requireObjectType ?? false,
    referencePolicy: options.referencePolicy ?? "none",
    requireSchemaDialect: options.requireSchemaDialect ?? false,
  };
}

function cloneInert(value: unknown, limits: JsonSchemaSafetyLimits): Readonly<Record<string, unknown>> {
  const seen = new WeakSet<object>();
  let nodes = 0;
  let stringUnits = 0;

  const visit = (current: unknown, depth: number): unknown => {
    if (++nodes > limits.maxNodes || depth > limits.maxDepth) throw new CloneFailure("limits");
    if (typeof current === "string") {
      stringUnits += current.length;
      if (stringUnits > limits.maxStringUnits) throw new CloneFailure("limits");
      return current;
    }
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new CloneFailure("malformed");
      return current;
    }
    if (current === undefined || typeof current !== "object") throw new CloneFailure("malformed");
    if (isProxy(current)) throw new CloneFailure("malformed");
    if (seen.has(current)) throw new CloneFailure("malformed");
    seen.add(current);

    let prototype: object | null;
    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    let array = false;
    try {
      array = Array.isArray(current);
      prototype = Object.getPrototypeOf(current);
      descriptors = Object.getOwnPropertyDescriptors(current);
    } catch {
      throw new CloneFailure("malformed");
    }

    if (array) {
      if (prototype !== Array.prototype) throw new CloneFailure("malformed");
      const lengthDescriptor = descriptors.length;
      const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
      if (!lengthDescriptor || !("value" in lengthDescriptor)
        || typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
        throw new CloneFailure("malformed");
      }
      if (length > limits.maxNodes) throw new CloneFailure("limits");
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key !== "string" || (key !== "length" && !isArrayIndexKey(key)))) {
        throw new CloneFailure("malformed");
      }
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new CloneFailure("malformed");
        result.push(visit(descriptor.value, depth + 1));
      }
      if (keys.length !== length + 1) throw new CloneFailure("malformed");
      return result;
    }

    if (prototype !== Object.prototype && prototype !== null) throw new CloneFailure("malformed");
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > limits.maxNodes || keys.some((key) => typeof key !== "string")) throw new CloneFailure("malformed");
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      stringUnits += key.length;
      if (stringUnits > limits.maxStringUnits) throw new CloneFailure("limits");
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) throw new CloneFailure("malformed");
      Object.defineProperty(result, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  };

  const cloned = visit(value, 0);
  if (!isPlainRecord(cloned)) throw new CloneFailure("malformed");
  return cloned;
}

function inspectContent(
  value: unknown,
  context: InspectionContext,
  sensitiveProperty: boolean,
  flags: InspectionFlags,
  referencePolicy: JsonSchemaReferencePolicy,
): void {
  if (typeof value === "string") {
    if (isPromptInjection(value)) flags.promptInjection = true;
    if (isSecretValue(value)) flags.secret = true;
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) inspectContent(entry, context, sensitiveProperty, flags, referencePolicy);
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const schemaObject = context === "schema";
    const referenceKey = schemaObject && REFERENCE_KEYS.has(key);
    if (referenceKey && !isAdmittedReference(entry, referencePolicy)) flags.reference = true;

    const structuralKey = schemaObject && isStructuralSchemaKey(key);
    const actualValueKey = schemaObject && ACTUAL_VALUE_KEYS.has(key);
    if (schemaObject && !structuralKey && !actualValueKey && isSecretKey(key)) flags.secret = true;
    if (context === "data" && isSecretKey(key)) flags.secret = true;

    const childContext = childContextFor(context, key);
    const childSensitiveProperty = sensitiveProperty
      || (context === "schema-map" && isSecretKey(key));
    if (actualValueKey && sensitiveProperty && hasActualValue(entry)) flags.secret = true;
    inspectContent(entry, childContext, childSensitiveProperty, flags, referencePolicy);
  }
}

function childContextFor(context: InspectionContext, key: string): InspectionContext {
  if (context === "schema" && SCHEMA_MAP_KEYS.has(key)) return "schema-map";
  if (context === "schema" && ACTUAL_VALUE_KEYS.has(key)) return "data";
  if (context === "schema" && PROPERTY_NAME_ARRAY_KEYS.has(key)) return "property-names";
  if (context === "schema" && (SCHEMA_VALUE_KEYS.has(key) || SCHEMA_ARRAY_KEYS.has(key))) return "schema";
  if (context === "schema-map") return "schema";
  return context;
}

function isStructuralSchemaKey(key: string): boolean {
  return REFERENCE_KEYS.has(key)
    || SCHEMA_MAP_KEYS.has(key)
    || SCHEMA_VALUE_KEYS.has(key)
    || SCHEMA_ARRAY_KEYS.has(key)
    || key === "type"
    || key === "required"
    || key === "dependentRequired"
    || key === "$schema"
    || key === "$id"
    || key === "$anchor"
    || key === "$dynamicAnchor"
    || key === "$vocabulary"
    || key === "title"
    || key === "description"
    || key === "$comment"
    || key === "format"
    || key === "pattern"
    || key === "minLength"
    || key === "maxLength"
    || key === "patternProperties"
    || key === "readOnly"
    || key === "writeOnly"
    || key === "deprecated"
    || key === "minProperties"
    || key === "maxProperties"
    || key === "minItems"
    || key === "maxItems"
    || key === "uniqueItems"
    || key === "multipleOf"
    || key === "minimum"
    || key === "maximum"
    || key === "exclusiveMinimum"
    || key === "exclusiveMaximum"
    || key === "minContains"
    || key === "maxContains"
    || key === "contentEncoding"
    || key === "contentMediaType";
}

function isAdmittedReference(value: unknown, referencePolicy: JsonSchemaReferencePolicy): boolean {
  if (referencePolicy === "none") return false;
  return typeof value === "string" && value.startsWith("#");
}

function hasActualValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key) || SECRET_COMPACT_KEYS.has(key.replace(/[^A-Za-z]/gu, "").toLowerCase());
}

function isSecretValue(value: string): boolean {
  return value.length > 4_096 || SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function isPromptInjection(value: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

function isArrayIndexKey(value: string): boolean {
  return /^(?:0|[1-9]\d*)$/u.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!isPlainRecord(value)) throw new TypeError("JSON Schema clone is not plain data.");
  const entries = Object.entries(value)
    .sort(([left], [right]) => compareCodeUnits(left, right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

/**
 * Canonical schema serialization used only for schema content identity.
 * Object keys follow UTF-16 code-unit ordering and descriptive source
 * annotations do not change the schema digest.
 */
type CanonicalSchemaContext = "schema" | "schema-map" | "data";

function canonicalSchemaStringify(value: unknown, context: CanonicalSchemaContext = "schema"): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalSchemaStringify(entry, context)).join(",")}]`;
  if (!isPlainRecord(value)) throw new TypeError("JSON Schema value is not plain data.");
  const entries = Object.entries(value)
    .filter(([key]) => context !== "schema" || (key !== "description" && key !== "tags"))
    .sort(([left], [right]) => compareCodeUnits(left, right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalSchemaStringify(entry, canonicalSchemaChildContext(context, key))}`).join(",")}}`;
}

function canonicalSchemaChildContext(context: CanonicalSchemaContext, key: string): CanonicalSchemaContext {
  if (context !== "schema") return context === "schema-map" ? "schema" : "data";
  if (SCHEMA_MAP_KEYS.has(key)) return "schema-map";
  if (ACTUAL_VALUE_KEYS.has(key)) return "data";
  if (SCHEMA_VALUE_KEYS.has(key) || SCHEMA_ARRAY_KEYS.has(key)) return "schema";
  return "data";
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function compareCodeUnits(left: string, right: string): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}
