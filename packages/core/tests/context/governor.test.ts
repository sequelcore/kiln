import { describe, it, expect } from "vitest";
import type {
  ContextCandidate,
  ContextGovernor,
  ProjectContextInput,
  ProjectedContext,
} from "../../src/index.js";
import { DefaultContextGovernor, InMemoryContextArtifactCache } from "../../src/index.js";

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
    const selectedId = result.blocks[0]!.id;
    const deferredId = result.deferredBlocks![0]!.id;

    expect(auditEntry).toBeDefined();
    expect(auditEntry).toMatchObject({
      governor: "DefaultContextGovernor",
      selectedBlockIds: [selectedId],
      deferredBlockIds: [deferredId],
      selectedTokens: result.estimatedTokens,
      tokenBudget: 150,
      overflow: true,
      overflowReason: "budget-cap",
    });
    expect(auditEntry?.blocks.map((block) => block.id)).toEqual([
      selectedId,
      deferredId,
    ]);
    expect(auditEntry?.blocks[0]).toMatchObject({
      id: selectedId,
      decision: "admitted",
      reason: "within-budget",
      order: 0,
    });
    expect(auditEntry?.blocks[1]).toMatchObject({
      id: deferredId,
      decision: "deferred",
      reason: "budget-cap",
      order: 1,
    });
  });

  it("keeps memory record ids on admitted and deferred memory blocks", () => {
    const governor = makeGovernor();
    const content = "x".repeat(400);

    const result = governor.project({
      artifacts: [
        {
          kind: "memory",
          source: "memory-repository",
          content,
          score: 80,
          memoryRecordId: "memory-record-1",
        },
        {
          kind: "memory",
          source: "memory-repository",
          content,
          score: 40,
          memoryRecordId: "memory-record-2",
        },
      ],
      tokenBudget: 150,
    });

    expect(result.blocks[0]).toMatchObject({
      id: "memory:memory-record-1",
      memoryRecordId: "memory-record-1",
    });
    expect(result.deferredBlocks?.[0]).toMatchObject({
      id: "memory:memory-record-2",
      memoryRecordId: "memory-record-2",
    });
    expect(result.auditTrail?.[0]!.blocks.map((block) => block.memoryRecordId)).toEqual([
      "memory-record-1",
      "memory-record-2",
    ]);
  });

  it("records admitted and deferred memory decisions through the governor admission sink", () => {
    const governor = makeGovernor();
    const admissions: Array<{
      readonly recordId: string;
      readonly sessionId?: string;
      readonly turnId?: string;
      readonly decision: string;
      readonly reason: string;
      readonly estimatedTokens: number;
      readonly baseScore: number;
      readonly effectiveScore: number;
    }> = [];
    const content = "x".repeat(400);

    governor.project({
      artifacts: [
        {
          kind: "memory",
          source: "memory-repository",
          content,
          score: 80,
          memoryRecordId: "memory-record-1",
        },
        {
          kind: "memory",
          source: "memory-repository",
          content,
          score: 40,
          memoryRecordId: "memory-record-2",
        },
      ],
      tokenBudget: 150,
      sessionId: "session-1",
      turnId: "turn-1",
      admissionSink: {
        saveContextAdmission: (admission) => {
          admissions.push(admission);
          return admission;
        },
      },
      admissionIdGenerator: (block) => `admission:${block.id}`,
      clock: () => "2026-04-30T12:00:00.000Z",
    });

    expect(admissions).toEqual([
      {
        id: "admission:memory:memory-record-1",
        recordId: "memory-record-1",
        sessionId: "session-1",
        turnId: "turn-1",
        decision: "admitted",
        reason: "within-budget",
        estimatedTokens: 100,
        baseScore: 80,
        effectiveScore: 80,
        createdAt: "2026-04-30T12:00:00.000Z",
      },
      {
        id: "admission:memory:memory-record-2",
        recordId: "memory-record-2",
        sessionId: "session-1",
        turnId: "turn-1",
        decision: "deferred",
        reason: "budget-cap",
        estimatedTokens: 100,
        baseScore: 40,
        effectiveScore: 40,
        createdAt: "2026-04-30T12:00:00.000Z",
      },
    ]);
  });

  it("uses stable semantic block ids instead of positional ids", () => {
    const governor = makeGovernor();
    const content = "stable candidate content";
    const withBlank = governor.project({
      artifacts: [
        makeCandidate({ source: "artifact", content: "", score: 100 }),
        makeCandidate({ source: "artifact", content, score: 80 }),
      ],
      exactArtifacts: ["", "stable exact artifact"],
    });
    const withoutBlank = governor.project({
      artifacts: [
        makeCandidate({ source: "artifact", content, score: 80 }),
      ],
      exactArtifacts: ["stable exact artifact"],
    });
    const cache = new InMemoryContextArtifactCache();
    cache.set({
      key: "module-a",
      kind: "summary",
      content: "Module A summary.",
      createdAt: new Date("2026-04-30T12:00:00.000Z"),
      updatedAt: new Date("2026-04-30T12:00:00.000Z"),
    });
    cache.set({
      key: "module-b",
      kind: "summary",
      content: "Module B summary.",
      createdAt: new Date("2026-04-30T12:00:00.000Z"),
      updatedAt: new Date("2026-04-30T12:00:00.000Z"),
    });

    const cacheForward = governor.project({
      artifactCache: cache,
      moduleArtifactKeys: ["module-a", "module-b"],
    });
    const cacheReverse = governor.project({
      artifactCache: cache,
      moduleArtifactKeys: ["module-b", "module-a"],
    });

    expect(withBlank.blocks.map((block) => block.id).sort()).toEqual(
      withoutBlank.blocks.map((block) => block.id).sort(),
    );
    expect(cacheForward.blocks.map((block) => block.id).sort()).toEqual(
      cacheReverse.blocks.map((block) => block.id).sort(),
    );
    expect(withBlank.blocks.map((block) => block.id).join(" ")).not.toContain("candidate:0");
    expect(withBlank.blocks.map((block) => block.id).join(" ")).not.toContain("artifact:0");
    expect(cacheForward.blocks.map((block) => block.id).join(" ")).not.toContain("cached-module:0");
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
    const selectedId = result.blocks[0]!.id;
    const deferredId = result.deferredBlocks![0]!.id;

    expect(result.blocks.map((block) => block.id)).toEqual([selectedId]);
    expect(auditEntry).toMatchObject({
      requiredBlockIds: [selectedId],
      preservedRequiredBlockIds: [selectedId],
      selectedBlockIds: [selectedId],
      deferredBlockIds: [deferredId],
      requiredTokens: 300,
      tokenBudget: 150,
      overflow: true,
      overflowReason: "required-overflow",
    });
    expect(auditEntry?.blocks[0]).toMatchObject({
      id: selectedId,
      decision: "admitted",
      reason: "required-preserved",
    });
    expect(auditEntry?.blocks[1]).toMatchObject({
      id: deferredId,
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
