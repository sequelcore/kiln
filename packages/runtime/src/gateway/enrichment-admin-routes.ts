// Gateway: Enrichment admin routes -- Hono sub-app for enrichment data access and GDPR deletion
// Follows knowledge-admin-routes.ts pattern

import { Hono } from "hono";
import type { EnrichmentStore } from "@kilnai/core";
import { requireBearer } from "./auth-middleware.js";

export interface EnrichmentAdminRoutesConfig {
  readonly enrichmentStore: EnrichmentStore;
  readonly appName: string;
  readonly adminToken?: string;
}

export function createEnrichmentAdminRoutes(config: EnrichmentAdminRoutesConfig): Hono {
  const app = new Hono();

  if (config.adminToken) {
    app.use("*", requireBearer(config.adminToken));
  }

  // GET /enrichment/:sessionId -- get enrichment for a specific session
  app.get("/enrichment/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const enrichment = await config.enrichmentStore.get(sessionId);
    if (!enrichment) {
      return c.json({ error: "Enrichment not found" }, 404);
    }
    return c.json(enrichment);
  });

  // GET /enrichment?tenantId=xxx&limit=50&cursor=xxx -- list enrichments for a tenant
  app.get("/enrichment", async (c) => {
    const tenantId = c.req.query("tenantId");
    if (!tenantId) {
      return c.json({ error: "Missing required query parameter: tenantId" }, 400);
    }
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const cursor = c.req.query("cursor");
    const result = await config.enrichmentStore.listByTenant(tenantId, limit, cursor);
    return c.json(result);
  });

  // DELETE /enrichment/:sessionId -- GDPR delete enrichment
  app.delete("/enrichment/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const deleted = await config.enrichmentStore.delete(sessionId);
    if (!deleted) {
      return c.json({ error: "Enrichment not found" }, 404);
    }
    return c.json({ deleted: true });
  });

  return app;
}
