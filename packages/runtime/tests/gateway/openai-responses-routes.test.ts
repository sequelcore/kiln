import { describe, expect, it, vi } from "vitest";
import { createAccountRef, type ModelTurnResult } from "@kilnai/core";
import { createGatewayApp } from "../../src/gateway/gateway-routes.js";
import {
  OPENAI_RESPONSES_RAW_BODY_MAX_BYTES,
  createOpenAIResponsesRoutes,
  type OpenAIResponsesIngressConfig,
} from "../../src/gateway/openai-responses-routes.js";
import { OPENAI_RESPONSES_PROTOCOL_LIMITS } from "../../src/gateway/openai-responses-protocol.js";
import {
  GovernedOneRoundCommittedError,
  GovernedOneRoundInvocationError,
} from "../../src/model-gateway/governed-one-round-invocation.js";

const route = { providerId: "fixture-provider", providerModelId: "fixture-model", scope: "fixture" };
const principal = {
  tenantId: "tenant-trusted",
  applicationId: "application-trusted",
  callerId: "codex-fixture",
  capabilityId: "capability-1",
  scopes: ["model.invoke"],
  budgetEvidence: { status: "admitted" as const, evidenceId: "budget-1" },
};
const textResult: ModelTurnResult = {
  parts: [{ type: "text", text: "done" }],
  usage: { inputTokens: 4, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 0 },
  stopReason: "completed",
};

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: "codex-virtual",
    input: [{ type: "message", role: "user", content: "hello" }],
    stream: true,
    store: false,
    ...overrides,
  };
}

function config(overrides: Partial<OpenAIResponsesIngressConfig> = {}) {
  const execute = vi.fn(async () => ({ result: textResult } as never));
  const record = vi.fn(async () => undefined);
  const namespace = vi.fn(async () => ({ sessionId: "ns:tenant:session-1", turnId: "ns:tenant:turn-1" }));
  const value: OpenAIResponsesIngressConfig = {
    authenticateBearer: async (token) => token === "valid-token" ? principal : undefined,
    resolveVirtualModel: async ({ requestedModel }) => requestedModel === "codex-virtual" ? {
      route,
      capabilities: new Set(["text", "function-tools", "custom-tools-lark"]),
      affinity: { continuity: "none" },
    } : undefined,
    namespaceCorrelation: namespace,
    compatibilityEvidence: { record },
    execute,
    createAttemptId: () => "attempt-server-1",
    createResponseId: () => "resp_server_1",
    ...overrides,
  };
  return { value, execute, record, namespace };
}

