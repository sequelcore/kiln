// Gateway: Contact memory admin routes -- Hono sub-app for GDPR-compliant fact management
// Follows knowledge-admin-routes.ts pattern

import { Hono } from "hono";
import type { ContactMemoryService } from "@kilnai/core";
import { requireBearer } from "./auth-middleware.js";

export interface ContactMemoryAdminRoutesConfig {
  readonly contactMemoryService: ContactMemoryService;
  readonly appName: string;
  readonly adminToken?: string;
}

export function createContactMemoryAdminRoutes(config: ContactMemoryAdminRoutesConfig): Hono {
  const app = new Hono();

  if (config.adminToken) {
    app.use("*", requireBearer(config.adminToken));
  }

  // GET /facts/:userId?tenantId=xxx -- list active facts for a user
  app.get("/facts/:userId", async (c) => {
    const tenantId = c.req.query("tenantId");
    if (!tenantId) {
      return c.json({ error: "Missing required query parameter: tenantId" }, 400);
    }
    const userId = c.req.param("userId");
    const facts = await config.contactMemoryService.recall(userId, tenantId, { limit: 100 });
    return c.json({ facts });
  });

  // DELETE /facts/:userId/:factId?tenantId=xxx -- forget a single fact
  app.delete("/facts/:userId/:factId", async (c) => {
    const tenantId = c.req.query("tenantId");
    if (!tenantId) {
      return c.json({ error: "Missing required query parameter: tenantId" }, 400);
    }
    const factId = c.req.param("factId");
    await config.contactMemoryService.forget(factId, tenantId);
    return c.json({ removed: true });
  });

  // DELETE /facts/:userId?tenantId=xxx -- forgetAll (GDPR erasure)
  app.delete("/facts/:userId", async (c) => {
    const tenantId = c.req.query("tenantId");
    if (!tenantId) {
      return c.json({ error: "Missing required query parameter: tenantId" }, 400);
    }
    const userId = c.req.param("userId");
    await config.contactMemoryService.forgetAll(userId, tenantId);
    return c.json({ removed: true });
  });

  return app;
}
