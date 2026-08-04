import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { resolveRunningCliModulePath } from "../build-identity.js";
import {
  discoverClaudeCliModelDiscovery,
  discoverGuiCliOperatorModels,
} from "@kilnai/runtime";
import type { KilnConfigStatusSnapshot, KilnProjectionTargetSnapshot, KilnSkillCatalogSnapshot, TrustedExecutionIntegrity } from "@kilnai/gateway-contracts";
import { readConfigStatusSnapshot } from "./config-status.js";

export interface HarnessDoctorProviderDiscovery {
  readonly models: readonly string[];
  readonly status: string;
  readonly reason: string;
  readonly authState: string;
}

export interface HarnessDoctorModelDiscovery {
  readonly claudeModels: readonly string[];
  readonly claudeDiscovery: HarnessDoctorProviderDiscovery;
  readonly codexModels: readonly string[];
  readonly codexDiscovery: HarnessDoctorProviderDiscovery;
  readonly opencodeModels: readonly string[];
  readonly opencodeDiscovery: HarnessDoctorProviderDiscovery;
}

export interface HarnessDoctorExecutableReport {
  readonly harnessId: "kiln" | "claude" | "codex" | "opencode";
  readonly status: "available" | "missing";
  readonly canonicalExecutable?: string;
  readonly pathExecutables: readonly string[];
  readonly competingExecutables: readonly string[];
  readonly version?: string;
  readonly warnings: readonly string[];
  readonly repairActions: readonly string[];
}

/**
 * Whether the kiln that actually runs is the kiln being edited.
 *
 * `not-a-kiln-checkout` is the ordinary case: the inspected project is not the
 * kiln repository, so an installed build is correct and nothing is compared.
 * Inside a kiln checkout the distinction matters, because a globally installed
 * copy keeps serving its own compiled schema no matter what the working tree
 * says, and every diagnostic it emits describes that copy instead.
 */
export type KilnCliSourceLinkage =
  | "linked-to-checkout"
  | "detached-from-checkout"
  | "not-a-kiln-checkout";

export interface HarnessDoctorKilnReport extends HarnessDoctorExecutableReport {
  readonly harnessId: "kiln";
  readonly runningModulePath: string;
  readonly sourceLinkage: KilnCliSourceLinkage;
}

export interface HarnessDoctorHarnessReport extends HarnessDoctorExecutableReport {
  readonly harnessId: "claude" | "codex" | "opencode";
  readonly discoveryStatus: string;
  readonly discoveryReason: string;
  readonly authState: string;
  readonly models: readonly string[];
}

export interface HarnessDoctorReport {
  readonly mode: "read-only";
  readonly generatedAt: string;
  readonly projectRoot?: string;
  readonly kilnCli: HarnessDoctorKilnReport;
  readonly configProjections: readonly HarnessDoctorProjectionReport[];
  readonly permissionIntegrity: readonly TrustedExecutionIntegrity[];
  readonly skills?: KilnSkillCatalogSnapshot;
  readonly harnesses: {
    readonly claude: HarnessDoctorHarnessReport;
    readonly codex: HarnessDoctorHarnessReport;
    readonly opencode: HarnessDoctorHarnessReport;
  };
}

export interface HarnessDoctorProjectionReport {
  readonly targetId: string;
  readonly kind: string;
  readonly status: string;
  readonly path: string;
  readonly permissionIntegrity?: TrustedExecutionIntegrity;
}

export interface HarnessDoctorOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly projectRoot?: string;
  readonly now?: () => Date;
  readonly fileExists?: (path: string) => boolean;
  readonly runVersion?: (path: string) => Promise<string | undefined>;
  readonly discoverModels?: () => Promise<HarnessDoctorModelDiscovery>;
  readonly readConfigProjections?: (projectRoot: string | undefined) => Promise<readonly HarnessDoctorProjectionReport[]>;
  readonly readConfigStatus?: (projectRoot: string | undefined) => Promise<Pick<KilnConfigStatusSnapshot, "projections" | "skills">>;
  readonly runningModulePath?: string;
  readonly readPackageName?: (manifestPath: string) => string | undefined;
}

interface HarnessDefinition {
  readonly harnessId: "kiln" | "claude" | "codex" | "opencode";
  readonly commandNames: readonly string[];
  readonly preferredCandidates: (
    env: Readonly<Record<string, string | undefined>>,
    platform: NodeJS.Platform,
  ) => readonly string[];
  readonly fallbackCandidates?: (
    env: Readonly<Record<string, string | undefined>>,
    platform: NodeJS.Platform,
  ) => readonly string[];
}

