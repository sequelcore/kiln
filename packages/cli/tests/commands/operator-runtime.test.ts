import { describe, expect, it, vi } from "vitest";
import type { OperatorRuntimeState, OperatorRuntimeSupervisorStatus } from "@kilnai/runtime";
import type { KilnAppConfig } from "../../src/config.js";
import { operatorRuntimeCommand } from "../../src/commands/operator-runtime.js";
import { createCli } from "../../src/index.js";

const launch = {
  schemaVersion: 1 as const,
  command: "bun",
  args: ["C:\\kiln\\src\\index.ts", "operator-runtime", "serve", "--global-runtime"],
  mode: "local-dev" as const,
  version: "3.0.0-beta.1",
};

describe("operatorRuntimeCommand", () => {
  it("is routed by the CLI entrypoint", async () => {
    const originalArgv = process.argv;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const config: KilnAppConfig = { createRegistry: () => { throw new Error("unused"); } };
    try {
      process.argv = [originalArgv[0] ?? "bun", originalArgv[1] ?? "index.ts", "operator-runtime", "--help"];
      await createCli(config);
    } finally {
      process.argv = originalArgv;
      log.mockRestore();
    }
  });

  it.each(["start", "ensure", "stop", "restart", "status"] as const)("forwards %s to the supervisor", async (command) => {
    const ready = readyStatus();
    const lifecycle = fakeLifecycle();
    lifecycle.supervisor[command].mockResolvedValue(ready);
    const log = vi.fn();
    await operatorRuntimeCommand([command, "--json"], { createLifecycle: () => lifecycle.value, log });
    expect(lifecycle.supervisor[command]).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(JSON.stringify(ready));
  });

  it("forwards doctor and emits only the closed diagnostic shape", async () => {
    const lifecycle = fakeLifecycle();
    const result = {
      status: { state: "stopped" as const },
      stateFile: "absent" as const,
      credentialsFile: "absent" as const,
      version: launch.version,
      port: 4_820,
      diagnostics: [],
    };
    lifecycle.supervisor.doctor.mockResolvedValue(result);
    const log = vi.fn();
    await operatorRuntimeCommand(["doctor", "--json"], { createLifecycle: () => lifecycle.value, log });
    expect(log).toHaveBeenCalledWith(JSON.stringify(result));
  });

  it("serves only after exact persisted launch identity and credentials validation", async () => {
    const lifecycle = fakeLifecycle();
    const state = stateFixture();
    lifecycle.supervisor.readState.mockResolvedValue(state);
    lifecycle.readChildCredentials.mockResolvedValue({
      schemaVersion: 1,
      controlToken: "c".repeat(43),
      sessionSecret: new TextEncoder().encode("operator-runtime-test-session-secret"),
    });
    const service = {
      onSessionOpen: vi.fn(),
      onMcpRequest: vi.fn(),
      close: vi.fn(async () => {}),
    };
    const closeListener = vi.fn();
    const startListener = vi.fn(async () => ({ close: closeListener }));
    const registerShutdown = vi.fn();
    const log = vi.fn();

    await operatorRuntimeCommand([
      "serve", "--global-runtime", "--instance-id", state.instanceId, "--started-at", String(state.startedAt),
    ], {
      createLifecycle: () => lifecycle.value,
      createService: vi.fn(() => service),
      startListener,
      pid: state.pid,
      registerShutdown,
      log,
    });

    expect(startListener).toHaveBeenCalledWith(expect.objectContaining({
      port: 4_820,
      identity: {
        protocolVersion: "1",
        service: "kiln-operator-runtime",
        instanceId: state.instanceId,
        version: state.version,
        pid: state.pid,
        startedAt: state.startedAt,
        port: state.port,
      },
      controlToken: "c".repeat(43),
      onSessionOpen: service.onSessionOpen,
      onMcpRequest: service.onMcpRequest,
    }));
    expect(registerShutdown).toHaveBeenCalledOnce();
    const shutdown = registerShutdown.mock.calls[0]![0]!;
    await shutdown();
    await shutdown();
    expect(closeListener).toHaveBeenCalledOnce();
    expect(service.close).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("Operator runtime ready on loopback port 4820.");
  });

  it.each([
    ["serve"],
    ["serve", "--global-runtime", "--instance-id", "instance"],
    ["serve", "--global-runtime", "--instance-id", "instance", "--started-at", "not-an-integer"],
    ["status", "--instance-id", "instance"],
  ])("rejects incomplete or externally supplied internal identity", async (...args) => {
    await expect(operatorRuntimeCommand(args, { createLifecycle: () => fakeLifecycle().value })).rejects.toThrow();
  });

  it("denies serve before constructing service when persisted state does not match the process", async () => {
    const lifecycle = fakeLifecycle();
    lifecycle.supervisor.readState.mockResolvedValue({ ...stateFixture(), pid: 999 });
    lifecycle.readChildCredentials.mockResolvedValue({
      schemaVersion: 1,
      controlToken: "c".repeat(43),
      sessionSecret: new Uint8Array(32),
    });
    const createService = vi.fn();
    await expect(operatorRuntimeCommand([
      "serve", "--global-runtime", "--instance-id", "instance-1", "--started-at", "1700000000",
    ], { createLifecycle: () => lifecycle.value, createService, pid: 123 })).rejects.toThrow(/do not match/i);
    expect(createService).not.toHaveBeenCalled();
  });

  it("contains both listener and service shutdown failures without leaking a rejected signal task", async () => {
    const lifecycle = fakeLifecycle();
    const state = stateFixture();
    lifecycle.supervisor.readState.mockResolvedValue(state);
    lifecycle.readChildCredentials.mockResolvedValue({
      schemaVersion: 1,
      controlToken: "c".repeat(43),
      sessionSecret: new Uint8Array(32),
    });
    const service = {
      onSessionOpen: vi.fn(),
      onMcpRequest: vi.fn(),
      close: vi.fn(async () => { throw new Error("service close"); }),
    };
    const registerShutdown = vi.fn();
    const diagnostic = vi.fn();
    await operatorRuntimeCommand([
      "serve", "--global-runtime", "--instance-id", state.instanceId, "--started-at", String(state.startedAt),
    ], {
      createLifecycle: () => lifecycle.value,
      createService: vi.fn(() => service),
      startListener: vi.fn(async () => ({ close: () => { throw new Error("listener close"); } })),
      pid: state.pid,
      registerShutdown,
      writeDiagnostic: diagnostic,
      log: vi.fn(),
    });
    const shutdown = registerShutdown.mock.calls[0]![0]!;
    await expect(shutdown()).resolves.toBeUndefined();
    expect(service.close).toHaveBeenCalledOnce();
    expect(diagnostic).toHaveBeenCalledWith("Operator runtime listener shutdown failed.");
    expect(diagnostic).toHaveBeenCalledWith("Operator runtime service shutdown failed.");
  });
});

