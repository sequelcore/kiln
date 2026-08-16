import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import { createTenantAdminRoutes, generateTenantId } from "../../src/gateway/tenant-admin-routes.js";
import type { TenantAdminRoutesConfig } from "../../src/gateway/tenant-admin-routes.js";
import type { TenantConfig } from "@kilnai/core/engine";

function makeTenantBody(overrides: Partial<TenantConfig> = {}): Record<string, unknown> {
  return {
    name: "Test Salon",
    description: "A test salon",
    tone: "friendly" as const,
    language: "es",
    enabled: true,
    ...overrides,
  };
}

describe("createTenantAdminRoutes", () => {
  let tenantRegistry: TenantRegistry;
  let config: TenantAdminRoutesConfig;

  beforeEach(() => {
    const storageDir = join(tmpdir(), `kiln-admin-test-${randomUUID()}`);
    tenantRegistry = new TenantRegistry(storageDir);
    config = { tenantRegistry, appName: "test-app", sessionRegistry: new SessionRegistry() };
  });

  describe("GET /tenants", () => {
    it("returns empty array initially", async () => {
      const app = createTenantAdminRoutes(config);
      const res = await app.request("/tenants");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { tenants: TenantConfig[] };
      expect(body.tenants).toEqual([]);
    });

    it("returns created tenants", async () => {
      const app = createTenantAdminRoutes(config);

      // Create two tenants
      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ name: "Salon A" })),
      });
      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ name: "Salon B" })),
      });

      const res = await app.request("/tenants");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { tenants: TenantConfig[] };
      expect(body.tenants).toHaveLength(2);
    });
  });

  describe("POST /tenants", () => {
    it("creates tenant with auto-generated tenantId (201)", async () => {
      const app = createTenantAdminRoutes(config);

      const res = await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ name: "Mi Salon" })),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as TenantConfig;
      expect(body.tenantId).toBe("mi-salon");
      expect(body.appName).toBe("test-app");
      expect(body.name).toBe("Mi Salon");
      expect(body.enabled).toBe(true);
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
    });

    it("creates tenant with explicit tenantId", async () => {
      const app = createTenantAdminRoutes(config);

      const res = await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "custom-id", name: "Custom" })),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as TenantConfig;
      expect(body.tenantId).toBe("custom-id");
    });

    it("returns 409 for duplicate tenantId", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "dup-id", name: "First" })),
      });

      const res = await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "dup-id", name: "Second" })),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Tenant already exists");
    });

    it("returns 422 for invalid config (empty name)", async () => {
      const app = createTenantAdminRoutes(config);

      const res = await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: "valid-id", name: "" }),
      });

      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string; details: unknown[] };
      expect(body.error).toBe("Validation failed");
      expect(body.details.length).toBeGreaterThan(0);
    });
  });

  describe("GET /tenants/:tenantId", () => {
    it("returns tenant by id", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "salon-uno", name: "Salon Uno" })),
      });

      const res = await app.request("/tenants/salon-uno");
      expect(res.status).toBe(200);
      const body = (await res.json()) as TenantConfig;
      expect(body.tenantId).toBe("salon-uno");
      expect(body.name).toBe("Salon Uno");
    });

    it("returns 404 for unknown tenant", async () => {
      const app = createTenantAdminRoutes(config);

      const res = await app.request("/tenants/nonexistent");
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Tenant not found");
    });
  });

  describe("PATCH /tenants/:tenantId", () => {
    it("updates fields (name, description, services)", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "update-me", name: "Original" })),
      });

      const res = await app.request("/tenants/update-me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Name",
          description: "New description",
          services: [{ name: "Haircut", price: "$20" }],
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as TenantConfig;
      expect(body.name).toBe("Updated Name");
      expect(body.description).toBe("New description");
      expect(body.services).toEqual([{ name: "Haircut", price: "$20" }]);
    });

    it("preserves tenantId, appName, createdAt", async () => {
      const app = createTenantAdminRoutes(config);

      const createRes = await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "preserve-me", name: "Original" })),
      });
      const created = (await createRes.json()) as TenantConfig;

      const res = await app.request("/tenants/preserve-me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: "hacked-id",
          appName: "hacked-app",
          createdAt: "1970-01-01T00:00:00Z",
          name: "Still Original",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as TenantConfig;
      expect(body.tenantId).toBe("preserve-me");
      expect(body.appName).toBe("test-app");
      expect(body.createdAt).toBe(created.createdAt);
    });

    it("returns 404 for unknown tenant", async () => {
      const app = createTenantAdminRoutes(config);

      const res = await app.request("/tenants/nonexistent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nope" }),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Tenant not found");
    });
  });

  describe("widgetId field", () => {
    it("POST /tenants with widgetId persists it", async () => {
      const app = createTenantAdminRoutes(config);

      const res = await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "widget-salon", name: "Widget Salon", widgetId: "wgt-abc123" })),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as TenantConfig;
      expect(body.widgetId).toBe("wgt-abc123");
    });

    it("PATCH /tenants/:id with widgetId updates it", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "widget-patch", name: "Widget Patch" })),
      });

      const res = await app.request("/tenants/widget-patch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgetId: "wgt-xyz789" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as TenantConfig;
      expect(body.widgetId).toBe("wgt-xyz789");
    });

    it("GET /tenants/:id returns widgetId after being set", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "widget-get", name: "Widget Get", widgetId: "wgt-get001" })),
      });

      const res = await app.request("/tenants/widget-get");
      expect(res.status).toBe(200);
      const body = (await res.json()) as TenantConfig;
      expect(body.widgetId).toBe("wgt-get001");
    });
  });

  describe("DELETE /tenants/:tenantId", () => {
    it("removes tenant", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "delete-me", name: "Doomed" })),
      });

      const res = await app.request("/tenants/delete-me", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { removed: boolean };
      expect(body.removed).toBe(true);

      // Verify it's gone
      const getRes = await app.request("/tenants/delete-me");
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for unknown tenant", async () => {
      const app = createTenantAdminRoutes(config);

      const res = await app.request("/tenants/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Tenant not found");
    });
  });

  describe("session invalidation", () => {
    it("invalidates tenant sessions on PATCH", async () => {
      const sessionRegistry = new SessionRegistry();
      const configWithSessions: TenantAdminRoutesConfig = { ...config, sessionRegistry };
      const app = createTenantAdminRoutes(configWithSessions);

      // Create tenant and some sessions
      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "patched", name: "Patched Salon" })),
      });
      await sessionRegistry.getOrCreate({ appName: "test-app", tenantId: "patched", userId: "u1", systemPrompt: "old" });
      await sessionRegistry.getOrCreate({ appName: "test-app", tenantId: "patched", userId: "u2", systemPrompt: "old" });
      await sessionRegistry.getOrCreate({ appName: "test-app", tenantId: "other", userId: "u1", systemPrompt: "keep" });

      const res = await app.request("/tenants/patched", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });

      expect(res.status).toBe(200);
      expect(await sessionRegistry.get("test-app", "u1", "patched")).toBeUndefined();
      expect(await sessionRegistry.get("test-app", "u2", "patched")).toBeUndefined();
      expect(await sessionRegistry.get("test-app", "u1", "other")).toBeDefined();
    });

    it("invalidates tenant sessions on DELETE", async () => {
      const sessionRegistry = new SessionRegistry();
      const configWithSessions: TenantAdminRoutesConfig = { ...config, sessionRegistry };
      const app = createTenantAdminRoutes(configWithSessions);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "doomed", name: "Doomed Salon" })),
      });
      await sessionRegistry.getOrCreate({ appName: "test-app", tenantId: "doomed", userId: "u1", systemPrompt: "sys" });

      const res = await app.request("/tenants/doomed", { method: "DELETE" });

      expect(res.status).toBe(200);
      expect(await sessionRegistry.get("test-app", "u1", "doomed")).toBeUndefined();
    });

  });

  describe("admin token enforcement", () => {
    it("returns 401 without token when adminToken configured", async () => {
      const authedConfig: TenantAdminRoutesConfig = {
        ...config,
        adminToken: "secret-token-123",
      };
      const app = createTenantAdminRoutes(authedConfig);

      const res = await app.request("/tenants");
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    });

    it("returns 200 with valid token", async () => {
      const authedConfig: TenantAdminRoutesConfig = {
        ...config,
        adminToken: "secret-token-123",
      };
      const app = createTenantAdminRoutes(authedConfig);

      const res = await app.request("/tenants", {
        headers: { Authorization: "Bearer secret-token-123" },
      });
      expect(res.status).toBe(200);
    });

    it("no auth required when adminToken not configured", async () => {
      const app = createTenantAdminRoutes(config);

      const res = await app.request("/tenants");
      expect(res.status).toBe(200);
    });
  });

  describe("agent and routing mutation", () => {
    const sampleAgents = [
      { id: "sales", name: "Sales Agent", role: "salesperson", goal: "Close deals", isDefault: true },
      { id: "support", name: "Support Agent", role: "support rep", goal: "Resolve issues" },
    ];
    const sampleRouting = {
      rules: [{ match: "refund|complaint", agent: "support" }],
      fallback: "sales",
    };

    it("POST /tenants with agents and routing creates tenant", async () => {
      const app = createTenantAdminRoutes(config);

      const res = await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({
          tenantId: "multi-agent",
          name: "Multi Agent Salon",
          agents: sampleAgents,
          routing: sampleRouting,
        })),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as TenantConfig;
      expect(body.agents).toHaveLength(2);
      expect(body.agents![0]!.id).toBe("sales");
      expect(body.agents![1]!.id).toBe("support");
      expect(body.routing!.fallback).toBe("sales");
      expect(body.routing!.rules).toHaveLength(1);
    });

    it("PATCH /tenants/:id with agents array persists", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "patch-agents", name: "Patch Agents" })),
      });

      const res = await app.request("/tenants/patch-agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: [{ id: "solo", name: "Solo Agent", role: "generalist", goal: "Handle everything" }],
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as TenantConfig;
      expect(body.agents).toHaveLength(1);
      expect(body.agents![0]!.id).toBe("solo");
    });

    it("PATCH /tenants/:id with routing config persists", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({
          tenantId: "patch-routing",
          name: "Patch Routing",
          agents: sampleAgents,
          routing: sampleRouting,
        })),
      });

      const res = await app.request("/tenants/patch-routing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing: { ...sampleRouting, maxHandoffs: 5 },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as TenantConfig;
      expect(body.routing!.maxHandoffs).toBe(5);
      expect(body.routing!.fallback).toBe("sales");
    });

    it("PATCH with invalid agent returns 422", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "bad-agent", name: "Bad Agent" })),
      });

      const res = await app.request("/tenants/bad-agent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: [{ id: "", name: "", role: "", goal: "" }],
        }),
      });

      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string; details: unknown[] };
      expect(body.error).toBe("Validation failed");
      expect(body.details.length).toBeGreaterThan(0);
    });

    it("PATCH with invalid routing returns 422", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({
          tenantId: "bad-routing",
          name: "Bad Routing",
          agents: sampleAgents,
          routing: sampleRouting,
        })),
      });

      const res = await app.request("/tenants/bad-routing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing: { fallback: "nonexistent-agent" },
        }),
      });

      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string; details: unknown[] };
      expect(body.error).toBe("Validation failed");
      expect(body.details.length).toBeGreaterThan(0);
    });

    it("GET /tenants/:id returns agents and routing", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({
          tenantId: "get-agents",
          name: "Get Agents",
          agents: sampleAgents,
          routing: sampleRouting,
        })),
      });

      const res = await app.request("/tenants/get-agents");
      expect(res.status).toBe(200);
      const body = (await res.json()) as TenantConfig;
      expect(body.agents).toHaveLength(2);
      expect(body.agents![0]!.id).toBe("sales");
      expect(body.agents![1]!.id).toBe("support");
      expect(body.routing!.fallback).toBe("sales");
      expect(body.routing!.rules).toHaveLength(1);
      expect(body.routing!.rules![0]!.match).toBe("refund|complaint");
    });

    it("PATCH agents triggers session invalidation", async () => {
      const sessionRegistry = new SessionRegistry();
      const configWithSessions: TenantAdminRoutesConfig = { ...config, sessionRegistry };
      const app = createTenantAdminRoutes(configWithSessions);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "agent-sessions", name: "Agent Sessions" })),
      });
      await sessionRegistry.getOrCreate({ appName: "test-app", tenantId: "agent-sessions", userId: "u1", systemPrompt: "old" });

      const res = await app.request("/tenants/agent-sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: [{ id: "new-agent", name: "New Agent", role: "helper", goal: "Help" }],
        }),
      });

      expect(res.status).toBe(200);
      expect(await sessionRegistry.get("test-app", "u1", "agent-sessions")).toBeUndefined();
    });

    it("PATCH routing only without agents persists", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({
          tenantId: "routing-only",
          name: "Routing Only",
          agents: sampleAgents,
          routing: sampleRouting,
        })),
      });

      const res = await app.request("/tenants/routing-only", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing: { ...sampleRouting, rerouteAfterTurns: 3 },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as TenantConfig;
      expect(body.routing!.rerouteAfterTurns).toBe(3);
      expect(body.agents).toHaveLength(2);
    });

    it("PATCH agents only without routing for single agent persists", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "single-agent", name: "Single Agent" })),
      });

      const res = await app.request("/tenants/single-agent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: [{ id: "only", name: "Only Agent", role: "assistant", goal: "Assist" }],
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as TenantConfig;
      expect(body.agents).toHaveLength(1);
      expect(body.agents![0]!.id).toBe("only");
      expect(body.routing).toBeUndefined();
    });

    it("POST with agents creates tenant with routing", async () => {
      const app = createTenantAdminRoutes(config);

      const res = await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({
          tenantId: "full-create",
          name: "Full Create",
          agents: [
            { id: "booking", name: "Booking Agent", role: "scheduler", goal: "Schedule appointments", isDefault: true },
            { id: "faq", name: "FAQ Agent", role: "informer", goal: "Answer questions" },
          ],
          routing: {
            rules: [{ match: "appointment|book|schedule", agent: "booking" }],
            fallback: "booking",
            maxHandoffs: 3,
          },
        })),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as TenantConfig;
      expect(body.agents).toHaveLength(2);
      expect(body.routing!.fallback).toBe("booking");
      expect(body.routing!.maxHandoffs).toBe(3);
    });

    it("PATCH with empty agents array clears agents", async () => {
      const app = createTenantAdminRoutes(config);

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({
          tenantId: "clear-agents",
          name: "Clear Agents",
          agents: [{ id: "temp", name: "Temp", role: "temp", goal: "Temporary" }],
        })),
      });

      const res = await app.request("/tenants/clear-agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents: [] }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as TenantConfig;
      expect(body.agents).toEqual([]);
    });

    it("agents and routing not stripped by pickMutableFields", async () => {
      const app = createTenantAdminRoutes(config);

      const res = await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: "fields-check",
          name: "Fields Check",
          agents: sampleAgents,
          routing: sampleRouting,
          tenantId_hack: "ignored",
          appName: "ignored",
          createdAt: "ignored",
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as TenantConfig;
      expect(body.tenantId).toBe("fields-check");
      expect(body.appName).toBe("test-app");
      expect(body.agents).toHaveLength(2);
      expect(body.routing!.fallback).toBe("sales");
    });
  });
});

describe("generateTenantId", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(generateTenantId("My Salon")).toBe("my-salon");
  });

  it("removes diacritics", () => {
    expect(generateTenantId("Sal\u00f3n Mar\u00eda")).toBe("salon-maria");
  });

  it("trims leading/trailing hyphens", () => {
    expect(generateTenantId("  Hello World  ")).toBe("hello-world");
    expect(generateTenantId("---test---")).toBe("test");
  });

  it("caps at 64 characters", () => {
    const long = "a".repeat(100);
    expect(generateTenantId(long).length).toBe(64);
  });
});
