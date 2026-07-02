import { describe, expect, it } from "vitest";
import {
  generateBenchmarkPublicReport,
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
        passAtK: 1,
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
  });
});
