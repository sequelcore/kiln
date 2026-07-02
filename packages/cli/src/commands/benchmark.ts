import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BenchmarkBaselineRunner,
  KILN_BENCHMARK_PROFILES,
  KILN_EXTERNAL_BENCHMARK_TRACKS,
  MemoryArtifactResourceStore,
  createBenchmarkProfileScorers,
  evaluateBenchmarkReadiness,
  generateBenchmarkPublicReport,
  parseDatasetJsonl,
  projectAgentDojoDataset,
  projectBfclDataset,
  projectTauDataset,
  type BenchmarkBaselineResult,
  type BenchmarkEvidenceArtifact,
  type BenchmarkEvidenceArtifactKind,
  type BenchmarkItemExecutor,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import { createBenchmarkSessionExecutor, type BenchmarkSessionExecutorFlags } from "../application/benchmark-session-executor.js";

export interface BenchmarkCommandDependencies {
  readonly executeItem?: BenchmarkItemExecutor;
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
    "  kiln benchmark report --baseline <path> --output <path>",
    "  kiln benchmark run-internal --profile <id> [--dataset <path>] [--k <n>] [--output <path>]",
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
  const report = generateBenchmarkPublicReport({
    generatedAt: new Date().toISOString(),
    baselines: readBaselines(args),
    limitations: [
      "Generated from supplied Kiln baseline artifacts.",
      "External leaderboard submission requires benchmark-specific adapter validation.",
    ],
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report.markdown, "utf-8");
  printJson({
    outputPath,
    status: report.readiness.status,
    issues: report.readiness.issues,
  });
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
  const executor = dependencies.executeItem ?? createBenchmarkSessionExecutor({
    appConfig: config,
    flags: readExecutorFlags(args),
  });
  const runner = new BenchmarkBaselineRunner({
    profile,
    dataset,
    datasetVersion: datasetVersionFromPath(datasetPath),
    k,
    configHash: computeConfigHash({
      profile,
      datasetName: dataset.name,
      datasetVersion: datasetVersionFromPath(datasetPath),
      provider: readFlag(args, "--provider"),
      model: readFlag(args, "--model"),
      scorerNames: profile.requiredScorers,
    }),
    scorers: createBenchmarkProfileScorers(profile),
    artifactStore: new MemoryArtifactResourceStore(),
    executeItem: executor,
  });
  const result = await runner.run();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    baselines: [result.baseline],
    baseline: result.baseline,
    consistency: result.consistency,
    artifactUris: result.artifactUris,
  }, null, 2), "utf-8");
  printJson({
    outputPath,
    baseline: result.baseline,
    readiness: evaluateBenchmarkReadiness({ baselines: [result.baseline] }),
  });
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

function readExecutorFlags(args: readonly string[]): BenchmarkSessionExecutorFlags {
  return {
    provider: readFlag(args, "--provider"),
    model: readFlag(args, "--model"),
    apiKey: readFlag(args, "--api-key"),
    skipGitRepoCheck: args.includes("--skip-git-repo-check"),
  };
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
