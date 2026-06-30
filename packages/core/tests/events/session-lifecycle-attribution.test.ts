import { describe, expect, it } from "vitest";
import {
  projectCostUpdatedEventToLifecycleLedger,
  summarizeLifecycleAttributionLedger,
  type CanonicalCostUpdatedEvent,
} from "../../src/events/index.js";

const COST_EVENT: CanonicalCostUpdatedEvent = {
  eventId: "event-1",
  kilnSessionId: "session-1",
  sequence: 7,
  timestamp: new Date("2026-06-30T12:00:00.000Z"),
  kind: "cost_updated",
  turnId: "turn-1",
  provider: {
    provider: "codex-oauth",
    model: "gpt-5.5",
    canonicalModel: "gpt-5.5",
    billingMode: "metered",
    providerRequestId: "request-1",
  },
  usage: {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 10,
  },
  cost: {
    currency: "USD",
    deltaUsd: 0.0123,
    totalUsd: 0.0456,
  },
};

describe("session lifecycle attribution", () => {
  it("projects provider usage into explicit unknown lifecycle records", () => {
    const ledger = projectCostUpdatedEventToLifecycleLedger(COST_EVENT);

    expect(ledger).toMatchObject({
      sessionId: "session-1",
      turnId: "turn-1",
      sourceEventId: "event-1",
      sourceEventSequence: 7,
      provider: COST_EVENT.provider,
      usage: COST_EVENT.usage,
      cost: COST_EVENT.cost,
      context: {},
    });
    expect(ledger.records).toEqual([
      expect.objectContaining({ source: "unknown", tokenClass: "raw", providerTokenClass: "input", tokens: 100 }),
      expect.objectContaining({ source: "unknown", tokenClass: "generated", providerTokenClass: "output", tokens: 20 }),
      expect.objectContaining({ source: "unknown", tokenClass: "cached", providerTokenClass: "cache_read", tokens: 30 }),
      expect.objectContaining({ source: "unknown", tokenClass: "cache_written", providerTokenClass: "cache_write", tokens: 10 }),
    ]);
  });

  it("preserves source allocations and attributes under-allocation to unknown", () => {
    const ledger = projectCostUpdatedEventToLifecycleLedger(COST_EVENT, {
      context: {
        workItemId: "work-1",
        parentLedgerId: "ledger-parent-1",
        parentEventId: "event-parent-1",
        parentTurnId: "turn-parent-1",
        taskClass: "research",
        phase: "planning",
        policyVersion: "efficiency-v1",
        route: "codex-oauth/gpt-5.5",
        reasoningEffort: "high",
      },
      allocations: [
        { source: "control_instructions", tokenClass: "admitted", tokens: 40, evidenceUris: ["kiln://artifact/policy"] },
        { source: "tool_schema", tokenClass: "raw", tokens: 25 },
        { source: "coordination", tokenClass: "deferred", tokens: 10 },
        { source: "verification", tokenClass: "estimated_reasoning", tokens: 5 },
        { source: "repository_evidence", tokenClass: "cached", tokens: 15 },
        { source: "final_output", tokenClass: "generated", tokens: 20 },
      ],
    });

    expect(ledger.context).toMatchObject({
      workItemId: "work-1",
      parentLedgerId: "ledger-parent-1",
      parentEventId: "event-parent-1",
      parentTurnId: "turn-parent-1",
      taskClass: "research",
      phase: "planning",
      policyVersion: "efficiency-v1",
      route: "codex-oauth/gpt-5.5",
      reasoningEffort: "high",
    });
    expect(ledger.records).toEqual([
      expect.objectContaining({
        source: "control_instructions",
        tokenClass: "admitted",
        providerTokenClass: "input",
        tokens: 40,
        cost: expect.objectContaining({
          currency: "USD",
          quality: "estimated",
        }),
        context: expect.objectContaining({
          workItemId: "work-1",
          route: "codex-oauth/gpt-5.5",
          reasoningEffort: "high",
        }),
        evidenceUris: ["kiln://artifact/policy"],
      }),
      expect.objectContaining({ source: "tool_schema", tokenClass: "raw", providerTokenClass: "input", tokens: 25 }),
      expect.objectContaining({ source: "coordination", tokenClass: "deferred", providerTokenClass: "input", tokens: 10 }),
      expect.objectContaining({ source: "verification", tokenClass: "estimated_reasoning", providerTokenClass: "input", tokens: 5 }),
      expect.objectContaining({ source: "unknown", tokenClass: "raw", providerTokenClass: "input", tokens: 20 }),
      expect.objectContaining({ source: "final_output", tokenClass: "generated", providerTokenClass: "output", tokens: 20 }),
      expect.objectContaining({ source: "repository_evidence", tokenClass: "cached", providerTokenClass: "cache_read", tokens: 15 }),
      expect.objectContaining({ source: "unknown", tokenClass: "cached", providerTokenClass: "cache_read", tokens: 15 }),
      expect.objectContaining({ source: "unknown", tokenClass: "cache_written", providerTokenClass: "cache_write", tokens: 10 }),
    ]);
    expect(ledger.records[0]?.cost.deltaUsd).toBeCloseTo(0.003075);
    const summary = summarizeLifecycleAttributionLedger(ledger);
    expect(summary).toMatchObject({
      byTokenClass: {
        raw: 45,
        admitted: 40,
        deferred: 10,
        cached: 30,
        cache_written: 10,
        generated: 20,
        estimated_reasoning: 5,
      },
      bySource: {
        coordination: 10,
        control_instructions: 40,
        final_output: 20,
        repository_evidence: 15,
        tool_schema: 25,
        unknown: 45,
        verification: 5,
      },
      totalTokens: 160,
    });
    expect(summary.totalCostUsd).toBeCloseTo(0.0123);
    expect(summary.bySourceCostUsd.control_instructions).toBeCloseTo(0.003075);
  });

  it("rejects source allocations that exceed provider-reported usage", () => {
    expect(() => projectCostUpdatedEventToLifecycleLedger(COST_EVENT, {
      allocations: [
        { source: "control_instructions", tokenClass: "raw", tokens: 101 },
      ],
    })).toThrow("Lifecycle attribution for input exceeds provider-reported usage");
  });

  it("rejects allocations when provider reported zero usage for the token class", () => {
    const zeroCacheWriteEvent: CanonicalCostUpdatedEvent = {
      ...COST_EVENT,
      usage: {
        ...COST_EVENT.usage,
        cacheWriteTokens: 0,
      },
    };

    expect(() => projectCostUpdatedEventToLifecycleLedger(zeroCacheWriteEvent, {
      allocations: [
        { source: "verification", tokenClass: "cache_written", tokens: 1 },
      ],
    })).toThrow("Lifecycle attribution for cache_write exceeds provider-reported usage");
  });

  it("uses explicit cost quality when record quality is omitted", () => {
    const ledger = projectCostUpdatedEventToLifecycleLedger(COST_EVENT, {
      allocations: [
        {
          source: "final_output",
          tokenClass: "generated",
          tokens: 20,
          cost: {
            currency: "USD",
            deltaUsd: 0.004,
            quality: "provider_reported",
          },
        },
      ],
    });

    const outputRecord = ledger.records.find((record) => record.source === "final_output");
    expect(outputRecord).toMatchObject({
      source: "final_output",
      tokenClass: "generated",
      providerTokenClass: "output",
      quality: "provider_reported",
      cost: {
        currency: "USD",
        deltaUsd: 0.004,
        quality: "provider_reported",
      },
    });
    expect(summarizeLifecycleAttributionLedger(ledger).totalCostUsd).toBeCloseTo(0.0123);
  });

  it("rejects explicit source costs that exceed provider-reported cost", () => {
    expect(() => projectCostUpdatedEventToLifecycleLedger(COST_EVENT, {
      allocations: [
        {
          source: "final_output",
          tokenClass: "generated",
          tokens: 20,
          cost: {
            currency: "USD",
            deltaUsd: 1,
            quality: "provider_reported",
          },
        },
      ],
    })).toThrow("Lifecycle attribution cost exceeds provider-reported cost");
  });

  it("rejects incompatible lifecycle and provider token class pairs", () => {
    expect(() => projectCostUpdatedEventToLifecycleLedger(COST_EVENT, {
      allocations: [
        {
          source: "final_output",
          tokenClass: "generated",
          providerTokenClass: "input",
          tokens: 20,
        },
      ],
    })).toThrow("Lifecycle token class generated cannot use provider token class input");
  });
});
