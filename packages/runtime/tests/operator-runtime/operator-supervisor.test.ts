import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_RUNTIME_PROTOCOL_VERSION, type OperatorSupervisorIdentity } from "@kilnai/gateway-contracts";
import {
  OperatorRuntimeSupervisor,
  readOperatorRuntimeBridgeCredentials,
  readOperatorRuntimeChildCredentials,
  type OperatorRuntimeListenerInspector,
  type OperatorRuntimeProcessAdapter,
} from "../../src/operator-runtime/operator-supervisor.js";

const port = 47_321;
const version = "3.0.0-beta.1";
const controlToken = "c".repeat(43);
const sessionSecret = Buffer.alloc(32, 7);

describe("OperatorRuntimeSupervisor", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
    vi.restoreAllMocks();
  });

  it("coalesces concurrent ensure calls into one detached spawn and exact ready identity", async () => {
    root = await tempRuntime();
    const processAdapter = adapter(222);
    let ready = false;
    const inspect = vi.fn<OperatorRuntimeListenerInspector>(async (input) => {
      if (!ready || !input.expectedIdentity) return { state: "stopped" };
      return { state: "ready", identity: input.expectedIdentity };
    });
    vi.mocked(processAdapter.spawn).mockImplementation(async () => {
      ready = true;
      return { pid: 222 };
    });
    const supervisor = createSupervisor(root, inspect, processAdapter);

    const [first, second] = await Promise.all([supervisor.ensure(), supervisor.ensure()]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ state: "ready", identity: { instanceId: "instance-a", pid: 222 } });
    expect(processAdapter.spawn).toHaveBeenCalledOnce();
    expect(processAdapter.spawn).toHaveBeenCalledWith({
      command: "bun",
      args: ["cli.js", "operator-runtime", "serve", "--instance-id", "instance-a", "--started-at", "1780000000"],
      detached: true,
      windowsHide: true,
    });
    const state = await supervisor.readState();
    expect(state).toMatchObject({ schemaVersion: 1, instanceId: "instance-a", pid: 222, port, version, startedAt: 1_780_000_000 });
    expect(JSON.stringify(state)).not.toContain(controlToken);
    expect(JSON.stringify(state)).not.toContain(sessionSecret.toString("base64url"));
  });

  it("reuses an owned ready instance without rotating credentials or spawning", async () => {
    root = await tempRuntime();
    const processAdapter = adapter(222);
    let readyIdentity: OperatorSupervisorIdentity | undefined;
    const inspect = vi.fn<OperatorRuntimeListenerInspector>(async () => readyIdentity
      ? { state: "ready", identity: readyIdentity }
      : { state: "stopped" });
    vi.mocked(processAdapter.spawn).mockImplementation(async () => ({ pid: 222 }));
    const supervisor = createSupervisor(root, async (input) => {
      if (input.expectedIdentity) readyIdentity = input.expectedIdentity;
      return inspect(input);
    }, processAdapter);
    await supervisor.start();
    const credentialsBefore = await readFile(join(root, "credentials.json"), "utf8");

    await expect(supervisor.ensure()).resolves.toMatchObject({ state: "ready" });
    expect(processAdapter.spawn).toHaveBeenCalledOnce();
    expect(await readFile(join(root, "credentials.json"), "utf8")).toBe(credentialsBefore);
  });

  it("removes dead stale state before starting a fresh instance", async () => {
    root = await tempRuntime();
    const processAdapter = adapter(333);
    const supervisor = createSupervisor(root, stoppedThenExpectedReady(), processAdapter);
    await writeFile(join(root, "state.json"), `${JSON.stringify(runtimeState({ instanceId: "dead", pid: 111 }))}\n`);

    await expect(supervisor.ensure()).resolves.toMatchObject({ state: "ready", identity: { instanceId: "instance-a", pid: 333 } });
    expect(processAdapter.spawn).toHaveBeenCalledOnce();
  });

  it.each([
    ["foreign listener", async () => ({ state: "foreign", reason: "unauthorized" } as const), "unauthorized"],
    ["identity mismatch", async () => ({ state: "ready", identity: identity({ instanceId: "other" }) } as const), "listener-identity-mismatch"],
  ])("fails closed for a %s", async (_name, inspect, expectedReason) => {
    root = await tempRuntime();
    await writeCredentials(root);
    await writeFile(join(root, "state.json"), `${JSON.stringify(runtimeState())}\n`);
    const processAdapter = adapter(222);
    const supervisor = createSupervisor(root, inspect, processAdapter);

    await expect(supervisor.ensure()).resolves.toEqual({ state: "foreign", reason: expectedReason });
    expect(processAdapter.spawn).not.toHaveBeenCalled();
    expect(processAdapter.terminate).not.toHaveBeenCalled();
  });

  it("cleans state and the exact spawned process after spawn failure or startup timeout", async () => {
    root = await tempRuntime();
    const failedAdapter = adapter(222);
    vi.mocked(failedAdapter.spawn).mockRejectedValueOnce(new Error(`spawn failed ${controlToken}`));
    const failed = createSupervisor(root, async () => ({ state: "stopped" }), failedAdapter);
    await expect(failed.start()).resolves.toEqual({ state: "foreign", reason: "spawn-failed" });
    expect(await failed.readState()).toBeNull();

    const timeoutAdapter = adapter(333);
    const timedOut = createSupervisor(root, async () => ({ state: "stopped" }), timeoutAdapter, { startupAttempts: 2 });
    await expect(timedOut.start()).resolves.toEqual({ state: "foreign", reason: "startup-timeout" });
    expect(timeoutAdapter.terminate).toHaveBeenCalledWith(333);
    expect(await timedOut.readState()).toBeNull();
    expect(JSON.stringify(await timedOut.doctor())).not.toContain(controlToken);
  });

  it("stops only the exact persisted listener owner and restart rotates credentials", async () => {
    root = await tempRuntime();
    const processAdapter = adapter(222);
    let current: OperatorSupervisorIdentity | undefined;
    let stopping = false;
    const inspect = vi.fn<OperatorRuntimeListenerInspector>(async (input) => {
      if (stopping) {
        stopping = false;
        return { state: "stopped" };
      }
      if (!current && input.expectedIdentity) current = input.expectedIdentity;
      return current ? { state: "ready", identity: current } : { state: "stopped" };
    });
    vi.mocked(processAdapter.terminate).mockImplementation(async () => { current = undefined; stopping = true; });
    const ids = ["instance-a", "instance-b"];
    let credentialGeneration = 7;
    const supervisor = createSupervisor(root, inspect, processAdapter, {
      createInstanceId: () => ids.shift()!,
      createCredentialMaterial: () => {
        const bytes = Buffer.alloc(32, credentialGeneration++);
        return { controlToken: bytes.toString("base64url"), sessionSecret: bytes };
      },
    });
    await supervisor.start();
    const firstCredentials = await readFile(join(root, "credentials.json"), "utf8");

    await expect(supervisor.restart()).resolves.toMatchObject({ state: "ready", identity: { instanceId: "instance-b" } });
    expect(processAdapter.terminate).toHaveBeenCalledWith(222);
    expect(await readFile(join(root, "credentials.json"), "utf8")).not.toBe(firstCredentials);
  });

  it("never terminates a live stale owner or a listener with mismatched ownership", async () => {
    root = await tempRuntime();
    await writeCredentials(root);
    await writeFile(join(root, "state.json"), `${JSON.stringify(runtimeState())}\n`);
    const processAdapter = adapter(222);
    vi.mocked(processAdapter.isAlive).mockReturnValue(true);
    const stopped = createSupervisor(root, async () => ({ state: "stopped" }), processAdapter);
    await expect(stopped.stop()).resolves.toEqual({ state: "foreign", reason: "stale-owner-alive" });
    expect(processAdapter.terminate).not.toHaveBeenCalled();

    const mismatched = createSupervisor(root, async () => ({ state: "ready", identity: identity({ pid: 999 }) }), processAdapter);
    await expect(mismatched.stop()).resolves.toEqual({ state: "foreign", reason: "listener-identity-mismatch" });
    expect(processAdapter.terminate).not.toHaveBeenCalled();
  });

  it("uses strict canonical atomic 0600 files and gives bridges no session signing secret", async () => {
    root = await tempRuntime();
    const supervisor = createSupervisor(root, stoppedThenExpectedReady(), adapter(222));
    await supervisor.start();

    const stateText = await readFile(join(root, "state.json"), "utf8");
    const credentialText = await readFile(join(root, "credentials.json"), "utf8");
    expect(stateText.endsWith("\n")).toBe(true);
    expect(credentialText.endsWith("\n")).toBe(true);
    expect(JSON.parse(credentialText)).toEqual({ schemaVersion: 1, controlToken, sessionSecret: sessionSecret.toString("base64url") });
    expect(await readOperatorRuntimeBridgeCredentials(root)).toEqual({ schemaVersion: 1, controlToken });
    expect(await readOperatorRuntimeChildCredentials(root)).toEqual({ schemaVersion: 1, controlToken, sessionSecret: new Uint8Array(sessionSecret) });
    if (process.platform !== "win32") {
      expect((await stat(join(root, "state.json"))).mode & 0o777).toBe(0o600);
      expect((await stat(join(root, "credentials.json"))).mode & 0o777).toBe(0o600);
    }
    expect((await readdir(root)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects launch descriptors that could persist root or credential authority", async () => {
    const runtimeRoot = await tempRuntime();
    root = runtimeRoot;
    expect(() => createSupervisor(runtimeRoot, async () => ({ state: "stopped" }), adapter(222), {
      launch: {
        schemaVersion: 1,
        command: "bun",
        args: ["cli.js", "operator-runtime", "serve", "--project-root", "C:/private"],
        mode: "local-dev",
        version,
      },
    })).toThrow("Invalid operator runtime launch descriptor");
    expect(() => createSupervisor(runtimeRoot, async () => ({ state: "stopped" }), adapter(222), {
      launch: {
        schemaVersion: 1,
        command: "bun",
        args: ["cli.js", "operator-runtime", "serve", "--control-token=private"],
        mode: "local-dev",
        version,
      },
    })).toThrow("Invalid operator runtime launch descriptor");
  });

  it("fails closed on malformed persisted files and reports only safe doctor diagnostics", async () => {
    root = await tempRuntime();
    await writeFile(join(root, "state.json"), JSON.stringify({ ...runtimeState(), secret: controlToken }));
    await writeFile(join(root, "credentials.json"), JSON.stringify({ schemaVersion: 1, controlToken: "short", sessionSecret: "bad" }));
    const supervisor = createSupervisor(root, async () => ({ state: "stopped" }), adapter(222));

    await expect(supervisor.status()).resolves.toEqual({ state: "foreign", reason: "invalid-runtime-state" });
    const doctor = await supervisor.doctor();
    expect(doctor).toMatchObject({ stateFile: "invalid", credentialsFile: "invalid" });
    expect(doctor.diagnostics).toEqual(expect.arrayContaining(["invalid-runtime-state", "invalid-runtime-credentials"]));
    expect(JSON.stringify(doctor)).not.toContain(controlToken);
  });

  it("keeps lifecycle lock conflicts closed and always removes its own lock", async () => {
    root = await tempRuntime();
    await writeFile(join(root, "lifecycle.lock"), "999\n");
    const supervisor = createSupervisor(root, async () => ({ state: "stopped" }), adapter(222));
    await expect(supervisor.ensure()).resolves.toEqual({ state: "foreign", reason: "lifecycle-operation-in-progress" });
    await rm(join(root, "lifecycle.lock"));
    await supervisor.ensure();
    await expect(stat(join(root, "lifecycle.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function tempRuntime(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kiln-operator-supervisor-"));
  if (process.platform !== "win32") await chmod(directory, 0o700);
  return directory;
}

function createSupervisor(
  runtimeDir: string,
  inspect: OperatorRuntimeListenerInspector,
  processAdapter: OperatorRuntimeProcessAdapter,
  overrides: Partial<ConstructorParameters<typeof OperatorRuntimeSupervisor>[0]> = {},
): OperatorRuntimeSupervisor {
  return new OperatorRuntimeSupervisor({
    runtimeDir,
    port,
    version,
    launch: { schemaVersion: 1, command: "bun", args: ["cli.js", "operator-runtime", "serve"], mode: "local-dev", version },
    inspect,
    processAdapter,
    createInstanceId: () => "instance-a",
    createCredentialMaterial: () => ({ controlToken, sessionSecret }),
    nowEpochSeconds: () => 1_780_000_000,
    wait: async () => undefined,
    ...overrides,
  });
}

function adapter(spawnPid: number): OperatorRuntimeProcessAdapter {
  return {
    spawn: vi.fn(async () => ({ pid: spawnPid })),
    terminate: vi.fn(async () => undefined),
    isAlive: vi.fn(() => false),
  };
}

function identity(overrides: Partial<OperatorSupervisorIdentity> = {}): OperatorSupervisorIdentity {
  return {
    protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
    service: "kiln-operator-runtime",
    instanceId: "instance-a",
    version,
    pid: 222,
    startedAt: 1_780_000_000,
    port,
    ...overrides,
  };
}

function runtimeState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    instanceId: "instance-a",
    pid: 222,
    port,
    version,
    startedAt: 1_780_000_000,
    launch: { schemaVersion: 1, command: "bun", args: ["cli.js", "operator-runtime", "serve"], mode: "local-dev", version },
    ...overrides,
  };
}

function stoppedThenExpectedReady(): OperatorRuntimeListenerInspector {
  return vi.fn<OperatorRuntimeListenerInspector>(async (input) => input.expectedIdentity?.instanceId === "instance-a"
    ? { state: "ready", identity: input.expectedIdentity }
    : { state: "stopped" });
}

async function writeCredentials(runtimeDir: string): Promise<void> {
  await writeFile(join(runtimeDir, "credentials.json"), `${JSON.stringify({ schemaVersion: 1, controlToken, sessionSecret: sessionSecret.toString("base64url") })}\n`);
}
