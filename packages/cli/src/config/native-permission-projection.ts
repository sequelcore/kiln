import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ModelGatewayConfig } from "@kilnai/core";
import { readSkillMdIndex } from "@kilnai/runtime";
import { parse as parseYaml } from "yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { ResolvedKilnConfig } from "../kiln-yaml-types.js";
import type { KilnPermissionPolicy } from "../wrapper/session.js";
import {
  resolveProjectStateBinding,
  type ProjectStateBinding,
} from "../application/project-state-root.js";
import { stripJsonComments } from "./json-comments.js";
import {
  buildOpenCodeResponsesProjection,
} from "./model-gateway-native-projection.js";
import { resolveNativeHarnessDir } from "./native-harness-home.js";
import { backupNativeProjectionFile } from "./native-projection-backup.js";
import {
  describeProjectionDrift,
  isNativeProjectionHarnessDisabled,
  type NativeProjectionSyncOptions,
  type ProjectionOutcome,
} from "./native-projection-policy.js";
import {
  createNativeProjectionSnapshot,
  detectNativeProjectionDrift,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  stripManagedFields,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "./native-projection-state.js";
import { translateClaudePermissionProjection } from "./translators/claude-translator.js";
import { translateCodexPermissionProjection } from "./translators/codex-translator.js";
import { translateOpenCodePermissionProjection } from "./translators/opencode-translator.js";
import { PERMISSION_PROJECTION_TARGET_IDS } from "./translators/permission-projection.js";
import { discoverOpenCodeDeniedSkillNames } from "./native-skill-projection.js";
import { resolveModelFacingPermissionPolicy } from "./model-facing-permission-policy.js";

export const OPENCODE_SKILL_VISIBILITY_TARGET_ID = "opencode-skill-visibility";

export interface NativePermissionProjectionResult {
  claude: boolean;
  codex: boolean;
  opencode: boolean;
  errors: string[];
  outcomes: readonly ProjectionOutcome[];
}

export interface NativePermissionProjectionOptions extends NativeProjectionSyncOptions {
  readonly modelGateway?: ModelGatewayConfig;
  /** Established private state binding for this project. */
  readonly projectStateBinding?: ProjectStateBinding;
}

interface PermissionTargetResult {
  readonly ok: boolean;
  readonly snapshot?: NativeProjectionTargetState;
  readonly removeTargetIds?: readonly string[];
  readonly error?: string;
  readonly rollback?: () => void;
  readonly outcomes: readonly ProjectionOutcome[];
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

export async function syncOpenCodeSkillVisibilityProjection(
  kilnYaml: ResolvedKilnConfig,
  projectPath: string,
  options: NativePermissionProjectionOptions = {},
): Promise<{ readonly errors: readonly string[]; readonly outcomes: readonly ProjectionOutcome[] }> {
  const openCodeDir = resolveNativeHarnessDir("opencode", options.userHome);
  const stateDir = join(openCodeDir, ".kiln");
  let state = readNativeProjectionInstallState(stateDir);
  const target = join(openCodeDir, "opencode.json");
  if (isNativeProjectionHarnessDisabled(options, "opencode")) return { errors: [], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "skipped", reason: "OpenCode harness is disabled" }] };
  const original = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  let document: Record<string, unknown> = {};
  if (original !== undefined) {
    try { document = requireRecord(JSON.parse(stripJsonComments(original)), "configuration root must be an object"); }
    catch (error) { return { errors: [String(error)], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "failed", reason: "OpenCode config is unreadable" }] }; }
  }
  const drift = detectNativeProjectionDrift({ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, state, currentDocument: document });
  if (drift && !options.force) return { errors: [`managed field drift detected: ${drift.driftedFields.join(", ")}`], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "blocked", reason: "managed OpenCode skill visibility drift" }] };
  const previous = state.targets[OPENCODE_SKILL_VISIBILITY_TARGET_ID];
  const base = previous ? stripManagedFields({ currentDocument: document, managedFields: previous.managedFields }) : document;
  const deniedNames = [...new Set([
    ...discoverOpenCodeDeniedSkillNames(projectPath, kilnYaml.skills, options.userHome),
    ...discoverClaudeExplicitOnlySkillNames(options.userHome),
  ])].sort((left, right) => left.localeCompare(right));
  const permission = requireOptionalRecord(base.permission) ?? {};
  if (deniedNames.length === 0) {
    if (!previous) return { errors: [], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "skipped", reason: "no fail-closed OpenCode skill denies are required" }] };
    if (options.dryRun) return { errors: [], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "planned", reason: "remove stale OpenCode skill denies" }] };
    ensureDir(dirname(target)); backupNativeProjectionFile({ kilnDir: stateDir, targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, filePath: target });
    try {
      writeFileAtomically(target, JSON.stringify(base, null, 2) + "\n");
      state = removeNativeProjectionTargetState(state, OPENCODE_SKILL_VISIBILITY_TARGET_ID);
      writeNativeProjectionInstallState(stateDir, state);
    } catch (error) { restoreFile(target, original); throw error; }
    return { errors: [], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "removed", reason: "no fail-closed OpenCode skill denies remain" }] };
  }
  const scalarSkill = typeof permission.skill === "string" ? permission.skill : undefined;
  if (scalarSkill !== undefined) {
    if (scalarSkill === "deny") {
      if (!previous) return { errors: [], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "skipped", reason: "operator scalar skill deny already fails closed" }] };
      if (options.dryRun) return { errors: [], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "planned", reason: "adopt operator scalar skill deny and remove stale ownership" }] };
      state = removeNativeProjectionTargetState(state, OPENCODE_SKILL_VISIBILITY_TARGET_ID);
      writeNativeProjectionInstallState(stateDir, state);
      return { errors: [], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "removed", reason: "operator scalar skill deny adopted; stale ownership removed" }] };
    }
    return { errors: [`Existing scalar OpenCode skill permission conflicts with fail-closed deny: ${scalarSkill}`], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "failed", reason: "operator scalar skill permission would be overwritten" }] };
  }
  const existingSkill = requireOptionalRecord(permission.skill) ?? {};
  const conflictingExact = deniedNames.filter((name) => name in existingSkill && existingSkill[name] !== "deny");
  if (conflictingExact.length > 0) return { errors: [`Existing exact OpenCode skill permission conflicts with fail-closed deny: ${conflictingExact.join(", ")}`], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "failed", reason: "operator exact skill rule would be overwritten" }] };
  const absentNames = deniedNames.filter((name) => !(name in existingSkill));
  const next = { ...base, permission: { ...permission, skill: { ...existingSkill, ...Object.fromEntries(absentNames.map((name) => [name, "deny"])) } } };
  if (Object.keys((next.permission as Record<string, unknown>).skill as Record<string, unknown>).length === 0) delete (next.permission as Record<string, unknown>).skill;
  const managedFields = absentNames
    .map((name) => `/permission/skill/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`);
  const ineffective = deniedNames.filter((name) => effectiveOpenCodeSkillPermission(
    (next.permission as Record<string, unknown>).skill as Record<string, unknown>, name) !== "deny");
  if (ineffective.length > 0) return { errors: [`OpenCode skill deny is overridden by a later-matching pattern: ${ineffective.join(", ")}`], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "failed", reason: "existing OpenCode skill permission pattern overrides fail-closed deny" }] };
  if (managedFields.length === 0 && !previous) return { errors: [], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "skipped", reason: "operator OpenCode skill deny already fails closed" }] };
  if (!drift && previous && sameStrings(previous.managedFields, managedFields)) {
    return { errors: [], outcomes: [{
      targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID,
      path: target,
      status: "unchanged",
      reason: "fail-closed OpenCode skill visibility is current",
    }] };
  }
  if (options.dryRun) return { errors: [], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "planned", reason: "write fail-closed OpenCode skill visibility" }] };
  ensureDir(dirname(target)); backupNativeProjectionFile({ kilnDir: stateDir, targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, filePath: target });
  try {
    writeFileAtomically(target, JSON.stringify(next, null, 2) + "\n");
    if (managedFields.length > 0) {
      const snapshot = createNativeProjectionSnapshot({ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, filePath: target, document: next, managedFields });
      state = upsertNativeProjectionTargetState(state, snapshot);
    } else state = removeNativeProjectionTargetState(state, OPENCODE_SKILL_VISIBILITY_TARGET_ID);
    writeNativeProjectionInstallState(stateDir, state);
  } catch (error) { restoreFile(target, original); throw error; }
  return { errors: [], outcomes: [{ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, path: target, status: "written", reason: "explicit-only skills denied because stable OpenCode cannot preserve direct invocation" }] };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function effectiveOpenCodeSkillPermission(rules: Record<string, unknown>, name: string): unknown {
  return Object.entries(rules)
    .filter(([pattern]) => openCodeWildcardMatch(name, pattern))
    .at(-1)?.[1];
}

function openCodeWildcardMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, process.platform === "win32" ? "si" : "s").test(value);
}

function discoverClaudeExplicitOnlySkillNames(userHome?: string): readonly string[] {
  const root = join(resolveNativeHarnessDir("claude", userHome), "skills");
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name, "SKILL.md");
      if (!(entry.isDirectory() || entry.isSymbolicLink()) || !existsSync(path)) return [];
      try {
        const raw = readFileSync(path, "utf8").replace(/^\uFEFF/u, "");
        const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw);
        if (!match) return [];
        const metadata = parseYaml(match[1]!) as Record<string, unknown>;
        return metadata["disable-model-invocation"] === true ? [readSkillMdIndex(path).name] : [];
      } catch { return []; }
    });
  } catch { return []; }
}

export function uninstallOpenCodeSkillVisibilityProjection(options: { readonly userHome?: string; readonly force?: boolean } = {}) {
  const openCodeDir = resolveNativeHarnessDir("opencode", options.userHome);
  const stateDir = join(openCodeDir, ".kiln");
  let state = readNativeProjectionInstallState(stateDir);
  const owned = state.targets[OPENCODE_SKILL_VISIBILITY_TARGET_ID];
  if (!owned) return { removed: [] as string[], errors: [] as string[] };
  const original = existsSync(owned.filePath) ? readFileSync(owned.filePath, "utf8") : undefined;
  if (original === undefined) return { removed: [] as string[], errors: [`${OPENCODE_SKILL_VISIBILITY_TARGET_ID}: native file missing`] };
  let document: Record<string, unknown>;
  try { document = requireRecord(JSON.parse(stripJsonComments(original)), "configuration root must be an object"); }
  catch (error) { return { removed: [] as string[], errors: [String(error)] }; }
  const drift = detectNativeProjectionDrift({ targetId: OPENCODE_SKILL_VISIBILITY_TARGET_ID, state, currentDocument: document });
  if (drift && !options.force) return { removed: [] as string[], errors: [`${OPENCODE_SKILL_VISIBILITY_TARGET_ID}: managed field drift`] };
  try {
    writeFileAtomically(owned.filePath, JSON.stringify(stripManagedFields({ currentDocument: document, managedFields: owned.managedFields }), null, 2) + "\n");
    state = removeNativeProjectionTargetState(state, OPENCODE_SKILL_VISIBILITY_TARGET_ID);
    writeNativeProjectionInstallState(stateDir, state);
  } catch (error) { restoreFile(owned.filePath, original); return { removed: [] as string[], errors: [String(error)] }; }
  return { removed: [OPENCODE_SKILL_VISIBILITY_TARGET_ID], errors: [] as string[] };
}

