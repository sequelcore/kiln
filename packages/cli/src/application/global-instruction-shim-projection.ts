import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  findInstructionProfile,
  loadInstructionProfiles,
  type KilnInstructionDoctrineDefinition,
  type KilnInstructionProfileDefinition,
} from "./instruction-profile-loader.js";
import {
  resolveProjectStateBinding,
  type ProjectStateBinding,
} from "./project-state-root.js";
import { resolveProjectRoot } from "./project-root-resolver.js";
import { loadKilnConfig } from "../config/config-merger.js";
import { backupNativeProjectionFile } from "../config/native-projection-backup.js";
import {
  createNativeProjectionFileSnapshot,
  detectNativeProjectionFileDrift,
  readNativeProjectionInstallState,
  resolveGlobalNativeProjectionStateDir,
  removeNativeProjectionTargetState,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
  type NativeProjectionInstallState,
} from "../config/native-projection-state.js";
import {
  isNativeProjectionHarnessDisabled,
  type ProjectionOutcome,
  type NativeProjectionHarness,
} from "../config/native-projection-policy.js";

const GENERATOR_VERSION = "global-instruction-shims-v1";
const SIGNATURE = "kiln:global-instruction-shim:v1";

export type GlobalInstructionShimHarness = Extract<NativeProjectionHarness, "codex" | "claude" | "opencode">;

export type GlobalInstructionShimStatus =
  | "missing"
  | "current"
  | "stale"
  | "drifted"
  | "unmanaged"
  | "planned"
  | "written"
  | "unchanged"
  | "blocked"
  | "failed"
  | "removed"
  | "disabled"
  | "disabled-unmanaged";

export interface GlobalInstructionShimTarget {
  readonly targetId: string;
  readonly harness: GlobalInstructionShimHarness;
  readonly displayName: string;
  readonly filePath: string;
}

export interface GlobalInstructionShimSnapshot extends GlobalInstructionShimTarget {
  readonly status: Extract<GlobalInstructionShimStatus, "missing" | "current" | "stale" | "drifted" | "unmanaged">;
  readonly details?: string;
}

export interface GlobalInstructionShimTargetResult extends GlobalInstructionShimTarget {
  readonly status: Extract<
    GlobalInstructionShimStatus,
    "planned" | "written" | "unchanged" | "blocked" | "failed" | "removed" | "disabled" | "disabled-unmanaged"
  >;
  readonly written: boolean;
  readonly backupPath?: string;
  readonly errors: readonly string[];
}

export interface GlobalInstructionShimProjectionOptions {
  readonly userHome?: string;
  /** Established private state binding for reading this project's config and profiles. */
  readonly projectStateBinding?: ProjectStateBinding;
  readonly force?: boolean;
  readonly adoptUnmanaged?: boolean;
  readonly disabledHarnesses?: readonly NativeProjectionHarness[];
  readonly timestamp?: string;
  readonly dryRun?: boolean;
}

export interface GlobalInstructionShimProjectionResult {
  readonly synced: number;
  readonly targets: readonly GlobalInstructionShimTargetResult[];
  readonly errors: readonly string[];
  readonly outcomes: readonly ProjectionOutcome[];
}

interface ProjectionContext {
  readonly projectionStateDir: string;
  readonly profiles: readonly KilnInstructionProfileDefinition[];
  readonly sourceProfiles: readonly string[];
}

export function listGlobalInstructionShimTargets(userHome: string): readonly GlobalInstructionShimTarget[] {
  return [
    {
      targetId: "codex-global-instructions",
      harness: "codex",
      displayName: "Codex global instructions",
      filePath: join(userHome, ".codex", "AGENTS.md"),
    },
    {
      targetId: "claude-global-instructions",
      harness: "claude",
      displayName: "Claude global instructions",
      filePath: join(userHome, ".claude", "CLAUDE.md"),
    },
    {
      targetId: "opencode-global-instructions",
      harness: "opencode",
      displayName: "OpenCode global instructions",
      filePath: join(userHome, ".config", "opencode", "AGENTS.md"),
    },
  ];
}

