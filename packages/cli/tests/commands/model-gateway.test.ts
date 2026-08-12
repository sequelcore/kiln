import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineExecutionCatalog, parseGatewayYaml } from "@kilnai/core";
import { SqliteManagedAccountLeaseAuthority, type StartModelGatewayListenerOptions } from "@kilnai/runtime";
import { modelGatewayCommand } from "../../src/commands/model-gateway.js";

const yaml = `port: 4800
apps: []
modelGateway:
  port: 4819
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_SECRET }
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } }
  principals:
    - { tokenEnv: BEARER_TOKEN, ingress: openai-responses, tenantId: tenant, applicationId: app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [codex] }
  virtualModels:
    - { id: codex, displayName: Codex, contextTokens: 1000, outputTokens: 100, executionRouteId: codex-route, capabilities: [text], affinity: { continuity: none } }
`;
const modelGateway = parseGatewayYaml(yaml).modelGateway!;
const executionCatalog = defineExecutionCatalog({
  accounts: [{
    id: "account",
    providerId: "codex-oauth",
    credentialId: "credential",
    maxConcurrency: 1,
    reservedAffinitySlots: 0,
    economics: {
      capacityIdentity: "account",
      subscriptionClass: "subscription",
      quotaClassId: "quota",
      creditPosture: "committed",
      overagePosture: "disabled",
    },
  }],
  accountPolicies: [{ id: "account-policy", accountIds: ["account"], strategy: "economic-least-pressure" }],
  routes: [{
    id: "codex-route",
    label: "Codex route",
    providerId: "codex-oauth",
    providerModelId: "model",
    accountSelection: { mode: "automatic", accountPolicyId: "account-policy" },
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
const globalConfig = {
  version: "2" as const,
  executionCatalog,
  executionRouting: { defaultRouteId: "codex-route" },
  modelGateway,
};
const neverShutdown = new Promise<void>(() => undefined);

describe("modelGatewayCommand", () => {
  let root: string | undefined;
  afterEach(async () => { vi.restoreAllMocks(); if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

  it("serves only the dedicated listener with deterministic identity and state path", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-cli-"));
    const configPath = join(root, "gateway.yaml");
    await writeFile(configPath, yaml, "utf8");
    const start = vi.fn(async (_options: StartModelGatewayListenerOptions) => ({ close: vi.fn(async () => undefined), shutdownRequested: neverShutdown }));
    const registerShutdown = vi.fn();
    const log = vi.fn();

    await modelGatewayCommand(["serve", "--config", configPath], {
      startModelGatewayListener: start,
      inspectModelGatewayListener: vi.fn(),
      readGlobalConfig: () => globalConfig,
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
    await registerShutdown.mock.calls[0]![0]!();
  });

  it("passes the canonical execution bundle to the foreground listener", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-cli-bundle-"));
    const configPath = join(root, "gateway.yaml");
    await writeFile(configPath, yaml, "utf8");
    const start = vi.fn(async (_options: StartModelGatewayListenerOptions) => ({ close: vi.fn(async () => undefined), shutdownRequested: neverShutdown }));
    const registerShutdown = vi.fn();

    await modelGatewayCommand(["serve", "--config", configPath], {
      startModelGatewayListener: start,
      readGlobalConfig: () => globalConfig,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      pid: 99,
      registerShutdown,
      log: vi.fn(),
    });

    const options = start.mock.calls[0]![0];
    expect(options.executionCatalog).toBe(executionCatalog);
    expect(options.executionRouting.admit({ routeId: "codex-route" })).toMatchObject({
      routeId: "codex-route",
      providerId: "codex-oauth",
      providerModelId: "model",
    });
    expect(options.executionCandidates).toBeDefined();
    expect(options.accountCapacityAuthority).toBeDefined();
    await registerShutdown.mock.calls[0]![0]!();
  });

  it("closes execution authority only after listener shutdown settles", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-cli-close-"));
    const configPath = join(root, "gateway.yaml");
    await writeFile(configPath, yaml, "utf8");
    let releaseListener!: () => void;
    const listenerClose = vi.fn(() => new Promise<void>((resolve) => { releaseListener = resolve; }));
    const authorityClose = vi.spyOn(SqliteManagedAccountLeaseAuthority.prototype, "close");
    const registerShutdown = vi.fn();

    await modelGatewayCommand(["serve", "--config", configPath], {
      startModelGatewayListener: vi.fn(async () => ({ close: listenerClose, shutdownRequested: neverShutdown })),
      readGlobalConfig: () => globalConfig,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      registerShutdown,
      log: vi.fn(),
    });

    const shutdown = registerShutdown.mock.calls[0]![0]!();
    expect(listenerClose).toHaveBeenCalledOnce();
    expect(authorityClose).not.toHaveBeenCalled();
    releaseListener();
    await shutdown;
    expect(authorityClose).toHaveBeenCalledOnce();
  });

  it("keeps serve pending until shutdown and resource close complete", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-cli-lifetime-"));
    const configPath = join(root, "gateway.yaml");
    await writeFile(configPath, yaml, "utf8");
    const listenerClose = vi.fn(async () => undefined);
    let shutdown!: () => Promise<void>;
    const registerShutdown = vi.fn((close: () => Promise<void>) => new Promise<void>((resolve) => {
      shutdown = async () => {
        await close();
        resolve();
      };
    }));
    let settled = false;

    const serving = modelGatewayCommand(["serve", "--config", configPath], {
      startModelGatewayListener: vi.fn(async () => ({ close: listenerClose, shutdownRequested: neverShutdown })),
      readGlobalConfig: () => globalConfig,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      registerShutdown,
      log: vi.fn(),
    }).finally(() => { settled = true; });
    await vi.waitFor(() => expect(registerShutdown).toHaveBeenCalledOnce());

    expect(settled).toBe(false);
    await shutdown();
    await serving;
    expect(listenerClose).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
  });

  it("passes the same explicit execution bundle to the global runtime listener", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-global-bundle-"));
    const start = vi.fn(async (_options: StartModelGatewayListenerOptions) => ({ close: vi.fn(async () => undefined), shutdownRequested: neverShutdown }));
    const registerShutdown = vi.fn();

    await modelGatewayCommand(["serve", "--global-runtime", "--instance-id", "global-1"], {
      startModelGatewayListener: start,
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      pid: 100,
      registerShutdown,
      log: vi.fn(),
    });

    const options = start.mock.calls[0]![0];
    expect(options.executionCatalog).toBe(executionCatalog);
    expect(options.executionRouting.admit({ routeId: "codex-route" }).routeId).toBe("codex-route");
    expect(options.databasePath).toBe(join(root, "runtime", "economic-authority", "managed-account-leases.sqlite"));
    await registerShutdown.mock.calls[0]![0]!();
  });

  it("fails closed before starting a listener when global execution authority is incomplete", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-missing-execution-"));
    const configPath = join(root, "gateway.yaml");
    await writeFile(configPath, yaml, "utf8");
    const start = vi.fn(async (_options: StartModelGatewayListenerOptions) => ({ close: vi.fn(async () => undefined), shutdownRequested: neverShutdown }));

    await expect(modelGatewayCommand(["serve", "--config", configPath], {
      startModelGatewayListener: start,
      readGlobalConfig: () => ({ version: "2", modelGateway }),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      log: vi.fn(),
    })).rejects.toThrow("executionCatalog and executionRouting");
    expect(start).not.toHaveBeenCalled();
  });

  it.each(["start", "ensure", "stop", "restart", "status"] as const)("dispatches %s against the user-scoped supervisor without --config", async (command) => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-global-"));
    const log = vi.fn();
    const methods = { start: vi.fn(), ensure: vi.fn(), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() };
    methods[command].mockResolvedValue({ state: "stopped" });

    await modelGatewayCommand([command, "--json"], {
      readGlobalConfig: () => globalConfig,
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
      readGlobalConfig: () => globalConfig, resolveGlobalConfigPath: () => join(root!, "config.yaml"),
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
      readGlobalConfig: () => globalConfig,
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

  it("uninstalls only an owned service and its exact runtime directory", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-uninstall-"));
    const stop = vi.fn(async () => ({ state: "stopped" as const }));
    const uninstall = vi.fn(async () => ({ state: "absent" as const }));
    const removeRuntimeDir = vi.fn(async () => undefined);
    const syncOpenCodeNativeProjection = vi.fn(async () => ({ operation: "uninstall" as const, changed: true, targetPath: "opencode.json" }));
    const log = vi.fn();

    await modelGatewayCommand(["uninstall", "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(), stop, restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      createAutostartAdapter: () => ({ status: vi.fn(async () => ({ state: "installed" as const, digest: "a".repeat(64) })), install: vi.fn(), uninstall }),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      syncOpenCodeNativeProjection,
      removeRuntimeDir,
      log,
    });

    expect(syncOpenCodeNativeProjection).toHaveBeenCalledWith(expect.objectContaining({ config: modelGateway, operation: "uninstall" }));
    expect(stop).toHaveBeenCalledOnce();
    expect(uninstall).toHaveBeenCalledOnce();
    expect(removeRuntimeDir).toHaveBeenCalledWith(join(root, "runtime", "model-gateway"));
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({ state: "uninstalled" });
  });

  it("refuses exact uninstall when the scheduled task is foreign", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-uninstall-foreign-"));
    const stop = vi.fn();
    const removeRuntimeDir = vi.fn();

    await modelGatewayCommand(["uninstall", "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(), stop, restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      createAutostartAdapter: () => ({ status: vi.fn(async () => ({ state: "foreign" as const })), install: vi.fn(), uninstall: vi.fn() }),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      removeRuntimeDir,
      log: vi.fn(),
    });

    expect(stop).not.toHaveBeenCalled();
    expect(removeRuntimeDir).not.toHaveBeenCalled();
  });

  it("preserves the native projection when the running gateway is foreign", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-uninstall-foreign-runtime-"));
    const syncOpenCodeNativeProjection = vi.fn();
    const removeRuntimeDir = vi.fn();

    await modelGatewayCommand(["uninstall", "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(), stop: vi.fn(async () => ({ state: "foreign" as const, reason: "ownership-mismatch" as const })), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      createAutostartAdapter: () => ({ status: vi.fn(async () => ({ state: "absent" as const })), install: vi.fn(), uninstall: vi.fn() }),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      syncOpenCodeNativeProjection,
      removeRuntimeDir,
      log: vi.fn(),
    });

    expect(syncOpenCodeNativeProjection).not.toHaveBeenCalled();
    expect(removeRuntimeDir).not.toHaveBeenCalled();
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
      readGlobalConfig: () => globalConfig, resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure, stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      syncOpenCodeNativeProjection,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) }, version: "3.0.0-test", execPath: "bun", entrypoint: "cli.js", log: vi.fn(),
    });

    expect(ensure).toHaveBeenCalledOnce();
    expect(syncOpenCodeNativeProjection).toHaveBeenCalledWith(expect.objectContaining({ config: modelGateway, listener: gatewayReady.identity, operation: "install" }));
  });

  it("requires an explicit flag to adopt a pre-existing provider and forwards that authority", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-adopt-native-"));
    const gatewayReady = { state: "ready" as const, identity: { service: "kiln-model-gateway" as const, status: "ready" as const, protocolVersion: 1 as const, instanceId: "owned", pid: 44, version: "3.0.0-test", configDigest: "a".repeat(64), port: 4819 } };
    const syncOpenCodeNativeProjection = vi.fn(async () => ({ operation: "install" as const, changed: true, targetPath: "opencode.json" }));

    await modelGatewayCommand(["sync-native", "--client", "opencode", "--adopt-existing"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(async () => gatewayReady), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      syncOpenCodeNativeProjection,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      entrypoint: "cli.js",
      log: vi.fn(),
    });

    expect(syncOpenCodeNativeProjection).toHaveBeenCalledWith(expect.objectContaining({ operation: "install", adoptExisting: true }));
  });

  it("removes an owned native provider without starting the gateway", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-uninstall-native-"));
    const ensure = vi.fn();
    const syncOpenCodeNativeProjection = vi.fn(async () => ({ operation: "uninstall" as const, changed: true, targetPath: "opencode.json" }));

    await modelGatewayCommand(["sync-native", "--client", "opencode", "--uninstall"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure, stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      syncOpenCodeNativeProjection,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      entrypoint: "cli.js",
      log: vi.fn(),
    });

    expect(ensure).not.toHaveBeenCalled();
    expect(syncOpenCodeNativeProjection).toHaveBeenCalledWith(expect.objectContaining({ operation: "uninstall" }));
  });

  it("does not write a native projection when ensure is not ready", async () => {
    const syncOpenCodeNativeProjection = vi.fn();
    await expect(modelGatewayCommand(["sync-native", "--client", "opencode"], {
      readGlobalConfig: () => globalConfig, createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(async () => ({ state: "foreign", reason: "identity-mismatch" })), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      syncOpenCodeNativeProjection, env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) }, entrypoint: "cli.js",
    })).rejects.toThrow("not owned and ready");
    expect(syncOpenCodeNativeProjection).not.toHaveBeenCalled();
  });
});
