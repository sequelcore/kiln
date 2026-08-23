import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelGatewayConfig } from "@kilnai/core/engine";
import {
  ModelGatewaySupervisor,
  createModelGatewayConfigDigest,
  validateModelGatewayHostIdentity,
  type ModelGatewayProcessAdapter,
  type ModelGatewayListenerInspection,
} from "../../src/index.js";

const config: ModelGatewayConfig = {
  port: 4819,
  replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
  principals: [{ tokenEnv: "BEARER_TOKEN", ingress: "openai-responses", tenantId: "tenant", applicationId: "app", callerId: "caller", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget", virtualModelIds: ["codex"] }],
  virtualModels: [{ id: "codex", targetId: "route", capabilities: ["text"], affinity: { continuity: "none" } }],
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
    expect(state).toMatchObject({ schemaVersion: 2, instanceId: "instance-a", pid: 222, launch: { schemaVersion: 2, version: "3.0.0-test", host: hostIdentity, requiredEnvNames: ["BEARER_TOKEN", "REPLAY_SECRET"] } });
    expect(JSON.stringify(state)).not.toContain("secret-value");
  });

  it("does not spawn or terminate a foreign listener", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-supervisor-foreign-"));
    const processAdapter = adapter({ spawnPid: 222 });
    const supervisor = createSupervisor(root, vi.fn(async (): Promise<ModelGatewayListenerInspection> => ({ state: "foreign", reason: "identity-mismatch" })), processAdapter);
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
      schemaVersion: 2,
      instanceId: "instance-old",
      pid: 111,
      port: 4819,
      version: "3.0.0-test",
      configDigest: "f".repeat(64),
      startedAt: "2026-08-12T00:00:00.000Z",
      launch: { schemaVersion: 2, command: "bun", args: ["cli.js", "model-gateway", "serve", "--global-runtime"], mode: "local-dev", version: "3.0.0-test", host: hostIdentity, requiredEnvNames: ["BEARER_TOKEN", "REPLAY_SECRET"] },
    }, null, 2)}\n`, "utf8");

    await expect(supervisor.ensure()).resolves.toMatchObject({ state: "ready", identity: { instanceId: "instance-a", pid: 222 } });
    expect(inspect).toHaveBeenNthCalledWith(1, { port: 4819, configDigest: "f".repeat(64) });
    expect(inspect).toHaveBeenNthCalledWith(2, { port: 4819, configDigest: "f".repeat(64) });
    expect(inspect).toHaveBeenNthCalledWith(3, { port: 4819, configDigest: "f".repeat(64) });
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

  it("rejects an exact owned v1 state without mutating it or touching the process", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-supervisor-v1-"));
    const inspect = vi.fn(async () => ({ state: "ready" as const, identity: identity("instance-v1", 111) }));
    const processAdapter = adapter({ spawnPid: 222 });
    const supervisor = createSupervisor(root, inspect, processAdapter, () => "instance-a");
    const legacyState = `${JSON.stringify({
      schemaVersion: 1, instanceId: "instance-v1", pid: 111, port: 4819, version: "3.0.0-test",
      configDigest: createModelGatewayConfigDigest(config), startedAt: "2026-08-12T00:00:00.000Z",
      launch: { schemaVersion: 1, command: "bun", args: ["cli.js", "model-gateway", "serve", "--global-runtime"], mode: "local-dev", version: "3.0.0-test", requiredEnvNames: ["BEARER_TOKEN", "REPLAY_SECRET"] },
    })}\n`;
    await writeFile(join(root, "state.json"), legacyState, "utf8");

    await expect(supervisor.ensure()).rejects.toThrow("unsupported or invalid");
    await expect(readFile(join(root, "state.json"), "utf8")).resolves.toBe(legacyState);
    expect(inspect).not.toHaveBeenCalled();
    expect(processAdapter.spawn).not.toHaveBeenCalled();
    expect(processAdapter.terminate).not.toHaveBeenCalled();
  });

  it("fails closed for malformed v1 state", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-supervisor-invalid-v1-"));
    const supervisor = createSupervisor(root, vi.fn(async (): Promise<ModelGatewayListenerInspection> => ({ state: "stopped" })), adapter({ spawnPid: 222 }));
    await writeFile(join(root, "state.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");

    await expect(supervisor.ensure()).rejects.toThrow("unsupported or invalid");
  });

  it("rejects a host identity without a canonical SHA-256", () => {
    expect(() => validateModelGatewayHostIdentity({ ...hostIdentity, sha256: "not-a-sha" })).toThrow("Invalid model gateway host identity");
  });

  it("reports the desired and observed host identities when state host provenance drifts", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-supervisor-host-drift-"));
    const observedHost = { ...hostIdentity, revision: "prior-revision", sha256: "b".repeat(64) };
    await writeFile(join(root, "state.json"), `${JSON.stringify({
      schemaVersion: 2, instanceId: "instance-old", pid: 111, port: 4819, version: "3.0.0-test",
      configDigest: createModelGatewayConfigDigest(config), startedAt: "2026-08-12T00:00:00.000Z",
      launch: { schemaVersion: 2, command: "bun", args: ["cli.js"], mode: "local-dev", version: "3.0.0-test", host: observedHost, requiredEnvNames: [] },
    })}\n`, "utf8");
    const supervisor = createSupervisor(root, vi.fn(async (): Promise<ModelGatewayListenerInspection> => ({ state: "stopped" })), adapter({ spawnPid: 222 }));

    await expect(supervisor.doctor()).resolves.toMatchObject({
      host: { desired: hostIdentity, observed: observedHost },
      diagnostics: expect.arrayContaining(["state-host-drift", "stale-state"]),
    });
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
    launch: { schemaVersion: 2, command: "bun", args: ["cli.js", "model-gateway", "serve", "--global-runtime"], mode: "local-dev", version: "3.0.0-test", host: hostIdentity, requiredEnvNames: ["BEARER_TOKEN", "REPLAY_SECRET"] },
    inspect,
    requestShutdown: async () => ({ state: "accepted" }),
    processAdapter,
    createInstanceId,
    wait,
  });
}

const hostIdentity = {
  schemaVersion: 1 as const,
  runtimeKind: "bun" as const,
  version: "3.0.0-test",
  revision: "test-revision",
  provenance: "synthetic-test-fixture",
  sha256: "a".repeat(64),
  platform: "win32",
  arch: "x64",
  packageName: "@kilnai/model-gateway-host-win32-x64",
  source: "repository" as const,
};

function adapter(input: { spawnPid: number }): ModelGatewayProcessAdapter {
  return {
    spawn: vi.fn(async () => ({ pid: input.spawnPid })),
    terminate: vi.fn(async () => undefined),
    isAlive: vi.fn(() => false),
  };
}
