import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ModelGatewayConfig } from "@kilnai/core";
import { createModelGatewayConfigDigest, type ModelGatewayListenerIdentity } from "@kilnai/runtime";
import { stripJsonComments } from "./json-comments.js";
import { buildOpenCodeResponsesProjection } from "./model-gateway-native-projection.js";
import {
  createNativeProjectionSnapshot,
  detectNativeProjectionDrift,
  mergeManagedFields,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  stripManagedFields,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "./native-projection-state.js";

export const GLOBAL_OPENCODE_MODEL_GATEWAY_TARGET_ID = "global-opencode-model-gateway";

export interface GlobalOpenCodeModelGatewayProjectionResult {
  readonly operation: "install" | "uninstall";
  readonly changed: boolean;
  readonly targetPath: string;
}

export async function syncGlobalOpenCodeModelGatewayProjection(input: {
  readonly config: ModelGatewayConfig;
  readonly listener: ModelGatewayListenerIdentity;
  readonly targetPath: string;
  readonly installStateDir: string;
  readonly operation: "install" | "uninstall";
}): Promise<GlobalOpenCodeModelGatewayProjectionResult> {
  requireExactListener(input.config, input.listener);
  const originalContent = existsSync(input.targetPath) ? readFileSync(input.targetPath, "utf8") : undefined;
  const currentDocument = parseOpenCodeDocument(originalContent, input.targetPath);
  const installState = readNativeProjectionInstallState(input.installStateDir);
  const installedTarget = installState.targets[GLOBAL_OPENCODE_MODEL_GATEWAY_TARGET_ID];
  if (installedTarget && installedTarget.filePath !== input.targetPath) {
    throw new Error(`Global OpenCode model gateway install state targets a different native configuration: ${installedTarget.filePath}`);
  }
  const drift = detectNativeProjectionDrift({
    targetId: GLOBAL_OPENCODE_MODEL_GATEWAY_TARGET_ID,
    state: installState,
    currentDocument,
  });
  if (drift) throw new Error(`Global OpenCode model gateway managed field drift detected: ${drift.driftedFields.join(", ")}`);

  if (input.operation === "uninstall") {
    if (!installedTarget) return { operation: "uninstall", changed: false, targetPath: input.targetPath };
    const document = stripManagedFields({ currentDocument, managedFields: installedTarget.managedFields });
    commitProjection(input.targetPath, originalContent, document, input.installStateDir, () =>
      writeNativeProjectionInstallState(input.installStateDir, removeNativeProjectionTargetState(installState, GLOBAL_OPENCODE_MODEL_GATEWAY_TARGET_ID)));
    return { operation: "uninstall", changed: true, targetPath: input.targetPath };
  }

  if (!installedTarget && hasPath(currentDocument, ["provider", "kiln"])) {
    throw new Error("OpenCode native configuration already contains unmanaged provider.kiln; refusing to overwrite it.");
  }
  const projection = buildOpenCodeResponsesProjection({ config: input.config });
  if (!projection) throw new Error("Global modelGateway does not declare an OpenCode native principal.");
  if (projection.managedFields.length !== 1 || projection.managedFields[0] !== "provider.kiln") {
    throw new Error("OpenCode model gateway projection attempted to own unsupported native fields.");
  }
  const document = mergeManagedFields({ currentDocument, managedPatch: projection.patch, managedFields: projection.managedFields });
  const snapshot = createNativeProjectionSnapshot({
    targetId: GLOBAL_OPENCODE_MODEL_GATEWAY_TARGET_ID,
    filePath: input.targetPath,
    document,
    managedFields: projection.managedFields,
  });
  commitProjection(input.targetPath, originalContent, document, input.installStateDir, () =>
    writeNativeProjectionInstallState(input.installStateDir, upsertNativeProjectionTargetState(installState, snapshot)));
  return { operation: "install", changed: true, targetPath: input.targetPath };
}

function requireExactListener(config: ModelGatewayConfig, listener: ModelGatewayListenerIdentity): void {
  const digest = createModelGatewayConfigDigest(config);
  if (listener.service !== "kiln-model-gateway" || listener.status !== "ready" || listener.protocolVersion !== 1
    || listener.configDigest !== digest || listener.port !== config.port
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(listener.instanceId)) {
    throw new Error("Model gateway listener identity does not match the canonical global modelGateway configuration.");
  }
}

function parseOpenCodeDocument(content: string | undefined, path: string): Record<string, unknown> {
  if (content === undefined) return {};
  try {
    const value = JSON.parse(stripJsonComments(content)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("configuration root must be an object");
    return value as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "unknown parse error";
    throw new Error(`OpenCode native configuration is unreadable and was not modified at ${path}: ${detail}`);
  }
}

function commitProjection(
  targetPath: string,
  originalContent: string | undefined,
  document: Record<string, unknown>,
  installStateDir: string,
  writeState: () => void,
): void {
  writeFileAtomically(targetPath, `${JSON.stringify(document, null, 2)}\n`);
  try {
    writeState();
  } catch (error) {
    if (originalContent === undefined) rmSync(targetPath, { force: true });
    else writeFileAtomically(targetPath, originalContent);
    throw error;
  }
  void installStateDir;
}

let writeSequence = 0;
function writeFileAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${++writeSequence}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function hasPath(document: Record<string, unknown>, path: readonly string[]): boolean {
  let cursor: unknown = document;
  for (const segment of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(segment in cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return true;
}