export async function syncNativePermissionProjections(
  kilnYaml: ResolvedKilnConfig,
  projectPath: string,
  options: NativePermissionProjectionOptions = {},
): Promise<NativePermissionProjectionResult> {
  const errors: string[] = [];
  const outcomes: ProjectionOutcome[] = [];
  const policy = resolveModelFacingPermissionPolicy(kilnYaml.permissions);
  const stateBinding = options.projectStateBinding ?? resolveProjectStateBinding(projectPath, options.userHome === undefined
    ? {}
    : { kilnHome: join(options.userHome, ".kiln") });
  const projectionStateDir = stateBinding.projectionsPath;
  const backupStateRoot = stateBinding.projectStateRoot;
  const modelGateway = options.modelGateway;
  let installState = readNativeProjectionInstallState(projectionStateDir);
  let claudeResult: PermissionTargetResult = skippedPermissionTarget();
  let codexResult: PermissionTargetResult = skippedPermissionTarget();
  let opencodeResult: PermissionTargetResult = skippedPermissionTarget();
  const rollbacks: Array<() => void> = [];
  try {
    claudeResult = isNativeProjectionHarnessDisabled(options, "claude")
      ? skippedPermissionTarget(PERMISSION_PROJECTION_TARGET_IDS.claude, join(projectPath, ".claude", "settings.json"))
      : await syncClaudePermissions(policy, projectPath, backupStateRoot, installState, options);
    outcomes.push(...claudeResult.outcomes);
    if (claudeResult.rollback) rollbacks.push(claudeResult.rollback);
    if (claudeResult.snapshot) installState = upsertNativeProjectionTargetState(installState, claudeResult.snapshot);
    if (claudeResult.error) errors.push(`Claude Code: ${claudeResult.error}`);

    codexResult = isNativeProjectionHarnessDisabled(options, "codex")
      ? skippedPermissionTarget(
          PERMISSION_PROJECTION_TARGET_IDS.codex,
          join(resolveNativeHarnessDir("codex", options.userHome), "config.toml"),
        )
      : await syncCodexPermissions(kilnYaml, policy, backupStateRoot, installState, options, modelGateway);
    outcomes.push(...codexResult.outcomes);
    if (codexResult.rollback) rollbacks.push(codexResult.rollback);
    if (codexResult.snapshot) installState = upsertNativeProjectionTargetState(installState, codexResult.snapshot);
    for (const targetId of codexResult.removeTargetIds ?? [])
      installState = removeNativeProjectionTargetState(installState, targetId);
    if (codexResult.error) errors.push(`Codex: ${codexResult.error}`);

    opencodeResult = isNativeProjectionHarnessDisabled(options, "opencode")
      ? skippedPermissionTarget(
          PERMISSION_PROJECTION_TARGET_IDS.opencode,
          join(resolveNativeHarnessDir("opencode", options.userHome), "opencode.json"),
        )
      : await syncOpenCodePermissions(kilnYaml, policy, backupStateRoot, installState, options, modelGateway);
    outcomes.push(...opencodeResult.outcomes);
    if (opencodeResult.rollback) rollbacks.push(opencodeResult.rollback);
    if (opencodeResult.snapshot)
      installState = upsertNativeProjectionTargetState(installState, opencodeResult.snapshot);
    if (opencodeResult.error) errors.push(`OpenCode: ${opencodeResult.error}`);
    if (!options.dryRun) {
      writeNativeProjectionInstallState(projectionStateDir, installState, backupStateRoot);
    }
  } catch (error) {
    rollbackNativeProjectionChanges(rollbacks, error);
  }

  return {
    claude: claudeResult.ok,
    codex: codexResult.ok,
    opencode: opencodeResult.ok,
    errors,
    outcomes,
  };
}

