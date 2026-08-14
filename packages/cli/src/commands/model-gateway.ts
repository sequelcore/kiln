import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { userInfo } from "node:os";
import { parseGatewayYaml, type ModelGatewayConfig } from "@kilnai/core";
import {
  ConfiguredExecutionAccountRuntime,
  ModelGatewaySupervisor,
  readAccountOutcomeIncidents,
  SqliteManagedAccountLeaseAuthority,
  WindowsModelGatewayAutostartAdapter,
  createModelGatewayExecutionRoutingPort,
  createModelGatewayConfigDigest,
  inspectModelGatewayListener,
  requestModelGatewayShutdown,
  startModelGatewayListener,
  type ModelGatewayLaunchDescriptor,
  type ModelGatewayAutostartStatus,
  type ModelGatewaySupervisorDoctor,
  type ModelGatewaySupervisorStatus,
  type ModelGatewayExecutionBundle,
  type AccountOutcomeIncident,
  type StartModelGatewayListenerOptions,
} from "@kilnai/runtime";
import pkg from "../../package.json" with { type: "json" };
import { readGlobalConfig, resolveGlobalConfigPath, resolveGlobalModelGatewayConfig, type KilnGlobalConfig } from "../config/global-config.js";
import { resolveGlobalEconomicAuthorityDatabasePath } from "../config/global-economic-authority.js";
import { syncGlobalOpenCodeModelGatewayProjection, type GlobalOpenCodeModelGatewayProjectionResult } from "../config/global-opencode-model-gateway-projection.js";
import {
  syncGlobalCodexModelGatewayProjection,
  GLOBAL_CODEX_MODEL_GATEWAY_TARGET_ID,
  type CodexNativeCatalog,
} from "../config/global-codex-model-gateway-projection.js";
import {
  hasGlobalClaudeModelGatewayProjection,
  syncGlobalClaudeModelGatewayProjection,
  type GlobalClaudeModelGatewayProjectionResult,
} from "../config/global-claude-model-gateway-projection.js";
import { readNativeProjectionInstallState } from "../config/native-projection-state.js";
import { withGlobalNativeProjectionLock } from "../config/global-native-projection-lock.js";

interface SupervisorSurface {
  start(): Promise<ModelGatewaySupervisorStatus>;
  ensure(): Promise<ModelGatewaySupervisorStatus>;
  stop(): Promise<ModelGatewaySupervisorStatus>;
  restart(): Promise<ModelGatewaySupervisorStatus>;
  status(): Promise<ModelGatewaySupervisorStatus>;
  doctor(): Promise<ModelGatewaySupervisorDoctor>;
}
interface AutostartSurface { install(launch: ModelGatewayLaunchDescriptor): Promise<ModelGatewayAutostartStatus>; uninstall(): Promise<ModelGatewayAutostartStatus>; status(): Promise<ModelGatewayAutostartStatus>; }
interface ModelGatewayCommandDependencies {
  readonly startModelGatewayListener: (options: StartModelGatewayListenerOptions) => Promise<{ close(): Promise<void>; readonly shutdownRequested: Promise<void> }>;
  readonly inspectModelGatewayListener: typeof inspectModelGatewayListener;
  readonly readGlobalConfig: () => KilnGlobalConfig | null;
  readonly resolveGlobalConfigPath: () => string;
  readonly createSupervisor: (input: ConstructorParameters<typeof ModelGatewaySupervisor>[0]) => SupervisorSurface;
  readonly createAutostartAdapter: (input: { readonly runtimeDir: string; readonly userId: string }) => AutostartSurface;
  readonly userId: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly version: string;
  readonly pid: number;
  readonly execPath: string;
  readonly entrypoint: string;
  readonly registerShutdown: (close: () => Promise<void>, shutdownRequested: Promise<void>) => Promise<void>;
  readonly syncOpenCodeNativeProjection: typeof syncGlobalOpenCodeModelGatewayProjection;
  readonly syncCodexNativeProjection: typeof syncGlobalCodexModelGatewayProjection;
  readonly syncClaudeNativeProjection: typeof syncGlobalClaudeModelGatewayProjection;
  readonly readCodexNativeCatalog: () => CodexNativeCatalog;
  readonly hasListenerDependentNativeProjection: (installStateDir: string) => boolean;
  readonly projectPath: string;
  readonly readOutcomeIncidents: (databasePath: string) => readonly AccountOutcomeIncident[];
  readonly removeRuntimeDir: (path: string) => Promise<void>;
  readonly log: (message: string) => void;
}

