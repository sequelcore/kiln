import { describe, expect, it } from "vitest";
import {
  generateBenchmarkPublicReport,
  hashVerifiedEfficiencyBenchmarkBaselines,
  KILN_BENCHMARK_PROFILES,
  type BenchmarkEvidenceArtifactKind,
} from "../../src/index.js";

const REQUIRED_EVIDENCE_ARTIFACTS: readonly BenchmarkEvidenceArtifactKind[] = [
  "transcript",
  "tool-calls",
  "diagnostics",
  "usage",
  "route",
  "cost",
  "result",
];

function reliabilityEvidence(profile: typeof KILN_BENCHMARK_PROFILES[number]) {
  return {
    datasetItemCount: profile.minimumDatasetItems,
    passRate: 1,
    passRateInterval: { confidence: 0.95 as const, lower: 0.9, upper: 1 },
    passAtK: 1,
    passAtKInterval: { confidence: 0.95 as const, lower: 0.7, upper: 1 },
    validTrialCount: profile.minimumDatasetItems * profile.minimumK,
    invalidTrialCount: 0,
    invalidTrialRate: 0,
    incompleteItemIds: [],
  };
}

describe("generateBenchmarkPublicReport", () => {
  it("renders readiness, baselines, artifacts, and limitations", () => {
    const profile = KILN_BENCHMARK_PROFILES[0]!;
    const report = generateBenchmarkPublicReport({
      generatedAt: "2026-05-08T12:00:00.000Z",
      kilnVersion: "1.0.0",
      kilnCommit: "abc123",
      baselines: [{
        profileId: profile.id,
        profileVersion: profile.version,
        datasetName: "kiln-tool-agent-v1",
        datasetVersion: "1",
        k: profile.minimumK,
        ...reliabilityEvidence(profile),
        scorers: profile.requiredScorers,
        artifactUris: REQUIRED_EVIDENCE_ARTIFACTS.map((kind) => `kiln://artifacts/benchmark-baselines/${kind}/content`),
        evidenceArtifacts: REQUIRED_EVIDENCE_ARTIFACTS.map((kind) => ({
          kind,
          uri: `kiln://artifacts/benchmark-baselines/${kind}/content`,
        })),
        configHash: "sha256:test",
      }],
      limitations: ["Internal baseline only."],
    });

    expect(report.markdown).toContain("# Kiln Benchmark Report");
    expect(report.markdown).toContain("Kiln commit: abc123");
    expect(report.markdown).toContain("| kiln-tool-agent | kiln-tool-agent-v1@1 |");
    expect(report.markdown).toContain("- Internal baseline only.");
    expect(report.markdown).toContain("Publication status: blocked");
    expect(report.markdown).toContain("Public claim allowed: no");
    expect(report.publicationReadiness.issues).toContain("missing verified efficiency publication manifest");
  });

  it("blocks a public claim when the rendered baselines differ from the content-verified report", () => {
    const profile = KILN_BENCHMARK_PROFILES[0]!;
    const baselines = [{
      profileId: profile.id,
      profileVersion: profile.version,
      datasetName: "verified-dataset",
      datasetVersion: "1",
      k: profile.minimumK,
      ...reliabilityEvidence(profile),
      scorers: profile.requiredScorers,
      artifactUris: REQUIRED_EVIDENCE_ARTIFACTS.map((kind) => `kiln://artifacts/verified/${kind}`),
      evidenceArtifacts: REQUIRED_EVIDENCE_ARTIFACTS.map((kind) => ({
        kind,
        uri: `kiln://artifacts/verified/${kind}`,
      })),
      configHash: "sha256:verified-config",
    }];
    const publicationReadiness = {
      schemaVersion: "verified-efficiency-publication-readiness-v1" as const,
      status: "public-ready" as const,
      publicClaimAllowed: true,
      claim: { kind: "token-efficiency" as const, statement: "The candidate uses fewer tokens." },
      benchmarkBaselinesSha256: hashVerifiedEfficiencyBenchmarkBaselines(baselines),
      issues: [],
      manifestHash: "sha256:manifest",
      verifiedArtifacts: [],
    };

    const matching = generateBenchmarkPublicReport({
      generatedAt: "2026-07-14T12:00:00.000Z",
      baselines,
      publicationReadiness,
    });
    expect(matching.publicationReadiness.publicClaimAllowed).toBe(true);
    expect(matching.markdown).toContain("Publication claim: [token-efficiency] The candidate uses fewer tokens.");

    const unrelated = generateBenchmarkPublicReport({
      generatedAt: "2026-07-14T12:00:00.000Z",
      baselines: [{ ...baselines[0]!, configHash: "sha256:unrelated-config" }],
      publicationReadiness,
    });
    expect(unrelated.publicationReadiness).toMatchObject({
      status: "blocked",
      publicClaimAllowed: false,
      issues: ["benchmark baselines do not match the content-verified publication report"],
    });
  });
});
