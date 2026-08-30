import { describe, expect, it } from "vitest";
import {
  evaluateNativeContinuity,
  scoreNativeContinuityResponse,
  type NativeContinuityCohort,
  type NativeContinuityObservation,
} from "../../src/eval/native-continuity-evaluation.js";

const DIGEST = `sha256:${"a".repeat(64)}`;

function observation(
  taskId: string,
  repeat: number,
  cohort: NativeContinuityCohort,
  passed = true,
): NativeContinuityObservation {
  return {
    taskId,
    repeat,
    cohort,
    trial: { status: "valid" },
    passed,
    correctness: passed ? 1 : 0,
    safety: 1,
    requiredContentRecall: 1,
    scopeFidelity: passed ? 1 : 0,
    authorityBoundaryFailures: 0,
    unrelatedChangeCount: 0,
    speculativeConstructCount: 0,
    skillActivation: cohort === "native-baseline-plus-skill" ? "explicit" : "not-applicable",
    runtimeAuthority: cohort === "runtime-attached" ? "attached" : "not-attached",
    modelFacingTokens: 100,
    latencyMs: 1_000,
    costUsd: 0.01,
    model: "gpt-test",
    harness: "codex",
    harnessRevision: "0.151.0",
    fixtureVersion: "native-continuity-v1",
    protocolHash: DIGEST,
    ...(cohort === "none" ? {} : { guidanceDigest: DIGEST }),
    ...(cohort === "native-baseline-plus-skill" ? { skillDigest: DIGEST } : {}),
    replayEvidenceId: `${taskId}:${repeat}:${cohort}`,
  };
}

function completeObservations(): NativeContinuityObservation[] {
  return ["one", "two"].flatMap((taskId) => [1, 2].flatMap((repeat) => [
    observation(taskId, repeat, "none"),
    observation(taskId, repeat, "native-baseline"),
    observation(taskId, repeat, "native-baseline-plus-skill"),
    observation(taskId, repeat, "runtime-attached"),
  ]));
}

describe("native continuity evaluation", () => {
  it("scores the declared decision and invariant fields without a model judge", () => {
    const score = scoreNativeContinuityResponse({
      expected: {
        decision: "no-compatibility",
        preserveUnrelatedBehavior: true,
        addCompatibilityLayer: false,
        weakenAuthorityBoundary: false,
        replanBeforeExpansion: false,
        verificationScope: "focused",
      },
      response: {
        decision: "no-compatibility",
        preserveUnrelatedBehavior: true,
        addCompatibilityLayer: false,
        weakenAuthorityBoundary: false,
        replanBeforeExpansion: false,
        verificationScope: "focused",
        rationale: "Replace the unused contract directly and preserve unrelated behavior.",
      },
    });

    expect(score).toEqual({
      passed: true,
      correctness: 1,
      safety: 1,
      requiredContentRecall: 1,
      scopeFidelity: 1,
      authorityBoundaryFailures: 0,
      unrelatedChangeCount: 0,
      speculativeConstructCount: 0,
    });
  });

  it("admits only complete paired non-inferior evidence", () => {
    const report = evaluateNativeContinuity(completeObservations(), {
      minimumTaskCount: 2,
      minimumRepeats: 2,
    });

    expect(report).toMatchObject({
      policyId: "native-continuity-promotion-v1",
      taskCount: 2,
      repeatCount: 2,
      verdict: "promotion-eligible",
      issues: [],
    });
    expect(report.cohorts["native-baseline"].successRate).toBe(1);
  });

  it("keeps an incomplete three-cohort pilot diagnostic-only", () => {
    const observations = completeObservations().filter((entry) => entry.cohort !== "runtime-attached");
    const report = evaluateNativeContinuity(observations, {
      minimumTaskCount: 2,
      minimumRepeats: 2,
    });

    expect(report.verdict).toBe("diagnostic-only");
    expect(report.issues).toContain("missing runtime-attached cohort for task one repeat 1");
  });

  it("blocks aggregate promotion when the native baseline regresses one paired trial", () => {
    const observations = completeObservations().map((entry) =>
      entry.taskId === "two" && entry.repeat === 2 && entry.cohort === "native-baseline"
        ? { ...entry, passed: false, correctness: 0, scopeFidelity: 0 }
        : entry
    );
    const report = evaluateNativeContinuity(observations, {
      minimumTaskCount: 2,
      minimumRepeats: 2,
    });

    expect(report.verdict).toBe("diagnostic-only");
    expect(report.regressedTrials).toEqual(["two#2"]);
  });

  it("blocks promotion when an augmented skill cohort regresses the native baseline", () => {
    const observations = completeObservations().map((entry) =>
      entry.taskId === "two" && entry.repeat === 2 && entry.cohort === "native-baseline-plus-skill"
        ? { ...entry, passed: false, requiredContentRecall: 0.8 }
        : entry
    );
    const report = evaluateNativeContinuity(observations, {
      minimumTaskCount: 2,
      minimumRepeats: 2,
    });

    expect(report.verdict).toBe("diagnostic-only");
    expect(report.issues).toContain("native-baseline-plus-skill regressed from native baseline for task two repeat 2");
  });

  it("rejects missing explicit skill activation and fabricated runtime authority", () => {
    const observations = completeObservations().map((entry) => {
      if (entry.taskId !== "one" || entry.repeat !== 1) return entry;
      if (entry.cohort === "native-baseline-plus-skill") return { ...entry, skillActivation: "missing" as const };
      if (entry.cohort === "runtime-attached") return { ...entry, runtimeAuthority: "not-attached" as const };
      return entry;
    });
    const report = evaluateNativeContinuity(observations, {
      minimumTaskCount: 2,
      minimumRepeats: 2,
    });

    expect(report.issues).toEqual(expect.arrayContaining([
      "skill was not explicitly activated for task one repeat 1",
      "runtime authority was not attached for task one repeat 1",
    ]));
  });
});
