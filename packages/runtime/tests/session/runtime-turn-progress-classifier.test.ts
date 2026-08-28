import { describe, expect, it } from "vitest";
import type { ToolExecutionSummary } from "../../src/session/runtime-session-orchestrator.types.js";
import {
  RuntimeTurnProgressClassifier,
  type RuntimeTurnProgressBatch,
} from "../../src/session/runtime-turn-progress-classifier.js";

function execution(overrides: Partial<ToolExecutionSummary> = {}): ToolExecutionSummary {
  return {
    toolCallId: "call-1",
    toolName: "read",
    durationMs: 1,
    success: true,
    resultSummary: "material result",
    ...overrides,
  };
}

function batch(overrides: Partial<RuntimeTurnProgressBatch> = {}): RuntimeTurnProgressBatch {
  return {
    executions: [execution()],
    ...overrides,
  };
}

describe("RuntimeTurnProgressClassifier", () => {
  it("classifies the first successful non-empty result as progress", () => {
    const classifier = new RuntimeTurnProgressClassifier();

    expect(classifier.classify(batch())).toMatchObject({
      kind: "progress",
      reason: "new_material_result",
      supportingToolCallIds: ["call-1"],
    });
    expect(classifier.chronologicalEvidence).toHaveLength(1);
  });

  it("recognizes repeats, including alternating A/B results", () => {
    const classifier = new RuntimeTurnProgressClassifier();

    expect(classifier.classify(batch({ executions: [execution({ toolCallId: "a", resultSummary: "A" })] })).kind).toBe("progress");
    expect(classifier.classify(batch({ executions: [execution({ toolCallId: "b", resultSummary: "B" })] })).kind).toBe("progress");

    expect(classifier.classify(batch({ executions: [execution({ toolCallId: "a", resultSummary: "A" })] }))).toMatchObject({
      kind: "no_progress",
      reason: "repeated_result",
    });
    expect(classifier.classify(batch({ executions: [execution({ toolCallId: "b", resultSummary: "B" })] }))).toMatchObject({
      kind: "no_progress",
      reason: "repeated_result",
    });
  });

  it("classifies failed execution as no progress", () => {
    const evidence = new RuntimeTurnProgressClassifier().classify(batch({
      executions: [execution({ success: false, resultSummary: "failed" })],
    }));

    expect(evidence).toMatchObject({ kind: "no_progress", reason: "failed_execution" });
    if (evidence.kind !== "no_progress") throw new Error("expected no-progress evidence");
    expect(evidence.strategyFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("keeps varied failures in the same failure class when only command input changes", () => {
    const classifier = new RuntimeTurnProgressClassifier();
    const first = classifier.classify(batch({
      executions: [execution({
        toolName: "bash",
        input: { command: "printf first" },
        success: false,
        resultSummary: "exit code 1",
        metadata: { kind: "command", status: "failed", exitCode: 1 },
      })],
    }));
    const second = classifier.classify(batch({
      executions: [execution({
        toolCallId: "call-2",
        toolName: "bash",
        input: { command: "printf second" },
        success: false,
        resultSummary: "exit code 1",
        metadata: { kind: "command", status: "failed", exitCode: 1 },
      })],
    }));

    if (first.kind !== "no_progress" || second.kind !== "no_progress") {
      throw new Error("expected failed no-progress evidence");
    }
    expect(first.reason).toBe("failed_execution");
    expect(second.reason).toBe("failed_execution");
    expect(first.strategyFingerprint).toBe(second.strategyFingerprint);
  });

  it("classifies explicit invalid calls as no progress", () => {
    const evidence = new RuntimeTurnProgressClassifier().classify({
      executions: [],
      invalidToolCallIds: ["invalid-1"],
    });

    expect(evidence).toMatchObject({
      kind: "no_progress",
      reason: "invalid_input",
      supportingToolCallIds: ["invalid-1"],
    });
  });

  it("classifies typed empty catalog discovery as no progress", () => {
    const evidence = new RuntimeTurnProgressClassifier().classify(batch({
      executions: [execution({
        toolName: "tool_catalog_search",
        metadata: {
          kind: "catalog",
          toolName: "tool_catalog_search",
          operation: "search",
          stale: false,
          materializableToolName: "missing_tool",
          resultCount: 0,
        },
        resultSummary: "No matching tools",
      })],
    }));

    expect(evidence).toMatchObject({ kind: "no_progress", reason: "empty_discovery" });
  });

  it("classifies a non-discovery empty result honestly", () => {
    const evidence = new RuntimeTurnProgressClassifier().classify(batch({
      executions: [execution({ resultSummary: "   " })],
    }));

    expect(evidence).toMatchObject({ kind: "no_progress", reason: "empty_result" });
  });

  it("classifies a blocked-only batch without pretending it executed", () => {
    const evidence = new RuntimeTurnProgressClassifier().classify({
      executions: [],
      blockedToolCallIds: ["blocked-1", "blocked-2"],
    });

    expect(evidence).toMatchObject({
      kind: "no_progress",
      reason: "blocked_batch",
      supportingToolCallIds: ["blocked-1", "blocked-2"],
    });
  });

  it("lets genuinely new material win a mixed batch and fingerprints all new material", () => {
    const mixedBatch = batch({
      executions: [
        execution({ toolCallId: "new-a", resultSummary: "A" }),
        execution({ toolCallId: "failed", success: false, resultSummary: "failed" }),
        execution({ toolCallId: "new-b", resultSummary: "B" }),
      ],
      blockedToolCallIds: ["blocked"],
    });
    const classifier = new RuntimeTurnProgressClassifier();
    const evidence = classifier.classify(mixedBatch);
    const freshEvidence = new RuntimeTurnProgressClassifier().classify(mixedBatch);

    expect(evidence).toMatchObject({
      kind: "progress",
      reason: "new_material_result",
      supportingToolCallIds: ["new-a", "new-b"],
    });
    if (evidence.kind !== "progress" || freshEvidence.kind !== "progress") {
      throw new Error("expected mixed progress evidence");
    }
    expect(evidence.evidenceFingerprint).toBe(freshEvidence.evidenceFingerprint);
    const firstChronologicalEvidence = classifier.chronologicalEvidence[0];
    if (firstChronologicalEvidence?.kind !== "progress") {
      throw new Error("expected chronological progress evidence");
    }
    expect(evidence.evidenceFingerprint).not.toBe(firstChronologicalEvidence.evidenceFingerprint);
  });

  it("bounds digest input and never exposes raw output", () => {
    const commonPrefix = "m".repeat(400);
    const first = `${commonPrefix}${"a".repeat(5_000)}`;
    const second = `${commonPrefix}${"b".repeat(5_000)}`;
    const firstEvidence = new RuntimeTurnProgressClassifier().classify(batch({
      executions: [execution({ resultSummary: first, output: first, metadata: { output: first, stable: true } })],
    }));
    const secondEvidence = new RuntimeTurnProgressClassifier().classify(batch({
      executions: [execution({ resultSummary: second, output: second, metadata: { output: second, stable: true } })],
    }));

    if (firstEvidence.kind !== "progress" || secondEvidence.kind !== "progress") {
      throw new Error("expected bounded progress evidence");
    }
    expect(firstEvidence.evidenceFingerprint).toBe(secondEvidence.evidenceFingerprint);
    expect(firstEvidence.evidenceFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(firstEvidence.evidenceFingerprint).not.toContain(first);
    expect(secondEvidence.evidenceFingerprint).not.toContain(second);
  });

  it("ignores volatile metadata when identifying the same material result", () => {
    const classifier = new RuntimeTurnProgressClassifier();
    const first = classifier.classify(batch({
      executions: [execution({
        resultSummary: "same material",
        metadata: { stable: "value", durationMs: 10, observedAt: "t1", requestId: "r1" },
      })],
    }));
    const second = classifier.classify(batch({
      executions: [execution({
        toolCallId: "call-2",
        resultSummary: "same material",
        metadata: { stable: "value", durationMs: 20, observedAt: "t2", requestId: "r2" },
      })],
    }));

    expect(first.kind).toBe("progress");
    expect(second).toMatchObject({ kind: "no_progress", reason: "repeated_result" });
  });

  it("does not treat an alias spelling as the canonical execution identity", () => {
    const classifier = new RuntimeTurnProgressClassifier();

    classifier.classify(batch({ executions: [execution({ toolCallId: "canonical", toolName: "formal_verify" })] }));
    const aliasEvidence = classifier.classify(batch({ executions: [execution({ toolCallId: "alias", toolName: "Dafny" })] }));

    expect(aliasEvidence.kind).toBe("progress");
  });

  it("rejects a batch with no execution or explicit outcome IDs", () => {
    expect(() => new RuntimeTurnProgressClassifier().classify({ executions: [] })).toThrow(TypeError);
  });
});
