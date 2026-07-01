import { describe, expect, it } from "vitest";
import {
  projectCostUpdatedEventToLifecycleLedger,
  replayLifecycleAttributionEvidence,
  summarizeLifecycleAttributionLedger,
  type CanonicalCostUpdatedEvent,
  type SessionLifecycleAttributionAllocation,
} from "../../src/events/index.js";

const RECORDED_COST_EVENT: CanonicalCostUpdatedEvent = {
  eventId: "cost-event-recorded-1",
  kilnSessionId: "session-recorded-1",
  sequence: 42,
  timestamp: new Date("2026-06-30T18:30:00.000Z"),
  kind: "cost_updated",
  turnId: "turn-recorded-1",
  provider: {
    provider: "codex-oauth",
    model: "gpt-5.5",
    canonicalModel: "gpt-5.5",
    billingMode: "metered",
    providerRequestId: "provider-request-recorded-1",
  },
  usage: {
    inputTokens: 80,
    outputTokens: 16,
    cacheReadTokens: 24,
    cacheWriteTokens: 8,
  },
  cost: {
    currency: "USD",
    deltaUsd: 0.0192,
    totalUsd: 0.0912,
  },
};

const RECORDED_ALLOCATIONS: readonly SessionLifecycleAttributionAllocation[] = [
  {
    source: "procedural_context",
    tokenClass: "admitted",
    tokens: 48,
    quality: "estimated",
    evidenceUris: ["kiln://context-audit/admission-recorded-1"],
  },
  {
    source: "final_output",
    tokenClass: "generated",
    tokens: 16,
    quality: "provider_reported",
    evidenceUris: ["kiln://session/session-recorded-1/turn/turn-recorded-1/final-output"],
  },
  {
    source: "repository_evidence",
    tokenClass: "cached",
    tokens: 12,
    quality: "estimated",
    evidenceUris: ["kiln://artifact/repository-evidence-recorded-1"],
  },
  {
    source: "memory",
    tokenClass: "cache_written",
    tokens: 3,
    quality: "estimated",
    evidenceUris: ["kiln://memory/recorded-1"],
  },
];

describe("session lifecycle attribution replay", () => {
  it("replays canonical recorded evidence without provider access or retokenization", () => {
    const recordedLedger = projectCostUpdatedEventToLifecycleLedger(RECORDED_COST_EVENT, {
      context: {
        route: "codex-oauth/gpt-5.5",
        workItemId: "work-recorded-1",
        policyVersion: "efficiency-v1",
      },
      allocations: RECORDED_ALLOCATIONS,
    });
    const recordedSummary = summarizeLifecycleAttributionLedger(recordedLedger);
    const replayed = replayLifecycleAttributionEvidence({
      costEvent: RECORDED_COST_EVENT,
      ledger: recordedLedger,
      summary: recordedSummary,
    });

    expect(replayed.ledger).toEqual(recordedLedger);
    expect(replayed.summary).toEqual(recordedSummary);
    expect(replayed.ledger).toMatchObject({
      sourceEventId: "cost-event-recorded-1",
      sourceEventSequence: 42,
      provider: RECORDED_COST_EVENT.provider,
      cost: RECORDED_COST_EVENT.cost,
      context: {
        route: "codex-oauth/gpt-5.5",
        workItemId: "work-recorded-1",
        policyVersion: "efficiency-v1",
      },
    });
    expect(replayed.ledger.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceEventId: "cost-event-recorded-1",
        sourceEventSequence: 42,
        source: "procedural_context",
        quality: "estimated",
        evidenceUris: ["kiln://context-audit/admission-recorded-1"],
      }),
      expect.objectContaining({
        sourceEventId: "cost-event-recorded-1",
        sourceEventSequence: 42,
        source: "unknown",
        providerTokenClass: "input",
        quality: "unknown",
      }),
    ]));
  });
});