const defaultDependencies: ModelGatewayCommandDependencies = {
  startModelGatewayListener,
  inspectModelGatewayListener,
  readGlobalConfig,
  resolveGlobalConfigPath,
  createSupervisor: (input) => new ModelGatewaySupervisor(input),
  createAutostartAdapter: (input) => new WindowsModelGatewayAutostartAdapter(input),
  userId: resolveCurrentUserId(),
  env: process.env,
  version: pkg.version,
  pid: process.pid,
  execPath: process.execPath,
  entrypoint: process.argv[1] ?? "",
  registerShutdown: registerProcessShutdown,
  syncOpenCodeNativeProjection: syncGlobalOpenCodeModelGatewayProjection,
  syncCodexNativeProjection: syncGlobalCodexModelGatewayProjection,
  syncClaudeNativeProjection: syncGlobalClaudeModelGatewayProjection,
  readCodexNativeCatalog: readCodexNativeCatalog,
  hasListenerDependentNativeProjection: (installStateDir) => (
    Boolean(readNativeProjectionInstallState(installStateDir).targets[GLOBAL_CODEX_MODEL_GATEWAY_TARGET_ID])
    || hasGlobalClaudeModelGatewayProjection(installStateDir)
  ),
  projectPath: process.cwd(),
  readOutcomeIncidents: (databasePath) => readAccountOutcomeIncidents({
      path: databasePath,
      participantKind: "model-gateway-ingress",
      recoveryDomain: "model-gateway",
    }),
  removeRuntimeDir: (path) => rm(path, { recursive: true, force: true }),
  log: console.log,
};

