import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoutingTestRoutes } from "../../src/gateway/routing-test-routes.js";
import type { RoutingTestRoutesConfig } from "../../src/gateway/routing-test-routes.js";
import type { TenantRegistry } from "../../src/tenant/tenant-registry.js";
import type { TenantConfig } from "@kilnai/core";

const tenant: TenantConfig = {
  tenantId: "t1",
  appName: "test",
  name: "Test Biz",
  businessName: "Test",
  enabled: true,
  createdAt: new Date().toISOString(),
  agents: [
    { id: "sales", name: "Sales Agent", role: "seller", goal: "sell" },
    { id: "support", name: "Support Agent", role: "helper", goal: "help", isDefault: true },
  ],
  routing: {
    rules: [
      { match: "buy|purchase|price", agent: "sales" },
      { match: "help|problem|issue", agent: "support" },
    ],
    fallback: "support",
  },
};

const tenantNoRouting: TenantConfig = {
  tenantId: "t2",
  appName: "test",
  name: "No Routing",
  enabled: true,
  createdAt: new Date().toISOString(),
};

function postRouting(app: ReturnType<typeof createRoutingTestRoutes>, tenantId: string, body: unknown) {
  return app.request(`/tenants/${tenantId}/routing/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("createRoutingTestRoutes", () => {
  let mockRegistry: TenantRegistry;
  let config: RoutingTestRoutesConfig;

  beforeEach(() => {
    mockRegistry = {
      get: vi.fn((id: string) => {
        if (id === "t1") return tenant;
        if (id === "t2") return tenantNoRouting;
        return undefined;
      }),
    } as unknown as TenantRegistry;

    config = { tenantRegistry: mockRegistry };
  });

  describe("POST /tenants/:tenantId/routing/test", () => {
    it("returns rule tier when message matches Tier 1 regex", async () => {
      const app = createRoutingTestRoutes(config);
      const res = await postRouting(app, "t1", { message: "I want to buy something" });

      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.agentId).toBe("sales");
      expect(json.tier).toBe("rule");
      expect(json.matchedPattern).toBe("buy|purchase|price");
    });

    it("returns fallback tier when no regex matches", async () => {
      const app = createRoutingTestRoutes(config);
      const res = await postRouting(app, "t1", { message: "hello there" });

      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.agentId).toBe("support");
      expect(json.tier).toBe("fallback");
      expect(json.matchedPattern).toBeNull();
    });

    it("returns 404 for unknown tenantId", async () => {
      const app = createRoutingTestRoutes(config);
      const res = await postRouting(app, "unknown", { message: "hi" });

      expect(res.status).toBe(404);
      const json = (await res.json()) as { error: string };
      expect(json.error).toContain("not found");
    });

    it("returns 422 when tenant has no agents or routing", async () => {
      const app = createRoutingTestRoutes(config);
      const res = await postRouting(app, "t2", { message: "hi" });

      expect(res.status).toBe(422);
      const json = (await res.json()) as { error: string };
      expect(json.error).toContain("no multi-agent routing");
    });

    it("returns 400 when message field is missing", async () => {
      const app = createRoutingTestRoutes(config);
      const res = await postRouting(app, "t1", { text: "hello" });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toContain("message");
    });

    it("returns fallback when message is empty string", async () => {
      const app = createRoutingTestRoutes(config);
      const res = await postRouting(app, "t1", { message: "" });

      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.agentId).toBe("support");
      expect(json.tier).toBe("fallback");
    });

    it("allRules shows all rules with individual match status", async () => {
      const app = createRoutingTestRoutes(config);
      const res = await postRouting(app, "t1", { message: "I have a problem" });

      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        allRules: Array<{ pattern: string; agent: string; matched: boolean }>;
      };
      expect(json.allRules).toHaveLength(2);

      const salesRule = json.allRules.find((r) => r.agent === "sales");
      const supportRule = json.allRules.find((r) => r.agent === "support");
      expect(salesRule?.matched).toBe(false);
      expect(supportRule?.matched).toBe(true);
    });

    it("resolves agent name from tenant agents list", async () => {
      const app = createRoutingTestRoutes(config);
      const res = await postRouting(app, "t1", { message: "I want to purchase" });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { agentId: string; agentName: string };
      expect(json.agentId).toBe("sales");
      expect(json.agentName).toBe("Sales Agent");
    });

    it("returns 400 for invalid JSON body", async () => {
      const app = createRoutingTestRoutes(config);
      const res = await app.request("/tenants/t1/routing/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toContain("Invalid JSON");
    });
  });

  describe("GET /routing/templates", () => {
    it("returns templates list", async () => {
      const app = createRoutingTestRoutes(config);
      const res = await app.request("/routing/templates");

      expect(res.status).toBe(200);
      const json = (await res.json()) as { templates: unknown[] };
      expect(json.templates).toBeDefined();
      expect(Array.isArray(json.templates)).toBe(true);
      expect(json.templates.length).toBeGreaterThan(0);
    });
  });

  describe("auth enforcement", () => {
    it("rejects requests without token when adminToken is configured", async () => {
      const authedConfig: RoutingTestRoutesConfig = {
        tenantRegistry: mockRegistry,
        adminToken: "secret-token",
      };
      const app = createRoutingTestRoutes(authedConfig);

      const postRes = await postRouting(app, "t1", { message: "buy" });
      expect(postRes.status).toBe(401);

      const getRes = await app.request("/routing/templates");
      expect(getRes.status).toBe(401);

      // With correct token, requests succeed
      const authedRes = await app.request("/tenants/t1/routing/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret-token",
        },
        body: JSON.stringify({ message: "buy" }),
      });
      expect(authedRes.status).toBe(200);
    });
  });
});
