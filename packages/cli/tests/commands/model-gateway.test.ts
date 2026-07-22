import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGatewayYaml } from "@kilnai/core";
import type { StartModelGatewayListenerOptions } from "@kilnai/runtime";
import { modelGatewayCommand } from "../../src/commands/model-gateway.js";

const yaml = `port: 4800
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
`;
const modelGateway = parseGatewayYaml(yaml).modelGateway!;

describe("modelGatewayCommand", () => {
  let root: string | undefined;
  afterEach(async () => { vi.restoreAllMocks(); if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

  it("serves only the dedicated listener with deterministic identity and state path", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-cli-"));
    const configPath = join(root, "gateway.yaml");
    await writeFile(configPath, yaml, "utf8");
    const start = vi.fn(async (_options: StartModelGatewayListenerOptions) => ({ close: vi.fn() }));
    const registerShutdown = vi.fn();
    const log = vi.fn();

    await modelGatewayCommand(["serve", "--config", configPath], {
      startModelGatewayListener: start,
      inspectModelGatewayListener: vi.fn(),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      version: "3.0.0-test",
      pid: 99,
      registerShutdown,
      log,
    });

    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]![0]).toMatchObject({
      config: { port: 4819 },
      databasePath: join(root, ".kiln", "model-gateway", "model-gateway.sqlite"),
      identity: { instanceId: "dev-99", version: "3.0.0-test", pid: 99, configDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(registerShutdown).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("127.0.0.1:4819"));
  });

  it.each(["start", "ensure", "stop", "restart", "status"] as const)("dispatches %s against the user-scoped supervisor without --config", async (command) => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-global-"));
    const log = vi.fn();
    const methods = { start: vi.fn(), ensure: vi.fn(), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() };
    methods[command].mockResolvedValue({ state: "stopped" });

    await modelGatewayCommand([command, "--json"], {
      readGlobalConfig: () => ({ version: "1", modelGateway }),
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: vi.fn(() => methods),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      version: "3.0.0-test",
      pid: 99,
      execPath: "bun",
      entrypoint: "cli.js",
      log,
    });

    expect(methods[command]).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({ state: "stopped" });
  });

  it("runs doctor through the same global supervisor", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-doctor-"));
    const doctor = vi.fn(async () => ({ status: { state: "stopped" as const }, stateFile: "absent" as const, configDigest: "a".repeat(64), version: "3.0.0-test", diagnostics: [] }));
    const log = vi.fn();
    await modelGatewayCommand(["doctor", "--json"], {
      readGlobalConfig: () => ({ version: "1", modelGateway }), resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor }),
      env: { BEARER_TOKEN: "b".repeat(32) }, version: "3.0.0-test", execPath: "bun", entrypoint: "cli.js", log,
    });
    expect(doctor).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({ status: { state: "stopped" }, diagnostics: [] });
  });

  it("installs, inspects, and removes user autostart through the injected adapter", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-autostart-"));
    const status = vi.fn(async () => ({ state: "absent" as const }));
    const install = vi.fn(async () => ({ state: "installed" as const, digest: "a".repeat(64) }));
    const uninstall = vi.fn(async () => ({ state: "absent" as const }));
    const base = {
      readGlobalConfig: () => ({ version: "1" as const, modelGateway }),
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createAutostartAdapter: () => ({ status, install, uninstall }),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      version: "3.0.0-test", execPath: "bun", entrypoint: "cli.js", userId: "operator", log: vi.fn(),
    };
    await modelGatewayCommand(["install-autostart", "--json"], base);
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ command: "bun", args: ["cli.js", "model-gateway", "ensure"], version: "3.0.0-test" }));
    await modelGatewayCommand(["autostart-status", "--json"], base);
    await modelGatewayCommand(["uninstall-autostart", "--json"], base);
    expect(status).toHaveBeenCalledTimes(2);
    expect(uninstall).toHaveBeenCalledOnce();
  });

  it("fails closed when the canonical config has no modelGateway block", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-missing-"));
    const configPath = join(root, "gateway.yaml");
    await writeFile(configPath, "port: 4800\napps: [{ name: app, config: app.yaml, channels: [{ type: api }] }]\n", "utf8");
    await expect(modelGatewayCommand(["serve", "--config", configPath])).rejects.toThrow("does not declare modelGateway");
  });

  it("ensures the exact gateway before synchronizing the global OpenCode provider", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-sync-native-"));
    const gatewayReady = { state: "ready" as const, identity: { service: "kiln-model-gateway" as const, status: "ready" as const, protocolVersion: 1 as const, instanceId: "owned", pid: 44, version: "3.0.0-test", configDigest: "a".repeat(64), port: 4819 } };
    const ensure = vi.fn(async () => gatewayReady);
    const syncOpenCodeNativeProjection = vi.fn(async () => ({ operation: "install" as const, changed: true, targetPath: "opencode.json" }));

    await modelGatewayCommand(["sync-native", "--client", "opencode", "--json"], {
      readGlobalConfig: () => ({ version: "1", modelGateway }), resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure, stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      syncOpenCodeNativeProjection,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) }, version: "3.0.0-test", execPath: "bun", entrypoint: "cli.js", log: vi.fn(),
    });

    expect(ensure).toHaveBeenCalledOnce();
    expect(syncOpenCodeNativeProjection).toHaveBeenCalledWith(expect.objectContaining({ config: modelGateway, listener: gatewayReady.identity, operation: "install" }));
  });

  it("does not write a native projection when ensure is not ready", async () => {
    const syncOpenCodeNativeProjection = vi.fn();
    await expect(modelGatewayCommand(["sync-native", "--client", "opencode"], {
      readGlobalConfig: () => ({ version: "1", modelGateway }), createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(async () => ({ state: "foreign", reason: "identity-mismatch" })), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      syncOpenCodeNativeProjection, env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) }, entrypoint: "cli.js",
    })).rejects.toThrow("not owned and ready");
    expect(syncOpenCodeNativeProjection).not.toHaveBeenCalled();
  });
});
