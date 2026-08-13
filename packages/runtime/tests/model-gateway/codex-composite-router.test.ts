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
    executionRouteId: "route",
    capabilities: ["text"],
    affinity: { continuity: "none" },
  }],
};

function compositeUrl(path: string): string {
  return `http://127.0.0.1:4819${CODEX_COMPOSITE_PATH_PREFIX}/${createCodexCompositeCapability(token)}${path}`;
}

describe("createCodexCompositeFetch cancellation", () => {
  it("applies composite concurrency before buffering an authenticated request body", async () => {
    const route = createCodexCompositeFetch({
      config,
      env: { CODEX_TOKEN: token },
      canonicalFetch: async () => new Response("unexpected", { status: 500 }),
      nativeFetch: async () => new Response("ok"),
    });
    let sendBody!: () => void;
    const bodyReady = new Promise<void>((resolve) => { sendBody = resolve; });
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        await bodyReady;
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ model: "gpt-native", input: [] })));
        controller.close();
      },
    });
    const first = route(new Request(compositeUrl("/v1/responses"), {
      method: "POST",
      headers: { authorization: "Bearer native-session", "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit));
    await Promise.resolve();

    const second = await route(new Request(compositeUrl("/v1/responses"), {
      method: "POST",
      headers: { authorization: "Bearer native-session", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-native", input: [] }),
    }));

    expect(second.status).toBe(429);
    sendBody();
    expect((await first).status).toBe(200);
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
});
