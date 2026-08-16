import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CommunicationResolutionSchema, type TrustedExecutionIntegrity } from "@kilnai/gateway-contracts";
import { validateResolvedCommunicationIntent, type CommunicationResolution } from "@kilnai/core";
import { normalizeProjectionPath } from "./native-projection-paths.js";
import { resolveGlobalConfigPath } from "./global-config.js";

export type NativeProjectionFileHarness = "claude" | "codex" | "opencode";

export interface NativeProjectionFileIdentity {
  readonly targetId: string;
  readonly filePath: string;
  readonly harness: NativeProjectionFileHarness;
  readonly sourceIdentity: string;
}

export interface NativeProjectionTargetState {
  readonly targetId: string;
  readonly filePath: string;
  readonly projectionKind?: "document" | "file";
  readonly harness?: NativeProjectionFileHarness;
  readonly sourceIdentity?: string;
  readonly contentHash: string;
  readonly managedFields: readonly string[];
  readonly managedFieldHashes: Readonly<Record<string, string>>;
  readonly managedArrayItems?: Readonly<Record<string, readonly unknown[]>>;
  readonly updatedAt: string;
  readonly permissionIntegrity?: TrustedExecutionIntegrity;
  readonly communicationResolution?: CommunicationResolution;
}

export interface NativeProjectionInstallState {
  readonly version: 1;
  readonly targets: Readonly<Record<string, NativeProjectionTargetState>>;
}

export interface NativeProjectionSnapshotInput {
  readonly targetId: string;
  readonly filePath: string;
  readonly document: Record<string, unknown>;
  readonly managedFields: readonly string[];
  readonly managedArrayItems?: Readonly<Record<string, readonly unknown[]>>;
  readonly updatedAt?: string;
  readonly communicationResolution?: CommunicationResolution;
  readonly permissionIntegrity?: TrustedExecutionIntegrity;
}

export interface NativeProjectionFileSnapshotInput {
  readonly targetId: string;
  readonly filePath: string;
  readonly content: string | Uint8Array;
  readonly harness?: NativeProjectionFileHarness;
  readonly sourceIdentity?: string;
  readonly updatedAt?: string;
  readonly communicationResolution?: CommunicationResolution;
}

export interface NativeProjectionDrift {
  readonly targetId: string;
  readonly driftedFields: readonly string[];
}

const INSTALL_STATE_FILE = "install-state.json";
let installStateWriteSequence = 0;

export function resolveGlobalNativeProjectionStateDir(userHome?: string): string {
  const globalDir = userHome ? join(userHome, ".kiln") : dirname(resolveGlobalConfigPath());
  return join(globalDir, "runtime", "native-projections");
}

export function emptyNativeProjectionInstallState(): NativeProjectionInstallState {
  return {
    version: 1,
    targets: {},
  };
}

export function readNativeProjectionInstallState(kilnDir: string): NativeProjectionInstallState {
  const path = join(kilnDir, INSTALL_STATE_FILE);
  if (!existsSync(path)) {
    return emptyNativeProjectionInstallState();
  }

  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as NativeProjectionInstallState;
  if (parsed.version !== 1 || typeof parsed.targets !== "object" || parsed.targets === null) {
    throw new Error(`Invalid native projection install state at ${path}`);
  }
  const targets = Object.fromEntries(Object.entries(parsed.targets).map(([targetId, target]) => {
    if (!isRecord(target)) throw new Error(`Invalid native projection target '${targetId}' at ${path}`);
    const communicationResolution = target.communicationResolution === undefined
      ? undefined
      : validatePersistedCommunicationResolution(target.communicationResolution, targetId, path);
    return [targetId, {
      ...target,
      ...(communicationResolution ? { communicationResolution } : {}),
    } as unknown as NativeProjectionTargetState];
  }));
  return { version: 1, targets };
}

