import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { textParts } from "@kilnai/core";
import { processInboundMessage } from "../../src/gateway/message-pipeline.js";
import type { InboundMessageContext } from "../../src/gateway/message-pipeline.js";
import type { ModeBOrchestrator, OrchestrateResult } from "../../src/session/mode-b-orchestrator.js";
import type { SessionRegistry } from "../../src/session/session-registry.js";
import type { ModeBSession } from "../../src/session/mode-b-session.js";
import type { ConversationEventEmitter } from "../../src/gateway/conversation-event-emitter.js";
import type { BillingConfig } from "../../src/gateway/budget-middleware.js";

const originalFetch = globalThis.fetch;

function makeMockSession(): ModeBSession {
  return {
    id: "test-app:user-1:12345",
    appName: "test-app",
    tenantId: undefined,
    userId: "user-1",
    sessionMode: "ai_active",
  } as unknown as ModeBSession;
}

function makeMockOrchestrator(): ModeBOrchestrator {
  return {
    processMessage: vi.fn().mockResolvedValue({
      parts: textParts("mock response"),
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      queued: false,
    } satisfies OrchestrateResult),
    model: "claude-sonnet-4-20250514",
  } as unknown as ModeBOrchestrator;
}

function makeMockSessionRegistry(session?: ModeBSession): SessionRegistry {
  const mockSession = session ?? makeMockSession();
  return {
    getOrCreate: vi.fn().mockReturnValue(mockSession),
  } as unknown as SessionRegistry;
}

function makeMockEventEmitter(): ConversationEventEmitter {
  return {
    emit: vi.fn(),
  } as unknown as ConversationEventEmitter;
}

function makeBillingConfig(): BillingConfig {
  return {
    budgetEndpoint: "https://api.example.com/users/{userId}/ai-budget",
    usageEndpoint: "https://api.example.com/users/{userId}/ai-usage",
    overBudgetMessage: "Budget exhausted.",
  };
}

function makeBaseContext(overrides: Partial<InboundMessageContext> = {}): InboundMessageContext {
  return {
    orchestrator: makeMockOrchestrator(),
    sessionRegistry: makeMockSessionRegistry(),
    appName: "test-app",
    userId: "user-1",
    systemPrompt: "You are a test assistant.",
    userParts: textParts("hello"),
    channel: "api",
    ...overrides,
  };
}

describe("processInboundMessage", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ allowed: true, remaining: 50000, unit: "tokens" }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns ok:true with result when budget is allowed", async () => {
    const ctx = makeBaseContext({ billing: makeBillingConfig() });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.inputTokens).toBe(100);
      expect(result.result.outputTokens).toBe(50);
      expect(result.result.cacheReadTokens).toBe(10);
      expect(result.result.cacheWriteTokens).toBe(5);
      expect(result.result.queued).toBe(false);
      expect(result.result.sessionId).toBe("test-app:user-1:12345");
      expect(result.result.sessionMode).toBe("ai_active");
    }
  });

  it("returns ok:false with budgetDenied when budget exhausted", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ allowed: false, remaining: 0, unit: "tokens" }),
    });

    const ctx = makeBaseContext({ billing: makeBillingConfig() });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.budgetDenied.budgetExhausted).toBe(true);
      expect(result.budgetDenied.message).toBe("Budget exhausted.");
    }
  });

  it("skips budget check when no billing configured", async () => {
    const ctx = makeBaseContext();

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("reports usage when billing is configured", async () => {
    const ctx = makeBaseContext({ billing: makeBillingConfig() });

    await processInboundMessage(ctx);

    // fetch called twice: budget check + usage report
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const usageCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(usageCall[0]).toBe("https://api.example.com/users/{userId}/ai-usage");
    expect(usageCall[1]).toMatchObject({ method: "POST" });
    const usageBody = JSON.parse(usageCall[1].body as string);
    expect(usageBody.tenantId).toBe("user-1");
    expect(usageBody.messages).toBe(1);
    expect(usageBody.tokens).toBe(150); // 100 input + 50 output
    expect(usageBody.model).toBe("claude-sonnet-4-20250514");
  });

  it("emits MESSAGE_RECEIVED event when eventEmitter and tenantId are present", async () => {
    const emitter = makeMockEventEmitter();
    const ctx = makeBaseContext({
      eventEmitter: emitter,
      tenantId: "tenant-1",
    });

    await processInboundMessage(ctx);

    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "MESSAGE_RECEIVED",
        tenantId: "tenant-1",
        channel: "api",
        externalUserId: "user-1",
      }),
    );
  });

  it("does not emit event when no tenantId", async () => {
    const emitter = makeMockEventEmitter();
    const ctx = makeBaseContext({ eventEmitter: emitter });

    await processInboundMessage(ctx);

    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it("creates session via sessionRegistry.getOrCreate", async () => {
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({ sessionRegistry });

    await processInboundMessage(ctx);

    expect(sessionRegistry.getOrCreate).toHaveBeenCalledWith({
      appName: "test-app",
      tenantId: undefined,
      userId: "user-1",
      systemPrompt: "You are a test assistant.",
      idleTimeoutMs: undefined,
    });
  });

  it("passes tenantId to sessionRegistry.getOrCreate when provided", async () => {
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({ sessionRegistry, tenantId: "tenant-1" });

    await processInboundMessage(ctx);

    expect(sessionRegistry.getOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1" }),
    );
  });

  it("passes recalledMemory to orchestrator", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      recalledMemory: "Previous context here.",
    });

    await processInboundMessage(ctx);

    expect(orchestrator.processMessage).toHaveBeenCalledWith(
      expect.anything(),
      textParts("hello"),
      "Previous context here.",
      undefined,
    );
  });

  it("passes callBuiltinTools to orchestrator", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const builtinTools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>([
      ["test_tool", vi.fn().mockResolvedValue("result")],
    ]);
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      callBuiltinTools: builtinTools,
    });

    await processInboundMessage(ctx);

    expect(orchestrator.processMessage).toHaveBeenCalledWith(
      expect.anything(),
      textParts("hello"),
      undefined,
      builtinTools,
    );
  });

  it("uses tenantId for billing when tenantId is present", async () => {
    const ctx = makeBaseContext({
      billing: makeBillingConfig(),
      tenantId: "tenant-1",
    });

    await processInboundMessage(ctx);

    // Budget check should use tenantId
    const budgetCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(budgetCall[0]).toBe("https://api.example.com/users/tenant-1/ai-budget");
  });
});
