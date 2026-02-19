import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderAdapter } from "@kiln/core";
import { ModeBOrchestrator } from "../../src/session/mode-b-orchestrator.js";
import { ModeBSession } from "../../src/session/mode-b-session.js";

function makeProvider(): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      content: "mock response",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeSession(systemPrompt = "You are helpful."): ModeBSession {
  return new ModeBSession({ appName: "app", userId: "user-1", systemPrompt });
}

describe("ModeBOrchestrator", () => {
  describe("constructor", () => {
    it("creates orchestrator with mock provider", () => {
      const provider = makeProvider();
      const orchestrator = new ModeBOrchestrator({ provider });
      expect(orchestrator).toBeDefined();
    });
  });

  describe("processMessage", () => {
    let provider: ProviderAdapter;
    let orchestrator: ModeBOrchestrator;

    beforeEach(() => {
      provider = makeProvider();
      orchestrator = new ModeBOrchestrator({ provider });
    });

    it("adds user message to session", async () => {
      const session = makeSession();
      await orchestrator.processMessage(session, "hello");
      const history = session.conversationHistory;
      expect(history[0]).toEqual({ role: "user", content: "hello" });
    });

    it("adds assistant response to session after call", async () => {
      const session = makeSession();
      await orchestrator.processMessage(session, "hello");
      expect(session.messageCount).toBe(2);
      expect(session.conversationHistory[1]).toEqual({
        role: "assistant",
        content: "mock response",
      });
    });

    it("builds correct system prompt from session", async () => {
      const session = makeSession("You are a coding assistant.");
      await orchestrator.processMessage(session, "help me");
      expect(provider.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ system: "You are a coding assistant." }),
      );
    });

    it("appends recalled memory to system prompt", async () => {
      const session = makeSession("Base prompt.");
      await orchestrator.processMessage(session, "help", "some memory content");
      expect(provider.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "Base prompt.\n\n--- Recalled Memory ---\nsome memory content",
        }),
      );
    });

    it("does not append recalled memory section when not provided", async () => {
      const session = makeSession("Base prompt.");
      await orchestrator.processMessage(session, "help");
      const callArgs = vi.mocked(provider.createMessage).mock.calls[0][0];
      expect(callArgs.system).toBe("Base prompt.");
    });

    it("returns token counts from provider response", async () => {
      const session = makeSession();
      const result = await orchestrator.processMessage(session, "hello");
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.cacheReadTokens).toBe(0);
      expect(result.cacheWriteTokens).toBe(0);
    });

    it("returns content from provider response", async () => {
      const session = makeSession();
      const result = await orchestrator.processMessage(session, "hello");
      expect(result.content).toBe("mock response");
    });

    it("accumulates conversation history across multiple calls", async () => {
      const session = makeSession();
      await orchestrator.processMessage(session, "first message");
      await orchestrator.processMessage(session, "second message");
      expect(session.messageCount).toBe(4);
      expect(session.conversationHistory[0]).toEqual({ role: "user", content: "first message" });
      expect(session.conversationHistory[1]).toEqual({ role: "assistant", content: "mock response" });
      expect(session.conversationHistory[2]).toEqual({ role: "user", content: "second message" });
      expect(session.conversationHistory[3]).toEqual({ role: "assistant", content: "mock response" });
    });

    it("uses session systemPrompt as system parameter", async () => {
      const session = makeSession("custom system prompt");
      await orchestrator.processMessage(session, "msg");
      expect(provider.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ system: "custom system prompt" }),
      );
    });

    it("passes maxTokens to provider when configured", async () => {
      const orchWithTokens = new ModeBOrchestrator({ provider, maxTokens: 1024 });
      const session = makeSession();
      await orchWithTokens.processMessage(session, "msg");
      expect(provider.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: 1024 }),
      );
    });
  });
});
