import { Hono } from "hono";
import type { EventBus, KilnEvent } from "@kilnai/core";
import type { AppGraphResponse, EvalExperimentSummary } from "./dev-routes-types.js";

export interface DevRoutesConfig {
  readonly getEventBus?: () => EventBus | undefined;
  readonly getPhaseState?: () => Record<string, unknown>;
  readonly getMemorySnapshot?: () => Record<string, unknown>;
  readonly getCostSummary?: () => Record<string, unknown>;
  readonly getAppNames?: () => string[];
  readonly getTriggers?: () => { appName: string; name: string; type: string; enabled: boolean }[];
  readonly getSafetyMetrics?: () => Record<string, unknown>;
  readonly getAppGraph?: () => AppGraphResponse | undefined;
  readonly getYamlContent?: () => string | undefined;
  readonly putYamlContent?: (content: string) => { ok: boolean; errors?: string[] };
  readonly getMemoryByScope?: (scope: string, query?: string, tags?: string) => Record<string, unknown>[];
  readonly createMemoryEntry?: (entry: Record<string, unknown>) => { id: string };
  readonly deleteMemoryEntry?: (id: string) => boolean;
  readonly getEvalExperiments?: () => EvalExperimentSummary[];
  readonly getEvalResults?: (name: string) => Record<string, unknown> | undefined;
}

export function createDevRoutes(config: DevRoutesConfig): Hono {
  const app = new Hono();

  // GET /state -- current phase machine state
  app.get("/state", (c) => {
    const state = config.getPhaseState?.() ?? { status: "idle", phase: null };
    return c.json(state);
  });

  // GET /events -- SSE stream of real-time events
  app.get("/events", (c) => {
    const eventBus = config.getEventBus?.();

    return c.newResponse(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          // Send recent history first
          const history = eventBus?.history(50) ?? [];
          for (const event of history) {
            const data = JSON.stringify(serializeEvent(event));
            controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
          }

          if (!eventBus) return;

          // Subscribe to new events
          const handler = (event: KilnEvent) => {
            try {
              const data = JSON.stringify(serializeEvent(event));
              controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
            } catch {
              // Client disconnected
            }
          };

          eventBus.onAny(handler);
        },
        cancel() {
          // Cleanup handled by GC -- eventBus reference goes out of scope
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      },
    );
  });

  // GET /memory -- memory contents snapshot
  app.get("/memory", (c) => {
    const memory = config.getMemorySnapshot?.() ?? { entries: [] };
    return c.json(memory);
  });

  // GET /cost -- cost summary
  app.get("/cost", (c) => {
    const cost = config.getCostSummary?.() ?? { totalCostUsd: 0, byRole: {} };
    return c.json(cost);
  });

  // GET /apps -- list loaded apps
  app.get("/apps", (c) => {
    const apps = config.getAppNames?.() ?? [];
    return c.json({ apps });
  });

  // GET /triggers -- list registered triggers
  app.get("/triggers", (c) => {
    const triggers = config.getTriggers?.() ?? [];
    return c.json({ triggers });
  });

  // GET /safety -- safety pipeline metrics
  app.get("/safety", (c) => {
    const metrics = config.getSafetyMetrics?.() ?? { enabled: false };
    return c.json(metrics);
  });

  // GET /app-graph -- serialized App composite for Studio graph view
  app.get("/app-graph", (c) => {
    const graph = config.getAppGraph?.();
    return c.json(graph ?? { name: "", teams: [], router: { rules: [], fallback: "" }, channels: [], triggers: [], hasKnowledge: false, hasEval: false, hasSafety: false });
  });

  // GET /yaml -- raw app.yaml content
  app.get("/yaml", (c) => {
    const content = config.getYamlContent?.();
    if (content === undefined) return c.text("", 404);
    return c.text(content);
  });

  // PUT /yaml -- write modified YAML (validates before saving)
  app.put("/yaml", async (c) => {
    const body = await c.req.text();
    const result = config.putYamlContent?.(body);
    if (!result) return c.json({ ok: false, errors: ["YAML editing not available"] }, 400);
    if (!result.ok) return c.json(result, 400);
    return c.json(result);
  });

  // GET /memory/:scope -- memory entries by scope with optional query/tags
  app.get("/memory/:scope", (c) => {
    const scope = c.req.param("scope");
    const q = c.req.query("q");
    const tags = c.req.query("tags");
    const entries = config.getMemoryByScope?.(scope, q, tags) ?? [];
    return c.json(entries);
  });

  // POST /memory -- create a memory entry
  app.post("/memory", async (c) => {
    const entry = await c.req.json();
    const result = config.createMemoryEntry?.(entry as Record<string, unknown>);
    if (!result) return c.json({ error: "Memory creation not available" }, 400);
    return c.json(result, 201);
  });

  // DELETE /memory/:id -- delete a memory entry
  app.delete("/memory/:id", (c) => {
    const id = c.req.param("id");
    const deleted = config.deleteMemoryEntry?.(id) ?? false;
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });

  // GET /eval/experiments -- list eval experiment configs
  app.get("/eval/experiments", (c) => {
    const experiments = config.getEvalExperiments?.() ?? [];
    return c.json(experiments);
  });

  // GET /eval/experiments/:name/results -- experiment run results
  app.get("/eval/experiments/:name/results", (c) => {
    const name = c.req.param("name");
    const results = config.getEvalResults?.(name);
    if (!results) return c.json({ error: "Experiment not found" }, 404);
    return c.json(results);
  });

  return app;
}

function serializeEvent(event: KilnEvent): Record<string, unknown> {
  return {
    ...event,
    type: event.type,
    timestamp: event.timestamp.toISOString(),
    sessionId: event.sessionId,
  };
}