const HARNESS_DEFINITIONS: readonly HarnessDefinition[] = [
  {
    harnessId: "kiln",
    commandNames: ["kiln.exe", "kiln.cmd", "kiln"],
    preferredCandidates: () => [],
  },
  {
    harnessId: "claude",
    commandNames: ["claude.exe", "claude.cmd", "claude"],
    preferredCandidates: (env, platform) => {
      const home = resolveHome(env);
      return home ? [pathApi(platform).join(home, ".local", "bin", "claude.exe")] : [];
    },
  },
  {
    harnessId: "codex",
    commandNames: ["codex.cmd", "codex.exe", "codex"],
    preferredCandidates: (env, platform) => {
      const home = resolveHome(env);
      return home
        ? [
            pathApi(platform).join(home, "AppData", "Roaming", "npm", "codex.cmd"),
          ]
        : [];
    },
    fallbackCandidates: (env, platform) => {
      const home = resolveHome(env);
      return home ? [pathApi(platform).join(home, ".codex", ".sandbox-bin", "codex.exe")] : [];
    },
  },
  {
    harnessId: "opencode",
    commandNames: ["opencode.exe", "opencode.cmd", "opencode"],
    preferredCandidates: () => [],
    fallbackCandidates: (env, platform) => {
      const home = resolveHome(env);
      return home
        ? [
            pathApi(platform).join(home, ".bun", "bin", "opencode.exe"),
            pathApi(platform).join(home, "AppData", "Roaming", "npm", "opencode.cmd"),
          ]
        : [];
    },
  },
];

export async function buildHarnessDoctorReport(options: HarnessDoctorOptions = {}): Promise<HarnessDoctorReport> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const fileExists = options.fileExists ?? existsSync;
  const runVersion = options.runVersion ?? defaultRunVersion;
  const modelDiscovery = await (options.discoverModels ?? discoverHarnessDoctorModels)();
  const configDiagnostics = await readHarnessConfigDiagnostics(options);
  const configProjections = configDiagnostics.projections;
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();

  const kilnCli = buildKilnCliReport(
    await resolveExecutableReport(definitionFor("kiln"), env, fileExists, runVersion, platform),
    options.projectRoot,
    options.runningModulePath ?? resolveRunningCliModulePath(),
    options.readPackageName ?? defaultReadPackageName,
    platform,
  );
  const claude = await resolveHarnessReport(
    definitionFor("claude"),
    modelDiscovery.claudeDiscovery,
    env,
    fileExists,
    runVersion,
    platform,
  );
  const codex = await resolveHarnessReport(
    definitionFor("codex"),
    modelDiscovery.codexDiscovery,
    env,
    fileExists,
    runVersion,
    platform,
  );
  const opencode = await resolveHarnessReport(
    definitionFor("opencode"),
    modelDiscovery.opencodeDiscovery,
    env,
    fileExists,
    runVersion,
    platform,
  );

  return {
    mode: "read-only",
    generatedAt,
    projectRoot: options.projectRoot,
    kilnCli,
    configProjections,
    permissionIntegrity: aggregateDoctorPermissionIntegrity(configProjections),
    ...(configDiagnostics.skills ? { skills: configDiagnostics.skills } : {}),
    harnesses: {
      claude,
      codex,
      opencode,
    },
  };
}

export function renderHarnessDoctorText(report: HarnessDoctorReport): string {
  const lines = [
    "",
    "Kiln Harness Doctor",
    "",
    "  Mode: read-only diagnostics",
    `  Generated: ${report.generatedAt}`,
  ];
  if (report.projectRoot) {
    lines.push(`  Project:   ${report.projectRoot}`);
  }
  lines.push("");
  appendExecutable(lines, "Kiln CLI", report.kilnCli, [
    `    Running from: ${report.kilnCli.runningModulePath}`,
    `    Source linkage: ${report.kilnCli.sourceLinkage}`,
  ]);
  appendConfigProjections(lines, report.configProjections);
  appendPermissionIntegrity(lines, report.permissionIntegrity);
  appendSkillCatalog(lines, report.skills);
  appendHarness(lines, "Claude Code", report.harnesses.claude);
  appendHarness(lines, "Codex", report.harnesses.codex);
  appendHarness(lines, "OpenCode", report.harnesses.opencode);
  return `${lines.join("\n")}\n`;
}

