import { createHash } from "node:crypto";
import type {
  ArtifactResourceMetadata,
  ArtifactResourceStore,
} from "@kilnai/core";

const ARTIFACT_NAMESPACE_SESSION_HINT_LENGTH = 24;
const ARTIFACT_NAMESPACE_HASH_LENGTH = 12;

export function createRecorderArtifactNamespace(prefix: string, sessionId: string): string {
  const sessionHint = sessionId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, ARTIFACT_NAMESPACE_SESSION_HINT_LENGTH)
    .replace(/^-+|-+$/gu, "");
  const sessionHash = createHash("sha256")
    .update(sessionId)
    .digest("hex")
    .slice(0, ARTIFACT_NAMESPACE_HASH_LENGTH);
  if (!sessionHint) {
    return `${prefix}-${sessionHash}`;
  }
  return `${prefix}-${sessionHint}-${sessionHash}`;
}

export function normalizeRecorderRetentionMaxArtifacts(input: {
  readonly value: number | undefined;
  readonly defaultValue: number;
  readonly minimumValue: number;
  readonly label: string;
}): number {
  const requested = input.value ?? input.defaultValue;
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error(`${input.label} retentionMaxArtifacts must be a positive finite number.`);
  }
  return Math.max(input.minimumValue, Math.trunc(requested));
}

export function artifactContentUri(metadata: ArtifactResourceMetadata): string {
  return `kiln://artifacts/${metadata.namespace}/${metadata.id}/content`;
}

export function normalizeRecorderTimestamp(value: Date | string, label: string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`${label} timestamp must be valid.`);
  }
  return timestamp.toISOString();
}

export function validateArtifactContentUri(uri: string, label: string): void {
  requireRecorderText(uri, "artifactUri", label);
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`${label} artifactUri must use kiln://artifacts.`);
  }
  if (parsed.protocol !== "kiln:" || parsed.hostname !== "artifacts") {
    throw new Error(`${label} artifactUri must use kiln://artifacts.`);
  }
}

export function parseArtifactContentUri(
  uri: string,
  label: string,
): { readonly namespace: string; readonly id: string } {
  validateArtifactContentUri(uri, label);
  const parsed = new URL(uri);
  const [namespace, id, content] = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (!namespace || !id || content !== "content") {
    throw new Error(`${label} artifactUri must use kiln://artifacts/{namespace}/{id}/content.`);
  }
  return { namespace, id };
}

export function requireRecorderText(
  value: string | undefined,
  field: string,
  label: string,
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} ${field} is required.`);
  }
}

export function uniqueRecorderStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function readRecorderArtifactSize(
  artifactStore: ArtifactResourceStore,
  uri: string,
  label: string,
): number {
  const reference = parseArtifactContentUri(uri, label);
  const artifact = artifactStore.get(reference.namespace, reference.id);
  if (!artifact) {
    throw new Error(`${label} artifact is missing: ${uri}`);
  }
  return artifact.size;
}

export function assertRecorderArtifactsReadable(
  artifactStore: ArtifactResourceStore,
  uris: readonly string[],
  label: string,
): void {
  for (const uri of uris) {
    readRecorderArtifactSize(artifactStore, uri, label);
  }
}
