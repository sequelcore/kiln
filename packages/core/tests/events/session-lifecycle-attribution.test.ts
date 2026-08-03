import { describe, expect, it } from "vitest";
import {
  projectCostUpdatedEventToLifecycleLedger,
  projectManagedAgentCoordinationUsageAllocations,
  projectVerificationUsageAllocations,
  reconcileLifecycleAttributionLedger,
  summarizeLifecycleAttributionLedger,
  type CanonicalCostUpdatedEvent,
  type SessionLifecycleAttributionLedger,
} from "../../src/events/index.js";
import {
  KNOWN_DELIBERATION_LEVEL_IDS,
  type DeliberationResolution,
} from "../../src/agents/deliberation-policy.js";

const HIGH_DELIBERATION: DeliberationResolution = {
  status: "exact",
  requested: {
    mode: "fixed",
    preferredLevel: KNOWN_DELIBERATION_LEVEL_IDS.high,
    onUnsupported: "deny",
  },
  selectedLevel: KNOWN_DELIBERATION_LEVEL_IDS.high,
  source: "task",
  capabilityEvidence: {
    sourceIdentity: "fixture-catalog",
    sourceRevision: "1",
    observedAt: "2026-08-02T00:00:00.000Z",
  },
};

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

function createCanonicalLedger(): SessionLifecycleAttributionLedger {
  return projectCostUpdatedEventToLifecycleLedger(COST_EVENT, {
    context: { route: "codex-oauth/gpt-5.5" },
    allocations: [
      {
        source: "control_instructions",
        tokenClass: "admitted",
        tokens: 60,
        quality: "estimated",
        evidenceUris: ["kiln://context-audit/admission-1"],
      },
      {
        source: "final_output",
        tokenClass: "generated",
        tokens: 20,
        quality: "provider_reported",
        evidenceUris: ["kiln://session/session-1/turn/turn-1/final-output"],
      },
      {
        source: "repository_evidence",
        tokenClass: "cached",
        tokens: 10,
        quality: "estimated",
        evidenceUris: ["kiln://artifact/repository-evidence-1"],
      },
      {
        source: "procedural_context",
        tokenClass: "cache_written",
        tokens: 4,
        quality: "estimated",
        evidenceUris: ["kiln://context-audit/cache-write-1"],
      },
    ],
  });
}

