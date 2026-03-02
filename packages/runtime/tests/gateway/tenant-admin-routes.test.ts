import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import { SessionRegistry } from "../../src/session/session-registry.js";
import { createTenantAdminRoutes, generateTenantId } from "../../src/gateway/tenant-admin-routes.js";
import type { TenantAdminRoutesConfig } from "../../src/gateway/tenant-admin-routes.js";
import type { TenantConfig } from "@kilnai/core";

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
    config = { tenantRegistry, appName: "test-app" };
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
      sessionRegistry.getOrCreate({ appName: "test-app", tenantId: "patched", userId: "u1", systemPrompt: "old" });
      sessionRegistry.getOrCreate({ appName: "test-app", tenantId: "patched", userId: "u2", systemPrompt: "old" });
      sessionRegistry.getOrCreate({ appName: "test-app", tenantId: "other", userId: "u1", systemPrompt: "keep" });

      const res = await app.request("/tenants/patched", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });

      expect(res.status).toBe(200);
      expect(sessionRegistry.get("test-app", "u1", "patched")).toBeUndefined();
      expect(sessionRegistry.get("test-app", "u2", "patched")).toBeUndefined();
      expect(sessionRegistry.get("test-app", "u1", "other")).toBeDefined();
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
      sessionRegistry.getOrCreate({ appName: "test-app", tenantId: "doomed", userId: "u1", systemPrompt: "sys" });

      const res = await app.request("/tenants/doomed", { method: "DELETE" });

      expect(res.status).toBe(200);
      expect(sessionRegistry.get("test-app", "u1", "doomed")).toBeUndefined();
    });

    it("works without sessionRegistry (backward compatible)", async () => {
      const app = createTenantAdminRoutes(config); // no sessionRegistry

      await app.request("/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTenantBody({ tenantId: "safe", name: "Safe Salon" })),
      });

      const res = await app.request("/tenants/safe", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated" }),
      });

      expect(res.status).toBe(200);
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
      expect(body.error).toBe("Unauthorized");
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
