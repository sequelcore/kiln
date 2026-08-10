import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderAdapter } from "@kilnai/core";
import { textParts, extractText, sha256ContentIdentity } from "@kilnai/core";
import type { ContextAuditEntry, ProjectedContextBlock } from "@kilnai/core";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { EscalationDetector } from "../../src/session/support/escalation/escalation-detector.js";
import type { ContextSummarizer } from "../../src/session/support/summarization/context-summarizer.js";

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

function makeSession(systemPrompt = "You are helpful."): RuntimeSession {
  return new RuntimeSession({ appName: "app", tenantId: "test-tenant", userId: "user-1", systemPrompt });
}

function makeGovernedContext(content: string) {
  const block: ProjectedContextBlock = {
    id: "fixture:directive",
    kind: "procedural",
    modelFacingSemantics: "directive",
    source: "fixture",
    content,
    required: true,
    score: 1,
    estimatedTokens: 1,
  };
  return {
    directives: [block],
    guidance: [],
    evidence: [],
    audit: {
      governor: "DefaultContextGovernor",
      selectedBlockIds: [block.id],
      deferredBlockIds: [],
      requiredBlockIds: [],
      preservedRequiredBlockIds: [],
      selectedTokens: 1,
      requiredTokens: 1,
      tokenBudget: 1,
      overflow: false,
      blocks: [{
        id: block.id, kind: block.kind, modelFacingSemantics: block.modelFacingSemantics,
        source: block.source, contentHash: sha256ContentIdentity(block.content), required: block.required, estimatedTokens: 1, baseScore: 1,
        effectiveScore: 1, decision: "admitted", reason: "required-preserved", order: 0,
      }],
    } satisfies ContextAuditEntry,
  };
}

