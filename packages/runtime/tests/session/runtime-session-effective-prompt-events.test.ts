import { describe, expect, it } from "vitest";
import type { ProviderRequestEvidence } from "@kilnai/core/events";
import { appendCanonicalTurnEvents } from "../../src/session/runtime-session-event-ledger.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { toOperatorSessionEventFrame } from "../../src/gateway/operator-session-event-frame.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

const providerRequest: ProviderRequestEvidence = {
  requestIndex: 0,
  providerId: "codex-oauth",
  modelId: "gpt-5.6-sol",
  inputTokens: 3,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cumulativeInputTokens: 3,
  cumulativeOutputTokens: 2,
  cumulativeCacheReadTokens: 0,
  cumulativeCacheWriteTokens: 0,
  systemBytes: 3,
  messageBytes: 2,
  toolSchemaBytes: 0,
  systemHash: hash("1"),
  messageHash: hash("2"),
  toolSchemaHash: hash("3"),
  stablePrefixHash: hash("4"),
  stablePrefixBytes: 3,
  stablePrefixRegionCount: 1,
  volatileRegionBytes: 2,
  cacheRegions: [],
  cachePartition: { hash: hash("cache-partition"), dimensions: [] },
  toolCount: 0,
  effectivePrompt: {
    version: "v1",
    components: [{
      id: hash("5"),
      revision: hash("6"),
      scope: "static",
      estimatedTokens: 3,
      provenance: { source: hash("7") },
    }],
    finalPromptHash: hash("8"),
    estimatedTokens: 3,
  },
};

describe("runtime final effective prompt observation", () => {
  it("appends exactly one observation before turn completion", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Private system prompt.",
    });

    const events = appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Private user message.",
      assistantMessageContent: "Done.",
      queued: false,
      turnOutcome: "completed",
      turnStartedAt: new Date("2026-08-13T00:00:00.000Z"),
      turnCompletedAt: new Date("2026-08-13T00:00:01.000Z"),
      continuity: { strategy: "none" },
      runtimeEvents: [],
      providerRequests: [providerRequest],
    });

    const observed = events.filter((event) => event.kind === "effective_prompt_observed");
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      effectivePrompt: {
        requestIndex: 0,
        providerId: "codex-oauth",
        modelId: "gpt-5.6-sol",
        finalPromptHash: hash("8"),
      },
    });
    expect(events.findIndex((event) => event.kind === "effective_prompt_observed"))
      .toBeLessThan(events.findIndex((event) => event.kind === "turn_completed"));
    expect(JSON.stringify(observed)).not.toContain("Private");
    const frame = toOperatorSessionEventFrame(observed[0]!, { eventId: "wire-1", sequence: 1 });
    expect(frame.event.payload.effectivePrompt).toMatchObject({
      providerId: "codex-oauth",
      finalPromptHash: hash("8"),
    });
  });
});
