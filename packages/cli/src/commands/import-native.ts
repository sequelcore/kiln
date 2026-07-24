import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";
import { stringify as stringifyYaml } from "yaml";
import { parse as parseToml } from "smol-toml";
import { globalToKilnYaml } from "../config/config-merger.js";
import { HARNESSES_WITH_NATIVE_CONFIG_IMPORT } from "../config/harness-integration-capabilities.js";
import { stripJsonComments } from "../config/json-comments.js";
import { resolveNativeHarnessDir } from "../config/native-harness-home.js";
import {
  CANONICAL_GLOBAL_CONFIG_VERSION,
  defaultGlobalConfig,
  readGlobalConfig,
  resolveGlobalConfigPath,
  writeGlobalConfig,
  type KilnGlobalConfig,
} from "../config/global-config.js";
import { syncNativePermissionProjections } from "../config/native-permission-projection.js";
import type { KilnAppConfig } from "../config.js";
import { KilnYamlError } from "../kiln-yaml.js";
import type { KilnYamlPermissions } from "../kiln-yaml-types.js";

export const IMPORT_NATIVE_TARGETS = HARNESSES_WITH_NATIVE_CONFIG_IMPORT;
export type ImportNativeTargetId = typeof IMPORT_NATIVE_TARGETS[number];

export interface ImportNativePlan {
  readonly target: ImportNativeTargetId;
  readonly nativeConfigPath: string;
  readonly globalConfigPath: string;
  readonly before: KilnGlobalConfig;
  readonly after: KilnGlobalConfig;
  readonly extractedFields: readonly string[];
  readonly diff: string;
  readonly hasChanges: boolean;
}

export function parseImportNativeTarget(target: string | undefined): ImportNativeTargetId {
  const normalized = target?.trim();
  if (!normalized) {
    throw new Error(`Missing import-native target. Valid targets: ${IMPORT_NATIVE_TARGETS.join(", ")}`);
  }
  if ((IMPORT_NATIVE_TARGETS as readonly string[]).includes(normalized)) {
    return normalized as ImportNativeTargetId;
  }
  throw new Error(`Unknown import-native target "${normalized}". Valid targets: ${IMPORT_NATIVE_TARGETS.join(", ")}`);
}

export function extractCodexNativeConfig(
  doc: Record<string, unknown>,
): ImportedNativeConfig {
  const extractedFields: string[] = [];
  const permissions: KilnYamlPermissions = {};
  const model = typeof doc.model === "string" && doc.model.trim().length > 0
    ? doc.model.trim()
    : undefined;

  if (model) {
    extractedFields.push("model");
  }

  if (isKilnApproval(doc.approval_policy)) {
    permissions.approval = doc.approval_policy;
    extractedFields.push("permissions.approval");
  }

  if (isKilnSandbox(doc.sandbox_mode)) {
    permissions.sandbox = doc.sandbox_mode;
    extractedFields.push("permissions.sandbox");
  }

  return {
    provider: "codex",
    model,
    permissions: Object.keys(permissions).length > 0 ? permissions : undefined,
    extractedFields: ["provider", ...extractedFields],
  };
}

export function extractOpenCodeNativeConfig(
  doc: Record<string, unknown>,
): ImportedNativeConfig {
  const extractedFields: string[] = [];
  const permissions: KilnYamlPermissions = {};
  const model = typeof doc.model === "string" && doc.model.trim().length > 0
    ? doc.model.trim()
    : undefined;
  const permission = asRecord(doc.permission);
  const permissionDefault = permission.default;

  if (model) {
    extractedFields.push("model");
  }

  if (permissionDefault === "ask") {
    permissions.approval = "on-request";
    extractedFields.push("permissions.approval");
  } else if (permissionDefault === "deny") {
    permissions.approval = "untrusted";
    extractedFields.push("permissions.approval");
  } else if (permissionDefault === "allow") {
    permissions.approval = "never";
    permissions.sandbox = "workspace-write";
    extractedFields.push("permissions.approval", "permissions.sandbox");
  }

  return {
    provider: "opencode",
    model,
    permissions: Object.keys(permissions).length > 0 ? permissions : undefined,
    extractedFields: ["provider", ...extractedFields],
  };
}