describe("session lifecycle attribution", () => {
  it("projects verifier usage independently from final output generation", () => {
    const allocations = projectVerificationUsageAllocations({
      version: "verification-usage-v1",
      attempts: [{
        requirementId: "schema",
        method: "deterministic",
        status: "passed",
        providerTokenClass: "input",
        tokens: { value: 12, source: "estimated" },
        costUsd: { value: 0, source: "estimated" },
        latencyMs: { value: 5, source: "estimated" },
        evidenceUris: ["kiln://artifacts/run/schema/content"],
      }],
      totals: { tokens: 12, costUsd: 0, latencyMs: 5 },
    });

    expect(allocations).toEqual([{
      source: "verification",
      tokenClass: "admitted",
      providerTokenClass: "input",
      tokens: 12,
      quality: "estimated",
      context: { phase: "deterministic", policyVersion: "verification-usage-v1" },
      evidenceUris: ["kiln://artifacts/run/schema/content"],
    }]);
    expect(allocations[0]?.source).not.toBe("final_output");
  });

  describe("canonical reconciliation", () => {
    it("preserves cost-only provider evidence as explicit unknown attribution", () => {
      const costOnlyEvent: CanonicalCostUpdatedEvent = {
        ...COST_EVENT,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      };

      const ledger = projectCostUpdatedEventToLifecycleLedger(costOnlyEvent);
      const reconciled = reconcileLifecycleAttributionLedger(costOnlyEvent, ledger);

      expect(ledger.records).toEqual([expect.objectContaining({
        source: "unknown",
        tokenClass: "raw",
        providerTokenClass: "input",
        tokens: 0,
        quality: "unknown",
        cost: {
          currency: "USD",
          deltaUsd: COST_EVENT.cost.deltaUsd,
          quality: "unknown",
        },
      })]);
      expect(reconciled.providerTotals).toEqual({ input: 0, output: 0, cache_read: 0, cache_write: 0 });
      expect(reconciled.summary).toMatchObject({ totalTokens: 0, totalCostUsd: COST_EVENT.cost.deltaUsd });
    });

    it("reconciles all provider token classes while preserving estimated evidence and unknown remainders", () => {
      const ledger = createCanonicalLedger();

      const result = reconcileLifecycleAttributionLedger(COST_EVENT, ledger);

      expect(result.ledger).toEqual(ledger);
      expect(result.summary).toEqual(summarizeLifecycleAttributionLedger(ledger));
      expect(result.providerTotals).toEqual({
        input: 100,
        output: 20,
        cache_read: 30,
        cache_write: 10,
      });
      expect(result.ledger.records).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: "control_instructions",
          providerTokenClass: "input",
          tokens: 60,
          quality: "estimated",
          evidenceUris: ["kiln://context-audit/admission-1"],
        }),
        expect.objectContaining({
          source: "unknown",
          providerTokenClass: "input",
          tokens: 40,
          quality: "unknown",
        }),
        expect.objectContaining({
          source: "unknown",
          providerTokenClass: "cache_read",
          tokens: 20,
          quality: "unknown",
        }),
        expect.objectContaining({
          source: "unknown",
          providerTokenClass: "cache_write",
          tokens: 6,
          quality: "unknown",
        }),
      ]));
      expect(result.summary.totalTokens).toBe(160);
      expect(result.summary.totalCostUsd).toBeCloseTo(COST_EVENT.cost.deltaUsd);
    });

    const invalidFixtures: readonly {
      readonly name: string;
      readonly mutate: (ledger: SessionLifecycleAttributionLedger) => SessionLifecycleAttributionLedger;
      readonly error: string;
    }[] = [
      {
        name: "duplicate record",
        mutate: (ledger) => ({ ...ledger, records: [...ledger.records, ledger.records[0]!] }),
        error: "duplicate",
      },
      {
        name: "missing record",
        mutate: (ledger) => ({ ...ledger, records: ledger.records.slice(1) }),
        error: "provider-total mismatch",
      },
      {
        name: "reordered record",
        mutate: (ledger) => ({ ...ledger, records: [ledger.records[1]!, ledger.records[0]!, ...ledger.records.slice(2)] }),
        error: "record order mismatch",
      },
      {
        name: "over-allocated record",
        mutate: (ledger) => ({
          ...ledger,
          records: ledger.records.map((record, index) => index === 0 ? { ...record, tokens: 101 } : record),
        }),
        error: "allocation overflow",
      },
    ];

    it.each(invalidFixtures)("rejects $name deterministically", ({ mutate, error }) => {
      expect(() => reconcileLifecycleAttributionLedger(COST_EVENT, mutate(createCanonicalLedger()))).toThrow(error);
    });
  });

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
        deliberationResolution: HIGH_DELIBERATION,
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
      deliberationResolution: HIGH_DELIBERATION,
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
          deliberationResolution: HIGH_DELIBERATION,
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

  it("clamps estimated over-allocation without erasing admitted source attribution", () => {
    const ledger = projectCostUpdatedEventToLifecycleLedger(COST_EVENT, {
      context: { route: "codex-oauth/gpt-5.5" },
      allocations: [
        { source: "control_instructions", tokenClass: "raw", tokens: 101, quality: "estimated" },
        { source: "final_output", tokenClass: "generated", tokens: 21, quality: "estimated" },
      ],
    });

    expect(ledger.records).toEqual([
      expect.objectContaining({
        source: "control_instructions",
        tokenClass: "raw",
        providerTokenClass: "input",
        tokens: 100,
        quality: "estimated",
        context: { route: "codex-oauth/gpt-5.5" },
        evidenceUris: [],
      }),
      expect.objectContaining({
        source: "final_output",
        tokenClass: "generated",
        providerTokenClass: "output",
        tokens: 20,
        quality: "estimated",
        context: { route: "codex-oauth/gpt-5.5" },
        evidenceUris: [],
      }),
      expect.objectContaining({ source: "unknown", providerTokenClass: "cache_read", tokens: 30 }),
      expect.objectContaining({ source: "unknown", providerTokenClass: "cache_write", tokens: 10 }),
    ]);
    expect(reconcileLifecycleAttributionLedger(COST_EVENT, ledger).summary.totalTokens).toBe(160);
  });

  it("recomputes explicit estimated costs when clamping estimated token overflow", () => {
    const ledger = projectCostUpdatedEventToLifecycleLedger(COST_EVENT, {
      allocations: [
        {
          source: "final_output",
          tokenClass: "generated",
          tokens: 30,
          quality: "estimated",
          cost: {
            currency: "USD",
            deltaUsd: 99,
            quality: "estimated",
          },
        },
      ],
    });

    const outputRecord = ledger.records.find((record) => record.providerTokenClass === "output");
    expect(outputRecord).toMatchObject({
      source: "final_output",
      tokens: 20,
      quality: "estimated",
      cost: {
        currency: "USD",
        quality: "estimated",
      },
    });
    expect(outputRecord?.cost.deltaUsd).not.toBe(99);
    expect(reconcileLifecycleAttributionLedger(COST_EVENT, ledger).summary.totalCostUsd).toBeCloseTo(0.0123);
  });

  it("rejects provider-reported source allocations that exceed provider-reported usage", () => {
    expect(() => projectCostUpdatedEventToLifecycleLedger(COST_EVENT, {
      allocations: [
        { source: "control_instructions", tokenClass: "raw", tokens: 101, quality: "provider_reported" },
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
        { source: "verification", tokenClass: "cache_written", tokens: 1, quality: "provider_reported" },
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

  it("projects known managed coordination stages into worker-scoped ledger allocations", () => {
    const allocations = projectManagedAgentCoordinationUsageAllocations({
      version: "managed-agent-coordination-usage-v1",
      workerId: "child-1",
      coverage: "partial",
      reconciliation: "components-may-overlap",
      components: [
        {
          stage: "parent_prompt",
          providerTokenClass: "input",
          tokens: { value: 10, source: "estimated" },
          costUsd: { value: "unknown", source: "unknown" },
          latencyMs: { value: "unknown", source: "unknown" },
          turns: { value: 1, source: "estimated" },
          evidenceUris: ["kiln://artifacts/context/source/content"],
        },
        ...(["child_bootstrap", "duplicated_reads", "handoff", "review", "synthesis"] as const).map((stage) => ({
          stage,
          providerTokenClass: stage === "handoff" || stage === "synthesis" ? "output" as const : "input" as const,
          tokens: { value: "unknown" as const, source: "unknown" as const },
          costUsd: { value: "unknown" as const, source: "unknown" as const },
          latencyMs: { value: "unknown" as const, source: "unknown" as const },
          turns: { value: "unknown" as const, source: "unknown" as const },
          evidenceUris: [],
        })),
      ],
    });

    expect(allocations).toEqual([{
      source: "coordination",
      tokenClass: "admitted",
      providerTokenClass: "input",
      tokens: 10,
      quality: "estimated",
      context: {
        phase: "parent_prompt",
        policyVersion: "managed-agent-coordination-usage-v1",
      },
      evidenceUris: ["kiln://artifacts/context/source/content"],
      workerId: "child-1",
    }]);
  });
});