export async function readGlobalInstructionShimProjectionSnapshots(
  projectPath: string,
  options: GlobalInstructionShimProjectionOptions = {},
): Promise<readonly GlobalInstructionShimSnapshot[]> {
  const context = await loadProjectionContext(projectPath, options);
  const state = readNativeProjectionInstallState(context.projectionStateDir);
  return listGlobalInstructionShimTargets(requireUserHome(options.userHome)).map((target) =>
    classifyTarget(context, state, target)
  );
}

export async function syncGlobalInstructionShimProjections(
  projectPath: string,
  options: GlobalInstructionShimProjectionOptions = {},
): Promise<GlobalInstructionShimProjectionResult> {
  let context: ProjectionContext;
  try {
    context = await loadProjectionContext(projectPath, options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      synced: 0,
      targets: [],
      errors: [reason],
      outcomes: [{ targetId: "global-instruction-shims", path: projectPath, status: "failed", reason }],
    };
  }
  let state = readNativeProjectionInstallState(context.projectionStateDir);
  const results: GlobalInstructionShimTargetResult[] = [];

  for (const target of listGlobalInstructionShimTargets(requireUserHome(options.userHome))) {
    try {
      const targetSync = syncTarget(context, state, target, options);
      state = targetSync.state;
      results.push(targetSync.targetResult);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      results.push(result(target, "failed", undefined, [reason]));
    }
  }

  if (!options.dryRun) writeNativeProjectionInstallState(context.projectionStateDir, state);
  return {
    synced: results.filter((target) => target.written).length,
    targets: results,
    errors: results.flatMap((target) => [...target.errors]),
    outcomes: results.map((target): ProjectionOutcome => ({
      targetId: target.targetId,
      path: target.filePath,
      status: target.status === "disabled" || target.status === "disabled-unmanaged" ? "skipped" : target.status,
      ...(target.errors[0] ? { reason: target.errors[0] } : {}),
    })),
  };
}

function syncTarget(
  context: ProjectionContext,
  state: NativeProjectionInstallState,
  target: GlobalInstructionShimTarget,
  options: GlobalInstructionShimProjectionOptions,
): {
  readonly state: NativeProjectionInstallState;
  readonly targetResult: GlobalInstructionShimTargetResult;
} {
  if (isNativeProjectionHarnessDisabled(options, target.harness)) {
    return disableTarget(context, state, target, options.dryRun ?? false);
  }

  const snapshot = classifyTarget(context, state, target);
  const content = renderSignedGlobalInstructionShim(context, target);
  if (snapshot.status === "current") {
    return {
      state,
      targetResult: result(target, "unchanged"),
    };
  }
  if (snapshot.status === "unmanaged" && !options.adoptUnmanaged) {
    return {
      state,
      targetResult: result(target, "blocked", undefined, [
        `${target.targetId}: unmanaged global instruction file exists; rerun with adoption after review`,
      ]),
    };
  }
  if (snapshot.status === "drifted" && !options.force) {
    return {
      state,
      targetResult: result(target, "blocked", undefined, [
        `${target.targetId}: managed global instruction drift detected; rerun with force after review`,
      ]),
    };
  }

  if (options.dryRun) {
    return {
      state,
      targetResult: result(target, "planned"),
    };
  }

  const backupPath = snapshot.status === "unmanaged" || snapshot.status === "drifted" || snapshot.status === "stale"
    ? backupNativeProjectionFile({
      kilnDir: context.projectionStateDir,
      targetId: target.targetId,
      filePath: target.filePath,
      timestamp: options.timestamp,
    })
    : undefined;
  mkdirSync(dirname(target.filePath), { recursive: true });
  if (isSymbolicLink(target.filePath)) {
    rmSync(target.filePath);
  }
  writeFileSync(target.filePath, content, "utf-8");

  return {
    state: upsertNativeProjectionTargetState(
      state,
      createNativeProjectionFileSnapshot({
        targetId: target.targetId,
        filePath: target.filePath,
        content,
        updatedAt: options.timestamp,
      }),
    ),
    targetResult: result(target, "written", backupPath),
  };
}

