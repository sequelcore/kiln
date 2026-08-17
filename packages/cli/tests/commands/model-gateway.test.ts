import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineExecutionCatalog } from "@kilnai/core/agents";
import { parseGatewayYaml } from "@kilnai/core/engine";
import { SqliteManagedAccountLeaseAuthority, type StartModelGatewayListenerOptions } from "@kilnai/runtime";
import { modelGatewayCommand as runModelGatewayCommand } from "../../src/commands/model-gateway.js";
import type { ResolvedModelGatewayHost } from "../../src/application/model-gateway-host.js";

const TEST_MODEL_GATEWAY_HOST: ResolvedModelGatewayHost = {
  executable: "C:\\kiln-test\\bun.exe",
  source: "bundled",
  host: {
    schemaVersion: 1,
    runtimeKind: "bun",
    version: "1.4.0",
    revision: "1.4.0-canary.1+test",
    provenance: "test-fixture",
    sha256: "a".repeat(64),
    platform: "win32",
    arch: "x64",
    packageName: "@kilnai/model-gateway-host",
    source: "bundled",
  },
};

function modelGatewayCommand(
  args: readonly string[],
  overrides: Parameters<typeof runModelGatewayCommand>[1] = {},
): Promise<void> {
  return runModelGatewayCommand(args, {
    resolveModelGatewayHost: async () => TEST_MODEL_GATEWAY_HOST,
    inspectCodexNativeClient: () => ({ executable: "codex.exe", version: "0.147.0", nativeCatalog: { models: [{ slug: "gpt-native" }] } }),
    createAutostartAdapter: () => ({
      status: async () => ({ state: "absent" as const }),
      install: async () => ({ state: "installed" as const, digest: "a".repeat(64) }),
      uninstall: async () => ({ state: "absent" as const }),
    }),
    ...overrides,
  });
}

