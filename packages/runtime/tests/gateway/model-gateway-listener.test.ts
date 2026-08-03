import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelGatewayConfig } from "@kilnai/core";
import { closeGatewayResources, startGateway } from "../../src/gateway/gateway-server.js";
import {
  MODEL_GATEWAY_HEALTH_PATH,
  createModelGatewayConfigDigest,
  inspectModelGatewayListener,
  startModelGatewayListener,
} from "../../src/model-gateway/model-gateway-listener.js";

const config: ModelGatewayConfig = {
  port: 4819,
  accounts: [{ id: "primary", providerId: "codex-oauth", credentialId: "credential-a", maxConcurrency: 1, reservedAffinitySlots: 0 }],
  replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
  principals: [{ tokenEnv: "BEARER_TOKEN", ingress: "openai-responses", tenantId: "tenant", applicationId: "app", callerId: "caller", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget", virtualModelIds: ["codex"] }],
  virtualModels: [{ id: "codex", displayName: "Codex", contextTokens: 1000, outputTokens: 100, providerId: "codex-oauth", providerModelId: "gpt-test", accountIds: ["primary"], capabilities: ["text"], affinity: { continuity: "none" } }],
};

describe("startModelGatewayListener", () => {
  let root: string | undefined;
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

  it("binds only to loopback and closes the listener idempotently", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-listener-"));
    const stop = vi.fn();
    let bound: Parameters<NonNullable<Parameters<typeof startModelGatewayListener>[0]["listen"]>>[0] | undefined;
    const runtime = await startModelGatewayListener({
      config,
      databasePath: join(root, "state", "gateway.sqlite"),
      credentialRootDir: join(root, "auth"),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      listen: (input) => { bound = input; return { stop }; },
    });

    expect(bound).toMatchObject({ hostname: "127.0.0.1", port: 4819 });
    const health = await bound!.fetch(new Request(`http://127.0.0.1:4819${MODEL_GATEWAY_HEALTH_PATH}`, { headers: { authorization: `Bearer ${"b".repeat(32)}` } }));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ service: "kiln-model-gateway", status: "ready", instanceId: expect.any(String), port: 4819 });
    const response = await bound!.fetch(new Request("http://127.0.0.1:4819/v1/responses", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    runtime.close();
    runtime.close();
    expect(stop).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith(true);
  });

  it("serves authenticated readiness identity without exposing secrets", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-listener-health-"));
    let bound: Parameters<NonNullable<Parameters<typeof startModelGatewayListener>[0]["listen"]>>[0] | undefined;
    const env = { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) };
    const runtime = await startModelGatewayListener({
      config,
      databasePath: join(root, "state.sqlite"),
      credentialRootDir: join(root, "auth"),
      env,
      identity: { instanceId: "instance-test", version: "3.0.0-test", configDigest: createModelGatewayConfigDigest(config), pid: 4321 },
      listen: (input) => { bound = input; return { stop: () => undefined }; },
    });
    try {
      const unauthenticated = await bound!.fetch(new Request(`http://127.0.0.1:4819${MODEL_GATEWAY_HEALTH_PATH}`));
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers.get("x-kiln-service")).toBe("model-gateway");

      const response = await bound!.fetch(new Request(`http://127.0.0.1:4819${MODEL_GATEWAY_HEALTH_PATH}`, {
        headers: { authorization: `Bearer ${env.BEARER_TOKEN}` },
      }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        service: "kiln-model-gateway",
        status: "ready",
        protocolVersion: 1,
        instanceId: "instance-test",
        pid: 4321,
        version: "3.0.0-test",
        configDigest: createModelGatewayConfigDigest(config),
        port: 4819,
      });
      expect(JSON.stringify(body).includes(env.BEARER_TOKEN)).toBe(false);
    } finally { runtime.close(); }
  });

  it("classifies matching, foreign, and stopped listeners", async () => {
    const digest = createModelGatewayConfigDigest(config);
    const readyResponse = new Response(JSON.stringify({ service: "kiln-model-gateway", status: "ready", protocolVersion: 1, instanceId: "instance-a", pid: 7, version: "3.0.0-test", configDigest: digest, port: 4819 }), {
      status: 200,
      headers: { "content-type": "application/json", "x-kiln-service": "model-gateway" },
    });
    await expect(inspectModelGatewayListener({ config, token: "t".repeat(32), fetch: async () => readyResponse.clone() })).resolves.toMatchObject({ state: "ready", identity: { pid: 7, configDigest: digest } });
    const mismatchedResponse = new Response(JSON.stringify({ service: "kiln-model-gateway", status: "ready", protocolVersion: 1, instanceId: "instance-b", pid: 7, version: "3.0.0-test", configDigest: "f".repeat(64), port: 4819 }), { status: 200, headers: { "content-type": "application/json", "x-kiln-service": "model-gateway" } });
    await expect(inspectModelGatewayListener({ config, token: "t".repeat(32), fetch: async () => mismatchedResponse.clone() })).resolves.toMatchObject({ state: "foreign", reason: "identity-mismatch" });
    await expect(inspectModelGatewayListener({ config, token: "t".repeat(32), fetch: async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); } })).resolves.toEqual({ state: "stopped" });
    // Bun reports a refused connection as a top-level `ConnectionRefused`, so
    // recognising only the Node spelling reports a stopped gateway as foreign
    // and blocks start.
    await expect(inspectModelGatewayListener({ config, token: "t".repeat(32), fetch: async () => { throw Object.assign(new Error("Unable to connect. Is the computer able to access the url?"), { code: "ConnectionRefused" }); } })).resolves.toEqual({ state: "stopped" });
    await expect(inspectModelGatewayListener({ config, token: "t".repeat(32), fetch: async () => { throw new TypeError("invalid HTTP listener"); } })).resolves.toMatchObject({ state: "foreign", reason: "unexpected-response" });
    await expect(inspectModelGatewayListener({ config, token: "t".repeat(32), fetch: async () => new Response("not kiln") })).resolves.toMatchObject({ state: "foreign" });
  });

  it("mounts configured Responses and Anthropic surfaces on the same listener", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-multi-surface-listener-"));
    let bound: Parameters<NonNullable<Parameters<typeof startModelGatewayListener>[0]["listen"]>>[0] | undefined;
    const multi: ModelGatewayConfig = {
      ...config,
      surfaces: { ...config.surfaces, anthropicMessages: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
      principals: [...config.principals, { ...config.principals[0]!, tokenEnv: "ANTHROPIC_TOKEN", ingress: "anthropic-messages", virtualModelIds: ["claude-kiln"] }],
      virtualModels: [...config.virtualModels, { ...config.virtualModels[0]!, id: "claude-kiln", displayName: "Claude Kiln" }],
    };
    const runtime = await startModelGatewayListener({ config: multi, databasePath: join(root, "state.sqlite"), credentialRootDir: join(root, "auth"), env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32), ANTHROPIC_TOKEN: "a".repeat(32) }, listen: (input) => { bound = input; return { stop: () => undefined }; } });
    try {
      expect((await bound!.fetch(new Request("http://127.0.0.1:4819/v1/responses", { method: "POST", body: "{}" }))).status).toBe(401);
      const models = await bound!.fetch(new Request("http://127.0.0.1:4819/v1/models?limit=1000", { headers: { "x-api-key": "a".repeat(32) } }));
      expect(models.status).toBe(200);
      expect(await models.json()).toEqual({ data: [{ id: "claude-kiln", display_name: "Claude Kiln" }] });
    } finally { runtime.close(); }
  });

  it("closes durable state even when listener shutdown throws", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-listener-close-"));
    const databasePath = join(root, "state", "gateway.sqlite");
    const options = { config, databasePath, credentialRootDir: join(root, "auth"), env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) } };
    const first = await startModelGatewayListener({ ...options, listen: () => ({ stop: () => { throw new Error("listener stop failed"); } }) });
    expect(() => first.close()).toThrow("listener stop failed");
    const replacementStop = vi.fn();
    const replacement = await startModelGatewayListener({ ...options, listen: () => ({ stop: replacementStop }) });
    replacement.close();
  });

  it("rejects an effective main-port override that collides with the model listener", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-port-collision-"));
    const path = join(root, "gateway.yaml");
    await writeFile(path, `port: 4800
apps: []
modelGateway:
  port: 4819
  accounts: [{ id: account, providerId: codex-oauth, credentialId: credential, maxConcurrency: 1, reservedAffinitySlots: 0 }]
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_SECRET }
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } }
  principals:
      - { tokenEnv: BEARER_TOKEN, ingress: openai-responses, tenantId: tenant, applicationId: app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [codex] }
  virtualModels:
      - { id: codex, displayName: Codex, contextTokens: 1000, outputTokens: 100, providerId: codex-oauth, providerModelId: model, accountIds: [account], capabilities: [text], affinity: { continuity: none } }
`, "utf8");
    await expect(startGateway(path, { port: 4819 })).rejects.toThrow("must differ");
  });

  it("awaits and continues closing independent startup resources after one closer throws", async () => {
    const closed: string[] = [];
    await closeGatewayResources([
      () => { closed.push("trigger"); throw new Error("stop failed"); },
      async () => { await Promise.resolve(); closed.push("watcher"); },
      () => { closed.push("model-store"); },
    ]);
    expect(closed).toEqual(["trigger", "watcher", "model-store"]);
  });

});
