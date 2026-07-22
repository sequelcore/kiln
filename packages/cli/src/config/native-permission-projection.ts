import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { stripJsonComments } from "./json-comments.js";
import { translateClaudePermissionProjection } from "./translators/claude-translator.js";
import { translateCodexPermissionProjection } from "./translators/codex-translator.js";
import { translateOpenCodePermissionProjection } from "./translators/opencode-translator.js";
import { PERMISSION_PROJECTION_TARGET_IDS } from "./translators/permission-projection.js";
import type { KilnPermissionPolicy } from "../wrapper/session.js";
import type { KilnYaml } from "../kiln-yaml-types.js";
import { parseGatewayYaml, type ModelGatewayConfig } from "@kilnai/core";
import {
  createNativeProjectionSnapshot,
  createNativeProjectionFileSnapshot,
  detectNativeProjectionDrift,
  detectNativeProjectionFileDrift,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
} from "./native-projection-state.js";
import { backupNativeProjectionFile } from "./native-projection-backup.js";
import {
  isNativeProjectionHarnessDisabled,
  type NativeProjectionSyncOptions,
} from "./native-projection-policy.js";
import { buildClaudeMessagesProjection, buildCodexResponsesProjection, buildOpenCodeResponsesProjection } from "./model-gateway-native-projection.js";

const DEFAULT_POLICY: KilnPermissionPolicy = { approval: "on-request", sandbox: "read-only" };

export interface NativePermissionProjectionResult {
  claude: boolean;
  codex: boolean;
  opencode: boolean;
  errors: string[];
}

export interface NativePermissionProjectionOptions extends NativeProjectionSyncOptions {}

interface PermissionTargetResult {
  readonly ok: boolean;
  readonly snapshot?: NativeProjectionTargetState;
  readonly additionalSnapshots?: readonly NativeProjectionTargetState[];
  readonly removeTargetIds?: readonly string[];
  readonly error?: string;
  readonly rollback?: () => void;
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

export async function syncNativePermissionProjections(
  kilnYaml: KilnYaml,
  projectPath: string,
  options: NativePermissionProjectionOptions = {},
): Promise<NativePermissionProjectionResult> {
  const errors: string[] = [];
  const policy = kilnYaml.permissions ?? DEFAULT_POLICY;
  const kilnDir = join(projectPath, ".kiln");
  const modelGateway = readCanonicalModelGateway(kilnDir);
  let installState = readNativeProjectionInstallState(kilnDir);
  let claudeResult: PermissionTargetResult = skippedPermissionTarget();
  let codexResult: PermissionTargetResult = skippedPermissionTarget();
  let opencodeResult: PermissionTargetResult = skippedPermissionTarget();
  const rollbacks: Array<() => void> = [];
  try {
    claudeResult = isNativeProjectionHarnessDisabled(options, "claude")
      ? skippedPermissionTarget()
      : await syncClaudePermissions(policy, projectPath, installState, options, modelGateway);
    if (claudeResult.rollback) rollbacks.push(claudeResult.rollback);
    if (claudeResult.snapshot) installState = upsertNativeProjectionTargetState(installState, claudeResult.snapshot);
    if (claudeResult.error) errors.push(`Claude Code: ${claudeResult.error}`);

    codexResult = isNativeProjectionHarnessDisabled(options, "codex")
      ? skippedPermissionTarget()
      : await syncCodexPermissions(kilnYaml, policy, kilnDir, installState, options, modelGateway);
    if (codexResult.rollback) rollbacks.push(codexResult.rollback);
    if (codexResult.snapshot) installState = upsertNativeProjectionTargetState(installState, codexResult.snapshot);
    for (const snapshot of codexResult.additionalSnapshots ?? []) installState = upsertNativeProjectionTargetState(installState, snapshot);
    for (const targetId of codexResult.removeTargetIds ?? []) installState = removeNativeProjectionTargetState(installState, targetId);
    if (codexResult.error) errors.push(`Codex: ${codexResult.error}`);

    opencodeResult = isNativeProjectionHarnessDisabled(options, "opencode")
      ? skippedPermissionTarget()
      : await syncOpenCodePermissions(kilnYaml, policy, kilnDir, installState, options, modelGateway);
    if (opencodeResult.rollback) rollbacks.push(opencodeResult.rollback);
    if (opencodeResult.snapshot) installState = upsertNativeProjectionTargetState(installState, opencodeResult.snapshot);
    if (opencodeResult.error) errors.push(`OpenCode: ${opencodeResult.error}`);
    writeNativeProjectionInstallState(kilnDir, installState);
  } catch (error) {
    rollbackNativeProjectionChanges(rollbacks, error);
  }

  return {
    claude: claudeResult.ok,
    codex: codexResult.ok,
    opencode: opencodeResult.ok,
    errors,
  };
}

function skippedPermissionTarget(): PermissionTargetResult {
  return { ok: true };
}

async function syncClaudePermissions(
  policy: KilnPermissionPolicy,
  projectPath: string,
  installState: NativeProjectionInstallState,
  options: NativePermissionProjectionOptions,
  modelGateway: ModelGatewayConfig | undefined,
): Promise<PermissionTargetResult> {
  const targetId = PERMISSION_PROJECTION_TARGET_IDS.claude;
  const target = join(projectPath, ".claude", "settings.json");
  const originalContent = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  let existing: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      existing = JSON.parse(readFileSync(target, "utf-8"));
    } catch {
      existing = {};
    }
  }
  const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument: existing });
  if (drift && !options.force) {
    return {
      ok: false,
      error: `managed field drift detected: ${drift.driftedFields.join(", ")}`,
    };
  }

  const gatewayProjection = modelGateway ? buildClaudeMessagesProjection({ config: modelGateway }) : undefined;
  const projection = translateClaudePermissionProjection({
    policy,
    existingDocument: existing,
    gatewayProjection,
    previousManagedFields: installState.targets[targetId]?.managedFields,
  });
  const snapshot = createNativeProjectionSnapshot({
    targetId: projection.targetId,
    filePath: target,
    document: projection.document,
    managedFields: projection.managedFields,
    permissionIntegrity: projection.integrity,
  });
  ensureDir(dirname(target));
  backupNativeProjectionFile({ kilnDir: join(projectPath, ".kiln"), targetId, filePath: target });
  const rollback = () => restoreFile(target, originalContent);
  try {
    writeFileAtomically(target, JSON.stringify(projection.document, null, 2) + "\n");
  } catch (error) {
    rollbackNativeProjectionChanges([rollback], error);
  }
  return {
    ok: true,
    snapshot,
    rollback,
  };
}

