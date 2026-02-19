import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerApiRoutes } from "../../src/server/routes/api.js";
import { SessionState, SessionConflictError } from "../../src/server/session-state.js";

describe("API routes", () => {
  let app: Hono;
  let state: SessionState;

  beforeEach(() => {
    app = new Hono();
    state = new SessionState();
    registerApiRoutes(app, state);
  });

  describe("POST /api/sessions", () => {
    it("returns 400 without task", async () => {
      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("task");
    });

    it("returns 400 with empty task", async () => {
      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "   " }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("task");
    });

    it("returns 409 when session is already active", async () => {
      // Mock startSession to throw SessionConflictError
      vi.spyOn(state, "startSession").mockImplementation(() => {
        throw new SessionConflictError("A session is already running");
      });

      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "Fix the bug" }),
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("already running");
    });

    it("returns 500 on unexpected error", async () => {
      vi.spyOn(state, "startSession").mockImplementation(() => {
        throw new Error("Unexpected failure");
      });

      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "Fix the bug" }),
      });

      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Unexpected failure");
    });
  });

  describe("GET /api/sessions/current", () => {
    it("returns snapshot", async () => {
      const res = await app.request("/api/sessions/current");

      expect(res.status).toBe(200);
      const body = await res.json() as {
        sessionActive: boolean;
        sessionStatus: string;
        statusMessage: string;
        task: string | null;
        phase: string;
        status: string;
      };
      expect(body.sessionActive).toBe(false);
      expect(body.sessionStatus).toBe("idle");
      expect(body.statusMessage).toBe("");
      expect(body.task).toBeNull();
      expect(body.phase).toBe("idle");
      expect(body.status).toBe("idle");
    });

    it("returns snapshot with correct structure", async () => {
      const res = await app.request("/api/sessions/current");

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty("sessionActive");
      expect(body).toHaveProperty("sessionStatus");
      expect(body).toHaveProperty("statusMessage");
      expect(body).toHaveProperty("task");
      expect(body).toHaveProperty("phase");
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("cost");
      expect(body).toHaveProperty("events");
      expect(body).toHaveProperty("output");
      expect(body).toHaveProperty("tasks");
    });
  });

  describe("DELETE /api/sessions/current", () => {
    it("returns 404 when no session is active", async () => {
      const res = await app.request("/api/sessions/current", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("No active session");
    });

    it("returns 200 and stops session when active", async () => {
      // Mock isSessionActive to return true
      Object.defineProperty(state, "isSessionActive", { get: () => true });
      const stopSpy = vi.spyOn(state, "stopSession").mockImplementation(() => {});

      const res = await app.request("/api/sessions/current", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe("stopping");
      expect(stopSpy).toHaveBeenCalledOnce();
    });
  });

  describe("GET /api/config", () => {
    it("returns config with phase, status, and clientCount", async () => {
      const res = await app.request("/api/config");

      expect(res.status).toBe(200);
      const body = await res.json() as {
        phase: string;
        status: string;
        clientCount: number;
      };
      expect(body.phase).toBe("idle");
      expect(body.status).toBe("idle");
      expect(body.clientCount).toBe(0);
    });
  });
});
