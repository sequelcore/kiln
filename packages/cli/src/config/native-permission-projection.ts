import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
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
import {
  createNativeProjectionSnapshot,
  detectNativeProjectionDrift,
  readNativeProjectionInstallState,
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
  readonly error?: string;
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
  let installState = readNativeProjectionInstallState(kilnDir);

  const claudeResult = isNativeProjectionHarnessDisabled(options, "claude")
    ? skippedPermissionTarget()
    : await syncClaudePermissions(policy, projectPath, installState, options);
  if (claudeResult.snapshot) {
    installState = upsertNativeProjectionTargetState(installState, claudeResult.snapshot);
  }
  if (claudeResult.error) {
    errors.push(`Claude Code: ${claudeResult.error}`);
  }

  const codexResult = isNativeProjectionHarnessDisabled(options, "codex")
    ? skippedPermissionTarget()
    : await syncCodexPermissions(kilnYaml, policy, kilnDir, installState, options);
  if (codexResult.snapshot) {
    installState = upsertNativeProjectionTargetState(installState, codexResult.snapshot);
  }
  if (codexResult.error) {
    errors.push(`Codex: ${codexResult.error}`);
  }

  const opencodeResult = isNativeProjectionHarnessDisabled(options, "opencode")
    ? skippedPermissionTarget()
    : await syncOpenCodePermissions(kilnYaml, policy, kilnDir, installState, options);
  if (opencodeResult.snapshot) {
    installState = upsertNativeProjectionTargetState(installState, opencodeResult.snapshot);
  }
  if (opencodeResult.error) {
    errors.push(`OpenCode: ${opencodeResult.error}`);
  }

  writeNativeProjectionInstallState(kilnDir, installState);

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
): Promise<PermissionTargetResult> {
  const targetId = PERMISSION_PROJECTION_TARGET_IDS.claude;
  const target = join(projectPath, ".claude", "settings.json");
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

  const projection = translateClaudePermissionProjection({ policy, existingDocument: existing });
  ensureDir(dirname(target));
  backupNativeProjectionFile({ kilnDir: join(projectPath, ".kiln"), targetId, filePath: target });
  writeFileSync(target, JSON.stringify(projection.document, null, 2) + "\n", "utf-8");
  return {
    ok: true,
    snapshot: createNativeProjectionSnapshot({
      targetId: projection.targetId,
      filePath: target,
      document: projection.document,
      managedFields: projection.managedFields,
    }),
  };
}

async function syncCodexPermissions(
  kilnYaml: KilnYaml,
  policy: KilnPermissionPolicy,
  kilnDir: string,
  installState: NativeProjectionInstallState,
  options: NativePermissionProjectionOptions,
): Promise<PermissionTargetResult> {
  const targetId = PERMISSION_PROJECTION_TARGET_IDS.codex;
  const target = join(os.homedir(), ".codex", "config.toml");
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

  const projection = translateCodexPermissionProjection({
    policy,
    existingDocument: doc,
    kilnYaml,
    ownsManagedDefault: installState.targets[targetId]?.managedFields.includes("model") === true,
  });
  ensureDir(dirname(target));
  backupNativeProjectionFile({ kilnDir, targetId, filePath: target });
  writeFileSync(target, stringifyToml(projection.document), "utf-8");
  return {
    ok: true,
    snapshot: createNativeProjectionSnapshot({
      targetId: projection.targetId,
      filePath: target,
      document: projection.document,
      managedFields: projection.managedFields,
    }),
  };
}

async function syncOpenCodePermissions(
  kilnYaml: KilnYaml,
  policy: KilnPermissionPolicy,
  kilnDir: string,
  installState: NativeProjectionInstallState,
  options: NativePermissionProjectionOptions,
): Promise<PermissionTargetResult> {
  const targetId = PERMISSION_PROJECTION_TARGET_IDS.opencode;
  const target = join(os.homedir(), ".config", "opencode", "opencode.json");
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

  const projection = translateOpenCodePermissionProjection({
    policy,
    existingDocument: existing,
    kilnYaml,
    ownsManagedDefault: installState.targets[targetId]?.managedFields.includes("model") === true,
  });
  ensureDir(dirname(target));
  backupNativeProjectionFile({ kilnDir, targetId, filePath: target });
  writeFileSync(target, JSON.stringify(projection.document, null, 2) + "\n", "utf-8");
  return {
    ok: true,
    snapshot: createNativeProjectionSnapshot({
      targetId: projection.targetId,
      filePath: target,
      document: projection.document,
      managedFields: projection.managedFields,
    }),
  };
}
