import { describe, it, expect, vi } from "vitest";
import { LlmConversationEnricher, deriveSentimentArcPattern } from "../../src/enrichment/enrichment-pipeline.js";
import type { ProviderAdapter, AgentResponse } from "../../src/agents/index.js";
import type { CompletedSession } from "../../src/enrichment/types.js";

function makeProvider(responseText: string): ProviderAdapter {
  return {
    name: "test-provider",
    createMessage: vi.fn().mockResolvedValue({
      parts: [{ type: "text", text: responseText }],
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: "end_turn",
    } satisfies AgentResponse),
    streamMessage: vi.fn(),
  };
}

function makeSession(overrides?: Partial<CompletedSession>): CompletedSession {
  return {
    sessionId: "sess-1",
    tenantId: "tenant-1",
    conversationHistory: [
      { role: "user", content: "Hi, I need help with billing" },
      { role: "assistant", content: "Sure, let me look into that." },
      { role: "user", content: "I was charged twice." },
      { role: "assistant", content: "I see the duplicate charge. I've issued a refund." },
    ],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    closedAt: new Date("2026-01-01T00:05:00Z"),
    closedBy: "resolved",
    escalated: false,
    handoffCount: 0,
    ...overrides,
  };
}

const VALID_LLM_RESPONSE = JSON.stringify({
  summary: "Customer reported a duplicate billing charge. Agent identified the issue and issued a refund.",
  topics: [{ label: "billing", subtopic: "duplicate charge", confidence: 0.95, prominence: 1.0 }],
  topicDrift: false,
  resolution: { status: "resolved", confidence: 0.9, evidence: "Refund was issued" },
  sentimentArc: [
    { turnIndex: 0, polarity: "neutral", score: 0.0 },
    { turnIndex: 2, polarity: "positive", score: 0.5 },
  ],
  overallSentiment: { polarity: "positive", score: 0.4, confidence: 0.8 },
  csatPrediction: { score: 4.2, confidence: 0.7, basis: ["Issue resolved quickly"] },
  agentContributions: [],
  language: "en",
  multilingual: false,
  clarificationRequests: 0,
});

