import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelGatewayConfig } from "@kilnai/core";
import {
  ModelGatewaySupervisor,
  createModelGatewayConfigDigest,
  type ModelGatewayProcessAdapter,
  type ModelGatewayListenerInspection,
} from "../../src/index.js";

const config: ModelGatewayConfig = {
  port: 4819,
  accounts: [{ id: "primary", providerId: "codex-oauth", credentialId: "credential-a", maxConcurrency: 1, reservedAffinitySlots: 0 }],
  replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
  principals: [{ tokenEnv: "BEARER_TOKEN", ingress: "openai-responses", tenantId: "tenant", applicationId: "app", callerId: "caller", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget", virtualModelIds: ["codex"] }],
  virtualModels: [{ id: "codex", providerId: "codex-oauth", providerModelId: "gpt-test", accountIds: ["primary"], capabilities: ["text"], affinity: { continuity: "none" } }],
};

describe("ModelGatewaySupervisor", () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; vi.restoreAllMocks(); });

  it("starts one detached child and persists a secret-free versioned launch descriptor", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-supervisor-"));
    const inspect = vi.fn<() => Promise<ModelGatewayListenerInspection>>()
      .mockResolvedValueOnce({ state: "stopped" })
      .mockResolvedValue({ state: "ready", identity: identity("instance-a", 222) });
    const processAdapter = adapter({ spawnPid: 222 });
    const supervisor = createSupervisor(root, inspect, processAdapter, () => "instance-a");

    await expect(supervisor.start()).resolves.toMatchObject({ state: "ready", identity: { instanceId: "instance-a", pid: 222 } });
    expect(processAdapter.spawn).toHaveBeenCalledWith(expect.objectContaining({
      command: "bun",
      args: ["cli.js", "model-gateway", "serve", "--global-runtime", "--instance-id", "instance-a"],
      detached: true,
      windowsHide: true,
    }), expect.any(Object));
    const state = await supervisor.readState();
    expect(state).toMatchObject({ schemaVersion: 1, instanceId: "instance-a", pid: 222, launch: { version: "3.0.0-test", requiredEnvNames: ["BEARER_TOKEN", "REPLAY_SECRET"] } });
    expect(JSON.stringify(state)).not.toContain("secret-value");
  });

  it("does not spawn or terminate a foreign listener", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-supervisor-foreign-"));
    const processAdapter = adapter({ spawnPid: 222 });
    const supervisor = createSupervisor(root, vi.fn(async () => ({ state: "foreign", reason: "identity-mismatch" })), processAdapter);
    await expect(supervisor.ensure()).resolves.toEqual({ state: "foreign", reason: "identity-mismatch" });
    await expect(supervisor.stop()).resolves.toEqual({ state: "foreign", reason: "identity-mismatch" });
    expect(processAdapter.spawn).not.toHaveBeenCalled();
    expect(processAdapter.terminate).not.toHaveBeenCalled();
  });

  it("only stops an owned ready instance and removes its state", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-supervisor-stop-"));
    const processAdapter = adapter({ spawnPid: 222 });
    const inspect = vi.fn<() => Promise<ModelGatewayListenerInspection>>()
      .mockResolvedValueOnce({ state: "stopped" })
      .mockResolvedValueOnce({ state: "ready", identity: identity("instance-a", 222) })
      .mockResolvedValueOnce({ state: "ready", identity: identity("instance-a", 222) })
      .mockResolvedValue({ state: "stopped" });
    const supervisor = createSupervisor(root, inspect, processAdapter, () => "instance-a");
    await supervisor.start();
    await expect(supervisor.stop()).resolves.toEqual({ state: "stopped" });
    expect(processAdapter.terminate).toHaveBeenCalledWith(222);
    expect(await supervisor.readState()).toBeNull();
  });

  it("does not terminate or duplicate a stale state whose recorded pid is still alive", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-supervisor-stale-"));
    const processAdapter = adapter({ spawnPid: 222 });
    const inspect = vi.fn<() => Promise<ModelGatewayListenerInspection>>()
      .mockResolvedValueOnce({ state: "stopped" })
      .mockResolvedValueOnce({ state: "ready", identity: identity("instance-a", 222) })
      .mockResolvedValue({ state: "stopped" });
    const supervisor = createSupervisor(root, inspect, processAdapter, () => "instance-a");
    await supervisor.start();
    vi.mocked(processAdapter.isAlive).mockReturnValue(true);
    await expect(supervisor.stop()).resolves.toEqual({ state: "foreign", reason: "stale-owner-alive" });
    await expect(supervisor.ensure()).resolves.toEqual({ state: "foreign", reason: "stale-owner-alive" });
    expect(processAdapter.terminate).not.toHaveBeenCalled();
    expect(processAdapter.spawn).toHaveBeenCalledOnce();
  });

  function identity(instanceId: string, pid: number) {
    return { service: "kiln-model-gateway" as const, status: "ready" as const, protocolVersion: 1 as const, instanceId, pid, version: "3.0.0-test", configDigest: createModelGatewayConfigDigest(config), port: 4819 };
  }
});

function createSupervisor(root: string, inspect: () => Promise<ModelGatewayListenerInspection>, processAdapter: ModelGatewayProcessAdapter, createInstanceId = () => "instance-test") {
  return new ModelGatewaySupervisor({
    config,
    runtimeDir: root,
    version: "3.0.0-test",
    env: { REPLAY_SECRET: "secret-value".repeat(3), BEARER_TOKEN: "secret-value".repeat(3) },
    launch: { schemaVersion: 1, command: "bun", args: ["cli.js", "model-gateway", "serve", "--global-runtime"], mode: "local-dev", version: "3.0.0-test", requiredEnvNames: ["BEARER_TOKEN", "REPLAY_SECRET"] },
    inspect,
    processAdapter,
    createInstanceId,
    wait: async () => undefined,
  });
}

function adapter(input: { spawnPid: number }): ModelGatewayProcessAdapter {
  return {
    spawn: vi.fn(async () => ({ pid: input.spawnPid })),
    terminate: vi.fn(async () => undefined),
    isAlive: vi.fn(() => false),
  };
}
