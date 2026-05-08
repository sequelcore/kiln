import { readFileSync } from "node:fs";
import {
  KILN_BENCHMARK_PROFILES,
  KILN_EXTERNAL_BENCHMARK_TRACKS,
  evaluateBenchmarkReadiness,
  type BenchmarkBaselineResult,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";

export async function benchmarkCommand(
  _config: KilnAppConfig,
  subcommand: string | undefined,
  args: readonly string[],
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
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown benchmark command '${subcommand}'. Use profiles, tracks, or readiness.`);
  }
}

function printHelp(): void {
  console.log([
    "Usage:",
    "  kiln benchmark profiles",
    "  kiln benchmark tracks",
    "  kiln benchmark readiness --baseline <path>",
    "",
    "The readiness command expects a JSON file containing either an array of",
    "BenchmarkBaselineResult entries or an object with a baselines array.",
  ].join("\n"));
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

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
