import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineExecutionCatalog } from "@kilnai/core/agents";
import type { ModelGatewayConfig } from "@kilnai/core/engine";
import { closeGatewayResources, startGateway } from "../../src/gateway/gateway-server.js";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import { createModelGatewayExecutionRoutingPort } from "../../src/model-gateway/model-gateway-ingress.js";
import {
  MODEL_GATEWAY_HEALTH_PATH,
  MODEL_GATEWAY_SHUTDOWN_PATH,
  createModelGatewayConfigDigest,
  inspectModelGatewayListener,
  requestModelGatewayShutdown,
  startModelGatewayListener,
} from "../../src/model-gateway/model-gateway-listener.js";
import { LocalModelGatewayStore } from "../../src/model-gateway/local-model-gateway-store.js";
import { defineEffectiveAuthorityAdmissionBundle, type EffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";

const config: ModelGatewayConfig = {
  port: 4819,
  replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
  principals: [{ tokenEnv: "BEARER_TOKEN", ingress: "openai-responses", tenantId: "tenant", applicationId: "app", callerId: "caller", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget", virtualModelIds: ["codex"] }],
  virtualModels: [{ id: "codex", displayName: "Codex", contextTokens: 1000, outputTokens: 100, targetId: "codex-route", capabilities: ["text"], affinity: { continuity: "none" } }],
};

const executionCatalog = defineExecutionCatalog({
  accounts: [{
    id: "primary",
    providerId: "codex-oauth",
    credentialId: "credential-a",
    maxConcurrency: 1,
    reservedAffinitySlots: 0,
    economics: {
      capacityIdentity: "codex-primary",
      subscriptionClass: "subscription",
      quotaClassId: "codex-quota",
      creditPosture: "committed",
      overagePosture: "disabled",
    },
  }],
  accountPolicies: [{ id: "codex-policy", accountIds: ["primary"], strategy: "economic-least-pressure" }],
  routes: [{
    id: "codex-route",
    label: "Codex route",
    providerId: "codex-oauth",
    providerModelId: "gpt-test",
    dataClassification: "internal",
    dataPolicyEvidence: { providerId: "codex-oauth", providerModelId: "gpt-test", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" },
    accountSelection: { mode: "automatic", accountPolicyId: "codex-policy" },
    economics: {
      adapterCapabilityId: "text",
      adapterCapabilityVersion: "1",
      authBillingChannel: "oauth",
      executionMode: "direct",
      serviceTier: "default",
      rateCardBasis: "subscription",
      envelopeSemantics: "turn",
      fallbackPosture: "disabled",
      overagePosture: "disabled",
      contextClass: "default",
      cacheClass: "none",
      priceEvidence: {
        kind: "subscription",
        rateCardId: "codex",
        rateCardRevision: "1",
        evidence: {
          sourceIdentity: "test",
          sourceRevision: "1",
          sourceDigest: `sha256:${"a".repeat(64)}`,
          observedAt: "2026-08-01T00:00:00.000Z",
          validUntil: "2026-09-01T00:00:00.000Z",
          confidence: "high",
          authority: "configured",
        },
      },
      auxiliaryCharges: [],
      executionEnvelope: { limits: [{ atoms: "1", scale: 0, unit: "request", scheme: { kind: "unit" } }] },
    },
  }],
});

const noCandidates = { resolve: async () => [] };
const noDispatcher = { resolve: async () => { throw new Error("No dispatcher is available in this fixture."); } };
const testLifetimeControl = { timeout: () => undefined };
let authority: SqliteManagedAccountLeaseAuthority | undefined;

function listenerAuthorityBundle(): EffectiveAuthorityAdmissionBundle {
  const revision = { revisionSetId: "model-listener-fixture", revisions: { modelGateway: ("sha256:" + "a".repeat(64)) as `sha256:${string}` } } as const;
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "model-listener-session", turnId: "model-listener-turn", admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "model-listener", revision: ("sha256:" + "b".repeat(64)) as `sha256:${string}`, skillIds: [] },
      authorityCeiling: { maximumAuthority: "read_only", reason: "fixture" },
    },
    turn: {
      authority: { executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "read_only", sourcePolicy: "runtime_surface_projection", reason: "fixture", completeness: "authoritative", toolCount: 0, deniedToolCount: 0 },
      workGovernance: { status: "not-required" }, operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [], deniedToolNames: [], callerOwnedToolContract: { names: [], digest: ("sha256:" + "c".repeat(64)) as `sha256:${string}` } },
      effectCeiling: { operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" },
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        route: { routeId: "codex-route", providerId: "codex-oauth", providerModelId: "gpt-test", accountSelection: { mode: "exact", accountId: "primary", source: "route" } },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: { status: "bound", routeId: "codex-route", accountId: "primary", credentialId: "credential-a", credentialRevision: "a".repeat(64) },
      },
    },
  });
}

