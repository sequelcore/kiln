import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_HOOK_CONTENT = `#!/bin/sh
# Kiln autoformat hook
# Add your project-specific formatting commands here

# Example: run prettier on staged files
# npx prettier --write "\${staged_files}"

# Example: run eslint auto-fix
# npx eslint --fix "\${staged_files}"

# Example: run rustfmt
# cargo fmt --

# Exit 0 to allow, non-zero to block the commit
exit 0
`;

export interface NativeHookProjectionResult {
  claudeHook: boolean;
  codexHook: boolean;
  skippedWindows: boolean;
  errors: string[];
}

export async function syncNativeHookProjections(
  projectPath: string,
  kilnDir: string,
): Promise<NativeHookProjectionResult> {
  const errors: string[] = [];

  const sourcePath = join(kilnDir, "hooks", "autoformat.sh");
  const sourceContent = existsSync(sourcePath)
    ? readFileSync(sourcePath, "utf-8")
    : DEFAULT_HOOK_CONTENT;

  if (!existsSync(join(kilnDir, "hooks"))) {
    mkdirSync(join(kilnDir, "hooks"), { recursive: true });
  }
  if (!existsSync(sourcePath)) {
    writeFileSync(sourcePath, DEFAULT_HOOK_CONTENT, "utf-8");
  }

  const [claudeResult, codexResult] = await Promise.allSettled([
    syncClaudeHook(projectPath, sourceContent),
    syncCodexHook(projectPath, sourceContent),
  ]);

  const claudeHook = claudeResult.status === "fulfilled" ? claudeResult.value : false;
  if (claudeResult.status === "rejected") {
    errors.push(`Claude Code: ${claudeResult.reason instanceof Error ? claudeResult.reason.message : String(claudeResult.reason)}`);
  }

  const skippedWindows = process.platform === "win32";
  const codexHook = skippedWindows
    ? false
    : codexResult.status === "fulfilled"
      ? codexResult.value
      : false;
  if (!skippedWindows && codexResult.status === "rejected") {
    errors.push(`Codex: ${codexResult.reason instanceof Error ? codexResult.reason.message : String(codexResult.reason)}`);
  }

  return { claudeHook, codexHook, skippedWindows, errors };
}

async function syncClaudeHook(
  projectPath: string,
  sourceContent: string,
): Promise<boolean> {
  const hooksDir = join(projectPath, ".claude", "hooks");
  const hookPath = join(hooksDir, "autoformat.sh");

  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  writeFileSync(hookPath, sourceContent, "utf-8");

  const settingsPath = join(projectPath, ".claude", "settings.json");
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      settings = {};
    }
  }

  const existingHooks = (settings["hooks"] as Record<string, unknown> | undefined) ?? {};
  const autoformatEntry: Record<string, unknown> = {
    command: "sh",
    args: [".claude/hooks/autoformat.sh"],
    always: true,
  };
  const hooks = { ...existingHooks, autoformat: autoformatEntry };

  const merged = { ...settings, hooks };
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");

  return true;
}

async function syncCodexHook(
  projectPath: string,
  sourceContent: string,
): Promise<boolean> {
  if (process.platform === "win32") {
    return false;
  }

  const hooksDir = join(projectPath, ".codex", "hooks");
  const hookPath = join(hooksDir, "autoformat.sh");

  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  writeFileSync(hookPath, sourceContent, "utf-8");

  return true;
}
