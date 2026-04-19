import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventBus, textParts } from "@kilnai/core";
import { processInboundMessage } from "../../src/gateway/message-pipeline.js";
import type { InboundMessageContext } from "../../src/gateway/message-pipeline.js";
import type { RuntimeSessionOrchestrator, OrchestrateResult } from "../../src/session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../../src/session/session-registry.js";
import type { RuntimeSession } from "../../src/session/runtime-session.js";
import type { ConversationEventEmitter } from "../../src/gateway/conversation-event-emitter.js";
import type { BillingConfig } from "../../src/gateway/budget-middleware.js";

const originalFetch = globalThis.fetch;

function makeMockSession(): RuntimeSession {
  let _userContext: Record<string, string> | undefined;
  let _sessionLedger: Record<string, unknown> = {};
  let _exactArtifacts: string[] = [];
  const session = {
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
  } as unknown as RuntimeSession;
  return session;
}

function makeMockOrchestrator(): RuntimeSessionOrchestrator {
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
    tenantId: "test-tenant",
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
      expect(result.result.sessionId).toBe("test-app:test-tenant:user-1:12345");
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
    expect(usageBody.tenantId).toBe("test-tenant");
    expect(usageBody.messages).toBe(1);
    expect(usageBody.tokens).toBe(150); // 100 input + 50 output
    expect(usageBody.model).toBe("claude-sonnet-4-20250514");
  });

  it("emits MESSAGE_RECEIVED event when eventEmitter is present", async () => {
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

  it("creates session via sessionRegistry.getOrCreate", async () => {
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({ sessionRegistry });

    await processInboundMessage(ctx);

    expect(sessionRegistry.getOrCreate).toHaveBeenCalledWith({
      appName: "test-app",
      tenantId: "test-tenant",
      userId: "user-1",
      systemPrompt: "You are a test assistant.",
      idleTimeoutMs: undefined,
    });
  });

  it("passes tenantId to sessionRegistry.getOrCreate", async () => {
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
      undefined,
    );
  });

  it("prepends [User Context] block first in mergedMemory when userContext is present", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      userContext: { role: "admin" },
      recalledMemory: "Previous context here.",
    });

    await processInboundMessage(ctx);

    const callArgs = (orchestrator.processMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    const mergedMemoryArg: string | undefined = callArgs[2];
    expect(mergedMemoryArg).toBeDefined();
    expect(mergedMemoryArg!.startsWith("[User Context]:")).toBe(true);
    expect(mergedMemoryArg).toContain("Previous context here.");
  });

  it("omits [User Context] block from mergedMemory when userContext is absent", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      recalledMemory: "Previous context here.",
    });

    await processInboundMessage(ctx);

    const callArgs = (orchestrator.processMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    const mergedMemoryArg: string | undefined = callArgs[2];
    expect(mergedMemoryArg).not.toContain("[User Context]");
  });

  it("uses tenantId for billing", async () => {
    const ctx = makeBaseContext({
      billing: makeBillingConfig(),
      tenantId: "tenant-1",
    });

    await processInboundMessage(ctx);

    // Budget check should use tenantId
    const budgetCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(budgetCall[0]).toBe("https://api.example.com/users/tenant-1/ai-budget");
  });

  it("allow egress decision keeps assistant response unchanged", async () => {
    const ctx = makeBaseContext({
      orchestrator: {
        processMessage: vi.fn().mockResolvedValue({
          parts: textParts("original assistant response"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
        } satisfies OrchestrateResult),
        model: "claude-sonnet-4-20250514",
      } as unknown as RuntimeSessionOrchestrator,
      evaluateEgressPermission: vi.fn().mockResolvedValue("allow"),
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.parts).toEqual(textParts("original assistant response"));
    }
  });

  it("deny egress decision replaces returned assistant text with safe fallback", async () => {
    const emitter = makeMockEventEmitter();
    const ctx = makeBaseContext({
      eventEmitter: emitter,
      orchestrator: {
        processMessage: vi.fn().mockResolvedValue({
          parts: textParts("sensitive assistant response"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          escalation: { reason: "custom", confidence: 0.9, detail: "policy escalation" },
          contextSummary: "sensitive escalation summary",
          toolExecutions: [{
            toolName: "lookup_customer",
            durationMs: 12,
            success: true,
            resultSummary: "sensitive tool result",
          }],
        } satisfies OrchestrateResult),
        model: "claude-sonnet-4-20250514",
      } as unknown as RuntimeSessionOrchestrator,
      evaluateEgressPermission: vi.fn().mockResolvedValue("deny"),
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.parts).toEqual(textParts("I cannot share that response."));
      expect(result.result.contextSummary).toBeUndefined();
      expect(result.result.toolExecutions?.[0]?.resultSummary).toBe("");
    }

    const emitted = (emitter.emit as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    const escalationEvent = emitted.find((event) => event.eventType === "ESCALATION_DETECTED");
    expect(escalationEvent?.summary).toBeUndefined();
    const toolEvent = emitted.find((event) => event.eventType === "TOOL_EXECUTED");
    expect(toolEvent?.resultSummary).toBeUndefined();
  });

  it("redact egress decision redacts returned assistant text and text-bearing event summaries", async () => {
    const emitter = makeMockEventEmitter();
    const ctx = makeBaseContext({
      eventEmitter: emitter,
      orchestrator: {
        processMessage: vi.fn().mockResolvedValue({
          parts: textParts("sensitive assistant response"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          escalation: { reason: "custom", confidence: 0.9, detail: "policy escalation" },
          contextSummary: "sensitive escalation summary",
          toolExecutions: [{
            toolName: "lookup_customer",
            durationMs: 12,
            success: true,
            resultSummary: "sensitive tool result",
          }],
        } satisfies OrchestrateResult),
        model: "claude-sonnet-4-20250514",
      } as unknown as RuntimeSessionOrchestrator,
      evaluateEgressPermission: vi.fn().mockResolvedValue("redact"),
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.parts).toEqual(textParts("[REDACTED]"));
      expect(result.result.contextSummary).toBe("[REDACTED]");
      expect(result.result.toolExecutions?.[0]?.resultSummary).toBe("[REDACTED]");
    }

    const emitted = (emitter.emit as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    const escalationEvent = emitted.find((event) => event.eventType === "ESCALATION_DETECTED");
    expect(escalationEvent?.summary).toBe("[REDACTED]");
    const toolEvent = emitted.find((event) => event.eventType === "TOOL_EXECUTED");
    expect(toolEvent?.resultSummary).toBe("[REDACTED]");
  });

  it("captures approval transitions from runtime event bus into canonical turn artifacts", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "approval_requested",
          taskId: "",
          description: "Need confirmation",
          timestamp: new Date(),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "approval_requested",
          taskId: "",
          description: "Other session request",
          timestamp: new Date(),
          sessionId: "other-session",
        });
        eventBus.emit({
          type: "approval_received",
          taskId: "",
          approved: false,
          reason: "Denied by policy",
          timestamp: new Date(),
          sessionId: session.id,
        });
        return {
          parts: textParts("ok"),
          inputTokens: 7,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
        } satisfies OrchestrateResult;
      }),
      model: "claude-sonnet-4-20250514",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);
    const ctx = makeBaseContext({ orchestrator, sessionRegistry });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    const artifacts = (session as unknown as { exactArtifacts: string[] }).exactArtifacts;
    expect(artifacts).toContain(`Approval requested: ${session.id} (Need confirmation)`);
    expect(artifacts).toContain(`Approval rejected: ${session.id} (Denied by policy)`);
    expect(artifacts).not.toContain("Approval requested: other-session (Other session request)");
  });

  it("captures tool_authorized decisions scoped to current session into canonical turn artifacts", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "tool_authorized",
          toolName: "read_file",
          level: 1,
          allowed: true,
          reason: "Read-only tool, auto-execute",
          timestamp: new Date(),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "tool_authorized",
          toolName: "delete_file",
          level: 4,
          allowed: false,
          reason: "Destructive operation denied",
          timestamp: new Date(),
          sessionId: "other-session",
        });
        return {
          parts: textParts("ok"),
          inputTokens: 7,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
        } satisfies OrchestrateResult;
      }),
      model: "claude-sonnet-4-20250514",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);
    const ctx = makeBaseContext({ orchestrator, sessionRegistry });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    const artifacts = (session as unknown as { exactArtifacts: string[] }).exactArtifacts;
    expect(artifacts).toContain("Tool authority: read_file L1 allow (Read-only tool, auto-execute)");
    expect(artifacts).not.toContain("Tool authority: delete_file L4 deny (Destructive operation denied)");
  });

  it("persists structured file changes from tool executions into canonical turn artifacts", async () => {
    const session = makeMockSession();
    const orchestrator = {
      processMessage: vi.fn().mockResolvedValue({
        parts: textParts("updated"),
        inputTokens: 9,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        queued: false,
        toolExecutions: [{
          toolName: "write",
          durationMs: 12,
          success: true,
          resultSummary: "Wrote file",
          fileChanges: [{ path: "C:/workspace/src/demo.txt", changeType: "modified" }],
        }],
      } satisfies OrchestrateResult),
      model: "claude-sonnet-4-20250514",
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);
    const ctx = makeBaseContext({ orchestrator, sessionRegistry });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    const artifacts = (session as unknown as { exactArtifacts: string[] }).exactArtifacts;
    expect(artifacts).toContain("File changed: C:/workspace/src/demo.txt");
  });
});
