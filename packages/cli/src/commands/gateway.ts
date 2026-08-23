import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  AppGatewaySupervisor,
  inspectAppGatewayListener,
  readAppGatewayChildCredentials,
  readGatewayConfigurationSource,
  requestAppGatewayShutdown,
  startGateway,
  type AppGatewayLaunchDescriptor,
  type AppGatewaySupervisorDoctor,
  type AppGatewaySupervisorStatus,
  type StartGatewayOptions,
} from "@kilnai/runtime";
import type { AppGatewayRuntimeIdentity } from "@kilnai/gateway-contracts";
import pkg from "../../package.json" with { type: "json" };
import { loadResolvedKilnMcpConfiguration } from "../config/config-merger.js";
import { createMcpCredentialAccess } from "../config/mcp-credentials.js";
import {
  createAppGatewayExecutionComposition,
  gatewayRequiresAppGatewayExecution,
} from "../application/app-gateway-execution-composition.js";

interface GatewaySupervisorSurface {
  start(): Promise<AppGatewaySupervisorStatus>;
  ensure(): Promise<AppGatewaySupervisorStatus>;
  stop(): Promise<AppGatewaySupervisorStatus>;
  restart(): Promise<AppGatewaySupervisorStatus>;
  status(): Promise<AppGatewaySupervisorStatus>;
  doctor(): Promise<AppGatewaySupervisorDoctor>;
}

export interface GatewayCommandDependencies {
  readonly projectPath: string;
  readonly entrypoint: string;
  readonly executable: string;
  readonly version: string;
  readonly pid: number;
  readonly exists: (path: string) => boolean;
  readonly readConfigurationSource: typeof readGatewayConfigurationSource;
  readonly readChildCredentials: typeof readAppGatewayChildCredentials;
  readonly createSupervisor: (input: ConstructorParameters<typeof AppGatewaySupervisor>[0]) => GatewaySupervisorSurface;
  readonly startGateway: (configPath: string, options?: StartGatewayOptions) => Promise<void>;
  readonly log: (message: string) => void;
}

const defaultDependencies: GatewayCommandDependencies = {
  projectPath: process.cwd(),
  entrypoint: process.argv[1] ?? "",
  executable: process.execPath,
  version: pkg.version,
  pid: process.pid,
  exists: existsSync,
  readConfigurationSource: readGatewayConfigurationSource,
  readChildCredentials: readAppGatewayChildCredentials,
  createSupervisor: (input) => new AppGatewaySupervisor(input),
  startGateway,
  log: console.log,
};

export async function gatewayCommand(
  args: readonly string[],
  overrides: Partial<GatewayCommandDependencies> = {},
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const subcommand = args[0];
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    printGatewayHelp(dependencies.log);
    return;
  }
  const supported = new Set(["serve", "start", "ensure", "stop", "restart", "status", "doctor"]);
  if (!supported.has(subcommand)) throw new Error(`Unknown gateway command '${subcommand}'.`);
  const flags = parseFlags(args.slice(1));
  if (flags.help) {
    printGatewayHelp(dependencies.log);
    return;
  }
  if (subcommand !== "serve" && (flags.supervisedRuntime || flags.instanceId || flags.startedAt !== undefined)) {
    throw new Error("Internal supervised runtime flags are valid only with gateway serve.");
  }
  if (subcommand === "serve" && Boolean(flags.supervisedRuntime) !== Boolean(flags.instanceId)) {
    throw new Error("Supervised gateway serve requires both --supervised-runtime and --instance-id.");
  }

  const configPath = resolve(dependencies.projectPath, flags.configPath ?? "gateway.yaml");
  if (!dependencies.exists(configPath)) {
    throw new Error(`Gateway config not found: ${configPath}. Create gateway.yaml or specify --config <path>.`);
  }
  const source = dependencies.readConfigurationSource(configPath);
  const port = flags.port ?? source.config.port;

  if (subcommand === "serve") {
    const supervision = flags.supervisedRuntime
      ? await resolveChildSupervision(flags, source.configurationRevision, port, dependencies)
      : undefined;
    await serve(configPath, source, port, supervision, dependencies);
    return;
  }

  const runtimeDir = join(dependencies.projectPath, ".kiln", "runtime", "app-gateway");
  const launch: AppGatewayLaunchDescriptor = {
    schemaVersion: 1,
    command: dependencies.executable,
    args: [
      dependencies.entrypoint,
      "gateway",
      "serve",
      "--config",
      configPath,
      ...(flags.port === undefined ? [] : ["--port", String(flags.port)]),
    ],
    cwd: dependencies.projectPath,
    mode: dependencies.entrypoint.includes(`${join("packages", "cli", "src")}`) ? "local-dev" : "installed",
    version: dependencies.version,
  };
  const supervisor = dependencies.createSupervisor({
    runtimeDir,
    desired: { port, configurationRevision: source.configurationRevision },
    version: dependencies.version,
    launch,
    inspect: (controlToken, expected) => inspectAppGatewayListener({
      port: expected?.port ?? port,
      controlToken,
      ...(expected ? { expected } : {}),
    }),
    requestShutdown: (identity, controlToken) => requestAppGatewayShutdown({ identity, controlToken }),
  });
  const result = subcommand === "start" ? await supervisor.start()
    : subcommand === "ensure" ? await supervisor.ensure()
      : subcommand === "stop" ? await supervisor.stop()
        : subcommand === "restart" ? await supervisor.restart()
          : subcommand === "status" ? await supervisor.status()
            : await supervisor.doctor();
  printResult(result, flags.json, dependencies.log);
}

