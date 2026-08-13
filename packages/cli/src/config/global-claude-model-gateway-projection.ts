import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ModelGatewayConfig } from "@kilnai/core";
import { createModelGatewayConfigDigest, type ModelGatewayListenerIdentity } from "@kilnai/runtime";
import { buildClaudeMessagesProjection } from "./model-gateway-native-projection.js";
import { normalizeProjectionPath } from "./native-projection-paths.js";
import { runGlobalNativeProjectionTransaction, type GlobalNativeProjectionLockToken } from "./global-native-projection-lock.js";
import {
  createNativeProjectionSnapshot,
  detectNativeProjectionDrift,
  mergeManagedFields,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  stripManagedFields,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
} from "./native-projection-state.js";

export const GLOBAL_CLAUDE_MODEL_GATEWAY_TARGET_PREFIX = "global-claude-model-gateway:";

export interface GlobalClaudeModelGatewayProjectionResult {
  readonly operation: "install" | "uninstall";
  readonly changed: boolean;
  readonly targetPaths: readonly string[];
}

export function hasGlobalClaudeModelGatewayProjection(installStateDir: string): boolean {
  return Object.keys(readNativeProjectionInstallState(installStateDir).targets)
    .some((targetId) => targetId.startsWith(GLOBAL_CLAUDE_MODEL_GATEWAY_TARGET_PREFIX));
}

interface SyncGlobalClaudeModelGatewayProjectionInput {
  readonly config: ModelGatewayConfig;
  readonly listener?: ModelGatewayListenerIdentity;
  readonly targetPath?: string;
  readonly installStateDir: string;
  readonly operation: "install" | "uninstall";
  readonly adoptExisting?: boolean;
  readonly force?: boolean;
  readonly lock?: GlobalNativeProjectionLockToken;
}

export function syncGlobalClaudeModelGatewayProjection(input: SyncGlobalClaudeModelGatewayProjectionInput): Promise<GlobalClaudeModelGatewayProjectionResult> {
  return runGlobalNativeProjectionTransaction(input.installStateDir, input.lock, () => syncGlobalClaudeModelGatewayProjectionUnlocked(input));
}

async function syncGlobalClaudeModelGatewayProjectionUnlocked(input: SyncGlobalClaudeModelGatewayProjectionInput): Promise<GlobalClaudeModelGatewayProjectionResult> {
  if (input.force && input.operation !== "install") {
    throw new Error("Forcing the Claude model gateway projection is valid only for owned install repair.");
  }
  if (input.operation === "install") {
    if (!input.targetPath) {
      throw new Error("Installing the Claude model gateway projection requires a project target.");
    }
    if (!input.listener) throw new Error("Installing the Claude model gateway projection requires an owned ready listener.");
    requireExactListener(input.config, input.listener);
    return installClaudeProjection({
      config: input.config,
      installStateDir: input.installStateDir,
      targetPath: input.targetPath,
      listener: input.listener,
      operation: "install",
      ...(input.adoptExisting === undefined ? {} : { adoptExisting: input.adoptExisting }),
      ...(input.force === undefined ? {} : { force: input.force }),
    });
  }

  const globalState = readNativeProjectionInstallState(input.installStateDir);
  const registered = Object.entries(globalState.targets)
    .filter(([targetId]) => targetId.startsWith(GLOBAL_CLAUDE_MODEL_GATEWAY_TARGET_PREFIX))
    .map(([targetId, target]) => ({ targetId, target }));
  const targets = input.targetPath
    ? registered.filter(({ target }) => samePath(target.filePath, input.targetPath!))
    : registered;
  for (const { targetId, target } of targets) preflightRegisteredUninstall(globalState, targetId, target);
  const changedPaths: string[] = [];
  for (const { targetId, target } of targets) {
    uninstallRegisteredProjection(input.installStateDir, targetId, target);
    changedPaths.push(target.filePath);
  }
  return { operation: "uninstall", changed: changedPaths.length > 0, targetPaths: changedPaths };
}

