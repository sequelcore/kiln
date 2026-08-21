import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";
import { parse as parseToml } from "smol-toml";
import { HARNESSES_WITH_NATIVE_CONFIG_IMPORT } from "../config/harness-integration-capabilities.js";
import { stripJsonComments } from "../config/json-comments.js";
import { resolveNativeHarnessDir } from "../config/native-harness-home.js";
import {
  readGlobalConfig,
} from "../config/global-config.js";
import type { KilnAppConfig } from "../config.js";
import { KilnYamlError } from "../kiln-yaml.js";
import type { KilnYamlPermissions } from "../kiln-yaml-types.js";
import { applyConfigMutation, approveConfigMutation, proposeConfigMutation } from "../application/config-mutation-authority.js";
import { ConfigMutationStore } from "../application/config-mutation-store.js";

export const IMPORT_NATIVE_TARGETS = HARNESSES_WITH_NATIVE_CONFIG_IMPORT;
export type ImportNativeTargetId = typeof IMPORT_NATIVE_TARGETS[number];

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
  const model = typeof doc.model === "string" && doc.model.trim().length > 0
    ? doc.model.trim()
    : undefined;
  const approval = isKilnApproval(doc.approval_policy) ? doc.approval_policy : undefined;
  const sandbox = isKilnSandbox(doc.sandbox_mode) ? doc.sandbox_mode : undefined;

  if (model) {
    extractedFields.push("model");
  }

  if (approval !== undefined) {
    extractedFields.push("permissions.approval");
  }

  if (sandbox !== undefined) {
    extractedFields.push("permissions.sandbox");
  }

  const permissions: KilnYamlPermissions | undefined = approval === undefined && sandbox === undefined
    ? undefined
    : { ...(approval === undefined ? {} : { approval }), ...(sandbox === undefined ? {} : { sandbox }) };

  return {
    provider: "codex",
    model,
    permissions,
    extractedFields: ["provider", ...extractedFields],
  };
}

export function extractOpenCodeNativeConfig(
  doc: Record<string, unknown>,
): ImportedNativeConfig {
  const extractedFields: string[] = [];
  const model = typeof doc.model === "string" && doc.model.trim().length > 0
    ? doc.model.trim()
    : undefined;
  const permission = asRecord(doc.permission);
  const permissionDefault = permission.default;
  const permissions: KilnYamlPermissions | undefined = permissionDefault === "ask"
    ? { approval: "on-request" }
    : permissionDefault === "deny"
      ? { approval: "untrusted" }
      : permissionDefault === "allow"
        ? { approval: "never", sandbox: "workspace-write" }
        : undefined;

  if (model) {
    extractedFields.push("model");
  }

  if (permissionDefault === "ask") {
    extractedFields.push("permissions.approval");
  } else if (permissionDefault === "deny") {
    extractedFields.push("permissions.approval");
  } else if (permissionDefault === "allow") {
    extractedFields.push("permissions.approval", "permissions.sandbox");
  }

  return {
    provider: "opencode",
    model,
    permissions,
    extractedFields: ["provider", ...extractedFields],
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
  if (currentGlobal.invalid) {
    console.error(`Error: existing global config is invalid; repair or re-adopt it before importing native intent: ${currentGlobal.invalid.reason}`);
    process.exit(1);
  }
  const projectPath = process.cwd();
  const imported = extractNativeConfig(target, nativeDocument);
  const extractedFields = imported.extractedFields.filter((field) => field !== "model");
  const record = proposeConfigMutation({
    projectPath,
    operation: "native.import",
    payload: {
      target,
      ...(imported.permissions ? { permissions: imported.permissions } : {}),
    },
  });
  if (record.proposal.status !== "valid") {
    console.error(`Error: native import rejected: ${record.proposal.diagnostics.map((entry) => entry.message).join("; ")}`);
    process.exit(1);
  }
  const write = record.writes[0];
  if (!write || write.previousContent === write.nextContent) {
    console.log(`No Kiln-relevant native changes found for ${target}.`);
    return;
  }
  console.log(record.proposal.previewDiff);
  const approved = args.includes("--yes") || await confirmImportNative();
  if (!approved) {
    console.error("Error: import-native cancelled");
    process.exit(1);
  }
  new ConfigMutationStore(projectPath).saveProposal(record);
  const approval = record.proposal.approvalRequired
    ? approveConfigMutation({ projectPath, proposalId: record.proposal.proposalId, surface: "cli" })
    : undefined;
  const result = await applyConfigMutation({
    projectPath,
    proposalId: record.proposal.proposalId,
    ...(approval ? { approvalId: approval.approvalId } : {}),
    requester: "operator",
  });
  if (result.settlement.outcome === "rejected") {
    console.error(`Error: native import rejected: ${result.settlement.diagnostics.map((entry) => entry.message).join("; ")}`);
    process.exit(1);
  }
  if (result.settlement.outcome === "committed-reconciliation-failed") {
    console.error("Error: imported config committed, but native permission reconciliation failed:");
    for (const diagnostic of result.settlement.diagnostics) console.error(`  - ${diagnostic.message}`);
    process.exit(1);
  }

  console.log(`Imported ${extractedFields.join(", ")} from ${target} native config.`);
}

interface CurrentGlobalConfigForImport {
  readonly invalid?: {
    readonly reason: string;
  };
}

function readCurrentGlobalConfigForImport(): CurrentGlobalConfigForImport {
  try {
    readGlobalConfig();
    return {};
  } catch (error) {
    if (!(error instanceof KilnYamlError)) {
      throw error;
    }
    return {
      invalid: {
        reason: error.message,
      },
    };
  }
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
