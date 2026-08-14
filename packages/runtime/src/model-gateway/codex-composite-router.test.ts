import { describe, expect, it, vi } from "vitest";
import type { ModelGatewayConfig } from "@kilnai/core";
import {
  CODEX_COMPOSITE_PATH_PREFIX,
  createCodexCompositeCapability,
  createCodexCompositeFetch,
} from "./codex-composite-router.js";

const token = "codex-principal-token-that-is-at-least-thirty-two-bytes";

function config(): ModelGatewayConfig {
  return {
    port: 4910,
    replay: { ttlMs: 1_000, maxEntries: 10, hmacKeyEnv: "REPLAY_KEY" },
    surfaces: { openAIResponses: { maxBodyBytes: 1_024 * 1_024, maxConcurrentRequests: 1 } },
    codexComposite: { maxQueuedRequests: 2, queueTimeoutMs: 1_000 },
    principals: [{
      tokenEnv: "CODEX_GATEWAY_TOKEN",
      ingress: "openai-responses",
      tenantId: "tenant",
      applicationId: "codex",
      callerId: "native",
      capabilityId: "invoke",
      scopes: ["model.invoke"],
      budgetEvidenceId: "budget",
      virtualModelIds: ["kiln/model-a"],
      nativeHarness: "codex",
    }],
    virtualModels: [{
      id: "kiln/model-a",
      displayName: "Model A",
      contextTokens: 200_000,
      outputTokens: 8_192,
      executionRouteId: "model-a-route",
      capabilities: ["text", "function-tools"],
      affinity: { continuity: "none" },
    }],
  };
}

function compositeUrl(path = "/responses"): string {
  return `http://127.0.0.1:4910${CODEX_COMPOSITE_PATH_PREFIX}/${createCodexCompositeCapability(token)}/v1${path}`;
}

