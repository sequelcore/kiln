import { describe, expect, it, vi } from "vitest";
import { OPERATOR_RUNTIME_APPLICATION_PATH } from "@kilnai/runtime";
import { createOperatorRuntimeAgentTaskClient } from "../../src/application/operator-runtime-agent-tasks.js";

describe("createOperatorRuntimeAgentTaskClient", () => {
  it("retries an exact transient unavailable submission with bounded backoff and the same request", async () => {
    const transientUnavailableResponse = () => new Response(JSON.stringify({
      schemaVersion: 1,
      status: "error",
      error: {
        code: "authority_rejected",
        message: "Agent Task application rejected the operation (unavailable).",
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
    const request = vi.fn()
      .mockResolvedValueOnce(transientUnavailableResponse())
      .mockResolvedValueOnce(transientUnavailableResponse())
      .mockResolvedValueOnce(transientUnavailableResponse())
      .mockResolvedValueOnce(transientUnavailableResponse())
      .mockResolvedValueOnce(transientUnavailableResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: 1,
        status: "ok",
        result: { id: "job-1", state: "awaiting_approval" },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const wait = vi.fn(async () => undefined);
    const client = createOperatorRuntimeAgentTaskClient({
      request,
      endpoint: vi.fn(),
      close: vi.fn(),
    }, { retryDelaysMs: [11, 22, 33, 44, 55], wait });

    await expect(client.submit({
      objective: "Implement the approved worker change.",
      configuredAgentProfileId: "luna-worker",
      idempotencyKey: "luna-worker-submit-1",
    })).resolves.toEqual({ id: "job-1", state: "awaiting_approval" });

    expect(request).toHaveBeenCalledTimes(6);
    expect(request.mock.calls.slice(1)).toEqual(request.mock.calls.slice(0, -1));
    expect(wait.mock.calls).toEqual([[11], [22], [33], [44], [55]]);
  });

  it("does not retry a non-transient rejection and exhausts the bounded transient backoff", async () => {
    const nonTransientRequest = vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1,
      status: "error",
      error: {
        code: "authority_rejected",
        message: "Agent Task application rejected the operation (profile_unavailable).",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const nonTransientWait = vi.fn(async () => undefined);
    const nonTransientClient = createOperatorRuntimeAgentTaskClient({
      request: nonTransientRequest,
      endpoint: vi.fn(),
      close: vi.fn(),
    }, { retryDelaysMs: [11, 22, 33, 44, 55], wait: nonTransientWait });

    await expect(nonTransientClient.submit({
      objective: "Reject this profile.",
      configuredAgentProfileId: "luna-worker",
      idempotencyKey: "luna-worker-submit-2",
    })).rejects.toThrow("profile_unavailable");
    expect(nonTransientRequest).toHaveBeenCalledOnce();
    expect(nonTransientWait).not.toHaveBeenCalled();

    const transientRequest = vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1,
      status: "error",
      error: {
        code: "authority_rejected",
        message: "Agent Task application rejected the operation (unavailable).",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const transientWait = vi.fn(async () => undefined);
    const transientClient = createOperatorRuntimeAgentTaskClient({
      request: transientRequest,
      endpoint: vi.fn(),
      close: vi.fn(),
    }, { retryDelaysMs: [11, 22, 33, 44, 55], wait: transientWait });

    await expect(transientClient.submit({
      objective: "Exhaust bounded retries.",
      configuredAgentProfileId: "luna-worker",
      idempotencyKey: "luna-worker-submit-3",
    })).rejects.toThrow("unavailable");
    expect(transientRequest).toHaveBeenCalledTimes(6);
    expect(transientWait.mock.calls).toEqual([[11], [22], [33], [44], [55]]);
  });

  it("does not retry transport, protocol, or non-application failures", async () => {
    const requests = [
      vi.fn(async () => new Response("upstream unavailable", { status: 503 })),
      vi.fn(async () => new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })),
      vi.fn(async () => { throw new Error("unavailable"); }),
    ];

    for (const [index, request] of requests.entries()) {
      const wait = vi.fn(async () => undefined);
      const client = createOperatorRuntimeAgentTaskClient({
        request,
        endpoint: vi.fn(),
        close: vi.fn(),
      }, { retryDelaysMs: [11, 22, 33, 44, 55], wait });

      await expect(client.submit({
        objective: "Do not retry this failure.",
        configuredAgentProfileId: "luna-worker",
        idempotencyKey: `luna-worker-submit-no-retry-${index}`,
      })).rejects.toThrow();
      expect(request).toHaveBeenCalledOnce();
      expect(wait).not.toHaveBeenCalled();
    }
  });

  it("sends closed Agent Task requests over the authenticated application path", async () => {
    const request = vi.fn(async (_path: string, _init: RequestInit) => new Response(JSON.stringify({
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

  it("sends the typed vision capability without exposing caller or route authority", async () => {
    const request = vi.fn(async (_path: string, _init: RequestInit) => new Response(JSON.stringify({
      schemaVersion: 1,
      status: "ok",
      result: { id: "job-vision-1", state: "queued" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = createOperatorRuntimeAgentTaskClient({
      request,
      endpoint: vi.fn(),
      close: vi.fn(),
    });

    await client.submit({
      objective: "Analyze the admitted image.",
      configuredAgentProfileId: "vision-worker",
      idempotencyKey: "vision-submit-1",
      capability: {
        capabilityId: "vision.analyze",
        contract: "vision.analyze/v1",
        input: {
          resourceUris: ["kiln://project/artifacts/image-1"],
          instruction: "Summarize the visible evidence.",
        },
      },
    });

    expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string)).toEqual({
      schemaVersion: 1,
      operation: "agent-task.submit",
      input: {
        objective: "Analyze the admitted image.",
        configuredAgentProfileId: "vision-worker",
        idempotencyKey: "vision-submit-1",
        capability: {
          capabilityId: "vision.analyze",
          contract: "vision.analyze/v1",
          input: {
            resourceUris: ["kiln://project/artifacts/image-1"],
            instruction: "Summarize the visible evidence.",
          },
        },
      },
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