function executionOptions() {
  authority = new SqliteManagedAccountLeaseAuthority({
    path: ":memory:",
    participantKind: "model-gateway-ingress",
    recoveryDomain: `model-listener-${randomUUID()}`,
    configurationRevision: "test",
  });
  return {
    executionCatalog,
    executionRouting: createModelGatewayExecutionRoutingPort(executionCatalog),
    executionCandidates: noCandidates,
    executionDispatcher: noDispatcher,
    accountCapacityAuthority: authority,
    budgetAdmission: {
      admit: async () => ({ status: "admitted" as const, reason: "observed-below-limit" as const, observation: { observedTokens: 1, source: "fixture" } }),
    },
    authorityAdmission: { compose: async () => listenerAuthorityBundle() },
  };
}

describe("startModelGatewayListener", () => {
  let root: string | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    authority?.close();
    authority = undefined;
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("binds only to loopback and closes the listener idempotently", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-listener-"));
    const stop = vi.fn();
    let bound: Parameters<NonNullable<Parameters<typeof startModelGatewayListener>[0]["listen"]>>[0] | undefined;
    const runtime = await startModelGatewayListener({
      ...executionOptions(),
      config,
      databasePath: join(root, "state", "gateway.sqlite"),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      listen: (input) => { bound = input; return { stop }; },
    });

    expect(bound).toMatchObject({ hostname: "127.0.0.1", port: 4819 });
    const health = await bound!.fetch(new Request(`http://127.0.0.1:4819${MODEL_GATEWAY_HEALTH_PATH}`, { headers: { authorization: `Bearer ${"b".repeat(32)}` } }), testLifetimeControl);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ service: "kiln-model-gateway", status: "ready", instanceId: expect.any(String), port: 4819 });
    const unmanagedShutdown = await bound!.fetch(new Request(`http://127.0.0.1:4819${MODEL_GATEWAY_SHUTDOWN_PATH}`, { method: "POST", headers: { authorization: `Bearer ${"b".repeat(32)}` } }), testLifetimeControl);
    expect(unmanagedShutdown.status).toBe(404);
    const response = await bound!.fetch(new Request("http://127.0.0.1:4819/v1/responses", { method: "POST", body: "{}" }), testLifetimeControl);
    expect(response.status).toBe(401);
    await Promise.all([runtime.close(), runtime.close()]);
    expect(stop).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith();
  });

  it("keeps the Bun idle timeout through authentication and body receipt, then owns admitted dispatch lifetime", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-listener-lifetime-"));
    let bound: Parameters<NonNullable<Parameters<typeof startModelGatewayListener>[0]["listen"]>>[0] | undefined;
    const runtime = await startModelGatewayListener({
      ...executionOptions(),
      config,
      databasePath: join(root, "state.sqlite"),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      listen: (input) => { bound = input; return { stop: () => undefined }; },
    });

    try {
      const timeout = vi.fn();
      const unauthenticated = await bound!.fetch(new Request("http://127.0.0.1:4819/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }), { timeout });
      expect(unauthenticated.status).toBe(401);
      expect(timeout).not.toHaveBeenCalled();

      const oversized = await bound!.fetch(new Request("http://127.0.0.1:4819/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${"b".repeat(32)}`,
          "content-type": "application/json",
          "content-length": "2048",
        },
        body: "{}",
      }), { timeout });
      expect(oversized.status).toBe(413);
      expect(oversized.headers.get("x-kiln-request-body-limit-bytes")).toBe("1024");
      expect(await oversized.json()).toMatchObject({ error: { code: "request_too_large", max_body_bytes: 1024 } });
      expect(timeout).not.toHaveBeenCalled();

      let sendBody!: () => void;
      const bodyReady = new Promise<void>((resolve) => { sendBody = resolve; });
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          await bodyReady;
          controller.enqueue(new TextEncoder().encode("{}"));
          controller.close();
        },
      });
      const request = new Request("http://127.0.0.1:4819/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${"b".repeat(32)}`, "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit);
      const pending = bound!.fetch(request, { timeout });
      await Promise.resolve();
      expect(timeout).not.toHaveBeenCalled();
      sendBody();
      const response = await pending;

      expect(response.status).toBe(400);
      expect(timeout).toHaveBeenCalledOnce();
      expect(timeout).toHaveBeenCalledWith(request, 0);
    } finally {
      await runtime.close();
    }
  });

  it("awaits listener shutdown before closing durable state and shares idempotent completion", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-listener-settle-"));
    let releaseStop!: () => void;
    const stop = vi.fn(() => new Promise<void>((resolve) => { releaseStop = resolve; }));
    const closeStore = vi.spyOn(LocalModelGatewayStore.prototype, "close");
    const runtime = await startModelGatewayListener({
      ...executionOptions(),
      config,
      databasePath: join(root, "state.sqlite"),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      listen: () => ({ stop }),
    });

    const firstClose = runtime.close();
    const secondClose = runtime.close();
    expect(firstClose).toBe(secondClose);
    expect(stop).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith();
    expect(closeStore).not.toHaveBeenCalled();

    releaseStop();
    await firstClose;
    expect(closeStore).toHaveBeenCalledOnce();
  });

  it("serves authenticated readiness identity without exposing secrets", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-listener-health-"));
    let bound: Parameters<NonNullable<Parameters<typeof startModelGatewayListener>[0]["listen"]>>[0] | undefined;
    const env = { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) };
    const stop = vi.fn();
    const runtime = await startModelGatewayListener({
      ...executionOptions(),
      config,
      databasePath: join(root, "state.sqlite"),
      env,
      identity: { instanceId: "instance-test", version: "3.0.0-test", configDigest: createModelGatewayConfigDigest(config), pid: 4321 },
      listen: (input) => { bound = input; return { stop }; },
    });
    try {
      const unauthenticated = await bound!.fetch(new Request(`http://127.0.0.1:4819${MODEL_GATEWAY_HEALTH_PATH}`), testLifetimeControl);
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers.get("x-kiln-service")).toBe("model-gateway");

      const response = await bound!.fetch(new Request(`http://127.0.0.1:4819${MODEL_GATEWAY_HEALTH_PATH}`, {
        headers: { authorization: `Bearer ${env.BEARER_TOKEN}` },
      }), testLifetimeControl);
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

      const unauthenticatedShutdown = await bound!.fetch(new Request(`http://127.0.0.1:4819${MODEL_GATEWAY_SHUTDOWN_PATH}`, { method: "POST" }), testLifetimeControl);
      expect(unauthenticatedShutdown.status).toBe(401);
      const mismatchedShutdown = await bound!.fetch(new Request(`http://127.0.0.1:4819${MODEL_GATEWAY_SHUTDOWN_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.BEARER_TOKEN}`, "x-kiln-instance-id": "other-instance" },
      }), testLifetimeControl);
      expect(mismatchedShutdown.status).toBe(409);
      const acceptedShutdown = await bound!.fetch(new Request(`http://127.0.0.1:4819${MODEL_GATEWAY_SHUTDOWN_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.BEARER_TOKEN}`, "x-kiln-instance-id": "instance-test" },
      }), testLifetimeControl);
      expect(acceptedShutdown.status).toBe(202);
      await runtime.shutdownRequested;
      expect(stop).not.toHaveBeenCalled();
    } finally { await runtime.close(); }
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
    await expect(inspectModelGatewayListener({ config, token: "t".repeat(32), expected: { port: 4819, configDigest: "f".repeat(64) }, fetch: async () => mismatchedResponse.clone() })).resolves.toMatchObject({ state: "ready", identity: { instanceId: "instance-b" } });
    await expect(inspectModelGatewayListener({ config, token: "t".repeat(32), fetch: async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); } })).resolves.toEqual({ state: "stopped" });
    // Bun reports a refused connection as a top-level `ConnectionRefused`, so
    // recognising only the Node spelling reports a stopped gateway as foreign
    // and blocks start.
    await expect(inspectModelGatewayListener({ config, token: "t".repeat(32), fetch: async () => { throw Object.assign(new Error("Unable to connect. Is the computer able to access the url?"), { code: "ConnectionRefused" }); } })).resolves.toEqual({ state: "stopped" });
    await expect(inspectModelGatewayListener({ config, token: "t".repeat(32), fetch: async () => { throw new TypeError("invalid HTTP listener"); } })).resolves.toMatchObject({ state: "foreign", reason: "unexpected-response" });
    await expect(inspectModelGatewayListener({ config, token: "t".repeat(32), fetch: async () => new Response("not kiln") })).resolves.toMatchObject({ state: "foreign" });
  });

  it("requests shutdown only from the exact authenticated listener", async () => {
    const identity = { service: "kiln-model-gateway" as const, status: "ready" as const, protocolVersion: 1 as const, instanceId: "instance-a", pid: 7, version: "3.0.0-test", configDigest: createModelGatewayConfigDigest(config), port: 4819 };
    await expect(requestModelGatewayShutdown({
      config,
      token: "t".repeat(32),
      identity,
      fetch: async (_url, init) => {
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("x-kiln-instance-id")).toBe("instance-a");
        return new Response(null, { status: 202, headers: { "x-kiln-service": "model-gateway" } });
      },
    })).resolves.toEqual({ state: "accepted" });
    await expect(requestModelGatewayShutdown({ config, token: "t".repeat(32), identity, fetch: async () => new Response(null, { status: 409, headers: { "x-kiln-service": "model-gateway" } }) })).resolves.toEqual({ state: "foreign", reason: "identity-mismatch" });
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
    const runtime = await startModelGatewayListener({ ...executionOptions(), config: multi, databasePath: join(root, "state.sqlite"), env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32), ANTHROPIC_TOKEN: "a".repeat(32) }, listen: (input) => { bound = input; return { stop: () => undefined }; } });
    try {
      expect((await bound!.fetch(new Request("http://127.0.0.1:4819/v1/responses", { method: "POST", body: "{}" }), testLifetimeControl)).status).toBe(401);
      const models = await bound!.fetch(new Request("http://127.0.0.1:4819/v1/models?limit=1000", { headers: { "x-api-key": "a".repeat(32) } }), testLifetimeControl);
      expect(models.status).toBe(200);
      expect(await models.json()).toEqual({ data: [{ id: "claude-kiln", display_name: "Claude Kiln" }] });
    } finally { await runtime.close(); }
  });

  it("closes durable state even when listener shutdown throws", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-listener-close-"));
    const databasePath = join(root, "state", "gateway.sqlite");
    const options = { ...executionOptions(), config, databasePath, env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) } };
    const first = await startModelGatewayListener({ ...options, listen: () => ({ stop: () => { throw new Error("listener stop failed"); } }) });
    await expect(first.close()).rejects.toThrow("listener stop failed");
    const replacementStop = vi.fn();
    const replacement = await startModelGatewayListener({ ...options, listen: () => ({ stop: replacementStop }) });
    await replacement.close();
  });

  it("rejects an effective main-port override that collides with the model listener", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-port-collision-"));
    const path = join(root, "gateway.yaml");
    await writeFile(path, `port: 4800
apps: []
modelGateway:
  port: 4819
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_SECRET }
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } }
  principals:
      - { tokenEnv: BEARER_TOKEN, ingress: openai-responses, tenantId: tenant, applicationId: app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [codex] }
  virtualModels:
      - { id: codex, displayName: Codex, contextTokens: 1000, outputTokens: 100, targetId: codex-route, capabilities: [text], affinity: { continuity: none } }
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
