import { describe, expect, it } from "vitest";
import { DefaultContextGovernor } from "../../src/context/governor.js";
import type { ContextCandidate } from "../../src/context/projected-context.js";
import { coordinationStateToContextCandidates } from "../../src/context/coordination-context.js";

type CoordinationKind = ContextCandidate["kind"] | "coordination";

interface CrossAgentMemoryEntry {
  readonly id: string;
  readonly agentId: string;
  readonly role: string;
  readonly summary: string;
  readonly updatedAt: string;
}

interface SwarmMember {
  readonly agentId: string;
  readonly role: string;
  readonly status: "active" | "completed" | "blocked";
}

interface SwarmState {
  readonly swarmId: string;
  readonly objective: string;
  readonly status: "active" | "blocked" | "completed";
  readonly updatedAt: string;
  readonly members: readonly SwarmMember[];
}

interface CoordinationAdapterState {
  readonly crossAgentMemory: readonly CrossAgentMemoryEntry[];
  readonly swarmState: SwarmState;
}

function asCoordinationCandidates(
  candidates: readonly ContextCandidate[],
): readonly (ContextCandidate & { readonly kind: CoordinationKind })[] {
  return candidates as readonly (ContextCandidate & { readonly kind: CoordinationKind })[];
}

describe("coordinationStateToContextCandidates", () => {
  it("maps cross-agent memory and swarm state into stable coordination candidates", () => {
    const state: CoordinationAdapterState = {
      crossAgentMemory: [
        {
          id: "memory-2",
          agentId: "agent-b",
          role: "reviewer",
          summary: "Audit trail must preserve coordination provenance.",
          updatedAt: "2026-04-27T10:15:00.000Z",
        },
        {
          id: "memory-1",
          agentId: "agent-a",
          role: "planner",
          summary: "Slice 3A needs cross-agent memory summarized before budgeting.",
          updatedAt: "2026-04-27T10:05:00.000Z",
        },
      ],
      swarmState: {
        swarmId: "swarm-17",
        objective: "Ship Slice 3A coordination context adapter",
        status: "active",
        updatedAt: "2026-04-27T10:20:00.000Z",
        members: [
          { agentId: "agent-a", role: "planner", status: "completed" },
          { agentId: "agent-b", role: "reviewer", status: "active" },
        ],
      },
    };

    const firstPass = asCoordinationCandidates(coordinationStateToContextCandidates(state));
    const secondPass = asCoordinationCandidates(coordinationStateToContextCandidates(state));

    expect(firstPass).toEqual(secondPass);
    expect(firstPass).toHaveLength(5);
    expect(firstPass).toMatchObject([
      {
        kind: "coordination",
        source: "runtime-cross-agent-memory:memory-1",
        required: false,
        score: 0.7,
      },
      {
        kind: "coordination",
        source: "runtime-cross-agent-memory:memory-2",
        required: false,
        score: 0.7,
      },
      {
        kind: "coordination",
        source: "runtime-swarm-state:swarm-17",
        required: false,
        score: 0.7,
      },
      {
        kind: "coordination",
        source: "runtime-swarm-member:swarm-17:agent-a",
        required: false,
        score: 0.7,
      },
      {
        kind: "coordination",
        source: "runtime-swarm-member:swarm-17:agent-b",
        required: false,
        score: 0.7,
      },
    ]);
    expect(firstPass[0]?.content).toBe(
      [
        "Cross-agent memory",
        "id: memory-1",
        "agent: planner(agent-a)",
        "updatedAt: 2026-04-27T10:05:00.000Z",
        "summary: Slice 3A needs cross-agent memory summarized before budgeting.",
      ].join("\n"),
    );
    expect(firstPass[1]?.content).toBe(
      [
        "Cross-agent memory",
        "id: memory-2",
        "agent: reviewer(agent-b)",
        "updatedAt: 2026-04-27T10:15:00.000Z",
        "summary: Audit trail must preserve coordination provenance.",
      ].join("\n"),
    );
    expect(firstPass[2]?.content).toBe(
      [
        "Swarm state",
        "id: swarm-17",
        "objective: Ship Slice 3A coordination context adapter",
        "status: active",
        "updatedAt: 2026-04-27T10:20:00.000Z",
      ].join("\n"),
    );
    expect(firstPass[3]?.content).toBe(
      [
        "Swarm member",
        "swarmId: swarm-17",
        "agent: planner(agent-a)",
        "status: completed",
      ].join("\n"),
    );
    expect(firstPass[4]?.content).toBe(
      [
        "Swarm member",
        "swarmId: swarm-17",
        "agent: reviewer(agent-b)",
        "status: active",
      ].join("\n"),
    );
  });

  it("allows score and required defaults to be overridden for all coordination candidates", () => {
    const state: CoordinationAdapterState = {
      crossAgentMemory: [
        {
          id: "memory-1",
          agentId: "agent-a",
          role: "planner",
          summary: "Preserve required coordination context.",
          updatedAt: "2026-04-27T10:05:00.000Z",
        },
      ],
      swarmState: {
        swarmId: "swarm-17",
        objective: "Ship Slice 3A coordination context adapter",
        status: "active",
        updatedAt: "2026-04-27T10:20:00.000Z",
        members: [{ agentId: "agent-a", role: "planner", status: "active" }],
      },
    };

    const candidates = asCoordinationCandidates(
      coordinationStateToContextCandidates(state, {
        score: 0.91,
        required: true,
      }),
    );

    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => candidate.kind === "coordination")).toBe(true);
    expect(candidates.every((candidate) => candidate.source.startsWith("runtime-"))).toBe(true);
    expect(candidates.every((candidate) => candidate.score === 0.91)).toBe(true);
    expect(candidates.every((candidate) => candidate.required === true)).toBe(true);
  });
});