export async function modelGatewayCommand(args: readonly string[], overrides: Partial<ModelGatewayCommandDependencies> = {}): Promise<void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const subcommand = args[0];
  if (subcommand === "--help" || subcommand === "-h" || subcommand === undefined) { printHelp(dependencies.log); return; }
  const supported = new Set(["serve", "start", "ensure", "stop", "restart", "status", "doctor", "install-autostart", "uninstall", "uninstall-autostart", "autostart-status", "sync-native", "outcome-incidents"]);
  if (!supported.has(subcommand)) throw new Error(`Unknown model-gateway command '${subcommand}'.`);
  const flags = parseFlags(args.slice(1));
  if (flags.help) { printHelp(dependencies.log); return; }
  if (flags.adoptExisting && subcommand !== "sync-native") {
    throw new Error("--adopt-existing is valid only with sync-native.");
  }
  if (flags.force && (subcommand !== "sync-native" || flags.uninstall)) {
    throw new Error("--force is valid only with sync-native install.");
  }
  if (flags.projectPath && subcommand !== "sync-native" && subcommand !== "uninstall") {
    throw new Error("--project is valid only with sync-native or uninstall.");
  }

  if (subcommand === "serve" && flags.configPath) {
    await serveDevelopmentConfig(resolve(flags.configPath), dependencies);
    return;
  }
  if (subcommand !== "serve" && (flags.configPath || flags.globalRuntime || flags.instanceId)) throw new Error(`${subcommand} resolves modelGateway only from the global Kiln config.`);

  const runtimeDir = join(dirname(dependencies.resolveGlobalConfigPath()), "runtime", "model-gateway");
  const autostart = dependencies.createAutostartAdapter({ runtimeDir, userId: dependencies.userId });
  if (subcommand === "uninstall-autostart" || subcommand === "autostart-status") {
    const result = subcommand === "uninstall-autostart" ? await autostart.uninstall() : await autostart.status();
    printAutostartResult(result, flags.json, dependencies.log);
    return;
  }

  if (subcommand === "install-autostart") {
    const preflight = await autostart.status();
    if (preflight.state === "unsupported" || preflight.state === "foreign") {
      printAutostartResult(preflight, flags.json, dependencies.log);
      return;
    }
    const config = resolveGlobalModelGatewayConfig(dependencies.readGlobalConfig());
    const result = await autostart.install(resolveAutostartLaunchDescriptor(dependencies, config));
    printAutostartResult(result, flags.json, dependencies.log);
    return;
  }

  const globalConfig = dependencies.readGlobalConfig();
  const config = resolveGlobalModelGatewayConfig(globalConfig);
  const globalDir = dirname(dependencies.resolveGlobalConfigPath());
  const installStateDir = join(globalDir, "runtime", "native-projections");
  const projectPath = resolve(flags.projectPath ?? dependencies.projectPath);
  const claudeTargetPath = join(projectPath, ".claude", "settings.json");
  if (subcommand === "serve") {
    if (!flags.globalRuntime || !flags.instanceId) throw new Error("serve requires --config for development or the internal global runtime identity.");
    await serveGlobalRuntime(config, resolveGlobalEconomicAuthorityDatabasePath(dependencies.resolveGlobalConfigPath()), flags.instanceId, globalConfig, dependencies);
    return;
  }
  const token = ["doctor", "outcome-incidents", "uninstall"].includes(subcommand) || (subcommand === "sync-native" && flags.uninstall)
    ? resolveOptionalHealthToken(config, dependencies.env)
    : resolveHealthToken(config, dependencies.env);
  if (["start", "ensure", "restart"].includes(subcommand)) requireRuntimeSecrets(config, dependencies.env);
  const launch = resolveLaunchDescriptor(dependencies, config);
  const supervisor = dependencies.createSupervisor({
    config,
    runtimeDir,
    version: dependencies.version,
    env: dependencies.env,
    launch,
    inspect: (expected) => dependencies.inspectModelGatewayListener({ config, token, ...(expected ? { expected } : {}) }),
    requestShutdown: (identity) => requestModelGatewayShutdown({ config, token, identity }),
  });
  if (subcommand === "outcome-incidents") {
    if (globalConfig?.version !== "2") throw new Error("Model gateway outcome inspection requires global V2 execution authority.");
    const incidents = dependencies.readOutcomeIncidents(
      resolveGlobalEconomicAuthorityDatabasePath(dependencies.resolveGlobalConfigPath()),
    );
    dependencies.log(flags.json ? JSON.stringify({ incidents }) : formatOutcomeIncidents(incidents));
    return;
  }
  if (subcommand === "uninstall") {
    const autostartStatus = await autostart.status();
    if (autostartStatus.state === "foreign") {
      printAutostartResult(autostartStatus, flags.json, dependencies.log);
      return;
    }
    const uninstalled = await withGlobalNativeProjectionLock(installStateDir, async (lock) => {
      const runtimeStatus = await supervisor.status();
      if (runtimeStatus.state === "foreign") {
        printResult(runtimeStatus, flags.json, dependencies.log);
        return false;
      }
      await dependencies.syncCodexNativeProjection({
        config, env: dependencies.env, nativeCatalog: { models: [] },
        targetPath: join(dirname(globalDir), ".codex", "config.toml"),
        catalogPath: join(globalDir, "runtime", "native-projections", "codex-composite-models.json"),
        installStateDir, operation: "uninstall", lock,
      });
      await dependencies.syncClaudeNativeProjection({ config, installStateDir, operation: "uninstall", lock });
      await dependencies.syncOpenCodeNativeProjection({
        config, targetPath: join(dirname(globalDir), ".config", "opencode", "opencode.json"),
        installStateDir, operation: "uninstall", lock,
      });
      if (runtimeStatus.state !== "stopped") {
        const stopped = await supervisor.stop();
        if (stopped.state === "foreign") {
          printResult(stopped, flags.json, dependencies.log);
          return false;
        }
      }
      return true;
    });
    if (!uninstalled) return;
    if (autostartStatus.state === "installed") await autostart.uninstall();
    await dependencies.removeRuntimeDir(runtimeDir);
    dependencies.log(flags.json ? JSON.stringify({ state: "uninstalled" }) : "Model gateway: uninstalled");
    return;
  }
  if (subcommand === "sync-native") {
    if (flags.client !== "opencode" && flags.client !== "codex" && flags.client !== "claude") {
      throw new Error("sync-native requires --client codex, --client claude, or --client opencode.");
    }
    await withGlobalNativeProjectionLock(installStateDir, async (lock) => {
      const ensured = flags.uninstall ? undefined : await supervisor.ensure();
      if (ensured && ensured.state !== "ready") throw new Error("Model gateway is not owned and ready; native configuration was not modified.");
      const operation = flags.uninstall ? "uninstall" : "install";
      if (flags.client === "codex") {
        const result = await dependencies.syncCodexNativeProjection({
        config,
        ...(ensured ? { listener: ensured.identity } : {}),
        env: dependencies.env,
        nativeCatalog: operation === "install" ? dependencies.readCodexNativeCatalog() : { models: [] },
        targetPath: join(dirname(globalDir), ".codex", "config.toml"),
        catalogPath: join(installStateDir, "codex-composite-models.json"),
        installStateDir,
        operation,
        lock,
        ...(flags.adoptExisting ? { adoptExisting: true } : {}),
        ...(flags.force ? { force: true } : {}),
      });
        printNativeSyncResult({ ...result, client: "Codex" }, flags.json, dependencies.log);
      } else if (flags.client === "opencode") {
        const result = await dependencies.syncOpenCodeNativeProjection({
        config,
        ...(ensured ? { listener: ensured.identity } : {}),
        targetPath: join(dirname(globalDir), ".config", "opencode", "opencode.json"),
        installStateDir,
        operation,
        lock,
        ...(flags.adoptExisting ? { adoptExisting: true } : {}),
        ...(flags.force ? { force: true } : {}),
      });
        printNativeSyncResult({ ...result, client: "OpenCode" }, flags.json, dependencies.log);
      } else {
        const result = await dependencies.syncClaudeNativeProjection({
        config,
        ...(ensured ? { listener: ensured.identity } : {}),
        targetPath: claudeTargetPath,
        installStateDir,
        operation,
        lock,
        ...(flags.adoptExisting ? { adoptExisting: true } : {}),
        ...(flags.force ? { force: true } : {}),
      });
        printClaudeNativeSyncResult(result, flags.json, dependencies.log);
      }
    });
    return;
  }
  if (subcommand === "stop") {
    await withGlobalNativeProjectionLock(installStateDir, async () => {
      if (dependencies.hasListenerDependentNativeProjection(installStateDir)) {
        throw new Error("A listener-dependent native projection is installed; use restart to preserve service or uninstall to stop and restore native routing.");
      }
      printResult(await supervisor.stop(), flags.json, dependencies.log);
    });
    return;
  }
  const result = subcommand === "doctor"
    ? await supervisor.doctor()
    : await supervisor[subcommand as "start" | "ensure" | "stop" | "restart" | "status"]();
  printResult(result, flags.json, dependencies.log);
}

