import { describe, it, expect, vi } from "vitest";
import { createDevRoutes } from "../../src/gateway/dev-routes.js";
import { EventBus } from "@kilnai/core";

async function request(app: ReturnType<typeof createDevRoutes>, path: string): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`));
}

describe("createDevRoutes", () => {
  describe("GET /state", () => {
    it("returns idle state when no getPhaseState provided", async () => {
      const app = createDevRoutes({});
      const res = await request(app, "/state");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "idle", phase: null });
    });

    it("returns custom phase state from getPhaseState callback", async () => {
      const app = createDevRoutes({
        getPhaseState: () => ({ status: "running", phase: "implement", iteration: 2 }),
      });
      const res = await request(app, "/state");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("running");
      expect(body.phase).toBe("implement");
      expect(body.iteration).toBe(2);
    });
  });

  describe("GET /memory", () => {
    it("returns empty entries when no getMemorySnapshot provided", async () => {
      const app = createDevRoutes({});
      const res = await request(app, "/memory");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ entries: [] });
    });

    it("returns snapshot from getMemorySnapshot callback", async () => {
      const snapshot = { entries: [{ id: "m1", content: "hello" }] };
      const app = createDevRoutes({ getMemorySnapshot: () => snapshot });
      const res = await request(app, "/memory");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].id).toBe("m1");
    });
  });

  describe("GET /cost", () => {
    it("returns zero cost when no getCostSummary provided", async () => {
      const app = createDevRoutes({});
      const res = await request(app, "/cost");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ totalCostUsd: 0, byRole: {} });
    });

    it("returns cost summary from getCostSummary callback", async () => {
      const summary = { totalCostUsd: 0.042, byRole: { worker: { calls: 3, costUsd: 0.042 } } };
      const app = createDevRoutes({ getCostSummary: () => summary });
      const res = await request(app, "/cost");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalCostUsd).toBe(0.042);
    });
  });

  describe("GET /apps", () => {
    it("returns empty app list when no getAppNames provided", async () => {
      const app = createDevRoutes({});
      const res = await request(app, "/apps");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ apps: [] });
    });

    it("returns app names from getAppNames callback", async () => {
      const app = createDevRoutes({ getAppNames: () => ["app-a", "app-b"] });
      const res = await request(app, "/apps");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.apps).toEqual(["app-a", "app-b"]);
    });
  });

  describe("GET /events", () => {
    it("returns SSE content-type header", async () => {
      const app = createDevRoutes({});
      const res = await request(app, "/events");
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    });

    it("returns cache-control no-cache header", async () => {
      const app = createDevRoutes({});
      const res = await request(app, "/events");
      expect(res.headers.get("Cache-Control")).toBe("no-cache");
    });

    it("streams history events from eventBus on connection", async () => {
      const bus = new EventBus(100);
      bus.emit({
        type: "phase_changed",
        timestamp: new Date(),
        sessionId: "sess-1",
        phase: "implement",
        phaseName: "Implement",
        phaseDescription: "Writing code",
      });

      const app = createDevRoutes({ getEventBus: () => bus });
      const res = await request(app, "/events");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");

      // Read stream body to verify history is included
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No body reader");

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      reader.cancel();

      expect(text).toContain("phase_changed");
      expect(text).toContain("sess-1");
    });

    it("works without eventBus -- returns empty stream", async () => {
      const app = createDevRoutes({ getEventBus: () => undefined });
      const res = await request(app, "/events");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    });
  });

  describe("custom config callbacks", () => {
    it("invokes all callbacks when provided", async () => {
      const getPhaseState = vi.fn(() => ({ status: "idle", phase: null }));
      const getMemorySnapshot = vi.fn(() => ({ entries: [] }));
      const getCostSummary = vi.fn(() => ({ totalCostUsd: 0, byRole: {} }));
      const getAppNames = vi.fn(() => ["my-app"]);

      const app = createDevRoutes({
        getPhaseState,
        getMemorySnapshot,
        getCostSummary,
        getAppNames,
      });

      await request(app, "/state");
      await request(app, "/memory");
      await request(app, "/cost");
      await request(app, "/apps");

      expect(getPhaseState).toHaveBeenCalledOnce();
      expect(getMemorySnapshot).toHaveBeenCalledOnce();
      expect(getCostSummary).toHaveBeenCalledOnce();
      expect(getAppNames).toHaveBeenCalledOnce();
    });
  });
});
