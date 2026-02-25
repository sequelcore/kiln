// Gateway: Production memory routes -- Hono sub-app for memory CRUD
// Available in all modes (dev and production) at /api/memory

import { Hono } from "hono";

export interface MemoryRoutesConfig {
  readonly getMemoryByScope?: (scope: string, query?: string, tags?: string) => Record<string, unknown>[] | Promise<Record<string, unknown>[]>;
  readonly createMemoryEntry?: (entry: Record<string, unknown>) => { id: string } | Promise<{ id: string }>;
  readonly deleteMemoryEntry?: (id: string) => boolean | Promise<boolean>;
}

export function createMemoryRoutes(config: MemoryRoutesConfig): Hono {
  const app = new Hono();

  // GET /memory/:scope -- memory entries by scope with optional query/tags
  app.get("/memory/:scope", async (c) => {
    const scope = c.req.param("scope");
    const q = c.req.query("q");
    const tags = c.req.query("tags");
    const entries = await (config.getMemoryByScope?.(scope, q, tags) ?? []);
    return c.json(entries);
  });

  // POST /memory -- create a memory entry
  app.post("/memory", async (c) => {
    const entry = await c.req.json();
    const result = await config.createMemoryEntry?.(entry as Record<string, unknown>);
    if (!result) return c.json({ error: "Memory creation not available" }, 400);
    return c.json(result, 201);
  });

  // DELETE /memory/:id -- delete a memory entry
  app.delete("/memory/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = await (config.deleteMemoryEntry?.(id) ?? false);
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