async function serveDevelopmentConfig(configPath: string, dependencies: ModelGatewayCommandDependencies): Promise<void> {
  const config = loadDevelopmentModelGateway(configPath);
  const globalConfig = dependencies.readGlobalConfig();
  const runtime = await startConfiguredModelGatewayListener(globalConfig, config, {
    config,
    databasePath: join(dirname(configPath), ".kiln", "model-gateway", "model-gateway.sqlite"),
    identity: { instanceId: `dev-${dependencies.pid}`, version: dependencies.version, configDigest: createModelGatewayConfigDigest(config), pid: dependencies.pid },
  }, dependencies);
  dependencies.log(`Development model gateway ready at http://127.0.0.1:${config.port}`);
  await dependencies.registerShutdown(runtime.close, runtime.shutdownRequested);
}

async function serveGlobalRuntime(config: ModelGatewayConfig, databasePath: string, instanceId: string, globalConfig: KilnGlobalConfig | null, dependencies: ModelGatewayCommandDependencies): Promise<void> {
  requireRuntimeSecrets(config, dependencies.env);
  const runtime = await startConfiguredModelGatewayListener(globalConfig, config, {
    config,
    databasePath,
    identity: { instanceId, version: dependencies.version, configDigest: createModelGatewayConfigDigest(config), pid: dependencies.pid },
  }, dependencies);
  dependencies.log(`Model gateway ready at http://127.0.0.1:${config.port}`);
  await dependencies.registerShutdown(runtime.close, runtime.shutdownRequested);
}

