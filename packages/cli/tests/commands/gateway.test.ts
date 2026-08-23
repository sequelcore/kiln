import { describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import type { GatewayConfigurationSource } from "@kilnai/runtime";
import {
  gatewayCommand,
  type GatewayCommandDependencies,
} from "../../src/commands/gateway.js";

const revision = `sha256:${"a".repeat(64)}` as const;
const projectPath = resolve("/project");
const gatewayPath = join(projectPath, "gateway.yaml");
const source: GatewayConfigurationSource = {
  config: { port: 4_800, apps: [] },
  gateway: { path: gatewayPath, bytes: "port: 4800\napps: []\n" },
  apps: [],
  configurationRevision: revision,
};

describe("gatewayCommand", () => {
  it("shows explicit lifecycle help when no subcommand is selected", async () => {
    const log = vi.fn();
    await gatewayCommand([], { log });
    expect(log.mock.calls.flat().join("\n")).toContain("gateway <serve|start|ensure|stop|restart|status|doctor>");
  });

  it("rejects a missing configuration without terminating the host process", async () => {
    await expect(gatewayCommand(["start"], dependencies({ exists: () => false })))
      .rejects.toThrow("Gateway config not found");
  });

  it("starts the exact source revision through the process supervisor", async () => {
    const start = vi.fn(async () => ({ state: "ready" as const, identity: {
      protocolVersion: "1" as const,
      service: "kiln-app-gateway" as const,
      instanceId: "instance-a",
      version: "3.0.0-test",
      pid: 42,
      startedAt: 1,
      port: 4_900,
      configurationRevision: revision,
      lifecycle: "ready" as const,
    } }));
    const createSupervisor = vi.fn(() => ({
      start,
      ensure: start,
      stop: start,
      restart: start,
      status: start,
      doctor: vi.fn(async () => ({ status: await start(), stateFile: "present" as const, credentialFile: "present" as const, desired: { port: 4_900, configurationRevision: revision }, diagnostics: [] })),
    }));
    const log = vi.fn();

    await gatewayCommand(["start", "--port", "4900"], dependencies({ createSupervisor, log }));

    expect(createSupervisor).toHaveBeenCalledWith(expect.objectContaining({
      runtimeDir: join(projectPath, ".kiln", "runtime", "app-gateway"),
      desired: { port: 4_900, configurationRevision: revision },
      launch: expect.objectContaining({
        command: "bun",
        args: ["cli.js", "gateway", "serve", "--config", gatewayPath, "--port", "4900"],
      }),
    }));
    expect(start).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`revision ${revision}`));
  });

  it("rejects invalid ports and internal identity fragments", async () => {
    await expect(gatewayCommand(["start", "--port", "0"], dependencies())).rejects.toThrow("1 through 65535");
    await expect(gatewayCommand(["serve", "--instance-id", "partial"], dependencies())).rejects.toThrow("requires both");
  });
});

function dependencies(overrides: Partial<GatewayCommandDependencies> = {}): Partial<GatewayCommandDependencies> {
  return {
    projectPath,
    entrypoint: "cli.js",
    executable: "bun",
    version: "3.0.0-test",
    pid: 42,
    exists: () => true,
    readConfigurationSource: () => source,
    log: vi.fn(),
    ...overrides,
  };
}