function skippedPermissionTarget(targetId = "permission-target", path = ""): PermissionTargetResult {
  return { ok: true, outcomes: [{ targetId, path, status: "skipped", reason: "native harness is disabled" }] };
}

async function syncClaudePermissions(
  policy: KilnPermissionPolicy,
  projectPath: string,
  backupStateRoot: string,
  installState: NativeProjectionInstallState,
  options: NativePermissionProjectionOptions,
): Promise<PermissionTargetResult> {
  const targetId = PERMISSION_PROJECTION_TARGET_IDS.claude;
  const target = join(projectPath, ".claude", "settings.json");
  const originalContent = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  let existing: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      existing = requireRecord(JSON.parse(originalContent!), "configuration root must be an object");
    } catch (error) {
      return unreadablePermissionTarget(targetId, target, error);
    }
  }
  const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument: existing });
  if (drift && !options.force) {
    return {
      ok: false,
      error: `managed field drift detected: ${drift.driftedFields.join(", ")}`,
      outcomes: [
        {
          targetId,
          path: target,
          status: "blocked",
          reason: `managed field drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
        },
      ],
    };
  }

  const projection = translateClaudePermissionProjection({
    policy,
    existingDocument: existing,
    previousManagedFields: installState.targets[targetId]?.managedFields,
  });
  const snapshot = createNativeProjectionSnapshot({
    targetId: projection.targetId,
    filePath: target,
    document: projection.document,
    managedFields: projection.managedFields,
    permissionIntegrity: projection.integrity,
  });
  if (options.dryRun) {
    return {
      ok: true,
      outcomes: [{ targetId, path: target, status: "planned", reason: "write projected permission settings" }],
    };
  }
  ensureDir(dirname(target));
  backupNativeProjectionFile({
    kilnDir: backupStateRoot,
    privateStateRoot: backupStateRoot,
    targetId,
    filePath: target,
  });
  const rollback = () => restoreFile(target, originalContent);
  try {
    writeFileAtomically(target, JSON.stringify(projection.document, null, 2) + "\n");
  } catch (error) {
    rollbackNativeProjectionChanges([rollback], error);
  }
  return {
    ok: true,
    snapshot,
    rollback,
    outcomes: [{ targetId, path: target, status: "written" }],
  };
}

async function syncCodexPermissions(
  kilnYaml: ResolvedKilnConfig,
  policy: KilnPermissionPolicy,
  kilnDir: string,
  installState: NativeProjectionInstallState,
  options: NativePermissionProjectionOptions,
  modelGateway: ModelGatewayConfig | undefined,
): Promise<PermissionTargetResult> {
  const targetId = PERMISSION_PROJECTION_TARGET_IDS.codex;
  const target = join(resolveNativeHarnessDir("codex", options.userHome), "config.toml");
  const originalConfigContent = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  let doc: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      doc = requireRecord(parseToml(originalConfigContent!), "configuration root must be an object");
    } catch (error) {
      return unreadablePermissionTarget(targetId, target, error);
    }
  }
  const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument: doc });
  if (drift && !options.force) {
    return {
      ok: false,
      error: `managed field drift detected: ${drift.driftedFields.join(", ")}`,
      outcomes: [
        {
          targetId,
          path: target,
          status: "blocked",
          reason: `managed field drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
        },
      ],
    };
  }

  const previousManagedFields = installState.targets[targetId]?.managedFields ?? [];
  const projection = translateCodexPermissionProjection({
    policy,
    existingDocument: doc,
    kilnYaml,
    ownsManagedDefault: installState.targets[targetId]?.managedFields.includes("model") === true,
    suppressManagedDefault: modelGateway?.principals.some(
      (principal) => principal.ingress === "openai-responses" && principal.nativeHarness === "codex",
    ) === true,
    previousManagedFields,
  });
  const snapshot = createNativeProjectionSnapshot({
    targetId: projection.targetId,
    filePath: target,
    document: projection.document,
    managedFields: projection.managedFields,
    permissionIntegrity: projection.integrity,
  });
  if (options.dryRun) {
    return {
      ok: true,
      outcomes: [{ targetId, path: target, status: "planned", reason: "write projected permission settings" }],
    };
  }
  ensureDir(dirname(target));
  backupNativeProjectionFile({ kilnDir, privateStateRoot: kilnDir, targetId, filePath: target });
  const rollback = () => {
    restoreFile(target, originalConfigContent);
  };
  try {
    writeFileAtomically(target, stringifyToml(projection.document));
  } catch (error) {
    rollbackNativeProjectionChanges([rollback], error);
  }
  return {
    ok: true,
    snapshot,
    rollback,
    outcomes: [{ targetId, path: target, status: "written" }],
  };
}

