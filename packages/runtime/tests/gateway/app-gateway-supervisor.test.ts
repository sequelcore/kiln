import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppGatewayRuntimeIdentity } from "@kilnai/gateway-contracts";
import {
  AppGatewaySupervisor,
  type AppGatewayListenerInspection,
  type AppGatewayProcessAdapter,
} from "../../src/index.js";

const revision = `sha256:${"a".repeat(64)}` as const;

describe("AppGatewaySupervisor", () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; vi.restoreAllMocks(); });

  it("starts one detached child with secret-free state and separate credentials", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-app-gateway-supervisor-"));
    const inspect = vi.fn<() => Promise<AppGatewayListenerInspection>>()
      .mockResolvedValueOnce({ state: "stopped" })
      .mockResolvedValue({ state: "ready", identity: identity("instance-a", 222) });
    const processAdapter = adapter(222);
    const supervisor = createSupervisor(root, inspect, processAdapter);

    await expect(supervisor.start()).resolves.toMatchObject({ state: "ready" });
    expect(processAdapter.spawn).toHaveBeenCalledWith(expect.objectContaining({
      command: "bun",
      args: ["cli.js", "gateway", "serve", "--config", "gateway.yaml", "--supervised-runtime", root, "--instance-id", "instance-a", "--started-at", "1700000000"],
      cwd: "C:/project",
      detached: true,
      windowsHide: true,
    }));
    const stateText = await readFile(join(root, "state.json"), "utf8");
    const credentialText = await readFile(join(root, "credentials.json"), "utf8");
    expect(stateText).not.toContain("controlToken");
    expect(JSON.parse(credentialText)).toMatchObject({ schemaVersion: 1, controlToken: expect.any(String) });
    if (process.platform !== "win32") expect((await stat(join(root, "credentials.json"))).mode & 0o777).toBe(0o600);
  });

  it("restarts an owned prior exact source revision during ensure", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-app-gateway-revision-"));
    const priorRevision = `sha256:${"b".repeat(64)}` as const;
    const prior = identity("instance-old", 111, priorRevision);
    await writeFile(join(root, "credentials.json"), JSON.stringify({ schemaVersion: 1, controlToken: "old-private-control-token" }), "utf8");
    await writeFile(join(root, "state.json"), JSON.stringify(state(prior)), "utf8");
    const inspect = vi.fn<() => Promise<AppGatewayListenerInspection>>()
      .mockResolvedValueOnce({ state: "ready", identity: prior })
      .mockResolvedValueOnce({ state: "ready", identity: prior })
      .mockResolvedValueOnce({ state: "stopped" })
      .mockResolvedValueOnce({ state: "stopped" })
      .mockResolvedValue({ state: "ready", identity: identity("instance-a", 222) });
    const processAdapter = adapter(222);
    const supervisor = createSupervisor(root, inspect, processAdapter);

    await expect(supervisor.ensure()).resolves.toMatchObject({ state: "ready", identity: { configurationRevision: revision } });
    expect(processAdapter.spawn).toHaveBeenCalledOnce();
  });

  it("never spawns or terminates when listener ownership is foreign", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-app-gateway-foreign-"));
    const processAdapter = adapter(222);
    const foreignInspect = vi.fn<() => Promise<AppGatewayListenerInspection>>(async () => ({ state: "foreign", reason: "unauthorized" }));
    const supervisor = createSupervisor(root, foreignInspect, processAdapter);
    await expect(supervisor.ensure()).resolves.toEqual({ state: "foreign", reason: "unauthorized" });
    await expect(supervisor.stop()).resolves.toEqual({ state: "foreign", reason: "unauthorized" });
    expect(processAdapter.spawn).not.toHaveBeenCalled();
    expect(processAdapter.terminate).not.toHaveBeenCalled();
  });

  it("fails closed when the composed runtime directory is replaced by a junction", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-app-gateway-junction-"));
    const runtimeDir = join(root, "runtime", "app-gateway");
    const external = join(root, "external");
    const sentinel = join(external, "sentinel.txt");
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(external, { recursive: true });
    await writeFile(sentinel, "must remain untouched", "utf8");
    const inspect = vi.fn<() => Promise<AppGatewayListenerInspection>>()
      .mockResolvedValue({ state: "stopped" });
    const processAdapter = adapter(222);
    const supervisor = createSupervisor(runtimeDir, inspect, processAdapter, root);

    await rm(runtimeDir, { recursive: true, force: true });
    symlinkSync(external, runtimeDir, process.platform === "win32" ? "junction" : "dir");

    await expect(supervisor.start()).rejects.toThrow("unsafe");
    expect(await readFile(sentinel, "utf8")).toBe("must remain untouched");
    expect(await readFile(join(external, "state.json")).catch(() => null)).toBeNull();
    expect(await readFile(join(external, "credentials.json")).catch(() => null)).toBeNull();
    expect(await readFile(join(external, "lifecycle.lock")).catch(() => null)).toBeNull();
    expect(inspect).not.toHaveBeenCalled();
    expect(processAdapter.spawn).not.toHaveBeenCalled();
  });
});

function createSupervisor(
  root: string,
  inspect: () => Promise<AppGatewayListenerInspection>,
  processAdapter: AppGatewayProcessAdapter,
  privateStateRoot = dirname(root),
) {
  return new AppGatewaySupervisor({
    runtimeDir: root,
    privateStateRoot,
    desired: { port: 4_800, configurationRevision: revision },
    version: "3.0.0-test",
    launch: { schemaVersion: 1, command: "bun", args: ["cli.js", "gateway", "serve", "--config", "gateway.yaml"], cwd: "C:/project", mode: "local-dev", version: "3.0.0-test" },
    inspect,
    requestShutdown: async () => ({ state: "accepted" }),
    processAdapter,
    createInstanceId: () => "instance-a",
    createControlToken: () => "private-control-token",
    now: () => 1_700_000_000,
    wait: async () => undefined,
  });
}

function identity(instanceId: string, pid: number, configurationRevision = revision): AppGatewayRuntimeIdentity {
  return { protocolVersion: "1", service: "kiln-app-gateway", instanceId, version: "3.0.0-test", pid, startedAt: 1_700_000_000, port: 4_800, configurationRevision, lifecycle: "ready" };
}

function state(value: AppGatewayRuntimeIdentity) {
  return { schemaVersion: 1, ...value, launch: { schemaVersion: 1, command: "bun", args: ["cli.js", "gateway", "serve", "--config", "gateway.yaml"], cwd: "C:/project", mode: "local-dev", version: "3.0.0-test" } };
}

function adapter(spawnPid: number): AppGatewayProcessAdapter {
  return { spawn: vi.fn(async () => ({ pid: spawnPid })), terminate: vi.fn(async () => undefined), isAlive: vi.fn(() => false) };
}
