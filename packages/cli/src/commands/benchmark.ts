import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BenchmarkBaselineRunner,
  KILN_BENCHMARK_PROFILES,
  KILN_EXTERNAL_BENCHMARK_TRACKS,
  FileArtifactResourceStore,
  createBenchmarkProfileScorers,
  evaluateBenchmarkReadiness,
  evaluateVerifiedEfficiencyPublicationReadiness,
  generateBenchmarkPublicReport,
  parseDatasetJsonl,
  projectAgentDojoDataset,
  projectBfclDataset,
  projectTauDataset,
  type BenchmarkBaselineResult,
  type BenchmarkEvidenceArtifact,
  type BenchmarkEvidenceArtifactKind,
  type BenchmarkItemExecutor,
  type ReasoningEffort,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import {
  BENCHMARK_EXECUTION_ENVELOPE,
  BENCHMARK_POLICY,
  createBenchmarkSessionExecutor,
  type BenchmarkSessionExecutorFlags,
} from "../application/benchmark-session-executor.js";

export interface BenchmarkCommandDependencies {
  readonly executeItem?: BenchmarkItemExecutor;
  readonly createExecuteItem?: (flags: BenchmarkSessionExecutorFlags) => BenchmarkItemExecutor;
  readonly now?: () => Date;
}

