import { isProxy } from "node:util/types";

import { JSON_SCHEMA_2020_12 } from "./capability-json-schema-safety.js";

/** Provider-neutral identity of the bounded image-analysis capability. */
export const VISION_ANALYZE_CAPABILITY_ID = "vision.analyze" as const;

/** Revisioned wire contract returned by an admitted vision-analysis route. */
export const VISION_ANALYZE_CONTRACT = "vision.analyze/v1" as const;

/** Runtime materialization name for the provider-neutral capability. */
export const VISION_ANALYZE_TOOL_NAME = "vision_analyze" as const;

export const VISION_ANALYZE_MAX_RESOURCE_URIS = 16 as const;
export const VISION_ANALYZE_MAX_RESOURCE_URI_LENGTH = 512 as const;
export const VISION_ANALYZE_MAX_INSTRUCTION_LENGTH = 4_096 as const;
export const VISION_ANALYSIS_MAX_SUMMARY_LENGTH = 8_192 as const;
export const VISION_ANALYSIS_MAX_LIMITATIONS = 16 as const;
export const VISION_ANALYSIS_MAX_LIMITATION_LENGTH = 1_024 as const;
export const VISION_ANALYSIS_MAX_EVIDENCE_URIS = 32 as const;

const RESOURCE_URI_PATTERN = /^kiln:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(?:\/[A-Za-z0-9][A-Za-z0-9:._%~-]*)+$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

/** The strict, bounded input schema bound to `vision_analyze`. */
export const VISION_ANALYZE_INPUT_SCHEMA: Readonly<Record<string, unknown>> = deepFreeze({
  $schema: JSON_SCHEMA_2020_12,
  type: "object",
  properties: {
    resourceUris: {
      type: "array",
      minItems: 1,
      maxItems: VISION_ANALYZE_MAX_RESOURCE_URIS,
      uniqueItems: true,
      items: {
        type: "string",
        minLength: 1,
        maxLength: VISION_ANALYZE_MAX_RESOURCE_URI_LENGTH,
        pattern: RESOURCE_URI_PATTERN.source,
      },
    },
    instruction: {
      type: "string",
      minLength: 1,
      maxLength: VISION_ANALYZE_MAX_INSTRUCTION_LENGTH,
    },
  },
  required: ["resourceUris", "instruction"],
  additionalProperties: false,
});

/** The strict, bounded result schema returned by a completed analysis. */
export const VISION_ANALYSIS_OUTPUT_SCHEMA: Readonly<Record<string, unknown>> = deepFreeze({
  $schema: JSON_SCHEMA_2020_12,
  type: "object",
  properties: {
    status: { type: "string", const: "completed" },
    summary: {
      type: "string",
      minLength: 1,
      maxLength: VISION_ANALYSIS_MAX_SUMMARY_LENGTH,
    },
    uncertainty: { type: "number", minimum: 0, maximum: 1 },
    limitations: {
      type: "array",
      minItems: 0,
      maxItems: VISION_ANALYSIS_MAX_LIMITATIONS,
      uniqueItems: true,
      items: {
        type: "string",
        minLength: 1,
        maxLength: VISION_ANALYSIS_MAX_LIMITATION_LENGTH,
      },
    },
    evidenceUris: {
      type: "array",
      minItems: 0,
      maxItems: VISION_ANALYSIS_MAX_EVIDENCE_URIS,
      uniqueItems: true,
      items: {
        type: "string",
        minLength: 1,
        maxLength: VISION_ANALYZE_MAX_RESOURCE_URI_LENGTH,
        pattern: RESOURCE_URI_PATTERN.source,
      },
    },
  },
  required: ["status", "summary", "uncertainty", "limitations", "evidenceUris"],
  additionalProperties: false,
});

export interface VisionAnalyzeInput {
  readonly resourceUris: readonly string[];
  readonly instruction: string;
}

export interface VisionAnalysis {
  readonly status: "completed";
  readonly summary: string;
  readonly uncertainty: number;
  readonly limitations: readonly string[];
  readonly evidenceUris: readonly string[];
}

/** Parse and snapshot an untrusted request for a vision-capable child route. */
export function parseVisionAnalyzeInput(value: unknown): VisionAnalyzeInput {
  const record = snapshotRecord(value, "Vision analyze input");
  requireExactKeys(record, ["resourceUris", "instruction"], "Vision analyze input");

  return deepFreeze({
    resourceUris: parseResourceUris(record.resourceUris, VISION_ANALYZE_MAX_RESOURCE_URIS, "Vision analyze input resourceUris"),
    instruction: parseBoundedText(
      record.instruction,
      VISION_ANALYZE_MAX_INSTRUCTION_LENGTH,
      "Vision analyze input instruction",
    ),
  });
}

