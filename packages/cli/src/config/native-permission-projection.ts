import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ModelGatewayConfig, parseGatewayYaml, readTrustedExecutionAuthorization } from "@kilnai/core";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { KilnYaml } from "../kiln-yaml-types.js";
import type { KilnPermissionPolicy } from "../wrapper/session.js";
import { stripJsonComments } from "./json-comments.js";
import {
  buildClaudeMessagesProjection,
  buildCodexResponsesProjection,
  buildOpenCodeResponsesProjection,
} from "./model-gateway-native-projection.js";
import { resolveNativeHarnessDir } from "./native-harness-home.js";
import { backupNativeProjectionFile } from "./native-projection-backup.js";
import {
  describeProjectionDrift,
  isNativeProjectionHarnessDisabled,
  type NativeProjectionSyncOptions,
  type ProjectionOutcome,
} from "./native-projection-policy.js";
import {
  createNativeProjectionSnapshot,
  detectNativeProjectionDrift,
  detectNativeProjectionFileDrift,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "./native-projection-state.js";
import { translateClaudePermissionProjection } from "./translators/claude-translator.js";
import { translateCodexPermissionProjection } from "./translators/codex-translator.js";
import { translateOpenCodePermissionProjection } from "./translators/opencode-translator.js";
import { PERMISSION_PROJECTION_TARGET_IDS } from "./translators/permission-projection.js";

const DEFAULT_POLICY: KilnPermissionPolicy = { approval: "on-request", sandbox: "read-only" };

export interface NativePermissionProjectionResult {
  claude: boolean;
  codex: boolean;
  opencode: boolean;
  errors: string[];
  outcomes: readonly ProjectionOutcome[];
}

export interface NativePermissionProjectionOptions extends NativeProjectionSyncOptions {}

interface PermissionTargetResult {
  readonly ok: boolean;
  readonly snapshot?: NativeProjectionTargetState;
  readonly removeTargetIds?: readonly string[];
  readonly error?: string;
  readonly rollback?: () => void;
  readonly outcomes: readonly ProjectionOutcome[];
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
  const outcomes: ProjectionOutcome[] = [];
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
      ? skippedPermissionTarget(PERMISSION_PROJECTION_TARGET_IDS.claude, join(projectPath, ".claude", "settings.json"))
      : await syncClaudePermissions(policy, projectPath, installState, options, modelGateway);
    outcomes.push(...claudeResult.outcomes);
    if (claudeResult.rollback) rollbacks.push(claudeResult.rollback);
    if (claudeResult.snapshot) installState = upsertNativeProjectionTargetState(installState, claudeResult.snapshot);
    if (claudeResult.error) errors.push(`Claude Code: ${claudeResult.error}`);

    codexResult = isNativeProjectionHarnessDisabled(options, "codex")
      ? skippedPermissionTarget(
          PERMISSION_PROJECTION_TARGET_IDS.codex,
          join(resolveNativeHarnessDir("codex", options.userHome), "config.toml"),
        )
      : await syncCodexPermissions(kilnYaml, policy, projectPath, kilnDir, installState, options, modelGateway);
    outcomes.push(...codexResult.outcomes);
    if (codexResult.rollback) rollbacks.push(codexResult.rollback);
    if (codexResult.snapshot) installState = upsertNativeProjectionTargetState(installState, codexResult.snapshot);
    for (const targetId of codexResult.removeTargetIds ?? [])
      installState = removeNativeProjectionTargetState(installState, targetId);
    if (codexResult.error) errors.push(`Codex: ${codexResult.error}`);

    opencodeResult = isNativeProjectionHarnessDisabled(options, "opencode")
      ? skippedPermissionTarget(
          PERMISSION_PROJECTION_TARGET_IDS.opencode,
          join(resolveNativeHarnessDir("opencode", options.userHome), "opencode.json"),
        )
      : await syncOpenCodePermissions(kilnYaml, policy, projectPath, kilnDir, installState, options, modelGateway);
    outcomes.push(...opencodeResult.outcomes);
    if (opencodeResult.rollback) rollbacks.push(opencodeResult.rollback);
    if (opencodeResult.snapshot)
      installState = upsertNativeProjectionTargetState(installState, opencodeResult.snapshot);
    if (opencodeResult.error) errors.push(`OpenCode: ${opencodeResult.error}`);
    if (!options.dryRun) writeNativeProjectionInstallState(kilnDir, installState);
  } catch (error) {
    rollbackNativeProjectionChanges(rollbacks, error);
  }

  return {
    claude: claudeResult.ok,
    codex: codexResult.ok,
    opencode: opencodeResult.ok,
    errors,
    outcomes,
  };
}