function disableTarget(
  _context: ProjectionContext,
  state: NativeProjectionInstallState,
  target: GlobalInstructionShimTarget,
  dryRun: boolean,
): {
  readonly state: NativeProjectionInstallState;
  readonly targetResult: GlobalInstructionShimTargetResult;
} {
  const targetState = state.targets[target.targetId];
  if (!targetState) {
    return {
      state,
      targetResult: result(target, existsSync(target.filePath) ? "disabled-unmanaged" : "disabled"),
    };
  }

  const current = existsSync(target.filePath) ? readFileSync(target.filePath, "utf-8") : null;
  if (current && detectNativeProjectionFileDrift({ targetId: target.targetId, state, currentContent: current })) {
    return {
      state,
      targetResult: result(target, "disabled-unmanaged"),
    };
  }

  if (existsSync(target.filePath)) {
    if (dryRun) {
      return {
        state,
        targetResult: result(target, "planned"),
      };
    }
    rmSync(target.filePath);
  }
  if (dryRun) {
    return {
      state,
      targetResult: result(target, "planned"),
    };
  }
  return {
    state: removeNativeProjectionTargetState(state, target.targetId),
    targetResult: result(target, "removed"),
  };
}

function classifyTarget(
  context: ProjectionContext,
  state: NativeProjectionInstallState,
  target: GlobalInstructionShimTarget,
): GlobalInstructionShimSnapshot {
  const current = existsSync(target.filePath) ? readFileSync(target.filePath, "utf-8") : null;
  const targetState = state.targets[target.targetId];
  if (!current) {
    return { ...target, status: "missing" };
  }
  if (!targetState) {
    return { ...target, status: "unmanaged" };
  }
  const drift = detectNativeProjectionFileDrift({
    targetId: target.targetId,
    state,
    currentContent: current,
  });
  if (drift) {
    return { ...target, status: "drifted", details: "managed global instruction file changed outside Kiln" };
  }
  if (isSymbolicLink(target.filePath)) {
    return { ...target, status: "stale", details: "global instruction entrypoint is a symlink; Kiln manages independent harness files" };
  }

  const expected = renderSignedGlobalInstructionShim(context, target);
  return {
    ...target,
    status: current === expected ? "current" : "stale",
  };
}

async function loadProjectionContext(
  projectPath: string,
  options: GlobalInstructionShimProjectionOptions,
): Promise<ProjectionContext> {
  const home = requireUserHome(options.userHome);
  const projectRoot = options.projectStateBinding?.canonicalRoot
    ?? resolveProjectRoot({
      explicitPath: projectPath,
      ...(options.userHome ? { userHome: home } : {}),
    }).rootPath;
  const stateBinding = options.projectStateBinding
    ?? resolveProjectStateBinding(projectRoot);
  const kilnConfig = await loadKilnConfig(projectRoot, { projectStateBinding: stateBinding });
  const allProfiles = loadInstructionProfiles(projectRoot, options.userHome, { projectStateBinding: stateBinding });
  const activeProfiles = kilnConfig?.activeInstructionProfiles ?? [];
  const profiles = activeProfiles
    .map((profileId) => findInstructionProfile(allProfiles, profileId))
    .filter((profile): profile is KilnInstructionProfileDefinition => profile?.scope === "global");
  return {
    projectionStateDir: resolveGlobalNativeProjectionStateDir(options.userHome),
    profiles,
    sourceProfiles: profiles.map((profile) => profile.name),
  };
}

function renderSignedGlobalInstructionShim(
  context: ProjectionContext,
  target: GlobalInstructionShimTarget,
): string {
  const body = renderGlobalInstructionShimBody(context, target);
  const contentHash = hashText(body);
  return [
    "<!--",
    SIGNATURE,
    `target: ${target.harness}`,
    `sourceProfiles: ${context.sourceProfiles.length > 0 ? context.sourceProfiles.join(",") : "-"}`,
    `generator: ${GENERATOR_VERSION}`,
    `contentHash: sha256:${contentHash}`,
    "-->",
    body,
  ].join("\n");
}

