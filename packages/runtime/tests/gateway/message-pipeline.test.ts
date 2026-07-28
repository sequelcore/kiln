import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventBus, InMemoryContextArtifactCache, KilnError, MemoryArtifactResourceStore, SkillRegistry, coordinationStateToContextCandidates, extractText, textParts } from "@kilnai/core";
import type { MultimodalRoutedEvent, SttAdapter, TenantConfig, TtsAdapter, VoiceConfig } from "@kilnai/core";
import type { SkillConfig } from "@kilnai/core";
import { processAdmittedTurn, projectAdmittedTurnContext, sanitizeAssistantEgressText } from "../../src/gateway/message-pipeline.js";
import type { AdmittedTurnContext } from "../../src/gateway/message-pipeline.js";
import type { RuntimeSessionOrchestrator, OrchestrateResult } from "../../src/session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { ConversationEventEmitter } from "../../src/gateway/conversation-event-emitter.js";
import type { BillingConfig } from "../../src/gateway/budget-middleware.js";
import type { readRuntimeSupportArtifactsDetailed } from "../../src/session/support/artifacts/context-artifact-summary.js";
import { buildTenantSystemPrompt } from "../../src/tenant/system-prompt-builder.js";

const processInboundMessage = processAdmittedTurn;

const originalFetch = globalThis.fetch;

function memoryCandidates(content: string) {
  return [{
    kind: "memory" as const,
    source: "memory-recall:episodic",
    content,
    required: false,
    score: 0.8,
    memoryRecordId: "memory-test-record",
    estimatedTokens: Math.max(1, Math.ceil(content.length / 4)),
  }];
}

function makeMockSession(): RuntimeSession {
  let _userContext: Record<string, string> | undefined;
  let _sessionLedger: Record<string, unknown> = {};
  let _exactArtifacts: string[] = [];
  let _sessionEvents: Array<Record<string, unknown>> = [];
  let _systemPrompt = "You are a test assistant.";
  let _activeAgentId: string | undefined;
  const setSystemPrompt = vi.fn((prompt: string) => {
    _systemPrompt = prompt;
    (session as unknown as { systemPrompt: string }).systemPrompt = prompt;
  });
  const setActiveAgent = vi.fn((agentId: string) => {
    _activeAgentId = agentId;
    (session as unknown as { activeAgentId?: string }).activeAgentId = agentId;
  });

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
    activeAgentId: undefined as string | undefined,
    systemPrompt: _systemPrompt,
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
      return typeof lastEvent?.sequence === "number" ? (lastEvent.sequence as number) + 1 : 1;
    },
    appendSessionEvents(events: readonly Record<string, unknown>[]) {
      _sessionEvents = [..._sessionEvents, ...events];
    },
    setSystemPrompt,
    setActiveAgent,
    getActiveAgentId() {
      return _activeAgentId;
    },
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
      outcome: "completed",
      queued: false,
    } satisfies OrchestrateResult),
    registerTools: vi.fn(),
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

function makeSkillConfig(overrides: Partial<SkillConfig> = {}): SkillConfig {
  return {
    name: "runtime-governed-skill",
    description: "Routes procedural instructions through governed context.",
    tools: ["lookup_customer"],
    triggers: [],
    tags: ["support", "runtime"],
    filePath: "memory://runtime-governed-skill",
    instructions: "Always verify the runtime customer record before responding.",
    ...overrides,
  };
}

