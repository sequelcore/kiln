import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { discoverGuiCliOperatorModels } from "@kilnai/runtime";
import type { KilnProjectionTargetSnapshot } from "@kilnai/gateway-contracts";
import { readConfigStatusSnapshot } from "./config-status.js";

export interface HarnessDoctorProviderDiscovery {
  readonly models: readonly string[];
  readonly status: string;
  readonly reason: string;
  readonly authState: string;
}

export interface HarnessDoctorModelDiscovery {
  readonly codexModels: readonly string[];
  readonly codexDiscovery: HarnessDoctorProviderDiscovery;
  readonly opencodeModels: readonly string[];
  readonly opencodeDiscovery: HarnessDoctorProviderDiscovery;
}

export interface HarnessDoctorExecutableReport {
  readonly harnessId: "kiln" | "codex" | "opencode";
  readonly status: "available" | "missing";
  readonly canonicalExecutable?: string;
  readonly pathExecutables: readonly string[];
  readonly competingExecutables: readonly string[];
  readonly version?: string;
  readonly warnings: readonly string[];
  readonly repairActions: readonly string[];
}

export interface HarnessDoctorHarnessReport extends HarnessDoctorExecutableReport {
  readonly harnessId: "codex" | "opencode";
  readonly discoveryStatus: string;
  readonly discoveryReason: string;
  readonly authState: string;
  readonly models: readonly string[];
}

export interface HarnessDoctorReport {
  readonly mode: "read-only";
  readonly generatedAt: string;
  readonly projectRoot?: string;
  readonly kilnCli: HarnessDoctorExecutableReport;
  readonly configProjections: readonly HarnessDoctorProjectionReport[];
  readonly harnesses: {
    readonly codex: HarnessDoctorHarnessReport;
    readonly opencode: HarnessDoctorHarnessReport;
  };
}

export interface HarnessDoctorProjectionReport {
  readonly targetId: string;
  readonly kind: string;
  readonly status: string;
  readonly path: string;
}

export interface HarnessDoctorOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly projectRoot?: string;
  readonly now?: () => Date;
  readonly fileExists?: (path: string) => boolean;
  readonly runVersion?: (path: string) => Promise<string | undefined>;
  readonly discoverModels?: () => Promise<HarnessDoctorModelDiscovery>;
  readonly readConfigProjections?: (projectRoot: string | undefined) => Promise<readonly HarnessDoctorProjectionReport[]>;
}

interface HarnessDefinition {
  readonly harnessId: "kiln" | "codex" | "opencode";
  readonly commandNames: readonly string[];
  readonly preferredCandidates: (env: Readonly<Record<string, string | undefined>>) => readonly string[];
  readonly fallbackCandidates?: (env: Readonly<Record<string, string | undefined>>) => readonly string[];
  readonly releaseWarning?: string;
}

const HARNESS_DEFINITIONS: readonly HarnessDefinition[] = [
  {
    harnessId: "kiln",
    commandNames: ["kiln.exe", "kiln.cmd", "kiln"],
    preferredCandidates: () => [],
    releaseWarning: "Global kiln may not include local source changes until a release installs a new build.",
  },
  {
    harnessId: "codex",
    commandNames: ["codex.cmd", "codex.exe", "codex"],
    preferredCandidates: (env) => {
      const home = resolveHome(env);
      return home
        ? [
            join(home, "AppData", "Roaming", "npm", "codex.cmd"),
          ]
        : [];
    },
    fallbackCandidates: (env) => {
      const home = resolveHome(env);
      return home ? [join(home, ".codex", ".sandbox-bin", "codex.exe")] : [];
    },
  },
  {
    harnessId: "opencode",
    commandNames: ["opencode.exe", "opencode.cmd", "opencode"],
    preferredCandidates: () => [],
    fallbackCandidates: (env) => {
      const home = resolveHome(env);
      return home
        ? [
            join(home, ".bun", "bin", "opencode.exe"),
            join(home, "AppData", "Roaming", "npm", "opencode.cmd"),
          ]
        : [];
    },
  },
];

