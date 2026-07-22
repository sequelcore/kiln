import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelGatewayConfig } from "@kilnai/core";
import { closeGatewayResources, startModelGatewayListener, startGateway } from "../../src/gateway/gateway-server.js";

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
    const response = await bound!.fetch(new Request("http://127.0.0.1:4819/v1/responses", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    runtime.close();
    runtime.close();
    expect(stop).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith(true);
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
