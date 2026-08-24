import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyYaml } from "yaml";
import type { GatewayConfigurationSource } from "@kilnai/runtime";
import {
  gatewayCommand,
  type GatewayCommandDependencies,
} from "../../src/commands/gateway.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";
import { createMcpCredentialAccess, KILN_MCP_SECRET_KEY_ENV } from "../../src/config/mcp-credentials.js";
import { makeOperatorSurfaceGlobalConfig } from "./operator-surface-v4-fixture.js";

const revision = `sha256:${"a".repeat(64)}` as const;
const projectPath = resolveProjectRoot({ cwd: process.cwd() }).rootPath;
const projectStateBinding = resolveProjectStateBinding(projectPath, { kilnHome: join(projectPath, "kiln-home") });
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
      runtimeDir: join(projectStateBinding.runtimePath, "app-gateway"),
      privateStateRoot: projectStateBinding.projectStateRoot,
      desired: { port: 4_900, configurationRevision: revision },
      launch: expect.objectContaining({
        command: "bun",
        args: ["cli.js", "gateway", "serve", "--config", gatewayPath, "--port", "4900"],
      }),
    }));
    expect(start).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`revision ${revision}`));
  });

  it("converges a nested invocation on the canonical project root", async () => {
    const nestedProjectPath = join(projectPath, "packages", "cli", "src");
    const createSupervisor = vi.fn(() => ({
      start: vi.fn(async () => ({ state: "ready" as const, identity: {
        protocolVersion: "1" as const,
        service: "kiln-app-gateway" as const,
        instanceId: "nested-instance",
        version: "3.0.0-test",
        pid: 42,
        startedAt: 1,
        port: 4_800,
        configurationRevision: revision,
        lifecycle: "ready" as const,
      } })),
      ensure: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      status: vi.fn(),
      doctor: vi.fn(),
    }));
    const readConfigurationSource = vi.fn(() => source);

    await gatewayCommand(["start"], dependencies({
      projectPath: nestedProjectPath,
      createSupervisor,
      readConfigurationSource,
    }));

    expect(readConfigurationSource).toHaveBeenCalledWith(gatewayPath);
    expect(createSupervisor).toHaveBeenCalledWith(expect.objectContaining({
      runtimeDir: join(projectStateBinding.runtimePath, "app-gateway"),
      privateStateRoot: projectStateBinding.projectStateRoot,
      launch: expect.objectContaining({
        cwd: projectPath,
        args: ["cli.js", "gateway", "serve", "--config", gatewayPath],
      }),
    }));
  });

  it("keeps the serve MCP credential resolver on the composed binding after XDG changes", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "kiln-gateway-binding-"));
    const projectRoot = join(fixtureRoot, "project");
    const bindingHome = join(fixtureRoot, "bound-kiln");
    const ambientHome = join(fixtureRoot, "ambient-kiln");
    mkdirSync(projectRoot, { recursive: true });
    const configPath = join(projectRoot, "gateway.yaml");
    writeFileSync(configPath, "port: 4800\napps: []\n", "utf-8");
    const binding = resolveProjectStateBinding(projectRoot, { kilnHome: bindingHome });
    const globalConfig = {
      ...makeOperatorSurfaceGlobalConfig("codex-oauth", "gpt-5.4-mini", "gateway-default"),
      mcp: {
        servers: {
          shared: {
            enabled: true,
            transport: "stdio",
            command: "fixture-mcp",
            env: { TOKEN: { fromCredential: "bound-token" } },
            admission: { state: "admitted" },
          },
        },
      },
    };
    mkdirSync(binding.kilnHome, { recursive: true });
    writeFileSync(join(binding.kilnHome, "config.yaml"), stringifyYaml(globalConfig), "utf-8");
    vi.stubEnv(KILN_MCP_SECRET_KEY_ENV, "gateway-binding-key");
    createMcpCredentialAccess(process.env, binding.kilnHome).set("bound-token", "bound-secret");
    vi.stubEnv("XDG_CONFIG_HOME", ambientHome);
    let startedOptions: Parameters<NonNullable<GatewayCommandDependencies["startGateway"]>>[1] | undefined;
    try {
      await gatewayCommand(["serve"], {
        projectPath: projectRoot,
        projectStateBinding: binding,
        exists: () => true,
        readConfigurationSource: () => ({
          config: { port: 4800, apps: [] },
          gateway: { path: configPath, bytes: "port: 4800\napps: []\n" },
          apps: [],
          configurationRevision: revision,
        }),
        startGateway: vi.fn(async (_path, options) => {
          startedOptions = options;
        }),
        log: vi.fn(),
      });

      expect(startedOptions?.kilnHome).toBe(binding.kilnHome);
      expect(startedOptions?.mcpCredentialResolver?.("bound-token")).toBe("bound-secret");
    } finally {
      vi.unstubAllEnvs();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid ports and internal identity fragments", async () => {
    await expect(gatewayCommand(["start", "--port", "0"], dependencies())).rejects.toThrow("1 through 65535");
    await expect(gatewayCommand(["serve", "--instance-id", "partial"], dependencies())).rejects.toThrow("requires both");
  });
});

function dependencies(overrides: Partial<GatewayCommandDependencies> = {}): Partial<GatewayCommandDependencies> {
  return {
    projectPath,
    projectStateBinding,
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
