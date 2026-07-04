import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { textParts } from "@kilnai/core";
import { GroundingRail } from "@kilnai/core";
import type { ModelCapabilityRegistry } from "@kilnai/core";
import { processAdmittedTurn } from "../../src/gateway/message-pipeline.js";
import type { AdmittedTurnContext } from "../../src/gateway/message-pipeline.js";
import type { RuntimeSessionOrchestrator, OrchestrateResult } from "../../src/session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import type { RuntimeSession } from "../../src/session/runtime-session.js";
import type { ConversationEventEmitter } from "../../src/gateway/conversation-event-emitter.js";

const processInboundMessage = processAdmittedTurn;

const originalFetch = globalThis.fetch;

const KNOWLEDGE_CONTEXT = "Chunk one about our product.\n---\nChunk two about pricing.\n---\nChunk three about support.";

function makeMockSession(): RuntimeSession {
  let _userContext: Record<string, string> | undefined;
  let _sessionLedger: Record<string, unknown> = {};
  let _exactArtifacts: string[] = [];
  let _sessionEvents: Array<{ sequence?: number; kilnSessionId?: string }> = [];
  return {
    id: "test-app:test-tenant:user-1:12345",
    appName: "test-app",
    tenantId: "test-tenant",
    userId: "user-1",
    sessionMode: "ai_active" as const,
    totalTokens: 0,
    userTurnCount: 0,
    conversationHistory: [] as any,
    messageCount: 0,
    accumulateTokens: vi.fn(),
    get userContext() { return _userContext; },
    updateUserContext(ctx: Record<string, string>) {
      _userContext = { ..._userContext, ...ctx };
    },
    updateSessionLedger(updates: Record<string, unknown>) {
      _sessionLedger = { ..._sessionLedger, ...updates };
    },
    get sessionLedger() { return _sessionLedger as any; },
    addExactArtifact(artifact: string) {
      _exactArtifacts.push(artifact);
    },
    get exactArtifacts() { return _exactArtifacts; },
    get sessionEvents() { return _sessionEvents as any; },
    nextSessionEventSequence() {
      const lastEvent = _sessionEvents[_sessionEvents.length - 1];
      return typeof lastEvent?.sequence === "number" ? lastEvent.sequence + 1 : 1;
    },
    appendSessionEvents(events: readonly { sequence?: number; kilnSessionId?: string }[]) {
      _sessionEvents = [..._sessionEvents, ...events];
    },
  } as unknown as RuntimeSession;
}

function makeMockOrchestrator(parts = textParts("mock response"), queued = false): RuntimeSessionOrchestrator {
  return {
    processMessage: vi.fn().mockResolvedValue({
      parts,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      queued,
    } satisfies OrchestrateResult),
    model: "gpt-4o-mini",
  } as unknown as RuntimeSessionOrchestrator;
}

function makeMockSessionRegistry(session?: RuntimeSession): SessionRegistry {
  const mockSession = session ?? makeMockSession();
  return {
    getOrCreate: vi.fn().mockResolvedValue(mockSession),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionRegistry;
}

function makeMockEventEmitter(): ConversationEventEmitter {
  return {
    emit: vi.fn(),
  } as unknown as ConversationEventEmitter;
}

function makeMockModelRegistry(provider = "openai"): ModelCapabilityRegistry {
  return {
    all: vi.fn().mockReturnValue([{
      provider,
      model: "gpt-4o-mini",
      supportsStructuredOutput: true,
      inputPer1M: 0.15,
      outputPer1M: 0.6,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: true,
      supportsAudio: false,
      maxContextTokens: 128000,
      qualityTier: "standard",
    }]),
    get: vi.fn(),
  } as unknown as ModelCapabilityRegistry;
}

function makeGroundedDeps(grounded: boolean) {
  const mockRail = new GroundingRail();
  vi.spyOn(mockRail, "evaluate").mockResolvedValue(
    grounded
      ? { grounded: true, confidence: 0.95, ungroundedClaims: [], durationMs: 50, model: "gpt-4o-mini" }
      : { grounded: false, confidence: 0.3, ungroundedClaims: ["claim1"], durationMs: 50, model: "gpt-4o-mini" },
  );

  const mockProvider = { name: "openai", createMessage: vi.fn() };
  const providerPool = new Map([["openai", mockProvider as never]]);
  const modelRegistry = makeMockModelRegistry("openai");
  const eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };

  return { rail: mockRail, providerPool, modelRegistry, eventBus };
}

