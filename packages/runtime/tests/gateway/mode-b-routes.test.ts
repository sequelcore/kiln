import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderAdapter } from "@kilnai/core";
import { textParts } from "@kilnai/core";
import { createModeBRoutes } from "../../src/gateway/mode-b-routes.js";
import type { ModeBAppRuntime } from "../../src/gateway/mode-b-routes.js";
import { ModeBOrchestrator } from "../../src/session/mode-b-orchestrator.js";
import { SessionRegistry } from "../../src/session/session-registry.js";

const originalFetch = globalThis.fetch;

function makeMockProvider(): ProviderAdapter {
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

function makeRuntime(overrides: Partial<ModeBAppRuntime> = {}): ModeBAppRuntime {
  const provider = makeMockProvider();
  return {
    appName: "test-app",
    orchestrator: new ModeBOrchestrator({ provider }),
    sessionRegistry: new SessionRegistry(),
    systemPrompt: "You are a test assistant.",
    ...overrides,
  };
}

function makeBillingConfig() {
  return {
    budgetEndpoint: "https://api.example.com/users/{userId}/ai-budget",
    usageEndpoint: "https://api.example.com/users/{userId}/ai-usage",
    overBudgetMessage: "Budget exhausted.",
    tiers: {
      free: { agents: ["fast"] },
      pro: { agents: ["fast", "coding"] },
    },
  };
}

describe("createModeBRoutes", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ allowed: true, remaining: 50000, unit: "tokens" }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("POST /message", () => {
    it("returns response from orchestrator", async () => {
      const runtime = makeRuntime();
      const app = createModeBRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { content: string; inputTokens: number; outputTokens: number };
      expect(body.content).toBe("mock response");
      expect(body.inputTokens).toBe(100);
      expect(body.outputTokens).toBe(50);
    });

    it("creates session for new user", async () => {
      const runtime = makeRuntime();
      const app = createModeBRoutes(runtime);

      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1" }),
      });

      const session = await runtime.sessionRegistry.get("test-app", "user-1", "_default");
      expect(session).toBeDefined();
    });

    it("reuses session for existing user", async () => {
      const runtime = makeRuntime();
      const app = createModeBRoutes(runtime);

      const res1 = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1" }),
      });
      const body1 = (await res1.json()) as { sessionId: string };

      const res2 = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "follow up", userId: "user-1" }),
      });
      const body2 = (await res2.json()) as { sessionId: string };

      expect(body1.sessionId).toBe(body2.sessionId);
    });

    it("returns overBudgetMessage when budget exhausted", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ allowed: false, remaining: 0, unit: "tokens", reason: "Monthly token quota exhausted" }),
      });

      const runtime = makeRuntime({ billing: makeBillingConfig() });
      const app = createModeBRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { content: string; budgetExhausted: boolean };
      expect(body.content).toBe("Budget exhausted.");
      expect(body.budgetExhausted).toBe(true);
    });

    it("returns 400 for missing message", async () => {
      const runtime = makeRuntime();
      const app = createModeBRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-1" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing userId", async () => {
      const runtime = makeRuntime();
      const app = createModeBRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });

      expect(res.status).toBe(400);
    });

    it("reports usage after successful message processing", async () => {
      const runtime = makeRuntime({ billing: makeBillingConfig() });
      const app = createModeBRoutes(runtime);

      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1" }),
      });

      // fetch called twice: budget check + usage report
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);

      const usageCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(usageCall[0]).toBe("https://api.example.com/users/{userId}/ai-usage");
      expect(usageCall[1]).toMatchObject({
        method: "POST",
      });
      const usageBody = JSON.parse(usageCall[1].body as string);
      expect(usageBody.tenantId).toBe("_default");
      expect(usageBody.messages).toBe(1);
      expect(usageBody.tokens).toBe(150); // 100 input + 50 output
    });

    it("skips budget check and usage report when no billing configured", async () => {
      const runtime = makeRuntime();
      const app = createModeBRoutes(runtime);

      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1" }),
      });

      // fetch should not be called (no billing)
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("accepts context object and returns 200", async () => {
      const runtime = makeRuntime();
      const app = createModeBRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", context: { role: "admin" } }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 400 when context is a number", async () => {
      const runtime = makeRuntime();
      const app = createModeBRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", context: 123 }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when context is an array", async () => {
      const runtime = makeRuntime();
      const app = createModeBRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", context: [1, 2, 3] }),
      });

      expect(res.status).toBe(400);
    });

    it("retains context from first turn when second POST omits context", async () => {
      const runtime = makeRuntime();
      const app = createModeBRoutes(runtime);

      // First turn sets context
      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-ctx-persist", context: { role: "admin" } }),
      });

      // Second turn omits context — session must still have it
      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "follow up", userId: "user-ctx-persist" }),
      });

      const session = await runtime.sessionRegistry.get("test-app", "user-ctx-persist", "_default");
      expect(session).toBeDefined();
      expect(session!.userContext).toEqual({ role: "admin" });
    });

    it("rejects disallowed tier", async () => {
      const billing = {
        ...makeBillingConfig(),
        tiers: {
          free: { agents: ["coding"] },
        },
      };
      const runtime = makeRuntime({ billing });
      const app = createModeBRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", plan: "free" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { tierRestricted: boolean };
      expect(body.tierRestricted).toBe(true);
    });

    it("forwards tenant tool context into processInboundMessage for tenant-backed requests", async () => {
      vi.resetModules();

      const processInboundMessageMock = vi.fn().mockResolvedValue({
        ok: true,
        result: {
          parts: textParts("tenant response"),
          inputTokens: 11,
          outputTokens: 7,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: "session-tenant",
          sessionMode: "ai_active",
          traceId: "trace-tenant",
        },
      });

      const callBuiltinTools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>([
        ["mock_tool", vi.fn(async (input) => input)],
      ]);
      const toolDefinitions = [{
        name: "mock_tool",
        description: "Mock tool for authority forwarding",
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "string" },
          },
        },
        tags: new Set(["builtin"]),
      }];
      const capabilities = new Map([
        ["mock_tool", { name: "mock_tool" } as unknown],
      ]);
      const toolAuthority = new Map([
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

      const resolveAgentContextAsyncMock = vi.fn().mockResolvedValue({
        systemPrompt: "Tenant-specific system prompt",
        tenantToolContext: {
          callBuiltinTools,
          toolDefinitions,
          capabilities,
          toolAuthority,
          toolAllowlist,
          rateLimiter,
          maxToolRounds: undefined,
        },
        isHandoff: false,
      });

      vi.doMock("../../src/gateway/message-pipeline.js", () => ({
        processInboundMessage: processInboundMessageMock,
      }));
      vi.doMock("../../src/tenant/agent-resolver.js", () => ({
        resolveAgentContextAsync: resolveAgentContextAsyncMock,
      }));

      const { createModeBRoutes: createModeBRoutesWithMocks } = await import("../../src/gateway/mode-b-routes.js");

      const runtime = makeRuntime({
        tenant: {
          tenantId: "tenant-1",
        } as ModeBAppRuntime["tenant"],
      });
      const app = createModeBRoutesWithMocks(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello tenant", userId: "user-tenant" }),
      });

      expect(res.status).toBe(200);
      expect(resolveAgentContextAsyncMock).toHaveBeenCalledTimes(1);
      expect(processInboundMessageMock).toHaveBeenCalledTimes(1);

      const forwarded = processInboundMessageMock.mock.calls[0]![0];
      expect(forwarded.callBuiltinTools).toBe(callBuiltinTools);
      expect(forwarded.perCallConfig?.tenantId).toBe("tenant-1");
      expect(forwarded.perCallConfig?.toolAuthority).toBe(toolAuthority);
      expect(forwarded.perCallConfig?.toolAllowlist).toBe(toolAllowlist);
      expect(forwarded.perCallConfig?.rateLimiter).toBe(rateLimiter);
      expect(forwarded.perCallConfig?.additionalTools).toBe(toolDefinitions);
      expect(forwarded.perCallConfig?.perCallCapabilities).toBe(capabilities);

      expect(runtime.orchestrator.tools?.some((t) => t.name === "mock_tool")).toBe(true);

      vi.doUnmock("../../src/gateway/message-pipeline.js");
      vi.doUnmock("../../src/tenant/agent-resolver.js");
      vi.resetModules();
    });
  });

  describe("GET /sessions", () => {
    it("returns active sessions", async () => {
      const runtime = makeRuntime();
      const app = createModeBRoutes(runtime);

      // Create a session first
      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1" }),
      });

      const res = await app.request("/sessions");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sessions: { id: string; userId: string }[] };
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0]!.userId).toBe("user-1");
    });
  });

  describe("DELETE /sessions/:userId", () => {
    it("removes session", async () => {
      const runtime = makeRuntime();
      const app = createModeBRoutes(runtime);

      // Create a session first
      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1" }),
      });

      const res = await app.request("/sessions/user-1", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { removed: boolean };
      expect(body.removed).toBe(true);

      // Verify session is removed
      expect(await runtime.sessionRegistry.get("test-app", "user-1", "_default")).toBeUndefined();
    });
  });
});
