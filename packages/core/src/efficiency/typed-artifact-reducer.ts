import { createHash } from "node:crypto";

export type ArtifactExitStatus = number | null;
export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue };

interface TypedArtifactBase {
  readonly exitStatus: ArtifactExitStatus;
  readonly warnings: readonly string[];
}

export interface SearchArtifact extends TypedArtifactBase {
  readonly kind: "search";
  readonly entries: readonly {
    readonly id: string;
    readonly path: string;
    readonly line: number;
    readonly column: number;
    readonly match: string;
  }[];
}

export interface TreeArtifact extends TypedArtifactBase {
  readonly kind: "tree";
  readonly entries: readonly {
    readonly id: string;
    readonly path: string;
    readonly entryKind: "file" | "directory" | "symlink";
    readonly sizeBytes: number | null;
  }[];
}

export interface TableArtifact extends TypedArtifactBase {
  readonly kind: "table";
  readonly columns: readonly string[];
  readonly rows: readonly (readonly JsonScalar[])[];
}

export interface JsonArtifact extends TypedArtifactBase {
  readonly kind: "json";
  readonly value: JsonValue;
}

export interface TestArtifact extends TypedArtifactBase {
  readonly kind: "test";
  readonly entries: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: "passed" | "failed" | "skipped";
    readonly durationMs: number;
    readonly file: string;
    readonly line: number | null;
    readonly warning: string | null;
  }[];
}

export interface LogArtifact extends TypedArtifactBase {
  readonly kind: "log";
  readonly entries: readonly {
    readonly id: string;
    readonly severity: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
    readonly message: string;
    readonly timestamp: string | null;
    readonly source: string | null;
    readonly line: number | null;
  }[];
}

export interface RepositoryArtifact extends TypedArtifactBase {
  readonly kind: "repository";
  readonly entries: readonly {
    readonly id: string;
    readonly path: string;
    readonly changeType: "added" | "modified" | "deleted" | "renamed" | "untracked";
    readonly status: "tracked" | "staged" | "unstaged" | "conflicted";
    readonly linesAdded: number;
    readonly linesDeleted: number;
    readonly warning: string | null;
  }[];
}

export type TypedArtifact =
  | SearchArtifact
  | TreeArtifact
  | TableArtifact
  | JsonArtifact
  | TestArtifact
  | LogArtifact
  | RepositoryArtifact;

export type CanonicalProjectionReason =
  | "unknown-artifact-type"
  | "malformed-artifact"
  | "projection-not-beneficial";

export interface CanonicalArtifactProjection {
  readonly mode: "canonical";
  readonly reason: CanonicalProjectionReason;
  readonly canonicalArtifactUri: string;
  readonly canonicalArtifact: unknown;
}

export interface LosslessArtifactProjection {
  readonly mode: "lossless";
  readonly transformationMode: "lossless";
  readonly encoding: "kiln-columnar-json-v1";
  readonly artifactKind: TypedArtifact["kind"];
  readonly canonicalArtifactUri: string;
  readonly projection: string;
  readonly sourceHash: string;
  readonly projectionHash: string;
  readonly sourceBytes: number;
  readonly projectedBytes: number;
  readonly omittedCount: 0;
}

export type TypedArtifactProjection = CanonicalArtifactProjection | LosslessArtifactProjection;

export interface ReduceTypedArtifactInput {
  readonly artifact: unknown;
  readonly canonicalArtifactUri: string;
}

const KIND_CODES = {
  search: "s",
  tree: "t",
  table: "b",
  json: "j",
  test: "x",
  log: "l",
  repository: "r",
} as const;

const MINIMUM_REDUCTION_SOURCE_BYTES = 128;

