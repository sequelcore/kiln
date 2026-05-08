import { evaluateBenchmarkReadiness, type BenchmarkBaselineResult, type BenchmarkReadinessReport } from "./benchmark-baseline.js";

export interface BenchmarkPublicReportInput {
  readonly title?: string;
  readonly kilnVersion?: string;
  readonly kilnCommit?: string;
  readonly baselines: readonly BenchmarkBaselineResult[];
  readonly generatedAt: string;
  readonly limitations?: readonly string[];
}

export interface BenchmarkPublicReport {
  readonly title: string;
  readonly generatedAt: string;
  readonly readiness: BenchmarkReadinessReport;
  readonly baselines: readonly BenchmarkBaselineResult[];
  readonly limitations: readonly string[];
  readonly markdown: string;
}

export function generateBenchmarkPublicReport(input: BenchmarkPublicReportInput): BenchmarkPublicReport {
  const readiness = evaluateBenchmarkReadiness({ baselines: input.baselines });
  const title = input.title ?? "Kiln Benchmark Report";
  const limitations = input.limitations ?? [];
  const markdown = renderMarkdown({
    title,
    generatedAt: input.generatedAt,
    kilnVersion: input.kilnVersion,
    kilnCommit: input.kilnCommit,
    readiness,
    baselines: input.baselines,
    limitations,
  });

  return {
    title,
    generatedAt: input.generatedAt,
    readiness,
    baselines: input.baselines,
    limitations,
    markdown,
  };
}

function renderMarkdown(input: {
  readonly title: string;
  readonly generatedAt: string;
  readonly kilnVersion?: string;
  readonly kilnCommit?: string;
  readonly readiness: BenchmarkReadinessReport;
  readonly baselines: readonly BenchmarkBaselineResult[];
  readonly limitations: readonly string[];
}): string {
  return [
    `# ${input.title}`,
    "",
    `Generated: ${input.generatedAt}`,
    ...(input.kilnVersion ? [`Kiln version: ${input.kilnVersion}`] : []),
    ...(input.kilnCommit ? [`Kiln commit: ${input.kilnCommit}`] : []),
    "",
    "## Readiness",
    "",
    `Status: ${input.readiness.status}`,
    "",
    "| Profile | Dataset | k | pass^k | Scorers | Artifacts |",
    "| --- | --- | ---: | ---: | --- | --- |",
    ...input.baselines.map((baseline) => [
      baseline.profileId,
      `${baseline.datasetName}@${baseline.datasetVersion}`,
      String(baseline.k),
      baseline.passAtK.toFixed(3),
      baseline.scorers.join(", "),
      baseline.artifactUris.join(", "),
    ].map(escapeTableCell).join(" | ")).map((row) => `| ${row} |`),
    "",
    "## Issues",
    "",
    ...(input.readiness.issues.length > 0 ? input.readiness.issues.map((issue) => `- ${issue}`) : ["- none"]),
    "",
    "## External Tracks",
    "",
    `Ready: ${input.readiness.externalReadyTracks.length > 0 ? input.readiness.externalReadyTracks.join(", ") : "none"}`,
    `Blocked: ${input.readiness.blockedTracks.length > 0 ? input.readiness.blockedTracks.join(", ") : "none"}`,
    "",
    "## Limitations",
    "",
    ...(input.limitations.length > 0 ? input.limitations.map((limitation) => `- ${limitation}`) : ["- none declared"]),
    "",
  ].join("\n");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\n/gu, " ");
}
