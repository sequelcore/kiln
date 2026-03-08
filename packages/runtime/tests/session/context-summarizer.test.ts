import { describe, it, expect, vi } from "vitest";
import type { ProviderAdapter } from "@kilnai/core";
import { textParts } from "@kilnai/core";
import { DefaultContextSummarizer } from "../../src/session/context-summarizer.js";
import { ModeBSession } from "../../src/session/mode-b-session.js";

function makeProvider(responseText = "Customer needs help with billing."): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts(responseText),
      inputTokens: 50,
      outputTokens: 30,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeSession(): ModeBSession {
  return new ModeBSession({ appName: "test", tenantId: "test-tenant", userId: "user-1", systemPrompt: "You are helpful." });
}

describe("DefaultContextSummarizer", () => {
  it("calls provider with correct system prompt and recent messages", async () => {
    const provider = makeProvider();
    const summarizer = new DefaultContextSummarizer(provider);
    const session = makeSession();

    session.addUserMessage(textParts("I need help with my bill."));
    session.addAssistantMessage(textParts("Sure, let me look into that."));

    await summarizer.summarize(session);

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(provider.createMessage).mock.calls[0]![0];
    expect(callArgs.system).toBe(
      "Summarize this customer conversation in 1-3 sentences for a human agent. Include: what the customer needs, what has been tried, and the current status.",
    );
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.maxTokens).toBe(200);
  });

  it("returns extracted text from provider response", async () => {
    const provider = makeProvider("Customer asked about billing refund.");
    const summarizer = new DefaultContextSummarizer(provider);
    const session = makeSession();

    session.addUserMessage(textParts("I need a refund."));

    const result = await summarizer.summarize(session);
    expect(result).toBe("Customer asked about billing refund.");
  });

  it("limits to last 10 messages", async () => {
    const provider = makeProvider();
    const summarizer = new DefaultContextSummarizer(provider);
    const session = makeSession();

    // Add 12 messages (6 user + 6 assistant)
    for (let i = 0; i < 6; i++) {
      session.addUserMessage(textParts(`User message ${i}`));
      session.addAssistantMessage(textParts(`Assistant message ${i}`));
    }

    expect(session.conversationHistory.length).toBe(12);

    await summarizer.summarize(session);

    const callArgs = vi.mocked(provider.createMessage).mock.calls[0]![0];
    expect(callArgs.messages).toHaveLength(10);
  });

  it("returns 'No conversation history.' for empty session", async () => {
    const provider = makeProvider();
    const summarizer = new DefaultContextSummarizer(provider);
    const session = makeSession();

    const result = await summarizer.summarize(session);

    expect(result).toBe("No conversation history.");
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("uses maxTokens of 200", async () => {
    const provider = makeProvider();
    const summarizer = new DefaultContextSummarizer(provider);
    const session = makeSession();

    session.addUserMessage(textParts("Hello"));

    await summarizer.summarize(session);

    const callArgs = vi.mocked(provider.createMessage).mock.calls[0]![0];
    expect(callArgs.maxTokens).toBe(200);
  });
});
