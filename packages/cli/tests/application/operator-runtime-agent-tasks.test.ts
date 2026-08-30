import { describe, expect, it, vi } from "vitest";
import { OPERATOR_RUNTIME_APPLICATION_PATH } from "@kilnai/runtime";
import { createOperatorRuntimeAgentTaskClient } from "../../src/application/operator-runtime-agent-tasks.js";

describe("createOperatorRuntimeAgentTaskClient", () => {
  it("sends closed Agent Task requests over the authenticated application path", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1,
      status: "ok",
      result: { id: "job-1", state: "queued" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = createOperatorRuntimeAgentTaskClient({
      request,
      endpoint: vi.fn(),
      close: vi.fn(),
    });

    await expect(client.submit({
      objective: "Review",
      configuredAgentProfileId: "reviewer",
      idempotencyKey: "review-1",
    })).resolves.toEqual({ id: "job-1", state: "queued" });
    expect(request).toHaveBeenCalledWith(OPERATOR_RUNTIME_APPLICATION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        operation: "agent-task.submit",
        input: {
          objective: "Review",
          configuredAgentProfileId: "reviewer",
          idempotencyKey: "review-1",
        },
      }),
    });
  });

  it("does not expose raw Runtime result payloads when the protocol returns a bounded error", async () => {
    const client = createOperatorRuntimeAgentTaskClient({
      request: vi.fn(async () => new Response(JSON.stringify({
        schemaVersion: 1,
        status: "error",
        error: { code: "authority_rejected", message: "Agent Task application rejected the operation." },
      }), { status: 200, headers: { "content-type": "application/json" } })),
      endpoint: vi.fn(),
      close: vi.fn(),
    });
    await expect(client.status("job-1")).rejects.toThrow("Agent Task application rejected the operation.");
  });
});