async function resolveChildSupervision(
  flags: GatewayFlags,
  configurationRevision: `sha256:${string}`,
  port: number,
  dependencies: GatewayCommandDependencies,
): Promise<StartGatewayOptions["supervision"]> {
  if (!flags.supervisedRuntime || !flags.instanceId || flags.startedAt === undefined) {
    throw new Error("Supervised gateway serve requires --supervised-runtime, --instance-id, and --started-at.");
  }
  const credentials = await dependencies.readChildCredentials(resolve(flags.supervisedRuntime));
  const identity: AppGatewayRuntimeIdentity = {
    protocolVersion: "1",
    service: "kiln-app-gateway",
    instanceId: flags.instanceId,
    version: dependencies.version,
    pid: dependencies.pid,
    startedAt: flags.startedAt,
    port,
    configurationRevision,
    lifecycle: "ready",
  };
  return { identity, controlToken: credentials.controlToken };
}

async function serve(
  configPath: string,
  source: ReturnType<typeof readGatewayConfigurationSource>,
  port: number,
  supervision: StartGatewayOptions["supervision"],
  dependencies: GatewayCommandDependencies,
): Promise<void> {
  const mcp = loadResolvedKilnMcpConfiguration(dependencies.projectPath);
  if (mcp.diagnostics.length > 0) {
    throw new Error(`Canonical MCP configuration is invalid: ${mcp.diagnostics.map((item) => item.code).join(", ")}`);
  }
  const appGatewayExecution = gatewayRequiresAppGatewayExecution(source)
    ? createAppGatewayExecutionComposition({ projectPath: dependencies.projectPath, configPath })
    : undefined;
  try {
    await dependencies.startGateway(configPath, {
      port,
      canonicalMcpServers: new Map(Object.entries(mcp.servers)),
      mcpCredentialResolver: createMcpCredentialAccess().resolve,
      ...(appGatewayExecution ? { appGatewayExecution: appGatewayExecution.bundle } : {}),
      ...(supervision ? { supervision } : {}),
    });
  } finally {
    appGatewayExecution?.close();
  }
}

interface GatewayFlags {
  readonly configPath?: string;
  readonly port?: number;
  readonly json: boolean;
  readonly help: boolean;
  readonly supervisedRuntime?: string;
  readonly instanceId?: string;
  readonly startedAt?: number;
}

function parseFlags(args: readonly string[]): GatewayFlags {
  let configPath: string | undefined;
  let port: number | undefined;
  let supervisedRuntime: string | undefined;
  let instanceId: string | undefined;
  let startedAt: number | undefined;
  let json = false;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    const readValue = (): string => {
      const value = args[index + 1];
      if (!value) throw new Error(`${flag} requires a value.`);
      index += 1;
      return value;
    };
    if (flag === "--config") configPath = readValue();
    else if (flag === "--port") port = parsePort(readValue());
    else if (flag === "--supervised-runtime") supervisedRuntime = readValue();
    else if (flag === "--instance-id") instanceId = readValue();
    else if (flag === "--started-at") startedAt = parseNonnegativeInteger(readValue(), "--started-at");
    else if (flag === "--json") json = true;
    else if (flag === "--help" || flag === "-h") help = true;
    else throw new Error(`Unknown gateway option '${flag}'.`);
  }
  return {
    ...(configPath ? { configPath } : {}),
    ...(port === undefined ? {} : { port }),
    ...(supervisedRuntime ? { supervisedRuntime } : {}),
    ...(instanceId ? { instanceId } : {}),
    ...(startedAt === undefined ? {} : { startedAt }),
    json,
    help,
  };
}

function parsePort(value: string): number {
  const port = parseNonnegativeInteger(value, "--port");
  if (port < 1 || port > 65_535) throw new Error("--port must be an integer from 1 through 65535.");
  return port;
}

function parseNonnegativeInteger(value: string, flag: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new Error(`${flag} must be a nonnegative integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} is outside the safe integer range.`);
  return parsed;
}

function printResult(
  result: AppGatewaySupervisorStatus | AppGatewaySupervisorDoctor,
  json: boolean,
  log: (message: string) => void,
): void {
  if (json) { log(JSON.stringify(result)); return; }
  if ("diagnostics" in result) {
    log(`App Gateway doctor: ${result.status.state}; diagnostics: ${result.diagnostics.join(", ") || "none"}`);
    return;
  }
  if (result.state === "ready") {
    log(`App Gateway: ready (pid ${result.identity.pid}, instance ${result.identity.instanceId}, port ${result.identity.port}, revision ${result.identity.configurationRevision})`);
    return;
  }
  if (result.state === "foreign") { log(`App Gateway: foreign listener (${result.reason})`); return; }
  log("App Gateway: stopped");
}

function printGatewayHelp(log: (message: string) => void): void {
  log("\nUsage: kiln gateway <serve|start|ensure|stop|restart|status|doctor> [options]\n");
  log("Lifecycle commands supervise one exact gateway.yaml plus bound App source revision.");
  log("  --config <path>  Path to gateway.yaml (default: ./gateway.yaml)");
  log("  --port <number>  Override the gateway port");
  log("  --json           Emit machine-readable lifecycle evidence");
  log("  --help, -h       Show this help message");
  log("Foreground development: kiln gateway serve --config ./gateway.yaml");
}
