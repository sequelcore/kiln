// Gateway: Routing test endpoint -- dry-run agent routing for diagnostics
// POST /tenants/:tenantId/routing/test returns which agent would handle a message

import { Hono } from "hono";
import { textParts, extractText, listRoutingTemplates } from "@kilnai/core";
import { DefaultTenantRouter } from "../tenant/tenant-router.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { requireBearer } from "./auth-middleware.js";

export interface RoutingTestRoutesConfig {
  readonly tenantRegistry: TenantRegistry;
  readonly adminToken?: string;
}

interface RuleResult {
  readonly pattern: string;
  readonly agent: string;
  readonly matched: boolean;
}

export function createRoutingTestRoutes(config: RoutingTestRoutesConfig): Hono {
  const app = new Hono();

  if (config.adminToken) {
    app.use("*", requireBearer(config.adminToken));
  }

  // GET /routing/templates -- list available routing rule templates
  app.get("/routing/templates", (c) => {
    return c.json({ templates: listRoutingTemplates() });
  });

  // POST /tenants/:tenantId/routing/test -- dry-run routing for a message
  app.post("/tenants/:tenantId/routing/test", async (c) => {
    const tenantId = c.req.param("tenantId");
    const tenant = config.tenantRegistry.get(tenantId);
    if (!tenant) {
      return c.json({ error: "Tenant not found" }, 404);
    }

    if (!tenant.agents || tenant.agents.length === 0 || !tenant.routing) {
      return c.json({ error: "Tenant has no multi-agent routing configured" }, 422);
    }

    let body: { message?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.message !== "string") {
      return c.json({ error: "Missing required field: message" }, 400);
    }

    const userParts = textParts(body.message);
    const text = extractText(userParts);

    // Test every rule individually for diagnostics
    const allRules: RuleResult[] = [];
    for (const rule of tenant.routing.rules ?? []) {
      try {
        const regex = new RegExp(rule.match, "i");
        allRules.push({
          pattern: rule.match,
          agent: rule.agent,
          matched: regex.test(text),
        });
      } catch {
        allRules.push({ pattern: rule.match, agent: rule.agent, matched: false });
      }
    }

    // Run actual routing
    const router = new DefaultTenantRouter(tenant.routing);
    const result = router.route(userParts);

    // Resolve agent name
    const agent = tenant.agents.find((a) => a.id === result.agentId);

    return c.json({
      agentId: result.agentId,
      agentName: agent?.name ?? result.agentId,
      tier: result.tier,
      matchedPattern: result.matchedPattern ?? null,
      confidence: result.confidence ?? null,
      allRules,
    });
  });

  return app;
}