export function reduceTypedArtifact(input: ReduceTypedArtifactInput): TypedArtifactProjection {
  const canonicalArtifactUri = input.canonicalArtifactUri.trim();
  if (canonicalArtifactUri.length === 0) {
    throw new Error("Typed artifact reduction requires a canonical artifact URI.");
  }
  const kind = readKind(input.artifact);
  if (!kind) return canonical(input, canonicalArtifactUri, "unknown-artifact-type");
  if (!isTypedArtifact(input.artifact, kind)) {
    return canonical(input, canonicalArtifactUri, "malformed-artifact");
  }

  const source = JSON.stringify(input.artifact);
  const projection = JSON.stringify(encodeArtifact(input.artifact));
  const sourceBytes = Buffer.byteLength(source, "utf8");
  const projectedBytes = Buffer.byteLength(projection, "utf8");
  if (sourceBytes < MINIMUM_REDUCTION_SOURCE_BYTES || projectedBytes >= sourceBytes) {
    return canonical(input, canonicalArtifactUri, "projection-not-beneficial");
  }
  return {
    mode: "lossless",
    transformationMode: "lossless",
    encoding: "kiln-columnar-json-v1",
    artifactKind: input.artifact.kind,
    canonicalArtifactUri,
    projection,
    sourceHash: hash(source),
    projectionHash: hash(projection),
    sourceBytes,
    projectedBytes,
    omittedCount: 0,
  };
}

export function restoreTypedArtifact(projection: LosslessArtifactProjection): TypedArtifact {
  if (hash(projection.projection) !== projection.projectionHash) {
    throw new Error("Lossless artifact projection hash mismatch.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(projection.projection);
  } catch {
    throw new Error("Lossless artifact projection is not valid JSON.");
  }
  const artifact = decodeArtifact(parsed);
  if (!artifact || artifact.kind !== projection.artifactKind) {
    throw new Error("Lossless artifact projection does not match its declared artifact kind.");
  }
  if (hash(JSON.stringify(artifact)) !== projection.sourceHash) {
    throw new Error("Lossless artifact source hash mismatch.");
  }
  return artifact;
}

function canonical(
  input: ReduceTypedArtifactInput,
  canonicalArtifactUri: string,
  reason: CanonicalProjectionReason,
): CanonicalArtifactProjection {
  return { mode: "canonical", reason, canonicalArtifactUri, canonicalArtifact: input.artifact };
}

function readKind(value: unknown): TypedArtifact["kind"] | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  return Object.prototype.hasOwnProperty.call(KIND_CODES, value.kind)
    ? value.kind as TypedArtifact["kind"]
    : undefined;
}

function isTypedArtifact(value: unknown, kind: TypedArtifact["kind"]): value is TypedArtifact {
  if (!isRecord(value) || !validBase(value)) return false;
  switch (kind) {
    case "search":
      return hasOnly(value, ["kind", "exitStatus", "warnings", "entries"])
        && validEntries(value.entries, ["id", "path", "line", "column", "match"], (entry) =>
          text(entry.id) && text(entry.path) && integer(entry.line) && integer(entry.column) && typeof entry.match === "string");
    case "tree":
      return hasOnly(value, ["kind", "exitStatus", "warnings", "entries"])
        && validEntries(value.entries, ["id", "path", "entryKind", "sizeBytes"], (entry) =>
          text(entry.id) && text(entry.path)
          && oneOf(entry.entryKind, ["file", "directory", "symlink"])
          && nullableNonNegativeInteger(entry.sizeBytes));
    case "table":
      return hasOnly(value, ["kind", "exitStatus", "warnings", "columns", "rows"])
        && Array.isArray(value.columns) && value.columns.every(text)
        && new Set(value.columns as readonly unknown[]).size === (value.columns as readonly unknown[]).length
        && Array.isArray(value.rows)
        && value.rows.every((row) => Array.isArray(row)
          && row.length === (value.columns as readonly unknown[]).length
          && row.every(isJsonScalar));
    case "json":
      return hasOnly(value, ["kind", "exitStatus", "warnings", "value"])
        && isJsonValue(value.value, new Set<object>());
    case "test":
      return hasOnly(value, ["kind", "exitStatus", "warnings", "entries"])
        && validEntries(value.entries, ["id", "name", "status", "durationMs", "file", "line", "warning"], (entry) =>
          text(entry.id) && text(entry.name) && oneOf(entry.status, ["passed", "failed", "skipped"])
          && nonNegativeNumber(entry.durationMs) && text(entry.file)
          && nullableNonNegativeInteger(entry.line) && nullableText(entry.warning));
    case "log":
      return hasOnly(value, ["kind", "exitStatus", "warnings", "entries"])
        && validEntries(value.entries, ["id", "severity", "message", "timestamp", "source", "line"], (entry) =>
          text(entry.id) && oneOf(entry.severity, ["trace", "debug", "info", "warn", "error", "fatal"])
          && typeof entry.message === "string" && nullableText(entry.timestamp)
          && nullableText(entry.source) && nullableNonNegativeInteger(entry.line));
    case "repository":
      return hasOnly(value, ["kind", "exitStatus", "warnings", "entries"])
        && validEntries(value.entries, ["id", "path", "changeType", "status", "linesAdded", "linesDeleted", "warning"], (entry) =>
          text(entry.id) && text(entry.path)
          && oneOf(entry.changeType, ["added", "modified", "deleted", "renamed", "untracked"])
          && oneOf(entry.status, ["tracked", "staged", "unstaged", "conflicted"])
          && nonNegativeInteger(entry.linesAdded) && nonNegativeInteger(entry.linesDeleted)
          && nullableText(entry.warning));
  }
}

