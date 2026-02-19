import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderAdapter } from "@kilnai/core";
import { createModeBRoutes } from "../../src/gateway/mode-b-routes.js";
import type { ModeBAppRuntime } from "../../src/gateway/mode-b-routes.js";
import { ModeBOrchestrator } from "../../src/session/mode-b-orchestrator.js";
import { SessionRegistry } from "../../src/session/session-registry.js";

const originalFetch = globalThis.fetch;

function makeMockProvider(): ProviderAdapter {
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
      json: () => Promise.resolve({ remaining: 50000, unit: "tokens" }),
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

      const session = runtime.sessionRegistry.get("test-app", "user-1");
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
        json: () => Promise.resolve({ remaining: 0, unit: "tokens" }),
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

    it("reports usage after successful call", async () => {
      const runtime = makeRuntime({ billing: makeBillingConfig() });
      const app = createModeBRoutes(runtime);

      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1" }),
      });

      // fetch called twice: once for budget check, once for usage report
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      const usageCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(usageCall![0]).toContain("user-1");
      expect(usageCall![1]?.method).toBe("POST");
    });

    it("skips budget check when no billing configured", async () => {
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
      expect(runtime.sessionRegistry.get("test-app", "user-1")).toBeUndefined();
    });
  });
});
