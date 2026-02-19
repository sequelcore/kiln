import { Hono } from "hono";
import { SessionState, SessionConflictError } from "../session-state.js";
import type { SessionFlags } from "../session-state.js";

export function registerApiRoutes(app: Hono, state: SessionState): void {
  const api = new Hono();

  /** Start a new session */
  api.post("/sessions", async (c) => {
    const body = await c.req.json<{ task?: string; flags?: SessionFlags }>();

    if (!body.task || !body.task.trim()) {
      return c.json({ error: "Missing required field: task" }, 400);
    }

    try {
      state.startSession(body.task, body.flags);
      return c.json({ status: "started", task: body.task }, 201);
    } catch (err) {
      if (err instanceof SessionConflictError) {
        return c.json({ error: err.message }, 409);
      }
      const message = err instanceof Error ? err.message : "Failed to start session";
      return c.json({ error: message }, 500);
    }
  });

  /** Get current session state snapshot */
  api.get("/sessions/current", (c) => {
    return c.json(state.snapshot());
  });

  /** Stop the current session */
  api.delete("/sessions/current", (c) => {
    if (!state.isSessionActive) {
      return c.json({ error: "No active session" }, 404);
    }

    state.stopSession();
    return c.json({ status: "stopping" });
  });

  /** Get project configuration */
  api.get("/config", (c) => {
    const snapshot = state.snapshot();
    return c.json({
      phase: snapshot.phase,
      status: snapshot.status,
      clientCount: state.clientCount,
    });
  });

  app.route("/api", api);
}
