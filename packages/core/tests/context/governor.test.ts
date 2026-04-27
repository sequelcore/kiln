import { describe, it, expect } from "vitest";
import type {
  ContextCandidate,
  ContextGovernor,
  ProjectContextInput,
  ProjectedContext,
} from "@kilnai/core";
import { DefaultContextGovernor } from "@kilnai/core";

// Test-local policy types (parameterization compile check — test 6)
type TestLedger = { entries: string[] };
type TestSource = "ledger" | "artifact" | "summary" | "memory" | "knowledge";
type TestAggressiveness = "low" | "medium" | "high";

const DEFAULT_POLICY: Record<
  TestAggressiveness,
  { summaryBonus: number; artifactPenalty: number }
> = {
  low: { summaryBonus: 0, artifactPenalty: 0 },
  medium: { summaryBonus: 10, artifactPenalty: 5 },
  high: { summaryBonus: 25, artifactPenalty: 10 },
};

function makeGovernor(): DefaultContextGovernor<
  TestLedger,
  TestSource,
  TestAggressiveness
> {
  return new DefaultContextGovernor<TestLedger, TestSource, TestAggressiveness>();
}

function makeCandidate(
  overrides: { content: string; source: TestSource; score?: number; required?: boolean },
): ContextCandidate {
  return {
    kind: overrides.source,
    source: overrides.source,
    content: overrides.content,
    score: overrides.score ?? 50,
    required: overrides.required ?? false,
  };
}