function skippedPermissionTarget(targetId = "permission-target", path = ""): PermissionTargetResult {
  return { ok: true, outcomes: [{ targetId, path, status: "skipped", reason: "native harness is disabled" }] };
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
      existing = requireRecord(JSON.parse(originalContent!), "configuration root must be an object");
    } catch (error) {
      return unreadablePermissionTarget(targetId, target, error);
    }
  }
  const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument: existing });
  if (drift && !options.force) {
    return {
      ok: false,
      error: `managed field drift detected: ${drift.driftedFields.join(", ")}`,
      outcomes: [
        {
          targetId,
          path: target,
          status: "blocked",
          reason: `managed field drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
        },
      ],
    };
  }

  const gatewayProjection = modelGateway ? buildClaudeMessagesProjection({ config: modelGateway }) : undefined;
  const projection = translateClaudePermissionProjection({
    policy,
    existingDocument: existing,
    gatewayProjection,
    previousManagedFields: installState.targets[targetId]?.managedFields,
    storedAuthorization: readTrustedExecutionAuthorization("claude-code", projectPath),
  });
  const snapshot = createNativeProjectionSnapshot({
    targetId: projection.targetId,
    filePath: target,
    document: projection.document,
    managedFields: projection.managedFields,
    permissionIntegrity: projection.integrity,
  });
  if (options.dryRun) {
    return {
      ok: true,
      outcomes: [{ targetId, path: target, status: "planned", reason: "write projected permission settings" }],
    };
  }
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
    outcomes: [{ targetId, path: target, status: "written" }],
  };
}

async function syncCodexPermissions(
  kilnYaml: KilnYaml,
  policy: KilnPermissionPolicy,
  projectPath: string,
  kilnDir: string,
  installState: NativeProjectionInstallState,
  options: NativePermissionProjectionOptions,
  modelGateway: ModelGatewayConfig | undefined,
): Promise<PermissionTargetResult> {
  const targetId = PERMISSION_PROJECTION_TARGET_IDS.codex;
  const target = join(resolveNativeHarnessDir("codex", options.userHome), "config.toml");
  const originalConfigContent = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  let doc: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      doc = requireRecord(parseToml(originalConfigContent!), "configuration root must be an object");
    } catch (error) {
      return unreadablePermissionTarget(targetId, target, error);
    }
  }
  const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument: doc });
  if (drift && !options.force) {
    return {
      ok: false,
      error: `managed field drift detected: ${drift.driftedFields.join(", ")}`,
      outcomes: [
        {
          targetId,
          path: target,
          status: "blocked",
          reason: `managed field drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
        },
      ],
    };
  }

  const catalogTargetId = "codex-model-catalog";
  const catalogState = installState.targets[catalogTargetId];
  const catalogPath = catalogState?.filePath ?? join(kilnDir, "projections", "codex-model-catalog.json");
  const gatewayProjection = modelGateway ? buildCodexResponsesProjection({ config: modelGateway }) : undefined;
  const originalCatalogContent = existsSync(catalogPath) ? readFileSync(catalogPath, "utf8") : undefined;
  const catalogDrift = catalogState
    ? detectNativeProjectionFileDrift({
        targetId: catalogTargetId,
        state: installState,
        currentContent: existsSync(catalogPath) ? readFileSync(catalogPath, "utf8") : "",
      })
    : undefined;
  const previousManagedFields = installState.targets[targetId]?.managedFields ?? [];
  const projection = translateCodexPermissionProjection({
    policy,
    existingDocument: doc,
    kilnYaml,
    ownsManagedDefault: installState.targets[targetId]?.managedFields.includes("model") === true,
    gatewayProjection,
    previousManagedFields,
    storedAuthorization: readTrustedExecutionAuthorization("codex", projectPath),
  });
  const snapshot = createNativeProjectionSnapshot({
    targetId: projection.targetId,
    filePath: target,
    document: projection.document,
    managedFields: projection.managedFields,
    permissionIntegrity: projection.integrity,
  });
  const removeTargetIds = catalogState ? [catalogTargetId] : [];
  const catalogOutcome: ProjectionOutcome | undefined = catalogState
    ? {
        targetId: catalogTargetId,
        path: catalogPath,
        status: options.dryRun ? "planned" : "removed",
        reason:
          catalogDrift && !options.force
            ? "detach install-state while preserving modified catalog file content"
            : "remove legacy managed model catalog",
      }
    : undefined;
  if (options.dryRun) {
    return {
      ok: true,
      removeTargetIds,
      outcomes: [
        { targetId, path: target, status: "planned", reason: "write projected permission settings" },
        ...(catalogOutcome ? [catalogOutcome] : []),
      ],
    };
  }
  ensureDir(dirname(target));
  backupNativeProjectionFile({ kilnDir, targetId, filePath: target });
  const rollback = () => {
    restoreFile(target, originalConfigContent);
    restoreFile(catalogPath, originalCatalogContent);
  };
  try {
    if (catalogState && (!catalogDrift || options.force)) rmSync(catalogPath, { force: true });
  } catch {
    return {
      ok: false,
      error: "legacy managed model catalog could not be removed safely",
      outcomes: [
        { targetId, path: target, status: "skipped", reason: "legacy model catalog removal failed" },
        {
          targetId: catalogTargetId,
          path: catalogPath,
          status: "failed",
          reason: "legacy managed model catalog could not be removed safely",
        },
      ],
    };
  }
  try {
    writeFileAtomically(target, stringifyToml(projection.document));
  } catch (error) {
    rollbackNativeProjectionChanges([rollback], error);
  }
  return {
    ok: true,
    snapshot,
    removeTargetIds,
    rollback,
    outcomes: [{ targetId, path: target, status: "written" }, ...(catalogOutcome ? [catalogOutcome] : [])],
  };
}