describe("LlmConversationEnricher", () => {
  it("returns minimal enrichment for short conversations (<2 user turns)", async () => {
    const provider = makeProvider(VALID_LLM_RESPONSE);
    const enricher = new LlmConversationEnricher(provider);
    const session = makeSession({
      conversationHistory: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ],
    });

    const result = await enricher.enrich(session);

    expect(result).toBeDefined();
    expect(result!.summary).toBe("");
    expect(result!.topics).toEqual([]);
    expect(result!.resolution.status).toBe("ambiguous");
    expect(result!.sentimentArcPattern).toBe("neutral_throughout");
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("calls provider.createMessage with correct prompt for normal conversations", async () => {
    const provider = makeProvider(VALID_LLM_RESPONSE);
    const enricher = new LlmConversationEnricher(provider);
    const session = makeSession();

    await enricher.enrich(session);

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    const callArgs = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.system).toContain("conversation analyst");
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.messages[0].role).toBe("user");
    expect(callArgs.maxTokens).toBe(1500);
  });

  it("parses LLM JSON response correctly", async () => {
    const provider = makeProvider(VALID_LLM_RESPONSE);
    const enricher = new LlmConversationEnricher(provider);
    const session = makeSession();

    const result = await enricher.enrich(session);

    expect(result).toBeDefined();
    expect(result!.summary).toContain("duplicate billing charge");
    expect(result!.topics).toHaveLength(1);
    expect(result!.topics[0].label).toBe("billing");
    expect(result!.resolution.status).toBe("resolved");
    expect(result!.overallSentiment.polarity).toBe("positive");
    expect(result!.csatPrediction.score).toBe(4.2);
    expect(result!.language).toBe("en");
    expect(result!.sessionId).toBe("sess-1");
    expect(result!.tenantId).toBe("tenant-1");
    expect(result!.turnCount).toBe(4);
    expect(result!.userTurnCount).toBe(2);
    expect(result!.durationMs).toBe(300_000); // 5 minutes
  });

  it("handles code-block-wrapped JSON", async () => {
    const wrappedResponse = "```json\n" + VALID_LLM_RESPONSE + "\n```";
    const provider = makeProvider(wrappedResponse);
    const enricher = new LlmConversationEnricher(provider);

    const result = await enricher.enrich(makeSession());

    expect(result).toBeDefined();
    expect(result!.summary).toContain("duplicate billing charge");
  });

  it("returns minimal enrichment on LLM error", async () => {
    const provider: ProviderAdapter = {
      name: "failing-provider",
      createMessage: vi.fn().mockRejectedValue(new Error("API error")),
      streamMessage: vi.fn(),
    };
    const enricher = new LlmConversationEnricher(provider);

    const result = await enricher.enrich(makeSession());

    expect(result).toBeDefined();
    expect(result!.summary).toBe("");
    expect(result!.resolution.status).toBe("ambiguous");
  });

  it("returns minimal enrichment on invalid JSON from LLM", async () => {
    const provider = makeProvider("This is not valid JSON at all.");
    const enricher = new LlmConversationEnricher(provider);

    const result = await enricher.enrich(makeSession());

    expect(result).toBeDefined();
    expect(result!.summary).toBe("");
  });

  it("builds effort score from components", async () => {
    const provider = makeProvider(VALID_LLM_RESPONSE);
    const enricher = new LlmConversationEnricher(provider);
    const session = makeSession({
      toolExecutions: [
        { toolName: "lookup", success: true },
        { toolName: "refund", success: false },
      ],
      handoffCount: 1,
      escalated: true,
    });

    const result = await enricher.enrich(session);

    expect(result).toBeDefined();
    expect(result!.effortComponents.toolErrors).toBe(1);
    expect(result!.effortComponents.agentHandoffs).toBe(1);
    expect(result!.effortComponents.escalated).toBe(true);
    // 10 - 0 (2 user turns) - 0 (LLM says 0 clarification) - 0.4 (1 tool error) - 0.5 (1 handoff) - 1.5 (escalated) = 7.6
    expect(result!.effortScore).toBe(7.6);
  });

  it("builds agent performance from agent turn history", async () => {
    const responseWithContributions = JSON.stringify({
      ...JSON.parse(VALID_LLM_RESPONSE),
      agentContributions: [
        { agentId: "billing-agent", resolutionContribution: "primary", sentimentDelta: 0.5 },
      ],
    });
    const provider = makeProvider(responseWithContributions);
    const enricher = new LlmConversationEnricher(provider);
    const session = makeSession({
      agentTurnHistory: [
        { agentId: "billing-agent", agentName: "Billing Agent", fromTurn: 0, toTurn: 3 },
      ],
    });

    const result = await enricher.enrich(session);

    expect(result!.agentPerformance).toHaveLength(1);
    expect(result!.agentPerformance[0].agentId).toBe("billing-agent");
    expect(result!.agentPerformance[0].turnsHandled).toBe(4);
    expect(result!.agentPerformance[0].resolutionContribution).toBe("primary");
    expect(result!.agentPerformance[0].sentimentDelta).toBe(0.5);
  });

  it("limits topics to 5", async () => {
    const responseWithManyTopics = JSON.stringify({
      ...JSON.parse(VALID_LLM_RESPONSE),
      topics: Array.from({ length: 8 }, (_, i) => ({
        label: `topic-${i}`,
        confidence: 0.9,
        prominence: 1.0 - i * 0.1,
      })),
    });
    const provider = makeProvider(responseWithManyTopics);
    const enricher = new LlmConversationEnricher(provider);

    const result = await enricher.enrich(makeSession());

    expect(result!.topics).toHaveLength(5);
  });
});

describe("deriveSentimentArcPattern", () => {
  it("returns neutral_throughout for empty arc", () => {
    expect(deriveSentimentArcPattern([])).toBe("neutral_throughout");
  });

  it("returns neutral_throughout for single point", () => {
    expect(deriveSentimentArcPattern([{ score: 0.5 }])).toBe("neutral_throughout");
  });

  it("returns consistently_positive when all scores > 0.1", () => {
    expect(
      deriveSentimentArcPattern([{ score: 0.5 }, { score: 0.8 }, { score: 0.3 }]),
    ).toBe("consistently_positive");
  });

  it("returns consistently_negative when all scores < -0.1", () => {
    expect(
      deriveSentimentArcPattern([{ score: -0.5 }, { score: -0.8 }, { score: -0.3 }]),
    ).toBe("consistently_negative");
  });

  it("returns neutral_throughout when all scores near zero", () => {
    expect(
      deriveSentimentArcPattern([{ score: 0.05 }, { score: -0.05 }, { score: 0.0 }]),
    ).toBe("neutral_throughout");
  });

  it("returns improving when second half is significantly higher", () => {
    expect(
      deriveSentimentArcPattern([
        { score: -0.5 },
        { score: -0.3 },
        { score: 0.2 },
        { score: 0.6 },
      ]),
    ).toBe("improving");
  });

  it("returns declining when second half is significantly lower", () => {
    expect(
      deriveSentimentArcPattern([
        { score: 0.6 },
        { score: 0.4 },
        { score: -0.2 },
        { score: -0.5 },
      ]),
    ).toBe("declining");
  });

  it("returns volatile when scores swing rapidly", () => {
    expect(
      deriveSentimentArcPattern([
        { score: 0.8 },
        { score: -0.8 },
        { score: 0.8 },
        { score: -0.8 },
      ]),
    ).toBe("volatile");
  });
});
