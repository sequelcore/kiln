import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderAdapter } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { createProviderAdapterRoutes } from "../../src/gateway/provider-adapter-routes.js";
import type { ProviderAdapterAppRuntime } from "../../src/gateway/provider-adapter-routes.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import { makeGatewayTestAdmission } from "./gateway-test-admission.js";

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

function makeRuntime(overrides: Partial<ProviderAdapterAppRuntime> = {}): ProviderAdapterAppRuntime {
  const provider = makeMockProvider();
  const sessionRegistry = new SessionRegistry();
  return {
    appName: "test-app",
    orchestrator: new RuntimeSessionOrchestrator({ provider, model: provider.name }),
    sessionRegistry,
    gatewayAdmission: makeGatewayTestAdmission(sessionRegistry, provider),
    systemPrompt: "You are a test assistant.",
    ...overrides,
  };
}

function makeBillingConfig() {
  return {
    budgetEndpoint: "https://api.example.com/users/{userId}/ai-budget",
    overBudgetMessage: "Budget exhausted.",
    tiers: {
      free: { agents: ["fast"] },
      pro: { agents: ["fast", "coding"] },
    },
  };
}

describe("createProviderAdapterRoutes", () => {
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
      const app = createProviderAdapterRoutes(runtime);

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

    it("accepts destructive requestedAuthority for downstream fail-closed admission", async () => {
      const runtime = makeRuntime();
      const app = createProviderAdapterRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", requestedAuthority: "destructive" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { content: string };
      expect(body.content).toBe("mock response");
    });

    it("validates and applies SDK communication intent", async () => {
      const provider = makeMockProvider();
      const runtime = makeRuntime({ orchestrator: new RuntimeSessionOrchestrator({ provider, model: provider.name }) });
      Object.assign(runtime, { gatewayAdmission: makeGatewayTestAdmission(runtime.sessionRegistry, provider) });
      const app = createProviderAdapterRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "hello",
          userId: "user-1",
          communicationIntent: { locale: "es-MX", requiredContent: ["verification"] },
        }),
      });

      expect(res.status).toBe(200);
      expect(provider.createMessage).toHaveBeenCalledWith(expect.objectContaining({
        system: expect.stringContaining("Respond using locale 'es-MX'"),
      }));
      expect(provider.createMessage).toHaveBeenCalledWith(expect.objectContaining({
        system: expect.stringContaining("verification"),
      }));

      const invalid = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "hello",
          userId: "user-1",
          communicationIntent: { locale: "es-MX", rawPrompt: "private" },
        }),
      });
      expect(invalid.status).toBe(400);
    });

    it("creates session for new user", async () => {
      const runtime = makeRuntime();
      const app = createProviderAdapterRoutes(runtime);

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
      const app = createProviderAdapterRoutes(runtime);

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
      const app = createProviderAdapterRoutes(runtime);

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
      const app = createProviderAdapterRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-1" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing userId", async () => {
      const runtime = makeRuntime();
      const app = createProviderAdapterRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });

      expect(res.status).toBe(400);
    });

    it("performs only the admission budget check after successful message processing", async () => {
      const runtime = makeRuntime({ billing: makeBillingConfig() });
      const app = createProviderAdapterRoutes(runtime);

      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1" }),
      });

      // Usage reporting is deliberately absent: there is no stable admitted
      // outbound identity for a post-turn fire-and-forget request.
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.example.com/users/_default/ai-budget",
        { headers: {} },
      );
    });

    it("skips budget check and usage report when no billing configured", async () => {
      const runtime = makeRuntime();
      const app = createProviderAdapterRoutes(runtime);

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
      const app = createProviderAdapterRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", context: { role: "admin" } }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 400 when context is a number", async () => {
      const runtime = makeRuntime();
      const app = createProviderAdapterRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", context: 123 }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when context is an array", async () => {
      const runtime = makeRuntime();
      const app = createProviderAdapterRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", context: [1, 2, 3] }),
      });

      expect(res.status).toBe(400);
    });

    it("retains context from first turn when second POST omits context", async () => {
      const runtime = makeRuntime();
      const app = createProviderAdapterRoutes(runtime);

      // First turn sets context
      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-ctx-persist", context: { role: "admin" } }),
      });

      // Second turn omits context â€” session must still have it
      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "follow up", userId: "user-ctx-persist" }),
      });

      const session = await runtime.sessionRegistry.get("test-app", "user-ctx-persist", "_default");
      expect(session).toBeDefined();
      expect(session!.userContext).toEqual({ role: "admin" });
    });

    it("rejects disallowed tier before processAdmittedTurn is invoked", async () => {
      vi.resetModules();

      const processAdmittedTurnMock = vi.fn().mockResolvedValue({
        ok: true,
        result: {
          parts: textParts("should not run"),
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: false,
          sessionId: "session-tier",
          sessionMode: "ai_active",
          traceId: "trace-tier",
        },
      });

      vi.doMock("../../src/gateway/message-pipeline/index.js", () => ({
        processAdmittedTurn: processAdmittedTurnMock,
      }));

      const { createProviderAdapterRoutes: createProviderAdapterRoutesWithMocks } = await import("../../src/gateway/provider-adapter-routes.js");

      const billing = {
        ...makeBillingConfig(),
        tiers: {
          free: { agents: ["coding"] },
        },
      };
      const runtime = makeRuntime({ billing });
      const app = createProviderAdapterRoutesWithMocks(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", plan: "free" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { tierRestricted: boolean; content: string };
      expect(body.tierRestricted).toBe(true);
      expect(body.content).toContain('Tier "fast" is not available');
      expect(processAdmittedTurnMock).not.toHaveBeenCalled();

      vi.doUnmock("../../src/gateway/message-pipeline/index.js");
      vi.resetModules();
    });

  });

  describe("GET /sessions", () => {
    it("returns active sessions", async () => {
      const runtime = makeRuntime();
      const app = createProviderAdapterRoutes(runtime);

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
      const app = createProviderAdapterRoutes(runtime);

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