function renderGlobalInstructionShimBody(
  context: ProjectionContext,
  target: GlobalInstructionShimTarget,
): string {
  return [
    "# Sequel Global Instructions",
    "",
    `> Generated by kiln sync --global-instructions for ${target.displayName}. Do not edit manually.`,
    "",
    ...renderAuthoritySection(),
    ...renderDirectProviderBoundarySection(),
    ...renderInstructionProfilesSection(context.profiles),
  ].join("\n");
}

function renderAuthoritySection(): readonly string[] {
  return [
    "## Authority",
    "",
    "Canonical durable doctrine lives in `~/.kiln/instructions`. Native harness files are generated entrypoint shims.",
    "Project repositories add only project-specific context through repo shims and private project context state.",
    "",
  ];
}

function renderDirectProviderBoundarySection(): readonly string[] {
  return [
    "## Direct Provider Boundary",
    "",
    "- `codex-oauth`, `opencode-go`, and `opencode-zen` are Kiln direct providers governed by Kiln runtime authority.",
    "- Native Codex, Claude, and OpenCode CLI permissions apply only when those CLIs are used as standalone harnesses.",
    "- Do not infer native CLI permission requirements from a Kiln direct provider route.",
    "",
  ];
}

function renderInstructionProfilesSection(profiles: readonly KilnInstructionProfileDefinition[]): readonly string[] {
  if (profiles.length === 0) {
    return [
      "## Active Global Profiles",
      "",
      "No active global instruction profiles were resolved. Configure `activeInstructionProfiles` in Kiln before relying on this shim.",
      "",
    ];
  }

  return [
    "## Active Global Profiles",
    "",
    ...profiles.flatMap(renderInstructionProfile),
  ];
}

function renderInstructionProfile(profile: KilnInstructionProfileDefinition): readonly string[] {
  return [
    `### ${profile.displayName ?? profile.name}`,
    "",
    `- Source: ${formatProfilePath(profile)}`,
    ...(profile.description ? [`- Description: ${profile.description}`] : []),
    ...renderDoctrine(profile.doctrine),
    "",
    profile.instructions.trim(),
    "",
  ];
}

function renderDoctrine(doctrine: KilnInstructionDoctrineDefinition | undefined): readonly string[] {
  if (!doctrine) {
    return [];
  }
  return [
    ...renderDoctrineList("Principles", doctrine.principles),
    ...renderDoctrineList("Workflow", doctrine.workflow),
    ...renderDoctrineList("Quality gates", doctrine.qualityGates),
    ...renderDoctrineList("Review posture", doctrine.reviewPosture),
    ...renderDoctrineList("Delegation", doctrine.delegation),
    ...renderDoctrineList("Execution discipline", doctrine.executionDiscipline),
  ];
}

function renderDoctrineList(label: string, values: readonly string[] | undefined): readonly string[] {
  if (!values || values.length === 0) {
    return [];
  }
  return [
    `- ${label}: ${values.join("; ")}`,
  ];
}

function result(
  target: GlobalInstructionShimTarget,
  status: GlobalInstructionShimTargetResult["status"],
  backupPath?: string,
  errors: readonly string[] = [],
): GlobalInstructionShimTargetResult {
  return {
    ...target,
    status,
    written: status === "written",
    ...(backupPath ? { backupPath } : {}),
    errors,
  };
}

function formatProfilePath(profile: KilnInstructionProfileDefinition): string {
  const normalizedPath = profile.filePath.replace(/\\/g, "/");
  const marker = "/.kiln/instructions/";
  const index = normalizedPath.indexOf(marker);
  return index >= 0
    ? `~/.kiln/instructions/${normalizedPath.slice(index + marker.length)}`
    : normalizedPath;
}

function requireUserHome(userHome: string | undefined): string {
  const resolved = userHome?.trim() || homedir();
  if (!resolved) {
    throw new Error("Unable to resolve user home for global instruction shim projection");
  }
  return resolved;
}

function isSymbolicLink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