async function syncOpenCodePermissions(
  kilnYaml: KilnYaml,
  policy: KilnPermissionPolicy,
  projectPath: string,
  kilnDir: string,
  installState: NativeProjectionInstallState,
  options: NativePermissionProjectionOptions,
  modelGateway: ModelGatewayConfig | undefined,
): Promise<PermissionTargetResult> {
  const targetId = PERMISSION_PROJECTION_TARGET_IDS.opencode;
  const target = join(resolveNativeHarnessDir("opencode", options.userHome), "opencode.json");
  const originalContent = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  let existing: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      const stripped = stripJsonComments(originalContent!);
      existing = requireRecord(JSON.parse(stripped), "configuration root must be an object");
    } catch (error) {
      return unreadablePermissionTarget(targetId, target, error);
    }
  }
  const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument: existing });
  if (drift && !options.force) {
    return {
      ok: false,
      error: `managed field drift detected: ${drift.driftedFields.join(", ")}`,
      outcomes: [
        {
          targetId,
          path: target,
          status: "blocked",
          reason: `managed field drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
        },
      ],
    };
  }

  const gatewayProjection = modelGateway ? buildOpenCodeResponsesProjection({ config: modelGateway }) : undefined;
  const projection = translateOpenCodePermissionProjection({
    policy,
    existingDocument: existing,
    kilnYaml,
    ownsManagedDefault: installState.targets[targetId]?.managedFields.includes("model") === true,
    gatewayProjection,
    previousManagedFields: installState.targets[targetId]?.managedFields,
    storedAuthorization: readTrustedExecutionAuthorization("opencode", projectPath),
  });
  const snapshot = createNativeProjectionSnapshot({
    targetId: projection.targetId,
    filePath: target,
    document: projection.document,
    managedFields: projection.managedFields,
    ...(gatewayProjection?.managedFields.includes("enabled_providers")
      ? { managedArrayItems: { enabled_providers: ["kiln"] } }
      : {}),
    permissionIntegrity: projection.integrity,
  });
  if (options.dryRun) {
    return {
      ok: true,
      outcomes: [{ targetId, path: target, status: "planned", reason: "write projected permission settings" }],
    };
  }
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
    outcomes: [{ targetId, path: target, status: "written" }],
  };
}

function readCanonicalModelGateway(kilnDir: string): ModelGatewayConfig | undefined {
  const path = join(kilnDir, "gateway.yaml");
  if (!existsSync(path)) return undefined;
  return parseGatewayYaml(readFileSync(path, "utf8")).modelGateway;
}

function unreadablePermissionTarget(targetId: string, path: string, error: unknown): PermissionTargetResult {
  const detail = error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "unknown parse error";
  const reason = `native configuration is unreadable and was not modified: ${detail}`;
  return { ok: false, error: reason, outcomes: [{ targetId, path, status: "failed", reason }] };
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
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
    try {
      rollbacks[index]!();
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  if (rollbackErrors.length > 0)
    throw new AggregateError(
      [originalError, ...rollbackErrors],
      "Native projection sync failed and rollback was incomplete.",
    );
  throw originalError;
}