describe("Codex composite router", () => {
  it("routes virtual model IDs into canonical ingress with the configured principal", async () => {
    const canonicalFetch = vi.fn(async (request: Request) => new Response(await request.text(), { status: 207 }));
    const nativeFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response());
    const routed = createCodexCompositeFetch({
      config: config(),
      env: { CODEX_GATEWAY_TOKEN: token },
      canonicalFetch,
      nativeFetch,
    });

    const response = await routed(new Request(compositeUrl(), {
      method: "POST",
      headers: { authorization: "Bearer native-oauth", "content-type": "application/json" },
      body: JSON.stringify({
        model: "kiln/model-a", input: [], parallel_tool_calls: true,
        reasoning: { effort: "medium" }, text: { verbosity: "medium" },
        tools: [
          { type: "function", name: "read", parameters: {} },
          { type: "custom", name: "exec", format: { type: "grammar", syntax: "lark", definition: "start: /.+/" } },
          { type: "web_search", external_web_access: true },
        ],
      }),
    }));

    expect(response.status).toBe(207);
    expect(nativeFetch).not.toHaveBeenCalled();
    const forwarded = canonicalFetch.mock.calls[0]![0];
    expect(forwarded.url).toBe("http://127.0.0.1:4910/v1/responses");
    expect(forwarded.headers.get("authorization")).toBe(`Bearer ${token}`);
    const routedBody = JSON.parse(await response.text());
    expect(routedBody).toMatchObject({
      model: "kiln/model-a",
      tools: [{ type: "function", name: "read" }],
      parallel_tool_calls: false,
    });
    expect(routedBody).not.toHaveProperty("reasoning");
    expect(routedBody).not.toHaveProperty("text");
  });

  it("passes native IDs to the native Codex backend with only admitted headers", async () => {
    const canonicalFetch = vi.fn();
    const nativeFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("native", {
      headers: { "content-type": "text/event-stream", "x-request-id": "upstream" },
    }));
    const routed = createCodexCompositeFetch({
      config: config(),
      env: { CODEX_GATEWAY_TOKEN: token },
      canonicalFetch,
      nativeFetch,
    });

    const response = await routed(new Request(compositeUrl(), {
      method: "POST",
      headers: {
        authorization: "Bearer native-oauth",
        "chatgpt-account-id": "account-a",
        "x-codex-installation-id": "install-a",
        cookie: "must-not-forward",
        "x-api-key": "must-not-forward",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-5.6-sol", input: [] }),
    }));

    expect(await response.text()).toBe("native");
    expect(canonicalFetch).not.toHaveBeenCalled();
    const [url, init] = nativeFetch.mock.calls[0]!;
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer native-oauth");
    expect(headers.get("chatgpt-account-id")).toBe("account-a");
    expect(headers.get("x-codex-installation-id")).toBe("install-a");
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("x-api-key")).toBe(false);
  });

  it("holds ingress capacity until an upstream response body is cancelled", async () => {
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const nativeFetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controllers.push(controller); },
    })));
    const routed = createCodexCompositeFetch({
      config: config(), env: { CODEX_GATEWAY_TOKEN: token }, canonicalFetch: vi.fn(), nativeFetch,
    });
    const request = () => new Request(compositeUrl(), {
      method: "POST", headers: { authorization: "Bearer native-oauth", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-sol", input: [] }),
    });

    const first = await routed(request());
    const second = routed(request());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(nativeFetch).toHaveBeenCalledOnce();

    await first.body!.cancel();
    const secondResponse = await second;
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    await secondResponse.body!.cancel();
    expect(controllers).toHaveLength(2);
  });

  it("releases ingress capacity when an upstream response body completes or errors", async () => {
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const nativeFetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controllers.push(controller); },
    })));
    const routed = createCodexCompositeFetch({
      config: config(), env: { CODEX_GATEWAY_TOKEN: token }, canonicalFetch: vi.fn(), nativeFetch,
    });
    const request = () => new Request(compositeUrl(), {
      method: "POST", headers: { authorization: "Bearer native-oauth", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-sol", input: [] }),
    });

    const completed = await routed(request());
    const queuedAfterCompletion = routed(request());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(nativeFetch).toHaveBeenCalledOnce();
    controllers[0]!.close();
    await completed.text();
    const errored = await queuedAfterCompletion;
    const queuedAfterError = routed(request());
    controllers[1]!.error(new Error("upstream closed"));
    await expect(errored.text()).rejects.toThrow("upstream closed");
    const finalResponse = await queuedAfterError;
    expect(nativeFetch).toHaveBeenCalledTimes(3);
    await finalResponse.body!.cancel();
  });

  it("releases ingress capacity when the caller aborts an unread response body", async () => {
    const nativeFetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({})));
    const routed = createCodexCompositeFetch({
      config: config(), env: { CODEX_GATEWAY_TOKEN: token }, canonicalFetch: vi.fn(), nativeFetch,
    });
    const abort = new AbortController();
    const request = (signal?: AbortSignal) => new Request(compositeUrl(), {
      method: "POST", signal, headers: { authorization: "Bearer native-oauth", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-sol", input: [] }),
    });

    await routed(request(abort.signal));
    const queued = routed(request());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(nativeFetch).toHaveBeenCalledOnce();
    abort.abort();
    const response = await queued;
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    await response.body!.cancel();
  });

  it("releases ingress capacity immediately for a response without a body", async () => {
    const nativeFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const routed = createCodexCompositeFetch({
      config: config(), env: { CODEX_GATEWAY_TOKEN: token }, canonicalFetch: vi.fn(), nativeFetch,
    });
    const request = () => new Request(compositeUrl(), {
      method: "POST", headers: { authorization: "Bearer native-oauth", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-sol", input: [] }),
    });

    await routed(request());
    await routed(request());
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it("compacts virtual history through a governed summarization turn", async () => {
    const canonicalFetch = vi.fn(async (_request: Request) => new Response([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"checkpoint "}\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"summary"}\n',
      "data: [DONE]\n",
    ].join("\n"), { headers: { "content-type": "text/event-stream" } }));
    const routed = createCodexCompositeFetch({
      config: config(), env: { CODEX_GATEWAY_TOKEN: token }, canonicalFetch,
      nativeFetch: vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response()),
    });

    const response = await routed(new Request(compositeUrl("/responses/compact"), {
      method: "POST", headers: { authorization: "Bearer native-oauth", "content-type": "application/json" },
      body: JSON.stringify({ model: "kiln/model-a", input: [{ type: "message", role: "user", content: "retain this" }] }),
    }));

    expect(response.status).toBe(200);
    const summarizationRequest = JSON.parse(await canonicalFetch.mock.calls[0]![0].text());
    expect(summarizationRequest).toMatchObject({ model: "kiln/model-a", stream: true, store: false, tools: [] });
    await expect(response.json()).resolves.toEqual({ output: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "retain this" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "[Kiln checkpoint]\ncheckpoint summary" }] },
    ] });
  });

  it("fails closed for a wrong capability, unsupported route, or missing model", async () => {
    const canonicalFetch = vi.fn(async () => new Response("canonical"));
    const nativeFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response());
    const routed = createCodexCompositeFetch({
      config: config(),
      env: { CODEX_GATEWAY_TOKEN: token },
      canonicalFetch,
      nativeFetch,
    });

    await expect(routed(new Request(`http://127.0.0.1:4910${CODEX_COMPOSITE_PATH_PREFIX}/${"a".repeat(64)}/v1/responses`, {
      method: "POST", body: JSON.stringify({ model: "gpt-5.6-sol" }), headers: { "content-type": "application/json" },
    }))).resolves.toMatchObject({ status: 401 });
    await expect(routed(new Request(compositeUrl("/unknown"), { method: "POST" }))).resolves.toMatchObject({ status: 404 });
    await expect(routed(new Request(compositeUrl(), {
      method: "POST", body: JSON.stringify({ input: [] }), headers: { "content-type": "application/json" },
    }))).resolves.toMatchObject({ status: 400 });
    expect(canonicalFetch).not.toHaveBeenCalled();
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it("returns typed client errors for malformed JSON and encoded bodies", async () => {
    const routed = createCodexCompositeFetch({
      config: config(), env: { CODEX_GATEWAY_TOKEN: token }, canonicalFetch: vi.fn(),
      nativeFetch: vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response()),
    });
    const invalidJson = await routed(new Request(compositeUrl(), {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    }));
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({ error: { type: "invalid_json" } });

    const unsupportedEncoding = await routed(new Request(compositeUrl(), {
      method: "POST", headers: { "content-encoding": "compress", "content-type": "application/json" }, body: "body",
    }));
    expect(unsupportedEncoding.status).toBe(415);
    await expect(unsupportedEncoding.json()).resolves.toEqual({ error: { type: "unsupported_content_encoding" } });

    const invalidEncoding = await routed(new Request(compositeUrl(), {
      method: "POST", headers: { "content-encoding": "gzip", "content-type": "application/json" }, body: "not-gzip",
    }));
    expect(invalidEncoding.status).toBe(400);
    await expect(invalidEncoding.json()).resolves.toEqual({ error: { type: "invalid_content_encoding" } });
  });

  it("rejects oversized composite bodies while streaming with actionable limit evidence", async () => {
    const base = config();
    const limited: ModelGatewayConfig = {
      ...base,
      surfaces: { openAIResponses: { ...base.surfaces.openAIResponses!, maxBodyBytes: 32 } },
    };
    const routed = createCodexCompositeFetch({
      config: limited, env: { CODEX_GATEWAY_TOKEN: token }, canonicalFetch: vi.fn(),
      nativeFetch: vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response()),
    });
    const chunks = [new TextEncoder().encode('{"model":"kiln/model-a","input":['), new Uint8Array(64)];
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { const chunk = chunks.shift(); chunk ? controller.enqueue(chunk) : controller.close(); },
      cancel() { cancelled = true; },
    });

    const response = await routed(new Request(compositeUrl(), {
      method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half",
    } as RequestInit & { duplex: "half" }));

    expect(response.status).toBe(413);
    expect(response.headers.get("x-kiln-request-body-limit-bytes")).toBe("32");
    await expect(response.json()).resolves.toEqual({ error: {
      type: "request_too_large",
      message: "The request body exceeds Kiln's configured 32-byte limit.",
      max_body_bytes: 32,
    } });
    expect(cancelled).toBe(true);
  });

  it("leaves non-composite listener routes under their existing owner", async () => {
    const canonicalFetch = vi.fn(async () => new Response("canonical"));
    const routed = createCodexCompositeFetch({
      config: config(), env: { CODEX_GATEWAY_TOKEN: token }, canonicalFetch,
      nativeFetch: vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response()),
    });
    expect(await (await routed(new Request("http://127.0.0.1:4910/.well-known/kiln/model-gateway/ready"))).text()).toBe("canonical");
  });
});
