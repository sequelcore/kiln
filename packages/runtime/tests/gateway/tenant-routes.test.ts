import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ProviderAdapter, TenantConfig } from "@kilnai/core";
import { textParts } from "@kilnai/core";
import { createTenantRoutes } from "../../src/gateway/tenant-routes.js";
import type { TenantAppRuntime } from "../../src/gateway/tenant-routes.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { SessionRegistry } from "../../src/session/session-registry.js";
import { TenantRegistry } from "../../src/tenant/tenant-registry.js";

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

function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  const now = new Date().toISOString();
  return {
    tenantId: "test-tenant",
    appName: "test-app",
    name: "Test Business",
    enabled: true,
    tone: "friendly",
    language: "es-MX",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRuntime(overrides: Partial<TenantAppRuntime> = {}): TenantAppRuntime {
  const provider = makeMockProvider();
  const storageDir = join(tmpdir(), `kiln-test-${randomUUID()}`);
  const tenantRegistry = new TenantRegistry(storageDir);
  return {
    appName: "test-app",
    orchestrator: new RuntimeSessionOrchestrator({ provider }),
    sessionRegistry: new SessionRegistry(),
    tenantRegistry,
    ...overrides,
  };
}

function makeBillingConfig() {
  return {
    budgetEndpoint: "https://api.example.com/users/{userId}/ai-budget",
    usageEndpoint: "https://api.example.com/users/{userId}/ai-usage",
    overBudgetMessage: "Budget exhausted.",
  };
}

describe("createTenantRoutes", () => {
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
    it("returns 400 for missing tenantId", async () => {
      const runtime = makeRuntime();
      const app = createTenantRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("tenantId is required");
    });

    it("returns 404 for unknown tenantId", async () => {
      const runtime = makeRuntime();
      const app = createTenantRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "nonexistent" }),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Tenant not found");
    });

    it("returns 403 for disabled tenant", async () => {
      const runtime = makeRuntime();
      runtime.tenantRegistry.create(makeTenantConfig({ enabled: false }));
      const app = createTenantRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "test-tenant" }),
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Tenant is disabled");
    });

    it("returns response from orchestrator for valid tenant", async () => {
      const runtime = makeRuntime();
      runtime.tenantRegistry.create(makeTenantConfig());
      const app = createTenantRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "test-tenant" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        content: string;
        inputTokens: number;
        outputTokens: number;
        tenantId: string;
      };
      expect(body.content).toBe("mock response");
      expect(body.inputTokens).toBe(100);
      expect(body.outputTokens).toBe(50);
      expect(body.tenantId).toBe("test-tenant");
    });

    it("creates session with tenantId", async () => {
      const runtime = makeRuntime();
      runtime.tenantRegistry.create(makeTenantConfig());
      const app = createTenantRoutes(runtime);

      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "test-tenant" }),
      });

      const session = await runtime.sessionRegistry.get("test-app", "user-1", "test-tenant");
      expect(session).toBeDefined();
      expect(session!.tenantId).toBe("test-tenant");
    });

    it("isolates sessions for same userId with different tenantId", async () => {
      const runtime = makeRuntime();
      runtime.tenantRegistry.create(makeTenantConfig({ tenantId: "tenant-a", name: "Business A" }));
      runtime.tenantRegistry.create(makeTenantConfig({ tenantId: "tenant-b", name: "Business B" }));
      const app = createTenantRoutes(runtime);

      const res1 = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "tenant-a" }),
      });
      const body1 = (await res1.json()) as { sessionId: string };

      const res2 = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "tenant-b" }),
      });
      const body2 = (await res2.json()) as { sessionId: string };

      // Different sessions for same user in different tenants
      expect(body1.sessionId).not.toBe(body2.sessionId);

      // Both sessions exist independently
      const sessionA = await runtime.sessionRegistry.get("test-app", "user-1", "tenant-a");
      const sessionB = await runtime.sessionRegistry.get("test-app", "user-1", "tenant-b");
      expect(sessionA).toBeDefined();
      expect(sessionB).toBeDefined();
      expect(sessionA!.id).not.toBe(sessionB!.id);
    });

    it("returns budgetExhausted when budget exhausted", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ allowed: false, remaining: 0, unit: "tokens", reason: "Monthly token quota exhausted" }),
      });

      const runtime = makeRuntime({ billing: makeBillingConfig() });
      runtime.tenantRegistry.create(makeTenantConfig());
      const app = createTenantRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "test-tenant" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { content: string; budgetExhausted: boolean };
      expect(body.content).toBe("Budget exhausted.");
      expect(body.budgetExhausted).toBe(true);
    });

    it("returns 400 for missing message", async () => {
      const runtime = makeRuntime();
      const app = createTenantRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-1", tenantId: "test-tenant" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("message or parts is required");
    });

    it("returns 400 for missing userId", async () => {
      const runtime = makeRuntime();
      const app = createTenantRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", tenantId: "test-tenant" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("userId is required");
    });

    it("skips budget check when no billing configured", async () => {
      const runtime = makeRuntime();
      runtime.tenantRegistry.create(makeTenantConfig());
      const app = createTenantRoutes(runtime);

      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "test-tenant" }),
      });

      // fetch should not be called (no billing)
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("reports usage after successful message processing", async () => {
      const runtime = makeRuntime({ billing: makeBillingConfig() });
      runtime.tenantRegistry.create(makeTenantConfig());
      const app = createTenantRoutes(runtime);

      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "test-tenant" }),
      });

      // fetch called twice: budget check + usage report
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);

      const usageCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(usageCall[0]).toBe("https://api.example.com/users/{userId}/ai-usage");
      expect(usageCall[1]).toMatchObject({
        method: "POST",
      });
      const usageBody = JSON.parse(usageCall[1].body as string);
      expect(usageBody.tenantId).toBe("test-tenant");
      expect(usageBody.messages).toBe(1);
      expect(usageBody.tokens).toBe(150); // 100 input + 50 output
    });

    it("forwards tenant and requestedAuthority into processAdmittedTurn and keeps tenant tool assembly out of the route", async () => {
      vi.resetModules();

      const processAdmittedTurnMock = vi.fn().mockResolvedValue({
        ok: true,
        result: {
          parts: textParts("forwarded response"),
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

      vi.doMock("../../src/gateway/message-pipeline.js", () => ({
        processAdmittedTurn: processAdmittedTurnMock,
      }));

      const { createTenantRoutes: createTenantRoutesWithMocks } = await import("../../src/gateway/tenant-routes.js");

      const runtime = makeRuntime();
      runtime.tenantRegistry.create(makeTenantConfig());
      const app = createTenantRoutesWithMocks(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "test-tenant", requestedAuthority: "audited" }),
      });

      expect(res.status).toBe(200);
      expect(processAdmittedTurnMock).toHaveBeenCalledTimes(1);

      const forwarded = processAdmittedTurnMock.mock.calls[0]![0];
      expect(forwarded.tenant).toBeDefined();
      expect(forwarded.tenant?.tenantId).toBe("test-tenant");
      expect(forwarded.systemPrompt).toBeUndefined();
      expect(forwarded.callBuiltinTools).toBeUndefined();
      expect(forwarded.perCallConfig).toBeUndefined();
      expect(forwarded.requestedAuthority).toBe("audited");

      vi.doUnmock("../../src/gateway/message-pipeline.js");
      vi.resetModules();
    });

    it("accepts destructive requestedAuthority for downstream fail-closed admission", async () => {
      const runtime = makeRuntime();
      runtime.tenantRegistry.create(makeTenantConfig());
      const app = createTenantRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "test-tenant", requestedAuthority: "destructive" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { content: string };
      expect(body.content).toBe("mock response");
    });
  });

  describe("GET /sessions", () => {
    it("returns active sessions with tenantId", async () => {
      const runtime = makeRuntime();
      runtime.tenantRegistry.create(makeTenantConfig());
      const app = createTenantRoutes(runtime);

      // Create a session first
      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "test-tenant" }),
      });

      const res = await app.request("/sessions");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        sessions: { id: string; userId: string; tenantId: string }[];
      };
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0]!.userId).toBe("user-1");
      expect(body.sessions[0]!.tenantId).toBe("test-tenant");
    });

    it("filters sessions by tenantId query param", async () => {
      const runtime = makeRuntime();
      runtime.tenantRegistry.create(makeTenantConfig({ tenantId: "tenant-a", name: "Business A" }));
      runtime.tenantRegistry.create(makeTenantConfig({ tenantId: "tenant-b", name: "Business B" }));
      const app = createTenantRoutes(runtime);

      // Create sessions in two tenants
      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "tenant-a" }),
      });
      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-2", tenantId: "tenant-b" }),
      });

      // Filter by tenant-a
      const res = await app.request("/sessions?tenantId=tenant-a");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        sessions: { userId: string; tenantId: string }[];
      };
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0]!.userId).toBe("user-1");
      expect(body.sessions[0]!.tenantId).toBe("tenant-a");
    });
  });

  describe("DELETE /sessions/:tenantId/:userId", () => {
    it("removes session by tenantId and userId", async () => {
      const runtime = makeRuntime();
      runtime.tenantRegistry.create(makeTenantConfig());
      const app = createTenantRoutes(runtime);

      // Create a session first
      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "test-tenant" }),
      });

      const res = await app.request("/sessions/test-tenant/user-1", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { removed: boolean };
      expect(body.removed).toBe(true);

      // Verify session is removed
      expect(await runtime.sessionRegistry.get("test-app", "user-1", "test-tenant")).toBeUndefined();
    });

    it("returns false when session does not exist", async () => {
      const runtime = makeRuntime();
      const app = createTenantRoutes(runtime);

      const res = await app.request("/sessions/test-tenant/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { removed: boolean };
      expect(body.removed).toBe(false);
    });
  });
});