describe("RuntimeSessionOrchestrator", () => {
  describe("constructor", () => {
    it("creates orchestrator with mock provider", () => {
      const provider = makeProvider();
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
      expect(orchestrator).toBeDefined();
    });

    it("rejects invalid explicit tool-round envelopes at the runtime boundary", () => {
      const provider = makeProvider();

      expect(() =>
        new RuntimeSessionOrchestrator({
          provider,
          executionEnvelope: { toolRounds: { max: 0 } },
        })
      ).toThrow("executionEnvelope.toolRounds.max must be a positive integer");

      expect(() =>
        new RuntimeSessionOrchestrator({
          provider,
          executionEnvelope: { toolRounds: { max: 1.5 } },
        })
      ).toThrow("executionEnvelope.toolRounds.max must be a positive integer");
    });
  });

  describe("processMessage", () => {
    let provider: ProviderAdapter;
    let orchestrator: RuntimeSessionOrchestrator;

    beforeEach(() => {
      provider = makeProvider();
      orchestrator = new RuntimeSessionOrchestrator({ provider });
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
      const callArgs = vi.mocked(provider.createMessage).mock.calls[0][0];
      expect(callArgs.system).toContain("You are a coding assistant.");
      expect(callArgs.system).toContain("[KILN EXECUTION IDENTITY]");
      expect(callArgs.system).toContain("provider: mock");
    });

    it("appends governed context to system prompt", async () => {
      const session = makeSession("Base prompt.");
      await orchestrator.processMessage(session, textParts("help"), makeGovernedContext("some governed context"));
      const callArgs = vi.mocked(provider.createMessage).mock.calls[0][0];
      expect(callArgs.system).toContain("--- Governed Context Directives ---");
      expect(callArgs.system).toContain("some governed context");
      expect(callArgs.system).toContain("[KILN EXECUTION IDENTITY]");
    });

    it("binds provider transport evidence to the exact request round", async () => {
      const observer = { onEvent: vi.fn() };
      const watchdog = { chunkIdleTimeoutMs: 500 };

      await orchestrator.processMessage(makeSession(), textParts("help me"), undefined, undefined, {
        providerTransport: {
          projectId: "project-digest",
          requestIdPrefix: "invocation-digest",
          watchdog,
          observer,
        },
      });

      expect(provider.createMessage).toHaveBeenCalledWith(expect.objectContaining({
        requestIdentity: {
          projectId: "project-digest",
          requestId: "invocation-digest:response:1",
        },
        transportWatchdog: watchdog,
        transportObserver: observer,
      }));
    });

    it("appends canonical turn-local time after the stable session prompt", async () => {
      const session = makeSession("Base prompt.");
      await orchestrator.processMessage(session, textParts("what happened today?"), undefined, undefined, {
        temporalContext: {
          observedAt: "2026-07-19T04:45:46.720Z",
          timeZone: "America/Tijuana",
          localDate: "2026-07-18",
        },
      });
      const callArgs = vi.mocked(provider.createMessage).mock.calls[0][0];
      expect(callArgs.system).toContain("Base prompt.");
      expect(callArgs.system).toContain("--- Turn Temporal Context ---");
      expect(callArgs.system).toContain("Observed at (UTC): 2026-07-19T04:45:46.720Z");
      expect(callArgs.system).toContain("Operator-local date: 2026-07-18 (America/Tijuana)");
      expect(callArgs.system).toContain("Do not substitute a publication or retrieval date");
      expect(callArgs.system).toContain("--- Progressive Exact-Date Web Research ---");
      expect(callArgs.system).toContain("Do not copy the event date into startDate or endDate");
      expect(callArgs.system).toContain("retry at least once with a materially broader discovery query");
      expect(callArgs.system).toContain("Use web_extract on the strongest candidate pages");
    });

    it("fails closed instead of returning an unverified same-day event claim", async () => {
      vi.mocked(provider.createMessage).mockResolvedValueOnce({
        parts: textParts("Chivas perdió 0-2 hoy."),
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
      });
      const result = await orchestrator.processMessage(
        makeSession(),
        textParts("Hoy, ¿cuál fue el resultado de Chivas vs Toluca?"),
        undefined,
        undefined,
        {
          temporalContext: {
            observedAt: "2026-07-19T05:34:42.733Z",
            timeZone: "America/Tijuana",
            localDate: "2026-07-18",
          },
        },
      );

      expect(extractText(result.parts)).toContain("no pudo verificar");
      expect(extractText(result.parts)).not.toContain("0-2");
    });

    it("fails closed on an unverified explicit-date event claim and names the requested date", async () => {
      vi.mocked(provider.createMessage).mockResolvedValueOnce({
        parts: textParts("Chivas perdio 0-2."),
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
      });
      const result = await orchestrator.processMessage(
        makeSession(),
        textParts("Por que perdio Chivas contra Toluca el 18 de julio de 2026?"),
        undefined,
        undefined,
        {
          temporalContext: {
            observedAt: "2026-07-20T05:34:42.733Z",
            timeZone: "America/Tijuana",
            localDate: "2026-07-19",
          },
        },
      );

      expect(extractText(result.parts)).toContain("2026-07-18");
      expect(extractText(result.parts)).not.toContain("0-2");
    });

    it("rejects unaudited governed context content", async () => {
      const session = makeSession("Base prompt.");
      await expect(orchestrator.processMessage(session, textParts("help"), {
        directives: [{ id: "raw", kind: "procedural", modelFacingSemantics: "directive", source: "fixture", content: "raw context", required: true, score: 1 }],
        guidance: [],
        evidence: [],
      }))
        .rejects
        .toThrow("Governed runtime context must include a DefaultContextGovernor audit");
    });

    it("does not append governed context section when not provided", async () => {
      const session = makeSession("Base prompt.");
      await orchestrator.processMessage(session, textParts("help"));
      const callArgs = vi.mocked(provider.createMessage).mock.calls[0][0];
      expect(callArgs.system).toContain("Base prompt.");
      expect(callArgs.system).not.toContain("--- Governed Context ---");
      expect(callArgs.system).toContain("[KILN EXECUTION IDENTITY]");
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

    it("returns an explicit canonical completed outcome", async () => {
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.outcome).toBe("completed");
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

    it("projects old tool results for the provider while retaining the canonical session history", async () => {
      const session = makeSession();
      for (let index = 1; index <= 5; index += 1) {
        const toolUseId = `call-${index}`;
        session.addAssistantMessage([{
          type: "tool_use",
          id: toolUseId,
          name: "read",
          input: { path: `file-${index}.ts` },
        }]);
        session.addUserMessage([{
          type: "tool_result",
          toolUseId,
          content: String(index).repeat(160),
        }]);
      }
      const projectedOrchestrator = new RuntimeSessionOrchestrator({
        provider,
        executionEnvelope: {
          conversation: {
            toolResults: {
              triggerToolResultTokens: 100,
              retainRecentToolResults: 2,
            },
          },
        },
      });

      const result = await projectedOrchestrator.processMessage(session, textParts("continue"));

      const providerMessages = vi.mocked(provider.createMessage).mock.calls[0]?.[0].messages ?? [];
      const projectedResults = providerMessages.flatMap((message) => (
        message.parts.filter((part) => part.type === "tool_result")
      ));
      expect(projectedResults.slice(0, 3).map((part) => part.content)).toEqual([
        "[cleared:call-1]",
        "[cleared:call-2]",
        "[cleared:call-3]",
      ]);
      expect(session.conversationHistory[1]?.parts[0]).toEqual({
        type: "tool_result",
        toolUseId: "call-1",
        content: "1".repeat(160),
      });
      expect(result.providerRequests?.[0]?.conversationProjection).toMatchObject({
        clearedToolResultCount: 3,
        clearedToolUseIds: ["call-1", "call-2", "call-3"],
        overflow: false,
      });
    });

    it("uses session systemPrompt as system parameter", async () => {
      const session = makeSession("custom system prompt");
      await orchestrator.processMessage(session, textParts("msg"));
      const callArgs = vi.mocked(provider.createMessage).mock.calls[0][0];
      expect(callArgs.system).toContain("custom system prompt");
      expect(callArgs.system).toContain("[KILN EXECUTION IDENTITY]");
    });

    it("passes maxTokens to provider when configured", async () => {
      const orchWithTokens = new RuntimeSessionOrchestrator({ provider, maxTokens: 1024 });
      const session = makeSession();
      await orchWithTokens.processMessage(session, textParts("msg"));
      expect(provider.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: 1024 }),
      );
    });

    it("passes the admitted execution context to the provider boundary", async () => {
      const session = makeSession();

      await orchestrator.processMessage(session, textParts("msg"), undefined, undefined, {
        workingDirectory: "C:\\workspace\\kiln",
        effectiveTurnAuthority: {
          executionMode: "execute",
          requestedAuthority: "destructive",
          admittedAuthority: "destructive",
          sourcePolicy: "runtime_surface_projection",
          reason: "Full Access admitted for the attended operator turn.",
          completeness: "authoritative",
          toolCount: 1,
          deniedToolCount: 0,
        },
      });

      expect(provider.createMessage).toHaveBeenCalledWith(expect.objectContaining({
        executionContext: {
          workingDirectory: "C:\\workspace\\kiln",
          requestedAuthority: "destructive",
        },
      }));
    });
  });

  describe("AI guard", () => {
    it("returns queued result with empty parts when sessionMode is 'queued'", async () => {
      const provider = makeProvider();
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
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
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
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
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
      const session = makeSession();
      session.setSessionMode("queued");

      await orchestrator.processMessage(session, textParts("queued message"));

      const lastMsg = session.conversationHistory[session.conversationHistory.length - 1];
      expect(lastMsg).toEqual({ role: "user", parts: textParts("queued message") });
    });

    it("processes normally when sessionMode is 'ai_active'", async () => {
      const provider = makeProvider();
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.queued).toBe(false);
      expect(extractText(result.parts)).toBe("mock response");
      expect(provider.createMessage).toHaveBeenCalledTimes(1);
    });

    it("auto-reopens resolved sessions and processes normally", async () => {
      const provider = makeProvider();
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
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
      const orchestrator = new RuntimeSessionOrchestrator({ provider, escalationDetector: detector });
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
      const orchestrator = new RuntimeSessionOrchestrator({ provider, escalationDetector: detector });
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
      const orchestrator = new RuntimeSessionOrchestrator({ provider, escalationDetector: detector });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.escalation).toBeUndefined();
    });

    it("returns no escalation when no detector is configured", async () => {
      const provider = makeProvider();
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
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
      const orchestrator = new RuntimeSessionOrchestrator({
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
      const orchestrator = new RuntimeSessionOrchestrator({
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
      const orchestrator = new RuntimeSessionOrchestrator({
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