function validBase(value: Record<string, unknown>): boolean {
  return (value.exitStatus === null || integer(value.exitStatus))
    && Array.isArray(value.warnings)
    && value.warnings.every((warning) => typeof warning === "string");
}

function validEntries(
  value: unknown,
  keys: readonly string[],
  validate: (entry: Record<string, unknown>) => boolean,
): boolean {
  return Array.isArray(value) && value.every((entry) => isRecord(entry) && hasOnly(entry, keys) && validate(entry));
}

function encodeArtifact(artifact: TypedArtifact): unknown {
  const base = [1, KIND_CODES[artifact.kind], artifact.exitStatus, artifact.warnings] as const;
  switch (artifact.kind) {
    case "search": return [...base, artifact.entries.map((entry) => [entry.id, entry.path, entry.line, entry.column, entry.match])];
    case "tree": return [...base, artifact.entries.map((entry) => [entry.id, entry.path, entry.entryKind, entry.sizeBytes])];
    case "table": return [...base, artifact.columns, artifact.rows];
    case "json": return [...base, artifact.value];
    case "test": return [...base, artifact.entries.map((entry) => [entry.id, entry.name, entry.status, entry.durationMs, entry.file, entry.line, entry.warning])];
    case "log": return [...base, artifact.entries.map((entry) => [entry.id, entry.severity, entry.message, entry.timestamp, entry.source, entry.line])];
    case "repository": return [...base, artifact.entries.map((entry) => [entry.id, entry.path, entry.changeType, entry.status, entry.linesAdded, entry.linesDeleted, entry.warning])];
  }
}

function decodeArtifact(value: unknown): TypedArtifact | undefined {
  if (!Array.isArray(value) || value.length < 5 || value[0] !== 1) return undefined;
  const [, code, exitStatus, warnings, payload, secondary] = value;
  const base = { exitStatus, warnings };
  let artifact: unknown;
  switch (code) {
    case "s": artifact = { kind: "search", ...base, entries: decodeRows(payload, ["id", "path", "line", "column", "match"]) }; break;
    case "t": artifact = { kind: "tree", ...base, entries: decodeRows(payload, ["id", "path", "entryKind", "sizeBytes"]) }; break;
    case "b": artifact = { kind: "table", ...base, columns: payload, rows: secondary }; break;
    case "j": artifact = { kind: "json", ...base, value: payload }; break;
    case "x": artifact = { kind: "test", ...base, entries: decodeRows(payload, ["id", "name", "status", "durationMs", "file", "line", "warning"]) }; break;
    case "l": artifact = { kind: "log", ...base, entries: decodeRows(payload, ["id", "severity", "message", "timestamp", "source", "line"]) }; break;
    case "r": artifact = { kind: "repository", ...base, entries: decodeRows(payload, ["id", "path", "changeType", "status", "linesAdded", "linesDeleted", "warning"]) }; break;
    default: return undefined;
  }
  const kind = readKind(artifact);
  return kind && isTypedArtifact(artifact, kind) ? artifact : undefined;
}

function decodeRows(value: unknown, columns: readonly string[]): unknown {
  if (!Array.isArray(value)) return undefined;
  return value.map((row) => Array.isArray(row) && row.length === columns.length
    ? Object.fromEntries(columns.map((column, index) => [column, row[index]]))
    : undefined);
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return integer(value) && value >= 0;
}

function nullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || nonNegativeInteger(value);
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function isJsonScalar(value: unknown): value is JsonScalar {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function isJsonValue(value: unknown, ancestors: Set<object>): value is JsonValue {
  if (isJsonScalar(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
      && Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}