function readyStatus(): OperatorRuntimeSupervisorStatus {
  return {
    state: "ready",
    identity: {
      protocolVersion: "1",
      service: "kiln-operator-runtime",
      instanceId: "instance-1",
      version: launch.version,
      pid: 123,
      startedAt: 1_700_000_000,
      port: 4_820,
    },
  };
}

function stateFixture(): OperatorRuntimeState {
  return {
    schemaVersion: 1,
    instanceId: "instance-1",
    pid: 123,
    port: 4_820,
    version: launch.version,
    startedAt: 1_700_000_000,
    launch,
  };
}

function fakeLifecycle() {
  const stopped = { state: "stopped" as const };
  const supervisor = {
    start: vi.fn(async () => stopped),
    ensure: vi.fn(async () => stopped),
    stop: vi.fn(async () => stopped),
    restart: vi.fn(async () => stopped),
    status: vi.fn(async () => stopped),
    doctor: vi.fn(),
    readState: vi.fn(async () => null as OperatorRuntimeState | null),
  };
  const readChildCredentials = vi.fn(async () => null);
  return {
    supervisor,
    readChildCredentials,
    value: {
      runtimeDir: "C:\\global\\runtime\\operator",
      port: 4_820,
      launch,
      supervisor,
      readBridgeCredentials: vi.fn(async () => null),
      readChildCredentials,
    },
  };
}
