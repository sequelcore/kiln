import { describe, it, expect, vi } from "vitest";
import { GroundingRail } from "../../src/safety/grounding-rail.js";
import type { ProviderAdapter, AgentResponse } from "../../src/agents/index.js";
import { textParts } from "../../src/engine/domain/content.js";

function mockProvider(response: string, name = "test-provider"): ProviderAdapter {
  return {
    name,
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts(response),
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: "stop",
    } satisfies AgentResponse),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

describe("GroundingRail", () => {
  const rail = new GroundingRail();
  const chunks = ["The product costs $30.", "Shipping is free over $50."];
  const response = "The product costs $30 and shipping is free over $50.";

  it("returns grounded:true with confidence:1 for empty response", async () => {
    const provider = mockProvider("ignored");
    const result = await rail.evaluate("", chunks, provider);
    expect(result).toEqual({ grounded: true, confidence: 1, ungroundedClaims: [], durationMs: 0, model: "none" });
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("returns grounded:true with confidence:1 for empty chunks", async () => {
    const provider = mockProvider("ignored");
    const result = await rail.evaluate(response, [], provider);
    expect(result).toEqual({ grounded: true, confidence: 1, ungroundedClaims: [], durationMs: 0, model: "none" });
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("returns grounded result when judge says grounded", async () => {
    const provider = mockProvider(JSON.stringify({ grounded: true, confidence: 0.95, ungroundedClaims: [] }));
    const result = await rail.evaluate(response, chunks, provider);
    expect(result.grounded).toBe(true);
    expect(result.confidence).toBe(0.95);
    expect(result.ungroundedClaims).toEqual([]);
  });

  it("returns ungrounded result with claims", async () => {
    const provider = mockProvider(
      JSON.stringify({ grounded: false, confidence: 0.3, ungroundedClaims: ["The product costs $50"] }),
    );
    const result = await rail.evaluate("The product costs $50.", chunks, provider);
    expect(result.grounded).toBe(false);
    expect(result.confidence).toBe(0.3);
    expect(result.ungroundedClaims).toEqual(["The product costs $50"]);
  });

  it("parses JSON from wrapped text via regex fallback", async () => {
    const wrapped = `Here is my analysis: {"grounded": true, "confidence": 0.8, "ungroundedClaims": []}`;
    const provider = mockProvider(wrapped);
    const result = await rail.evaluate(response, chunks, provider);
    expect(result.grounded).toBe(true);
    expect(result.confidence).toBe(0.8);
    expect(result.ungroundedClaims).toEqual([]);
  });

  it("returns fail-open result when JSON is completely unparseable", async () => {
    const provider = mockProvider("I cannot evaluate this");
    const result = await rail.evaluate(response, chunks, provider);
    expect(result.grounded).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.ungroundedClaims).toEqual([]);
  });

  it("propagates provider errors", async () => {
    const provider: ProviderAdapter = {
      name: "failing",
      createMessage: vi.fn().mockRejectedValue(new Error("Provider unavailable")),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    await expect(rail.evaluate(response, chunks, provider)).rejects.toThrow("Provider unavailable");
  });

  it("passes correct structure to provider", async () => {
    const provider = mockProvider(JSON.stringify({ grounded: true, confidence: 1, ungroundedClaims: [] }));
    await rail.evaluate(response, chunks, provider);

    expect(provider.createMessage).toHaveBeenCalledOnce();
    const call = vi.mocked(provider.createMessage).mock.calls[0]![0];

    expect(typeof call.system).toBe("string");
    expect(call.system).toContain("factual accuracy verifier");
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0]!.role).toBe("user");

    const userText = call.messages[0]!.parts[0];
    expect(userText).toMatchObject({ type: "text" });

    const text = (userText as { type: "text"; text: string }).text;
    expect(text).toContain("Reference Chunks:");
    expect(text).toContain("[1] The product costs $30.");
    expect(text).toContain("[2] Shipping is free over $50.");
    expect(text).toContain("AI Response:");
    expect(text).toContain(response);

    expect(call.outputSchema).toBeDefined();
    expect(call.maxTokens).toBe(512);
  });

  it("uses provider name as model when model param not provided", async () => {
    const provider = mockProvider(JSON.stringify({ grounded: true, confidence: 1, ungroundedClaims: [] }), "anthropic");
    const result = await rail.evaluate(response, chunks, provider);
    expect(result.model).toBe("anthropic");
  });

  it("uses explicit model when provided", async () => {
    const provider = mockProvider(JSON.stringify({ grounded: true, confidence: 1, ungroundedClaims: [] }));
    const result = await rail.evaluate(response, chunks, provider, "gpt-4o-mini");
    expect(result.model).toBe("gpt-4o-mini");
  });

  it("measures duration", async () => {
    const provider = mockProvider(JSON.stringify({ grounded: true, confidence: 1, ungroundedClaims: [] }));
    const result = await rail.evaluate(response, chunks, provider);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
