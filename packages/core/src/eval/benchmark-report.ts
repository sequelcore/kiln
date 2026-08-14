import { evaluateBenchmarkReadiness, type BenchmarkBaselineResult, type BenchmarkReadinessReport } from "./benchmark-baseline.js";
import {
  hashVerifiedEfficiencyBenchmarkBaselines,
  type VerifiedEfficiencyPublicationReadiness,
} from "../efficiency/publication-readiness.js";

export interface BenchmarkPublicReportInput {
  readonly title?: string;
  readonly kilnVersion?: string;
  readonly kilnCommit?: string;
  readonly baselines: readonly BenchmarkBaselineResult[];
  readonly generatedAt: string;
  readonly limitations?: readonly string[];
  readonly publicationReadiness?: VerifiedEfficiencyPublicationReadiness;
}

export interface BenchmarkPublicReport {
  readonly title: string;
  readonly generatedAt: string;
  readonly readiness: BenchmarkReadinessReport;
  readonly baselines: readonly BenchmarkBaselineResult[];
  readonly limitations: readonly string[];
  readonly publicationReadiness: VerifiedEfficiencyPublicationReadiness;
  readonly markdown: string;
}

export function generateBenchmarkPublicReport(input: BenchmarkPublicReportInput): BenchmarkPublicReport {
  const readiness = evaluateBenchmarkReadiness({ baselines: input.baselines });
  const title = input.title ?? "Kiln Benchmark Report";
  const limitations = input.limitations ?? [];
  const publicationReadiness = bindPublicationReadinessToBaselines(
    input.publicationReadiness ?? missingPublicationReadiness(),
    input.baselines,
  );
  const markdown = renderMarkdown({
    title,
    generatedAt: input.generatedAt,
    kilnVersion: input.kilnVersion,
    kilnCommit: input.kilnCommit,
    readiness,
    baselines: input.baselines,
    limitations,
    publicationReadiness,
  });

  return {
    title,
    generatedAt: input.generatedAt,
    readiness,
    baselines: input.baselines,
    limitations,
    publicationReadiness,
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
  readonly publicationReadiness: VerifiedEfficiencyPublicationReadiness;
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
    `Publication status: ${input.publicationReadiness.status}`,
    `Public claim allowed: ${input.publicationReadiness.publicClaimAllowed ? "yes" : "no"}`,
    `Publication claim: [${input.publicationReadiness.claim.kind}] ${input.publicationReadiness.claim.statement}`,
    "",
    "### Publication gate issues",
    "",
    ...(input.publicationReadiness.issues.length > 0
      ? input.publicationReadiness.issues.map((issue) => `- ${issue}`)
      : ["- none"]),
    "",
    "| Profile | Dataset | Items | Valid / invalid | pass¹ (95% CI) | k | pass^k (95% CI) | Scorers | Artifacts |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...input.baselines.map((baseline) => [
      baseline.profileId,
      `${baseline.datasetName}@${baseline.datasetVersion}`,
      String(baseline.datasetItemCount),
      `${baseline.validTrialCount} / ${baseline.invalidTrialCount}`,
      formatMetric(baseline.passRate, baseline.passRateInterval),
      String(baseline.k),
      formatMetric(baseline.passAtK, baseline.passAtKInterval),
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

function formatMetric(
  value: number,
  interval: { readonly lower: number; readonly upper: number },
): string {
  return `${value.toFixed(3)} [${interval.lower.toFixed(3)}, ${interval.upper.toFixed(3)}]`;
}

function missingPublicationReadiness(): VerifiedEfficiencyPublicationReadiness {
  return {
    schemaVersion: "verified-efficiency-publication-readiness-v1",
    status: "blocked",
    publicClaimAllowed: false,
    claim: { kind: "none", statement: "No verified efficiency publication manifest was supplied." },
    benchmarkBaselinesSha256: "sha256:unknown",
    issues: ["missing verified efficiency publication manifest"],
    manifestHash: "sha256:unknown",
    verifiedArtifacts: [],
  };
}

function bindPublicationReadinessToBaselines(
  readiness: VerifiedEfficiencyPublicationReadiness,
  baselines: readonly BenchmarkBaselineResult[],
): VerifiedEfficiencyPublicationReadiness {
  if (!readiness.publicClaimAllowed) return readiness;
  const actualHash = hashVerifiedEfficiencyBenchmarkBaselines(baselines);
  if (readiness.benchmarkBaselinesSha256 === actualHash) return readiness;
  return {
    ...readiness,
    status: "blocked",
    publicClaimAllowed: false,
    issues: [...readiness.issues, "benchmark baselines do not match the content-verified publication report"],
  };
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\n/gu, " ");
}
