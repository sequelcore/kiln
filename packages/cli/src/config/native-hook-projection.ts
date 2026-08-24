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
import { backupNativeProjectionFile } from "./native-projection-backup.js";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "../application/private-project-state-filesystem.js";
import {
  describeProjectionDrift,
  isNativeProjectionHarnessDisabled,
  type ProjectionOutcome,
  type NativeProjectionSyncOptions,
} from "./native-projection-policy.js";

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
  outcomes: readonly ProjectionOutcome[];
}

export interface NativeHookProjectionOptions extends NativeProjectionSyncOptions {
  /** Established private state root when `kilnDir` is project-owned state. */
  readonly privateStateRoot?: string;
}

interface HookTargetResult {
  readonly ok: boolean;
  readonly snapshots: readonly NativeProjectionTargetState[];
  readonly error?: string;
  readonly outcomes: readonly ProjectionOutcome[];
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
  const outcomes: ProjectionOutcome[] = [];
  let installState = readNativeProjectionInstallState(kilnDir);

  const sourcePath = join(kilnDir, "hooks", "autoformat.sh");
  if (!options.dryRun && options.privateStateRoot !== undefined) {
    ensurePrivateStateDirectorySync(options.privateStateRoot, join(kilnDir, "hooks"));
  }
  const sourceContent = existsSync(sourcePath)
    ? readFileSync(sourcePath, "utf-8")
    : DEFAULT_HOOK_CONTENT;

  const sourceExists = existsSync(sourcePath);
  if (!options.dryRun && !existsSync(join(kilnDir, "hooks"))) {
    mkdirSync(join(kilnDir, "hooks"), { recursive: true });
  }
  if (!options.dryRun && !sourceExists) {
    if (options.privateStateRoot !== undefined) {
      assertPrivateStateFileTargetSync(options.privateStateRoot, sourcePath);
    }
    writeFileSync(sourcePath, DEFAULT_HOOK_CONTENT, "utf-8");
  }
  outcomes.push({
    targetId: "autoformat-hook-source",
    path: sourcePath,
    status: sourceExists ? "unchanged" : options.dryRun ? "planned" : "written",
    ...(!sourceExists ? { reason: "create default hook source file content" } : {}),
  });