function makeGovernedWorkPerCallConfig(): NonNullable<AdmittedTurnContext["perCallConfig"]> {
  return {
    toolAllowlist: new Set(["work_governance.assess", "work_item.update", "work_item.execution.start", "work_item.execution.finish", "work_item.complete", "managed_agent.invoke"]),
    perCallCapabilities: new Map([
      ["work_governance.assess", {
        name: "work_governance.assess",
        description: "Assess governed work.",
        schema: {},
        tags: [],
        annotations: { idempotent: true },
      }],
      ["work_item.update", {
        name: "work_item.update",
        description: "Create or update governed work.",
        schema: {},
        tags: [],
        annotations: { idempotent: true },
      }],
      ["work_item.execution.start", {
        name: "work_item.execution.start",
        description: "Start governed execution.",
        schema: {},
        tags: [],
        annotations: { idempotent: true },
      }],
      ["work_item.execution.finish", {
        name: "work_item.execution.finish",
        description: "Finish governed execution.",
        schema: {},
        tags: [],
        annotations: { idempotent: true },
      }],
      ["work_item.complete", {
        name: "work_item.complete",
        description: "Complete governed work.",
        schema: {},
        tags: [],
        annotations: { idempotent: true },
      }],
      ["managed_agent.invoke", {
        name: "managed_agent.invoke",
        description: "Invoke a managed agent.",
        schema: {},
        tags: [],
        annotations: { idempotent: true },
      }],
    ]),
  };
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

function getGovernedContextContent(orchestrator: RuntimeSessionOrchestrator): string {
  const callArgs = (orchestrator.processMessage as ReturnType<typeof vi.fn>).mock.calls[0];
  const governedContextArg = callArgs[2] as { readonly content?: string } | undefined;
  return governedContextArg?.content ?? "";
}

describe("processAdmittedTurn", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ allowed: true, remaining: 50000, unit: "tokens" }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses per-call persisted turn id for canonical runtime session events", async () => {
    const session = new RuntimeSession({
      sessionId: "session-parent",
      appName: "test-app",
      tenantId: "test-tenant",
      userId: "user-1",
      systemPrompt: "You are a test assistant.",
    });
    session.addUserMessage(textParts("Hydrated prior turn 2."));
    session.addUserMessage(textParts("Hydrated prior turn 3."));
    session.addUserMessage(textParts("Hydrated prior turn 4."));
    session.addUserMessage(textParts("Hydrated prior turn 5."));
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async (
        runtimeSession: RuntimeSession,
        userParts: Parameters<RuntimeSession["addUserMessage"]>[0],
      ) => {
        runtimeSession.addUserMessage(userParts);
        runtimeSession.addAssistantMessage(textParts("started child"));
        return {
          parts: textParts("started child"),
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outcome: "completed",
          queued: false,
        } satisfies OrchestrateResult;
      }),
      registerTools: vi.fn(),
      model: "claude-sonnet-4-20250514",
    } as unknown as RuntimeSessionOrchestrator;
    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
      perCallConfig: { turnId: `${session.id}:turn:3` },
      userParts: textParts("Start child."),
    }));

    expect(result.ok).toBe(true);
    expect(session.userTurnCount).toBe(5);
    expect(session.sessionEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "turn_started",
        turnId: `${session.id}:turn:3`,
        turnOrdinal: 3,
      }),
      expect.objectContaining({
        kind: "user_message",
        turnId: `${session.id}:turn:3`,
        messageId: `${session.id}:turn:3:user`,
      }),
      expect.objectContaining({
        kind: "turn_completed",
        turnId: `${session.id}:turn:3`,
      }),
    ]));
  });

  it("publishes persisted completion context usage through the canonical event stream", async () => {
    const session = makeMockSession();
    const sessionRegistry = makeMockSessionRegistry(session);
    const published: Array<readonly Record<string, unknown>[]> = [];

    const result = await processInboundMessage(makeBaseContext({
      sessionRegistry,
      perCallConfig: { turnId: `${session.id}:turn:1` },
      publishCanonicalSessionEvents: (events) => published.push(events),
    }));

    expect(result.ok).toBe(true);
    expect(sessionRegistry.save).toHaveBeenCalledTimes(1);
    expect(published).toHaveLength(1);
    expect(published[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "context_usage_observed",
        turnId: `${session.id}:turn:1`,
        contextUsage: expect.objectContaining({
          state: "unavailable",
          lifecycle: "completed",
        }),
      }),
    ]));
  });

  it("attributes context usage to the successful retry or fallback route, not the initial route", async () => {
    const session = makeMockSession();
    const orchestrator = {
      processMessage: vi.fn().mockResolvedValue({
        parts: textParts("retried response"),
        inputTokens: 2_400,
        outputTokens: 120,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outcome: "completed",
        queued: false,
        providerRequests: [
          { providerId: "openai", modelId: "gpt-5", inputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
          {
            providerId: "anthropic",
            modelId: "claude-sonnet",
            inputTokens: 2_000,
            cacheReadTokens: 300,
            cacheWriteTokens: 100,
            contextUsage: { cacheSemantics: "additive_to_input", measurement: "provider_reported" },
          },
        ],
      } as unknown as OrchestrateResult),
      registerTools: vi.fn(),
      model: "gpt-5",
    } as unknown as RuntimeSessionOrchestrator;

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
      perCallConfig: { turnId: `${session.id}:turn:1` },
      contextUsageWindow: {
        providerId: "anthropic",
        modelId: "claude-sonnet",
        tokens: 8_000,
        authority: "provider_reported",
        freshness: "fresh",
      },
    }));

    expect(result.ok).toBe(true);
    expect(session.sessionEvents).toContainEqual(expect.objectContaining({
      kind: "context_usage_observed",
      contextUsage: expect.objectContaining({
        state: "authoritative",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        usedTokens: 2_400,
        usedPercentage: 30,
      }),
    }));
  });

  it("projects visitor context as a separate governed candidate", () => {
    const projected = projectAdmittedTurnContext({
      userContext: undefined,
      cachedRuntimeSummary: undefined,
      recalledMemoryCandidates: undefined,
      knowledgeContext: undefined,
      contactContext: "contact profile",
      visitorContext: "visitor browser state",
      groundingMode: undefined,
    });

    expect(projected.content).toContain("contact profile");
    expect(projected.content).toContain("visitor browser state");
    expect(projected.audit?.blocks).toContainEqual(expect.objectContaining({
      source: "runtime-contact-context",
      decision: "admitted",
    }));
    expect(projected.audit?.blocks).toContainEqual(expect.objectContaining({
      source: "runtime-visitor-context",
      decision: "admitted",
    }));
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

  it("projects an approved context policy through the existing ContextGovernor owner", () => {
    const projected = projectAdmittedTurnContext({
      userContext: undefined,
      cachedRuntimeSummary: undefined,
      recalledMemoryCandidates: undefined,
      knowledgeContext: undefined,
      contactContext: undefined,
      groundingMode: undefined,
      proceduralContextCandidates: [{
        kind: "procedural",
        source: "adaptation-fixture",
        content: "unsplit canonical source",
        score: 0.5,
        segments: [
          { id: "segment-a", content: "selected segment A", score: 0.9 },
          { id: "segment-b", content: "selected segment B", score: 0.8 },
        ],
      }],
      contextPolicy: {
        policyId: "context-segmented-v1",
        configurationHash: `sha256:${"a".repeat(64)}`,
        contextAllocationMode: "segmented",
      },
    });

    expect(projected.content).toContain("selected segment A");
    expect(projected.content).not.toContain("unsplit canonical source");
    expect(projected.audit?.allocationMode).toBe("segmented");
  });

  it("keeps lifecycle attribution out of the provider request and task outcome", async () => {
    const session = makeMockSession();
    const observedProviderCalls: unknown[] = [];
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async (...args: unknown[]) => {
        observedProviderCalls.push(args);
        expect(session.sessionEvents).toEqual([]);
        eventBus.emit({
          type: "cost_update",
          provider: "codex-oauth",
          model: "gpt-5.5",
          canonicalModel: "gpt-5.5",
          billingMode: "metered",
          inputTokens: 400,
          outputTokens: 8,
          cacheReadTokens: 4,
          cacheWriteTokens: 0,
          totalCostUsd: 0.0042,
          byRoleModel: {},
          timestamp: new Date("2026-06-30T12:00:01.000Z"),
          sessionId: session.id,
        });
        return {
          parts: textParts("neutral response"),
          inputTokens: 400,
          outputTokens: 8,
          cacheReadTokens: 4,
          cacheWriteTokens: 0,
          outcome: "completed",
          queued: false,
        } satisfies OrchestrateResult;
      }),
      registerTools: vi.fn(),
      model: "gpt-5.5",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
      recalledMemoryCandidates: memoryCandidates("Relevant durable memory."),
      knowledgeContext: "Verified knowledge context.",
      userParts: textParts("Prove request neutrality."),
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.parts).toEqual(textParts("neutral response"));
      expect(result.result.inputTokens).toBe(400);
      expect(result.result.outputTokens).toBe(8);
      expect(result.result.cacheReadTokens).toBe(4);
      expect(result.result.cacheWriteTokens).toBe(0);
    }
    expect(observedProviderCalls).toHaveLength(1);
    expect(observedProviderCalls[0]).toEqual([
      session,
      textParts("Prove request neutrality."),
      expect.objectContaining({
        content: expect.stringContaining("Relevant durable memory."),
      }),
      undefined,
      undefined,
    ]);
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "turn_started",
      "user_message",
      "continuity_decided",
      "cost_updated",
      "lifecycle_attribution_recorded",
      "context_usage_observed",
      "assistant_message",
      "turn_completed",
    ]);
    expect(session.sessionEvents).toContainEqual(expect.objectContaining({
      kind: "lifecycle_attribution_recorded",
      ledger: expect.objectContaining({
        records: expect.arrayContaining([
          expect.objectContaining({
            source: "memory",
            quality: "estimated",
          }),
          expect.objectContaining({
            source: "knowledge",
            quality: "estimated",
          }),
          expect.objectContaining({
            source: "unknown",
            providerTokenClass: "input",
            quality: "unknown",
          }),
        ]),
      }),
    }));
    expect(session.sessionEvents.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "completed",
    });
  });

  it("attributes final output from the runtime completion before gateway egress appends sources", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "cost_update",
          provider: "codex-oauth",
          model: "gpt-5.5",
          inputTokens: 10,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCostUsd: 0.001,
          byRoleModel: {},
          timestamp: new Date("2026-06-30T12:00:01.000Z"),
          sessionId: session.id,
        });
        return {
          parts: textParts("done"),
          inputTokens: 10,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outcome: "completed",
          queued: false,
          toolExecutions: [{
            toolName: "web_search",
            durationMs: 12,
            success: true,
            resultSummary: "Found relevant source pages.",
            metadata: {
              sources: [{
                title: "Kiln docs",
                url: "https://docs.example.com/kiln",
              }],
            },
          }],
        } satisfies OrchestrateResult;
      }),
      registerTools: vi.fn(),
      model: "gpt-5.5",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(extractText(result.result.parts)).toContain("https://docs.example.com/kiln");
    }
    const attribution = session.sessionEvents.find((event) => event.kind === "lifecycle_attribution_recorded");
    expect(attribution).toMatchObject({
      ledger: {
        records: expect.arrayContaining([
          expect.objectContaining({
            source: "final_output",
            providerTokenClass: "output",
            tokens: 1,
            quality: "estimated",
          }),
        ]),
      },
    });
    expect(attribution).not.toMatchObject({
      ledger: {
        records: expect.arrayContaining([
          expect.objectContaining({
            source: "unknown",
            providerTokenClass: "output",
          }),
        ]),
      },
    });
  });

  it("persists cost and lifecycle attribution when post-provider voice synthesis fails", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "cost_update",
          provider: "codex-oauth",
          model: "gpt-5.5",
          inputTokens: 10,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCostUsd: 0.001,
          byRoleModel: {},
          timestamp: new Date("2026-06-30T12:00:01.000Z"),
          sessionId: session.id,
        });
        return {
          parts: textParts("done"),
          inputTokens: 10,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outcome: "completed",
          queued: false,
        } satisfies OrchestrateResult;
      }),
      registerTools: vi.fn(),
      model: "gpt-5.5",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;
    const ttsAdapter: TtsAdapter = {
      name: "failing-tts",
      synthesize: vi.fn().mockRejectedValue(new Error("TTS unavailable")),
    };
    const abort = vi.fn();

    await expect(processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
      voiceConfig: {
        tts: { provider: "failing-tts", command: "failing-tts" },
        policy: {
          surfaces: {
            api: {
              enabled: true,
              output: { modes: ["audio-response"], failureMode: "fail-closed" },
            },
          },
        },
      },
      ttsAdapter,
      turnCapture: { abort },
    }))).rejects.toThrow("TTS unavailable");

    expect(abort).toHaveBeenCalledWith(session.id);
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "turn_started",
      "user_message",
      "continuity_decided",
      "cost_updated",
      "lifecycle_attribution_recorded",
      "error_recorded",
      "assistant_message",
      "turn_completed",
    ]);
    expect(session.sessionEvents.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "failed",
    });
  });

  it("does not append a second failed canonical turn when saving completed events fails", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "cost_update",
          provider: "codex-oauth",
          model: "gpt-5.5",
          inputTokens: 10,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCostUsd: 0.001,
          byRoleModel: {},
          timestamp: new Date("2026-06-30T12:00:01.000Z"),
          sessionId: session.id,
        });
        return {
          parts: textParts("done"),
          inputTokens: 10,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outcome: "completed",
          queued: false,
        } satisfies OrchestrateResult;
      }),
      registerTools: vi.fn(),
      model: "gpt-5.5",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);
    (sessionRegistry.save as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("store down"));
    const abort = vi.fn();

    await expect(processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry,
      turnCapture: { abort },
    }))).rejects.toThrow("store down");

    expect(sessionRegistry.save).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith(session.id);
    expect(session.sessionEvents.filter((event) => event.kind === "turn_started")).toHaveLength(1);
    expect(session.sessionEvents.filter((event) => event.kind === "turn_completed")).toHaveLength(1);
    expect(session.sessionEvents.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "completed",
    });
  });

  it("records an operator-aborted turn as cancelled without an error event", async () => {
    const session = makeMockSession();
    const controller = new AbortController();
    controller.abort("Operator cancelled the turn.");
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "error",
          code: "EXECUTABLE_SESSION_ERROR",
          message: "Operation aborted",
          taskId: null,
          timestamp: new Date("2026-07-16T01:47:57.582Z"),
          sessionId: session.id,
        });
        throw new KilnError("PROVIDER_UNAVAILABLE", "Runtime provider request was aborted before completion");
      }),
      registerTools: vi.fn(),
      model: "gpt-5.5",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;
    const publishCanonicalSessionEvents = vi.fn();

    await expect(processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
      perCallConfig: { abortSignal: controller.signal },
      publishCanonicalSessionEvents,
    }))).rejects.toThrow("aborted before completion");

    expect(session.sessionEvents.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "cancelled",
    });
    expect(session.sessionEvents.some((event) => event.kind === "error_recorded")).toBe(false);
    expect(publishCanonicalSessionEvents).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ kind: "turn_completed", outcome: "cancelled" }),
    ]));
  });

  it("preserves non-cancellation failures that occurred before an operator abort", async () => {
    const session = makeMockSession();
    const controller = new AbortController();
    controller.abort("Operator cancelled the turn.");
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "error",
          code: "TOOL_EXECUTION_FAILED",
          message: "Read failed before cancellation",
          taskId: null,
          timestamp: new Date("2026-07-16T01:47:56.000Z"),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "error",
          code: "EXECUTABLE_SESSION_ERROR",
          message: "Operation aborted",
          taskId: null,
          timestamp: new Date("2026-07-16T01:47:57.582Z"),
          sessionId: session.id,
        });
        throw new KilnError("PROVIDER_UNAVAILABLE", "Runtime provider request was aborted before completion");
      }),
      registerTools: vi.fn(),
      model: "gpt-5.5",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;

    await expect(processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
      perCallConfig: { abortSignal: controller.signal },
    }))).rejects.toThrow("aborted before completion");

    expect(session.sessionEvents.filter((event) => event.kind === "error_recorded")).toEqual([
      expect.objectContaining({
        kind: "error_recorded",
        errorCode: "TOOL_EXECUTION_FAILED",
        message: "Read failed before cancellation",
      }),
    ]);
    expect(session.sessionEvents.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "cancelled",
    });
  });

  it("captures inbound multimodal parts as replayable artifacts before runtime orchestration", async () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-13T12:00:00.000Z" });
    const orchestrator = makeMockOrchestrator();
    const ctx = makeBaseContext({
      orchestrator,
      artifactStore,
      userParts: [
        { type: "text", text: "Describe this image." },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
      ],
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    expect(orchestrator.processMessage).toHaveBeenCalledWith(
      expect.anything(),
      [
        { type: "text", text: "Describe this image." },
        {
          type: "image",
          mimeType: "image/png",
          data: "iVBORw0KGgo=",
          artifactUri: "kiln://artifacts/inbound-multimodal/artifact_1/content",
        },
      ],
      expect.anything(),
      undefined,
      undefined,
    );
    expect(artifactStore.get("inbound-multimodal", "artifact_1")).toMatchObject({
      mimeType: "image/png",
      multimodal: {
        modality: "image",
        source: { kind: "uploaded-file", id: "test-app:test-tenant:user-1:api:part:1" },
      },
    });
  });

  it("transcribes configured voice input before runtime orchestration", async () => {
    const session = makeMockSession();
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-16T00:00:00.000Z" });
    const orchestrator = makeMockOrchestrator();
    const sttAdapter: SttAdapter = {
      name: "whisper-local",
      transcribe: vi.fn().mockResolvedValue({
        text: "hello from microphone",
        confidence: 0.92,
        durationMs: 1200,
      }),
    };
    const voiceConfig: VoiceConfig = {
      stt: { provider: "whisper-local", command: "whisper-local" },
      tts: { provider: "kokoro-local", command: "kokoro-local", format: "wav" },
      policy: {
        artifacts: { storeSourceAudio: true, retentionMaxArtifacts: 10 },
        surfaces: {
          gui: {
            enabled: true,
            input: { modes: ["microphone", "file"], failureMode: "fail-closed" },
          },
        },
      },
    };

    const result = await processInboundMessage(makeBaseContext({
      sessionRegistry: makeMockSessionRegistry(session),
      orchestrator,
      artifactStore,
      voiceConfig,
      sttAdapter,
      channel: "gui",
      userParts: [
        { type: "audio", mimeType: "audio/webm", data: "AQID" },
      ],
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.admittedInput).toEqual({
        content: "[Voice note transcription]: hello from microphone",
      });
    }
    expect(sttAdapter.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), "audio/webm");
    expect(orchestrator.processMessage).toHaveBeenCalledWith(
      expect.anything(),
      [{ type: "text", text: "[Voice note transcription]: hello from microphone" }],
      expect.anything(),
      undefined,
      undefined,
    );
    expect(session.sessionEvents).toContainEqual(expect.objectContaining({
      kind: "multimodal_routed",
      strategy: "transform",
      reasonCode: "audio_transcription_transform_succeeded",
      requestedCapability: "transcription",
      artifactUris: ["kiln://artifacts/inbound-multimodal/artifact_1/content"],
    }));
  });

  it("fails closed with a clear STT configuration error before raw audio reaches the model", async () => {
    const orchestrator = makeMockOrchestrator();
    const voiceConfig: VoiceConfig = {
      stt: { provider: "whisper-local", commandEnv: "KILN_WHISPER_COMMAND" },
      tts: { provider: "kokoro-local", commandEnv: "KILN_KOKORO_COMMAND" },
      policy: {
        defaultInputFailureMode: "fail-closed",
        surfaces: {
          gui: {
            enabled: true,
            input: { modes: ["microphone"] },
          },
        },
      },
    };

    await expect(processInboundMessage(makeBaseContext({
      orchestrator,
      voiceConfig,
      channel: "gui",
      userParts: [
        { type: "audio", mimeType: "audio/webm", data: "AQID" },
      ],
    }))).rejects.toThrow("Voice input requested but no STT adapter is configured.");

    expect(orchestrator.processMessage).not.toHaveBeenCalled();
  });

  it("records submitted plans as canonical session events in plan execution mode", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Plan submitted."),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
      toolExecutions: [{
        toolCallId: "tool-plan",
        toolName: "submit_plan",
        input: {
          objective: "Implement execution mode lifecycle.",
          nonGoals: ["Do not execute implementation in plan mode."],
          operatorDecisionsRequired: ["Approve transition to execute mode."],
          assumptions: ["Existing event replay remains canonical."],
          affectedSurfaces: ["runtime", "cli"],
          riskClassification: "high",
          workGovernanceRecommendation: {
            posture: "orchestrate",
            rationale: "Multi-file runtime workflow change.",
            workflowProfile: "architecture-change",
          },
          proposedWorkItems: [{
            id: "wi-1",
            summary: "Add typed contract.",
            workflowProfile: "architecture-change",
            risk: "high",
            expectedEvidence: ["tests"],
            verificationGates: ["bun test"],
            dependencies: [],
          }],
          expectedEvidence: ["tests", "typecheck"],
          verificationGates: ["bun test", "bun run typecheck"],
          managedAgentDelegationCandidates: ["reviewer"],
          approvalBoundaries: ["approve plan before execution"],
          rollbackNotes: "Rollback event payload to prior shape if needed.",
          residualRisks: ["consumer parser drift"],
          sourceSpecificationId: "spec_1",
          clarificationRecordIds: ["clar_1"],
          constitutionSnapshot: {
            instructionProfileHash: "hash-1",
            instructionProfileIds: ["sequel-engineering"],
          },
        },
        durationMs: 1,
        success: true,
        output: JSON.stringify({
          output: "Plan submitted.",
          isError: false,
          metadata: {
            toolName: "submit_plan",
            operation: "submit_plan",
            planId: "tool-plan",
            analysisReportId: "analysis_report_1",
            analysisStatus: "ready",
            analysisHighestSeverity: "low",
            analysisFindingCount: 1,
            analysisBlockingFindingCount: 0,
            analysisFindingIds: ["analysis_finding_1"],
            analysisBlockingFindingIds: [],
            analysisFindings: [{
              id: "analysis_finding_1",
              fingerprint: "fingerprint-1",
              category: "terminology_drift",
              severity: "low",
              title: "Actor Terminology Drift",
              detail: "Actor is not referenced in the plan.",
              references: ["specification:spec_1", "plan:tool-plan"],
              status: "open",
            }],
            analysisSummary: "No critical findings. Ready for approval.",
            sourceSpecificationId: "spec_1",
          },
        }),
        resultSummary: "Plan submitted.",
        metadata: {
          operation: "submit_plan",
          planId: "tool-plan",
          analysisReportId: "analysis_report_1",
          analysisStatus: "ready",
          analysisHighestSeverity: "low",
          analysisFindingCount: 1,
          analysisBlockingFindingCount: 0,
          analysisFindingIds: ["analysis_finding_1"],
          analysisBlockingFindingIds: [],
          analysisFindings: [{
            id: "analysis_finding_1",
            fingerprint: "fingerprint-1",
            category: "terminology_drift",
            severity: "low",
            title: "Actor Terminology Drift",
            detail: "Actor is not referenced in the plan.",
            references: ["specification:spec_1", "plan:tool-plan"],
            status: "open",
          }],
          analysisSummary: "No critical findings. Ready for approval.",
          sourceSpecificationId: "spec_1",
        },
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      executionMode: "plan",
      sessionRegistry: makeMockSessionRegistry(session),
      orchestrator,
    }));

    expect(result.ok).toBe(true);
    expect(session.sessionEvents).toContainEqual(expect.objectContaining({
      kind: "plan_submitted",
      planId: "tool-plan",
      mode: "plan",
      objective: "Implement execution mode lifecycle.",
      riskClassification: "high",
      workflowProfile: "architecture-change",
      sourceSpecificationId: "spec_1",
      proposedWorkItems: [{
        id: "wi-1",
        summary: "Add typed contract.",
        workflowProfile: "architecture-change",
        risk: "high",
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        dependencies: [],
      }],
    }));
    expect(session.sessionEvents).toContainEqual(expect.objectContaining({
      kind: "plan_analysis_reported",
      reportId: "analysis_report_1",
      planId: "tool-plan",
      specificationId: "spec_1",
      status: "ready",
      highestSeverity: "low",
      findings: [expect.objectContaining({
        id: "analysis_finding_1",
        category: "terminology_drift",
        status: "open",
      })],
    }));
  });

  it("projects normalized plan fields from submit_plan metadata over raw input", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Plan submitted."),
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
      toolExecutions: [{
        toolCallId: "tool-plan-metadata",
        toolName: "submit_plan",
        input: {
          objective: "  Ship structured plan contract  ",
          nonGoals: ["  duplicate  ", "duplicate", "  legacy mode "],
          expectedEvidence: [" tests ", "tests"],
          verificationGates: ["bun test", " bun test "],
          sourceSpecificationId: " spec_1 ",
          riskClassification: "high",
          workGovernanceRecommendation: {
            posture: "orchestrate",
            workflowProfile: "architecture-change",
          },
        },
        durationMs: 1,
        success: true,
        output: "Plan submitted.",
        resultSummary: "Plan submitted.",
        metadata: {
          operation: "submit_plan",
          planId: "plan_1",
          summary: "Ship structured plan contract",
          objective: "Ship structured plan contract",
          nonGoals: ["duplicate", "legacy mode"],
          expectedEvidence: ["tests"],
          verificationGates: ["bun test"],
          sourceSpecificationId: "spec_1",
          riskClassification: "high",
          workGovernancePosture: "orchestrate",
          workflowProfile: "architecture-change",
          proposedWorkItemCount: 1,
          constitutionSnapshotHash: "hash-1",
          clarificationRecordIds: ["clar_1"],
        },
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      executionMode: "plan",
      sessionRegistry: makeMockSessionRegistry(session),
      orchestrator,
    }));

    expect(result.ok).toBe(true);
    expect(session.sessionEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "plan_submitted",
        planId: "plan_1",
        objective: "Ship structured plan contract",
        nonGoals: ["duplicate", "legacy mode"],
        expectedEvidence: ["tests"],
        verificationGates: ["bun test"],
        sourceSpecificationId: "spec_1",
        summary: "Ship structured plan contract",
      }),
    ]));
  });

  it("records specification and clarification events in plan execution mode", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Specification captured."),
      inputTokens: 12,
      outputTokens: 7,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
      toolExecutions: [{
        toolCallId: "tool-spec",
        toolName: "submit_specification",
        input: {
          specificationId: "spec_1",
          title: "Slice 1",
          objective: "Implement structured specification intake.",
        },
        durationMs: 2,
        success: true,
        output: "Specification submitted.",
        resultSummary: "Specification spec_1 is ready for planning.",
        metadata: {
          toolName: "submit_specification",
          operation: "submit_specification",
          specificationId: "spec_1",
          specificationStatus: "ready_for_plan",
          issues: [],
          blockingIssueCodes: [],
        },
      }, {
        toolCallId: "tool-clar",
        toolName: "record_clarification",
        input: {
          specificationId: "spec_1",
          question: "Should plan mode remain read-only?",
          answer: "Yes.",
          affectedSection: "authority",
          rationale: "Plan mode must not mutate workspace files.",
        },
        durationMs: 1,
        success: true,
        output: "Clarification recorded.",
        resultSummary: "Clarification recorded.",
        metadata: {
          toolName: "record_clarification",
          operation: "record_clarification",
          specificationId: "spec_1",
          clarificationId: "clar_1",
          affectedSection: "authority",
        },
      }, {
        toolCallId: "tool-plan",
        toolName: "submit_plan",
        input: {
          objective: "Validate schema and add resources.",
          nonGoals: ["Do not execute implementation work in plan mode."],
          operatorDecisionsRequired: ["Approve execution transition."],
          assumptions: ["Specification schema remains stable."],
          affectedSurfaces: ["core", "runtime"],
          riskClassification: "medium",
          workGovernanceRecommendation: {
            posture: "orchestrate",
            rationale: "Cross-package updates.",
            workflowProfile: "verification-heavy",
          },
          proposedWorkItems: [{
            id: "wi-2",
            summary: "Validate schema projection.",
            workflowProfile: "verification-heavy",
            risk: "medium",
            expectedEvidence: ["tests"],
            verificationGates: ["bun test"],
            dependencies: [],
          }],
          expectedEvidence: ["tests"],
          verificationGates: ["bun test"],
          managedAgentDelegationCandidates: ["reviewer"],
          approvalBoundaries: ["Require approval before execute mode."],
          rollbackNotes: "Revert contract changes.",
          residualRisks: ["presentation drift"],
          sourceSpecificationId: "spec_1",
          clarificationRecordIds: ["clar_1"],
          constitutionSnapshot: {
            instructionProfileHash: "hash-1",
            instructionProfileIds: ["sequel-engineering"],
          },
        },
        durationMs: 1,
        success: true,
        output: "Plan submitted.",
        resultSummary: "Plan submitted.",
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      executionMode: "plan",
      sessionRegistry: makeMockSessionRegistry(session),
      orchestrator,
    }));

    expect(result.ok).toBe(true);
    expect(session.sessionEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "specification_submitted",
        specificationId: "spec_1",
        status: "ready_for_plan",
      }),
      expect.objectContaining({
        kind: "clarification_recorded",
        specificationId: "spec_1",
        clarificationId: "clar_1",
        affectedSection: "authority",
      }),
    ]));
  });

  it("projects specification validation issue codes from submit_specification metadata", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Specification captured."),
      inputTokens: 10,
      outputTokens: 6,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
      toolExecutions: [{
        toolCallId: "tool-spec-draft",
        toolName: "submit_specification",
        input: {
          specificationId: "spec_2",
          title: "Draft spec",
        },
        durationMs: 1,
        success: true,
        output: "Specification submitted.",
        resultSummary: "Specification submitted with blocking issues.",
        metadata: {
          operation: "submit_specification",
          specificationId: "spec_2",
          specificationStatus: "draft",
          blockingIssueCodes: ["missing_non_goals", "vague_success_criteria"],
          issues: [
            { code: "missing_non_goals", field: "nonGoals", blocking: true },
            { code: "vague_success_criteria", field: "successCriteria", blocking: true },
          ],
        },
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      executionMode: "plan",
      sessionRegistry: makeMockSessionRegistry(session),
      orchestrator,
    }));

    expect(result.ok).toBe(true);
    expect(session.sessionEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "specification_submitted",
        specificationId: "spec_2",
        status: "draft",
        issueCodes: ["missing_non_goals", "vague_success_criteria"],
        blockingIssueCodes: ["missing_non_goals", "vague_success_criteria"],
      }),
    ]));
  });

  it("does not record plan_submitted when submit_plan returns an error envelope", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Plan blocked."),
      inputTokens: 8,
      outputTokens: 6,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
      toolExecutions: [{
        toolCallId: "tool-plan-failed",
        toolName: "submit_plan",
        input: {
          objective: "Invalid high-risk plan",
          riskClassification: "high",
          sourceSpecificationId: "spec_1",
          workGovernanceRecommendation: {
            posture: "orchestrate",
            workflowProfile: "architecture-change",
          },
        },
        durationMs: 1,
        success: false,
        output: "Plan plan_1 submitted with blocking validation issues.",
        resultSummary: "Plan blocked.",
        metadata: {
          operation: "submit_plan",
          planId: "plan_1",
          planStatus: "draft",
          blockingIssueCodes: ["missing_operator_decisions"],
          analysisReportId: "analysis_report_2",
          analysisStatus: "blocked",
          analysisHighestSeverity: "critical",
          analysisFindingCount: 1,
          analysisBlockingFindingCount: 1,
          analysisFindingIds: ["analysis_finding_9"],
          analysisBlockingFindingIds: ["analysis_finding_9"],
          analysisSummary: "1 critical finding blocks approval.",
          sourceSpecificationId: "spec_1",
        },
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      executionMode: "plan",
      sessionRegistry: makeMockSessionRegistry(session),
      orchestrator,
    }));

    expect(result.ok).toBe(true);
    expect(session.sessionEvents.some((event) => event.kind === "plan_submitted")).toBe(false);
    expect(session.sessionEvents).toContainEqual(expect.objectContaining({
      kind: "plan_analysis_reported",
      reportId: "analysis_report_2",
      planId: "plan_1",
      specificationId: "spec_1",
      status: "blocked",
      highestSeverity: "critical",
      blockingFindingIds: ["analysis_finding_9"],
    }));
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

  it("hydrates an expired persisted operator session before orchestration", async () => {
    const session = makeMockSession();
    const sessionRegistry = {
      getById: vi.fn().mockResolvedValue(undefined),
      getOrCreate: vi.fn().mockResolvedValue(session),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionRegistry;
    const orchestrator = makeMockOrchestrator();
    const resumeSessionHydrator = vi.fn().mockResolvedValue({
      rehydrated: true,
      messageCount: 4,
      reason: "transcript-store",
      sourceSequence: 12,
    });

    await processInboundMessage(makeBaseContext({
      sessionId: "persisted-session-1",
      sessionRegistry,
      orchestrator,
      resumeSessionHydrator,
    }));

    expect(sessionRegistry.getById).toHaveBeenCalledWith("persisted-session-1");
    expect(resumeSessionHydrator).toHaveBeenCalledWith({
      sessionId: "persisted-session-1",
      session,
    });
    expect(session.exactArtifacts).toContain("Runtime session rehydrated from transcript: 4 messages");
    expect(orchestrator.processMessage).toHaveBeenCalledWith(
      session,
      textParts("hello"),
      expect.anything(),
      undefined,
      undefined,
    );
  });

  it("builds session bootstrap prompt from tenant when systemPrompt is omitted", async () => {
    const sessionRegistry = makeMockSessionRegistry();
    const now = new Date().toISOString();
    const tenant: TenantConfig = {
      tenantId: "tenant-1",
      appName: "test-app",
      name: "Tenant One",
      enabled: true,
      tone: "friendly",
      language: "es-MX",
      createdAt: now,
      updatedAt: now,
    };
    const ctx = makeBaseContext({
      sessionRegistry,
      tenantId: "tenant-1",
      systemPrompt: undefined,
      tenant,
    });

    await processInboundMessage(ctx);

    expect(sessionRegistry.getOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: buildTenantSystemPrompt(tenant),
      }),
    );
  });

  it("passes tenantId to sessionRegistry.getOrCreate", async () => {
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({ sessionRegistry, tenantId: "tenant-1" });

    await processInboundMessage(ctx);

    expect(sessionRegistry.getOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1" }),
    );
  });

  it("passes recalledMemory to orchestrator as governed context", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      recalledMemoryCandidates: memoryCandidates("Previous context here."),
    });

    await processInboundMessage(ctx);

    expect(orchestrator.processMessage).toHaveBeenCalledWith(
      expect.anything(),
      textParts("hello"),
      expect.objectContaining({
        content: expect.stringContaining("Previous context here."),
        audit: expect.objectContaining({ governor: "DefaultContextGovernor" }),
      }),
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
      expect.objectContaining({
        content: expect.stringContaining("Authority mode: auto."),
        audit: expect.objectContaining({ governor: "DefaultContextGovernor" }),
      }),
      builtinTools,
      undefined,
    );
  });

  it("retrieves knowledge context in auto mode and appends it to governed context", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const knowledgePipeline = {
      retrieve: vi.fn().mockResolvedValue([
        { content: "Fact A" },
        { content: "Fact B" },
      ]),
    };
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      knowledgePipeline: knowledgePipeline as AdmittedTurnContext["knowledgePipeline"],
      knowledgeMode: "auto",
    });

    await processInboundMessage(ctx);

    expect(knowledgePipeline.retrieve).toHaveBeenCalledWith("hello", { topK: 5 });
    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toContain("[Knowledge context]:");
    expect(governedContextContent).toContain("Fact A");
    expect(governedContextContent).toContain("Fact B");
  });

  it("resolves tenant agent context in pipeline and forwards tenant tool context to orchestrator call", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry(session);
    const emitter = makeMockEventEmitter();
    const callBuiltinTools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>([
      ["mock_tool", vi.fn(async (input) => input)],
    ]);
    const toolDefinitions = [{
      name: "mock_tool",
      description: "Mock tool",
      inputSchema: {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      },
      tags: new Set(["builtin"]),
    }];
    const capabilities = new Map<string, unknown>([
      ["mock_tool", { name: "mock_tool" }],
    ]);
    const toolAuthority = new Map<string, unknown>([
      ["mock_tool", {
        level: 2,
        allowed: true,
        requiresApproval: false,
        reason: "Audited execution",
      }],
    ]);
    const toolAllowlist = new Set(["mock_tool"]);
    const rateLimiter = {
      check: vi.fn().mockReturnValue({ allowed: true }),
      record: vi.fn(),
    };

    const resolveSpy = vi
      .spyOn(await import("../../src/tenant/agent-resolver.js"), "resolveAgentContextAsync")
      .mockResolvedValue({
      systemPrompt: "Tenant-specific system prompt",
      tenantToolContext: {
        callBuiltinTools,
        toolDefinitions,
        capabilities,
        toolAuthority,
        toolAuthorityClassification: undefined,
        integrationAuthorityRollup: undefined,
        toolAllowlist,
        rateLimiter,
        executionEnvelope: undefined,
      },
      activeAgentId: "agent-support",
      activeAgentName: "Support Agent",
      routingResult: {
        agentId: "agent-support",
        confidence: 0.88,
        tier: "rule",
      },
      previousAgentId: "agent-router",
      isHandoff: true,
      handoffBrief: "handoff brief",
    });

    const tenant = {
      tenantId: "tenant-1",
      displayName: "Tenant One",
    } as AdmittedTurnContext["tenant"];
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      eventEmitter: emitter,
      tenantId: "_default",
      tenant,
      perCallConfig: { toolAllowlist: new Set(["mock_tool", "other_tenant_tool"]) },
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(orchestrator.registerTools).toHaveBeenCalledWith(toolDefinitions);
    expect(orchestrator.processMessage).toHaveBeenCalledWith(
      expect.anything(),
      textParts("hello"),
      expect.objectContaining({
        content: expect.stringContaining("Authority mode: auto."),
        audit: expect.objectContaining({ governor: "DefaultContextGovernor" }),
      }),
      callBuiltinTools,
      expect.objectContaining({
        tenantId: "tenant-1",
        toolAuthority,
        toolAllowlist: new Set(["mock_tool"]),
        rateLimiter,
        additionalTools: toolDefinitions,
        perCallCapabilities: capabilities,
      }),
    );
    expect(session.setSystemPrompt).toHaveBeenCalledWith("Tenant-specific system prompt");
    expect(session.setActiveAgent).toHaveBeenCalledWith("agent-support", "handoff brief");

    if (result.ok) {
      expect(result.result.activeAgentId).toBe("agent-support");
    }
    const emitted = (emitter.emit as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(emitted).toContainEqual(expect.objectContaining({
      eventType: "AGENT_ROUTED",
      tenantId: "tenant-1",
      activeAgentId: "agent-support",
      activeAgentName: "Support Agent",
      routingTier: "rule",
      routingConfidence: 0.88,
    }));

    resolveSpy.mockRestore();
  });

  it("prepends [User Context] block first in governed context when userContext is present", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      userContext: { role: "admin" },
      recalledMemoryCandidates: memoryCandidates("Previous context here."),
    });

    await processInboundMessage(ctx);

    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toBeDefined();
    expect(governedContextContent.startsWith("[User Context]:")).toBe(true);
    expect(governedContextContent).toContain("Previous context here.");
  });

  it("omits [User Context] block from governed context when userContext is absent", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      recalledMemoryCandidates: memoryCandidates("Previous context here."),
    });

    await processInboundMessage(ctx);

    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).not.toContain("[User Context]");
  });

  it("preserves admitted-turn context projection ordering and grounding directive application", async () => {
    const supportSpy = vi
      .spyOn(await import("../../src/session/support/artifacts/context-artifact-summary.js"), "readRuntimeSupportArtifactsDetailed")
      .mockReturnValue({
      content: "cached runtime summary",
      supportArtifactCount: 0,
      supportArtifactSources: [],
      fallbackLabel: undefined,
      usedCachedSupport: false,
      selectionReason: "none",
      decision: {
        resumeStrategy: "none",
        cachedResumeSignalCount: 0,
      },
    } as ReturnType<typeof readRuntimeSupportArtifactsDetailed>);
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      userContext: { role: "admin" },
      recalledMemoryCandidates: memoryCandidates("recalled memory"),
      knowledgeContext: "knowledge context",
      contactContext: "contact context",
      groundingMode: "strict",
    });

    await processInboundMessage(ctx);

    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toBeDefined();
    expect(governedContextContent).toContain("[User Context]:\nrole: admin");
    expect(governedContextContent).toContain("cached runtime summary");
    expect(governedContextContent).toContain("recalled memory");
    expect(governedContextContent).toContain("knowledge context");
    expect(governedContextContent).toContain("contact context");
    expect(governedContextContent).toMatch(
      /\[User Context\]:\nrole: admin[\s\S]*cached runtime summary[\s\S]*recalled memory[\s\S]*knowledge context[\s\S]*contact context/,
    );
    expect(governedContextContent).toContain("--- Grounding Rules ---");

    supportSpy.mockRestore();
  });

  it("governs admitted-turn context under the core budget instead of replaying oversized memory", async () => {
    const supportSpy = vi
      .spyOn(await import("../../src/session/support/artifacts/context-artifact-summary.js"), "readRuntimeSupportArtifactsDetailed")
      .mockReturnValue({
      content: "cached runtime summary",
      supportArtifactCount: 0,
      supportArtifactSources: [],
      fallbackLabel: undefined,
      usedCachedSupport: false,
      selectionReason: "none",
      decision: {
        resumeStrategy: "none",
        cachedResumeSignalCount: 0,
      },
    } as ReturnType<typeof readRuntimeSupportArtifactsDetailed>);
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const oversizedMemory = `oversized-memory-${"x".repeat(12_000)}`;
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      recalledMemoryCandidates: memoryCandidates(oversizedMemory),
      knowledgeContext: "compact knowledge context",
    });

    const result = await processInboundMessage(ctx);

    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toBeDefined();
    expect(governedContextContent).toContain("cached runtime summary");
    expect(governedContextContent).toContain("compact knowledge context");
    expect(governedContextContent).not.toContain("oversized-memory-");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.contextAudit).toMatchObject({
        governor: "DefaultContextGovernor",
        overflow: true,
        overflowReason: "budget-cap",
      });
      expect(result.result.contextAudit?.blocks.some((block) => (
        block.decision === "deferred"
        && block.source === "memory-recall:episodic"
        && block.reason === "budget-cap"
      ))).toBe(true);
    }

    supportSpy.mockRestore();
  });

  it("routes active skill instructions through governed context instead of perCallConfig.skillInstructions", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const skillRegistry = new SkillRegistry();
    skillRegistry.registerFull(makeSkillConfig());
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      skillRegistry,
      activeSkills: ["runtime-governed-skill"],
      perCallConfig: {
        tenantId: "tenant-override",
      },
    });

    const result = await processInboundMessage(ctx);

    const callArgs = (orchestrator.processMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    const governedContextContent = getGovernedContextContent(orchestrator);
    const perCallConfigArg = callArgs[4] as Record<string, unknown> | undefined;

    expect(governedContextContent).toBeDefined();
    expect(governedContextContent).toContain("Skill");
    expect(governedContextContent).toContain("name: runtime-governed-skill");
    expect(governedContextContent).toContain("Always verify the runtime customer record before responding.");
    expect(perCallConfigArg).toBeDefined();
    expect(perCallConfigArg).not.toHaveProperty("skillInstructions");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.contextAudit?.blocks).toContainEqual(expect.objectContaining({
        kind: "procedural",
        source: "runtime-skill:memory://runtime-governed-skill",
      }));
    }
  });

  it("adds cross-surface authority guidance to governed context for executable turns", async () => {
    const orchestrator = makeMockOrchestrator();

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      requestedAuthority: "auto",
      perCallConfig: {
        toolAllowlist: new Set(["managed_agent.invoke"]),
        perCallCapabilities: new Map([[
          "managed_agent.invoke",
          {
            name: "managed_agent.invoke",
            description: "Invoke a managed agent.",
            schema: {},
            tags: [],
            annotations: { idempotent: true },
          },
        ]]),
      },
    }));

    expect(result.ok).toBe(true);
    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toContain("Authority mode: auto.");
    expect(governedContextContent).toContain("Do not ask the operator to approve work in natural language.");
    expect(governedContextContent).toContain("Only runtime approval_requested events create approval actions in CLI, TUI, and GUI surfaces.");
  });

  it("adds governed work closeout guidance for executable work requests", async () => {
    const orchestrator = makeMockOrchestrator();

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      userParts: textParts("Fix the governed runtime closeout behavior."),
      requestedAuthority: "auto",
      perCallConfig: makeGovernedWorkPerCallConfig(),
    }));

    expect(result.ok).toBe(true);
    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toContain("Governed work closeout:");
    expect(governedContextContent).toContain("Use shared work tools for operator-requested implementation, refactoring, mutation, commit, or other executable governed work.");
    expect(governedContextContent).toContain("After a successful managed_agent.invoke for an open work item, continue with the same work item until it is started, finished, completed, or explicitly blocked with a pause requirement.");
    expect(governedContextContent).toContain("A pending, in_progress, or blocked work item without terminal closeout projects as failed in CLI, TUI, and GUI.");
  });

  it("keeps governed work closeout guidance out of research-only executable turns", async () => {
    const orchestrator = makeMockOrchestrator();

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      userParts: textParts("Investigate web best practices and compare other harnesses."),
      requestedAuthority: "auto",
      perCallConfig: makeGovernedWorkPerCallConfig(),
    }));

    expect(result.ok).toBe(true);
    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).not.toContain("Governed work closeout:");
    expect(governedContextContent).not.toContain("Materialize governed work with the shared work tools");
  });

  it("adds web source attribution guidance when web tools are available", async () => {
    const orchestrator = makeMockOrchestrator();

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      perCallConfig: {
        toolAllowlist: new Set(["web_search"]),
        perCallCapabilities: new Map([[
          "web_search",
          {
            name: "web_search",
            description: "Search the web.",
            schema: {},
            tags: [],
            annotations: { idempotent: true },
          },
        ]]),
      },
    }));

    expect(result.ok).toBe(true);
    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toContain("Web source attribution:");
    expect(governedContextContent).toContain("include a final sources section with the exact source URLs used");
    expect(governedContextContent).toContain("user-facing answers must carry the relevant URLs directly");
  });

  it("defers oversized active skills under budget pressure and records the procedural deferral in contextAudit", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const skillRegistry = new SkillRegistry();
    const oversizedInstructionMarker = "oversized-runtime-skill-marker";
    skillRegistry.registerFull(makeSkillConfig({
      name: "oversized-runtime-skill",
      filePath: "memory://oversized-runtime-skill",
      instructions: `${oversizedInstructionMarker}-${"x".repeat(12_000)}`,
    }));
    const ctx = makeBaseContext({
      orchestrator,
      sessionRegistry,
      skillRegistry,
      activeSkills: ["oversized-runtime-skill"],
      userContext: { role: "admin" },
      knowledgeContext: "compact knowledge context",
    });

    const result = await processInboundMessage(ctx);

    const governedContextContent = getGovernedContextContent(orchestrator);

    expect(governedContextContent).toBeDefined();
    expect(governedContextContent).toContain("[User Context]:");
    expect(governedContextContent).toContain("compact knowledge context");
    expect(governedContextContent).not.toContain(oversizedInstructionMarker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.contextAudit).toMatchObject({
        governor: "DefaultContextGovernor",
        overflow: true,
        overflowReason: "budget-cap",
      });
      expect(result.result.contextAudit?.blocks).toContainEqual(expect.objectContaining({
        kind: "procedural",
        source: "runtime-skill:memory://oversized-runtime-skill",
        decision: "deferred",
        reason: "budget-cap",
      }));
    }
  });

  it("injects coordination provider candidates into governed context and audits them as coordination blocks", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const coordinationContextProvider = vi.fn().mockResolvedValue(
      coordinationStateToContextCandidates({
        crossAgentMemory: [{
          id: "handoff-1",
          agentId: "agent-ops",
          role: "ops",
          summary: "Escalation stays with billing specialist.",
          updatedAt: "2026-04-27T10:00:00.000Z",
        }],
      }),
    );
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    expect(coordinationContextProvider).toHaveBeenCalledTimes(1);
    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toBeDefined();
    expect(governedContextContent).toContain("Cross-agent memory");
    expect(governedContextContent).toContain("summary: Escalation stays with billing specialist.");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const coordinationBlock = result.result.contextAudit?.blocks.find((block) => block.kind === "coordination");
      expect(coordinationBlock).toEqual(expect.objectContaining({
        decision: "admitted",
      }));
      expect(coordinationBlock?.source).toContain("runtime-coordination-provider:0");
    }
  });

  it("defers oversized coordination candidates under budget pressure while preserving user and knowledge context", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const oversizedCoordinationMarker = "oversized-coordination-marker";
    const coordinationContextProvider = vi.fn().mockResolvedValue([
      {
        kind: "coordination" as const,
        source: "runtime-cross-agent-memory:oversized-handoff",
        content: `Cross-agent memory\nsummary: ${oversizedCoordinationMarker}-${"x".repeat(12_000)}`,
        score: 0.5,
      },
    ]);
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
        userContext: { role: "admin" },
        knowledgeContext: "compact knowledge context",
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    expect(coordinationContextProvider).toHaveBeenCalledTimes(1);
    const governedContextContent = getGovernedContextContent(orchestrator);

    expect(governedContextContent).toBeDefined();
    expect(governedContextContent).toContain("[User Context]:");
    expect(governedContextContent).toContain("compact knowledge context");
    expect(governedContextContent).not.toContain(oversizedCoordinationMarker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.contextAudit).toMatchObject({
        governor: "DefaultContextGovernor",
        overflow: true,
        overflowReason: "budget-cap",
      });
      const coordinationBlock = result.result.contextAudit?.blocks.find((block) => block.kind === "coordination");
      expect(coordinationBlock).toEqual(expect.objectContaining({
        decision: "deferred",
        reason: "budget-cap",
      }));
      expect(coordinationBlock?.source).toContain("runtime-coordination-provider:0");
    }
  });

  it("normalizes coordination provider candidates so they cannot force admission or relabel audit kind", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const forcedAdmissionMarker = "forced-coordination-admission-marker";
    const coordinationContextProvider = vi.fn().mockResolvedValue([
      {
        kind: "memory" as const,
        source: "runtime-cross-agent-memory:spoofed-first-party-source",
        content: `Cross-agent memory\nsummary: ${forcedAdmissionMarker}-${"x".repeat(12_000)}`,
        required: true,
        score: 1,
        estimatedTokens: 1,
      },
    ]);
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
        knowledgeContext: "compact knowledge context",
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toContain("compact knowledge context");
    expect(governedContextContent).not.toContain(forcedAdmissionMarker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const coordinationBlock = result.result.contextAudit?.blocks.find((block) => block.kind === "coordination");
      expect(coordinationBlock).toEqual(expect.objectContaining({
        required: false,
        decision: "deferred",
      }));
      expect(coordinationBlock?.source).toContain("runtime-coordination-provider:0");
    }
  });

  it("drops non-finite coordination provider scores before governor ranking", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const coordinationContextProvider = vi.fn().mockResolvedValue([
      {
        kind: "coordination" as const,
        source: "runtime-cross-agent-memory:bad-score",
        content: "Cross-agent memory\nsummary: Provider score must not bypass ranking.",
        score: Number.POSITIVE_INFINITY,
      },
    ]);
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const coordinationBlock = result.result.contextAudit?.blocks.find((block) => block.kind === "coordination");
      expect(coordinationBlock).toEqual(expect.objectContaining({
        baseScore: 0,
        effectiveScore: 0,
      }));
    }
  });

  it("fails closed when the coordination provider throws without leaking fallback text into model context", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const rawFailureMarker = "coordination provider raw failure text";
    const coordinationContextProvider = vi.fn().mockRejectedValue(new Error(rawFailureMarker));
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
        recalledMemoryCandidates: memoryCandidates("safe recalled memory"),
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    expect(coordinationContextProvider).toHaveBeenCalledTimes(1);
    expect(orchestrator.processMessage).toHaveBeenCalledTimes(1);
    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toContain("safe recalled memory");
    expect(governedContextContent).not.toContain(rawFailureMarker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.contextAudit?.blocks.some((block) => block.kind === "coordination")).toBe(false);
      expect(result.result.contextAudit?.coordinationProviderFailures).toContainEqual({
        source: "runtime-coordination-provider",
        reason: "provider-error",
      });
    }
  });

  it("fails closed when the coordination provider returns malformed candidates without leaking raw markers into model context", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const rawFailureMarker = "coordination-provider-raw-marker";
    const coordinationContextProvider = vi.fn().mockResolvedValue([
      {
        kind: "coordination" as const,
        source: `runtime-cross-agent-memory:${rawFailureMarker}`,
        content: { summary: rawFailureMarker },
        score: 0.9,
      },
    ]);
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
        recalledMemoryCandidates: memoryCandidates("safe recalled memory"),
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    expect(coordinationContextProvider).toHaveBeenCalledTimes(1);
    expect(orchestrator.processMessage).toHaveBeenCalledTimes(1);
    const governedContextContent = getGovernedContextContent(orchestrator);
    expect(governedContextContent).toContain("safe recalled memory");
    expect(governedContextContent).not.toContain(rawFailureMarker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.contextAudit?.blocks.some((block) => block.kind === "coordination")).toBe(false);
      expect(result.result.contextAudit?.coordinationProviderFailures).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: "runtime-coordination-provider",
          reason: expect.stringMatching(/validation|error/),
        }),
      ]));
      expect(JSON.stringify(result.result.contextAudit?.coordinationProviderFailures)).not.toContain(rawFailureMarker);
    }
  });

  it("preserves sanitized coordination provenance in the audit block without trusting provider source strings", async () => {
    const orchestrator = makeMockOrchestrator();
    const sessionRegistry = makeMockSessionRegistry();
    const coordinationContextProvider = vi.fn().mockResolvedValue([
      {
        kind: "coordination" as const,
        source: "runtime-cross-agent-memory:handoff-123",
        content: "Cross-agent memory\nsummary: Billing handoff remains active.",
        score: 0.7,
      },
    ]);
    const ctx = {
      ...makeBaseContext({
        orchestrator,
        sessionRegistry,
      }),
      coordinationContextProvider,
    } as AdmittedTurnContext;

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const coordinationBlock = result.result.contextAudit?.blocks.find((block) => block.kind === "coordination");
      expect(coordinationBlock).toBeDefined();
      expect(coordinationBlock?.decision).toBe("admitted");
      expect(coordinationBlock?.source).toContain("runtime-coordination-provider:0");
      expect(coordinationBlock?.source).toContain("handoff-123");
      expect(coordinationBlock?.source).not.toBe("runtime-cross-agent-memory:handoff-123");
    }
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
          outcome: "completed",
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
          outcome: "completed",
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
          outcome: "completed",
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

  it("synthesizes configured API voice output after egress policy and stores governed audio artifact", async () => {
    const session = makeMockSession();
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-15T00:00:00.000Z" });
    const ttsAdapter: TtsAdapter = {
      name: "openai",
      synthesize: vi.fn().mockResolvedValue({
        audio: new Uint8Array([1, 2, 3]),
        mimeType: "audio/mpeg",
        durationMs: 1234,
      }),
    };
    const voiceConfig: VoiceConfig = {
      stt: { provider: "openai", apiKeyEnv: "OPENAI_API_KEY" },
      tts: { provider: "openai", apiKeyEnv: "OPENAI_API_KEY", model: "gpt-4o-mini-tts", voice: "alloy" },
      policy: {
        artifacts: { storeSynthesizedAudio: true },
        surfaces: {
          api: {
            output: { modes: ["audio-response"], failureMode: "fail-closed" },
          },
        },
      },
    };
    const ctx = makeBaseContext({
      sessionRegistry: makeMockSessionRegistry(session),
      artifactStore,
      voiceConfig,
      ttsAdapter,
      evaluateEgressPermission: vi.fn().mockResolvedValue("allow"),
      orchestrator: {
        processMessage: vi.fn().mockResolvedValue({
          parts: textParts("voice response"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outcome: "completed",
          queued: false,
        } satisfies OrchestrateResult),
        model: "gpt-5.5",
      } as unknown as RuntimeSessionOrchestrator,
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.parts).toEqual([
        { type: "text", text: "voice response" },
        {
          type: "audio",
          mimeType: "audio/mpeg",
          data: "AQID",
          artifactUri: "kiln://artifacts/voice-synthesis/artifact_1/content",
          durationMs: 1234,
        },
      ]);
      expect(result.result.voiceOutput?.artifactUris).toEqual([
        "kiln://artifacts/voice-synthesis/artifact_1/content",
      ]);
    }

    expect(ttsAdapter.synthesize).toHaveBeenCalledWith("voice response", {
      voice: "alloy",
    });
    const artifact = artifactStore.get("voice-synthesis", "artifact_1");
    expect(artifact?.multimodal).toMatchObject({
      modality: "audio",
      durationMs: 1234,
      source: { kind: "transform-output" },
    });
    const routedEvent = session.sessionEvents.find((event) =>
      event.kind === "multimodal_routed" &&
      event.reasonCode === "voice_synthesis_transform_succeeded"
    );
    expect(routedEvent).toMatchObject({
      requestedCapability: "speech-synthesis",
      strategy: "transform",
      reasonCode: "voice_synthesis_transform_succeeded",
      artifactUris: ["kiln://artifacts/voice-synthesis/artifact_1/content"],
    });
  });

  it("synthesizes voice output with the admitted profile and one-turn intent overlay", async () => {
    const ttsAdapter: TtsAdapter = {
      name: "kokoro-local",
      synthesize: vi.fn().mockResolvedValue({
        audio: new Uint8Array([4, 5, 6]),
        mimeType: "audio/wav",
      }),
    };
    const voiceConfig: VoiceConfig = {
      stt: { provider: "whisper-local", command: "whisper-local" },
      tts: { provider: "kokoro-local", command: "kokoro-local", format: "wav" },
      defaults: { ttsProfile: "english-default" },
      ttsProfiles: {
        "english-default": {
          style: "calm, concise technical assistant",
          voice: "af_bella",
          language: "en-us",
          speed: 1,
          speedRange: [0.95, 1.05],
          format: "wav",
          intents: {
            neutral: {
              delivery: "Use the profile's normal delivery.",
              appliesWhen: ["Default spoken response when no more specific intent applies."],
              speed: 1,
            },
            calm: {
              delivery: "Slightly slower and steadier delivery.",
              appliesWhen: ["Errors, support friction, or sensitive user messages."],
              speed: 0.97,
            },
          },
        },
      },
      policy: {
        surfaces: {
          api: { output: { modes: ["audio-response"] } },
        },
      },
    };

    const result = await processInboundMessage(makeBaseContext({
      voiceConfig,
      ttsAdapter,
      voiceProfile: "english-default",
      voiceOutputIntent: "calm",
      artifactStore: new MemoryArtifactResourceStore(),
    }));

    expect(result.ok).toBe(true);
    expect(ttsAdapter.synthesize).toHaveBeenCalledWith("mock response", {
      voice: "af_bella",
      speed: 0.97,
      format: "wav",
      language: "en-us",
    });
  });

  it("does not call TTS when the surface is configured as transcript-only", async () => {
    const ttsAdapter: TtsAdapter = {
      name: "openai",
      synthesize: vi.fn(),
    };
    const voiceConfig: VoiceConfig = {
      stt: { provider: "openai", apiKeyEnv: "OPENAI_API_KEY" },
      tts: { provider: "openai", apiKeyEnv: "OPENAI_API_KEY", voice: "alloy" },
      policy: {
        surfaces: {
          api: { output: { modes: ["transcript-only"] } },
        },
      },
    };
    const ctx = makeBaseContext({
      voiceConfig,
      ttsAdapter,
      artifactStore: new MemoryArtifactResourceStore(),
    });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.parts).toEqual(textParts("mock response"));
    }
    expect(ttsAdapter.synthesize).not.toHaveBeenCalled();
  });

  it("captures approval transitions from runtime event bus into canonical turn artifacts", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "approval_requested",
          approvalId: "approval-main",
          taskId: "",
          description: "Need confirmation",
          timestamp: new Date(),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "approval_requested",
          approvalId: "approval-other",
          taskId: "",
          description: "Other session request",
          timestamp: new Date(),
          sessionId: "other-session",
        });
        eventBus.emit({
          type: "approval_received",
          approvalId: "approval-main",
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
          outcome: "completed",
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
    expect(artifacts).toContain(`Approval requested: approval-main - ${session.id} (Need confirmation)`);
    expect(artifacts).toContain(`Approval rejected: approval-main - ${session.id} (Denied by policy)`);
    expect(artifacts).not.toContain("Approval requested: approval-other - other-session (Other session request)");
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
          outcome: "completed",
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
        outcome: "completed",
        queued: false,
        toolExecutions: [{
          toolCallId: "write-1",
          toolName: "write",
          durationMs: 12,
          success: true,
          resultSummary: "Wrote file",
          executionScope: { kind: "work_item", goalRunId: "goal-1", workItemId: "work-1" },
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
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger).toContainEqual(expect.objectContaining({
      kind: "file_changed",
      toolCallId: "write-1",
      executionScope: { kind: "work_item", goalRunId: "goal-1", workItemId: "work-1" },
    }));
  });

  it("records an authority audit error when read-only turns report file changes", async () => {
    const session = makeMockSession();
    const orchestrator = {
      processMessage: vi.fn().mockResolvedValue({
        parts: textParts("inspected"),
        inputTokens: 9,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outcome: "completed",
        queued: false,
        toolExecutions: [{
          toolName: "read_file",
          durationMs: 12,
          success: true,
          resultSummary: "Read file",
          fileChanges: [{ path: "src/should-not-change.ts", changeType: "modified", linesAdded: 1, linesRemoved: 0 }],
        }],
      } satisfies OrchestrateResult),
      model: "claude-sonnet-4-20250514",
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      requestedAuthority: "read_only",
      sessionRegistry,
      perCallConfig: {
        toolAllowlist: new Set(["read_file"]),
        perCallCapabilities: new Map([[
          "read_file",
          {
            name: "read_file",
            description: "Read files",
            schema: {},
            tags: [],
            effectEnvelope: {
              operation: "observe",
              boundaries: ["process"],
              reversibility: "reversible",
              dataEgress: "metadata",
              identityUse: "none",
              consequences: [],
              idempotency: "conditionally-idempotent",
            },
          },
        ]]),
      },
    }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger).toContainEqual(expect.objectContaining({
      kind: "error_recorded",
      errorCode: "AUTHORITY_MUTATION_VIOLATION",
      message: "Observed file changes outside admitted turn authority.",
      retriable: false,
      details: {
        executionMode: "execute",
        requestedAuthority: "read_only",
        admittedAuthority: "read_only",
        fileChangeCount: 1,
        paths: ["src/should-not-change.ts"],
      },
    }));
    expect(ledger).toContainEqual(expect.objectContaining({
      kind: "file_changed",
      change: expect.objectContaining({
        path: "src/should-not-change.ts",
      }),
    }));
  });

  it("returns min-policy inputs with tenant authority projection", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      tenantId: "tenant-policy-1",
      requestedAuthority: "audited",
      sessionRegistry: makeMockSessionRegistry(session),
      perCallConfig: {
        tenantId: "tenant-policy-1",
        toolAllowlist: new Set(["lookup_customer"]),
        perCallCapabilities: new Map([[
          "lookup_customer",
          {
            name: "lookup_customer",
            description: "Lookup customer",
            schema: {},
            tags: [],
            annotations: { idempotent: true },
            effectEnvelope: {
              operation: "observe",
              boundaries: ["process"],
              reversibility: "reversible",
              dataEgress: "metadata",
              identityUse: "none",
              consequences: [],
              idempotency: "idempotent",
            },
          },
        ]]),
      },
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.effectiveTurnAuthority?.policyInputs).toEqual([
        expect.objectContaining({
          source: "requested_authority",
          status: "applied",
          requestedAuthority: "audited",
        }),
        expect.objectContaining({
          source: "session_policy",
          status: "not_applicable",
        }),
        expect.objectContaining({
          source: "tenant_policy",
          status: "not_applicable",
          subjectId: "tenant-policy-1",
        }),
        expect.objectContaining({
          source: "route_policy",
          status: "not_applicable",
          admittedAuthority: "audited",
        }),
        expect.objectContaining({
          source: "parent_authority",
          status: "not_applicable",
        }),
        expect.objectContaining({
          source: "plan_approval",
          status: "not_applicable",
        }),
        expect.objectContaining({
          source: "goal_envelope",
          status: "not_applicable",
        }),
        expect.objectContaining({
          source: "work_item_authority",
          status: "not_applicable",
        }),
      ]);
    }
  });

  it("persists dangerous-command outcomes into canonical turn artifacts", async () => {
    const session = makeMockSession();
    const orchestrator = {
      processMessage: vi.fn().mockResolvedValue({
        parts: textParts("blocked"),
        inputTokens: 9,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outcome: "completed",
        queued: false,
        toolExecutions: [
          {
            toolName: "bash",
            durationMs: 0,
            success: false,
            resultSummary: "Dangerous command blocked: Detected destructive Unix command pattern. (destructive_unix)",
          },
          {
            toolName: "bash",
            durationMs: 0,
            success: false,
            resultSummary: "Command requires approval: Command contains shell expansion/substitution and requires approval. (ambiguous_expansion)",
          },
        ],
      } satisfies OrchestrateResult),
      model: "claude-sonnet-4-20250514",
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);
    const ctx = makeBaseContext({ orchestrator, sessionRegistry });

    const result = await processInboundMessage(ctx);

    expect(result.ok).toBe(true);
    const artifacts = (session as unknown as { exactArtifacts: string[] }).exactArtifacts;
    expect(artifacts).toContain(
      "Dangerous command deny: bash (destructive_unix) Detected destructive Unix command pattern.",
    );
    expect(artifacts).toContain(
      "Dangerous command ask: bash (ambiguous_expansion) Command contains shell expansion/substitution and requires approval.",
    );
  });

  it("captures canonical session ledger events in turn order from runtime bus emissions", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const startedAt = new Date("2026-04-23T19:00:00.000Z");
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "model_routed",
          provider: "codex-oauth",
          model: "gpt-5.4-mini",
          routingTier: "default",
          reason: "configured",
          timestamp: new Date("2026-04-23T19:00:01.000Z"),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "tool_called",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-write",
          toolName: "write",
          toolInput: { filePath: "src/demo.txt", content: "hello" },
          timestamp: new Date("2026-04-23T19:00:02.000Z"),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-write",
          toolName: "write",
          durationMs: 12,
          success: true,
          resultSummary: "Wrote src/demo.txt",
          timestamp: new Date("2026-04-23T19:00:03.000Z"),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "cost_update",
          provider: "codex-oauth",
          model: "gpt-5.4-mini",
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCostUsd: 0,
          byRoleModel: {},
          timestamp: new Date("2026-04-23T19:00:04.000Z"),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "error",
          code: "MODE_B_ERROR",
          message: "Synthetic runtime error",
          taskId: null,
          timestamp: new Date("2026-04-23T19:00:05.000Z"),
          sessionId: session.id,
        });
        return {
          parts: textParts("done"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outcome: "completed",
          queued: false,
        } satisfies OrchestrateResult;
      }),
      model: "gpt-5.4-mini",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);
    const contextArtifactCache = new InMemoryContextArtifactCache();

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry,
      contextArtifactCache,
    }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger.map((event) => event.kind)).toEqual([
      "turn_started",
      "user_message",
      "continuity_decided",
      "provider_routed",
      "tool_call_started",
      "tool_call_completed",
      "cost_updated",
      "lifecycle_attribution_recorded",
      "error_recorded",
      "context_usage_observed",
      "assistant_message",
      "turn_completed",
    ]);
    expect(ledger.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(ledger[3]).toMatchObject({
      kind: "provider_routed",
      provider: {
        provider: "codex-oauth",
        model: "gpt-5.4-mini",
      },
    });
    expect(ledger[4]).toMatchObject({
      kind: "tool_call_started",
      toolName: "write",
      input: { filePath: "src/demo.txt", content: "hello" },
    });
    expect(ledger[7]).toMatchObject({
      kind: "lifecycle_attribution_recorded",
      parentEventId: ledger[6]?.eventId,
      summary: expect.objectContaining({
        totalTokens: 15,
      }),
    });
    expect(ledger[10]).toMatchObject({
      kind: "assistant_message",
      content: "done",
    });
    if (result.ok) {
      expect(result.result.toolExecutions).toEqual([expect.objectContaining({
        toolName: "write",
        resultSummary: "Wrote src/demo.txt",
      })]);
    }
    const continuityOutcome = contextArtifactCache.listByKind("runtime-continuity-outcome")[0];
    expect(continuityOutcome?.content).toContain("tools=1");
  });

  it("marks the canonical turn failed when managed delegation fails before execution starts", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-work-start-failed",
          toolName: "work_item.execution.start",
          durationMs: 120000,
          success: false,
          isError: true,
          output: "Managed child invocation failed before work item execution could start.",
          metadata: {
            toolName: "work_item.execution.start",
            operation: "managed_invocation_failed",
            managedInvocationAutoStarted: false,
          },
          timestamp: new Date("2026-05-18T22:06:40.618Z"),
          sessionId: session.id,
        });
        return {
          parts: textParts("Managed scout timed out; the goal is blocked."),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outcome: "failed",
          queued: false,
        } satisfies OrchestrateResult;
      }),
      model: "gpt-5.5",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);

    const result = await processInboundMessage(makeBaseContext({ orchestrator, sessionRegistry }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "failed",
    });
  });

  it("marks the canonical turn failed when managed delegation failure is only reported in tool executions", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Managed scout failed before execution could start."),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "failed",
      queued: false,
      toolExecutions: [{
        toolCallId: "tool-work-start-failed",
        toolName: "work_item.execution.start",
        input: { goalRunId: "goal-1" },
        output: "Managed child invocation failed before work item execution could start.",
        resultSummary: "Managed child invocation failed before work item execution could start.",
        durationMs: 120000,
        success: false,
        metadata: {
          toolName: "work_item.execution.start",
          operation: "managed_invocation_failed",
          managedInvocationAutoStarted: false,
        },
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "failed",
    });
  });

  it("marks the canonical turn paused when an explicit runtime tool-round budget is exhausted", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Implementation remains incomplete after the tool-round limit."),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "paused",
      queued: false,
      stopReason: "tool_round_budget_exhausted",
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "paused",
    });
  });

  it("does not fail the canonical turn only because governance recommended orchestration", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("I mapped the surfaces and reported the architecture recommendation."),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
      toolExecutions: [
        {
          toolCallId: "tool-assess",
          toolName: "work_governance.assess",
          input: {
            summary: "Refactor cross-surface UI.",
            risk: "high",
            triggers: ["ui", "cross-surface", "multi-file"],
          },
          output: [
            "recommendation: orchestrate",
            "reasons: default posture is orchestrate; delegation trigger matched: ui, cross-surface, multi-file",
            "requiredEvidence: surface-map, plan, tests, typecheck, browser-qa, residual-risk",
          ].join("\n"),
          resultSummary: "recommendation: orchestrate",
          durationMs: 2,
          success: true,
        },
        {
          toolCallId: "tool-tree",
          toolName: "tree",
          input: { path: ".", depth: 2 },
          output: "73 entries under repo",
          resultSummary: "73 entries under repo",
          durationMs: 2,
          success: true,
        },
      ],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "completed",
    });
  });

  it("marks the canonical turn failed when governed execution starts but remains open", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Created the governed work item and started execution."),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "failed",
      queued: false,
      toolExecutions: [
        {
          toolCallId: "tool-assess",
          toolName: "work_governance.assess",
          input: {
            summary: "Refactor cross-surface UI.",
            risk: "high",
            triggers: ["ui", "cross-surface", "multi-file"],
          },
          output: "recommendation: orchestrate",
          resultSummary: "recommendation: orchestrate",
          durationMs: 2,
          success: true,
        },
        {
          toolCallId: "tool-work-start",
          toolName: "work_item.execution.start",
          input: {
            id: "work-ui-1",
            summary: "Map and refactor UI shell.",
            workflowProfile: "ui-change",
          },
          output: "{\"id\":\"work-ui-1\",\"status\":\"in_progress\"}",
          resultSummary: "work item execution started",
          durationMs: 2,
          success: true,
          metadata: {
            toolName: "work_item.execution.start",
            kind: "work_item",
            operation: "execution_started",
            id: "work-ui-1",
            status: "in_progress",
            item: {
              id: "work-ui-1",
              status: "in_progress",
              pauseRequirements: [],
              providedEvidence: ["surface-map"],
              executionAttempts: [{
                id: "goal-ui:work-ui-1:attempt:1",
                status: "started",
                executionMode: "managed_delegation",
                managedInvocationId: "invocation-ui-1",
              }],
            },
          },
        },
      ],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "failed",
    });
  });

  it("marks the canonical turn failed when governed work is created but never planned, paused, started, or closed", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Created work-1 and completed read-only scouting, but implementation is blocked on write authority."),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "failed",
      queued: false,
      toolExecutions: [
        {
          toolCallId: "tool-assess",
          toolName: "work_governance.assess",
          input: {
            summary: "Refactor cross-surface UI.",
            risk: "high",
            triggers: ["ui", "cross-surface", "multi-file"],
          },
          output: "recommendation: orchestrate",
          resultSummary: "recommendation: orchestrate",
          durationMs: 2,
          success: true,
        },
        {
          toolCallId: "tool-work-item",
          toolName: "work_item.update",
          input: {
            id: "work-ui-1",
            summary: "Map and refactor UI shell.",
            workflowProfile: "ui-change",
          },
          output: "{\"id\":\"work-ui-1\",\"status\":\"pending\"}",
          resultSummary: "work item updated",
          durationMs: 2,
          success: true,
          metadata: {
            toolName: "work_item.update",
            kind: "work_item",
            operation: "update",
            id: "work-ui-1",
            status: "pending",
            item: {
              id: "work-ui-1",
              status: "pending",
              pauseRequirements: [],
              providedEvidence: [],
              executionAttempts: [],
            },
          },
        },
        {
          toolCallId: "tool-managed-scout",
          toolName: "managed_agent.invoke",
          input: {
            profile: "foundation-readonly-plan",
            routeId: "codex-oauth-scout-readonly",
            workItemId: "work-ui-1",
          },
          output: "status: valid\n\nevidence:\n- UI surface map produced.",
          resultSummary: "status: valid",
          durationMs: 31000,
          success: true,
          metadata: {
            toolName: "managed_agent.invoke",
            kind: "managed-invocation",
            status: "completed",
            routeId: "codex-oauth-scout-readonly",
            profile: "foundation-readonly-plan",
          },
        },
      ],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "failed",
    });
  });

  it("marks the canonical turn failed when open governed work without closeout is reported through runtime events", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-assess",
          toolName: "work_governance.assess",
          durationMs: 2,
          success: true,
          isError: false,
          output: "recommendation: orchestrate",
          resultSummary: "recommendation: orchestrate",
          timestamp: new Date("2026-05-19T17:24:41.077Z"),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-work-item-update",
          toolName: "work_item.update",
          durationMs: 2,
          success: true,
          isError: false,
          output: "{\"item\":{\"id\":\"work-1\",\"status\":\"pending\"}}",
          resultSummary: "work item updated",
          metadata: {
            toolName: "work_item.update",
            kind: "work_item",
            operation: "update",
            id: "work-1",
            status: "pending",
            item: {
              id: "work-1",
              status: "pending",
              pauseRequirements: [],
              providedEvidence: [],
              executionAttempts: [],
            },
          },
          timestamp: new Date("2026-05-19T17:24:52.365Z"),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-managed-scout",
          toolName: "managed_agent.invoke",
          durationMs: 31000,
          success: true,
          isError: false,
          output: "status: valid\n\nevidence:\n- UI surface map produced.",
          resultSummary: "status: valid",
          metadata: {
            toolName: "managed_agent.invoke",
            kind: "managed-invocation",
            status: "completed",
            routeId: "codex-oauth-scout-readonly",
            profile: "foundation-readonly-plan",
          },
          timestamp: new Date("2026-05-19T17:25:38.752Z"),
          sessionId: session.id,
        });
        return {
          parts: textParts("Created work-1 and completed read-only scouting, but implementation is blocked on write authority."),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outcome: "failed",
          queued: false,
        } satisfies OrchestrateResult;
      }),
      model: "gpt-5.5",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "failed",
    });
  });

  it("marks the canonical turn failed when open governed work without closeout is reported through surface capture", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    const contextArtifactCache = new InMemoryContextArtifactCache();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Created work-1 and completed read-only scouting. Continuing with repository inspection next."),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "failed",
      queued: false,
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
      contextArtifactCache,
      turnCapture: {
        finish: () => ({
          toolCompletions: [
            {
              toolName: "work_governance.assess",
              success: true,
              output: "recommendation: orchestrate",
              resultSummary: "recommendation: orchestrate",
            },
            {
              toolName: "work_item.update",
              success: true,
              output: "{\"item\":{\"id\":\"work-1\",\"status\":\"pending\"}}",
              resultSummary: "work item updated",
              metadata: {
                kind: "work_item",
                operation: "update",
                id: "work-1",
                status: "pending",
                item: {
                  id: "work-1",
                  status: "pending",
                  pauseRequirements: [],
                  providedEvidence: [],
                  executionAttempts: [],
                },
              },
            },
            {
              toolName: "managed_agent.invoke",
              success: true,
              output: "status: valid\n\nevidence:\n- UI surface map produced.",
              resultSummary: "status: valid",
              metadata: {
                kind: "managed-invocation",
                status: "completed",
                routeId: "codex-oauth-scout-readonly",
                profile: "foundation-readonly-plan",
              },
            },
          ],
        }),
      },
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.toolExecutions).toHaveLength(3);
      expect(result.result.toolExecutions?.map((execution) => execution.toolName)).toEqual([
        "work_governance.assess",
        "work_item.update",
        "managed_agent.invoke",
      ]);
    }
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "failed",
    });
    const continuityOutcome = contextArtifactCache.listByKind("runtime-continuity-outcome")[0];
    expect(continuityOutcome?.content).toContain("tools=3");
  });

  it("marks the canonical turn failed when governed work remains blocked by a pending pause requirement", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Created the work item and delegated read-only scouting; write authority is still pending."),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "failed",
      queued: false,
      toolExecutions: [
        {
          toolCallId: "tool-assess",
          toolName: "work_governance.assess",
          input: {
            summary: "Refactor cross-surface UI.",
            risk: "high",
            triggers: ["ui", "cross-surface", "multi-file"],
          },
          output: "recommendation: orchestrate",
          resultSummary: "recommendation: orchestrate",
          durationMs: 2,
          success: true,
        },
        {
          toolCallId: "tool-work-item",
          toolName: "work_item.update",
          input: {
            id: "work-1",
            summary: "Audit and redesign current UI/UX across repository surfaces.",
            workflowProfile: "ui-change",
          },
          output: "{\"item\":{\"id\":\"work-1\"}}",
          resultSummary: "work item updated",
          durationMs: 2,
          success: true,
          metadata: {
            toolName: "work_item.update",
            kind: "work_item",
            operation: "update",
            id: "work-1",
            status: "pending",
            item: {
              id: "work-1",
              status: "pending",
              pauseRequirements: [{
                id: "write-authority",
                kind: "authority_elevation",
                summary: "Repository write authority is required to apply the requested refactor.",
                status: "pending",
              }],
            },
          },
        },
        {
          toolCallId: "tool-managed-scout",
          toolName: "managed_agent.invoke",
          input: {
            profile: "foundation-readonly-plan",
            routeId: "codex-oauth-scout-readonly",
            workItemId: "work-1",
          },
          output: "status: valid\n\nevidence:\n- UI surface map produced.",
          resultSummary: "status: valid",
          durationMs: 31000,
          success: true,
          metadata: {
            toolName: "managed_agent.invoke",
            kind: "managed-invocation",
            status: "completed",
            routeId: "codex-oauth-scout-readonly",
            profile: "foundation-readonly-plan",
          },
        },
      ],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "failed",
    });
  });

  it("marks the canonical turn failed when governed execution pauses and is not resumed", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-work-start-paused",
          toolName: "work_item.execution.start",
          durationMs: 2,
          success: false,
          isError: true,
          output: JSON.stringify({
            status: "paused",
            step: {
              reasonCode: "work_item_in_progress",
              reason: "Work item work-1 is already in progress.",
            },
          }),
          timestamp: new Date("2026-05-19T03:42:23.197Z"),
          sessionId: session.id,
        });
        eventBus.emit({
          type: "tool_result",
          toolCallScopeId: "turn-1:response:1",
          toolCallId: "tool-managed-scout",
          toolName: "managed_agent.invoke",
          durationMs: 31000,
          success: true,
          isError: false,
          output: "status: valid",
          metadata: {
            toolName: "managed_agent.invoke",
            kind: "managed-invocation",
            status: "completed",
            routeId: "codex-oauth-scout-readonly",
          },
          timestamp: new Date("2026-05-19T03:43:06.229Z"),
          sessionId: session.id,
        });
        return {
          parts: textParts("I started the governed work; the next concrete step is implementation."),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outcome: "failed",
          queued: false,
        } satisfies OrchestrateResult;
      }),
      model: "gpt-5.5",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger.at(-1)).toMatchObject({
      kind: "turn_completed",
      outcome: "failed",
    });
  });

  it("removes provider tool-call markup from assistant egress text", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts([
        "Need read managed full? It truncated.",
        "<assistant to=functions.resource_read >\n",
        "{\"uri\":\"kiln://artifacts/tool-results/artifact_3/content\"}",
        "{\"uri\":\"kiln://artifacts/tool-results/artifact_3/content\"}",
        "I started the governed cross-surface UI/UX refactor.",
      ].join("")),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(extractText(result.result.parts)).not.toContain("<assistant to=");
      expect(extractText(result.result.parts)).not.toContain("kiln://artifacts/tool-results");
      expect(extractText(result.result.parts)).toContain("I started the governed cross-surface UI/UX refactor.");
    }
    const assistantMessage = session.sessionEvents.find((event) => event.kind === "assistant_message");
    expect(assistantMessage).toMatchObject({
      content: expect.not.stringContaining("<assistant to="),
    });
  });

  it("removes bare provider tool-call targets from assistant egress text", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts([
        "Need inspect fetched maybe resource inaccessible? use web_fetch raw?",
        "to=functions.web_fetch ",
        "I’m blocked by the tool-call interface in this turn before I can continue the governed workflow correctly.",
      ].join("")),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(extractText(result.result.parts)).not.toContain("to=functions.web_fetch");
      expect(extractText(result.result.parts)).not.toContain("Need inspect fetched");
      expect(extractText(result.result.parts)).toContain("I’m blocked by the tool-call interface");
    }
    const assistantMessage = session.sessionEvents.find((event) => event.kind === "assistant_message");
    expect(assistantMessage).toMatchObject({
      content: expect.not.stringContaining("to=functions.web_fetch"),
    });
  });

  it("appends web source URLs to assistant egress when web tools informed the turn", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Research summary without visible links."),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
      toolExecutions: [{
        toolName: "web_search",
        durationMs: 12,
        success: true,
        resultSummary: "Found relevant source pages.",
        metadata: {
          sources: [{
            title: "Kiln docs",
            url: "https://docs.example.com/kiln",
          }],
        },
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const responseText = extractText(result.result.parts);
      expect(responseText).toContain("Research summary without visible links.");
      expect(responseText).toContain("## Fuentes");
      expect(responseText).toContain("- Kiln docs: https://docs.example.com/kiln");
    }
    const assistantMessage = session.sessionEvents.find((event) => event.kind === "assistant_message");
    expect(assistantMessage).toMatchObject({
      content: expect.stringContaining("https://docs.example.com/kiln"),
    });
  });

  it("does not append duplicate web source sections when assistant egress already contains the source URL", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Research summary with https://docs.example.com/kiln included."),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
      toolExecutions: [{
        toolName: "web_search",
        durationMs: 12,
        success: true,
        resultSummary: "Found relevant source pages.",
        metadata: {
          sources: [{
            title: "Extra source",
            url: "https://docs.example.com/kiln",
          }],
        },
      }],
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const responseText = extractText(result.result.parts);
      expect(responseText).toContain("https://docs.example.com/kiln");
      expect(responseText).not.toContain("## Fuentes");
    }
    const assistantMessage = session.sessionEvents.find((event) => event.kind === "assistant_message");
    expect(assistantMessage).toMatchObject({
      content: expect.not.stringContaining("## Fuentes"),
    });
  });

  it("removes leaked work_item.update payloads from assistant egress text", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts([
        "{\"id\":\"work-1\",\"providedEvidence\":[\"visual-reference-research\"],\"verificationGateResults\":[{\"gate\":\"visual-reference-research\",\"status\":\"passed\"}]}",
        "Started governed work for the GUI/UX refactor.\n\nCurrent status:\n- Created governed work item: `work-1`",
      ].join("")),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(extractText(result.result.parts)).not.toContain("\"providedEvidence\"");
      expect(extractText(result.result.parts)).not.toContain("\"verificationGateResults\"");
      expect(extractText(result.result.parts)).toContain("Started governed work for the GUI/UX refactor.");
    }
    const assistantMessage = session.sessionEvents.find((event) => event.kind === "assistant_message");
    expect(assistantMessage).toMatchObject({
      content: expect.not.stringContaining("\"providedEvidence\""),
    });
  });

  it("removes leaked internal scratchpad prefixes from assistant egress text", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: textParts("Need create work item perhaps. Need inspect outputs.I’ll handle this as governed work."),
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(extractText(result.result.parts)).toBe("I’ll handle this as governed work.");
    }
    const assistantMessage = session.sessionEvents.find((event) => event.kind === "assistant_message");
    expect(assistantMessage).toMatchObject({
      content: "I’ll handle this as governed work.",
    });
  });

  it("removes multi-delta internal scratchpad recovered from managed-agent timeout turns", async () => {
    const leaked = [
      "Need maybe use browser? Also can use github api? read-only command? Tools not listed but likely. ",
      "Need collect visual evidence. Search maybe repo has images. Use web_extract GitHub tree?",
      "Need use resource_read maybe.",
      "I created the governed goal and work item, then started the required `visual-reference-research` phase.",
    ].join("");

    expect(sanitizeAssistantEgressText(leaked)).toBe(
      "I created the governed goal and work item, then started the required `visual-reference-research` phase.",
    );
    expect(sanitizeAssistantEgressText("Need use resource_read maybe.")).toBe("");
    expect(sanitizeAssistantEgressText("Need use web_fetch maybe GitHub source.")).toBe("");
  });

  it("keeps persisted assistant text readable when providers split adjacent text parts", async () => {
    const session = makeMockSession();
    const orchestrator = makeMockOrchestrator();
    (orchestrator.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      parts: [
        { type: "text", text: "No implementation changes have been made." },
        { type: "text", text: "I’ll continue visual research before implementation." },
      ],
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outcome: "completed",
      queued: false,
    } satisfies OrchestrateResult);

    const result = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry: makeMockSessionRegistry(session),
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(extractText(result.result.parts)).toContain("made.\n\nI’ll continue");
    }
    const assistantMessage = session.sessionEvents.find((event) => event.kind === "assistant_message");
    expect(assistantMessage).toMatchObject({
      content: expect.stringContaining("made.\n\nI’ll continue"),
    });
  });

  it.each(["failed", "denied", "timed-out", "cancelled"] as const)(
    "marks the canonical turn failed when direct managed_agent.invoke returns %s",
    async (status) => {
      const session = makeMockSession();
      const eventBus = new EventBus();
      const orchestrator = {
        processMessage: vi.fn().mockImplementation(async () => {
          eventBus.emit({
            type: "tool_result",
            toolCallScopeId: "turn-1:response:1",
            toolCallId: `tool-managed-${status}`,
            toolName: "managed_agent.invoke",
            durationMs: 120000,
            success: false,
            isError: true,
            output: `Direct provider managed invocation ${status}.`,
            metadata: {
              toolName: "managed_agent.invoke",
              kind: "managed-invocation",
              status,
              routeId: "opencode-go-kimi-readonly",
            },
            timestamp: new Date("2026-05-18T23:37:13.855Z"),
            sessionId: session.id,
          });
          return {
            parts: textParts("The managed child failed; the goal is blocked."),
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            outcome: "failed",
            queued: false,
          } satisfies OrchestrateResult;
        }),
        model: "gpt-5.5",
        eventBus,
      } as unknown as RuntimeSessionOrchestrator;
      const sessionRegistry = makeMockSessionRegistry(session);

      const result = await processInboundMessage(makeBaseContext({ orchestrator, sessionRegistry }));

      expect(result.ok).toBe(true);
      const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
      expect(ledger.at(-1)).toMatchObject({
        kind: "turn_completed",
        outcome: "failed",
      });
    },
  );

  it("persists pre-admitted multimodal transform evidence supplied by ingress", async () => {
    const session = makeMockSession();
    const transformEvent = {
      type: "multimodal_routed",
      provider: "gateway-transform",
      model: "test-stt",
      strategy: "transform",
      reasonCode: "audio_transcription_transform",
      reason: "Audio was transcribed before runtime admission.",
      requestedCapability: "transcription",
      requiredModalities: ["audio"],
      artifactUris: ["kiln://artifacts/audio-transforms/artifact_1/content"],
      diagnostics: [{
        code: "audio_source_captured",
        severity: "info",
        message: "Source audio was captured as a replayable artifact.",
      }],
      timestamp: new Date("2026-05-13T12:00:00.000Z"),
      sessionId: session.id,
      tenantId: "test-tenant",
    } satisfies MultimodalRoutedEvent;

    const result = await processInboundMessage(makeBaseContext({
      sessionRegistry: makeMockSessionRegistry(session),
      userParts: textParts("[Voice note transcription]: hello from audio"),
      runtimeEvents: [transformEvent],
    }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger).toContainEqual(expect.objectContaining({
      kind: "multimodal_routed",
      strategy: "transform",
      reasonCode: "audio_transcription_transform",
      requestedCapability: "transcription",
      artifactUris: ["kiln://artifacts/audio-transforms/artifact_1/content"],
      diagnostics: [expect.objectContaining({
        code: "audio_source_captured",
        severity: "info",
      })],
    }));
  });

  it("preserves delegated multimodal governance evidence in canonical session events", async () => {
    const session = makeMockSession();
    const delegatedEvent = {
      type: "multimodal_routed",
      provider: "openai",
      model: "gpt-4o",
      strategy: "delegated",
      reasonCode: "delegation_route_available",
      reason: "A governed auxiliary route can satisfy the requested modality.",
      requestedCapability: "vision",
      requiredModalities: ["text", "image"],
      artifactUris: ["kiln://runtime/session-artifact/0"],
      delegation: {
        routeId: "managed-vision-readonly",
        provider: "openai",
        model: "gpt-4o",
        agentProfile: "vision-describer",
        authorityProfileId: "authority:managed-vision:readonly",
        routeHealth: {
          status: "healthy",
          evidence: "live route health is green",
        },
        policyDecision: {
          allowed: true,
          reason: "Tenant policy allows read-only auxiliary vision.",
        },
        costBudgetDecision: {
          status: "within-budget",
          evidence: "delegated vision budget remains available",
        },
        expectedResult: {
          format: "structured-handoff",
          requiredFields: ["summary", "artifactUris", "limitations", "residualRisk"],
        },
        uncertainty: {
          level: "medium",
          limitations: ["Image quality may constrain description accuracy."],
        },
        artifactUris: ["kiln://runtime/session-artifact/0"],
        requestedCapability: "vision",
      },
      diagnostics: [],
      timestamp: new Date("2026-05-13T12:00:00.000Z"),
      sessionId: session.id,
      tenantId: "test-tenant",
    } satisfies MultimodalRoutedEvent;

    const result = await processInboundMessage(makeBaseContext({
      sessionRegistry: makeMockSessionRegistry(session),
      userParts: [
        { type: "text", text: "Describe this image." },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
      ],
      runtimeEvents: [delegatedEvent],
    }));

    expect(result.ok).toBe(true);
    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(ledger).toContainEqual(expect.objectContaining({
      kind: "multimodal_routed",
      strategy: "delegated",
      delegation: expect.objectContaining({
        routeId: "managed-vision-readonly",
        routeHealth: {
          status: "healthy",
          evidence: "live route health is green",
        },
        policyDecision: {
          allowed: true,
          reason: "Tenant policy allows read-only auxiliary vision.",
        },
        costBudgetDecision: {
          status: "within-budget",
          evidence: "delegated vision budget remains available",
        },
        expectedResult: {
          format: "structured-handoff",
          requiredFields: ["summary", "artifactUris", "limitations", "residualRisk"],
        },
        uncertainty: {
          level: "medium",
          limitations: ["Image quality may constrain description accuracy."],
        },
      }),
    }));
  });

  it("persists rejected multimodal routing evidence as a canonical failed turn", async () => {
    const session = makeMockSession();
    const eventBus = new EventBus();
    const unsupported = new KilnError(
      "UNSUPPORTED_MODALITY",
      "unsupported_modality: No governed native, delegated, or transform route can satisfy image input.",
    );
    const orchestrator = {
      processMessage: vi.fn().mockImplementation(async () => {
        eventBus.emit({
          type: "multimodal_routed",
          provider: "deepseek",
          model: "deepseek-chat",
          strategy: "unsupported",
          reasonCode: "unsupported_modality",
          reason: "No governed native, delegated, or transform route can satisfy image input.",
          requestedCapability: "vision",
          requiredModalities: ["text", "image"],
          artifactUris: ["kiln://runtime/session-artifact/0"],
          diagnostics: [{
            code: "native_route_missing_capability",
            severity: "info",
            message: "The active provider/model cannot satisfy the requested multimodal capability.",
            provider: "deepseek",
            model: "deepseek-chat",
          }],
          timestamp: new Date("2026-05-13T12:00:01.000Z"),
          sessionId: session.id,
        });
        throw unsupported;
      }),
      model: "deepseek-chat",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);
    const abort = vi.fn();

    await expect(processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry,
      userParts: [
        { type: "text", text: "Describe this image." },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
      ],
      turnCapture: { abort },
    }))).rejects.toThrow("unsupported_modality");

    const ledger = (session as unknown as { sessionEvents: Array<Record<string, unknown>> }).sessionEvents;
    expect(sessionRegistry.save).toHaveBeenCalledWith(session);
    expect(abort).toHaveBeenCalledWith(session.id);
    expect(ledger.map((event) => event.kind)).toEqual([
      "turn_started",
      "user_message",
      "continuity_decided",
      "multimodal_routed",
      "error_recorded",
      "turn_completed",
    ]);
    expect(ledger[3]).toMatchObject({
      kind: "multimodal_routed",
      strategy: "unsupported",
      reasonCode: "unsupported_modality",
      artifactUris: ["kiln://runtime/session-artifact/0"],
    });
    expect(ledger[4]).toMatchObject({
      kind: "error_recorded",
      errorCode: "UNSUPPORTED_MODALITY",
      message: unsupported.message,
    });
    expect(ledger[5]).toMatchObject({
      kind: "turn_completed",
      outcome: "failed",
    });
  });

  it("allocates the next canonical turn id after a rejected multimodal turn", async () => {
    const session = new RuntimeSession({
      appName: "test-app",
      tenantId: "test-tenant",
      userId: "user-1",
      systemPrompt: "You are a test assistant.",
    });
    const eventBus = new EventBus();
    const unsupported = new KilnError(
      "UNSUPPORTED_MODALITY",
      "unsupported_modality: No governed native, delegated, or transform route can satisfy image input.",
    );
    const orchestrator = {
      processMessage: vi.fn()
        .mockImplementationOnce(async () => {
          eventBus.emit({
            type: "multimodal_routed",
            provider: "deepseek",
            model: "deepseek-chat",
            strategy: "unsupported",
            reasonCode: "unsupported_modality",
            reason: "No governed native, delegated, or transform route can satisfy image input.",
            requestedCapability: "vision",
            requiredModalities: ["text", "image"],
            artifactUris: ["kiln://runtime/session-artifact/0"],
            diagnostics: [],
            timestamp: new Date("2026-05-13T12:00:01.000Z"),
            sessionId: session.id,
          });
          throw unsupported;
        })
        .mockImplementationOnce(async (runtimeSession: RuntimeSession, userParts: Parameters<RuntimeSession["addUserMessage"]>[0]) => {
          runtimeSession.addUserMessage(userParts);
          runtimeSession.addAssistantMessage(textParts("retry accepted"));
          return {
            parts: textParts("retry accepted"),
            inputTokens: 4,
            outputTokens: 3,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            outcome: "completed",
            queued: false,
          } satisfies OrchestrateResult;
        }),
      model: "deepseek-chat",
      eventBus,
    } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = makeMockSessionRegistry(session);

    await expect(processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry,
      userParts: [
        { type: "text", text: "Describe this image." },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
      ],
    }))).rejects.toThrow("unsupported_modality");

    const retry = await processInboundMessage(makeBaseContext({
      orchestrator,
      sessionRegistry,
      userParts: textParts("Continue with text only."),
    }));

    expect(retry.ok).toBe(true);
    const completedTurnIds = session.sessionEvents
      .filter((event) => event.kind === "turn_completed")
      .map((event) => event.turnId);
    expect(completedTurnIds).toEqual([
      `${session.id}:turn:1`,
      `${session.id}:turn:2`,
    ]);
    const userMessageIds = session.sessionEvents
      .filter((event) => event.kind === "user_message")
      .map((event) => event.messageId);
    expect(userMessageIds).toEqual([
      `${session.id}:turn:1:user`,
      `${session.id}:turn:2:user`,
    ]);
  });
});
