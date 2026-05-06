import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { translatePermission } from "../wrapper/session-registry.js";
import type { BackendConfig } from "../wrapper/session-registry.js";
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

const DEFAULT_POLICY: KilnPermissionPolicy = { approval: "on-request", sandbox: "read-only" };

function stripJsonComments(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    let inString = false;
    let commentIndex = -1;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"' && (i === 0 || line[i - 1]! !== "\\")) {
        inString = !inString;
      } else if (!inString && ch === "/" && i + 1 < line.length && line[i + 1] === "/") {
        commentIndex = i;
        break;
      }
    }
    if (commentIndex >= 0) {
      result.push(line.slice(0, commentIndex).trimEnd());
    } else {
      result.push(line);
    }
  }
  return result.join("\n");
}

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

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

interface PermissionSyncMetadata {
  backend: string;
  representableRules: readonly unknown[];
  unsupportedRules: readonly unknown[];
  constraintInstructions: readonly string[];
  warnings: readonly string[];
  nativeRules: unknown;
}

function toPermissionSyncMetadata(translated: BackendConfig): PermissionSyncMetadata {
  return {
    backend: translated.backend,
    representableRules: translated.representableRules.map((rule) => ({ ...rule })),
    unsupportedRules: translated.unsupportedRules.map((rule) => ({ ...rule })),
    constraintInstructions: [...translated.constraintInstructions],
    warnings: [...translated.warnings],
    nativeRules: translated.nativeRules,
  };
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
  const targetId = "claude-settings";
  const target = join(projectPath, ".claude", "settings.json");
  const managedFields = ["permissions", "kiln.permissionSync"];
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

  const translated = translatePermission(policy, "claude");
  const cfg = translated.config as { permissionMode: string; allowDangerouslySkipPermissions: boolean };

  const allow: string[] = [];
  const deny: string[] = [];

  if (cfg.allowDangerouslySkipPermissions) {
    allow.push("Write", "Edit", "Bash", "NotebookEdit", "WebFetch", "Read");
  } else if (cfg.permissionMode === "default") {
    allow.push("Read", "WebFetch");
  } else if (cfg.permissionMode === "plan") {
    deny.push("Write", "Edit", "Bash", "NotebookEdit", "WebFetch");
  }

  const permissions = { allow, deny };
  const kiln = {
    ...asRecord(existing.kiln),
    permissionSync: toPermissionSyncMetadata(translated),
  };

  const merged: Record<string, unknown> = { ...existing, permissions, kiln };
  ensureDir(dirname(target));
  writeFileSync(target, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return {
    ok: true,
    snapshot: createNativeProjectionSnapshot({
      targetId,
      filePath: target,
      document: merged,
      managedFields,
    }),
  };
}

async function syncCodexPermissions(
  policy: KilnPermissionPolicy,
  installState: NativeProjectionInstallState,
  options: SyncPermissionsOptions,
): Promise<PermissionTargetResult> {
  const targetId = "codex-config";
  const target = join(os.homedir(), ".codex", "config.toml");
  const managedFields = ["approval_policy", "sandbox_mode", "kiln.permission_sync"];
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

  const translated = translatePermission(policy, "codex");
  const cfg = translated.config as { approvalMode: string; sandboxMode: string };

  const approvalPolicy = cfg.approvalMode;
  const sandboxMode = cfg.sandboxMode;

  const merged: Record<string, unknown> = {
    ...doc,
    approval_policy: approvalPolicy,
    sandbox_mode: sandboxMode,
    kiln: {
      ...asRecord(doc.kiln),
      permission_sync: toPermissionSyncMetadata(translated),
    },
  };

  ensureDir(dirname(target));
  writeFileSync(target, stringifyToml(merged as Record<string, unknown>), "utf-8");
  return {
    ok: true,
    snapshot: createNativeProjectionSnapshot({
      targetId,
      filePath: target,
      document: merged,
      managedFields,
    }),
  };
}

async function syncOpenCodePermissions(
  policy: KilnPermissionPolicy,
  installState: NativeProjectionInstallState,
  options: SyncPermissionsOptions,
): Promise<PermissionTargetResult> {
  const targetId = "opencode-config";
  const target = join(os.homedir(), ".config", "opencode", "opencode.json");
  const managedFields = ["permission", "kiln.permissionSync"];
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

  const translated = translatePermission(policy, "opencode");
  const cfg = translated.config as { permissionDefault: string };

  const permission = { default: cfg.permissionDefault };
  const kiln = {
    ...asRecord(existing.kiln),
    permissionSync: toPermissionSyncMetadata(translated),
  };

  const merged: Record<string, unknown> = { ...existing, permission, kiln };
  ensureDir(dirname(target));
  writeFileSync(target, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return {
    ok: true,
    snapshot: createNativeProjectionSnapshot({
      targetId,
      filePath: target,
      document: merged,
      managedFields,
    }),
  };
}