async function syncCodexPermissions(
  kilnYaml: KilnYaml,
  policy: KilnPermissionPolicy,
  kilnDir: string,
  installState: NativeProjectionInstallState,
  options: NativePermissionProjectionOptions,
  modelGateway: ModelGatewayConfig | undefined,
): Promise<PermissionTargetResult> {
  const targetId = PERMISSION_PROJECTION_TARGET_IDS.codex;
  const target = join(os.homedir(), ".codex", "config.toml");
  const originalConfigContent = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  let doc: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      const raw = readFileSync(target, "utf-8");
      doc = parseToml(raw) as Record<string, unknown>;
    } catch {
      doc = {};
    }
  }
  const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument: doc });
  if (drift && !options.force) {
    return {
      ok: false,
      error: `managed field drift detected: ${drift.driftedFields.join(", ")}`,
    };
  }

  const catalogTargetId = "codex-model-catalog";
  const catalogPath = join(kilnDir, "projections", "codex-model-catalog.json");
  const gatewayProjection = modelGateway ? buildCodexResponsesProjection({ config: modelGateway, modelCatalogPath: catalogPath }) : undefined;
  const catalogState = installState.targets[catalogTargetId];
  const originalCatalogContent = existsSync(catalogPath) ? readFileSync(catalogPath, "utf8") : undefined;
  if (gatewayProjection && !catalogState && existsSync(catalogPath)) return { ok: false, error: "model catalog path already exists without Kiln install-state ownership" };
  if (catalogState) {
    const currentContent = existsSync(catalogPath) ? readFileSync(catalogPath, "utf8") : "";
    const catalogDrift = detectNativeProjectionFileDrift({ targetId: catalogTargetId, state: installState, currentContent });
    if (catalogDrift && !options.force) return { ok: false, error: "managed model catalog drift detected" };
  }
  const catalogContent = gatewayProjection ? `${JSON.stringify(gatewayProjection.catalog, null, 2)}\n` : undefined;
  const previousManagedFields = installState.targets[targetId]?.managedFields ?? [];
  const projection = translateCodexPermissionProjection({
    policy,
    existingDocument: doc,
    kilnYaml,
    ownsManagedDefault: installState.targets[targetId]?.managedFields.includes("model") === true,
    gatewayProjection,
    previousManagedFields,
  });
  const snapshot = createNativeProjectionSnapshot({
    targetId: projection.targetId,
    filePath: target,
    document: projection.document,
    managedFields: projection.managedFields,
    permissionIntegrity: projection.integrity,
  });
  const additionalSnapshots = gatewayProjection && catalogContent !== undefined
    ? [createNativeProjectionFileSnapshot({ targetId: catalogTargetId, filePath: catalogPath, content: catalogContent })]
    : [];
  const removeTargetIds = !gatewayProjection && catalogState ? [catalogTargetId] : [];
  ensureDir(dirname(target));
  backupNativeProjectionFile({ kilnDir, targetId, filePath: target });
  const rollback = () => {
    restoreFile(target, originalConfigContent);
    restoreFile(catalogPath, originalCatalogContent);
  };
  try {
    if (catalogContent !== undefined) {
      if (originalCatalogContent !== catalogContent) writeFileAtomically(catalogPath, catalogContent);
    } else if (catalogState) {
      rmSync(catalogPath, { force: true });
    }
  } catch {
    return { ok: false, error: "managed model catalog could not be updated safely" };
  }
  try {
    writeFileAtomically(target, stringifyToml(projection.document));
  } catch (error) {
    rollbackNativeProjectionChanges([rollback], error);
  }
  return {
    ok: true,
    snapshot,
    additionalSnapshots,
    removeTargetIds,
    rollback,
  };
}