  let claudeHook = true;
  if (!isNativeProjectionHarnessDisabled(options, "claude")) {
    claudeHook = false;
    try {
      const claudeResult = await syncClaudeHook(projectPath, kilnDir, sourceContent, installState, options);
      outcomes.push(...claudeResult.outcomes);
      claudeHook = claudeResult.ok;
      for (const snapshot of claudeResult.snapshots) {
        installState = upsertNativeProjectionTargetState(installState, snapshot);
      }
      if (claudeResult.error) {
        errors.push(`Claude Code: ${claudeResult.error}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`Claude Code: ${reason}`);
      outcomes.push({ targetId: "claude-hooks", path: join(projectPath, ".claude"), status: "failed", reason });
    }
  } else {
    outcomes.push(
      { targetId: HOOK_PROJECTION_TARGET_IDS.claudeFile, path: join(projectPath, ".claude", "hooks", "autoformat.sh"), status: "skipped", reason: "Claude harness is disabled" },
      { targetId: HOOK_PROJECTION_TARGET_IDS.claudeSettings, path: join(projectPath, ".claude", "settings.json"), status: "skipped", reason: "Claude harness is disabled" },
    );
  }

  const skippedWindows = process.platform === "win32";
  let codexHook = true;
  if (!skippedWindows && !isNativeProjectionHarnessDisabled(options, "codex")) {
    codexHook = false;
    try {
      const codexResult = await syncCodexHook(projectPath, kilnDir, sourceContent, installState, options);
      outcomes.push(...codexResult.outcomes);
      codexHook = codexResult.ok;
      for (const snapshot of codexResult.snapshots) {
        installState = upsertNativeProjectionTargetState(installState, snapshot);
      }
      if (codexResult.error) {
        errors.push(`Codex: ${codexResult.error}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`Codex: ${reason}`);
      outcomes.push({ targetId: HOOK_PROJECTION_TARGET_IDS.codexFile, path: join(projectPath, ".codex", "hooks", "autoformat.sh"), status: "failed", reason });
    }
  } else {
    outcomes.push({
      targetId: HOOK_PROJECTION_TARGET_IDS.codexFile,
      path: join(projectPath, ".codex", "hooks", "autoformat.sh"),
      status: "skipped",
      reason: skippedWindows ? "Codex hooks are not supported on Windows" : "Codex harness is disabled",
    });
  }

  if (!options.dryRun) {
    writeNativeProjectionInstallState(kilnDir, installState, options.privateStateRoot);
  }

  return { claudeHook, codexHook, skippedWindows, errors, outcomes };
}

async function syncClaudeHook(
  projectPath: string,
  kilnDir: string,
  sourceContent: string,
  installState: NativeProjectionInstallState,
  options: NativeHookProjectionOptions,
): Promise<HookTargetResult> {
  const snapshots: NativeProjectionTargetState[] = [];
  const outcomes: ProjectionOutcome[] = [];
  const hooksDir = join(projectPath, ".claude", "hooks");
  const hookPath = join(hooksDir, "autoformat.sh");

  if (!options.dryRun && !existsSync(hooksDir)) {
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
        error: `managed file drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
        outcomes: [
          { targetId: HOOK_PROJECTION_TARGET_IDS.claudeFile, path: hookPath, status: "blocked", reason: `managed drift detected: ${describeProjectionDrift(drift.driftedFields)}` },
          { targetId: HOOK_PROJECTION_TARGET_IDS.claudeSettings, path: join(projectPath, ".claude", "settings.json"), status: "skipped", reason: "hook file content is blocked" },
        ],
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
        error: `managed field drift detected: ${describeProjectionDrift(settingsDrift.driftedFields)}`,
        outcomes: [
          { targetId: HOOK_PROJECTION_TARGET_IDS.claudeFile, path: hookPath, status: "skipped", reason: "settings projection is blocked" },
          { targetId: HOOK_PROJECTION_TARGET_IDS.claudeSettings, path: settingsPath, status: "blocked", reason: `managed field drift detected: ${describeProjectionDrift(settingsDrift.driftedFields)}` },
        ],
      };
  }

  const existingHooks = (settings["hooks"] as Record<string, unknown> | undefined) ?? {};
  const autoformatEntry: Record<string, unknown> = {
    command: "sh",
    args: [".claude/hooks/autoformat.sh"],
    always: true,
  };
  const hooks = { ...existingHooks, autoformat: autoformatEntry };

  const merged = { ...settings, hooks };
  if (options.dryRun) {
    return {
      ok: true,
      snapshots,
      outcomes: [
        { targetId: HOOK_PROJECTION_TARGET_IDS.claudeFile, path: hookPath, status: "planned", reason: "write projected hook file content" },
        { targetId: HOOK_PROJECTION_TARGET_IDS.claudeSettings, path: settingsPath, status: "planned", reason: "write projected hook settings" },
      ],
    };
  }
  backupNativeProjectionFile({
    kilnDir,
    privateStateRoot: options.privateStateRoot,
    targetId: HOOK_PROJECTION_TARGET_IDS.claudeFile,
    filePath: hookPath,
  });
  writeFileSync(hookPath, sourceContent, "utf-8");
  snapshots.push(createNativeProjectionFileSnapshot({
    targetId: HOOK_PROJECTION_TARGET_IDS.claudeFile,
    filePath: hookPath,
    content: sourceContent,
  }));

  backupNativeProjectionFile({
    kilnDir,
    privateStateRoot: options.privateStateRoot,
    targetId: HOOK_PROJECTION_TARGET_IDS.claudeSettings,
    filePath: settingsPath,
  });
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  snapshots.push(createNativeProjectionSnapshot({
    targetId: HOOK_PROJECTION_TARGET_IDS.claudeSettings,
    filePath: settingsPath,
    document: merged,
    managedFields: ["hooks.autoformat"],
  }));

  outcomes.push(
    { targetId: HOOK_PROJECTION_TARGET_IDS.claudeFile, path: hookPath, status: "written" },
    { targetId: HOOK_PROJECTION_TARGET_IDS.claudeSettings, path: settingsPath, status: "written" },
  );
  return { ok: true, snapshots, outcomes };
}

async function syncCodexHook(
  projectPath: string,
  kilnDir: string,
  sourceContent: string,
  installState: NativeProjectionInstallState,
  options: NativeHookProjectionOptions,
): Promise<HookTargetResult> {
  if (process.platform === "win32") {
    return { ok: false, snapshots: [], outcomes: [] };
  }

  const hooksDir = join(projectPath, ".codex", "hooks");
  const hookPath = join(hooksDir, "autoformat.sh");

  if (!options.dryRun && !existsSync(hooksDir)) {
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
        error: `managed file drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
        outcomes: [{ targetId: HOOK_PROJECTION_TARGET_IDS.codexFile, path: hookPath, status: "blocked", reason: `managed drift detected: ${describeProjectionDrift(drift.driftedFields)}` }],
      };
    }
  }

  if (options.dryRun) {
    return {
      ok: true,
      snapshots: [],
      outcomes: [{ targetId: HOOK_PROJECTION_TARGET_IDS.codexFile, path: hookPath, status: "planned", reason: "write projected hook file content" }],
    };
  }
  backupNativeProjectionFile({
    kilnDir,
    privateStateRoot: options.privateStateRoot,
    targetId: HOOK_PROJECTION_TARGET_IDS.codexFile,
    filePath: hookPath,
  });
  writeFileSync(hookPath, sourceContent, "utf-8");

  return {
    ok: true,
    snapshots: [createNativeProjectionFileSnapshot({
      targetId: HOOK_PROJECTION_TARGET_IDS.codexFile,
      filePath: hookPath,
      content: sourceContent,
    })],
    outcomes: [{ targetId: HOOK_PROJECTION_TARGET_IDS.codexFile, path: hookPath, status: "written" }],
  };
}