async function startConfiguredModelGatewayListener(
  globalConfig: KilnGlobalConfig | null,
  config: ModelGatewayConfig,
  listener: Pick<StartModelGatewayListenerOptions, "config" | "databasePath" | "identity">,
  dependencies: ModelGatewayCommandDependencies,
): Promise<{ close(): Promise<void>; readonly shutdownRequested: Promise<void> }> {
  const composition = createModelGatewayExecutionComposition(globalConfig, config, listener.databasePath, dependencies.env);
  let runtime: { close(): Promise<void>; readonly shutdownRequested: Promise<void> };
  try {
    runtime = await dependencies.startModelGatewayListener({
      ...listener,
      ...composition.bundle,
      env: dependencies.env,
    });
  } catch (error) {
    composition.close();
    throw error;
  }
  let closePromise: Promise<void> | undefined;
  return {
    shutdownRequested: runtime.shutdownRequested,
    close: () => closePromise ??= (async () => {
      try {
        await runtime.close();
      } finally {
        composition.close();
      }
    })(),
  };
}

function createModelGatewayExecutionComposition(
  globalConfig: KilnGlobalConfig | null,
  config: ModelGatewayConfig,
  databasePath: string,
  env: Readonly<Record<string, string | undefined>>,
): { readonly bundle: ModelGatewayExecutionBundle; close(): void } {
  if (globalConfig?.version !== "2" || !globalConfig.executionCatalog || !globalConfig.executionRouting) {
    throw new Error("Model gateway execution requires a global V2 config with executionCatalog and executionRouting.");
  }
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const accountRuntime = new ConfiguredExecutionAccountRuntime({
    catalog: globalConfig.executionCatalog,
    env,
  });
  const accountCapacityAuthority = new SqliteManagedAccountLeaseAuthority({
    path: databasePath,
    participantKind: "model-gateway-ingress",
    recoveryDomain: "model-gateway",
    configurationRevision: createModelGatewayExecutionConfigurationRevision(globalConfig, config),
  });
  try {
    accountCapacityAuthority.recoverAccountCapacity();
  } catch (error) {
    accountCapacityAuthority.close();
    throw error;
  }
  return {
    bundle: {
      executionCatalog: globalConfig.executionCatalog,
      executionRouting: createModelGatewayExecutionRoutingPort(globalConfig.executionCatalog),
      executionCandidates: accountRuntime.modelGatewayCandidates,
      executionDispatcher: accountRuntime.modelGatewayDispatchers,
      accountCapacityAuthority,
    },
    close: () => accountCapacityAuthority.close(),
  };
}

function createModelGatewayExecutionConfigurationRevision(globalConfig: KilnGlobalConfig, config: ModelGatewayConfig): string {
  return createHash("sha256")
    .update(JSON.stringify({ executionCatalog: globalConfig.executionCatalog, executionRouting: globalConfig.executionRouting, modelGateway: config }), "utf8")
    .digest("hex");
}

