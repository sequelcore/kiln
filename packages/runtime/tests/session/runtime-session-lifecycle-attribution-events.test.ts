import { describe, expect, it } from "vitest";
import type { CostUpdateEvent } from "@kilnai/core/events";
import { appendCanonicalTurnEvents } from "../../src/session/runtime-session-event-ledger.js";
import { toOperatorSessionEventFrame } from "../../src/gateway/operator-session-event-frame.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

const contextAudit = {
  governor: "DefaultContextGovernor" as const,
  selectedBlockIds: ["memory-1"],
  deferredBlockIds: [],
  requiredBlockIds: [],
  preservedRequiredBlockIds: [],
  selectedTokens: 25,
  requiredTokens: 0,
  tokenBudget: 100,
  overflow: false,
  blocks: [{
    id: "memory-1",
    kind: "memory" as const,
    source: "kiln://memory/records/memory-1",
    memoryRecordId: "memory-record-1",
    required: false,
    estimatedTokens: 25,
    baseScore: 0.8,
    effectiveScore: 0.8,
    decision: "admitted" as const,
    reason: "within-budget" as const,
    order: 0,
  }],
};

describe("runtime session lifecycle attribution events", () => {
  it("emits lifecycle attribution after canonical cost updates", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Be useful.",
    });
    const startedAt = new Date("2026-06-30T12:00:00.000Z");
    const completedAt = new Date("2026-06-30T12:00:01.000Z");
    const costUpdate: CostUpdateEvent = {
      type: "cost_update",
      sessionId: session.id,
      provider: "codex-oauth",
      model: "gpt-5.5",
      canonicalModel: "gpt-5.5",
      billingMode: "metered",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 7,
      totalCostUsd: 0.0123,
      costEvidence: {
        kind: "subscription",
        currency: "USD",
        amountUsd: 0,
        comparable: false,
        reason: "subscription billing does not expose per-call metered charges",
      },
      byRoleModel: {},
      timestamp: completedAt,
    };

    const events = appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Measure this turn.",
      assistantMessageContent: "Measured.",
      turnOutcome: "completed",
      queued: false,
      turnStartedAt: startedAt,
      turnCompletedAt: completedAt,
      continuity: { strategy: "none" },
      runtimeEvents: [costUpdate],
    });

    const costEvent = events.find((event) => event.kind === "cost_updated");
    const attributionEvent = events.find((event) => event.kind === "lifecycle_attribution_recorded");

    if (attributionEvent?.kind !== "lifecycle_attribution_recorded") {
      throw new Error("Expected lifecycle attribution event.");
    }
    expect(attributionEvent.ledger.records.reduce((sum, record) => sum + record.cost.deltaUsd, 0)).toBeCloseTo(0.0123);
    expect(costEvent).toMatchObject({
      kind: "cost_updated",
      provider: {
        provider: "codex-oauth",
        model: "gpt-5.5",
        canonicalModel: "gpt-5.5",
        billingMode: "metered",
      },
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 7,
      },
      cost: {
        evidence: {
          kind: "subscription",
          currency: "USD",
          amountUsd: 0,
          comparable: false,
        },
      },
    });
    expect(attributionEvent).toMatchObject({
      kind: "lifecycle_attribution_recorded",
      parentEventId: costEvent?.eventId,
      efficiencyEvidence: {
        schemaVersion: "verified-efficiency-evidence-v1",
        policy: {
          owner: "ContextGovernor",
          policyId: "context-whole-block-static-v1",
        },
        totals: {
          providerTotalTokens: 157,
          measured: { tokens: 0 },
          estimated: { tokens: 0 },
          cached: { tokens: 30 },
          unknown: { tokens: 120 },
          cacheWritten: { tokens: 7 },
          avoided: { tokens: 0, costUsd: 0 },
        },
        verification: { status: "not_run", results: [] },
        actions: [],
        savings: [],
      },
      ledger: {
        sessionId: session.id,
        turnId: costEvent?.turnId,
        sourceEventId: costEvent?.eventId,
        sourceEventSequence: costEvent?.sequence,
        provider: {
          provider: "codex-oauth",
          model: "gpt-5.5",
        },
        records: [
          expect.objectContaining({ source: "unknown", tokenClass: "raw", providerTokenClass: "input", tokens: 100 }),
          expect.objectContaining({ source: "unknown", tokenClass: "generated", providerTokenClass: "output", tokens: 20 }),
          expect.objectContaining({ source: "unknown", tokenClass: "cached", providerTokenClass: "cache_read", tokens: 30 }),
          expect.objectContaining({ source: "unknown", tokenClass: "cache_written", providerTokenClass: "cache_write", tokens: 7 }),
        ],
      },
      summary: expect.objectContaining({
        totalTokens: 157,
      }),
    });
    expect(events.map((event) => event.kind)).toContain("lifecycle_attribution_recorded");
  });

  it("emits reconciled semantic allocations and explicit unknown remainder under the parent cost event", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Be useful.",
    });
    const completedAt = new Date("2026-06-30T12:00:01.000Z");
    const costUpdate: CostUpdateEvent = {
      type: "cost_update",
      sessionId: session.id,
      provider: "codex-oauth",
      model: "gpt-5.5",
      canonicalModel: "gpt-5.5",
      billingMode: "metered",
      inputTokens: 40,
      outputTokens: 10,
      cacheReadTokens: 5,
      cacheWriteTokens: 2,
      totalCostUsd: 0.01,
      byRoleModel: {},
      timestamp: completedAt,
    };

    const events = appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Measure this turn.",
      assistantMessageContent: "Canonical output.",
      turnOutcome: "completed",
      queued: false,
      turnStartedAt: new Date("2026-06-30T12:00:00.000Z"),
      turnCompletedAt: completedAt,
      continuity: { strategy: "none" },
      runtimeEvents: [costUpdate],
      efficiencyPolicy: {
        owner: "ContextGovernor",
        policyId: "context-segmented-candidate-v2",
        configurationHash: `sha256:${"c".repeat(64)}`,
      },
      lifecycleAttributionEvidence: {
        contextAudit,
        finalOutput: {
          evidenceUri: `kiln://sessions/${session.id}/turns/turn-1/final-output`,
          estimatedTokens: 4,
        },
      },
    });

    const costEvent = events.find((event) => event.kind === "cost_updated");
    const attributionEvent = events.find((event) => event.kind === "lifecycle_attribution_recorded");
    if (costEvent?.kind !== "cost_updated" || attributionEvent?.kind !== "lifecycle_attribution_recorded") {
      throw new Error("Expected cost and lifecycle attribution events.");
    }

    expect(attributionEvent.parentEventId).toBe(costEvent.eventId);
    expect(attributionEvent.ledger.sourceEventId).toBe(costEvent.eventId);
    expect(attributionEvent.ledger.sourceEventSequence).toBe(costEvent.sequence);
    expect(attributionEvent.ledger.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "memory",
        tokenClass: "admitted",
        providerTokenClass: "input",
        tokens: 25,
        quality: "estimated",
        artifactId: "memory-1",
        evidenceUris: ["kiln://memory/nodes/memory-record-1"],
        context: { route: "codex-oauth/gpt-5.5", phase: "memory:unknown" },
      }),
      expect.objectContaining({ source: "unknown", providerTokenClass: "input", tokens: 15, quality: "unknown" }),
      expect.objectContaining({ source: "final_output", providerTokenClass: "output", tokens: 4, quality: "estimated" }),
      expect.objectContaining({ source: "unknown", providerTokenClass: "output", tokens: 6, quality: "unknown" }),
      expect.objectContaining({ source: "unknown", providerTokenClass: "cache_read", tokens: 5, quality: "unknown" }),
      expect.objectContaining({ source: "unknown", providerTokenClass: "cache_write", tokens: 2, quality: "unknown" }),
    ]));

    for (const providerTokenClass of ["input", "output", "cache_read", "cache_write"] as const) {
      const recorded = attributionEvent.ledger.records
        .filter((record) => record.providerTokenClass === providerTokenClass)
        .reduce((sum, record) => sum + record.tokens, 0);
      const expected = {
        input: costEvent.usage.inputTokens,
        output: costEvent.usage.outputTokens,
        cache_read: costEvent.usage.cacheReadTokens,
        cache_write: costEvent.usage.cacheWriteTokens,
      }[providerTokenClass];
      expect(recorded).toBe(expected);
    }
    expect(attributionEvent.summary.totalTokens).toBe(57);
    expect(attributionEvent.summary.totalCostUsd).toBeCloseTo(costEvent.cost.deltaUsd);
    expect(attributionEvent.efficiencyEvidence.policy).toEqual({
      owner: "ContextGovernor",
      policyId: "context-segmented-candidate-v2",
      configurationHash: `sha256:${"c".repeat(64)}`,
    });
    expect(attributionEvent.efficiencyEvidence.totals).toMatchObject({
      providerTotalTokens: 57,
      estimated: { tokens: 29 },
      cached: { tokens: 5 },
      unknown: { tokens: 21 },
      cacheWritten: { tokens: 2 },
      avoided: { tokens: 0 },
    });
    expect(attributionEvent.efficiencyEvidence.outcome).toBe("succeeded");
  });

  it("maps path-like procedural source identity without emitting an invalid evidence URI", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Be useful.",
    });
    const completedAt = new Date("2026-06-30T12:00:01.000Z");
    const events = appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Use the selected skill.",
      assistantMessageContent: "Done.",
      turnOutcome: "completed",
      queued: false,
      turnStartedAt: new Date("2026-06-30T12:00:00.000Z"),
      turnCompletedAt: completedAt,
      continuity: { strategy: "none" },
      runtimeEvents: [{
        type: "cost_update",
        sessionId: session.id,
        provider: "codex-oauth",
        model: "gpt-5.5",
        inputTokens: 10,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: 0,
        byRoleModel: {},
        timestamp: completedAt,
      }],
      lifecycleAttributionEvidence: {
        contextAudit: {
          ...contextAudit,
          selectedBlockIds: ["procedural-path"],
          requiredBlockIds: ["procedural-path"],
          preservedRequiredBlockIds: ["procedural-path"],
          selectedTokens: 10,
          requiredTokens: 10,
          blocks: [{
            id: "procedural-path",
            kind: "procedural",
            source: "runtime-skill:C:/repo/.agents/skills/review/SKILL.md",
            required: true,
            estimatedTokens: 10,
            baseScore: 1,
            effectiveScore: 1,
            decision: "admitted",
            reason: "required-preserved",
            order: 0,
          }],
        },
      },
    });
    const attributionEvent = events.find((event) => event.kind === "lifecycle_attribution_recorded");
    if (attributionEvent?.kind !== "lifecycle_attribution_recorded") throw new Error("Expected attribution event");

    expect(attributionEvent.efficiencyEvidence.evidenceUris).toEqual([]);
    expect(() => toOperatorSessionEventFrame(attributionEvent, {
      eventId: "frame-procedural-path",
      sequence: 1,
    })).not.toThrow();
  });
});
