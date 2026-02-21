// A2A Server: JSON-RPC 2.0 endpoints per A2A spec

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AgentCard, A2AMessage, A2ATaskStatus, A2AArtifact } from "@kilnai/core";
import { KilnError } from "@kilnai/core";
import { A2ATaskStore } from "./a2a-task-store.js";

export interface A2AServerConfig {
  readonly agentCard: AgentCard;
  readonly taskStore: A2ATaskStore;
  readonly executeTask: (taskId: string, message: A2AMessage) => Promise<{ status: A2ATaskStatus; artifacts?: readonly A2AArtifact[] }>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
}

interface JsonRpcSuccessResponse<T> {
  jsonrpc: "2.0";
  result: T;
  id?: string | number;
}

interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
  id?: string | number;
}

const JSON_RPC_ERRORS = {
  INVALID_REQUEST: { code: -32600, message: "Invalid Request" },
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
  INVALID_PARAMS: { code: -32602, message: "Invalid params" },
  INTERNAL_ERROR: { code: -32603, message: "Internal error" },
  TASK_NOT_FOUND: { code: -32001, message: "Task not found" },
} as const;

function createSuccessResponse<T>(result: T, id?: string | number): JsonRpcSuccessResponse<T> {
  return { jsonrpc: "2.0", result, id };
}

function createErrorResponse(code: number, message: string, id?: string | number, data?: unknown): JsonRpcErrorResponse {
  return { jsonrpc: "2.0", error: { code, message, data }, id };
}

export function createA2ARoutes(config: A2AServerConfig): Hono {
  const app = new Hono();
  const { agentCard, taskStore, executeTask } = config;

  app.get("/.well-known/agent.json", (c) => {
    return c.json(agentCard);
  });

  app.post("/", async (c) => {
    let request: JsonRpcRequest;
    try {
      request = await c.req.json<JsonRpcRequest>();
    } catch {
      return c.json(createErrorResponse(-32600, "Parse error"), 400);
    }

    if (request.jsonrpc !== "2.0") {
      return c.json(createErrorResponse(JSON_RPC_ERRORS.INVALID_REQUEST.code, JSON_RPC_ERRORS.INVALID_REQUEST.message, request.id), 400);
    }

    const { method, params, id } = request;

    switch (method) {
      case "tasks/send": {
        if (!params || typeof params.message !== "object") {
          return c.json(createErrorResponse(JSON_RPC_ERRORS.INVALID_PARAMS.code, "Missing 'message' in params", id), 400);
        }

        const taskId = crypto.randomUUID();
        const message = params.message as A2AMessage;

        try {
          taskStore.createTask(taskId, message);
          const result = await executeTask(taskId, message);
          const updatedTask = taskStore.updateStatus(taskId, result.status, result.artifacts);
          return c.json(createSuccessResponse(updatedTask, id));
        } catch (err) {
          const error = err instanceof KilnError ? err : new KilnError("A2A_TASK_FAILED", String(err));
          const failedStatus: A2ATaskStatus = {
            state: "failed",
            message: error.message,
            timestamp: new Date().toISOString(),
          };
          taskStore.updateStatus(taskId, failedStatus);
          return c.json(createErrorResponse(JSON_RPC_ERRORS.INTERNAL_ERROR.code, error.message, id), 500);
        }
      }

      case "tasks/sendSubscribe": {
        if (!params || typeof params.message !== "object") {
          return c.json(createErrorResponse(JSON_RPC_ERRORS.INVALID_PARAMS.code, "Missing 'message' in params", id), 400);
        }

        const taskId = crypto.randomUUID();
        const message = params.message as A2AMessage;

        return streamSSE(c, async (stream) => {
          taskStore.createTask(taskId, message);

          await stream.writeSSE({
            event: "task-created",
            data: JSON.stringify({ taskId }),
          });

          try {
            const workingStatus: A2ATaskStatus = { state: "working", timestamp: new Date().toISOString() };
            taskStore.updateStatus(taskId, workingStatus);

            await stream.writeSSE({
              event: "status-update",
              data: JSON.stringify({ taskId, status: workingStatus }),
            });

            const result = await executeTask(taskId, message);
            const updatedTask = taskStore.updateStatus(taskId, result.status, result.artifacts);

            await stream.writeSSE({
              event: "task-completed",
              data: JSON.stringify({ taskId, task: updatedTask }),
            });
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            const failedStatus: A2ATaskStatus = { state: "failed", message: error, timestamp: new Date().toISOString() };
            taskStore.updateStatus(taskId, failedStatus);

            await stream.writeSSE({
              event: "task-failed",
              data: JSON.stringify({ taskId, error }),
            });
          }
        });
      }

      case "tasks/get": {
        if (!params || typeof params.id !== "string") {
          return c.json(createErrorResponse(JSON_RPC_ERRORS.INVALID_PARAMS.code, "Missing 'id' in params", id), 400);
        }

        const task = taskStore.getTask(params.id);
        if (!task) {
          return c.json(createErrorResponse(JSON_RPC_ERRORS.TASK_NOT_FOUND.code, JSON_RPC_ERRORS.TASK_NOT_FOUND.message, id), 404);
        }

        return c.json(createSuccessResponse(task, id));
      }

      case "tasks/cancel": {
        if (!params || typeof params.id !== "string") {
          return c.json(createErrorResponse(JSON_RPC_ERRORS.INVALID_PARAMS.code, "Missing 'id' in params", id), 400);
        }

        const task = taskStore.cancelTask(params.id);
        if (!task) {
          return c.json(createErrorResponse(JSON_RPC_ERRORS.TASK_NOT_FOUND.code, JSON_RPC_ERRORS.TASK_NOT_FOUND.message, id), 404);
        }

        return c.json(createSuccessResponse(task, id));
      }

      default:
        return c.json(createErrorResponse(JSON_RPC_ERRORS.METHOD_NOT_FOUND.code, JSON_RPC_ERRORS.METHOD_NOT_FOUND.message, id), 404);
    }
  });

  return app;
}
