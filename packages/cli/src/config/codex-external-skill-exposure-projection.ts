import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { KilnYamlSkillsConfig } from "../kiln-yaml-types.js";
import { compileCodexExternalSkillExposure, CODEX_EXTERNAL_SKILL_EXPOSURE_ADAPTER_REVISION } from "./external-skill-exposure.js";
import { resolveNativeHarnessDir } from "./native-harness-home.js";
import { backupNativeProjectionFile } from "./native-projection-backup.js";
import { type ProjectionOutcome } from "./native-projection-policy.js";
import {
  createNativeProjectionSnapshot, detectNativeProjectionDrift, readNativeProjectionInstallState,
  removeNativeProjectionTargetState, stripManagedFields, upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "./native-projection-state.js";
import { readGlobalExternalSkillInventory } from "./skill-catalog-status.js";
import type { SkillInventoryCommandRunner, SkillPluginProvider } from "./skill-source-inventory.js";

export const CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID = "codex-external-skill-exposure";

export function uninstallCodexExternalSkillExposure(input: { readonly userHome?: string; readonly force?: boolean } = {}) {
  const codexDir = resolveNativeHarnessDir("codex", input.userHome);
  const stateDir = join(codexDir, ".kiln");
  const state = readNativeProjectionInstallState(stateDir);
  const owned = state.targets[CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID];
  if (!owned) return { removed: [] as string[], errors: [] as string[] };
  if (!existsSync(owned.filePath)) return { removed: [] as string[], errors: [`${CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID}: native file missing`] };
  let document: Record<string, unknown>;
  try { document = parseToml(readFileSync(owned.filePath, "utf8")) as Record<string, unknown>; }
  catch (error) { return { removed: [] as string[], errors: [message(error)] }; }
  const drift = detectNativeProjectionDrift({ targetId: CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID, state, currentDocument: document });
  if (drift && !input.force) return { removed: [] as string[], errors: [`${CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID}: managed field drift`] };
  const original = readFileSync(owned.filePath);
  try {
    writeDocument(owned.filePath, stripManagedFields({ currentDocument: document, managedFields: owned.managedFields, managedArrayItems: owned.managedArrayItems }));
    writeNativeProjectionInstallState(stateDir, removeNativeProjectionTargetState(state, CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID));
  } catch (error) { restore(owned.filePath, original); return { removed: [] as string[], errors: [message(error)] }; }
  return { removed: [CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID], errors: [] as string[] };
}

export async function syncCodexExternalSkillExposure(input: {
  readonly skillConfig?: KilnYamlSkillsConfig;
  readonly userHome?: string;
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly pluginProvider?: SkillPluginProvider;
  readonly commandRunner?: SkillInventoryCommandRunner;
}): Promise<{ readonly errors: readonly string[]; readonly outcomes: readonly ProjectionOutcome[] }> {
  const codexDir = resolveNativeHarnessDir("codex", input.userHome);
  const stateDir = join(codexDir, ".kiln");
  const target = join(codexDir, "config.toml");
  let state = readNativeProjectionInstallState(stateDir);
  const previous = state.targets[CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID];
  let document: Record<string, unknown> = {};
  if (existsSync(target)) {
    try { document = parseToml(readFileSync(target, "utf8")) as Record<string, unknown>; }
    catch (error) { return failure(target, `Codex config is unreadable: ${message(error)}`); }
  }
  const drift = detectNativeProjectionDrift({ targetId: CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID, state, currentDocument: document });
  if (drift && !input.force) return failure(target, `managed field drift detected: ${drift.driftedFields.join(", ")}`);

  const base = previous ? stripManagedFields({
    currentDocument: document, managedFields: previous.managedFields,
    managedArrayItems: previous.managedArrayItems,
  }) : document;
  const policy = input.skillConfig?.externalCatalog;
  if (!policy) {
    if (!previous) return { errors: [], outcomes: [{ targetId: CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID, path: target, status: "skipped", reason: "external catalog policy is not configured" }] };
    if (input.dryRun) return { errors: [], outcomes: [{ targetId: CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID, path: target, status: "planned", reason: "remove owned external exposure rules" }] };
    backupNativeProjectionFile({ kilnDir: stateDir, targetId: CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID, filePath: target });
    const original = existsSync(target) ? readFileSync(target) : undefined;
    try {
      writeDocument(target, base);
      state = removeNativeProjectionTargetState(state, CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID);
      writeNativeProjectionInstallState(stateDir, state);
    } catch (error) { restore(target, original); throw error; }
    return { errors: [], outcomes: [{ targetId: CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID, path: target, status: "removed" }] };
  }

  try {
    const global = readGlobalExternalSkillInventory({
      userHome: input.userHome,
      ...(input.pluginProvider ? { pluginProvider: input.pluginProvider } : {}),
      ...(input.commandRunner ? { commandRunner: input.commandRunner } : {}),
    });
    const projection = compileCodexExternalSkillExposure({ inventory: global.inventory, policy, absolutePathBySourceId: global.absolutePathBySourceId });
    const applied = asRecord(asRecord(document.kiln).external_skill_catalog);
    const nameByPath = new Map(global.inventory.candidates.flatMap((candidate) => {
      const path = global.absolutePathBySourceId.get(candidate.sourceId);
      return path ? [[path, candidate.name] as const] : [];
    }));
    const documentSkills = asRecord(document.skills);
    const documentItems = Array.isArray(documentSkills.config) ? documentSkills.config : [];
    const effectivelySuppressed = projection.disabledItems.every((desired) =>
      lastEffectiveEnabled(documentItems, desired.path, nameByPath.get(desired.path)) === false);
    if (!drift && previous
      && applied.inventory_fingerprint === projection.fingerprint
      && applied.policy_fingerprint === projection.policyFingerprint
      && effectivelySuppressed) {
      return { errors: [], outcomes: [{
        targetId: CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID,
        path: target,
        status: "unchanged",
        reason: "reviewed Codex external exposure rules are current",
      }] };
    }
    const skills = asRecord(base.skills);
    const existing = Array.isArray(skills.config) ? skills.config : [];
    const owned = projection.disabledItems.filter((desired) =>
      lastEffectiveEnabled(existing, desired.path, nameByPath.get(desired.path)) !== false);
    const next = {
      ...base,
      skills: { ...skills, config: [...existing, ...owned] },
      kiln: { ...asRecord(base.kiln), external_skill_catalog: {
        policy_version: 1, adapter_revision: CODEX_EXTERNAL_SKILL_EXPOSURE_ADAPTER_REVISION,
        inventory_fingerprint: projection.fingerprint, policy_fingerprint: projection.policyFingerprint,
        applied_at: projection.appliedAt,
      } },
    };
    const snapshot = createNativeProjectionSnapshot({
      targetId: CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID, filePath: target, document: next,
      managedFields: ["skills.config", "kiln.external_skill_catalog"],
      managedArrayItems: { "skills.config": owned },
    });
    if (input.dryRun) return { errors: [], outcomes: [{ targetId: snapshot.targetId, path: target, status: "planned", reason: "write reviewed Codex external exposure rules" }] };
    backupNativeProjectionFile({ kilnDir: stateDir, targetId: CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID, filePath: target });
    const original = existsSync(target) ? readFileSync(target) : undefined;
    try {
      writeDocument(target, next);
      state = upsertNativeProjectionTargetState(state, snapshot);
      writeNativeProjectionInstallState(stateDir, state);
    } catch (error) { restore(target, original); throw error; }
    return { errors: [], outcomes: [{ targetId: snapshot.targetId, path: target, status: "written" }] };
  } catch (error) { return failure(target, message(error)); }
}

function lastEffectiveEnabled(items: readonly unknown[], path: string, name?: string): boolean | undefined {
  let result: boolean | undefined;
  for (const value of items) {
    const item = asRecord(value);
    if ((item.path === path || name !== undefined && item.name === name) && typeof item.enabled === "boolean") result = item.enabled;
  }
  return result;
}
function asRecord(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function writeDocument(path: string, document: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try { writeFileSync(temporary, stringifyToml(document), { encoding: "utf8", flag: "wx" }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function failure(path: string, reason: string) { return { errors: [reason], outcomes: [{ targetId: CODEX_EXTERNAL_SKILL_EXPOSURE_TARGET_ID, path, status: "blocked" as const, reason }] }; }
function restore(path: string, original: Uint8Array | undefined): void {
  if (original) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, original); }
  else rmSync(path, { force: true });
}