describe("DefaultContextGovernor", () => {
  it("returns empty blocks and zero estimatedTokens for empty input", () => {
    const governor = makeGovernor();
    const input: ProjectContextInput<TestLedger, TestSource, TestAggressiveness> = {};
    const result: ProjectedContext = governor.project(input);

    expect(result.blocks).toEqual([]);
    expect(result.estimatedTokens).toBe(0);
    expect(result.overflow).toBe(false);
  });

  it("emits a required ledger block when renderLedger returns a non-empty string", () => {
    const governor = makeGovernor();
    const ledger: TestLedger = { entries: ["turn-1: hello", "turn-2: world"] };

    const input: ProjectContextInput<TestLedger, TestSource, TestAggressiveness> = {
      sessionLedger: ledger,
      renderLedger: (l) => l.entries.join("\n"),
    };

    const result: ProjectedContext = governor.project(input);

    const ledgerBlock = result.blocks.find((b) => b.kind === "ledger");
    expect(ledgerBlock).toBeDefined();
    expect(ledgerBlock!.required).toBe(true);
    expect(ledgerBlock!.content).toContain("turn-1: hello");
  });

  it("honors tokenBudget: defers lower-scored artifact and sets overflow", () => {
    const governor = makeGovernor();

    // ~500 tokens each — two candidates, budget only fits one
    const longContent = "word ".repeat(375); // ~500 tokens at ~1.33 chars/token

    const input: ProjectContextInput<TestLedger, TestSource, TestAggressiveness> = {
      artifacts: [
        makeCandidate({ source: "artifact", content: longContent, score: 80 }),
        makeCandidate({ source: "artifact", content: longContent, score: 40 }),
      ],
      tokenBudget: 600,
    };

    const result: ProjectedContext = governor.project(input);

    // Higher-scored block selected; lower deferred
    const selectedScores = result.blocks.map((b) => b.score);
    expect(selectedScores).toContain(80);
    expect(selectedScores).not.toContain(40);
    expect(result.overflow).toBe(true);
  });

  it("emits a stable audit entry for admitted and deferred blocks", () => {
    const governor = makeGovernor();
    const content = "x".repeat(400); // ~100 tokens

    const input: ProjectContextInput<TestLedger, TestSource, TestAggressiveness> = {
      artifacts: [
        makeCandidate({ source: "summary", content, score: 80 }),
        makeCandidate({ source: "memory", content, score: 40 }),
      ],
      tokenBudget: 150,
    };

    const result = governor.project(input);
    const auditEntry = result.auditTrail?.[0];

    expect(auditEntry).toBeDefined();
    expect(auditEntry).toMatchObject({
      governor: "DefaultContextGovernor",
      selectedBlockIds: ["candidate:0"],
      deferredBlockIds: ["candidate:1"],
      selectedTokens: result.estimatedTokens,
      tokenBudget: 150,
      overflow: true,
      overflowReason: "budget-cap",
    });
    expect(auditEntry?.blocks.map((block) => block.id)).toEqual([
      "candidate:0",
      "candidate:1",
    ]);
    expect(auditEntry?.blocks[0]).toMatchObject({
      id: "candidate:0",
      decision: "admitted",
      reason: "within-budget",
      order: 0,
    });
    expect(auditEntry?.blocks[1]).toMatchObject({
      id: "candidate:1",
      decision: "deferred",
      reason: "budget-cap",
      order: 1,
    });
  });

  it("marks required blocks as preserved in the audit even when they exceed budget", () => {
    const governor = makeGovernor();
    const requiredContent = "r".repeat(1_200); // ~300 tokens
    const optionalContent = "o".repeat(400); // ~100 tokens

    const input: ProjectContextInput<TestLedger, TestSource, TestAggressiveness> = {
      artifacts: [
        makeCandidate({ source: "ledger", content: requiredContent, score: 100, required: true }),
        makeCandidate({ source: "memory", content: optionalContent, score: 90 }),
      ],
      tokenBudget: 150,
    };

    const result = governor.project(input);
    const auditEntry = result.auditTrail?.[0];

    expect(result.blocks.map((block) => block.id)).toEqual(["candidate:0"]);
    expect(auditEntry).toMatchObject({
      requiredBlockIds: ["candidate:0"],
      preservedRequiredBlockIds: ["candidate:0"],
      selectedBlockIds: ["candidate:0"],
      deferredBlockIds: ["candidate:1"],
      requiredTokens: 300,
      tokenBudget: 150,
      overflow: true,
      overflowReason: "required-overflow",
    });
    expect(auditEntry?.blocks[0]).toMatchObject({
      id: "candidate:0",
      decision: "admitted",
      reason: "required-preserved",
    });
    expect(auditEntry?.blocks[1]).toMatchObject({
      id: "candidate:1",
      decision: "deferred",
      reason: "required-overflow",
    });
  });

  it("preferredSources raises summary block score over same-base-score memory block", () => {
    const governor = makeGovernor();
    const content = "x".repeat(400); // ~100 tokens

    const input: ProjectContextInput<TestLedger, TestSource, TestAggressiveness> = {
      artifacts: [
        makeCandidate({ source: "summary", content, score: 50 }),
        makeCandidate({ source: "memory", content, score: 50 }),
      ],
      tokenBudget: 150, // fits one block, not two
      preferredSources: ["summary"],
    };

    const result: ProjectedContext = governor.project(input);

    const kinds = result.blocks.map((b) => b.kind);
    expect(kinds).toContain("summary");
    expect(kinds).not.toContain("memory");
  });

  it("high aggressivenessPolicy shifts selection toward summary over artifact", () => {
    const governor = makeGovernor();
    const content = "x".repeat(400); // ~100 tokens

    const input: ProjectContextInput<TestLedger, TestSource, TestAggressiveness> = {
      artifacts: [
        makeCandidate({ source: "summary", content, score: 50 }),
        makeCandidate({ source: "artifact", content, score: 65 }),
      ],
      tokenBudget: 150, // fits one block, not two
      summaryAggressiveness: "high",
      aggressivenessPolicy: DEFAULT_POLICY,
    };

    const result: ProjectedContext = governor.project(input);

    // summary: 50 + 25 = 75; artifact: 65 - 10 = 55; summary wins
    const kinds = result.blocks.map((b) => b.kind);
    expect(kinds).toContain("summary");
    expect(kinds).not.toContain("artifact");
  });

  it("compiles with explicit generic type parameters (parameterization check)", () => {
    // If DefaultContextGovernor<TL,TS,TA> does not accept three type params,
    // this file will not compile — the test is the compilation itself.
    const governor: ContextGovernor<
      TestLedger,
      TestSource,
      TestAggressiveness
    > = new DefaultContextGovernor<TestLedger, TestSource, TestAggressiveness>();

    const input: ProjectContextInput<TestLedger, TestSource, TestAggressiveness> = {};
    const result: ProjectedContext = governor.project(input);
    expect(result).toBeDefined();
  });
});