/** Parse and snapshot a completed, provider-neutral vision result. */
export function parseVisionAnalysis(value: unknown): VisionAnalysis {
  const record = snapshotRecord(value, "Vision analysis");
  requireExactKeys(
    record,
    ["status", "summary", "uncertainty", "limitations", "evidenceUris"],
    "Vision analysis",
  );
  if (record.status !== "completed") throw new TypeError("Vision analysis status must be completed.");

  const uncertainty = record.uncertainty;
  if (typeof uncertainty !== "number" || !Number.isFinite(uncertainty) || uncertainty < 0 || uncertainty > 1) {
    throw new TypeError("Vision analysis uncertainty must be a finite number between 0 and 1.");
  }

  return deepFreeze({
    status: "completed",
    summary: parseBoundedText(record.summary, VISION_ANALYSIS_MAX_SUMMARY_LENGTH, "Vision analysis summary"),
    uncertainty,
    limitations: parseBoundedStringList(
      record.limitations,
      VISION_ANALYSIS_MAX_LIMITATIONS,
      VISION_ANALYSIS_MAX_LIMITATION_LENGTH,
      "Vision analysis limitations",
    ),
    evidenceUris: parseResourceUris(
      record.evidenceUris,
      VISION_ANALYSIS_MAX_EVIDENCE_URIS,
      "Vision analysis evidenceUris",
      true,
    ),
  });
}

function parseResourceUris(value: unknown, maximum: number, field: string, allowEmpty = false): readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximum) {
    throw new TypeError(`${field} must contain ${allowEmpty ? "at most" : "between one and"} ${maximum} entries.`);
  }
  const normalized = value.map((entry) => parseResourceUri(entry, field));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${field} must contain unique URIs.`);
  return Object.freeze(normalized);
}

function parseBoundedStringList(
  value: unknown,
  maximumItems: number,
  maximumStringLength: number,
  field: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(`${field} must contain at most ${maximumItems} entries.`);
  }
  const normalized = value.map((entry) => parseBoundedText(entry, maximumStringLength, field));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${field} must contain unique values.`);
  return Object.freeze(normalized);
}

function parseResourceUri(value: unknown, field: string): string {
  const uri = parseBoundedText(value, VISION_ANALYZE_MAX_RESOURCE_URI_LENGTH, field);
  if (!RESOURCE_URI_PATTERN.test(uri)) throw new TypeError(`${field} contains a malformed kiln resource URI.`);
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new TypeError(`${field} contains a malformed kiln resource URI.`);
  }
  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  if (
    parsed.protocol !== "kiln:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.port !== ""
    || parsed.search !== ""
    || parsed.hash !== ""
    || pathSegments.length === 0
    || pathSegments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new TypeError(`${field} contains a malformed kiln resource URI.`);
  }
  try {
    for (const segment of pathSegments) {
      const decoded = decodeURIComponent(segment);
      if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")
        || CONTROL_CHARACTER_PATTERN.test(decoded)) {
        throw new TypeError(`${field} contains a malformed kiln resource URI.`);
      }
    }
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("malformed kiln resource URI")) throw error;
    throw new TypeError(`${field} contains a malformed kiln resource URI.`);
  }
  return uri;
}

function parseBoundedText(value: unknown, maximum: number, field: string): string {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new TypeError(`${field} must be a non-empty bounded string.`);
  }
  return normalized;
}

function snapshotRecord(value: unknown, field: string): Record<string, unknown> {
  const snapshot = snapshotPlainData(value, new WeakSet<object>(), 0, { nodes: 0, stringUnits: 0 });
  if (!isRecord(snapshot)) throw new TypeError(`${field} must be an inert plain object.`);
  return snapshot;
}

function snapshotPlainData(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  budget: SnapshotBudget,
): unknown {
  if (++budget.nodes > MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) {
    throw new TypeError("Vision analysis value exceeds snapshot bounds.");
  }
  if (typeof value === "string") {
    budget.stringUnits += value.length;
    if (budget.stringUnits > MAX_SNAPSHOT_STRING_UNITS) {
      throw new TypeError("Vision analysis value exceeds string bounds.");
    }
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Vision analysis value contains a non-finite number.");
    return value;
  }
  if (typeof value !== "object" || isProxy(value) || seen.has(value)) {
    throw new TypeError("Vision analysis value must contain only inert plain data.");
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const rawLength = lengthDescriptor?.value;
    if (!lengthDescriptor || !("value" in lengthDescriptor) || typeof rawLength !== "number"
      || !Number.isSafeInteger(rawLength) || rawLength < 0) {
      throw new TypeError("Vision analysis arrays must be dense plain data.");
    }
    const length = rawLength;
    if (length > MAX_SNAPSHOT_ARRAY_LENGTH) throw new TypeError("Vision analysis array exceeds bounds.");
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== length + 1
      || keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key)))
    ) {
      throw new TypeError("Vision analysis arrays must be dense plain data.");
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Vision analysis arrays must contain data properties only.");
      }
      result.push(snapshotPlainData(descriptor.value, seen, depth + 1, budget));
    }
    seen.delete(value);
    return result;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Vision analysis objects must be plain data.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError("Vision analysis objects must use string data keys.");
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Vision analysis objects must contain data properties only.");
    }
    result[key] = snapshotPlainData(descriptor.value, seen, depth + 1, budget);
  }
  seen.delete(value);
  return result;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new TypeError(`${field} contains an unknown or missing field.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

interface SnapshotBudget {
  nodes: number;
  stringUnits: number;
}

const MAX_SNAPSHOT_NODES = 256 as const;
const MAX_SNAPSHOT_DEPTH = 8 as const;
const MAX_SNAPSHOT_ARRAY_LENGTH = 64 as const;
const MAX_SNAPSHOT_STRING_UNITS = 32_768 as const;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    if (Array.isArray(value)) {
      for (const child of value) deepFreeze(child);
    } else {
      for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
