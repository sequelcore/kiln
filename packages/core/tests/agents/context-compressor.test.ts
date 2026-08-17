import { describe, it, expect } from "vitest";
import { compressContext } from "../../src/agents/context-compressor.js";
import type { ProviderAdapter, CreateMessageOptions, AgentResponse, AgentStreamEvent } from "../../src/agents/index.js";
import { textParts } from "../../src/engine/domain/content.js";

function makeProvider(response: string): ProviderAdapter & { lastCall: CreateMessageOptions | null } {
  const provider: ProviderAdapter & { lastCall: CreateMessageOptions | null } = {
    name: "mock",
    lastCall: null,
    async createMessage(options: CreateMessageOptions): Promise<AgentResponse> {
      provider.lastCall = options;
      return {
        parts: textParts(response),
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "stop",
      };
    },
    async *streamMessage(): AsyncGenerator<AgentStreamEvent> {
      yield { type: "done", content: "" };
    },
  };
  return provider;
}

describe("compressContext", () => {
  it("returns original text when under threshold", async () => {
    const provider = makeProvider("compressed");
    const result = await compressContext("short text", provider);
    expect(result).toBe("short text");
    expect(provider.lastCall).toBeNull();
  });

  it("calls provider when text exceeds threshold", async () => {
    const provider = makeProvider("compressed output");
    const longText = "x".repeat(2001);
    const result = await compressContext(longText, provider);
    expect(result).toBe("compressed output");
    expect(provider.lastCall).not.toBeNull();
  });

  it("respects custom maxChars", async () => {
    const provider = makeProvider("compressed");
    const result = await compressContext("12345", provider, { maxChars: 3 });
    expect(result).toBe("compressed");
    expect(provider.lastCall).not.toBeNull();
  });

  it("passes custom system prompt to provider", async () => {
    const provider = makeProvider("compressed");
    await compressContext("x".repeat(100), provider, {
      maxChars: 10,
      system: "Custom prompt",
    });
    expect(provider.lastCall!.system).toBe("Custom prompt");
  });
});
