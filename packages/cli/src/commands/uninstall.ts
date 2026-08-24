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
import { CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID, uninstallCodexExternalSkillExposure } from "../config/codex-external-skill-exposure-projection.js";
import { OPENCODE_SKILL_VISIBILITY_TARGET_ID, uninstallOpenCodeSkillVisibilityProjection } from "../config/native-permission-projection.js";
import {
  resolveProjectStateBinding,
  type ProjectStateBinding,
} from "../application/project-state-root.js";

export interface UninstallNativeOptions {
  readonly target?: string;
  readonly force?: boolean;
  readonly userHome?: string;
  /** Established private state binding for this project. */
  readonly projectStateBinding?: ProjectStateBinding;
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
  "codex-instructions": "codex-global-instructions",
  "claude-instructions": "claude-global-instructions",
  "opencode-instructions": "opencode-global-instructions",
};

type NativeHarnessTarget = "claude" | "codex" | "opencode";

const HARNESS_TARGET_OWNERSHIP: Readonly<Record<NativeHarnessTarget, {
  readonly exact: ReadonlySet<string>;
  readonly prefixes: readonly string[];
}>> = {
  claude: {
    exact: new Set([
      "claude-settings",
      "claude-global-instructions",
      "claude-hook-settings",
      "claude-autoformat-hook",
      "mcp:claude",
    ]),
    prefixes: ["claude-agent:", "claude-skill:"],
  },
  codex: {
    exact: new Set([
      "codex-config",
      "codex-global-instructions",
      "codex-autoformat-hook",
      "mcp:codex",
    ]),
    prefixes: ["codex-agent:", "codex-skill:"],
  },
  opencode: {
    exact: new Set([
      "opencode-config",
      "opencode-global-instructions",
      "mcp:opencode",
    ]),
    prefixes: ["opencode-agent:", "opencode-skill:"],
  },
} as const;
const GLOBAL_INSTRUCTION_TARGETS = [
  "codex-global-instructions",
  "claude-global-instructions",
  "opencode-global-instructions",
] as const;

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
  const stateBinding = options.projectStateBinding ?? resolveProjectStateBinding(projectPath, options.userHome === undefined
    ? {}
    : { kilnHome: join(options.userHome, ".kiln") });
  const projectionStateDir = stateBinding.projectionsPath;
  let installState = readNativeProjectionInstallState(projectionStateDir);
  const targetIds = options.target?.trim() === CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID
    || options.target?.trim() === OPENCODE_SKILL_VISIBILITY_TARGET_ID
    ? [] : resolveTargetIds(installState, options.target);
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

    let currentDocument: Record<string, unknown>;
    try {
      currentDocument = readNativeProjectionDocument(target);
    } catch (error) {
      skipped.push(targetId);
      errors.push(`${targetId}: native configuration is unreadable and was not modified: ${safeError(error)}`);
      continue;
    }
    const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument });
    if (drift && !options.force) {
      skipped.push(targetId);
      errors.push(`${targetId}: managed field drift detected: ${drift.driftedFields.join(", ")}`);
      continue;
    }

    const stripped = stripManagedFields({
      currentDocument,
      managedFields: target.managedFields,
      managedArrayItems: target.managedArrayItems,
    });
    writeNativeProjectionDocument(target, stripped);
    installState = removeNativeProjectionTargetState(installState, targetId);
    removed.push(targetId);
  }

  if (removed.length > 0) {
    writeNativeProjectionInstallState(projectionStateDir, installState);
  }

  const target = options.target?.trim();
  if (!target || target === "codex" || target === "codex-config" || target === CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID) {
    const global = uninstallCodexExternalSkillExposure({ force: options.force, userHome: options.userHome });
    removed.push(...global.removed);
    errors.push(...global.errors);
  }
  if (!target || target === "opencode" || target === "opencode-config" || target === OPENCODE_SKILL_VISIBILITY_TARGET_ID) {
    const global = uninstallOpenCodeSkillVisibilityProjection({ force: options.force, userHome: options.userHome });
    removed.push(...global.removed); errors.push(...global.errors);
  }
  return { removed, skipped, errors };
}

function resolveTargetIds(state: NativeProjectionInstallState, target: string | undefined): readonly string[] {
  const normalized = target?.trim();
  if (!normalized) {
    return Object.keys(state.targets);
  }
  if (normalized === "instructions" || normalized === "global-instructions") {
    return GLOBAL_INSTRUCTION_TARGETS.filter((targetId) => state.targets[targetId] !== undefined);
  }
  if (isNativeHarnessTarget(normalized)) {
    const ownership = HARNESS_TARGET_OWNERSHIP[normalized];
    return Object.keys(state.targets).filter((targetId) =>
      ownership.exact.has(targetId) || ownership.prefixes.some((prefix) => targetId.startsWith(prefix)));
  }
  return [TARGET_ALIASES[normalized] ?? normalized];
}

function isNativeHarnessTarget(value: string): value is NativeHarnessTarget {
  return Object.hasOwn(HARNESS_TARGET_OWNERSHIP, value);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "unknown parse error";
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
