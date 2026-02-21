import { describe, it, expect, beforeEach } from "vitest";
import { createA2ARoutes, type A2AServerConfig } from "../../src/a2a/a2a-server-routes.js";
import { A2ATaskStore } from "../../src/a2a/a2a-task-store.js";
import type { AgentCard, A2AMessage, A2ATaskStatus, A2AArtifact } from "@kilnai/core";

describe("createA2ARoutes", () => {
  let store: A2ATaskStore;
  let app: ReturnType<typeof createA2ARoutes>;
  let executedTasks: Array<{ taskId: string; message: A2AMessage }> = [];

  const agentCard: AgentCard = {
    name: "test-agent",
    description: "Test agent",
    url: "https://example.com/agent",
    version: "1.0.0",
    capabilities: [],
  };

  const createMessage = (text: string): A2AMessage => ({
    role: "user",
    parts: [{ type: "text", text }],
  });

  const executeTask = async (taskId: string, message: A2AMessage): Promise<{ status: A2ATaskStatus; artifacts?: readonly A2AArtifact[] }> => {
    executedTasks.push({ taskId, message });
    return {
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [{ parts: [{ type: "text", text: `Result for task ${taskId}` }] }],
    };
  };

  beforeEach(() => {
    store = new A2ATaskStore();
    executedTasks = [];
    const config: A2AServerConfig = { agentCard, taskStore: store, executeTask };
    app = createA2ARoutes(config);
  });

  describe("GET /.well-known/agent.json", () => {
    it("returns the agent card", async () => {
      const res = await app.request("/.well-known/agent.json");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(agentCard);
    });
  });

  describe("POST / (JSON-RPC)", () => {
    describe("tasks/send", () => {
      it("creates and executes task", async () => {
        const message = createMessage("Hello");
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tasks/send",
            params: { message },
            id: "1",
          }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.jsonrpc).toBe("2.0");
        expect(body.result.status.state).toBe("completed");
        expect(body.result.artifacts).toBeDefined();
        expect(executedTasks).toHaveLength(1);
      });

      it("returns error for missing message param", async () => {
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tasks/send",
            params: {},
            id: "1",
          }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe(-32602);
      });
    });

    describe("tasks/get", () => {
      it("returns existing task", async () => {
        const message = createMessage("Hello");
        await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tasks/send",
            params: { message },
            id: "1",
          }),
        });

        const taskId = executedTasks[0]!.taskId;
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tasks/get",
            params: { id: taskId },
            id: "2",
          }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.result.id).toBe(taskId);
      });

      it("returns error for unknown task", async () => {
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tasks/get",
            params: { id: "unknown-task" },
            id: "1",
          }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error.code).toBe(-32001);
      });

      it("returns error for missing id param", async () => {
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tasks/get",
            params: {},
            id: "1",
          }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe(-32602);
      });
    });

    describe("tasks/cancel", () => {
      it("cancels active task", async () => {
        const message = createMessage("Hello");
        store.createTask("task-to-cancel", message);
        store.updateStatus("task-to-cancel", { state: "working", timestamp: new Date().toISOString() });

        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tasks/cancel",
            params: { id: "task-to-cancel" },
            id: "1",
          }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.result.status.state).toBe("canceled");
      });

      it("returns error for unknown task", async () => {
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tasks/cancel",
            params: { id: "unknown-task" },
            id: "1",
          }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error.code).toBe(-32001);
      });
    });

    describe("error handling", () => {
      it("returns -32600 for invalid JSON-RPC version", async () => {
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "1.0",
            method: "tasks/send",
            params: { message: createMessage("Hello") },
            id: "1",
          }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe(-32600);
      });

      it("returns -32601 for unknown method", async () => {
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "unknown/method",
            id: "1",
          }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error.code).toBe(-32601);
      });

      it("returns -32600 for parse error", async () => {
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not valid json",
        });

        expect(res.status).toBe(400);
      });
    });
  });
});
