import { describe, expect, it } from "vitest";
import {
  KILN_BENCHMARK_PROFILES,
  KILN_EXTERNAL_BENCHMARK_TRACKS,
  evaluateBenchmarkReadiness,
  type BenchmarkBaselineResult,
  type BenchmarkEvidenceArtifactKind,
  type BenchmarkTrack,
} from "../../src/eval/index.js";

const REQUIRED_EVIDENCE_ARTIFACTS: readonly BenchmarkEvidenceArtifactKind[] = [
  "transcript",
  "tool-calls",
  "diagnostics",
  "usage",
  "route",
  "cost",
  "cache-topology",
  "diff",
  "verification",
  "result",
];

function baselineFor(profileId: string, overrides: Partial<BenchmarkBaselineResult> = {}): BenchmarkBaselineResult {
  const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === profileId);
  if (!profile) {
    throw new Error(`Unknown test profile ${profileId}`);
  }
  return {
    profileId: profile.id,
    profileVersion: profile.version,
    datasetName: `${profile.id}-internal`,
    datasetItemCount: profile.minimumDatasetItems,
    k: profile.minimumK,
    passRate: profile.minimumPassRate,
    passRateInterval: { confidence: 0.95, lower: 0.7, upper: 0.9 },
    passAtK: profile.minimumPassAtK,
    passAtKInterval: { confidence: 0.95, lower: 0.6, upper: 0.9 },
    validTrialCount: profile.minimumDatasetItems * profile.minimumK,
    invalidTrialCount: 0,
    invalidTrialRate: 0,
    incompleteItemIds: [],
    scorers: profile.requiredScorers,
    artifactUris: REQUIRED_EVIDENCE_ARTIFACTS.map((kind) => `kiln://artifacts/eval/${profile.id}/${kind}`),
    evidenceArtifacts: REQUIRED_EVIDENCE_ARTIFACTS.map((kind) => ({
      kind,
      uri: `kiln://artifacts/eval/${profile.id}/${kind}`,
    })),
    configHash: "sha256:test",
    datasetVersion: "2026-05-08",
    ...overrides,
  };
}