async function discoverHarnessDoctorModels(): Promise<HarnessDoctorModelDiscovery> {
  const [cliModels, claudeDiscovery] = await Promise.all([
    discoverGuiCliOperatorModels({ codex: true, opencode: true }),
    discoverClaudeCliModelDiscovery(),
  ]);
  return {
    ...cliModels,
    claudeModels: claudeDiscovery.models,
    claudeDiscovery,
  };
}

function appendSkillCatalog(
  lines: string[],
  skills: KilnSkillCatalogSnapshot | undefined,
): void {
  if (!skills || skills.entries.length === 0) {
    return;
  }
  const configured = skills.entries.filter((entry) => entry.configured);
  const nativeOnly = skills.entries.filter((entry) => entry.origin === "native-harness");
  const projectionIssues = skills.entries.filter((entry) =>
    entry.projections.some((projection) => projection.status !== "projected")
  ).sort(compareSkillCatalogIssuePriority);
  lines.push("  Skill catalog:");
  lines.push(`    Configured: ${configured.length}`);
  lines.push(`    Native-only: ${nativeOnly.length}`);
  lines.push(`    Projection issues: ${projectionIssues.length}`);
  for (const entry of projectionIssues.slice(0, 12)) {
    const issues = entry.projections
      .filter((projection) => projection.status !== "projected")
      .map((projection) => `${projection.target}:${projection.status}`)
      .join(", ");
    lines.push(`    - ${entry.name}: ${issues}`);
  }
  if (projectionIssues.length > 12) {
    lines.push(`    ... ${projectionIssues.length - 12} more skill projection issues`);
  }
  lines.push("");
}

function compareSkillCatalogIssuePriority(
  left: KilnSkillCatalogSnapshot["entries"][number],
  right: KilnSkillCatalogSnapshot["entries"][number],
): number {
  const originDelta = skillOriginPriority(left.origin) - skillOriginPriority(right.origin);
  if (originDelta !== 0) {
    return originDelta;
  }
  return left.name.localeCompare(right.name);
}

function skillOriginPriority(origin: KilnSkillCatalogSnapshot["entries"][number]["origin"]): number {
  switch (origin) {
    case "project":
      return 0;
    case "user":
      return 1;
    case "builtin":
      return 2;
    case "native-harness":
      return 3;
  }
  return 4;
}

function appendPermissionIntegrity(
  lines: string[],
  permissionIntegrity: readonly TrustedExecutionIntegrity[],
): void {
  if (permissionIntegrity.length === 0) {
    return;
  }
  lines.push("  Permission integrity:");
  for (const integrity of permissionIntegrity) {
    lines.push(`    - ${integrity.harness}: ${integrity.classification}`);
    lines.push(`      desired=${integrity.desired.profile} persisted=${integrity.persistedNative?.profile ?? "-"} session=${integrity.sessionOverride?.profile ?? "-"} effective=${integrity.effectiveRuntime?.profile ?? "-"}`);
    lines.push(`      sources desired=${integrity.desired.source} persisted=${integrity.persistedNative?.source ?? "-"} effective=${integrity.effectiveRuntime?.source ?? "-"}`);
    lines.push(`      proof desired=${integrity.desired.proof} persisted=${integrity.persistedNative?.proof ?? "-"} effective=${integrity.effectiveRuntime?.proof ?? "-"}`);
    lines.push(`      enforcement=${integrity.enforcement.strength} approval=${integrity.enforcement.approvalControl} sandbox=${integrity.enforcement.filesystemSandbox} network=${integrity.enforcement.networkBoundary}`);
    lines.push(`      verified=${integrity.lastVerifiedAt ?? "-"} approval required=${integrity.remediationRequiresApproval ? "yes" : "no"}`);
    lines.push(`      action=${integrity.recommendation}`);
  }
  lines.push("");
}

async function resolveHarnessReport(
  definition: HarnessDefinition,
  discovery: HarnessDoctorProviderDiscovery,
  env: Readonly<Record<string, string | undefined>>,
  fileExists: (path: string) => boolean,
  runVersion: (path: string) => Promise<string | undefined>,
  platform: NodeJS.Platform,
): Promise<HarnessDoctorHarnessReport> {
  const executable = await resolveExecutableReport(definition, env, fileExists, runVersion, platform);
  return {
    ...executable,
    harnessId: definition.harnessId as "claude" | "codex" | "opencode",
    discoveryStatus: discovery.status,
    discoveryReason: discovery.reason,
    authState: discovery.authState,
    models: discovery.models,
  };
}

