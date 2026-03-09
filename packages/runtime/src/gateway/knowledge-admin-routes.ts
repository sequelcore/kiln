// Gateway: Knowledge source admin CRUD routes -- Hono sub-app for managing knowledge sources
// Follows tenant-admin-routes.ts pattern

import { Hono } from "hono";
import type { SourceManager } from "@kilnai/core";
import { KilnError } from "@kilnai/core";
import { requireBearer } from "./auth-middleware.js";

export interface KnowledgeAdminRoutesConfig {
  readonly sourceManager: SourceManager;
  readonly appName: string;
  readonly adminToken?: string;
}

export function createKnowledgeAdminRoutes(config: KnowledgeAdminRoutesConfig): Hono {
  const app = new Hono();

  if (config.adminToken) {
    app.use("*", requireBearer(config.adminToken));
  }

  // GET /sources -- list knowledge sources for this app
  app.get("/sources", (c) => {
    const sources = config.sourceManager.list(config.appName);
    return c.json({ sources });
  });

  // GET /sources/:sourceId -- get single source
  app.get("/sources/:sourceId", (c) => {
    const sourceId = c.req.param("sourceId");
    const source = config.sourceManager.get(config.appName, sourceId);
    if (!source) {
      return c.json({ error: "Source not found" }, 404);
    }
    return c.json(source);
  });

  // POST /sources -- add a new knowledge source
  app.post("/sources", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const name = body.name as string | undefined;
    const type = body.type as string | undefined;
    const uri = body.uri as string | undefined;

    if (!name || !type || !uri) {
      return c.json({ error: "Missing required fields: name, type, uri" }, 400);
    }

    if (!["file", "url", "pdf"].includes(type)) {
      return c.json({ error: "Invalid type. Must be: file, url, pdf" }, 400);
    }

    try {
      const headers = body.headers as Record<string, string> | undefined;

      const source = await config.sourceManager.addSource({
        appName: config.appName,
        name,
        type: type as "file" | "url" | "pdf",
        uri,
        headers,
      });
      return c.json(source, 201);
    } catch (err) {
      if (err instanceof KilnError && err.code === "SOURCE_ALREADY_EXISTS") {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }
  });

  // POST /sources/:sourceId/reindex -- force reindex a source
  app.post("/sources/:sourceId/reindex", async (c) => {
    const sourceId = c.req.param("sourceId");
    try {
      const source = await config.sourceManager.reindex(config.appName, sourceId);
      return c.json(source);
    } catch (err) {
      if (err instanceof KilnError && err.code === "SOURCE_NOT_FOUND") {
        return c.json({ error: "Source not found" }, 404);
      }
      throw err;
    }
  });

  // POST /sources/:sourceId/content -- push content directly (bypasses extraction)
  app.post("/sources/:sourceId/content", async (c) => {
    const sourceId = c.req.param("sourceId");
    const contentType = c.req.header("content-type") ?? "";

    let content: string;
    if (contentType.includes("application/json")) {
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      content = body.content as string;
      if (!content || typeof content !== "string") {
        return c.json({ error: "Missing required field: content" }, 400);
      }
    } else {
      content = await c.req.text();
    }

    if (!content) {
      return c.json({ error: "Empty content" }, 400);
    }

    try {
      const source = await config.sourceManager.ingestContent(config.appName, sourceId, content);
      return c.json(source);
    } catch (err) {
      if (err instanceof KilnError && err.code === "SOURCE_NOT_FOUND") {
        return c.json({ error: "Source not found" }, 404);
      }
      throw err;
    }
  });

  // DELETE /sources/:sourceId -- remove a knowledge source
  app.delete("/sources/:sourceId", async (c) => {
    const sourceId = c.req.param("sourceId");
    const removed = await config.sourceManager.removeSource(config.appName, sourceId);
    if (!removed) {
      return c.json({ error: "Source not found" }, 404);
    }
    return c.json({ removed: true });
  });

  return app;
}