export async function benchmarkCommand(
  config: KilnAppConfig,
  subcommand: string | undefined,
  args: readonly string[],
  dependencies: BenchmarkCommandDependencies = {},
): Promise<void> {
  switch (subcommand) {
    case "profiles":
      printJson(KILN_BENCHMARK_PROFILES);
      return;
    case "tracks":
      printJson(KILN_EXTERNAL_BENCHMARK_TRACKS);
      return;
    case "readiness":
      printJson(evaluateBenchmarkReadiness({
        baselines: readBaselines(args),
      }));
      return;
    case "report":
      writeBenchmarkReport(args);
      return;
    case "run-internal":
      await runInternalBenchmark(config, args, dependencies);
      return;
    case "project-bfcl":
      projectBfclCommand(args);
      return;
    case "project-agentdojo":
      projectAgentDojoCommand(args);
      return;
    case "project-tau":
      projectTauCommand(args);
      return;
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown benchmark command '${subcommand}'. Use profiles, tracks, readiness, report, run-internal, project-bfcl, project-agentdojo, or project-tau.`);
  }
}

function printHelp(): void {
  console.log([
    "Usage:",
    "  kiln benchmark profiles",
    "  kiln benchmark tracks",
    "  kiln benchmark readiness --baseline <path>",
    "  kiln benchmark report --baseline <path> --output <path> [--publication-manifest <path>] [--repository-root <path>]",
    "  kiln benchmark run-internal --profile <id> [--dataset <path>] [--k <n>] [--output <path>] [--reasoning-effort <level> | --reasoning-effort-sweep <levels>]",
    "  kiln benchmark project-bfcl --input <path> --output <path>",
    "  kiln benchmark project-agentdojo --input <path> --output <path>",
    "  kiln benchmark project-tau --input <path> --output <path>",
    "",
    "The readiness command expects a JSON file containing either an array of",
    "BenchmarkBaselineResult entries or an object with a baselines array.",
  ].join("\n"));
}

function writeBenchmarkReport(args: readonly string[]): void {
  const outputPath = readFlag(args, "--output");
  if (!outputPath) {
    throw new Error("benchmark report requires --output <path>.");
  }
  const publicationManifestPath = readFlag(args, "--publication-manifest");
  const repositoryRoot = resolve(readFlag(args, "--repository-root") ?? process.cwd());
  let publicationManifest: unknown;
  let publicationParseIssue: string | undefined;
  if (publicationManifestPath) {
    try {
      publicationManifest = JSON.parse(readFileSync(publicationManifestPath, "utf-8"));
    } catch {
      publicationParseIssue = "publication manifest must contain valid JSON";
    }
  }
  const evaluatedPublicationReadiness = publicationManifestPath
    ? evaluateVerifiedEfficiencyPublicationReadiness(
        publicationManifest,
        (path) => readRepositoryArtifact(repositoryRoot, path),
        (path, commit) => readRepositoryArtifactAtCommit(repositoryRoot, path, commit),
      )
    : undefined;
  const publicationReadiness = evaluatedPublicationReadiness && publicationParseIssue
    ? {
        ...evaluatedPublicationReadiness,
        issues: [publicationParseIssue, ...evaluatedPublicationReadiness.issues],
      }
    : evaluatedPublicationReadiness;
  const report = generateBenchmarkPublicReport({
    generatedAt: new Date().toISOString(),
    ...(publicationReadiness?.identity
      ? {
          kilnVersion: publicationReadiness.identity.kilnVersion,
          kilnCommit: publicationReadiness.identity.kilnCommit,
        }
      : {}),
    baselines: readBaselines(args),
    limitations: [
      "Generated from supplied Kiln baseline artifacts.",
      "External leaderboard submission requires benchmark-specific adapter validation.",
    ],
    publicationReadiness,
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report.markdown, "utf-8");
  printJson({
    outputPath,
    baselineStatus: report.readiness.status,
    publicationStatus: report.publicationReadiness.status,
    publicClaimAllowed: report.publicationReadiness.publicClaimAllowed,
    issues: [...report.readiness.issues, ...report.publicationReadiness.issues],
  });
}

function readRepositoryArtifact(repositoryRoot: string, path: string): string | undefined {
  try {
    const realRoot = realpathSync(repositoryRoot);
    const realArtifact = realpathSync(resolve(realRoot, path));
    const relativePath = relative(realRoot, realArtifact);
    if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) return undefined;
    return readFileSync(realArtifact, "utf-8");
  } catch {
    return undefined;
  }
}

function readRepositoryArtifactAtCommit(
  repositoryRoot: string,
  path: string,
  commit: string,
): string | undefined {
  try {
    const realRoot = realpathSync(repositoryRoot);
    const repositoryPath = path.replace(/\\/gu, "/");
    return execFileSync("git", ["-C", realRoot, "show", `${commit}:${repositoryPath}`], {
      encoding: "utf-8",
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return undefined;
  }
}

function projectBfclCommand(args: readonly string[]): void {
  const inputPath = readFlag(args, "--input");
  const outputPath = readFlag(args, "--output");
  if (!inputPath || !outputPath) {
    throw new Error("benchmark project-bfcl requires --input <path> and --output <path>.");
  }
  const projected = projectBfclDataset({
    datasetName: datasetNameFromPath(inputPath),
    content: readFileSync(inputPath, "utf-8"),
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    projected.dataset.items.map((item) => JSON.stringify(item)).join("\n") + "\n",
    "utf-8",
  );
  printJson({
    outputPath,
    itemCount: projected.dataset.items.length,
    unsupportedRows: projected.unsupportedRows,
  });
}

function projectAgentDojoCommand(args: readonly string[]): void {
  const inputPath = readFlag(args, "--input");
  const outputPath = readFlag(args, "--output");
  if (!inputPath || !outputPath) {
    throw new Error("benchmark project-agentdojo requires --input <path> and --output <path>.");
  }
  const projected = projectAgentDojoDataset({
    datasetName: datasetNameFromPath(inputPath),
    content: readFileSync(inputPath, "utf-8"),
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    projected.dataset.items.map((item) => JSON.stringify(item)).join("\n") + "\n",
    "utf-8",
  );
  printJson({
    outputPath,
    itemCount: projected.dataset.items.length,
    unsupportedRows: projected.unsupportedRows,
  });
}

function projectTauCommand(args: readonly string[]): void {
  const inputPath = readFlag(args, "--input");
  const outputPath = readFlag(args, "--output");
  if (!inputPath || !outputPath) {
    throw new Error("benchmark project-tau requires --input <path> and --output <path>.");
  }
  const projected = projectTauDataset({
    datasetName: datasetNameFromPath(inputPath),
    content: readFileSync(inputPath, "utf-8"),
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    projected.dataset.items.map((item) => JSON.stringify(item)).join("\n") + "\n",
    "utf-8",
  );
  printJson({
    outputPath,
    itemCount: projected.dataset.items.length,
    unsupportedRows: projected.unsupportedRows,
  });
}

async function runInternalBenchmark(
  config: KilnAppConfig,
  args: readonly string[],
  dependencies: BenchmarkCommandDependencies,
): Promise<void> {
  const profileId = readFlag(args, "--profile");
  if (!profileId) {
    throw new Error("benchmark run-internal requires --profile <id>.");
  }
  const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === profileId);
  if (!profile) {
    throw new Error(`Unknown benchmark profile '${profileId}'.`);
  }
  const datasetPath = readFlag(args, "--dataset") ?? defaultDatasetPath(profile.id);
  const datasetContent = readFileSync(datasetPath, "utf-8");
  const dataset = parseDatasetJsonl(datasetNameFromPath(datasetPath), datasetContent);
  const k = parsePositiveInteger(readFlag(args, "--k") ?? String(profile.minimumK), "--k");
  const outputPath = readFlag(args, "--output") ?? defaultOutputPath(profile.id, dependencies.now?.() ?? new Date());
  const artifactRoot = resolve(`${outputPath}.artifacts`);
  const effortMembers = readReasoningEffortMembers(args);
  const artifactStore = new FileArtifactResourceStore({ rootDir: artifactRoot });
  const runs = [];
  for (const effort of effortMembers) {
    const executorFlags = readExecutorFlags(args, effort);
    const executor = dependencies.createExecuteItem?.(executorFlags)
      ?? dependencies.executeItem
      ?? createBenchmarkSessionExecutor({ appConfig: config, flags: executorFlags });
    const runner = new BenchmarkBaselineRunner({
      profile,
      dataset,
      datasetVersion: datasetVersionFromPath(datasetPath),
      k,
      configHash: computeConfigHash({
        profile,
        datasetName: dataset.name,
        datasetVersion: datasetVersionFromPath(datasetPath),
        datasetContentHash: hashContent(datasetContent),
        k,
        authorityProfile: profile.authorityProfile,
        permissionPolicy: BENCHMARK_POLICY,
        executionEnvelope: BENCHMARK_EXECUTION_ENVELOPE,
        provider: readFlag(args, "--provider"),
        model: readFlag(args, "--model"),
        reasoningEffort: effort ?? "provider-default",
        reasoningEffortMode: effortMembers.length > 1 ? "sweep" : effort ? "fixed" : "provider-default",
        allowExperimentalXhigh: executorFlags.allowExperimentalXhigh ?? false,
        effortBudgetUsd: executorFlags.effortBudgetUsd,
        estimatedEffortCostUsd: executorFlags.estimatedEffortCostUsd,
        scorerNames: profile.requiredScorers,
      }),
      scorers: createBenchmarkProfileScorers(profile),
      artifactStore,
      executeItem: requireEffortEvidence(executor, effort),
    });
    const result = await runner.run();
    runs.push({ reasoningEffort: effort ?? null, ...result });
  }
  const baselines = runs.map((run) => run.baseline);
  const singleRun = runs.length === 1 ? runs[0] : undefined;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    artifactRoot,
    baselines,
    runs,
    ...(singleRun ? {
      baseline: singleRun.baseline,
      consistency: singleRun.consistency,
      artifactUris: singleRun.artifactUris,
    } : {}),
  }, null, 2), "utf-8");
  printJson({
    outputPath,
    artifactRoot,
    ...(singleRun ? { baseline: singleRun.baseline } : { baselines }),
    readiness: evaluateBenchmarkReadiness({ baselines }),
  });
}

function requireEffortEvidence(
  executor: BenchmarkItemExecutor,
  effort: ReasoningEffort | undefined,
): BenchmarkItemExecutor {
  if (!effort) return executor;
  return async (input, context) => {
    const result = await executor(input, context);
    const resolution = result.metadata?.reasoningEffortResolution;
    if (!resolution || typeof resolution !== "object"
      || (resolution as { readonly status?: unknown }).status !== "resolved"
      || (resolution as { readonly resolved?: unknown }).resolved !== effort) {
      throw new Error(`Benchmark executor did not prove resolution of reasoning effort '${effort}'.`);
    }
    return result;
  };
}

function readBaselines(args: readonly string[]): readonly BenchmarkBaselineResult[] {
  const baselinePath = readFlag(args, "--baseline");
  if (!baselinePath) {
    throw new Error("benchmark readiness requires --baseline <path>.");
  }
  const parsed = JSON.parse(readFileSync(baselinePath, "utf-8")) as unknown;
  const baselines = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { readonly baselines?: unknown }).baselines)
      ? (parsed as { readonly baselines: readonly unknown[] }).baselines
      : undefined;
  if (!baselines) {
    throw new Error("benchmark baseline file must be an array or an object with a baselines array.");
  }
  return baselines.map(parseBaseline);
}

function parseBaseline(value: unknown): BenchmarkBaselineResult {
  if (!value || typeof value !== "object") {
    throw new Error("benchmark baseline entries must be objects.");
  }
  const record = value as Record<string, unknown>;
  return {
    profileId: requireString(record.profileId, "profileId"),
    profileVersion: requireString(record.profileVersion, "profileVersion"),
    datasetName: requireString(record.datasetName, "datasetName"),
    k: requireNumber(record.k, "k"),
    passAtK: requireNumber(record.passAtK, "passAtK"),
    scorers: requireStringArray(record.scorers, "scorers"),
    artifactUris: requireStringArray(record.artifactUris, "artifactUris"),
    evidenceArtifacts: requireEvidenceArtifacts(record.evidenceArtifacts),
    configHash: requireString(record.configHash, "configHash"),
    datasetVersion: requireString(record.datasetVersion, "datasetVersion"),
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`benchmark baseline field '${field}' must be a non-empty string.`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`benchmark baseline field '${field}' must be a finite number.`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
    throw new Error(`benchmark baseline field '${field}' must be an array of non-empty strings.`);
  }
  return value;
}

function requireEvidenceArtifacts(value: unknown): readonly BenchmarkEvidenceArtifact[] {
  if (!Array.isArray(value)) {
    throw new Error("benchmark baseline field 'evidenceArtifacts' must be an array of evidence artifact records.");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`benchmark baseline evidenceArtifacts[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    return {
      kind: requireEvidenceArtifactKind(record.kind, index),
      uri: requireString(record.uri, `evidenceArtifacts[${index}].uri`),
    };
  });
}