const yaml = `port: 4800
apps: []
modelGateway:
  port: 4819
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_SECRET }
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } }
  principals:
    - { tokenEnv: BEARER_TOKEN, ingress: openai-responses, tenantId: tenant, applicationId: app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [codex] }
  virtualModels:
    - { id: codex, displayName: Codex, contextTokens: 1000, outputTokens: 100, targetId: codex-route, capabilities: [text], affinity: { continuity: none } }
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
    dataClassification: "internal",
    dataPolicyEvidence: { providerId: "codex-oauth", providerModelId: "model", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-09-01T00:00:00.000Z" },
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
  version: "3" as const,
  targetCatalog: {
    accounts: executionCatalog.accounts,
    accountPolicies: executionCatalog.accountPolicies,
    targets: executionCatalog.routes.map((route) => ({ ...route, kind: "direct" as const })),
  },
  targetRouting: { defaultTargetId: "codex-route" },
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
    const order: string[] = [];
    const recover = vi.spyOn(SqliteManagedAccountLeaseAuthority.prototype, "recoverAccountCapacity")
      .mockImplementation(() => { order.push("recover"); return []; });
    const start = vi.fn(async (_options: StartModelGatewayListenerOptions) => {
      order.push("listen");
      return { close: vi.fn(async () => undefined), shutdownRequested: neverShutdown };
    });
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
    expect(options.executionCatalog).toStrictEqual(executionCatalog);
    expect(options.executionRouting.admit({ routeId: "codex-route" })).toMatchObject({
      routeId: "codex-route",
      providerId: "codex-oauth",
      providerModelId: "model",
    });
    expect(options.executionCandidates).toBeDefined();
    expect(options.accountCapacityAuthority).toBeDefined();
    expect(recover).toHaveBeenCalledOnce();
    expect(order).toEqual(["recover", "listen"]);
    await registerShutdown.mock.calls[0]![0]!();
  });

  it("closes the capacity authority and never opens the listener when startup recovery fails", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-cli-recovery-failure-"));
    const configPath = join(root, "gateway.yaml");
    await writeFile(configPath, yaml, "utf8");
    const close = vi.spyOn(SqliteManagedAccountLeaseAuthority.prototype, "close");
    vi.spyOn(SqliteManagedAccountLeaseAuthority.prototype, "recoverAccountCapacity")
      .mockImplementation(() => { throw new Error("retained capacity evidence is corrupt"); });
    const start = vi.fn();

    await expect(modelGatewayCommand(["serve", "--config", configPath], {
      startModelGatewayListener: start,
      readGlobalConfig: () => globalConfig,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      registerShutdown: vi.fn(),
      log: vi.fn(),
    })).rejects.toThrow("retained capacity evidence is corrupt");

    expect(start).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
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
    expect(options.executionCatalog).toStrictEqual(executionCatalog);
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
      readGlobalConfig: () => ({ version: "3", modelGateway }),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      log: vi.fn(),
    })).rejects.toThrow("targetCatalog and targetRouting");
    expect(start).not.toHaveBeenCalled();
  });

  it.each(["start", "ensure", "restart", "status"] as const)("dispatches %s against the user-scoped supervisor without --config", async (command) => {
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
      entrypoint: "cli.js",
      log,
    });

    expect(methods[command]).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({ state: "stopped" });
  });

  it("keeps status read-only even when an owned autostart task is drifted", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-status-readonly-"));
    const install = vi.fn();
    await modelGatewayCommand(["status", "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({
        start: vi.fn(), ensure: vi.fn(), stop: vi.fn(), restart: vi.fn(), doctor: vi.fn(),
        status: vi.fn(async () => ({ state: "ready" as const, identity: { service: "kiln-model-gateway" as const, status: "ready" as const, protocolVersion: 1 as const, instanceId: "owned", pid: 44, version: "3.0.0-test", configDigest: "a".repeat(64), port: 4819 } })),
      }),
      createAutostartAdapter: () => ({ status: vi.fn(async () => ({ state: "installed" as const, digest: "b".repeat(64) })), install, uninstall: vi.fn() }),
      env: { BEARER_TOKEN: "b".repeat(32) },
      entrypoint: "cli.js",
      log: vi.fn(),
    });
    expect(install).not.toHaveBeenCalled();
  });

  it("stops only when every listener-dependent native projection is absent", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-stop-"));
    const stop = vi.fn(async () => ({ state: "stopped" as const }));
    const log = vi.fn();

    await modelGatewayCommand(["stop", "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(), stop, restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      hasListenerDependentNativeProjection: () => false,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      log,
    });

    expect(stop).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({ state: "stopped" });
  });

  it("refuses to strand any native client by stopping an installed listener-dependent projection", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-stop-projected-"));
    const stop = vi.fn();

    await expect(modelGatewayCommand(["stop", "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(), stop, restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      hasListenerDependentNativeProjection: () => true,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      log: vi.fn(),
    })).rejects.toThrow("listener-dependent native projection is installed");

    expect(stop).not.toHaveBeenCalled();
  });

  it("serializes stop behind native install and rechecks projection ownership before stopping", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-stop-install-race-"));
    let releaseEnsure!: () => void;
    let ensureStarted!: () => void;
    const observedEnsure = new Promise<void>((resolve) => { ensureStarted = resolve; });
    const ensureGate = new Promise<void>((resolve) => { releaseEnsure = resolve; });
    const gatewayReady = { state: "ready" as const, identity: { service: "kiln-model-gateway" as const, status: "ready" as const, protocolVersion: 1 as const, instanceId: "owned", pid: 44, version: "3.0.0-test", configDigest: "a".repeat(64), port: 4819 } };
    let installed = false;
    const stop = vi.fn(async () => ({ state: "stopped" as const }));
    const dependencies = {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({
        start: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn(), stop,
        ensure: vi.fn(async () => { ensureStarted(); await ensureGate; return gatewayReady; }),
      }),
      syncClaudeNativeProjection: vi.fn(async () => { installed = true; return { operation: "install" as const, changed: true, targetPaths: ["settings.json"] }; }),
      hasListenerDependentNativeProjection: () => installed,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      log: vi.fn(),
    };
    const installing = modelGatewayCommand(["sync-native", "--client", "claude"], dependencies);
    await observedEnsure;
    const stopping = modelGatewayCommand(["stop"], dependencies);
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
    releaseEnsure();
    await installing;

    await expect(stopping).rejects.toThrow("listener-dependent native projection is installed");
    expect(stop).not.toHaveBeenCalled();
  });

  it("runs doctor through the same global supervisor", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-doctor-"));
    const doctor = vi.fn(async () => ({ status: { state: "stopped" as const }, stateFile: "absent" as const, configDigest: "a".repeat(64), version: "3.0.0-test", host: { desired: TEST_MODEL_GATEWAY_HOST.host, observed: undefined }, diagnostics: [] }));
    const log = vi.fn();
    await modelGatewayCommand(["doctor", "--json"], {
      readGlobalConfig: () => globalConfig, resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor }),
      env: { BEARER_TOKEN: "b".repeat(32) }, version: "3.0.0-test", entrypoint: "cli.js", log,
    });
    expect(doctor).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({ status: { state: "stopped" }, diagnostics: [] });
  });

  it("reports native wire compatibility and the upstream Desktop history limitation without claiming a Desktop version", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-doctor-codex-"));
    const log = vi.fn();
    await modelGatewayCommand(["doctor", "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({
        start: vi.fn(), ensure: vi.fn(), stop: vi.fn(), restart: vi.fn(), status: vi.fn(),
        doctor: vi.fn(async () => ({ status: { state: "stopped" as const }, stateFile: "absent" as const, configDigest: "a".repeat(64), version: "3.0.0-test", host: { desired: TEST_MODEL_GATEWAY_HOST.host, observed: undefined }, diagnostics: [] })),
      }),
      hasCodexNativeProjection: () => true,
      inspectCodexNativeClient: () => ({ executable: "codex.exe", version: "0.147.0", nativeCatalog: { models: [{ slug: "native" }] } }),
      env: { BEARER_TOKEN: "b".repeat(32) },
      entrypoint: "cli.js",
      log,
    });

    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      diagnostics: ["codex-desktop-custom-provider-history-unobservable"],
      nativeClients: [{
        harness: "codex",
        observedVersion: "0.147.0",
        compatibility: { status: "compatible", protocolRevision: "codex-0.147.0" },
        desktopHistory: { status: "unobservable", diagnostic: "codex-desktop-custom-provider-history-unobservable" },
      }],
    });
  });

  it("runs an explicit content-free app-server thread continuity proof without resolving the Gateway host", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-thread-continuity-"));
    const resolveModelGatewayHost = vi.fn();
    const runCodexThreadContinuity = vi.fn(async () => ({
      protocol: "codex-app-server-v2" as const,
      pagesRead: 1,
      itemsRead: 4,
      providerCounts: { kiln: 4 },
      truncated: false,
      resume: null,
    }));
    const log = vi.fn();
    await modelGatewayCommand(["thread-continuity", "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      resolveModelGatewayHost,
      runCodexThreadContinuity,
      inspectCodexNativeClient: () => ({ executable: "C:\\Codex\\codex.exe", version: "0.147.0", nativeCatalog: { models: [{ slug: "native" }] } }),
      log,
    });
    expect(runCodexThreadContinuity).toHaveBeenCalledWith("C:\\Codex\\codex.exe");
    expect(resolveModelGatewayHost).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({ providerCounts: { kiln: 4 }, itemsRead: 4 });
  });

  it("lists retained gateway outcome incidents while the listener is running", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-incidents-"));
    const log = vi.fn();
    const status = vi.fn(async () => ({
      state: "ready" as const,
      identity: { service: "kiln-model-gateway" as const, status: "ready" as const, protocolVersion: 1 as const, instanceId: "instance", pid: 99, version: "3.0.0-test", configDigest: "a".repeat(64), port: 4819 },
    }));
    const readOutcomeIncidents = vi.fn(() => [{
      runtimeInvocationId: "gateway-attempt-1",
      dispatchFenceId: "gateway-fence-1",
      lifecycleState: "settlement-pending" as const,
      capacityState: "released" as const,
      route: { providerId: "opencode-go", providerModelId: "model", scope: "gateway" },
      settlement: { kind: "unknown" as const, reason: "terminal evidence unavailable", observedAt: "2026-08-13T08:00:00.000Z" },
    }]);
    await modelGatewayCommand(["outcome-incidents", "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(), stop: vi.fn(), restart: vi.fn(), status, doctor: vi.fn() }),
      readOutcomeIncidents,
      env: {},
      log,
    });

    expect(status).not.toHaveBeenCalled();
    expect(readOutcomeIncidents).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({ incidents: [{
      runtimeInvocationId: "gateway-attempt-1",
      dispatchFenceId: "gateway-fence-1",
      lifecycleState: "settlement-pending",
      capacityState: "released",
      route: { providerId: "opencode-go", providerModelId: "model", scope: "gateway" },
      settlement: { kind: "unknown", reason: "terminal evidence unavailable", observedAt: "2026-08-13T08:00:00.000Z" },
    }] });
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
      version: "3.0.0-test", entrypoint: "cli.js", userId: "operator", log: vi.fn(),
    };
    await modelGatewayCommand(["install-autostart", "--json"], base);
    expect(install).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 2,
      command: TEST_MODEL_GATEWAY_HOST.executable,
      args: ["cli.js", "model-gateway", "ensure"],
      version: "3.0.0-test",
      host: TEST_MODEL_GATEWAY_HOST.host,
    }));
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
    const syncCodexNativeProjection = vi.fn(async () => ({ operation: "uninstall" as const, changed: true, targetPath: "config.toml", catalogPath: "catalog.json" }));
    const syncClaudeNativeProjection = vi.fn(async () => ({ operation: "uninstall" as const, changed: true, targetPaths: ["settings.json"] }));
    const log = vi.fn();

    await modelGatewayCommand(["uninstall", "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(), stop, restart: vi.fn(), status: vi.fn(async () => ({ state: "ready" as const, identity: { service: "kiln-model-gateway" as const, status: "ready" as const, protocolVersion: 1 as const, instanceId: "owned", pid: 44, version: "3.0.0-test", configDigest: "a".repeat(64), port: 4819 } })), doctor: vi.fn() }),
      createAutostartAdapter: () => ({ status: vi.fn(async () => ({ state: "installed" as const, digest: "a".repeat(64) })), install: vi.fn(), uninstall }),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      syncOpenCodeNativeProjection,
      syncCodexNativeProjection,
      syncClaudeNativeProjection,
      removeRuntimeDir,
      log,
    });

    expect(syncOpenCodeNativeProjection).toHaveBeenCalledWith(expect.objectContaining({ config: modelGateway, operation: "uninstall" }));
    expect(syncCodexNativeProjection).toHaveBeenCalledWith(expect.objectContaining({ config: modelGateway, operation: "uninstall" }));
    expect(syncClaudeNativeProjection).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(uninstall).toHaveBeenCalledOnce();
    expect(removeRuntimeDir).toHaveBeenCalledWith(join(root, "runtime", "model-gateway"));
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({ state: "uninstalled" });
  });

  it.each(["codex", "claude", "opencode"] as const)("keeps the listener running when %s projection restoration fails", async (failingClient) => {
    root = await mkdtemp(join(tmpdir(), `kiln-model-gateway-uninstall-${failingClient}-failure-`));
    const stop = vi.fn(async () => ({ state: "stopped" as const }));
    const failure = new Error(`${failingClient} restore failed`);
    const syncCodexNativeProjection = vi.fn(async () => {
      if (failingClient === "codex") throw failure;
      return { operation: "uninstall" as const, changed: true, targetPath: "config.toml", catalogPath: "catalog.json" };
    });
    const syncClaudeNativeProjection = vi.fn(async () => {
      if (failingClient === "claude") throw failure;
      return { operation: "uninstall" as const, changed: true, targetPaths: ["settings.json"] };
    });
    const syncOpenCodeNativeProjection = vi.fn(async () => {
      if (failingClient === "opencode") throw failure;
      return { operation: "uninstall" as const, changed: true, targetPath: "opencode.json" };
    });

    await expect(modelGatewayCommand(["uninstall", "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({
        start: vi.fn(), ensure: vi.fn(), stop, restart: vi.fn(), doctor: vi.fn(),
        status: vi.fn(async () => ({ state: "ready" as const, identity: { service: "kiln-model-gateway" as const, status: "ready" as const, protocolVersion: 1 as const, instanceId: "owned", pid: 44, version: "3.0.0-test", configDigest: "a".repeat(64), port: 4819 } })),
      }),
      createAutostartAdapter: () => ({ status: vi.fn(async () => ({ state: "absent" as const })), install: vi.fn(), uninstall: vi.fn() }),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      syncCodexNativeProjection,
      syncClaudeNativeProjection,
      syncOpenCodeNativeProjection,
      removeRuntimeDir: vi.fn(),
      log: vi.fn(),
    })).rejects.toThrow(`${failingClient} restore failed`);

    expect(stop).not.toHaveBeenCalled();
  });

  it("restores projections without a principal secret when the listener is already stopped", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-uninstall-stopped-no-secret-"));
    const stop = vi.fn();
    const syncCodexNativeProjection = vi.fn(async () => ({ operation: "uninstall" as const, changed: false, targetPath: "config.toml", catalogPath: "catalog.json" }));
    const syncClaudeNativeProjection = vi.fn(async () => ({ operation: "uninstall" as const, changed: false, targetPaths: [] }));
    const syncOpenCodeNativeProjection = vi.fn(async () => ({ operation: "uninstall" as const, changed: false, targetPath: "opencode.json" }));

    await modelGatewayCommand(["uninstall", "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(), stop, restart: vi.fn(), doctor: vi.fn(), status: vi.fn(async () => ({ state: "stopped" as const })) }),
      createAutostartAdapter: () => ({ status: vi.fn(async () => ({ state: "absent" as const })), install: vi.fn(), uninstall: vi.fn() }),
      env: {},
      syncCodexNativeProjection,
      syncClaudeNativeProjection,
      syncOpenCodeNativeProjection,
      removeRuntimeDir: vi.fn(async () => undefined),
      log: vi.fn(),
    });

    expect(syncCodexNativeProjection).toHaveBeenCalledOnce();
    expect(syncClaudeNativeProjection).toHaveBeenCalledOnce();
    expect(syncOpenCodeNativeProjection).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
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
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(), stop: vi.fn(), restart: vi.fn(), status: vi.fn(async () => ({ state: "foreign" as const, reason: "ownership-mismatch" as const })), doctor: vi.fn() }),
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
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) }, version: "3.0.0-test", entrypoint: "cli.js", log: vi.fn(),
    });

    expect(ensure).toHaveBeenCalledOnce();
    expect(syncOpenCodeNativeProjection).toHaveBeenCalledWith(expect.objectContaining({ config: modelGateway, listener: gatewayReady.identity, operation: "install" }));
  });

  it("admits the exact native client before ensuring the gateway and synchronizes Codex", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-sync-codex-"));
    const codexGateway = { ...modelGateway, principals: modelGateway.principals.map((principal) => ({ ...principal, nativeHarness: "codex" as const })) };
    const codexGlobalConfig = { ...globalConfig, modelGateway: codexGateway };
    const gatewayReady = { state: "ready" as const, identity: { service: "kiln-model-gateway" as const, status: "ready" as const, protocolVersion: 1 as const, instanceId: "owned", pid: 44, version: "3.0.0-test", configDigest: "a".repeat(64), port: 4819 } };
    const order: string[] = [];
    const inspectCodexNativeClient = vi.fn(() => {
      order.push("inspect");
      return { executable: "codex.exe", version: "0.147.0", nativeCatalog: { models: [{ slug: "gpt-native" }] } };
    });
    const syncCodexNativeProjection = vi.fn(async () => ({ operation: "install" as const, changed: true, targetPath: "config.toml", catalogPath: "catalog.json" }));

    await modelGatewayCommand(["sync-native", "--client", "codex", "--json"], {
      readGlobalConfig: () => codexGlobalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(async () => { order.push("ensure"); return gatewayReady; }), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      inspectCodexNativeClient,
      syncCodexNativeProjection,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      entrypoint: "cli.js",
      log: vi.fn(),
    });

    expect(inspectCodexNativeClient).toHaveBeenCalledOnce();
    expect(order).toEqual(["inspect", "ensure"]);
    expect(syncCodexNativeProjection).toHaveBeenCalledWith(expect.objectContaining({
      config: codexGateway,
      listener: gatewayReady.identity,
      nativeCatalog: { models: [{ slug: "gpt-native" }] },
      operation: "install",
    }));
  });

  it("does not start the gateway or write Codex configuration for an unsupported native client", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-sync-codex-unsupported-"));
    const ensure = vi.fn();
    const resolveModelGatewayHost = vi.fn();
    const syncCodexNativeProjection = vi.fn();

    await expect(modelGatewayCommand(["sync-native", "--client", "codex"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure, stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      resolveModelGatewayHost,
      inspectCodexNativeClient: () => ({ executable: "codex.exe", version: "0.148.0", nativeCatalog: { models: [{ slug: "future" }] } }),
      syncCodexNativeProjection,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      entrypoint: "cli.js",
      log: vi.fn(),
    })).rejects.toThrow("not admitted");

    expect(ensure).not.toHaveBeenCalled();
    expect(resolveModelGatewayHost).not.toHaveBeenCalled();
    expect(syncCodexNativeProjection).not.toHaveBeenCalled();
  });

  it("synchronizes a project-scoped Claude projection through the owned global listener", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-sync-claude-"));
    const projectPath = join(root, "project");
    const gatewayReady = { state: "ready" as const, identity: { service: "kiln-model-gateway" as const, status: "ready" as const, protocolVersion: 1 as const, instanceId: "owned", pid: 44, version: "3.0.0-test", configDigest: "a".repeat(64), port: 4819 } };
    const syncClaudeNativeProjection = vi.fn(async () => ({ operation: "install" as const, changed: true, targetPaths: [join(projectPath, ".claude", "settings.json")] }));

    await modelGatewayCommand(["sync-native", "--client", "claude", "--project", projectPath, "--json"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "home", ".kiln", "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(async () => gatewayReady), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      syncClaudeNativeProjection,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      log: vi.fn(),
    });

    expect(syncClaudeNativeProjection).toHaveBeenCalledWith(expect.objectContaining({
      config: modelGateway,
      listener: gatewayReady.identity,
      targetPath: join(projectPath, ".claude", "settings.json"),
      operation: "install",
    }));
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

  it("forwards explicit repair authority only for an owned native install", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-repair-native-"));
    const gatewayReady = { state: "ready" as const, identity: { service: "kiln-model-gateway" as const, status: "ready" as const, protocolVersion: 1 as const, instanceId: "owned", pid: 44, version: "3.0.0-test", configDigest: "a".repeat(64), port: 4819 } };
    const syncOpenCodeNativeProjection = vi.fn(async () => ({ operation: "install" as const, changed: true, targetPath: "opencode.json" }));

    await modelGatewayCommand(["sync-native", "--client", "opencode", "--force"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(async () => gatewayReady), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      syncOpenCodeNativeProjection,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) },
      entrypoint: "cli.js",
      log: vi.fn(),
    });

    expect(syncOpenCodeNativeProjection).toHaveBeenCalledWith(expect.objectContaining({ operation: "install", force: true }));
    await expect(modelGatewayCommand(["sync-native", "--client", "opencode", "--uninstall", "--force"], {
      readGlobalConfig: () => globalConfig,
    })).rejects.toThrow("only with sync-native install");
  });

  it("removes an owned native provider without starting the gateway", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-uninstall-native-"));
    const ensure = vi.fn();
    const resolveModelGatewayHost = vi.fn();
    const syncOpenCodeNativeProjection = vi.fn(async () => ({ operation: "uninstall" as const, changed: true, targetPath: "opencode.json" }));

    await modelGatewayCommand(["sync-native", "--client", "opencode", "--uninstall"], {
      readGlobalConfig: () => globalConfig,
      resolveGlobalConfigPath: () => join(root!, "config.yaml"),
      createSupervisor: () => ({ start: vi.fn(), ensure, stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      resolveModelGatewayHost,
      syncOpenCodeNativeProjection,
      env: {},
      entrypoint: "cli.js",
      log: vi.fn(),
    });

    expect(ensure).not.toHaveBeenCalled();
    expect(resolveModelGatewayHost).not.toHaveBeenCalled();
    expect(syncOpenCodeNativeProjection).toHaveBeenCalledWith(expect.objectContaining({ operation: "uninstall" }));
  });

  it("does not write a native projection when ensure is not ready", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-not-ready-"));
    const syncOpenCodeNativeProjection = vi.fn();
    await expect(modelGatewayCommand(["sync-native", "--client", "opencode"], {
      readGlobalConfig: () => globalConfig, resolveGlobalConfigPath: () => join(root!, "config.yaml"), createSupervisor: () => ({ start: vi.fn(), ensure: vi.fn(async () => ({ state: "foreign" as const, reason: "identity-mismatch" })), stop: vi.fn(), restart: vi.fn(), status: vi.fn(), doctor: vi.fn() }),
      syncOpenCodeNativeProjection, env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32) }, entrypoint: "cli.js",
    })).rejects.toThrow("not owned and ready");
    expect(syncOpenCodeNativeProjection).not.toHaveBeenCalled();
  });
});