function resolveLaunchDescriptor(dependencies: ModelGatewayCommandDependencies, config: ModelGatewayConfig): ModelGatewayLaunchDescriptor {
  if (!dependencies.entrypoint) throw new Error("Cannot resolve the versioned Kiln CLI entrypoint for model gateway launch.");
  const mode = /(?:^|[\\/])(?:packages[\\/]cli[\\/]src|src)[\\/].*\.ts$/i.test(dependencies.entrypoint) ? "local-dev" : "installed";
  return {
    schemaVersion: 1,
    command: dependencies.execPath,
    args: [dependencies.entrypoint, "model-gateway", "serve", "--global-runtime"],
    mode,
    version: dependencies.version,
    requiredEnvNames: [...new Set([config.replay.hmacKeyEnv, ...config.principals.map((principal) => principal.tokenEnv)])].sort(),
  };
}

function resolveAutostartLaunchDescriptor(dependencies: ModelGatewayCommandDependencies, config: ModelGatewayConfig): ModelGatewayLaunchDescriptor {
  const launch = resolveLaunchDescriptor(dependencies, config);
  return { ...launch, args: [dependencies.entrypoint, "model-gateway", "ensure"] };
}

function loadDevelopmentModelGateway(configPath: string): ModelGatewayConfig {
  if (!existsSync(configPath)) throw new Error(`Gateway config not found: ${configPath}`);
  const parsed = parseGatewayYaml(readFileSync(configPath, "utf8"));
  if (!parsed.modelGateway) throw new Error(`Gateway config '${configPath}' does not declare modelGateway.`);
  return parsed.modelGateway;
}

function requireRuntimeSecrets(config: ModelGatewayConfig, env: Readonly<Record<string, string | undefined>>): void {
  const required = [...new Set([config.replay.hmacKeyEnv, ...config.principals.map((principal) => principal.tokenEnv)])];
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Missing model gateway environment values: ${missing.join(", ")}`);
}

function resolveHealthToken(config: ModelGatewayConfig, env: Readonly<Record<string, string | undefined>>): string {
  for (const principal of config.principals) { const value = env[principal.tokenEnv]; if (value) return value; }
  throw new Error("No configured model gateway principal token is available for status inspection.");
}

function resolveOptionalHealthToken(config: ModelGatewayConfig, env: Readonly<Record<string, string | undefined>>): string {
  return config.principals.map((principal) => env[principal.tokenEnv]).find((value): value is string => !!value) ?? "";
}

function parseFlags(args: readonly string[]): { readonly configPath?: string; readonly projectPath?: string; readonly json: boolean; readonly help: boolean; readonly globalRuntime: boolean; readonly instanceId?: string; readonly client?: string; readonly uninstall: boolean; readonly adoptExisting: boolean; readonly force: boolean } {
  let configPath: string | undefined; let projectPath: string | undefined; let json = false; let help = false; let globalRuntime = false; let instanceId: string | undefined; let client: string | undefined; let uninstall = false; let adoptExisting = false; let force = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--config") { const value = args[index + 1]; if (!value) throw new Error("--config requires a path."); configPath = value; index += 1; continue; }
    if (arg === "--project") { const value = args[index + 1]; if (!value) throw new Error("--project requires a path."); projectPath = value; index += 1; continue; }
    if (arg === "--instance-id") { const value = args[index + 1]; if (!value) throw new Error("--instance-id requires a value."); instanceId = value; index += 1; continue; }
    if (arg === "--global-runtime") { globalRuntime = true; continue; }
    if (arg === "--client") { const value = args[index + 1]; if (!value) throw new Error("--client requires a value."); client = value; index += 1; continue; }
    if (arg === "--uninstall") { uninstall = true; continue; }
    if (arg === "--adopt-existing") { adoptExisting = true; continue; }
    if (arg === "--force") { force = true; continue; }
    if (arg === "--json") { json = true; continue; }
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    throw new Error(`Unknown model-gateway option '${arg}'.`);
  }
  if (adoptExisting && uninstall) throw new Error("--adopt-existing cannot be combined with --uninstall.");
  return { ...(configPath === undefined ? {} : { configPath }), ...(projectPath === undefined ? {} : { projectPath }), ...(instanceId === undefined ? {} : { instanceId }), ...(client === undefined ? {} : { client }), json, help, globalRuntime, uninstall, adoptExisting, force };
}

function printNativeSyncResult(result: GlobalOpenCodeModelGatewayProjectionResult & { readonly client?: string }, json: boolean, log: (message: string) => void): void {
  if (json) { log(JSON.stringify(result)); return; }
  log(`${result.client ?? "Native"} model gateway projection: ${result.operation}${result.changed ? "ed" : " unchanged"} (${result.targetPath})`);
}

function printClaudeNativeSyncResult(result: GlobalClaudeModelGatewayProjectionResult, json: boolean, log: (message: string) => void): void {
  if (json) { log(JSON.stringify({ ...result, client: "Claude" })); return; }
  log(`Claude model gateway projection: ${result.operation}${result.changed ? "ed" : " unchanged"} (${result.targetPaths.join(", ") || "no targets"})`);
}

function formatOutcomeIncidents(incidents: readonly AccountOutcomeIncident[]): string {
  if (incidents.length === 0) return "Model gateway outcome incidents: none";
  return incidents.map((incident) =>
    `${incident.runtimeInvocationId}\t${incident.lifecycleState}\t${incident.capacityState}\t${incident.dispatchFenceId ?? "-"}\t${incident.route.providerId}/${incident.route.providerModelId}`
  ).join("\n");
}

function readCodexNativeCatalog(): CodexNativeCatalog {
  let output: string;
  try {
    output = execFileSync("codex", ["debug", "models", "--bundled"], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`Codex native model catalog could not be inspected: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(output); }
  catch { throw new Error("Codex native model catalog was not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { models?: unknown }).models)) {
    throw new Error("Codex native model catalog was empty or malformed.");
  }
  return parsed as CodexNativeCatalog;
}