function requireEvidenceArtifactKind(value: unknown, index: number): BenchmarkEvidenceArtifactKind {
  const allowed: readonly BenchmarkEvidenceArtifactKind[] = [
    "result",
    "transcript",
    "tool-calls",
    "diagnostics",
    "usage",
    "route",
    "cost",
    "cache-topology",
  ];
  if (typeof value === "string" && allowed.includes(value as BenchmarkEvidenceArtifactKind)) {
    return value as BenchmarkEvidenceArtifactKind;
  }
  throw new Error(`benchmark baseline evidenceArtifacts[${index}].kind must be a supported evidence artifact kind.`);
}

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function readExecutorFlags(
  args: readonly string[],
  reasoningEffort?: ReasoningEffort,
): BenchmarkSessionExecutorFlags {
  return {
    provider: readFlag(args, "--provider"),
    model: readFlag(args, "--model"),
    apiKey: readFlag(args, "--api-key"),
    skipGitRepoCheck: args.includes("--skip-git-repo-check"),
    reasoningEffort,
    allowExperimentalXhigh: args.includes("--allow-experimental-xhigh"),
    effortBudgetUsd: parseOptionalNonNegativeNumber(readFlag(args, "--effort-budget-usd"), "--effort-budget-usd"),
    estimatedEffortCostUsd: parseOptionalNonNegativeNumber(
      readFlag(args, "--estimated-effort-cost-usd"),
      "--estimated-effort-cost-usd",
    ),
  };
}

