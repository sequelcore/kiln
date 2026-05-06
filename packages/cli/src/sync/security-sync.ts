import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { stripJsonComments } from "../config/json-comments.js";
import { translateClaudePermissionProjection } from "../config/translators/claude-translator.js";
import { translateCodexPermissionProjection } from "../config/translators/codex-translator.js";
import { translateOpenCodePermissionProjection } from "../config/translators/opencode-translator.js";
import { PERMISSION_PROJECTION_TARGET_IDS } from "../config/translators/permission-projection.js";
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
} from "../config/native-projection-state.js";

const DEFAULT_POLICY: KilnPermissionPolicy = { approval: "on-request", sandbox: "read-only" };

export interface SyncResult {
  claude: boolean;
  codex: boolean;
  opencode: boolean;
  errors: string[];
}

export interface SyncPermissionsOptions {
  readonly force?: boolean;
}

interface PermissionTargetResult {
  readonly ok: boolean;
  readonly snapshot?: NativeProjectionTargetState;
  readonly error?: string;
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

export async function syncPermissions(
  kilnYaml: KilnYaml,
  projectPath: string,
  options: SyncPermissionsOptions = {},
): Promise<SyncResult> {
  const errors: string[] = [];
  const policy = kilnYaml.permissions ?? DEFAULT_POLICY;
  const kilnDir = join(projectPath, ".kiln");
  let installState = readNativeProjectionInstallState(kilnDir);

  const claudeResult = await syncClaudePermissions(policy, projectPath, installState, options);
  if (claudeResult.snapshot) {
    installState = upsertNativeProjectionTargetState(installState, claudeResult.snapshot);
  }
  if (claudeResult.error) {
    errors.push(`Claude Code: ${claudeResult.error}`);
  }

  const codexResult = await syncCodexPermissions(policy, installState, options);
  if (codexResult.snapshot) {
    installState = upsertNativeProjectionTargetState(installState, codexResult.snapshot);
  }
  if (codexResult.error) {
    errors.push(`Codex: ${codexResult.error}`);
  }

  const opencodeResult = await syncOpenCodePermissions(policy, installState, options);
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

async function syncClaudePermissions(
  policy: KilnPermissionPolicy,
  projectPath: string,
  installState: NativeProjectionInstallState,
  options: SyncPermissionsOptions,
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
  policy: KilnPermissionPolicy,
  installState: NativeProjectionInstallState,
  options: SyncPermissionsOptions,
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

  const projection = translateCodexPermissionProjection({ policy, existingDocument: doc });
  ensureDir(dirname(target));
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
  policy: KilnPermissionPolicy,
  installState: NativeProjectionInstallState,
  options: SyncPermissionsOptions,
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

  const projection = translateOpenCodePermissionProjection({ policy, existingDocument: existing });
  ensureDir(dirname(target));
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
