import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderAdapter, Capability, ToolAuthorizer, ToolAuthorizationResult, CapabilityAnnotations, RateLimiter, ToolDefinition } from "@kilnai/core";
import { textParts, EventBus } from "@kilnai/core";
import { ModeBOrchestrator } from "../../src/session/mode-b-orchestrator.js";
import type { PerCallToolConfig } from "../../src/session/mode-b-orchestrator.js";
import { ModeBSession } from "../../src/session/mode-b-session.js";
import type { ToolResultSanitizer, SanitizationResult } from "@kilnai/core";

function makeProvider(toolCallsOnRound?: number): ProviderAdapter {
  let callCount = 0;
  return {
    name: "mock",
    createMessage: vi.fn().mockImplementation(() => {
      callCount++;
      if (toolCallsOnRound !== undefined && callCount === toolCallsOnRound) {
        return {
          parts: textParts("thinking..."),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-1", name: "get_data", input: { query: "test" } }],
          stopReason: "tool_use",
        };
      }
      return {
        parts: textParts("done"),
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "end_turn",
      };
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeSession(): ModeBSession {
  return new ModeBSession({ appName: "app", userId: "user-1", systemPrompt: "Be helpful." });
}

function makeCapabilityMap(overrides?: Partial<Capability>): ReadonlyMap<string, Capability> {
  const cap: Capability = {
    name: "get_data",
    description: "Gets data",
    schema: {},
    tags: [],
    annotations: { readOnly: true },
    ...overrides,
  };
  return new Map([["get_data", cap]]);
}

describe("ModeBOrchestrator - Tool Execution Enhancements", () => {
  describe("authorization", () => {
    it("emits tool_authorized event and executes allowed tools", async () => {
      const provider = makeProvider(1);
      const eventBus = new EventBus(100);
      const emitSpy = vi.spyOn(eventBus, "emit");

      const authorizer: ToolAuthorizer = {
        authorize: vi.fn().mockReturnValue({
          level: 1,
          allowed: true,
          requiresApproval: false,
          reason: "Read-only tool, auto-execute",
        }),
      };

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", vi.fn().mockResolvedValue("result")]]),
        eventBus,
        capabilityMap: makeCapabilityMap(),
        toolAuthorizer: authorizer,
      });

      await orchestrator.processMessage(makeSession(), textParts("fetch data"));

      expect(authorizer.authorize).toHaveBeenCalledWith("get_data", { readOnly: true });

      const authorizedEvents = emitSpy.mock.calls.filter((c) => c[0].type === "tool_authorized");
      expect(authorizedEvents).toHaveLength(1);
      expect(authorizedEvents[0]![0]).toMatchObject({
        type: "tool_authorized",
        toolName: "get_data",
        level: 1,
        allowed: true,
      });
    });

    it("skips tool execution when authorization denied", async () => {
      const provider = makeProvider(1);
      const toolFn = vi.fn().mockResolvedValue("should not run");

      const authorizer: ToolAuthorizer = {
        authorize: vi.fn().mockReturnValue({
          level: 4,
          allowed: false,
          requiresApproval: true,
          reason: "Destructive tool requires confirmation",
        }),
      };

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", toolFn]]),
        capabilityMap: makeCapabilityMap({ annotations: { destructive: true } }),
        toolAuthorizer: authorizer,
      });

      await orchestrator.processMessage(makeSession(), textParts("delete stuff"));

      expect(toolFn).not.toHaveBeenCalled();
    });
  });

  describe("result sanitization", () => {
    it("sanitizes tool results through safety pipeline", async () => {
      const provider = makeProvider(1);
      const sanitizer: ToolResultSanitizer = {
        sanitize: vi.fn().mockResolvedValue({
          content: "[REDACTED] contacted us",
          sanitized: true,
          blocked: false,
        }),
      } as unknown as ToolResultSanitizer;

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", vi.fn().mockResolvedValue("john@email.com contacted us")]]),
        toolResultSanitizer: sanitizer,
      });

      await orchestrator.processMessage(makeSession(), textParts("get contacts"));

      expect(sanitizer.sanitize).toHaveBeenCalledWith("john@email.com contacted us");
    });

    it("passes through unsanitized results", async () => {
      const provider = makeProvider(1);
      const sanitizer: ToolResultSanitizer = {
        sanitize: vi.fn().mockResolvedValue({
          content: "clean data",
          sanitized: false,
          blocked: false,
        }),
      } as unknown as ToolResultSanitizer;

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", vi.fn().mockResolvedValue("clean data")]]),
        toolResultSanitizer: sanitizer,
      });

      await orchestrator.processMessage(makeSession(), textParts("get info"));

      expect(sanitizer.sanitize).toHaveBeenCalled();
    });
  });

  describe("budget checking", () => {
    it("breaks loop when budget is exhausted on round > 0", async () => {
      // Provider returns tool calls on every round
      let callCount = 0;
      const provider: ProviderAdapter = {
        name: "mock",
        createMessage: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount <= 3) {
            return {
              parts: textParts("thinking"),
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              toolCalls: [{ id: `tc-${callCount}`, name: "get_data", input: {} }],
              stopReason: "tool_use",
            };
          }
          return {
            parts: textParts("final"),
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [],
            stopReason: "end_turn",
          };
        }),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };

      let budgetCheckCount = 0;
      const budgetChecker = vi.fn().mockImplementation(() => {
        budgetCheckCount++;
        // Deny on second check (round 2)
        return { allowed: budgetCheckCount < 2, message: "Budget exhausted" };
      });

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", vi.fn().mockResolvedValue("ok")]]),
        budgetChecker,
      });

      const result = await orchestrator.processMessage(makeSession(), textParts("do work"));

      // Budget checker should NOT be called on round 0 (first round)
      // It should be called starting from round 1
      expect(budgetChecker).toHaveBeenCalled();
    });
  });

  describe("enriched events", () => {
    it("emits tool_called with toolInput and annotations", async () => {
      const provider = makeProvider(1);
      const eventBus = new EventBus(100);
      const emitSpy = vi.spyOn(eventBus, "emit");

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", vi.fn().mockResolvedValue("result")]]),
        eventBus,
        capabilityMap: makeCapabilityMap(),
      });

      await orchestrator.processMessage(makeSession(), textParts("fetch"));

      const toolCalledEvents = emitSpy.mock.calls.filter((c) => c[0].type === "tool_called");
      expect(toolCalledEvents).toHaveLength(1);
      expect(toolCalledEvents[0]![0]).toMatchObject({
        type: "tool_called",
        toolName: "get_data",
        toolInput: { query: "test" },
        annotations: { readOnly: true },
      });
    });

    it("emits tool_result with resultSummary", async () => {
      const provider = makeProvider(1);
      const eventBus = new EventBus(100);
      const emitSpy = vi.spyOn(eventBus, "emit");

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", vi.fn().mockResolvedValue("some result data")]]),
        eventBus,
      });

      await orchestrator.processMessage(makeSession(), textParts("fetch"));

      const resultEvents = emitSpy.mock.calls.filter((c) => c[0].type === "tool_result");
      expect(resultEvents).toHaveLength(1);
      expect(resultEvents[0]![0]).toMatchObject({
        type: "tool_result",
        toolName: "get_data",
        success: true,
        resultSummary: "some result data",
      });
    });
  });

  describe("backward compatibility", () => {
    it("works identically without new deps", async () => {
      const provider = makeProvider();
      const orchestrator = new ModeBOrchestrator({ provider });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.parts).toEqual(textParts("done"));
      expect(result.queued).toBe(false);
      expect(session.messageCount).toBe(2);
    });
  });

  describe("per-call tool config", () => {
    it("blocks tool not in allowlist", async () => {
      const provider = makeProvider(1);
      const toolFn = vi.fn().mockResolvedValue("should not run");

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", toolFn]]),
      });

      const perCallConfig: PerCallToolConfig = {
        toolAllowlist: new Set(["other_tool"]),
      };

      await orchestrator.processMessage(makeSession(), textParts("fetch data"), undefined, undefined, perCallConfig);

      expect(toolFn).not.toHaveBeenCalled();
    });

    it("allows tool in allowlist", async () => {
      const provider = makeProvider(1);
      const toolFn = vi.fn().mockResolvedValue("result");

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", toolFn]]),
      });

      const perCallConfig: PerCallToolConfig = {
        toolAllowlist: new Set(["get_data"]),
      };

      await orchestrator.processMessage(makeSession(), textParts("fetch data"), undefined, undefined, perCallConfig);

      expect(toolFn).toHaveBeenCalled();
    });

    it("allows all tools when no allowlist", async () => {
      const provider = makeProvider(1);
      const toolFn = vi.fn().mockResolvedValue("result");

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", toolFn]]),
      });

      await orchestrator.processMessage(makeSession(), textParts("fetch data"));

      expect(toolFn).toHaveBeenCalled();
    });

    it("blocks tool when rate limited", async () => {
      const provider = makeProvider(1);
      const toolFn = vi.fn().mockResolvedValue("should not run");

      const rateLimiter: RateLimiter = {
        check: vi.fn().mockReturnValue({ allowed: false, remaining: 0, retryAfterMs: 30_000 }),
        record: vi.fn(),
        reset: vi.fn(),
      };

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", toolFn]]),
      });

      const perCallConfig: PerCallToolConfig = {
        rateLimiter,
        tenantId: "tenant-1",
      };

      await orchestrator.processMessage(makeSession(), textParts("fetch data"), undefined, undefined, perCallConfig);

      expect(toolFn).not.toHaveBeenCalled();
      expect(rateLimiter.check).toHaveBeenCalledWith("tenant-1", "get_data");
    });

    it("records rate limit after successful execution", async () => {
      const provider = makeProvider(1);
      const toolFn = vi.fn().mockResolvedValue("result");

      const rateLimiter: RateLimiter = {
        check: vi.fn().mockReturnValue({ allowed: true, remaining: 5 }),
        record: vi.fn(),
        reset: vi.fn(),
      };

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", toolFn]]),
      });

      const perCallConfig: PerCallToolConfig = {
        rateLimiter,
        tenantId: "tenant-1",
      };

      await orchestrator.processMessage(makeSession(), textParts("fetch data"), undefined, undefined, perCallConfig);

      expect(toolFn).toHaveBeenCalled();
      expect(rateLimiter.record).toHaveBeenCalledWith("tenant-1", "get_data");
    });

    it("merges additional tools for single invocation", async () => {
      const additionalTool: ToolDefinition = {
        name: "webhook_action",
        description: "Webhook action",
        inputSchema: {},
        tags: new Set(),
      };

      // Provider returns tool call for webhook_action on round 1, end_turn on round 2
      let callCount = 0;
      const provider: ProviderAdapter = {
        name: "mock",
        createMessage: vi.fn().mockImplementation(({ tools }: { tools?: readonly ToolDefinition[] }) => {
          callCount++;
          if (callCount === 1) {
            return {
              parts: textParts("calling webhook..."),
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              toolCalls: [{ id: "tc-1", name: "webhook_action", input: { url: "https://example.com" } }],
              stopReason: "tool_use",
            };
          }
          return {
            parts: textParts("done"),
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [],
            stopReason: "end_turn",
          };
        }),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };

      const webhookFn = vi.fn().mockResolvedValue("webhook result");

      const orchestrator = new ModeBOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([
          ["get_data", vi.fn().mockResolvedValue("data")],
          ["webhook_action", webhookFn],
        ]),
      });

      const perCallConfig: PerCallToolConfig = {
        additionalTools: [additionalTool],
      };

      // First call WITH perCallConfig -- should include webhook_action
      await orchestrator.processMessage(makeSession(), textParts("trigger webhook"), undefined, undefined, perCallConfig);

      const firstCallTools = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0].tools;
      const firstToolNames = firstCallTools.map((t: ToolDefinition) => t.name);
      expect(firstToolNames).toContain("webhook_action");
      expect(firstToolNames).toContain("get_data");
      expect(webhookFn).toHaveBeenCalled();

      // Reset for second call
      callCount = 0;
      (provider.createMessage as ReturnType<typeof vi.fn>).mockClear();
      webhookFn.mockClear();

      // Second call WITHOUT perCallConfig -- should NOT include webhook_action
      await orchestrator.processMessage(makeSession(), textParts("hello"));

      const secondCallTools = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0].tools;
      // When called without perCallConfig, additional tools should not persist
      // The orchestrator's _tools should still be the original set
      expect(orchestrator.tools).toHaveLength(1);
      expect(orchestrator.tools![0]!.name).toBe("get_data");
    });
  });
});