export function createImportNativePlan(input: {
  readonly target: ImportNativeTargetId;
  readonly nativeConfigPath: string;
  readonly globalConfigPath: string;
  readonly currentConfig: KilnGlobalConfig | null;
  readonly nativeDocument: Record<string, unknown>;
}): ImportNativePlan {
  const before: KilnGlobalConfig = input.currentConfig ?? defaultGlobalConfig();
  const imported = extractNativeConfig(input.target, input.nativeDocument);
  const after = mergeImportedGlobalConfig(before, imported);
  const diff = buildUnifiedConfigDiff(input.globalConfigPath, before, after);

  return {
    target: input.target,
    nativeConfigPath: input.nativeConfigPath,
    globalConfigPath: input.globalConfigPath,
    before,
    after,
    extractedFields: imported.extractedFields,
    diff,
    hasChanges: JSON.stringify(before) !== JSON.stringify(after),
  };
}

export async function importNativeCommand(
  _appConfig: KilnAppConfig,
  targetArg: string | undefined,
  args: readonly string[],
): Promise<void> {
  let target: ImportNativeTargetId;
  try {
    target = parseImportNativeTarget(targetArg);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const nativeConfigPath = resolveNativeConfigPath(target);
  if (!existsSync(nativeConfigPath)) {
    console.error(`Error: Native config for ${target} not found at ${nativeConfigPath}`);
    process.exit(1);
  }

  const currentGlobal = readCurrentGlobalConfigForImport();
  const nativeDocument = readNativeDocument(target, nativeConfigPath);
  const plan = createImportNativePlan({
    target,
    nativeConfigPath,
    globalConfigPath: currentGlobal.path,
    currentConfig: currentGlobal.config,
    nativeDocument,
  });

  if (plan.extractedFields.length === 0 || !plan.hasChanges) {
    console.log(`No Kiln-relevant native changes found for ${target}.`);
    return;
  }

  if (currentGlobal.invalid) {
    console.log(`Existing global config is invalid and will be backed up before writing canonical config: ${currentGlobal.invalid.reason}`);
  }
  console.log(plan.diff);
  const approved = args.includes("--yes") || await confirmImportNative();
  if (!approved) {
    console.error("Error: import-native cancelled");
    process.exit(1);
  }

  if (currentGlobal.invalid) {
    const backupPath = backupInvalidGlobalConfig(currentGlobal.path);
    console.log(`Backed up invalid global config to ${backupPath}`);
  }
  writeGlobalConfig(plan.after);
  const syncResult = await syncNativePermissionProjections(globalToKilnYaml(plan.after), process.cwd(), { force: true });
  if (syncResult.errors.length > 0) {
    console.error("Error: imported config was written, but native re-projection failed:");
    for (const error of syncResult.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log(`Imported ${plan.extractedFields.join(", ")} from ${target} native config.`);
}

interface CurrentGlobalConfigForImport {
  readonly path: string;
  readonly config: KilnGlobalConfig | null;
  readonly invalid?: {
    readonly reason: string;
  };
}

function readCurrentGlobalConfigForImport(): CurrentGlobalConfigForImport {
  const path = resolveGlobalConfigPath();
  try {
    return {
      path,
      config: readGlobalConfig(),
    };
  } catch (error) {
    if (!(error instanceof KilnYamlError)) {
      throw error;
    }
    return {
      path,
      config: null,
      invalid: {
        reason: error.message,
      },
    };
  }
}

function backupInvalidGlobalConfig(path: string): string {
  const backupPath = `${path}.invalid-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
  copyFileSync(path, backupPath);
  return backupPath;
}

interface ImportedNativeConfig {
  readonly provider: string;
  readonly model?: string;
  readonly permissions?: KilnYamlPermissions;
  readonly extractedFields: readonly string[];
}

function extractNativeConfig(target: ImportNativeTargetId, nativeDocument: Record<string, unknown>): ImportedNativeConfig {
  if (target === "codex") {
    return extractCodexNativeConfig(nativeDocument);
  }
  if (target === "opencode") {
    return extractOpenCodeNativeConfig(nativeDocument);
  }
  throw new Error(`Unsupported import-native target: ${target}`);
}

function mergeImportedGlobalConfig(
  base: KilnGlobalConfig,
  imported: ImportedNativeConfig,
): KilnGlobalConfig {
  const engines = {
    ...base.engines,
    [imported.provider]: {
      ...base.engines?.[imported.provider],
      enabled: true,
    },
  };
  const routing = {
    ...base.routing,
    defaultWorker: imported.provider,
    budgetAware: base.routing?.budgetAware ?? false,
  };
  const models = imported.model
    ? { ...base.models, [imported.provider]: imported.model }
    : base.models;
  return {
    ...base,
    version: CANONICAL_GLOBAL_CONFIG_VERSION,
    engines,
    routing,
    models,
    permissions: imported.permissions
      ? { ...base.permissions, ...imported.permissions }
      : base.permissions,
    components: base.components ?? { include: ["baseline:core"] },
  };
}

function buildUnifiedConfigDiff(
  path: string,
  before: KilnGlobalConfig,
  after: KilnGlobalConfig,
): string {
  const beforeLines = stringifyYaml(before).trimEnd().split("\n");
  const afterLines = stringifyYaml(after).trimEnd().split("\n");
  const diffLines = buildLineDiff(beforeLines, afterLines);
  return [`--- ${path}`, `+++ ${path}`, ...diffLines].join("\n");
}

function buildLineDiff(beforeLines: readonly string[], afterLines: readonly string[]): string[] {
  const lengths: number[][] = Array.from({ length: beforeLines.length + 1 }, () =>
    Array.from({ length: afterLines.length + 1 }, () => 0)
  );

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex]![afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? lengths[beforeIndex + 1]![afterIndex + 1]! + 1
        : Math.max(lengths[beforeIndex + 1]![afterIndex]!, lengths[beforeIndex]![afterIndex + 1]!);
    }
  }

  const diff: string[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      diff.push(` ${beforeLines[beforeIndex]}`);
      beforeIndex += 1;
      afterIndex += 1;
    } else if (lengths[beforeIndex + 1]![afterIndex]! >= lengths[beforeIndex]![afterIndex + 1]!) {
      diff.push(`-${beforeLines[beforeIndex]}`);
      beforeIndex += 1;
    } else {
      diff.push(`+${afterLines[afterIndex]}`);
      afterIndex += 1;
    }
  }
  for (; beforeIndex < beforeLines.length; beforeIndex += 1) {
    diff.push(`-${beforeLines[beforeIndex]}`);
  }
  for (; afterIndex < afterLines.length; afterIndex += 1) {
    diff.push(`+${afterLines[afterIndex]}`);
  }
  return diff;
}

function readNativeDocument(target: ImportNativeTargetId, path: string): Record<string, unknown> {
  const raw = readFileSync(path, "utf-8");
  if (target === "codex") {
    return parseToml(raw) as Record<string, unknown>;
  }
  if (target === "opencode") {
    return JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
  }
  throw new Error(`Unsupported import-native target: ${target}`);
}

function resolveNativeConfigPath(target: ImportNativeTargetId): string {
  if (target === "codex") {
    return join(resolveNativeHarnessDir("codex"), "config.toml");
  }
  if (target === "opencode") {
    return join(resolveNativeHarnessDir("opencode"), "opencode.json");
  }
  throw new Error(`Unsupported import-native target: ${target}`);
}

async function confirmImportNative(): Promise<boolean> {
  process.stdout.write("Apply imported native config to Kiln global config? [y/N]: ");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    let settled = false;
    rl.once("line", (line) => {
      settled = true;
      resolve(line);
    });
    rl.once("close", () => {
      if (!settled) {
        resolve("");
      }
    });
  });

  rl.close();
  return answer.trim().toLowerCase() === "y";
}

function isKilnApproval(value: unknown): value is NonNullable<KilnYamlPermissions["approval"]> {
  return value === "never" || value === "on-request" || value === "on-failure" || value === "untrusted";
}

function isKilnSandbox(value: unknown): value is NonNullable<KilnYamlPermissions["sandbox"]> {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