async function resolveExecutableReport(
  definition: HarnessDefinition,
  env: Readonly<Record<string, string | undefined>>,
  fileExists: (path: string) => boolean,
  runVersion: (path: string) => Promise<string | undefined>,
  platform: NodeJS.Platform,
): Promise<HarnessDoctorExecutableReport> {
  const pathExecutables = findPathExecutables(definition.commandNames, env, fileExists, platform);
  const candidates = dedupePaths([
    ...definition.preferredCandidates(env, platform),
    ...pathExecutables,
    ...(definition.fallbackCandidates?.(env, platform) ?? []),
  ]);
  let canonicalExecutable: string | undefined;
  let version: string | undefined;
  for (const candidate of candidates) {
    const resolvedVersion = await runVersion(candidate);
    if (resolvedVersion !== undefined) {
      canonicalExecutable = candidate;
      version = resolvedVersion;
      break;
    }
  }

  const competingExecutables = canonicalExecutable
    ? pathExecutables.filter((path) => normalizePath(path) !== normalizePath(canonicalExecutable))
    : pathExecutables;
  const warnings = buildWarnings(definition, competingExecutables);

  return {
    harnessId: definition.harnessId,
    status: canonicalExecutable ? "available" : "missing",
    canonicalExecutable,
    pathExecutables,
    competingExecutables,
    version,
    warnings,
    repairActions: [],
  };
}

function appendExecutable(
  lines: string[],
  title: string,
  executable: HarnessDoctorExecutableReport,
  extraLines: readonly string[] = [],
): void {
  lines.push(`  ${title}:`);
  lines.push(`    ID: ${executable.harnessId}`);
  lines.push(`    Status: ${executable.status}`);
  lines.push(`    Executable: ${executable.canonicalExecutable ?? "-"}`);
  lines.push(`    Version: ${executable.version ?? "-"}`);
  lines.push(`    PATH entries: ${executable.pathExecutables.length > 0 ? executable.pathExecutables.join(", ") : "-"}`);
  lines.push(...extraLines);
  if (executable.competingExecutables.length > 0) {
    lines.push(`    Competing entries: ${executable.competingExecutables.join(", ")}`);
  }
  for (const warning of executable.warnings) {
    lines.push(`    Warning: ${warning}`);
  }
  for (const repairAction of executable.repairActions) {
    lines.push(`    Repair: ${repairAction}`);
  }
  lines.push("");
}

function appendHarness(
  lines: string[],
  title: string,
  harness: HarnessDoctorHarnessReport,
): void {
  appendExecutable(lines, title, harness);
  lines.splice(lines.length - 1, 0,
    `    Discovery: ${harness.discoveryStatus}`,
    `    Auth: ${harness.authState}`,
    `    Models: ${formatModelSummary(harness.models)}`,
    `    Reason: ${harness.discoveryReason}`,
  );
}

function appendConfigProjections(
  lines: string[],
  projections: readonly HarnessDoctorProjectionReport[],
): void {
  if (projections.length === 0) {
    return;
  }
  lines.push("  Config projections:");
  const visible = projections.slice(0, 20);
  for (const projection of visible) {
    lines.push(`    - ${projection.targetId}: ${projection.status} (${projection.kind}) ${projection.path}`);
  }
  if (projections.length > visible.length) {
    lines.push(`    ... ${projections.length - visible.length} more projections (${projections.length} total)`);
  }
  lines.push("");
}

function buildWarnings(
  definition: HarnessDefinition,
  competingExecutables: readonly string[],
): string[] {
  return competingExecutables.map((path) =>
    `Competing ${definition.harnessId} executable on PATH: ${path}`
  );
}

/**
 * A kiln checkout is identified by its own CLI manifest rather than by folder
 * name, so the check cannot be fooled by a directory that merely looks like the
 * repository.
 */
function isKilnCheckout(
  projectRoot: string | undefined,
  readPackageName: (manifestPath: string) => string | undefined,
  platform: NodeJS.Platform,
): boolean {
  if (!projectRoot) {
    return false;
  }
  const manifest = pathApi(platform).join(projectRoot, "packages", "cli", "package.json");
  return readPackageName(manifest) === "@kilnai/cli";
}

function resolveSourceLinkage(
  projectRoot: string | undefined,
  runningModulePath: string,
  readPackageName: (manifestPath: string) => string | undefined,
  platform: NodeJS.Platform,
): KilnCliSourceLinkage {
  if (!projectRoot || !isKilnCheckout(projectRoot, readPackageName, platform)) {
    return "not-a-kiln-checkout";
  }
  return normalizePath(runningModulePath).startsWith(normalizePath(projectRoot))
    ? "linked-to-checkout"
    : "detached-from-checkout";
}

