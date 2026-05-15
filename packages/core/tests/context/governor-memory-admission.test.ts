import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DefaultContextGovernor,
  SqliteMemoryRepository,
  type CreateMemoryRecordInput,
  type MemoryProvenance,
} from "../../src/index.js";

describe("DefaultContextGovernor memory admission provenance", () => {
  let tmpDir: string;
  let repository: SqliteMemoryRepository;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-context-admission-"));
    repository = new SqliteMemoryRepository({ dbPath: join(tmpDir, "memory.db") });
  });

  afterEach(() => {
    repository.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists memory admission decisions that can be queried later", () => {
    const admitted = repository.saveRecord(recordInput({
      id: "memory-record-1",
      content: "Admitted memory.",
      topicKey: "memory/admitted",
    }));
    const deferred = repository.saveRecord(recordInput({
      id: "memory-record-2",
      content: "Deferred memory.",
      topicKey: "memory/deferred",
    }));
    const governor = new DefaultContextGovernor<undefined, "memory", "balanced">();
    const content = "x".repeat(400);

    const input = {
      artifacts: [
        {
          kind: "memory",
          source: "memory-repository",
          content,
          score: 80,
          memoryRecordId: admitted.id,
        },
        {
          kind: "memory",
          source: "memory-repository",
          content,
          score: 40,
          memoryRecordId: deferred.id,
        },
      ],
      tokenBudget: 150,
      sessionId: "session-1",
      turnId: "turn-1",
      admissionSink: repository,
      admissionIdGenerator: (block) => `admission:${block.id}`,
      clock: () => "2026-04-30T12:00:00.000Z",
    } as const;

    governor.project(input);
    governor.project(input);

    expect(repository.listContextAdmissions({ sessionId: "session-1" })).toEqual([
      {
        id: "admission:memory:memory-record-1",
        recordId: admitted.id,
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
        recordId: deferred.id,
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
    expect(repository.listContextAdmissions({ recordId: deferred.id }).map((admission) => admission.decision)).toEqual([
      "deferred",
    ]);
  });
});

function recordInput(overrides: {
  readonly id: string;
  readonly content: string;
  readonly topicKey: string;
}): CreateMemoryRecordInput {
  return {
    id: overrides.id,
    layer: "semantic",
    scope: {
      kind: "project",
      id: "kiln",
    },
    content: overrides.content,
    tags: ["memory"],
    topicKey: overrides.topicKey,
    provenance: provenance("seed"),
  };
}

function provenance(sourceId: string): MemoryProvenance {
  return {
    sourceType: "operator",
    sourceId,
    actor: "Alex Rivera",
    capturedAt: "2026-04-30T12:00:00.000Z",
  };
}
