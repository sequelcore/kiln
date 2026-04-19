import { describe, it, expect, vi } from "vitest";
import { textParts } from "@kilnai/core";
import { ModeBSession } from "../../src/session/mode-b-session.js";
import { DefaultAgentHandoffSummarizer } from "../../src/session/support/summarization/agent-handoff-summarizer.js";

function makeSession(): ModeBSession {
  return new ModeBSession({ appName: "test", tenantId: "test-tenant", userId: "user-1", systemPrompt: "test" });
}

function makeProvider() {
  return {
    createMessage: vi.fn().mockResolvedValue({
      parts: [{ type: "text", text: "Summary text" }],
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
    }),
  };
}

describe("DefaultAgentHandoffSummarizer", () => {
  it("generates brief with correct system prompt", async () => {
    const provider = makeProvider();
    const summarizer = new DefaultAgentHandoffSummarizer(provider as any);
    const session = makeSession();
    session.addUserMessage(textParts("Hello"));

    await summarizer.summarize(session, "SalesBot", "SupportBot");

    const call = provider.createMessage.mock.calls[0][0];
    expect(call.system).toContain("SalesBot");
    expect(call.system).toContain("SupportBot");
    expect(call.system).toContain("handoff brief");
  });

  it("passes last 10 messages to provider", async () => {
    const provider = makeProvider();
    const summarizer = new DefaultAgentHandoffSummarizer(provider as any);
    const session = makeSession();

    for (let i = 0; i < 15; i++) {
      session.addUserMessage(textParts(`Message ${i}`));
    }

    await summarizer.summarize(session, "A", "B");

    const call = provider.createMessage.mock.calls[0][0];
    expect(call.messages).toHaveLength(10);
  });

  it("returns empty string for empty history", async () => {
    const provider = makeProvider();
    const summarizer = new DefaultAgentHandoffSummarizer(provider as any);
    const session = makeSession();

    const result = await summarizer.summarize(session, "A", "B");

    expect(result).toBe("");
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("formats response as [Handoff from X]: ...", async () => {
    const provider = makeProvider();
    const summarizer = new DefaultAgentHandoffSummarizer(provider as any);
    const session = makeSession();
    session.addUserMessage(textParts("Help me"));

    const result = await summarizer.summarize(session, "SalesBot", "SupportBot");

    expect(result).toBe("[Handoff from SalesBot]: Summary text");
  });

  it("sets maxTokens to 150", async () => {
    const provider = makeProvider();
    const summarizer = new DefaultAgentHandoffSummarizer(provider as any);
    const session = makeSession();
    session.addUserMessage(textParts("Hello"));

    await summarizer.summarize(session, "A", "B");

    const call = provider.createMessage.mock.calls[0][0];
    expect(call.maxTokens).toBe(150);
  });

  it("produces brief for single message session", async () => {
    const provider = makeProvider();
    const summarizer = new DefaultAgentHandoffSummarizer(provider as any);
    const session = makeSession();
    session.addUserMessage(textParts("I need a refund"));

    const result = await summarizer.summarize(session, "Greeter", "Refunds");

    expect(result).toBe("[Handoff from Greeter]: Summary text");
    const call = provider.createMessage.mock.calls[0][0];
    expect(call.messages).toHaveLength(1);
  });

  it("propagates provider errors for caller to handle", async () => {
    const provider = makeProvider();
    provider.createMessage.mockRejectedValue(new Error("Provider down"));
    const summarizer = new DefaultAgentHandoffSummarizer(provider as any);
    const session = makeSession();
    session.addUserMessage(textParts("Hello"));

    await expect(summarizer.summarize(session, "A", "B")).rejects.toThrow("Provider down");
  });

  it("includes from and to agent names in prompt", async () => {
    const provider = makeProvider();
    const summarizer = new DefaultAgentHandoffSummarizer(provider as any);
    const session = makeSession();
    session.addUserMessage(textParts("Hi"));

    await summarizer.summarize(session, "BillingAgent", "TechSupport");

    const call = provider.createMessage.mock.calls[0][0];
    expect(call.system).toContain('"BillingAgent"');
    expect(call.system).toContain('"TechSupport"');
  });
});