async function syncOpenCodePermissions(
  kilnYaml: KilnYaml,
  policy: KilnPermissionPolicy,
  kilnDir: string,
  installState: NativeProjectionInstallState,
  options: NativePermissionProjectionOptions,
  modelGateway: ModelGatewayConfig | undefined,
): Promise<PermissionTargetResult> {
  const targetId = PERMISSION_PROJECTION_TARGET_IDS.opencode;
  const target = join(os.homedir(), ".config", "opencode", "opencode.json");
  const originalContent = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  let existing: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      const raw = readFileSync(target, "utf-8");
      const stripped = stripJsonComments(raw);
      existing = JSON.parse(stripped);
    } catch {
      existing = {};
    }
  }
  const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument: existing });
  if (drift && !options.force) {
    return {
      ok: false,
      error: `managed field drift detected: ${drift.driftedFields.join(", ")}`,
    };
  }

  const enabledProviders = Array.isArray(existing.enabled_providers)
    ? existing.enabled_providers.filter((value): value is string => typeof value === "string")
    : [];
  const gatewayProjection = modelGateway ? buildOpenCodeResponsesProjection({ config: modelGateway, existingEnabledProviders: enabledProviders }) : undefined;
  const projection = translateOpenCodePermissionProjection({
    policy,
    existingDocument: existing,
    kilnYaml,
    ownsManagedDefault: installState.targets[targetId]?.managedFields.includes("model") === true,
    gatewayProjection,
    previousManagedFields: installState.targets[targetId]?.managedFields,
  });
  const snapshot = createNativeProjectionSnapshot({
    targetId: projection.targetId,
    filePath: target,
    document: projection.document,
    managedFields: projection.managedFields,
    ...(gatewayProjection ? { managedArrayItems: { enabled_providers: ["kiln"] } } : {}),
    permissionIntegrity: projection.integrity,
  });
  ensureDir(dirname(target));
  backupNativeProjectionFile({ kilnDir, targetId, filePath: target });
  const rollback = () => restoreFile(target, originalContent);
  try {
    writeFileAtomically(target, JSON.stringify(projection.document, null, 2) + "\n");
  } catch (error) {
    rollbackNativeProjectionChanges([rollback], error);
  }
  return {
    ok: true,
    snapshot,
    rollback,
  };
}

function readCanonicalModelGateway(kilnDir: string): ModelGatewayConfig | undefined {
  const path = join(kilnDir, "gateway.yaml");
  if (!existsSync(path)) return undefined;
  return parseGatewayYaml(readFileSync(path, "utf8")).modelGateway;
}

let nativeProjectionWriteSequence = 0;

function writeFileAtomically(path: string, content: string): void {
  ensureDir(dirname(path));
  const temporary = `${path}.${process.pid}.${++nativeProjectionWriteSequence}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function restoreFile(path: string, content: string | undefined): void {
  if (content === undefined) {
    rmSync(path, { force: true });
    return;
  }
  writeFileAtomically(path, content);
}

function rollbackNativeProjectionChanges(rollbacks: readonly (() => void)[], originalError: unknown): never {
  const rollbackErrors: unknown[] = [];
  for (let index = rollbacks.length - 1; index >= 0; index -= 1) {
    try { rollbacks[index]!(); }
    catch (error) { rollbackErrors.push(error); }
  }
  if (rollbackErrors.length > 0) throw new AggregateError([originalError, ...rollbackErrors], "Native projection sync failed and rollback was incomplete.");
  throw originalError;
}
