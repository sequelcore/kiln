import { describe, expect, it } from "vitest";
import type { TurnProgressEvidence } from "../../src/agents/turn-progress-evidence.js";

describe("TurnProgressEvidence", () => {
  it("models a new material result without completion semantics", () => {
    const evidence: TurnProgressEvidence = {
      kind: "progress",
      reason: "new_material_result",
      evidenceFingerprint: "sha256:result",
      supportingToolCallIds: ["call-1"],
    };

    expect(evidence).toEqual({
      kind: "progress",
      reason: "new_material_result",
      evidenceFingerprint: "sha256:result",
      supportingToolCallIds: ["call-1"],
    });
  });

  it.each([
    "repeated_result",
    "failed_execution",
    "invalid_input",
    "empty_discovery",
    "empty_result",
  ] as const)("models %s as no progress", (reason) => {
    const evidence: TurnProgressEvidence = {
      kind: "no_progress",
      reason,
      strategyFingerprint: `sha256:${reason}`,
      supportingToolCallIds: ["call-1"],
    };

    expect(evidence.kind).toBe("no_progress");
    expect(evidence.reason).toBe(reason);
  });

  it("requires a strategy fingerprint for a blocked batch", () => {
    const evidence: TurnProgressEvidence = {
      kind: "no_progress",
      reason: "blocked_batch",
      strategyFingerprint: "sha256:strategy",
      supportingToolCallIds: ["call-1", "call-2"],
    };

    expect(evidence).toMatchObject({
      kind: "no_progress",
      reason: "blocked_batch",
      strategyFingerprint: "sha256:strategy",
    });
  });
});
