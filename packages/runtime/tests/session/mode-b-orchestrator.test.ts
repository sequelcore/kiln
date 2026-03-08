import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderAdapter } from "@kilnai/core";
import { textParts, extractText } from "@kilnai/core";
import { ModeBOrchestrator } from "../../src/session/mode-b-orchestrator.js";
import { ModeBSession } from "../../src/session/mode-b-session.js";
import type { EscalationDetector } from "../../src/session/escalation-detector.js";
import type { ContextSummarizer } from "../../src/session/context-summarizer.js";

function makeProvider(): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts("mock response"),
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
  return new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "user-1", systemPrompt });
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
      await orchestrator.processMessage(session, textParts("hello"));
      const history = session.conversationHistory;
      expect(history[0]).toEqual({ role: "user", parts: textParts("hello") });
    });

    it("adds assistant response to session after call", async () => {
      const session = makeSession();
      await orchestrator.processMessage(session, textParts("hello"));
      expect(session.messageCount).toBe(2);
      expect(session.conversationHistory[1]).toEqual({
        role: "assistant",
        parts: textParts("mock response"),
      });
    });

    it("builds correct system prompt from session", async () => {
      const session = makeSession("You are a coding assistant.");
      await orchestrator.processMessage(session, textParts("help me"));
      expect(provider.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ system: "You are a coding assistant." }),
      );
    });

    it("appends recalled memory to system prompt", async () => {
      const session = makeSession("Base prompt.");
      await orchestrator.processMessage(session, textParts("help"), "some memory content");
      expect(provider.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "Base prompt.\n\n--- Recalled Memory ---\nsome memory content",
        }),
      );
    });

    it("does not append recalled memory section when not provided", async () => {
      const session = makeSession("Base prompt.");
      await orchestrator.processMessage(session, textParts("help"));
      const callArgs = vi.mocked(provider.createMessage).mock.calls[0][0];
      expect(callArgs.system).toBe("Base prompt.");
    });

    it("returns token counts from provider response", async () => {
      const session = makeSession();
      const result = await orchestrator.processMessage(session, textParts("hello"));
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.cacheReadTokens).toBe(0);
      expect(result.cacheWriteTokens).toBe(0);
    });

    it("returns parts from provider response", async () => {
      const session = makeSession();
      const result = await orchestrator.processMessage(session, textParts("hello"));
      expect(extractText(result.parts)).toBe("mock response");
    });

    it("accumulates conversation history across multiple calls", async () => {
      const session = makeSession();
      await orchestrator.processMessage(session, textParts("first message"));
      await orchestrator.processMessage(session, textParts("second message"));
      expect(session.messageCount).toBe(4);
      expect(session.conversationHistory[0]).toEqual({ role: "user", parts: textParts("first message") });
      expect(session.conversationHistory[1]).toEqual({ role: "assistant", parts: textParts("mock response") });
      expect(session.conversationHistory[2]).toEqual({ role: "user", parts: textParts("second message") });
      expect(session.conversationHistory[3]).toEqual({ role: "assistant", parts: textParts("mock response") });
    });

    it("uses session systemPrompt as system parameter", async () => {
      const session = makeSession("custom system prompt");
      await orchestrator.processMessage(session, textParts("msg"));
      expect(provider.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ system: "custom system prompt" }),
      );
    });

    it("passes maxTokens to provider when configured", async () => {
      const orchWithTokens = new ModeBOrchestrator({ provider, maxTokens: 1024 });
      const session = makeSession();
      await orchWithTokens.processMessage(session, textParts("msg"));
      expect(provider.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: 1024 }),
      );
    });
  });

  describe("AI guard", () => {
    it("returns queued result with empty parts when sessionMode is 'queued'", async () => {
      const provider = makeProvider();
      const orchestrator = new ModeBOrchestrator({ provider });
      const session = makeSession();
      session.setSessionMode("queued");

      const result = await orchestrator.processMessage(session, textParts("hello from queue"));

      expect(result.queued).toBe(true);
      expect(result.parts).toEqual([]);
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(result.cacheReadTokens).toBe(0);
      expect(result.cacheWriteTokens).toBe(0);
      expect(provider.createMessage).not.toHaveBeenCalled();
    });

    it("returns queued result when sessionMode is 'human_active'", async () => {
      const provider = makeProvider();
      const orchestrator = new ModeBOrchestrator({ provider });
      const session = makeSession();
      session.setSessionMode("queued");
      session.setSessionMode("human_active");

      const result = await orchestrator.processMessage(session, textParts("hello from human"));

      expect(result.queued).toBe(true);
      expect(result.parts).toEqual([]);
      expect(provider.createMessage).not.toHaveBeenCalled();
    });

    it("still adds user message to history when queued", async () => {
      const provider = makeProvider();
      const orchestrator = new ModeBOrchestrator({ provider });
      const session = makeSession();
      session.setSessionMode("queued");

      await orchestrator.processMessage(session, textParts("queued message"));

      const lastMsg = session.conversationHistory[session.conversationHistory.length - 1];
      expect(lastMsg).toEqual({ role: "user", parts: textParts("queued message") });
    });

    it("processes normally when sessionMode is 'ai_active'", async () => {
      const provider = makeProvider();
      const orchestrator = new ModeBOrchestrator({ provider });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.queued).toBe(false);
      expect(extractText(result.parts)).toBe("mock response");
      expect(provider.createMessage).toHaveBeenCalledTimes(1);
    });

    it("auto-reopens resolved sessions and processes normally", async () => {
      const provider = makeProvider();
      const orchestrator = new ModeBOrchestrator({ provider });
      const session = makeSession();
      // Transition to resolved: ai_active -> queued -> human_active -> resolved
      session.setSessionMode("queued");
      session.setSessionMode("human_active");
      session.setSessionMode("resolved");
      expect(session.sessionMode).toBe("resolved");

      const result = await orchestrator.processMessage(session, textParts("I'm back"));

      expect(result.queued).toBe(false);
      expect(extractText(result.parts)).toBe("mock response");
      expect(session.sessionMode).toBe("ai_active");
      expect(provider.createMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("escalation detection", () => {
    it("includes pre-LLM escalation signal when keyword detected", async () => {
      const provider = makeProvider();
      const detector: EscalationDetector = {
        checkPreLLM: vi.fn().mockReturnValue({
          reason: "keyword",
          confidence: 0.8,
          detail: 'Matched keyword: "human"',
        }),
        checkPostLLM: vi.fn().mockReturnValue(null),
      };
      const orchestrator = new ModeBOrchestrator({ provider, escalationDetector: detector });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("I want a human"));

      expect(result.escalation).toBeDefined();
      expect(result.escalation!.reason).toBe("keyword");
      expect(result.escalation!.confidence).toBe(0.8);
      // Post-LLM should NOT be called when pre-LLM triggers
      expect(detector.checkPostLLM).not.toHaveBeenCalled();
    });

    it("includes post-LLM escalation signal when loop detected", async () => {
      const provider = makeProvider();
      const detector: EscalationDetector = {
        checkPreLLM: vi.fn().mockReturnValue(null),
        checkPostLLM: vi.fn().mockReturnValue({
          reason: "loop",
          confidence: 0.85,
          detail: "Last 3 responses have similarity > 0.85",
        }),
      };
      const orchestrator = new ModeBOrchestrator({ provider, escalationDetector: detector });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.escalation).toBeDefined();
      expect(result.escalation!.reason).toBe("loop");
      expect(result.escalation!.confidence).toBe(0.85);
    });

    it("returns no escalation when detector returns null", async () => {
      const provider = makeProvider();
      const detector: EscalationDetector = {
        checkPreLLM: vi.fn().mockReturnValue(null),
        checkPostLLM: vi.fn().mockReturnValue(null),
      };
      const orchestrator = new ModeBOrchestrator({ provider, escalationDetector: detector });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.escalation).toBeUndefined();
    });

    it("returns no escalation when no detector is configured", async () => {
      const provider = makeProvider();
      const orchestrator = new ModeBOrchestrator({ provider });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("I want a human"));

      expect(result.escalation).toBeUndefined();
    });

    it("generates context summary when escalation detected and summarizer is configured", async () => {
      const provider = makeProvider();
      const detector: EscalationDetector = {
        checkPreLLM: vi.fn().mockReturnValue({
          reason: "keyword",
          confidence: 0.8,
          detail: 'Matched keyword: "human"',
        }),
        checkPostLLM: vi.fn().mockReturnValue(null),
      };
      const summarizer: ContextSummarizer = {
        summarize: vi.fn().mockResolvedValue("Customer needs billing help."),
      };
      const orchestrator = new ModeBOrchestrator({
        provider,
        escalationDetector: detector,
        contextSummarizer: summarizer,
      });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("I want a human"));

      expect(result.contextSummary).toBe("Customer needs billing help.");
      expect(summarizer.summarize).toHaveBeenCalledWith(session);
    });

    it("proceeds without summary when summarizer throws", async () => {
      const provider = makeProvider();
      const detector: EscalationDetector = {
        checkPreLLM: vi.fn().mockReturnValue({
          reason: "keyword",
          confidence: 0.8,
          detail: 'Matched keyword: "human"',
        }),
        checkPostLLM: vi.fn().mockReturnValue(null),
      };
      const summarizer: ContextSummarizer = {
        summarize: vi.fn().mockRejectedValue(new Error("Provider unavailable")),
      };
      const orchestrator = new ModeBOrchestrator({
        provider,
        escalationDetector: detector,
        contextSummarizer: summarizer,
      });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("I want a human"));

      expect(result.escalation).toBeDefined();
      expect(result.contextSummary).toBeUndefined();
    });

    it("does not generate summary when no escalation detected", async () => {
      const provider = makeProvider();
      const detector: EscalationDetector = {
        checkPreLLM: vi.fn().mockReturnValue(null),
        checkPostLLM: vi.fn().mockReturnValue(null),
      };
      const summarizer: ContextSummarizer = {
        summarize: vi.fn().mockResolvedValue("Summary"),
      };
      const orchestrator = new ModeBOrchestrator({
        provider,
        escalationDetector: detector,
        contextSummarizer: summarizer,
      });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.contextSummary).toBeUndefined();
      expect(summarizer.summarize).not.toHaveBeenCalled();
    });
  });
});
