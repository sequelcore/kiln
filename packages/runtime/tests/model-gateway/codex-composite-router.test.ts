import { describe, expect, it, vi } from "vitest";
import type { ModelGatewayConfig } from "@kilnai/core";
import {
  CODEX_COMPOSITE_PATH_PREFIX,
  createCodexCompositeCapability,
  createCodexCompositeFetch,
} from "../../src/model-gateway/codex-composite-router.js";

const token = "synthetic-codex-principal-token-32-bytes";
const config: ModelGatewayConfig = {
  port: 4819,
  replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
  surfaces: { openAIResponses: { maxBodyBytes: 4096, maxConcurrentRequests: 1 } },
  codexComposite: { maxQueuedRequests: 2, queueTimeoutMs: 1_000 },
  principals: [{
    tokenEnv: "CODEX_TOKEN",
    ingress: "openai-responses",
    nativeHarness: "codex",
    tenantId: "tenant",
    applicationId: "app",
    callerId: "caller",
    capabilityId: "invoke",
    scopes: ["model.invoke"],
    budgetEvidenceId: "budget",
    virtualModelIds: ["virtual"],
  }],
  virtualModels: [{
    id: "virtual",
    displayName: "Virtual",
    contextTokens: 1000,
    outputTokens: 100,
    targetId: "route",
    capabilities: ["text"],
    affinity: { continuity: "none" },
  }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function withComposite(overrides: Partial<NonNullable<ModelGatewayConfig["codexComposite"]>>): ModelGatewayConfig {
  return { ...config, codexComposite: { ...config.codexComposite!, ...overrides } };
}

function compositeUrl(path: string): string {
  return `http://127.0.0.1:4819${CODEX_COMPOSITE_PATH_PREFIX}/${createCodexCompositeCapability(token)}${path}`;
}

describe("createCodexCompositeFetch cancellation", () => {
  it("does not read a queued request body before capacity admission", async () => {
    const held = deferred<Response>();
    let calls = 0;
    const route = createCodexCompositeFetch({
      config,
      env: { CODEX_TOKEN: token },
      canonicalFetch: async () => new Response("unexpected", { status: 500 }),
      nativeFetch: async () => ++calls === 1 ? held.promise : new Response("queued"),
    });
    const first = route(nativeRequest("/v1/responses"));
    await Promise.resolve();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ model: "gpt-native", input: [] })));
        controller.close();
      },
    });
    const queuedRequest = new Request(compositeUrl("/v1/responses"), {
      method: "POST",
      headers: { authorization: "Bearer native-session", "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    const queued = route(queuedRequest);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queuedRequest.bodyUsed).toBe(false);
    held.resolve(new Response("ok"));
    const firstResponse = await first;
    expect(firstResponse.status).toBe(200);
    await firstResponse.text();
    const queuedResponse = await queued;
    expect(queuedResponse.status).toBe(200);
    await queuedResponse.text();
  });

  it("bounds an unauthenticated request at ingress and rejects it before dispatch after admission", async () => {
    const held = deferred<Response>();
    const nativeFetch = vi.fn(async () => held.promise);
    const route = createCodexCompositeFetch({
      config, env: { CODEX_TOKEN: token }, canonicalFetch: async () => new Response("unexpected", { status: 500 }), nativeFetch,
    });
    const first = route(nativeRequest("/v1/responses"));
    await vi.waitFor(() => expect(nativeFetch).toHaveBeenCalledOnce());
    const unauthenticated = route(new Request(compositeUrl("/v1/responses"), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-native", input: [] }),
    }));
    held.resolve(new Response("done"));
    await (await first).text();
    expect((await unauthenticated).status).toBe(401);
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it("propagates downstream cancellation to native Codex", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const nativeFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      upstreamSignal = init?.signal ?? undefined;
      return new Response("ok");
    });
    const route = createCodexCompositeFetch({
      config,
      env: { CODEX_TOKEN: token },
      canonicalFetch: async () => new Response("unexpected", { status: 500 }),
      nativeFetch,
    });
    const controller = new AbortController();

    await route(new Request(compositeUrl("/v1/responses/compact"), {
      method: "POST",
      headers: { authorization: "Bearer native-session", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-native", input: [] }),
      signal: controller.signal,
    }));
    controller.abort();

    expect(nativeFetch).toHaveBeenCalledOnce();
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("propagates downstream cancellation to governed virtual-model compaction", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const canonicalFetch = vi.fn(async (request: Request) => {
      upstreamSignal = request.signal;
      return new Response("data: {\"type\":\"response.output_text.delta\",\"delta\":\"summary\"}\n\n", {
        headers: { "content-type": "text/event-stream" },
      });
    });
    const route = createCodexCompositeFetch({
      config,
      env: { CODEX_TOKEN: token },
      canonicalFetch,
      nativeFetch: async () => new Response("unexpected", { status: 500 }),
    });
    const controller = new AbortController();

    const response = await route(new Request(compositeUrl("/v1/responses/compact"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "virtual", input: [] }),
      signal: controller.signal,
    }));
    controller.abort();

    expect(response.status).toBe(200);
    expect(canonicalFetch).toHaveBeenCalledOnce();
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("cancels an in-flight governed virtual response when the downstream disconnects", async () => {
    let upstreamSignal: AbortSignal | undefined;
    let observeUpstream!: () => void;
    const upstreamObserved = new Promise<void>((resolve) => { observeUpstream = resolve; });
    const canonicalFetch = vi.fn((_request: Request) => {
      upstreamSignal = _request.signal;
      observeUpstream();
      return new Promise<Response>((_resolve, reject) => {
        _request.signal.addEventListener("abort", () => reject(_request.signal.reason), { once: true });
      });
    });
    const route = createCodexCompositeFetch({
      config,
      env: { CODEX_TOKEN: token },
      canonicalFetch,
      nativeFetch: async () => new Response("unexpected", { status: 500 }),
    });
    const controller = new AbortController();
    const pending = route(new Request(compositeUrl("/v1/responses"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "virtual", input: [] }),
      signal: controller.signal,
    }));

    await upstreamObserved;
    controller.abort(new Error("downstream disconnected"));

    await expect(pending).rejects.toThrow("downstream disconnected");
    expect(canonicalFetch).toHaveBeenCalledOnce();
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("admits a queued successor after the holder completes", async () => {
    const firstDispatch = deferred<Response>();
    let calls = 0;
    const route = createCodexCompositeFetch({
      config, env: { CODEX_TOKEN: token }, canonicalFetch: async () => new Response("unexpected", { status: 500 }),
      nativeFetch: async () => ++calls === 1 ? firstDispatch.promise : new Response("second"),
    });
    const first = route(nativeRequest("/v1/responses"));
    await vi.waitFor(() => expect(calls).toBe(1));
    const second = route(nativeRequest("/v1/responses"));
    await Promise.resolve();
    expect(calls).toBe(1);
    firstDispatch.resolve(new Response("first"));
    expect(await (await first).text()).toBe("first");
    expect(await (await second).text()).toBe("second");
  });

  it("admits multiple queued requests in FIFO order", async () => {
    const firstDispatch = deferred<Response>();
    const order: number[] = [];
    let calls = 0;
    const route = createCodexCompositeFetch({
      config, env: { CODEX_TOKEN: token }, canonicalFetch: async () => new Response("unexpected", { status: 500 }),
      nativeFetch: async () => {
        calls += 1;
        order.push(calls);
        return calls === 1 ? firstDispatch.promise : new Response(String(calls));
      },
    });
    const first = route(nativeRequest("/v1/responses"));
    await vi.waitFor(() => expect(calls).toBe(1));
    const second = route(nativeRequest("/v1/responses"));
    const third = route(nativeRequest("/v1/responses"));
    firstDispatch.resolve(new Response("1"));
    await (await first).text();
    await (await second).text();
    await (await third).text();
    expect(order).toEqual([1, 2, 3]);
  });

  it("isolates responses, compaction, and search into independent capacity classes", async () => {
    const held = deferred<Response>();
    const seen: string[] = [];
    const route = createCodexCompositeFetch({
      config, env: { CODEX_TOKEN: token }, canonicalFetch: async () => new Response("unexpected", { status: 500 }),
      nativeFetch: async (input) => {
        const path = new URL(String(input)).pathname;
        seen.push(path);
        return path.endsWith("/responses") ? held.promise : new Response(path);
      },
    });
    const response = route(nativeRequest("/v1/responses"));
    await vi.waitFor(() => expect(seen).toContain("/backend-api/codex/responses"));
    const [compact, search] = await Promise.all([
      route(nativeRequest("/v1/responses/compact")),
      route(nativeRequest("/v1/alpha/search")),
    ]);
    expect(compact.status).toBe(200);
    expect(search.status).toBe(200);
    held.resolve(new Response("response"));
    expect((await response).status).toBe(200);
  });

  it("removes an aborted queued waiter and reuses its queue position", async () => {
    const held = deferred<Response>();
    let calls = 0;
    const route = createCodexCompositeFetch({
      config: withComposite({ maxQueuedRequests: 1 }), env: { CODEX_TOKEN: token },
      canonicalFetch: async () => new Response("unexpected", { status: 500 }),
      nativeFetch: async () => ++calls === 1 ? held.promise : new Response("next"),
    });
    const first = route(nativeRequest("/v1/responses"));
    await vi.waitFor(() => expect(calls).toBe(1));
    const controller = new AbortController();
    const aborted = route(nativeRequest("/v1/responses", controller.signal));
    controller.abort(new Error("queued disconnect"));
    await expect(aborted).rejects.toThrow("queued disconnect");
    const successor = route(nativeRequest("/v1/responses"));
    held.resolve(new Response("first"));
    await (await first).text();
    const successorResponse = await successor;
    expect(successorResponse.status).toBe(200);
    await successorResponse.text();
  });

  it("releases a held slot after dispatch throws", async () => {
    let calls = 0;
    const route = createCodexCompositeFetch({
      config, env: { CODEX_TOKEN: token }, canonicalFetch: async () => new Response("unexpected", { status: 500 }),
      nativeFetch: async () => { if (++calls === 1) throw new Error("upstream failed"); return new Response("reused"); },
    });
    await expect(route(nativeRequest("/v1/responses"))).rejects.toThrow("upstream failed");
    expect(await (await route(nativeRequest("/v1/responses"))).text()).toBe("reused");
  });

  it("releases a held slot after downstream cancellation", async () => {
    let calls = 0;
    const route = createCodexCompositeFetch({
      config, env: { CODEX_TOKEN: token }, canonicalFetch: async () => new Response("unexpected", { status: 500 }),
      nativeFetch: async (_input, init) => {
        calls += 1;
        if (calls > 1) return new Response("reused");
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      },
    });
    const controller = new AbortController();
    const held = route(nativeRequest("/v1/responses", controller.signal));
    await vi.waitFor(() => expect(calls).toBe(1));
    controller.abort(new Error("holding disconnect"));
    await expect(held).rejects.toThrow("holding disconnect");
    expect(await (await route(nativeRequest("/v1/responses"))).text()).toBe("reused");
  });

  it("returns stable ingress provenance for queue timeout and persists sanitized evidence", async () => {
    const held = deferred<Response>();
    const evidence: unknown[] = [];
    const route = createCodexCompositeFetch({
      config: withComposite({ queueTimeoutMs: 10 }), env: { CODEX_TOKEN: token },
      canonicalFetch: async () => new Response("unexpected", { status: 500 }), nativeFetch: async () => held.promise,
      ingressCapacityEvidence: { record: async (value) => { evidence.push(value); } },
    });
    const first = route(nativeRequest("/v1/responses"));
    const timedOut = await route(nativeRequest("/v1/responses"));
    expect(timedOut.status).toBe(503);
    expect(await timedOut.json()).toMatchObject({ error: {
      code: "ingress_queue_timeout", origin: "ingress", phase: "pre-dispatch", retryable: true,
    } });
    expect(evidence).toEqual([expect.objectContaining({
      outcome: "queue-timeout", requestClass: "responses", origin: "ingress", phase: "pre-dispatch",
    })]);
    held.resolve(new Response("done"));
    await first;
  });

  it("rejects only excess queued work with stable non-provider queue-full provenance", async () => {
    const held = deferred<Response>();
    const route = createCodexCompositeFetch({
      config: withComposite({ maxQueuedRequests: 1 }), env: { CODEX_TOKEN: token },
      canonicalFetch: async () => new Response("unexpected", { status: 500 }), nativeFetch: async () => held.promise,
    });
    const first = route(nativeRequest("/v1/responses"));
    const queued = route(nativeRequest("/v1/responses"));
    const full = await route(nativeRequest("/v1/responses"));
    expect(full.status).toBe(503);
    expect(await full.json()).toMatchObject({ error: { code: "ingress_queue_full", origin: "ingress", phase: "pre-dispatch" } });
    held.resolve(new Response("done"));
    await Promise.all([first, queued]);
  });

  it("preserves an upstream 429 without confusing it with local ingress pressure", async () => {
    const route = createCodexCompositeFetch({
      config, env: { CODEX_TOKEN: token }, canonicalFetch: async () => new Response("unexpected", { status: 500 }),
      nativeFetch: async () => Response.json({ error: { type: "upstream_rate_limit" } }, { status: 429, headers: { "x-request-id": "upstream-id" } }),
    });
    const response = await route(nativeRequest("/v1/responses"));
    expect(response.status).toBe(429);
    expect(response.headers.get("x-request-id")).toBe("upstream-id");
    expect(await response.json()).toEqual({ error: { type: "upstream_rate_limit" } });
  });

  it("keeps the stable local 503 response when capacity evidence persistence fails", async () => {
    const held = deferred<Response>();
    const route = createCodexCompositeFetch({
      config: withComposite({ maxQueuedRequests: 1 }), env: { CODEX_TOKEN: token },
      canonicalFetch: async () => new Response("unexpected", { status: 500 }), nativeFetch: async () => held.promise,
      ingressCapacityEvidence: { record: async () => { throw new Error("store unavailable"); } },
    });
    const first = route(nativeRequest("/v1/responses"));
    const queued = route(nativeRequest("/v1/responses"));
    const full = await route(nativeRequest("/v1/responses"));
    expect(full.status).toBe(503);
    expect(await full.json()).toMatchObject({ error: { code: "ingress_queue_full", origin: "ingress", phase: "pre-dispatch" } });
    held.resolve(new Response("done"));
    await Promise.all([first, queued]);
  });
});

function nativeRequest(path: string, signal?: AbortSignal): Request {
  return new Request(compositeUrl(path), {
    method: "POST",
    headers: { authorization: "Bearer native-session", "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-native", input: [] }),
    ...(signal ? { signal } : {}),
  });
}