describe("DefaultContextGovernor coordination audit integration", () => {
  it("ranks and defers coordination candidates under budget while preserving coordination audit metadata", () => {
    const governor = new DefaultContextGovernor<undefined, "coordination", "balanced">();
    const state: CoordinationAdapterState = {
      crossAgentMemory: [
        {
          id: "memory-1",
          agentId: "agent-a",
          role: "planner",
          summary:
            "Budget the coordination context after ranking the cross-agent memory candidate first.",
          updatedAt: "2026-04-27T10:05:00.000Z",
        },
      ],
      swarmState: {
        swarmId: "swarm-17",
        objective: "Ship Slice 3A coordination context adapter",
        status: "active",
        updatedAt: "2026-04-27T10:20:00.000Z",
        members: [
          { agentId: "agent-a", role: "planner", status: "completed" },
          { agentId: "agent-b", role: "reviewer", status: "active" },
        ],
      },
    };

    const candidates = asCoordinationCandidates(
      coordinationStateToContextCandidates(state, {
        score: 0.5,
      }),
    ).map((candidate) => {
      if (candidate.source.startsWith("runtime-cross-agent-memory:")) {
        return { ...candidate, score: 0.9, estimatedTokens: 30 };
      }

      return { ...candidate, score: 0.4, estimatedTokens: 30 };
    });

    const result = governor.project({
      artifacts: candidates,
      tokenBudget: 35,
    });
    const auditEntry = result.auditTrail?.[0];

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      kind: "coordination",
      source: "runtime-cross-agent-memory:memory-1",
      score: 0.9,
    });
    expect(result.deferredBlocks).toHaveLength(3);
    expect(result.deferredBlocks?.[0]).toMatchObject({
      kind: "coordination",
      source: "runtime-swarm-state:swarm-17",
      score: 0.4,
    });
    expect(result.overflow).toBe(true);

    expect(auditEntry).toBeDefined();
    expect(auditEntry?.blocks).toHaveLength(4);
    expect(auditEntry?.blocks[0]).toMatchObject({
      kind: "coordination",
      source: "runtime-cross-agent-memory:memory-1",
      decision: "admitted",
      reason: "within-budget",
      effectiveScore: 0.9,
    });
    expect(auditEntry?.blocks[1]).toMatchObject({
      kind: "coordination",
      source: "runtime-swarm-state:swarm-17",
      decision: "deferred",
      reason: "budget-cap",
      effectiveScore: 0.4,
    });
    expect(auditEntry?.blocks).toContainEqual(expect.objectContaining({
      kind: "coordination",
      source: "runtime-swarm-member:swarm-17:agent-a",
      decision: "deferred",
      reason: "budget-cap",
    }));
  });
});