const REASONING_EFFORTS: readonly ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];

function readReasoningEffortMembers(args: readonly string[]): readonly (ReasoningEffort | undefined)[] {
  const fixed = readFlag(args, "--reasoning-effort");
  const sweep = readFlag(args, "--reasoning-effort-sweep");
  if (fixed && sweep) {
    throw new Error("benchmark run-internal accepts either --reasoning-effort or --reasoning-effort-sweep, not both.");
  }
  const requested: readonly (ReasoningEffort | undefined)[] = fixed ? [parseReasoningEffort(fixed)] : sweep
    ? sweep.split(",").map((entry) => parseReasoningEffort(entry.trim()))
    : [undefined];
  if (sweep && requested.length < 2) {
    throw new Error("--reasoning-effort-sweep requires at least two comma-separated effort levels.");
  }
  if (new Set(requested).size !== requested.length) {
    throw new Error("--reasoning-effort-sweep must not contain duplicate effort levels.");
  }
  if (requested[0] !== undefined && (!readFlag(args, "--provider") || !readFlag(args, "--model"))) {
    throw new Error("reasoning-effort benchmarks require explicit --provider and --model route identity.");
  }
  if (requested.includes("xhigh")) {
    if (!args.includes("--allow-experimental-xhigh")) {
      throw new Error("xhigh benchmark execution requires --allow-experimental-xhigh.");
    }
    if (readFlag(args, "--effort-budget-usd") === undefined
      || readFlag(args, "--estimated-effort-cost-usd") === undefined) {
      throw new Error("xhigh benchmark execution requires --effort-budget-usd and --estimated-effort-cost-usd.");
    }
  }
  return requested;
}

function parseReasoningEffort(value: string): ReasoningEffort {
  if (!REASONING_EFFORTS.includes(value as ReasoningEffort)) {
    throw new Error(`Unsupported reasoning effort '${value}'.`);
  }
  return value as ReasoningEffort;
}

function parseOptionalNonNegativeNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative finite number.`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function defaultDatasetPath(profileId: string): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "..", "..", "..", "core", "evals", "benchmark", `${profileId}-v1.jsonl`);
}

function datasetNameFromPath(path: string): string {
  return path.replace(/\\/gu, "/").split("/").pop()?.replace(/\.jsonl$/u, "") ?? "benchmark-dataset";
}

function datasetVersionFromPath(path: string): string {
  const name = datasetNameFromPath(path);
  return name.match(/-v(\d+)$/u)?.[1] ?? "1";
}

function defaultOutputPath(profileId: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  return join(process.cwd(), ".kiln", "benchmarks", `${profileId}-${stamp}.json`);
}

function computeConfigHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function hashContent(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