async function syncOpenCodePermissions(
  kilnYaml: ResolvedKilnConfig,
  policy: KilnPermissionPolicy,
  kilnDir: string,
  installState: NativeProjectionInstallState,
  options: NativePermissionProjectionOptions,
  modelGateway: ModelGatewayConfig | undefined,
): Promise<PermissionTargetResult> {
  const targetId = PERMISSION_PROJECTION_TARGET_IDS.opencode;
  const target = join(resolveNativeHarnessDir("opencode", options.userHome), "opencode.json");
  const originalContent = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  let existing: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      const stripped = stripJsonComments(originalContent!);
      existing = requireRecord(JSON.parse(stripped), "configuration root must be an object");
    } catch (error) {
      return unreadablePermissionTarget(targetId, target, error);
    }
  }
  const drift = detectNativeProjectionDrift({ targetId, state: installState, currentDocument: existing });
  if (drift && !options.force) {
    return {
      ok: false,
      error: `managed field drift detected: ${drift.driftedFields.join(", ")}`,
      outcomes: [
        {
          targetId,
          path: target,
          status: "blocked",
          reason: `managed field drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
        },
      ],
    };
  }

  const gatewayProjection = modelGateway ? buildOpenCodeResponsesProjection({ config: modelGateway }) : undefined;
  const projection = translateOpenCodePermissionProjection({
    policy,
    existingDocument: existing,
    kilnYaml,
    ownsManagedDefault: installState.targets[targetId]?.managedFields.includes("model") === true,
    gatewayProjection,
    previousManagedFields: installState.targets[targetId]?.managedFields,
  });
  const snapshot = createNativeProjectionSnapshot({
    targetId: projection.targetId,
    filePath: target,
    document: projection.document,
    managedFields: projection.managedFields,
    ...(gatewayProjection?.managedFields.includes("enabled_providers")
      ? { managedArrayItems: { enabled_providers: ["kiln"] } }
      : {}),
    permissionIntegrity: projection.integrity,
  });
  if (options.dryRun) {
    return {
      ok: true,
      outcomes: [{ targetId, path: target, status: "planned", reason: "write projected permission settings" }],
    };
  }
  ensureDir(dirname(target));
  backupNativeProjectionFile({ kilnDir, privateStateRoot: kilnDir, targetId, filePath: target });
  const rollback = () => restoreFile(target, originalContent);
  try {
    writeFileAtomically(target, JSON.stringify(projection.document, null, 2) + "\n");
  } catch (error) {
    rollbackNativeProjectionChanges([rollback], error);
  }
  return {
    ok: true,
    snapshot,
    rollback,
    outcomes: [{ targetId, path: target, status: "written" }],
  };
}

function unreadablePermissionTarget(targetId: string, path: string, error: unknown): PermissionTargetResult {
  const detail = error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "unknown parse error";
  const reason = `native configuration is unreadable and was not modified: ${detail}`;
  return { ok: false, error: reason, outcomes: [{ targetId, path, status: "failed", reason }] };
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

let nativeProjectionWriteSequence = 0;

function writeFileAtomically(path: string, content: string): void {
  ensureDir(dirname(path));
  const temporary = `${path}.${process.pid}.${++nativeProjectionWriteSequence}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function restoreFile(path: string, content: string | undefined): void {
  if (content === undefined) {
    rmSync(path, { force: true });
    return;
  }
  writeFileAtomically(path, content);
}

function rollbackNativeProjectionChanges(rollbacks: readonly (() => void)[], originalError: unknown): never {
  const rollbackErrors: unknown[] = [];
  for (let index = rollbacks.length - 1; index >= 0; index -= 1) {
    try {
      rollbacks[index]!();
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  if (rollbackErrors.length > 0)
    throw new AggregateError(
      [originalError, ...rollbackErrors],
      "Native projection sync failed and rollback was incomplete.",
    );
  throw originalError;
}
