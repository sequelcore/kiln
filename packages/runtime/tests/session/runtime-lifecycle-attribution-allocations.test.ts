import { describe, expect, it } from "vitest";
import type { RuntimeContextAudit } from "../../src/gateway/message-pipeline.js";
import { projectRuntimeLifecycleAttributionAllocations } from "../../src/session/runtime-lifecycle-attribution-allocations.js";

const ROUTE = "codex-oauth/gpt-5.5";

const CONTEXT_AUDIT: RuntimeContextAudit = {
  governor: "DefaultContextGovernor",
  selectedBlockIds: ["memory-1", "procedure-1"],
  deferredBlockIds: ["knowledge-1"],
  requiredBlockIds: ["procedure-1"],
  preservedRequiredBlockIds: ["procedure-1"],
  selectedTokens: 30,
  requiredTokens: 12,
  tokenBudget: 40,
  overflow: true,
  overflowReason: "budget-cap",
  blocks: [
    {
      id: "memory-1",
      kind: "memory",
      source: "memory-recall:episodic",
      memoryRecordId: "memory-record-1",
      required: false,
      estimatedTokens: 18,
      baseScore: 0.9,
      effectiveScore: 0.9,
      decision: "admitted",
      reason: "within-budget",
      order: 0,
    },
    {
      id: "procedure-1",
      kind: "procedural",
      source: "kiln://instructions/sequel-engineering",
      required: true,
      estimatedTokens: 12,
      baseScore: 1,
      effectiveScore: 1,
      decision: "admitted",
      reason: "required-preserved",
      order: 1,
    },
    {
      id: "knowledge-1",
      kind: "knowledge",
      source: "kiln://knowledge/records/knowledge-1",
      required: false,
      estimatedTokens: 14,
      baseScore: 0.4,
      effectiveScore: 0.4,
      decision: "deferred",
      reason: "budget-cap",
      order: 2,
    },
  ],
};

describe("runtime lifecycle attribution allocation projection", () => {
  it("projects admitted audit-backed context with estimate, identity, evidence, and route context", () => {
    const allocations = projectRuntimeLifecycleAttributionAllocations({
      contextAudit: CONTEXT_AUDIT,
      route: ROUTE,
    });

    expect(allocations).toEqual([
      {
        source: "memory",
        tokenClass: "admitted",
        providerTokenClass: "input",
        tokens: 18,
        quality: "estimated",
        artifactId: "memory-1",
        evidenceUris: ["kiln://memory/nodes/memory-record-1"],
        context: { route: ROUTE, phase: "memory:episodic" },
      },
      {
        source: "procedural_context",
        tokenClass: "admitted",
        providerTokenClass: "input",
        tokens: 12,
        quality: "estimated",
        artifactId: "procedure-1",
        evidenceUris: ["kiln://instructions/sequel-engineering"],
        context: { route: ROUTE },
      },
    ]);
    expect(allocations).not.toContainEqual(expect.objectContaining({
      artifactId: "knowledge-1",
      tokenClass: "deferred",
      providerTokenClass: "input",
    }));
  });

  it("attributes generated tokens only from the canonical final-output boundary", () => {
    const withoutBoundary = projectRuntimeLifecycleAttributionAllocations({
      contextAudit: CONTEXT_AUDIT,
      route: ROUTE,
    });
    const withBoundary = projectRuntimeLifecycleAttributionAllocations({
      contextAudit: CONTEXT_AUDIT,
      finalOutput: {
        evidenceUri: "kiln://sessions/session-1/turns/turn-1/final-output",
        estimatedTokens: 9,
      },
      route: ROUTE,
    });

    expect(withoutBoundary).not.toContainEqual(expect.objectContaining({ source: "final_output" }));
    expect(withBoundary).toContainEqual({
      source: "final_output",
      tokenClass: "generated",
      providerTokenClass: "output",
      tokens: 9,
      quality: "estimated",
      evidenceUris: ["kiln://sessions/session-1/turns/turn-1/final-output"],
      context: { route: ROUTE },
    });
  });

  it("projects estimated evidence without reconciling against provider totals", () => {
    const allocations = projectRuntimeLifecycleAttributionAllocations({
      contextAudit: CONTEXT_AUDIT,
      finalOutput: {
        evidenceUri: "kiln://sessions/session-1/turns/turn-1/final-output",
        estimatedTokens: 20,
      },
      route: ROUTE,
    });

    expect(allocations).toEqual([
      {
        source: "memory",
        tokenClass: "admitted",
        providerTokenClass: "input",
        tokens: 18,
        quality: "estimated",
        artifactId: "memory-1",
        evidenceUris: ["kiln://memory/nodes/memory-record-1"],
        context: { route: ROUTE, phase: "memory:episodic" },
      },
      {
        source: "procedural_context",
        tokenClass: "admitted",
        providerTokenClass: "input",
        tokens: 12,
        quality: "estimated",
        artifactId: "procedure-1",
        evidenceUris: ["kiln://instructions/sequel-engineering"],
        context: { route: ROUTE },
      },
      {
        source: "final_output",
        tokenClass: "generated",
        providerTokenClass: "output",
        tokens: 20,
        quality: "estimated",
        evidenceUris: ["kiln://sessions/session-1/turns/turn-1/final-output"],
        context: { route: ROUTE },
      },
    ]);
  });

  it("leaves unobservable tool-schema, provider-native, and cache usage for unknown reconciliation", () => {
    const allocations = projectRuntimeLifecycleAttributionAllocations({
      contextAudit: CONTEXT_AUDIT,
      route: ROUTE,
    });

    expect(allocations).not.toContainEqual(expect.objectContaining({ source: "tool_schema" }));
    expect(allocations).not.toContainEqual(expect.objectContaining({ providerTokenClass: "cache_read" }));
    expect(allocations).not.toContainEqual(expect.objectContaining({ providerTokenClass: "cache_write" }));
    expect(allocations.reduce((sum, allocation) => sum + allocation.tokens, 0)).toBe(30);
  });

  it("attributes admitted instruction blocks to control instructions", () => {
    const allocations = projectRuntimeLifecycleAttributionAllocations({
      contextAudit: {
        ...CONTEXT_AUDIT,
        blocks: [{
          id: "instruction-1",
          kind: "instruction",
          source: "kiln://instructions/session-policy",
          required: true,
          estimatedTokens: 7,
          baseScore: 1,
          effectiveScore: 1,
          decision: "admitted",
          reason: "required-preserved",
          order: 0,
        }],
      },
      route: ROUTE,
    });

    expect(allocations).toEqual([{
      source: "control_instructions",
      tokenClass: "admitted",
      providerTokenClass: "input",
      tokens: 7,
      quality: "estimated",
      artifactId: "instruction-1",
      evidenceUris: ["kiln://instructions/session-policy"],
      context: { route: ROUTE },
    }]);
  });

  it("keeps non-resource context source identity out of evidence URI fields", () => {
    const allocations = projectRuntimeLifecycleAttributionAllocations({
      contextAudit: {
        ...CONTEXT_AUDIT,
        blocks: [{
          id: "procedure-path-source",
          kind: "procedural",
          source: "runtime-skill:C:/repo/.agents/skills/review/SKILL.md",
          required: true,
          estimatedTokens: 9,
          baseScore: 1,
          effectiveScore: 1,
          decision: "admitted",
          reason: "required-preserved",
          order: 0,
        }],
      },
      route: ROUTE,
    });

    expect(allocations).toEqual([expect.objectContaining({
      artifactId: "procedure-path-source",
      evidenceUris: [],
    })]);
  });
});