function installClaudeProjection(input: {
  readonly config: ModelGatewayConfig;
  readonly listener: ModelGatewayListenerIdentity;
  readonly targetPath: string;
  readonly installStateDir: string;
  readonly operation: "install";
  readonly adoptExisting?: boolean;
  readonly force?: boolean;
}): GlobalClaudeModelGatewayProjectionResult {
  const gateway = buildClaudeMessagesProjection({ config: input.config });
  if (!gateway) throw new Error("Global modelGateway does not declare a Claude native principal.");
  const targetId = claudeTargetId(input.targetPath);
  const originalContent = existsSync(input.targetPath) ? readFileSync(input.targetPath, "utf8") : undefined;
  const currentDocument = parseDocument(originalContent, input.targetPath);
  const globalState = readNativeProjectionInstallState(input.installStateDir);
  const installed = globalState.targets[targetId];
  if (installed && !samePath(installed.filePath, input.targetPath)) {
    throw new Error("Claude model gateway install state targets a different project configuration.");
  }
  const drift = detectNativeProjectionDrift({ targetId, state: globalState, currentDocument });
  if (drift && !input.force) {
    throw new Error(`Claude model gateway managed field drift detected: ${drift.driftedFields.join(", ")}`);
  }

  if (!installed && gateway.managedFields.some((field) => hasPath(currentDocument, field)) && !input.adoptExisting) {
    throw new Error("Claude project settings contain unmanaged model gateway fields; refusing to overwrite them.");
  }
  const document = mergeManagedFields({
    currentDocument,
    managedPatch: gateway.patch,
    managedFields: gateway.managedFields,
  });
  const snapshot = createNativeProjectionSnapshot({
    targetId,
    filePath: input.targetPath,
    document,
    managedFields: gateway.managedFields,
  });
  commitProjectionState({
    targetPath: input.targetPath,
    originalContent,
    document,
    globalInstallStateDir: input.installStateDir,
    originalGlobalState: globalState,
    nextGlobalState: upsertNativeProjectionTargetState(globalState, snapshot),
  });
  return { operation: "install", changed: true, targetPaths: [input.targetPath] };
}

function preflightRegisteredUninstall(
  state: NativeProjectionInstallState,
  targetId: string,
  target: NativeProjectionTargetState,
): void {
  const document = parseDocument(existsSync(target.filePath) ? readFileSync(target.filePath, "utf8") : undefined, target.filePath);
  const drift = detectNativeProjectionDrift({ targetId, state, currentDocument: document });
  if (drift) throw new Error(`Claude model gateway managed field drift detected: ${drift.driftedFields.join(", ")}`);
}

function uninstallRegisteredProjection(
  installStateDir: string,
  targetId: string,
  target: NativeProjectionTargetState,
): void {
  const originalContent = existsSync(target.filePath) ? readFileSync(target.filePath, "utf8") : undefined;
  const document = parseDocument(originalContent, target.filePath);
  const state = readNativeProjectionInstallState(installStateDir);
  commitProjectionState({
    targetPath: target.filePath,
    originalContent,
    document: stripManagedFields({ currentDocument: document, managedFields: target.managedFields }),
    globalInstallStateDir: installStateDir,
    originalGlobalState: state,
    nextGlobalState: removeNativeProjectionTargetState(state, targetId),
  });
}

function commitProjectionState(input: {
  readonly targetPath: string;
  readonly originalContent: string | undefined;
  readonly document: Record<string, unknown>;
  readonly globalInstallStateDir: string;
  readonly originalGlobalState: NativeProjectionInstallState;
  readonly nextGlobalState: NativeProjectionInstallState;
}): void {
  writeDocumentAtomically(input.targetPath, input.document);
  try {
    writeNativeProjectionInstallState(input.globalInstallStateDir, input.nextGlobalState);
  } catch (error) {
    restoreFile(input.targetPath, input.originalContent);
    writeNativeProjectionInstallState(input.globalInstallStateDir, input.originalGlobalState);
    throw error;
  }
}

function requireExactListener(config: ModelGatewayConfig, listener: ModelGatewayListenerIdentity): void {
  if (listener.service !== "kiln-model-gateway" || listener.status !== "ready" || listener.protocolVersion !== 1
    || listener.configDigest !== createModelGatewayConfigDigest(config) || listener.port !== config.port) {
    throw new Error("Model gateway listener identity does not match the canonical global modelGateway configuration.");
  }
}

function claudeTargetId(path: string): string {
  return `${GLOBAL_CLAUDE_MODEL_GATEWAY_TARGET_PREFIX}${createHash("sha256").update(normalizeProjectionPath(path), "utf8").digest("hex")}`;
}

function parseDocument(content: string | undefined, path: string): Record<string, unknown> {
  if (content === undefined) return {};
  try {
    const value = JSON.parse(content) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("configuration root must be an object");
    return value as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/[\r\n]+/gu, " ").slice(0, 240) : "unknown parse error";
    throw new Error(`Claude project settings are unreadable and were not modified at ${path}: ${detail}`);
  }
}

function hasPath(document: Record<string, unknown>, path: string): boolean {
  const segments = path.split(".");
  let cursor: unknown = document;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(segment in cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return true;
}

function samePath(left: string, right: string): boolean {
  return normalizeProjectionPath(left) === normalizeProjectionPath(right);
}

let writeSequence = 0;
function writeDocumentAtomically(path: string, document: Record<string, unknown>): void {
  writeContentAtomically(path, `${JSON.stringify(document, null, 2)}\n`);
}

function writeContentAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${++writeSequence}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

function restoreFile(path: string, content: string | undefined): void {
  if (content === undefined) rmSync(path, { force: true });
  else writeContentAtomically(path, content);
}