function buildKilnCliReport(
  executable: HarnessDoctorExecutableReport,
  projectRoot: string | undefined,
  runningModulePath: string,
  readPackageName: (manifestPath: string) => string | undefined,
  platform: NodeJS.Platform,
): HarnessDoctorKilnReport {
  const sourceLinkage = resolveSourceLinkage(projectRoot, runningModulePath, readPackageName, platform);
  const detached = sourceLinkage === "detached-from-checkout";
  return {
    ...executable,
    harnessId: "kiln",
    runningModulePath,
    sourceLinkage,
    warnings: detached
      ? [
          ...executable.warnings,
          `Running kiln resolves to ${runningModulePath}, outside this kiln checkout.`
          + ` Commands run a build that is not the source in ${projectRoot}.`,
        ]
      : executable.warnings,
    repairActions: detached
      ? [
          ...executable.repairActions,
          `Run "bun link" in ${pathApi(platform).join(projectRoot ?? "", "packages", "cli")}`
          + " so the global kiln resolves to this checkout.",
        ]
      : executable.repairActions,
  };
}

function defaultReadPackageName(manifestPath: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (typeof parsed === "object" && parsed !== null && "name" in parsed) {
      const name = (parsed as { name?: unknown }).name;
      return typeof name === "string" ? name : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function findPathExecutables(
  commandNames: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  fileExists: (path: string) => boolean,
  platform: NodeJS.Platform,
): string[] {
  const path = pathApi(platform);
  const pathValue = env.PATH ?? env.Path ?? "";
  const entries = pathValue.split(path.delimiter).filter((entry) => entry.trim().length > 0);
  return dedupePaths(entries.flatMap((entry) =>
    commandNames.map((commandName) => path.join(entry, commandName)).filter(fileExists)
  ));
}

function pathApi(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === "win32" ? win32 : posix;
}

function definitionFor(harnessId: HarnessDefinition["harnessId"]): HarnessDefinition {
  const definition = HARNESS_DEFINITIONS.find((entry) => entry.harnessId === harnessId);
  if (!definition) {
    throw new Error(`Unknown harness '${harnessId}'`);
  }
  return definition;
}

function resolveHome(env: Readonly<Record<string, string | undefined>>): string | undefined {
  return env.HOME ?? env.USERPROFILE;
}

function dedupePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const key = normalizePath(path);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(path);
    }
  }
  return result;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function formatModelSummary(models: readonly string[]): string {
  if (models.length === 0) {
    return "-";
  }
  const visible = models.slice(0, 12);
  const suffix = models.length > visible.length ? `, ... (${models.length} total)` : "";
  return `${visible.join(", ")}${suffix}`;
}

async function defaultRunVersion(path: string): Promise<string | undefined> {
  try {
    return execSync(`"${path}" --version`, { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

async function readHarnessConfigDiagnostics(options: HarnessDoctorOptions): Promise<{
  readonly projections: readonly HarnessDoctorProjectionReport[];
  readonly skills?: KilnSkillCatalogSnapshot;
}> {
  if (options.readConfigStatus) {
    const snapshot = await options.readConfigStatus(options.projectRoot);
    return {
      projections: snapshot.projections.map(projectProjection),
      ...(snapshot.skills ? { skills: snapshot.skills } : {}),
    };
  }
  if (options.readConfigProjections) {
    return {
      projections: await options.readConfigProjections(options.projectRoot),
    };
  }
  const snapshot = await readConfigStatusSnapshot({ projectPath: options.projectRoot });
  return {
    projections: snapshot.projections.map(projectProjection),
    ...(snapshot.skills ? { skills: snapshot.skills } : {}),
  };
}

function projectProjection(projection: KilnProjectionTargetSnapshot): HarnessDoctorProjectionReport {
  return {
    targetId: projection.targetId,
    kind: projection.kind,
    status: projection.status,
    path: projection.path,
    ...(projection.permissionIntegrity ? { permissionIntegrity: projection.permissionIntegrity } : {}),
  };
}

function aggregateDoctorPermissionIntegrity(
  projections: readonly HarnessDoctorProjectionReport[],
): readonly TrustedExecutionIntegrity[] {
  return projections
    .map((projection) => projection.permissionIntegrity)
    .filter((integrity): integrity is TrustedExecutionIntegrity => integrity !== undefined);
}