function makeBaseContext(overrides: Partial<AdmittedTurnContext> = {}): AdmittedTurnContext {
  return {
    orchestrator: makeMockOrchestrator(),
    sessionRegistry: makeMockSessionRegistry(),
    appName: "test-app",
    tenantId: "test-tenant",
    userId: "user-1",
    systemPrompt: "You are a test assistant.",
    userParts: textParts("hello"),
    channel: "api",
    ...overrides,
  };
}

describe("processAdmittedTurn - grounding", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ allowed: true, remaining: 50000, unit: "tokens" }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("skips grounding when groundingMode is 'off'", async () => {
    const groundingDeps = makeGroundedDeps(true);
    const ctx = makeBaseContext({
      groundingMode: "off",
      groundingDeps,
      knowledgeContext: KNOWLEDGE_CONTEXT,
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(groundingDeps.rail.evaluate).not.toHaveBeenCalled();
      expect(result.result.groundingResult).toBeUndefined();
    }
  });

  it("skips grounding when groundingMode is 'strict'", async () => {
    const groundingDeps = makeGroundedDeps(true);
    const ctx = makeBaseContext({
      groundingMode: "strict",
      groundingDeps,
      knowledgeContext: KNOWLEDGE_CONTEXT,
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(groundingDeps.rail.evaluate).not.toHaveBeenCalled();
      expect(result.result.groundingResult).toBeUndefined();
    }
  });

  it("skips grounding when groundingMode is 'verified' but no knowledgeContext", async () => {
    const groundingDeps = makeGroundedDeps(true);
    const ctx = makeBaseContext({
      groundingMode: "verified",
      groundingDeps,
      knowledgeContext: undefined,
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(groundingDeps.rail.evaluate).not.toHaveBeenCalled();
      expect(result.result.groundingResult).toBeUndefined();
    }
  });

  it("skips grounding when groundingMode is 'verified' but result is queued", async () => {
    const groundingDeps = makeGroundedDeps(true);
    const orchestrator = makeMockOrchestrator(textParts("mock response"), true);
    const ctx = makeBaseContext({
      orchestrator,
      groundingMode: "verified",
      groundingDeps,
      knowledgeContext: KNOWLEDGE_CONTEXT,
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(groundingDeps.rail.evaluate).not.toHaveBeenCalled();
      expect(result.result.groundingResult).toBeUndefined();
    }
  });

  it("skips grounding when groundingMode is 'verified' but no groundingDeps", async () => {
    const ctx = makeBaseContext({
      groundingMode: "verified",
      groundingDeps: undefined,
      knowledgeContext: KNOWLEDGE_CONTEXT,
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.groundingResult).toBeUndefined();
    }
  });

  it("runs grounding and passes response through when grounded", async () => {
    const groundingDeps = makeGroundedDeps(true);
    const ctx = makeBaseContext({
      groundingMode: "verified",
      groundingDeps,
      knowledgeContext: KNOWLEDGE_CONTEXT,
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(groundingDeps.rail.evaluate).toHaveBeenCalledOnce();
      expect(result.result.parts).toEqual(textParts("mock response"));
      expect(result.result.groundingResult?.grounded).toBe(true);
      expect(result.result.groundingResult?.confidence).toBe(0.95);
    }
  });

  it("runs grounding and replaces response when ungrounded", async () => {
    const groundingDeps = makeGroundedDeps(false);
    const ctx = makeBaseContext({
      groundingMode: "verified",
      groundingDeps,
      knowledgeContext: KNOWLEDGE_CONTEXT,
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(groundingDeps.rail.evaluate).toHaveBeenCalledOnce();
      const responseText = result.result.parts.map((p) => ("text" in p ? p.text : "")).join("");
      expect(responseText).toContain("I don't have enough verified information");
      expect(result.result.groundingResult?.grounded).toBe(false);
    }
  });

  it("is fail-open on grounding error — original response passes through", async () => {
    const mockRail = new GroundingRail();
    vi.spyOn(mockRail, "evaluate").mockRejectedValue(new Error("Judge timeout"));

    const mockProvider = { name: "openai", createMessage: vi.fn() };
    const providerPool = new Map([["openai", mockProvider as never]]);
    const modelRegistry = makeMockModelRegistry("openai");
    const eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };

    const ctx = makeBaseContext({
      groundingMode: "verified",
      groundingDeps: { rail: mockRail, providerPool, modelRegistry, eventBus },
      knowledgeContext: KNOWLEDGE_CONTEXT,
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.parts).toEqual(textParts("mock response"));
      expect(result.result.groundingResult).toBeUndefined();
    }
  });

  it("emits grounding_evaluated event via EventBus when grounding runs", async () => {
    const groundingDeps = makeGroundedDeps(true);
    const ctx = makeBaseContext({
      groundingMode: "verified",
      groundingDeps,
      knowledgeContext: KNOWLEDGE_CONTEXT,
    });

    await processInboundMessage(ctx);

    expect(groundingDeps.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "grounding_evaluated",
        tenantId: "test-tenant",
        grounded: true,
        confidence: 0.95,
        ungroundedClaims: [],
        model: "gpt-4o-mini",
      }),
    );
  });

  it("emits GROUNDING_BLOCKED conversation event when response is ungrounded", async () => {
    const groundingDeps = makeGroundedDeps(false);
    const emitter = makeMockEventEmitter();
    const ctx = makeBaseContext({
      groundingMode: "verified",
      groundingDeps,
      knowledgeContext: KNOWLEDGE_CONTEXT,
      eventEmitter: emitter,
    });

    await processInboundMessage(ctx);

    expect(emitter.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "GROUNDING_BLOCKED",
        tenantId: "test-tenant",
        channel: "api",
        externalUserId: "user-1",
        confidence: 0.3,
        ungroundedClaims: ["claim1"],
        model: "gpt-4o-mini",
      }),
    );
  });

  it("does not emit GROUNDING_BLOCKED when response is grounded", async () => {
    const groundingDeps = makeGroundedDeps(true);
    const emitter = makeMockEventEmitter();
    const ctx = makeBaseContext({
      groundingMode: "verified",
      groundingDeps,
      knowledgeContext: KNOWLEDGE_CONTEXT,
      eventEmitter: emitter,
    });

    await processInboundMessage(ctx);

    const calls = (emitter.emit as ReturnType<typeof vi.fn>).mock.calls;
    const groundingBlockedCall = calls.find((c) => c[0]?.eventType === "GROUNDING_BLOCKED");
    expect(groundingBlockedCall).toBeUndefined();
  });

  it("includes groundingResult in the return value when grounding runs", async () => {
    const groundingDeps = makeGroundedDeps(true);
    const ctx = makeBaseContext({
      groundingMode: "verified",
      groundingDeps,
      knowledgeContext: KNOWLEDGE_CONTEXT,
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.groundingResult).toBeDefined();
      expect(result.result.groundingResult).toMatchObject({
        grounded: true,
        confidence: 0.95,
        ungroundedClaims: [],
        durationMs: 50,
        model: "gpt-4o-mini",
      });
    }
  });

  it("splits knowledgeContext on \\n---\\n separator when building chunks", async () => {
    const groundingDeps = makeGroundedDeps(true);
    const ctx = makeBaseContext({
      groundingMode: "verified",
      groundingDeps,
      knowledgeContext: KNOWLEDGE_CONTEXT,
    });

    await processInboundMessage(ctx);

    expect(groundingDeps.rail.evaluate).toHaveBeenCalledWith(
      "mock response",
      expect.arrayContaining(["Chunk one about our product.", "Chunk two about pricing.", "Chunk three about support."]),
      expect.anything(),
      "gpt-4o-mini",
    );
  });

  it("selects the cheapest model with structured output support from the registry", async () => {
    const mockRail = new GroundingRail();
    vi.spyOn(mockRail, "evaluate").mockResolvedValue({
      grounded: true, confidence: 0.9, ungroundedClaims: [], durationMs: 30, model: "gpt-4o-mini",
    });

    const cheapProvider = { name: "openai", createMessage: vi.fn() };
    const expensiveProvider = { name: "anthropic", createMessage: vi.fn() };
    const providerPool = new Map([
      ["openai", cheapProvider as never],
      ["anthropic", expensiveProvider as never],
    ]);

    // Registry returns two capability profiles; the cheaper one (openai) should be picked.
    // These profiles are advisory grounding candidates, not execution eligibility authority.
    const modelRegistry = {
      all: vi.fn().mockReturnValue([
        {
          provider: "anthropic", model: "claude-haiku-3-5", supportsStructuredOutput: true,
          inputPer1M: 0.8, outputPer1M: 4.0, supportsTools: true, supportsStreaming: true,
          supportsVision: true, supportsAudio: false, maxContextTokens: 200000, qualityTier: "standard",
        },
        {
          provider: "openai", model: "gpt-4o-mini", supportsStructuredOutput: true,
          inputPer1M: 0.15, outputPer1M: 0.6, supportsTools: true, supportsStreaming: true,
          supportsVision: true, supportsAudio: false, maxContextTokens: 128000, qualityTier: "standard",
        },
      ]),
      get: vi.fn(),
    } as unknown as ModelCapabilityRegistry;

    const ctx = makeBaseContext({
      groundingMode: "verified",
      groundingDeps: { rail: mockRail, providerPool, modelRegistry, eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } },
      knowledgeContext: KNOWLEDGE_CONTEXT,
    });

    await processInboundMessage(ctx);

    // evaluate should receive the cheap openai provider
    const [, , usedProvider, usedModel] = (mockRail.evaluate as ReturnType<typeof vi.spyOn>).mock.calls[0];
    expect(usedProvider).toBe(cheapProvider);
    expect(usedModel).toBe("gpt-4o-mini");
  });

  it("skips grounding when no registry profile with structured output exists", async () => {
    const mockRail = new GroundingRail();
    vi.spyOn(mockRail, "evaluate");

    const providerPool = new Map<string, never>();
    const modelRegistry = {
      all: vi.fn().mockReturnValue([
        {
          provider: "openai", model: "gpt-3.5-turbo", supportsStructuredOutput: false,
          inputPer1M: 0.5, outputPer1M: 1.5, supportsTools: true, supportsStreaming: true,
          supportsVision: false, supportsAudio: false, maxContextTokens: 16384, qualityTier: "economy",
        },
      ]),
      get: vi.fn(),
    } as unknown as ModelCapabilityRegistry;

    const ctx = makeBaseContext({
      groundingMode: "verified",
      groundingDeps: { rail: mockRail, providerPool, modelRegistry, eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } },
      knowledgeContext: KNOWLEDGE_CONTEXT,
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(mockRail.evaluate).not.toHaveBeenCalled();
      // Original response passes through unchanged
      expect(result.result.parts).toEqual(textParts("mock response"));
      expect(result.result.groundingResult).toBeUndefined();
    }
  });
});
