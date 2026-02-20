import { Hono } from "hono";
import type { EventBus, KilnEvent } from "@kilnai/core";

export interface DevRoutesConfig {
  readonly getEventBus?: () => EventBus | undefined;
  readonly getPhaseState?: () => Record<string, unknown>;
  readonly getMemorySnapshot?: () => Record<string, unknown>;
  readonly getCostSummary?: () => Record<string, unknown>;
  readonly getAppNames?: () => string[];
  readonly getTriggers?: () => { appName: string; name: string; type: string; enabled: boolean }[];
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
