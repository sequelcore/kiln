import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createNativeProjectionFileSnapshot,
  createNativeProjectionSnapshot,
  detectNativeProjectionDrift,
  detectNativeProjectionFileDrift,
  readNativeProjectionInstallState,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
} from "./native-projection-state.js";

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

export interface NativeHookProjectionOptions {
  readonly force?: boolean;
}

interface HookTargetResult {
  readonly ok: boolean;
  readonly snapshots: readonly NativeProjectionTargetState[];
  readonly error?: string;
}

const HOOK_PROJECTION_TARGET_IDS = {
  claudeSettings: "claude-hook-settings",
  claudeFile: "claude-autoformat-hook",
  codexFile: "codex-autoformat-hook",
} as const;

export async function syncNativeHookProjections(
  projectPath: string,
  kilnDir: string,
  options: NativeHookProjectionOptions = {},
): Promise<NativeHookProjectionResult> {
  const errors: string[] = [];
  let installState = readNativeProjectionInstallState(kilnDir);

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
    syncClaudeHook(projectPath, sourceContent, installState, options),
    syncCodexHook(projectPath, sourceContent, installState, options),
  ]);

  const claudeHook = claudeResult.status === "fulfilled" ? claudeResult.value.ok : false;
  if (claudeResult.status === "fulfilled") {
    for (const snapshot of claudeResult.value.snapshots) {
      installState = upsertNativeProjectionTargetState(installState, snapshot);
    }
  }
  if (claudeResult.status === "rejected") {
    errors.push(`Claude Code: ${claudeResult.reason instanceof Error ? claudeResult.reason.message : String(claudeResult.reason)}`);
  } else if (claudeResult.value.error) {
    errors.push(`Claude Code: ${claudeResult.value.error}`);
  }

  const skippedWindows = process.platform === "win32";
  const codexHook = skippedWindows
    ? false
    : codexResult.status === "fulfilled"
      ? codexResult.value.ok
      : false;
  if (!skippedWindows && codexResult.status === "fulfilled") {
    for (const snapshot of codexResult.value.snapshots) {
      installState = upsertNativeProjectionTargetState(installState, snapshot);
    }
  }
  if (!skippedWindows && codexResult.status === "rejected") {
    errors.push(`Codex: ${codexResult.reason instanceof Error ? codexResult.reason.message : String(codexResult.reason)}`);
  } else if (!skippedWindows && codexResult.status === "fulfilled" && codexResult.value.error) {
    errors.push(`Codex: ${codexResult.value.error}`);
  }

  writeNativeProjectionInstallState(kilnDir, installState);

  return { claudeHook, codexHook, skippedWindows, errors };
}

async function syncClaudeHook(
  projectPath: string,
  sourceContent: string,
  installState: NativeProjectionInstallState,
  options: NativeHookProjectionOptions,
): Promise<HookTargetResult> {
  const snapshots: NativeProjectionTargetState[] = [];
  const hooksDir = join(projectPath, ".claude", "hooks");
  const hookPath = join(hooksDir, "autoformat.sh");

  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  if (existsSync(hookPath)) {
    const drift = detectNativeProjectionFileDrift({
      targetId: HOOK_PROJECTION_TARGET_IDS.claudeFile,
      state: installState,
      currentContent: readFileSync(hookPath, "utf-8"),
    });
    if (drift && !options.force) {
      return {
        ok: false,
        snapshots,
        error: `managed file drift detected: ${drift.driftedFields.join(", ")}`,
      };
    }
  }

  const settingsPath = join(projectPath, ".claude", "settings.json");
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      settings = {};
    }
  }

  const settingsDrift = detectNativeProjectionDrift({
    targetId: HOOK_PROJECTION_TARGET_IDS.claudeSettings,
    state: installState,
    currentDocument: settings,
  });
  if (settingsDrift && !options.force) {
    return {
      ok: false,
      snapshots,
      error: `managed field drift detected: ${settingsDrift.driftedFields.join(", ")}`,
    };
  }

  writeFileSync(hookPath, sourceContent, "utf-8");
  snapshots.push(createNativeProjectionFileSnapshot({
    targetId: HOOK_PROJECTION_TARGET_IDS.claudeFile,
    filePath: hookPath,
    content: sourceContent,
  }));

  const existingHooks = (settings["hooks"] as Record<string, unknown> | undefined) ?? {};
  const autoformatEntry: Record<string, unknown> = {
    command: "sh",
    args: [".claude/hooks/autoformat.sh"],
    always: true,
  };
  const hooks = { ...existingHooks, autoformat: autoformatEntry };

  const merged = { ...settings, hooks };
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  snapshots.push(createNativeProjectionSnapshot({
    targetId: HOOK_PROJECTION_TARGET_IDS.claudeSettings,
    filePath: settingsPath,
    document: merged,
    managedFields: ["hooks.autoformat"],
  }));

  return { ok: true, snapshots };
}

async function syncCodexHook(
  projectPath: string,
  sourceContent: string,
  installState: NativeProjectionInstallState,
  options: NativeHookProjectionOptions,
): Promise<HookTargetResult> {
  if (process.platform === "win32") {
    return { ok: false, snapshots: [] };
  }

  const hooksDir = join(projectPath, ".codex", "hooks");
  const hookPath = join(hooksDir, "autoformat.sh");

  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  if (existsSync(hookPath)) {
    const drift = detectNativeProjectionFileDrift({
      targetId: HOOK_PROJECTION_TARGET_IDS.codexFile,
      state: installState,
      currentContent: readFileSync(hookPath, "utf-8"),
    });
    if (drift && !options.force) {
      return {
        ok: false,
        snapshots: [],
        error: `managed file drift detected: ${drift.driftedFields.join(", ")}`,
      };
    }
  }

  writeFileSync(hookPath, sourceContent, "utf-8");

  return {
    ok: true,
    snapshots: [createNativeProjectionFileSnapshot({
      targetId: HOOK_PROJECTION_TARGET_IDS.codexFile,
      filePath: hookPath,
      content: sourceContent,
    })],
  };
}
