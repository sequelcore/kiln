import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { stripJsonComments } from "../config/json-comments.js";
import {
  detectNativeProjectionDrift,
  detectNativeProjectionFileDrift,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  stripManagedFields,
  writeNativeProjectionInstallState,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
} from "../config/native-projection-state.js";
import type { KilnAppConfig } from "../config.js";

export interface UninstallNativeOptions {
  readonly target?: string;
  readonly force?: boolean;
}

export interface UninstallNativeResult {
  readonly removed: readonly string[];
  readonly skipped: readonly string[];
  readonly errors: readonly string[];
}

const TARGET_ALIASES: Readonly<Record<string, string>> = {
  claude: "claude-settings",
  "claude-settings": "claude-settings",
  codex: "codex-config",
  "codex-config": "codex-config",
  opencode: "opencode-config",
  "opencode-config": "opencode-config",
};

const HARNESS_TARGETS = new Set(["claude", "codex", "opencode"]);

export async function uninstallCommand(
  _appConfig: KilnAppConfig,
  targetArg: string | undefined,
  args: readonly string[],
): Promise<void> {
  const result = uninstallNativeTargets(process.cwd(), {
    target: targetArg,
    force: args.includes("--force"),
  });

  for (const targetId of result.removed) {
    console.log(`Uninstalled managed native fields from ${targetId}.`);
  }
  for (const targetId of result.skipped) {
    console.log(`Skipped ${targetId}.`);
  }
  if (result.errors.length > 0) {
    console.error("Errors:");
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
}

export function uninstallNativeTargets(projectPath: string, options: UninstallNativeOptions = {}): UninstallNativeResult {
  const kilnDir = join(projectPath, ".kiln");
  let installState = readNativeProjectionInstallState(kilnDir);
  const targetIds = resolveTargetIds(installState, options.target);
  const removed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const targetId of targetIds) {
    const target = installState.targets[targetId];
    if (!target) {
      skipped.push(targetId);
      errors.push(`${targetId}: no install-state entry found`);
      continue;
    }
    if (!existsSync(target.filePath)) {
      skipped.push(targetId);
      errors.push(`${targetId}: native file not found at ${target.filePath}`);
      continue;
    }

    if (target.projectionKind === "file") {
      const currentContent = readFileSync(target.filePath, "utf-8");
      const drift = detectNativeProjectionFileDrift({ targetId, state: installState, currentContent });
      if (drift && !options.force) {
        skipped.push(targetId);
        errors.push(`${targetId}: managed file drift detected: ${drift.driftedFields.join(", ")}`);
        continue;
      }

      unlinkSync(target.filePath);
      installState = removeNativeProjectionTargetState(installState, targetId);
      removed.push(targetId);
      continue;
    }

    const currentDocument = readNativeProjectionDocument(target);
    const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument });
    if (drift && !options.force) {
      skipped.push(targetId);
      errors.push(`${targetId}: managed field drift detected: ${drift.driftedFields.join(", ")}`);
      continue;
    }

    const stripped = stripManagedFields({
      currentDocument,
      managedFields: target.managedFields,
    });
    writeNativeProjectionDocument(target, stripped);
    installState = removeNativeProjectionTargetState(installState, targetId);
    removed.push(targetId);
  }

  if (removed.length > 0) {
    writeNativeProjectionInstallState(kilnDir, installState);
  }

  return { removed, skipped, errors };
}

function resolveTargetIds(state: NativeProjectionInstallState, target: string | undefined): readonly string[] {
  const normalized = target?.trim();
  if (!normalized) {
    return Object.keys(state.targets);
  }
  if (HARNESS_TARGETS.has(normalized)) {
    const targetIds = Object.keys(state.targets).filter((targetId) => targetId.startsWith(`${normalized}-`));
    return targetIds;
  }
  return [TARGET_ALIASES[normalized] ?? normalized];
}

function readNativeProjectionDocument(target: NativeProjectionTargetState): Record<string, unknown> {
  const raw = readFileSync(target.filePath, "utf-8");
  if (extname(target.filePath) === ".toml") {
    return parseToml(raw) as Record<string, unknown>;
  }
  return JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
}

function writeNativeProjectionDocument(target: NativeProjectionTargetState, document: Record<string, unknown>): void {
  if (extname(target.filePath) === ".toml") {
    writeFileSync(target.filePath, stringifyToml(document), "utf-8");
    return;
  }
  writeFileSync(target.filePath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
}
