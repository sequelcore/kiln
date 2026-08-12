import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("restarts an owned prior configuration revision during ensure", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-supervisor-revision-"));
    const priorIdentity = { ...identity("instance-old", 111), configDigest: "f".repeat(64) };
    const processAdapter = adapter({ spawnPid: 222 });
    const inspect = vi.fn()
      .mockResolvedValueOnce({ state: "ready", identity: priorIdentity })
      .mockResolvedValueOnce({ state: "ready", identity: priorIdentity })
      .mockResolvedValueOnce({ state: "stopped" })
      .mockResolvedValueOnce({ state: "stopped" })
      .mockResolvedValue({ state: "ready", identity: identity("instance-a", 222) });
    const supervisor = createSupervisor(root, inspect, processAdapter, () => "instance-a");
    await writeFile(join(root, "state.json"), `${JSON.stringify({
      schemaVersion: 1,
      instanceId: "instance-old",
      pid: 111,
      port: 4819,
      version: "3.0.0-test",
      configDigest: "f".repeat(64),
      startedAt: "2026-08-12T00:00:00.000Z",
      launch: { schemaVersion: 1, command: "bun", args: ["cli.js", "model-gateway", "serve", "--global-runtime"], mode: "local-dev", version: "3.0.0-test", requiredEnvNames: ["BEARER_TOKEN", "REPLAY_SECRET"] },
    }, null, 2)}\n`, "utf8");

    await expect(supervisor.ensure()).resolves.toMatchObject({ state: "ready", identity: { instanceId: "instance-a", pid: 222 } });
    expect(inspect).toHaveBeenCalledWith({ port: 4819, configDigest: "f".repeat(64) });
    expect(processAdapter.spawn).toHaveBeenCalledOnce();
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
    expect(processAdapter.terminate).not.toHaveBeenCalled();
    expect(await supervisor.readState()).toBeNull();
  });

  it("waits for the owned process to exit after its listener stops", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-supervisor-process-exit-"));
    let alive = true;
    const processAdapter = adapter({ spawnPid: 222 });
    vi.mocked(processAdapter.isAlive).mockImplementation(() => alive);
    const inspect = vi.fn<() => Promise<ModelGatewayListenerInspection>>()
      .mockResolvedValueOnce({ state: "stopped" })
      .mockResolvedValueOnce({ state: "ready", identity: identity("instance-a", 222) })
      .mockResolvedValueOnce({ state: "ready", identity: identity("instance-a", 222) })
      .mockResolvedValue({ state: "stopped" });
    const wait = vi.fn(async () => { alive = false; });
    const supervisor = createSupervisor(root, inspect, processAdapter, () => "instance-a", wait);

    await supervisor.start();
    await expect(supervisor.stop()).resolves.toEqual({ state: "stopped" });

    expect(wait).toHaveBeenCalledOnce();
    expect(processAdapter.isAlive).toHaveBeenCalledTimes(2);
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

function createSupervisor(
  root: string,
  inspect: () => Promise<ModelGatewayListenerInspection>,
  processAdapter: ModelGatewayProcessAdapter,
  createInstanceId = () => "instance-test",
  wait: (ms: number) => Promise<void> = async () => undefined,
) {
  return new ModelGatewaySupervisor({
    config,
    runtimeDir: root,
    version: "3.0.0-test",
    env: { REPLAY_SECRET: "secret-value".repeat(3), BEARER_TOKEN: "secret-value".repeat(3) },
    launch: { schemaVersion: 1, command: "bun", args: ["cli.js", "model-gateway", "serve", "--global-runtime"], mode: "local-dev", version: "3.0.0-test", requiredEnvNames: ["BEARER_TOKEN", "REPLAY_SECRET"] },
    inspect,
    requestShutdown: async () => ({ state: "accepted" }),
    processAdapter,
    createInstanceId,
    wait,
  });
}

function adapter(input: { spawnPid: number }): ModelGatewayProcessAdapter {
  return {
    spawn: vi.fn(async () => ({ pid: input.spawnPid })),
    terminate: vi.fn(async () => undefined),
    isAlive: vi.fn(() => false),
  };
}
