import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ProviderAdapter } from "@kilnai/core/agents";
import { type TenantConfig, textParts } from "@kilnai/core/engine";
import { createTenantRoutes } from "../../src/gateway/tenant-routes.js";
import type { TenantAppRuntime } from "../../src/gateway/tenant-routes.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import { makeGatewayTestAdmission } from "./gateway-test-admission.js";
import { createTestFetch } from "../fetch-fixture.js";

const originalFetch = globalThis.fetch;
const mockFetch = createTestFetch(vi.fn(async () => new Response(JSON.stringify({ allowed: true, remaining: 50000, unit: "tokens" }), {
  headers: { "content-type": "application/json" },
})));

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
  const sessionRegistry = new SessionRegistry();
  return {
    appName: "test-app",
    orchestrator: new RuntimeSessionOrchestrator({ provider, model: provider.name }),
    sessionRegistry,
    tenantRegistry,
    gatewayAdmission: makeGatewayTestAdmission(sessionRegistry, provider),
    ...overrides,
  };
}

function makeBillingConfig() {
  return {
    budgetEndpoint: "https://api.example.com/users/{userId}/ai-budget",
    overBudgetMessage: "Budget exhausted.",
  };
}

describe("createTenantRoutes", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => new Response(JSON.stringify({ allowed: true, remaining: 50000, unit: "tokens" }), {
      headers: { "content-type": "application/json" },
    }));
    globalThis.fetch = mockFetch;
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

    it("validates and applies tenant SDK communication intent", async () => {
      const provider = makeMockProvider();
      const runtime = makeRuntime({ orchestrator: new RuntimeSessionOrchestrator({ provider, model: provider.name }) });
      Object.assign(runtime, { gatewayAdmission: makeGatewayTestAdmission(runtime.sessionRegistry, provider) });
      runtime.tenantRegistry.create(makeTenantConfig());
      const app = createTenantRoutes(runtime);

      const res = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "hello",
          userId: "user-1",
          tenantId: "test-tenant",
          communicationIntent: { locale: "es-MX", requiredContent: ["verification"] },
        }),
      });

      expect(res.status).toBe(200);
      expect(provider.createMessage).toHaveBeenCalledWith(expect.objectContaining({
        system: expect.stringContaining("Respond using locale 'es-MX'"),
      }));

      const invalid = await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "hello",
          userId: "user-1",
          tenantId: "test-tenant",
          communicationIntent: { locale: "not a locale" },
        }),
      });
      expect(invalid.status).toBe(400);
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
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ allowed: false, remaining: 0, unit: "tokens", reason: "Monthly token quota exhausted" }), {
        headers: { "content-type": "application/json" },
      }));

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

    it("performs only the admission budget check after successful message processing", async () => {
      const runtime = makeRuntime({ billing: makeBillingConfig() });
      runtime.tenantRegistry.create(makeTenantConfig());
      const app = createTenantRoutes(runtime);

      await app.request("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello", userId: "user-1", tenantId: "test-tenant" }),
      });

      // Usage reporting is deliberately absent: there is no stable admitted
      // outbound identity for a post-turn fire-and-forget request.
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.example.com/users/test-tenant/ai-budget",
        { headers: {} },
      );
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

      vi.doMock("../../src/gateway/message-pipeline/index.js", () => ({
        processAdmittedTurn: processAdmittedTurnMock,
      }));

      const { createTenantRoutes: createTenantRoutesWithMocks } = await import("../../src/gateway/tenant-routes.js");

      const runtime = makeRuntime({ toolAllowlist: new Set(["mcp:tenant-tools:tool:read"]), });
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
      // Tenant tool assembly is not a second authority source. The committed
      // bundle is the only authority crossing into the pipeline.
      expect(forwarded.perCallConfig?.toolAllowlist).toBeUndefined();
      expect(forwarded.requestedAuthority).toBeUndefined();
      expect(forwarded.authorityAdmission?.turn.authority.admittedAuthority).toBe("fail_closed");

      vi.doUnmock("../../src/gateway/message-pipeline/index.js");
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