function printResult(result: ModelGatewaySupervisorStatus | ModelGatewaySupervisorDoctor, json: boolean, log: (message: string) => void): void {
  if (json) { log(JSON.stringify(result)); return; }
  if ("diagnostics" in result) { log(`Model gateway doctor: ${result.status.state}; diagnostics: ${result.diagnostics.join(", ") || "none"}`); return; }
  if (result.state === "ready") { log(`Model gateway: ready (pid ${result.identity.pid}, instance ${result.identity.instanceId}, port ${result.identity.port})`); return; }
  if (result.state === "foreign") { log(`Model gateway: foreign listener (${result.reason})`); return; }
  log("Model gateway: stopped");
}

function printAutostartResult(result: ModelGatewayAutostartStatus, json: boolean, log: (message: string) => void): void {
  if (json) { log(JSON.stringify(result)); return; }
  if (result.state === "installed") { log(`Model gateway autostart: installed (${result.digest.slice(0, 12)})`); return; }
  if (result.state === "unsupported") { log(`Model gateway autostart: unsupported on ${result.platform}`); return; }
  log(`Model gateway autostart: ${result.state}`);
}

function registerProcessShutdown(close: () => Promise<void>, shutdownRequested: Promise<void>): Promise<void> {
  let closing = false;
  return new Promise((resolve) => {
    const shutdown = (): void => {
      if (closing) return;
      closing = true;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      void close()
        .catch((error: unknown) => {
          console.error(`Model gateway shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
          process.exitCode = 1;
        })
        .finally(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    void shutdownRequested.then(shutdown);
  });
}

function printHelp(log: (message: string) => void): void {
  log("\nUsage: kiln model-gateway <start|ensure|stop|restart|status|doctor|install-autostart|uninstall|uninstall-autostart|autostart-status|sync-native|outcome-incidents> [--json]\n");
  log("Native provider: kiln model-gateway sync-native --client <codex|claude|opencode> [--project <path>] [--uninstall|--adopt-existing|--force]");
  log("Inspection: kiln model-gateway outcome-incidents [--json]");
  log("The lifecycle commands resolve modelGateway from ~/.kiln/config.yaml.");
  log("Development only: kiln model-gateway serve --config <gateway.yaml>");
}

function resolveCurrentUserId(): string {
  const username = userInfo().username;
  const domain = process.platform === "win32" ? process.env.USERDOMAIN?.trim() : undefined;
  return domain ? `${domain}\\${username}` : username;
}