function request(payload: unknown = body(), headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { authorization: "Bearer valid-token", "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

describe("OpenAI Responses authenticated loopback ingress", () => {
  it("is opt-in on the gateway and mounts at /v1/responses", async () => {
    expect((await createGatewayApp({ port: 0, apps: [] }).request(request())).status).toBe(404);
    const fixture = config();
    const response = await createGatewayApp({ port: 0, apps: [], responsesIngress: fixture.value }).request(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-request-id")).toBe("resp_server_1");
    expect(OPENAI_RESPONSES_RAW_BODY_MAX_BYTES).toBeGreaterThan(OPENAI_RESPONSES_PROTOCOL_LIMITS.maxAggregateStringBytes);
  });

  it("requires JSON and a valid bearer without trusting spoofed identity headers", async () => {
    const fixture = config();
    const app = createOpenAIResponsesRoutes(fixture.value);
    expect((await app.request("/v1/responses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body()) })).status).toBe(401);
    expect((await app.request("/v1/responses", { method: "POST", headers: { authorization: "Bearer wrong", "content-type": "application/json" }, body: JSON.stringify(body()) })).status).toBe(401);
    expect((await app.request("/v1/responses", { method: "POST", headers: { authorization: "Bearer valid-token", "content-type": "text/plain" }, body: "{}" })).status).toBe(415);

    await app.request(request(body(), { "x-tenant-id": "tenant-spoofed", "x-application-id": "application-spoofed" }));
    expect(fixture.execute).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({ tenantId: "tenant-trusted", applicationId: "application-trusted" }),
      signal: expect.any(AbortSignal),
    }));
  });

  it("requires model.invoke scope before model resolution", async () => {
    const resolveVirtualModel = vi.fn(config().value.resolveVirtualModel);
    for (const scopes of [[], ["model.read"]]) {
      const fixture = config({ authenticateBearer: async () => ({ ...principal, scopes }), resolveVirtualModel });
      expect((await createOpenAIResponsesRoutes(fixture.value).request(request())).status).toBe(403);
      expect(fixture.execute).not.toHaveBeenCalled();
    }
    expect(resolveVirtualModel).not.toHaveBeenCalled();
  });

  it("rejects unknown virtual models without executing", async () => {
    const fixture = config();
    const response = await createOpenAIResponsesRoutes(fixture.value).request(request(body({ model: "missing" })));
    expect(response.status).toBe(404);
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it("validates server response identity and principal scopes before execution", async () => {
    const invalidResponseId = config({ createResponseId: () => " " });
    expect((await createOpenAIResponsesRoutes(invalidResponseId.value).request(request())).status).toBe(500);
    expect(invalidResponseId.execute).not.toHaveBeenCalled();
    const unsafeResponseId = config({ createResponseId: () => "resp\r\nunsafe" });
    expect((await createOpenAIResponsesRoutes(unsafeResponseId.value).request(request())).status).toBe(500);
    expect(unsafeResponseId.execute).not.toHaveBeenCalled();

    const invalidScopes = config({ authenticateBearer: async () => ({ ...principal, scopes: ["model.invoke", " "] }) });
    expect((await createOpenAIResponsesRoutes(invalidScopes.value).request(request())).status).toBe(500);
    expect(invalidScopes.execute).not.toHaveBeenCalled();
  });

  it("validates the configured ingress concurrency bound", () => {
    expect(() => createOpenAIResponsesRoutes(config({ maxConcurrentRequests: 0 }).value)).toThrow("maxConcurrentRequests");
    expect(() => createOpenAIResponsesRoutes(config({ maxConcurrentRequests: 1.5 }).value)).toThrow("maxConcurrentRequests");
  });

  it("bounds a chunked body while reading instead of trusting Content-Length", async () => {
    const fixture = config({ maxBodyBytes: 32 });
    const chunks = [new TextEncoder().encode("{\"model\":\"codex-"), new TextEncoder().encode("virtual\",\"input\":[]}")];
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { const chunk = chunks.shift(); chunk ? controller.enqueue(chunk) : controller.close(); } });
    const response = await createOpenAIResponsesRoutes(fixture.value).request(new Request("http://127.0.0.1/v1/responses", {
      method: "POST", headers: { authorization: "Bearer valid-token", "content-type": "application/json" }, body: stream, duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(response.status).toBe(413);
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it("stream-decodes UTF-8 split across chunk boundaries", async () => {
    const fixture = config();
    const bytes = new TextEncoder().encode(JSON.stringify(body({ input: [{ type: "message", role: "user", content: "héllo 🌍" }] })));
    const split = bytes.indexOf(0xf0) + 2;
    const chunks = [bytes.slice(0, split), bytes.slice(split)];
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { const chunk = chunks.shift(); chunk ? controller.enqueue(chunk) : controller.close(); } });
    const response = await createOpenAIResponsesRoutes(fixture.value).request(new Request("http://127.0.0.1/v1/responses", {
      method: "POST", headers: { authorization: "Bearer valid-token", "content-type": "application/json" }, body: stream, duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(response.status).toBe(200);
    expect(fixture.execute).toHaveBeenCalledWith(expect.objectContaining({
      turn: expect.objectContaining({ history: [{ role: "user", parts: [{ type: "text", text: "héllo 🌍" }] }] }),
    }));
  });

  it("limits concurrent ingress and releases capacity after completion", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const execute = vi.fn(async () => { await pending; return { result: textResult } as never; });
    const fixture = config({ maxConcurrentRequests: 1, execute });
    const app = createOpenAIResponsesRoutes(fixture.value);
    const first = app.request(request());
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect((await app.request(request())).status).toBe(429);
    finish();
    expect((await first).status).toBe(200);
    expect((await app.request(request())).status).toBe(200);
  });

  it("namespaces consistent Codex correlation hints and rejects contradictions", async () => {
    const fixture = config();
    const app = createOpenAIResponsesRoutes(fixture.value);
    await app.request(request(body({ client_metadata: { session_id: "native-session", thread_id: "native-thread", turn_id: "native-turn" } }), {
      "session-id": "native-session", "thread-id": "native-thread", "x-client-request-id": "native-thread",
    }));
    expect(fixture.namespace).toHaveBeenCalledWith(expect.objectContaining({
      principal,
      observed: { sessionId: "native-session", threadId: "native-thread", turnId: "native-turn" },
    }));
    expect(fixture.execute).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-server-1",
      identity: expect.objectContaining({ sessionId: "ns:tenant:session-1", turnId: "ns:tenant:turn-1" }),
    }));

    const contradiction = await app.request(request(body({ client_metadata: { session_id: "another-session" } }), { "session-id": "native-session" }));
    expect(contradiction.status).toBe(400);
    const threadContradiction = await app.request(request(body(), { "thread-id": "native-thread", "x-client-request-id": "other-thread" }));
    expect(threadContradiction.status).toBe(400);
    const invalid = await app.request(request(body(), { "session-id": "x".repeat(257) }));
    expect(invalid.status).toBe(400);
  });

  it("records optional degradation and performs required preflight before execute", async () => {
    const degraded = config({ resolveVirtualModel: async () => ({
      route, capabilities: new Set(["text"]), affinity: { continuity: "none" },
    }) });
    const optional = await createOpenAIResponsesRoutes(degraded.value).request(request(body({ include: ["reasoning.encrypted_content"] })));
    expect(optional.status).toBe(200);
    expect(degraded.record).toHaveBeenCalledWith(expect.objectContaining({ status: "degraded", unavailableOptional: ["reasoning-encrypted-content"] }));

    const unsupported = config({ resolveVirtualModel: degraded.value.resolveVirtualModel });
    const response = await createOpenAIResponsesRoutes(unsupported.value).request(request(body({
      tools: [{ type: "custom", name: "patch", format: { type: "grammar", syntax: "lark", definition: "start: PATCH" } }],
    })));
    expect(response.status).toBe(422);
    expect(unsupported.record).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected" }));
    expect(unsupported.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["text", textResult, body()],
    ["function", {
      ...textResult,
      parts: [{ type: "tool-call", call: { kind: "function", id: "call-fn", name: "lookup", input: { kind: "json-object", value: { id: 7 } } } }],
    }, body({ tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }] })],
    ["custom", {
      ...textResult,
      parts: [{ type: "tool-call", call: { kind: "custom", id: "call-custom", name: "patch", input: { kind: "raw-text", value: "PATCH\r\n raw" } } }],
    }, body({ tools: [{ type: "custom", name: "patch", format: { type: "grammar", syntax: "lark", definition: "start: PATCH" } }] })],
  ])("returns spec-valid buffered SSE for %s output", async (_label, result, payload) => {
    const fixture = config({ execute: vi.fn(async () => ({ result } as never)) });
    const response = await createOpenAIResponsesRoutes(fixture.value).request(request(payload));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain("event: response.created");
    expect(text).toContain("event: response.completed");
    expect(text).not.toContain("undefined");
  });

  it("distinguishes committed from pre-dispatch failures without exposing raw errors", async () => {
    const committed = config({ execute: async () => { throw new GovernedOneRoundCommittedError(new Error("provider-token-secret"), [], { attemptId: "attempt-server-1", leaseId: "lease-1", phases: ["committed", "failed"] }); } });
    const committedResponse = await createOpenAIResponsesRoutes(committed.value).request(request());
    expect(committedResponse.status).toBe(409);
    expect(await committedResponse.text()).not.toContain("provider-token-secret");

    const unavailable = config({ execute: async () => { throw new Error("adapter-path-secret"); } });
    const unavailableResponse = await createOpenAIResponsesRoutes(unavailable.value).request(request());
    expect(unavailableResponse.status).toBe(503);
    expect(await unavailableResponse.text()).not.toContain("adapter-path-secret");
  });

  it("treats post-execution SSE projection failure as non-retry-safe", async () => {
    const fixture = config({ execute: async () => ({
      result: { ...textResult, parts: [{ type: "image", source: { kind: "url", url: "https://fixture.invalid/image" } }] },
    } as never) });
    const response = await createOpenAIResponsesRoutes(fixture.value).request(request());
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("unsupported-result-part");
  });

  it("records response projection omissions without masking committed success when evidence closeout fails", async () => {
    const record = vi.fn(async (evidence: { stage?: string }) => {
      if (evidence.stage === "response") throw new Error("evidence unavailable");
    });
    const fixture = config({
      compatibilityEvidence: { record },
      execute: async () => ({ result: { ...textResult, usage: { ...textResult.usage, cacheWriteTokens: 2 } } } as never),
    });
    const response = await createOpenAIResponsesRoutes(fixture.value).request(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-kiln-projection-omissions")).toBe("cache-write-tokens-not-representable");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      stage: "response", status: "degraded", omissionCodes: ["cache-write-tokens-not-representable"],
    }));
  });

  it("projects cancellation safely", async () => {
    const fixture = config({ execute: async () => { throw new GovernedOneRoundInvocationError("aborted", "raw cancellation detail"); } });
    const response = await createOpenAIResponsesRoutes(fixture.value).request(request());
    expect(response.status).toBe(499);
    expect(await response.text()).not.toContain("raw cancellation detail");
  });
});