function validatePersistedCommunicationResolution(
  input: unknown,
  targetId: string,
  path: string,
): CommunicationResolution {
  const parsed = CommunicationResolutionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid communication resolution for '${targetId}' at ${path}`);
  }
  const requested = validateResolvedCommunicationIntent(parsed.data.requested);
  const value = { ...parsed.data, requested } as CommunicationResolution;
  const expectedIdentity = `sha256:${createHash("sha256").update(stableStringify({
    version: value.version,
    requested: value.requested,
    execution: value.execution,
    responseDetail: value.responseDetail,
    interactionProfile: value.interactionProfile,
    locale: value.locale,
    requiredContent: value.requiredContent,
    artifactContract: value.artifactContract,
    responseSkills: value.responseSkills,
    ...(value.capabilityEvidence ? { capabilityEvidence: value.capabilityEvidence } : {}),
    semanticLoss: value.semanticLoss,
  })).digest("hex")}`;
  if (value.identity !== expectedIdentity) {
    throw new Error(`Invalid communication resolution identity for '${targetId}' at ${path}`);
  }
  return value;
}

export function writeNativeProjectionInstallState(
  kilnDir: string,
  state: NativeProjectionInstallState,
): void {
  const path = join(kilnDir, INSTALL_STATE_FILE);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${++installStateWriteSequence}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function createNativeProjectionSnapshot(
  input: NativeProjectionSnapshotInput,
): NativeProjectionTargetState {
  const managedFieldHashes: Record<string, string> = {};
  for (const fieldPath of input.managedFields) {
    managedFieldHashes[fieldPath] = hashManagedValue(input.document, fieldPath, input.managedArrayItems?.[fieldPath]);
  }

  return {
    targetId: requireText(input.targetId, "targetId"),
    filePath: requireText(input.filePath, "filePath"),
    contentHash: hashStableValue(input.document),
    managedFields: [...input.managedFields],
    managedFieldHashes,
    ...(input.managedArrayItems ? { managedArrayItems: input.managedArrayItems } : {}),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    ...(input.communicationResolution ? { communicationResolution: input.communicationResolution } : {}),
    ...(input.permissionIntegrity ? { permissionIntegrity: input.permissionIntegrity } : {}),
  };
}

export function createNativeProjectionFileSnapshot(
  input: NativeProjectionFileSnapshotInput,
): NativeProjectionTargetState {
  const contentHash = hashFileContent(input.content);
  return {
    targetId: requireText(input.targetId, "targetId"),
    filePath: requireText(input.filePath, "filePath"),
    projectionKind: "file",
    ...(input.harness ? { harness: input.harness } : {}),
    ...(input.sourceIdentity ? { sourceIdentity: input.sourceIdentity } : {}),
    contentHash,
    managedFields: ["$file"],
    managedFieldHashes: {
      "$file": contentHash,
    },
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    ...(input.communicationResolution ? { communicationResolution: input.communicationResolution } : {}),
  };
}

export function isFullyOwnedNativeProjectionFile(
  target: NativeProjectionTargetState | undefined,
  expected?: NativeProjectionFileIdentity,
): boolean {
  if (!target || target.projectionKind !== "file"
    || !Array.isArray(target.managedFields)
    || target.managedFields.length !== 1
    || target.managedFields[0] !== "$file"
    || typeof target.managedFieldHashes?.["$file"] !== "string") {
    return false;
  }
  if (!expected) return true;
  return target.targetId === expected.targetId
    && normalizeProjectionPath(target.filePath) === normalizeProjectionPath(expected.filePath)
    && target.harness === expected.harness
    && target.projectionKind === "file"
    && target.sourceIdentity === expected.sourceIdentity;
}

export function nativeProjectionFileMatchesDesired(input: {
  readonly target: NativeProjectionTargetState | undefined;
  readonly currentContent: string | Uint8Array;
  readonly desiredContent: string | Uint8Array;
  readonly expected?: NativeProjectionFileIdentity;
}): boolean {
  if (!isFullyOwnedNativeProjectionFile(input.target, input.expected)) {
    return false;
  }
  const desiredHashes = fileContentHashes(input.desiredContent);
  return fileContentHashes(input.currentContent)
    .some((hash) => desiredHashes.includes(hash));
}

export function upsertNativeProjectionTargetState(
  state: NativeProjectionInstallState,
  target: NativeProjectionTargetState,
): NativeProjectionInstallState {
  return {
    version: 1,
    targets: {
      ...state.targets,
      [target.targetId]: target,
    },
  };
}

export function removeNativeProjectionTargetState(
  state: NativeProjectionInstallState,
  targetId: string,
): NativeProjectionInstallState {
  const targets: Record<string, NativeProjectionTargetState> = { ...state.targets };
  delete targets[targetId];
  return {
    version: 1,
    targets,
  };
}

export function detectNativeProjectionDrift(input: {
  readonly targetId: string;
  readonly state: NativeProjectionInstallState;
  readonly currentDocument: Record<string, unknown>;
}): NativeProjectionDrift | undefined {
  const target = input.state.targets[input.targetId];
  if (!target) {
    return undefined;
  }

  const driftedFields = target.managedFields.filter((fieldPath) => {
    const currentHash = hashManagedValue(input.currentDocument, fieldPath, target.managedArrayItems?.[fieldPath]);
    return currentHash !== target.managedFieldHashes[fieldPath];
  });

  return driftedFields.length > 0
    ? { targetId: input.targetId, driftedFields }
    : undefined;
}

export function detectNativeProjectionFileDrift(input: {
  readonly targetId: string;
  readonly state: NativeProjectionInstallState;
  readonly currentContent: string | Uint8Array;
}): NativeProjectionDrift | undefined {
  const target = input.state.targets[input.targetId];
  if (!target) {
    return undefined;
  }
  const currentHashes = fileContentHashes(input.currentContent);
  const expectedHashes = currentFileContentHashes(target);
  return expectedHashes.length === 0 || !expectedHashes.some((hash) => currentHashes.includes(hash))
    ? { targetId: input.targetId, driftedFields: ["$file"] }
    : undefined;
}

function currentFileContentHashes(target: NativeProjectionTargetState): readonly string[] {
  const hashes = new Set<string>();
  if (typeof target.managedFieldHashes?.["$file"] === "string") {
    hashes.add(target.managedFieldHashes["$file"]);
  }
  if (target.projectionKind === "file" && typeof target.contentHash === "string") {
    hashes.add(target.contentHash);
  }
  return [...hashes];
}

function hashFileContent(content: string | Uint8Array): string {
  return typeof content === "string"
    ? hashStableValue(content)
    : createHash("sha256").update(content).digest("hex");
}

function fileContentHashes(content: string | Uint8Array): readonly string[] {
  const canonical = hashFileContent(content);
  if (typeof content === "string") {
    return [canonical];
  }
  // Text projections created before recursive binary-safe sync were hashed as
  // UTF-8 strings. Accept that legacy hash once so an unchanged file does not
  // report false drift during migration.
  return [canonical, hashStableValue(Buffer.from(content).toString("utf-8"))];
}

export function mergeManagedFields(input: {
  readonly currentDocument: Record<string, unknown>;
  readonly managedPatch: Record<string, unknown>;
  readonly managedFields: readonly string[];
}): Record<string, unknown> {
  const merged = cloneRecord(input.currentDocument);
  for (const fieldPath of input.managedFields) {
    setPathValue(merged, fieldPath, cloneValue(getPathValue(input.managedPatch, fieldPath)));
  }
  return merged;
}

export function stripManagedFields(input: {
  readonly currentDocument: Record<string, unknown>;
  readonly managedFields: readonly string[];
  readonly managedArrayItems?: Readonly<Record<string, readonly unknown[]>>;
}): Record<string, unknown> {
  const stripped = cloneRecord(input.currentDocument);
  for (const fieldPath of input.managedFields) {
    const ownedItems = input.managedArrayItems?.[fieldPath];
    if (ownedItems) {
      const current = getPathValue(stripped, fieldPath);
      if (Array.isArray(current)) {
        const removals = new Map<string, number>();
        for (const owned of ownedItems) {
          const key = stableStringify(owned);
          removals.set(key, (removals.get(key) ?? 0) + 1);
        }
        const retainedReversed: unknown[] = [];
        for (let index = current.length - 1; index >= 0; index -= 1) {
          const item = current[index];
          const key = stableStringify(item);
          const remaining = removals.get(key) ?? 0;
          if (remaining > 0) removals.set(key, remaining - 1);
          else retainedReversed.push(item);
        }
        const retained = retainedReversed.reverse();
        if (retained.length > 0) setPathValue(stripped, fieldPath, retained);
        else deletePathValue(stripped, fieldPath);
      }
      continue;
    }
    deletePathValue(stripped, fieldPath);
  }
  return stripped;
}

function hashManagedValue(document: Record<string, unknown>, fieldPath: string, ownedItems: readonly unknown[] | undefined): string {
  const value = getPathValue(document, fieldPath);
  if (!ownedItems) return hashStableValue(value);
  const current = Array.isArray(value) ? value : [];
  return hashStableValue(ownedItems.map((owned) => current.filter((item) => stableStringify(item) === stableStringify(owned)).length));
}

function getPathValue(source: Record<string, unknown>, fieldPath: string): unknown {
  const segments = parseFieldPath(fieldPath);
  let cursor: unknown = source;
  for (const segment of segments) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function setPathValue(target: Record<string, unknown>, fieldPath: string, value: unknown): void {
  const segments = parseFieldPath(fieldPath);
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const next = cursor[segment];
    if (!isRecord(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]!] = value;
}

function deletePathValue(target: Record<string, unknown>, fieldPath: string): boolean {
  const segments = parseFieldPath(fieldPath);
  return deletePathSegments(target, segments, 0);
}

function deletePathSegments(target: Record<string, unknown>, segments: readonly string[], index: number): boolean {
  const segment = segments[index]!;
  if (index === segments.length - 1) {
    delete target[segment];
  } else {
    const next = target[segment];
    if (isRecord(next) && deletePathSegments(next, segments, index + 1)) {
      delete target[segment];
    }
  }
  return Object.keys(target).length === 0;
}

function parseFieldPath(fieldPath: string): readonly string[] {
  if (fieldPath.startsWith("/")) {
    const segments = fieldPath.slice(1).split("/").map((segment) => segment
      .replace(/~1/g, "/")
      .replace(/~0/g, "~"));
    if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
      throw new Error(`Invalid managed JSON Pointer path: ${fieldPath}`);
    }
    return segments;
  }
  const segments = fieldPath.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error("Managed field path must not be empty");
  }
  return segments;
}

function hashStableValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return cloneValue(value) as Record<string, unknown>;
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (isRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      clone[key] = cloneValue(nested);
    }
    return clone;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}
