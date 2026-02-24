import { describe, it, expect, vi } from "vitest";
import { createDevRoutes } from "../../src/gateway/dev-routes.js";
import { EventBus } from "@kilnai/core";

async function request(app: ReturnType<typeof createDevRoutes>, path: string): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`));
}

async function requestWithMethod(
  app: ReturnType<typeof createDevRoutes>,
  path: string,
  method: string,
  body?: string,
  contentType?: string,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      body,
      headers: contentType ? { "Content-Type": contentType } : undefined,
    }),
  );
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

    it("unsubscribes from eventBus when stream is cancelled", async () => {
      const bus = new EventBus(100);
      const onAny = vi.spyOn(bus, "onAny");
      const offAny = vi.spyOn(bus, "offAny");

      const app = createDevRoutes({ getEventBus: () => bus });
      const res = await request(app, "/events");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No body reader");

      await reader.cancel();

      expect(onAny).toHaveBeenCalledOnce();
      expect(offAny).toHaveBeenCalledOnce();
      const subscribedHandler = onAny.mock.calls[0][0];
      const unsubscribedHandler = offAny.mock.calls[0][0];
      expect(subscribedHandler).toBe(unsubscribedHandler);
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

  describe("GET /app-graph", () => {
    it("returns empty graph when no callback", async () => {
      const app = createDevRoutes({});
      const res = await request(app, "/app-graph");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.teams).toEqual([]);
      expect(data.name).toBe("");
      expect(data.hasKnowledge).toBe(false);
    });

    it("returns graph from callback", async () => {
      const mockGraph = {
        name: "test-app",
        teams: [{ name: "support", agents: [], capabilities: [], phases: ["plan", "implement"], mode: "sequential" }],
        router: { rules: [{ pattern: "help.*", team: "support" }], fallback: "support" },
        channels: ["cli", "web"],
        triggers: ["on-deploy"],
        hasKnowledge: true,
        hasEval: false,
        hasSafety: false,
      };
      const app = createDevRoutes({ getAppGraph: () => mockGraph });
      const res = await request(app, "/app-graph");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe("test-app");
      expect(data.teams).toHaveLength(1);
      expect(data.teams[0].name).toBe("support");
      expect(data.channels).toEqual(["cli", "web"]);
      expect(data.hasKnowledge).toBe(true);
    });
  });

  describe("GET /yaml", () => {
    it("returns 404 when no callback", async () => {
      const app = createDevRoutes({});
      const res = await request(app, "/yaml");
      expect(res.status).toBe(404);
    });

    it("returns 404 when callback returns undefined", async () => {
      const app = createDevRoutes({ getYamlContent: () => undefined });
      const res = await request(app, "/yaml");
      expect(res.status).toBe(404);
    });

    it("returns YAML content as text", async () => {
      const yamlContent = "name: test-app\nteams:\n  default:\n    agents: []";
      const app = createDevRoutes({ getYamlContent: () => yamlContent });
      const res = await request(app, "/yaml");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe(yamlContent);
    });
  });

  describe("PUT /yaml", () => {
    it("returns 400 when no callback", async () => {
      const app = createDevRoutes({});
      const res = await requestWithMethod(app, "/yaml", "PUT", "name: test", "text/plain");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    it("returns 400 when validation fails", async () => {
      const app = createDevRoutes({
        putYamlContent: () => ({ ok: false, errors: ["Invalid YAML structure"] }),
      });
      const res = await requestWithMethod(app, "/yaml", "PUT", "invalid: yaml", "text/plain");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.errors).toContain("Invalid YAML structure");
    });

    it("returns ok when write succeeds", async () => {
      const putYamlContent = vi.fn(() => ({ ok: true }));
      const app = createDevRoutes({ putYamlContent });
      const res = await requestWithMethod(app, "/yaml", "PUT", "name: test-app", "text/plain");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(putYamlContent).toHaveBeenCalledWith("name: test-app");
    });
  });

  describe("GET /memory/:scope", () => {
    it("returns empty array when no callback", async () => {
      const app = createDevRoutes({});
      const res = await request(app, "/memory/user");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it("returns entries from callback with scope", async () => {
      const entries = [{ id: "m1", content: "hello", scope: "user" }];
      const getMemoryByScope = vi.fn(() => entries);
      const app = createDevRoutes({ getMemoryByScope });
      const res = await request(app, "/memory/user");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(getMemoryByScope).toHaveBeenCalledWith("user", undefined, undefined);
    });

    it("passes query and tags parameters", async () => {
      const getMemoryByScope = vi.fn(() => []);
      const app = createDevRoutes({ getMemoryByScope });
      await request(app, "/memory/agent?q=search&tags=important");
      expect(getMemoryByScope).toHaveBeenCalledWith("agent", "search", "important");
    });
  });

  describe("POST /memory", () => {
    it("returns 400 when no callback", async () => {
      const app = createDevRoutes({});
      const res = await requestWithMethod(app, "/memory", "POST", JSON.stringify({ content: "test" }), "application/json");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Memory creation not available");
    });

    it("returns 201 with id when entry created", async () => {
      const createMemoryEntry = vi.fn(() => ({ id: "mem-abc" }));
      const app = createDevRoutes({ createMemoryEntry });
      const res = await requestWithMethod(app, "/memory", "POST", JSON.stringify({ content: "test", scope: "user" }), "application/json");
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBe("mem-abc");
    });
  });

  describe("DELETE /memory/:id", () => {
    it("returns 404 when no callback", async () => {
      const app = createDevRoutes({});
      const res = await requestWithMethod(app, "/memory/mem-abc", "DELETE");
      expect(res.status).toBe(404);
    });

    it("returns 404 when entry not found", async () => {
      const app = createDevRoutes({ deleteMemoryEntry: () => false });
      const res = await requestWithMethod(app, "/memory/mem-abc", "DELETE");
      expect(res.status).toBe(404);
    });

    it("returns ok when entry deleted", async () => {
      const deleteMemoryEntry = vi.fn(() => true);
      const app = createDevRoutes({ deleteMemoryEntry });
      const res = await requestWithMethod(app, "/memory/mem-abc", "DELETE");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(deleteMemoryEntry).toHaveBeenCalledWith("mem-abc");
    });
  });

  describe("GET /eval/experiments", () => {
    it("returns empty array when no callback", async () => {
      const app = createDevRoutes({});
      const res = await request(app, "/eval/experiments");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it("returns experiments from callback", async () => {
      const experiments = [
        { name: "accuracy-test", dataset: "qa-pairs.jsonl", scorers: ["exact_match", "faithfulness"] },
        { name: "latency-test", scorers: ["latency"] },
      ];
      const app = createDevRoutes({ getEvalExperiments: () => experiments });
      const res = await request(app, "/eval/experiments");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data[0].name).toBe("accuracy-test");
      expect(data[1].scorers).toEqual(["latency"]);
    });
  });

  describe("GET /eval/experiments/:name/results", () => {
    it("returns 404 when no callback", async () => {
      const app = createDevRoutes({});
      const res = await request(app, "/eval/experiments/accuracy-test/results");
      expect(res.status).toBe(404);
    });

    it("returns 404 when experiment not found", async () => {
      const app = createDevRoutes({ getEvalResults: () => undefined });
      const res = await request(app, "/eval/experiments/unknown/results");
      expect(res.status).toBe(404);
    });

    it("returns results from callback", async () => {
      const results = { scores: { exact_match: 0.85 }, runAt: "2026-01-01T00:00:00Z" };
      const getEvalResults = vi.fn(() => results);
      const app = createDevRoutes({ getEvalResults });
      const res = await request(app, "/eval/experiments/accuracy-test/results");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.scores.exact_match).toBe(0.85);
      expect(getEvalResults).toHaveBeenCalledWith("accuracy-test");
    });
  });

  describe("POST /run", () => {
    it("returns 404 when no startRun callback", async () => {
      const app = createDevRoutes({});
      const res = await requestWithMethod(app, "/run", "POST", JSON.stringify({ task: "hello" }), "application/json");
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Orchestrator not available");
    });

    it("returns 400 when task is empty", async () => {
      const startRun = vi.fn(() => ({ sessionId: "s1" }));
      const app = createDevRoutes({ startRun });
      const res = await requestWithMethod(app, "/run", "POST", JSON.stringify({ task: "" }), "application/json");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("task is required");
    });

    it("returns 400 when body has no task field", async () => {
      const startRun = vi.fn(() => ({ sessionId: "s1" }));
      const app = createDevRoutes({ startRun });
      const res = await requestWithMethod(app, "/run", "POST", JSON.stringify({}), "application/json");
      expect(res.status).toBe(400);
    });

    it("returns 201 with sessionId on success", async () => {
      const startRun = vi.fn(() => ({ sessionId: "sess-abc" }));
      const app = createDevRoutes({ startRun });
      const res = await requestWithMethod(app, "/run", "POST", JSON.stringify({ task: "Build feature X" }), "application/json");
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.sessionId).toBe("sess-abc");
      expect(startRun).toHaveBeenCalledWith("Build feature X");
    });

    it("returns 409 when run already in progress", async () => {
      const startRun = vi.fn(() => ({ error: "A run is already in progress" }));
      const app = createDevRoutes({ startRun });
      const res = await requestWithMethod(app, "/run", "POST", JSON.stringify({ task: "Another task" }), "application/json");
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe("A run is already in progress");
    });
  });

  describe("GET /run", () => {
    it("returns idle status when no getRunStatus callback", async () => {
      const app = createDevRoutes({});
      const res = await request(app, "/run");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ sessionId: null, status: "idle", phase: null, task: null });
    });

    it("returns current run status from callback", async () => {
      const getRunStatus = vi.fn(() => ({
        sessionId: "sess-xyz",
        status: "running",
        phase: "implement",
        task: "Build feature",
      }));
      const app = createDevRoutes({ getRunStatus });
      const res = await request(app, "/run");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sessionId).toBe("sess-xyz");
      expect(data.status).toBe("running");
      expect(data.phase).toBe("implement");
      expect(data.task).toBe("Build feature");
    });
  });

  describe("POST /approve", () => {
    it("returns 404 when no approvePhase callback configured", async () => {
      const app = createDevRoutes({});
      const res = await requestWithMethod(app, "/approve", "POST", JSON.stringify({}), "application/json");
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("No active orchestrator");
    });

    it("returns 409 when callback signals no approval pending", async () => {
      const approvePhase = vi.fn(() => ({ ok: false, error: "No gate is awaiting approval" }));
      const app = createDevRoutes({ approvePhase });
      const res = await requestWithMethod(app, "/approve", "POST", JSON.stringify({}), "application/json");
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe("No gate is awaiting approval");
    });

    it("returns 200 and ok:true when approval succeeds", async () => {
      const approvePhase = vi.fn(() => ({ ok: true }));
      const app = createDevRoutes({ approvePhase });
      const res = await requestWithMethod(app, "/approve", "POST", JSON.stringify({}), "application/json");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(approvePhase).toHaveBeenCalledWith(undefined);
    });

    it("passes sessionId from request body to callback", async () => {
      const approvePhase = vi.fn(() => ({ ok: true }));
      const app = createDevRoutes({ approvePhase });
      await requestWithMethod(app, "/approve", "POST", JSON.stringify({ sessionId: "sess-123" }), "application/json");
      expect(approvePhase).toHaveBeenCalledWith("sess-123");
    });

    it("handles missing body gracefully", async () => {
      const approvePhase = vi.fn(() => ({ ok: true }));
      const app = createDevRoutes({ approvePhase });
      const res = await requestWithMethod(app, "/approve", "POST");
      expect(res.status).toBe(200);
      expect(approvePhase).toHaveBeenCalledWith(undefined);
    });
  });

  describe("POST /reject", () => {
    it("returns 404 when no rejectPhase callback configured", async () => {
      const app = createDevRoutes({});
      const res = await requestWithMethod(app, "/reject", "POST", JSON.stringify({ reason: "Plan too risky" }), "application/json");
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("No active orchestrator");
    });

    it("returns 409 when callback signals no approval pending", async () => {
      const rejectPhase = vi.fn(() => ({ ok: false, error: "No gate is awaiting approval" }));
      const app = createDevRoutes({ rejectPhase });
      const res = await requestWithMethod(app, "/reject", "POST", JSON.stringify({ reason: "bad plan" }), "application/json");
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe("No gate is awaiting approval");
    });

    it("returns 200 and ok:true when rejection succeeds", async () => {
      const rejectPhase = vi.fn(() => ({ ok: true }));
      const app = createDevRoutes({ rejectPhase });
      const res = await requestWithMethod(app, "/reject", "POST", JSON.stringify({ reason: "Needs rework" }), "application/json");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(rejectPhase).toHaveBeenCalledWith("Needs rework", undefined);
    });

    it("passes sessionId and reason from request body to callback", async () => {
      const rejectPhase = vi.fn(() => ({ ok: true }));
      const app = createDevRoutes({ rejectPhase });
      await requestWithMethod(app, "/reject", "POST", JSON.stringify({ reason: "Scope too broad", sessionId: "sess-456" }), "application/json");
      expect(rejectPhase).toHaveBeenCalledWith("Scope too broad", "sess-456");
    });

    it("uses empty string reason when body is missing", async () => {
      const rejectPhase = vi.fn(() => ({ ok: true }));
      const app = createDevRoutes({ rejectPhase });
      const res = await requestWithMethod(app, "/reject", "POST");
      expect(res.status).toBe(200);
      expect(rejectPhase).toHaveBeenCalledWith("", undefined);
    });
  });

  describe("POST /token", () => {
    it("returns 404 when no issueToken callback", async () => {
      const app = createDevRoutes({});
      const res = await requestWithMethod(app, "/token", "POST", JSON.stringify({}), "application/json");
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Token management not available");
    });

    it("returns token and userId on success", async () => {
      const issueToken = vi.fn(() => "tok-abc-123");
      const app = createDevRoutes({ issueToken });
      const res = await requestWithMethod(app, "/token", "POST", JSON.stringify({ userId: "custom-user" }), "application/json");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBe("tok-abc-123");
      expect(data.userId).toBe("custom-user");
      expect(issueToken).toHaveBeenCalledWith("custom-user");
    });

    it("uses dev-user default when body is empty", async () => {
      const issueToken = vi.fn(() => "tok-default");
      const app = createDevRoutes({ issueToken });
      const res = await requestWithMethod(app, "/token", "POST");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBe("tok-default");
      expect(data.userId).toBe("dev-user");
      expect(issueToken).toHaveBeenCalledWith("dev-user");
    });
  });
});