export async function buildHarnessDoctorReport(options: HarnessDoctorOptions = {}): Promise<HarnessDoctorReport> {
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? existsSync;
  const runVersion = options.runVersion ?? defaultRunVersion;
  const modelDiscovery = await (options.discoverModels ?? (() => discoverGuiCliOperatorModels({
    codex: true,
    opencode: true,
  })))();
  const configProjections = await (options.readConfigProjections ?? readHarnessConfigProjections)(options.projectRoot);
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();

  const kilnCli = await resolveExecutableReport(
    definitionFor("kiln"),
    env,
    fileExists,
    runVersion,
    options.projectRoot,
  );
  const codex = await resolveHarnessReport(
    definitionFor("codex"),
    modelDiscovery.codexDiscovery,
    env,
    fileExists,
    runVersion,
  );
  const opencode = await resolveHarnessReport(
    definitionFor("opencode"),
    modelDiscovery.opencodeDiscovery,
    env,
    fileExists,
    runVersion,
  );

  return {
    mode: "read-only",
    generatedAt,
    projectRoot: options.projectRoot,
    kilnCli,
    configProjections,
    harnesses: {
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
  appendExecutable(lines, "Kiln CLI", report.kilnCli);
  appendConfigProjections(lines, report.configProjections);
  appendHarness(lines, "Codex", report.harnesses.codex);
  appendHarness(lines, "OpenCode", report.harnesses.opencode);
  return `${lines.join("\n")}\n`;
}

async function resolveHarnessReport(
  definition: HarnessDefinition,
  discovery: HarnessDoctorProviderDiscovery,
  env: Readonly<Record<string, string | undefined>>,
  fileExists: (path: string) => boolean,
  runVersion: (path: string) => Promise<string | undefined>,
): Promise<HarnessDoctorHarnessReport> {
  const executable = await resolveExecutableReport(definition, env, fileExists, runVersion);
  return {
    ...executable,
    harnessId: definition.harnessId as "codex" | "opencode",
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
  projectRoot?: string,
): Promise<HarnessDoctorExecutableReport> {
  const pathExecutables = findPathExecutables(definition.commandNames, env, fileExists);
  const candidates = dedupePaths([
    ...definition.preferredCandidates(env),
    ...pathExecutables,
    ...(definition.fallbackCandidates?.(env) ?? []),
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
  const warnings = buildWarnings(definition, canonicalExecutable, competingExecutables, projectRoot);

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
): void {
  lines.push(`  ${title}:`);
  lines.push(`    ID: ${executable.harnessId}`);
  lines.push(`    Status: ${executable.status}`);
  lines.push(`    Executable: ${executable.canonicalExecutable ?? "-"}`);
  lines.push(`    Version: ${executable.version ?? "-"}`);
  lines.push(`    PATH entries: ${executable.pathExecutables.length > 0 ? executable.pathExecutables.join(", ") : "-"}`);
  if (executable.competingExecutables.length > 0) {
    lines.push(`    Competing entries: ${executable.competingExecutables.join(", ")}`);
  }
  for (const warning of executable.warnings) {
    lines.push(`    Warning: ${warning}`);
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
  canonicalExecutable: string | undefined,
  competingExecutables: readonly string[],
  projectRoot?: string,
): string[] {
  const warnings = competingExecutables.map((path) =>
    `Competing ${definition.harnessId} executable on PATH: ${path}`
  );
  if (
    definition.releaseWarning
    && canonicalExecutable
    && projectRoot
    && !normalizePath(canonicalExecutable).startsWith(normalizePath(projectRoot))
  ) {
    warnings.push(definition.releaseWarning);
  }
  return warnings;
}

function findPathExecutables(
  commandNames: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  fileExists: (path: string) => boolean,
): string[] {
  const pathValue = env.PATH ?? env.Path ?? "";
  const entries = pathValue.split(delimiter).filter((entry) => entry.trim().length > 0);
  return dedupePaths(entries.flatMap((entry) =>
    commandNames.map((commandName) => join(entry, commandName)).filter(fileExists)
  ));
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

async function readHarnessConfigProjections(projectRoot: string | undefined): Promise<readonly HarnessDoctorProjectionReport[]> {
  const snapshot = await readConfigStatusSnapshot({ projectPath: projectRoot });
  return snapshot.projections.map(projectProjection);
}

function projectProjection(projection: KilnProjectionTargetSnapshot): HarnessDoctorProjectionReport {
  return {
    targetId: projection.targetId,
    kind: projection.kind,
    status: projection.status,
    path: projection.path,
  };
}