describe("benchmark baseline readiness", () => {
  it("declares frozen first-party benchmark-facing profiles", () => {
    expect(KILN_BENCHMARK_PROFILES.map((profile) => profile.id)).toEqual([
      "kiln-tool-agent",
      "kiln-managed-child-agent",
      "kiln-managed-frontend-team",
      "kiln-managed-coding-agent",
      "kiln-safety-agent",
      "kiln-model-roster",
      "kiln-model-roster-backend-write",
      "kiln-model-roster-frontend-render",
    ]);
    expect(KILN_BENCHMARK_PROFILES[0]).toMatchObject({
      version: "3",
      authorityProfile: "foundation-readonly-plan",
      requiredScorers: expect.arrayContaining(["tool-calling-accuracy", "tool-trajectory"]),
    });
    expect(KILN_BENCHMARK_PROFILES[0]?.requiredScorers).not.toContain("cache-topology");
    expect(KILN_BENCHMARK_PROFILES.find((profile) => profile.id === "kiln-model-roster")).toMatchObject({
      version: "2",
      authorityProfile: "foundation-readonly-plan",
      requiredScorers: expect.arrayContaining([
        "evidence-coverage",
        "citation-grounding",
        "execution-integrity",
      ]),
    });
    expect(KILN_BENCHMARK_PROFILES.find((profile) => profile.id === "kiln-model-roster-backend-write")).toMatchObject({
      version: "2",
      authorityProfile: "foundation-apply-approved-writes",
      minimumDatasetItems: 8,
      admissionScorers: ["test-verification", "diff-integrity", "execution-integrity"],
      requiredScorers: expect.arrayContaining(["test-verification", "diff-integrity", "execution-integrity"]),
    });
    expect(KILN_BENCHMARK_PROFILES.find((profile) => profile.id === "kiln-model-roster-frontend-render")).toMatchObject({
      version: "2",
      authorityProfile: "foundation-apply-approved-writes",
      minimumDatasetItems: 8,
      admissionScorers: ["render-verification", "frontend-diff-integrity", "execution-integrity"],
      requiredScorers: expect.arrayContaining(["render-verification", "frontend-diff-integrity"]),
    });
  });

  it("blocks undersized, incomplete, or infrastructure-dominated baselines", () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-model-roster-backend-write")!;
    const report = evaluateBenchmarkReadiness({
      profiles: [profile],
      baselines: [baselineFor(profile.id, {
        datasetItemCount: 1,
        validTrialCount: 4,
        invalidTrialCount: 2,
        invalidTrialRate: 2 / 6,
        incompleteItemIds: ["backend-order-reservation"],
      })],
    });

    expect(report.status).toBe("blocked");
    expect(report.profileReadiness[0]?.issues).toEqual(expect.arrayContaining([
      "dataset requires at least 8 items",
      "valid trial coverage requires 40 trials",
      "invalid trial rate 0.3333333333333333 exceeds 0.1",
      "incomplete valid trials for: backend-order-reservation",
    ]));
  });

  it("fails closed on internally inconsistent statistical evidence", () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-model-roster-backend-write")!;
    const report = evaluateBenchmarkReadiness({
      profiles: [profile],
      baselines: [baselineFor(profile.id, {
        datasetItemCount: 8.5,
        passRate: 1.1,
        passRateInterval: { confidence: 0.95, lower: 0.9, upper: 0.8 },
        validTrialCount: 40,
        invalidTrialCount: 10,
        invalidTrialRate: 0.1,
      })],
    });

    expect(report.status).toBe("blocked");
    expect(report.profileReadiness[0]?.issues).toEqual(expect.arrayContaining([
      "datasetItemCount must be a non-negative integer",
      "passRate must be between 0 and 1",
      "passRateInterval must be an ordered 95% interval between 0 and 1",
      "invalidTrialRate does not match valid and invalid trial counts",
    ]));
  });

  it("blocks profiles with no reproducible internal baseline", () => {
    const report = evaluateBenchmarkReadiness({ baselines: [] });

    expect(report.status).toBe("blocked");
    expect(report.profileReadiness).toHaveLength(KILN_BENCHMARK_PROFILES.length);
    expect(report.issues).toContain("kiln-tool-agent: missing baseline for profile version 3");
  });

  it("requires pass^k, scorer, artifact, config, and dataset evidence", () => {
    const report = evaluateBenchmarkReadiness({
      profiles: [KILN_BENCHMARK_PROFILES[0]!],
      baselines: [
        baselineFor("kiln-tool-agent", {
          k: 1,
          passAtK: 0.2,
          scorers: ["tool-calling-accuracy"],
          artifactUris: [],
          evidenceArtifacts: [],
          configHash: "",
          datasetVersion: "",
        }),
      ],
    });

    expect(report.status).toBe("blocked");
    expect(report.profileReadiness[0]?.issues).toEqual([
      "pass^k requires k >= 5",
      "passAtK 0.2 is below 0.9",
      "missing required scorer tool-trajectory",
      "missing required scorer latency",
      "missing required scorer cost",
      "missing required scorer execution-integrity",
      "missing result artifact URI",
      "missing required evidence artifact result",
      "missing required evidence artifact transcript",
      "missing required evidence artifact tool-calls",
      "missing required evidence artifact diagnostics",
      "missing required evidence artifact usage",
      "missing required evidence artifact route",
      "missing required evidence artifact cost",
      "missing required evidence artifact cache-topology",
      "missing config hash",
      "missing dataset version",
    ]);
  });

  it("reports external-ready when a candidate track has its required surface ready", () => {
    const report = evaluateBenchmarkReadiness({
      profiles: [KILN_BENCHMARK_PROFILES[0]!],
      baselines: [baselineFor("kiln-tool-agent")],
    });

    expect(report.status).toBe("external-ready");
    expect(report.profileReadiness[0]?.status).toBe("internal-baseline-ready");
    expect(report.externalReadyTracks).toEqual(["bfcl"]);
    expect(report.blockedTracks).toEqual(KILN_EXTERNAL_BENCHMARK_TRACKS
      .filter((track) => track.id !== "bfcl")
      .map((track) => track.id));
  });

  it("reports external-ready only for candidate tracks with ready required surfaces", () => {
    const tracks: readonly BenchmarkTrack[] = [{
      id: "bfcl",
      displayName: "BFCL",
      purpose: "Tool calls",
      status: "candidate",
      requiredProfileSurfaces: ["tool-calling"],
    }, {
      id: "agentdojo",
      displayName: "AgentDojo",
      purpose: "Safety",
      status: "candidate",
      requiredProfileSurfaces: ["safety"],
    }];

    const report = evaluateBenchmarkReadiness({
      profiles: [KILN_BENCHMARK_PROFILES[0]!],
      baselines: [baselineFor("kiln-tool-agent")],
      tracks,
    });

    expect(report.status).toBe("external-ready");
    expect(report.externalReadyTracks).toEqual(["bfcl"]);
    expect(report.blockedTracks).toEqual(["agentdojo"]);
  });
});
