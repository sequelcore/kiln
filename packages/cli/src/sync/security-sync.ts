import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { translatePermission } from "../wrapper/session-registry.js";
import type { KilnPermissionPolicy } from "../wrapper/session.js";
import type { KilnYaml } from "../kiln-yaml-types.js";

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

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export async function syncPermissions(
  kilnYaml: KilnYaml,
  projectPath: string,
): Promise<SyncResult> {
  const errors: string[] = [];
  const policy = kilnYaml.permissions ?? DEFAULT_POLICY;

  const [claudeResult, codexResult, opencodeResult] = await Promise.allSettled([
    syncClaudePermissions(policy, projectPath),
    syncCodexPermissions(policy),
    syncOpenCodePermissions(policy),
  ]);

  const claude = claudeResult.status === "fulfilled" ? claudeResult.value : false;
  if (claudeResult.status === "rejected") {
    errors.push(`Claude Code: ${claudeResult.reason instanceof Error ? claudeResult.reason.message : String(claudeResult.reason)}`);
  }

  const codex = codexResult.status === "fulfilled" ? codexResult.value : false;
  if (codexResult.status === "rejected") {
    errors.push(`Codex: ${codexResult.reason instanceof Error ? codexResult.reason.message : String(codexResult.reason)}`);
  }

  const opencode = opencodeResult.status === "fulfilled" ? opencodeResult.value : false;
  if (opencodeResult.status === "rejected") {
    errors.push(`OpenCode: ${opencodeResult.reason instanceof Error ? opencodeResult.reason.message : String(opencodeResult.reason)}`);
  }

  return { claude, codex, opencode, errors };
}

async function syncClaudePermissions(
  policy: KilnPermissionPolicy,
  projectPath: string,
): Promise<boolean> {
  const target = join(projectPath, ".claude", "settings.json");
  let existing: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      existing = JSON.parse(readFileSync(target, "utf-8"));
    } catch {
      existing = {};
    }
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

  const merged: Record<string, unknown> = { ...existing, permissions };
  ensureDir(dirname(target));
  writeFileSync(target, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return true;
}

async function syncCodexPermissions(policy: KilnPermissionPolicy): Promise<boolean> {
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

  const translated = translatePermission(policy, "codex");
  const cfg = translated.config as { approvalMode: string; sandboxMode: string };

  const approvalPolicy = cfg.approvalMode;
  const sandboxMode = cfg.sandboxMode;

  const merged: Record<string, unknown> = {
    ...doc,
    approval_policy: approvalPolicy,
    sandbox_mode: sandboxMode,
  };

  ensureDir(dirname(target));
  writeFileSync(target, stringifyToml(merged as Record<string, unknown>), "utf-8");
  return true;
}

async function syncOpenCodePermissions(policy: KilnPermissionPolicy): Promise<boolean> {
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

  const translated = translatePermission(policy, "opencode");
  const cfg = translated.config as { permissionDefault: string };

  const permission = { default: cfg.permissionDefault };

  const merged: Record<string, unknown> = { ...existing, permission };
  ensureDir(dirname(target));
  writeFileSync(target, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return true;
}
