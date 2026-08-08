import { OPERATOR_RUNTIME_AUDIENCE, OPERATOR_RUNTIME_PROTOCOL_VERSION, type OperatorSupervisorIdentity } from "@kilnai/gateway-contracts";
import {
  startOperatorRuntimeListener,
  type OperatorRuntimeState,
  type OperatorRuntimeSupervisorDoctor,
  type OperatorRuntimeSupervisorStatus,
  type StartOperatorRuntimeListenerOptions,
} from "@kilnai/runtime";
import pkg from "../../package.json" with { type: "json" };
import {
  createGlobalOperatorRuntimeLifecycle,
  type GlobalOperatorRuntimeLifecycle,
} from "../application/operator-runtime-lifecycle.js";
import { createOperatorRuntimeService, type OperatorRuntimeService } from "../application/operator-runtime-service.js";

interface OperatorRuntimeLifecycleSurface extends Omit<GlobalOperatorRuntimeLifecycle, "supervisor"> {
  readonly supervisor: {
    start(): Promise<OperatorRuntimeSupervisorStatus>;
    ensure(): Promise<OperatorRuntimeSupervisorStatus>;
    stop(): Promise<OperatorRuntimeSupervisorStatus>;
    restart(): Promise<OperatorRuntimeSupervisorStatus>;
    status(): Promise<OperatorRuntimeSupervisorStatus>;
    doctor(): Promise<OperatorRuntimeSupervisorDoctor>;
    readState(): Promise<OperatorRuntimeState | null>;
  };
}

interface OperatorRuntimeCommandDependencies {
  readonly createLifecycle: () => OperatorRuntimeLifecycleSurface;
  readonly createService: typeof createOperatorRuntimeService;
  readonly startListener: (options: StartOperatorRuntimeListenerOptions) => Promise<{ close(): void }>;
  readonly pid: number;
  readonly registerShutdown: (close: () => Promise<void>) => void;
  readonly writeDiagnostic: (message: string) => void;
  readonly log: (message: string) => void;
}

const defaultDependencies: OperatorRuntimeCommandDependencies = {
  createLifecycle: () => createGlobalOperatorRuntimeLifecycle({
    version: pkg.version,
    execPath: process.execPath,
    entrypoint: process.argv[1] ?? "",
  }),
  createService: createOperatorRuntimeService,
  startListener: startOperatorRuntimeListener,
  pid: process.pid,
  registerShutdown: registerProcessShutdown,
  writeDiagnostic: (message) => { process.stderr.write(`${message}\n`); },
  log: console.log,
};

export async function operatorRuntimeCommand(
  args: readonly string[],
  overrides: Partial<OperatorRuntimeCommandDependencies> = {},
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const subcommand = args[0];
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    printHelp(dependencies.log);
    return;
  }
  if (!new Set(["start", "ensure", "stop", "restart", "status", "doctor", "serve"]).has(subcommand)) {
    throw new Error(`Unknown operator-runtime command '${subcommand}'.`);
  }
  const flags = parseFlags(args.slice(1));
  if (flags.help) {
    printHelp(dependencies.log);
    return;
  }
  if (subcommand !== "serve" && (flags.globalRuntime || flags.instanceId !== undefined || flags.startedAt !== undefined)) {
    throw new Error(`${subcommand} does not accept internal operator runtime identity options.`);
  }

  const lifecycle = dependencies.createLifecycle();
  if (subcommand === "serve") {
    if (!flags.globalRuntime || flags.instanceId === undefined || flags.startedAt === undefined) {
      throw new Error("serve requires the complete internal global runtime identity.");
    }
    await serveGlobalRuntime(lifecycle, flags.instanceId, flags.startedAt, dependencies);
    return;
  }

  const result = subcommand === "doctor"
    ? await lifecycle.supervisor.doctor()
    : await lifecycle.supervisor[subcommand as "start" | "ensure" | "stop" | "restart" | "status"]();
  printResult(result, flags.json, dependencies.log);
}

async function serveGlobalRuntime(
  lifecycle: OperatorRuntimeLifecycleSurface,
  instanceId: string,
  startedAt: number,
  dependencies: OperatorRuntimeCommandDependencies,
): Promise<void> {
  const state = await lifecycle.supervisor.readState();
  const credentials = await lifecycle.readChildCredentials();
  if (!state || !credentials || !isExpectedLaunchState(state, lifecycle, instanceId, startedAt, dependencies.pid)) {
    throw new Error("Operator runtime launch state or credentials do not match this process.");
  }

  const identity: OperatorSupervisorIdentity = {
    protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
    service: OPERATOR_RUNTIME_AUDIENCE,
    instanceId,
    version: state.version,
    pid: dependencies.pid,
    startedAt,
    port: lifecycle.port,
  };
  let service: OperatorRuntimeService | undefined;
  let listener: { close(): void } | undefined;
  try {
    service = dependencies.createService({ sessionSecret: credentials.sessionSecret });
    listener = await dependencies.startListener({
      port: lifecycle.port,
      identity,
      controlToken: credentials.controlToken,
      sessionSecret: credentials.sessionSecret,
      onMcpRequest: service.onMcpRequest,
      onSessionOpen: service.onSessionOpen,
    });
  } catch (error) {
    try {
      listener?.close();
    } catch {
      dependencies.writeDiagnostic("Operator runtime listener cleanup failed during startup.");
    }
    await service?.close().catch(() => {
      dependencies.writeDiagnostic("Operator runtime service cleanup failed during startup.");
    });
    throw error;
  }
  const close = createAsyncShutdown(listener, service, dependencies.writeDiagnostic);
  dependencies.registerShutdown(close);
  dependencies.log(`Operator runtime ready on loopback port ${lifecycle.port}.`);
}

function isExpectedLaunchState(
  state: OperatorRuntimeState,
  lifecycle: OperatorRuntimeLifecycleSurface,
  instanceId: string,
  startedAt: number,
  pid: number,
): boolean {
  return state.schemaVersion === 1
    && state.instanceId === instanceId
    && state.startedAt === startedAt
    && state.pid === pid
    && state.port === lifecycle.port
    && state.version === lifecycle.launch.version
    && JSON.stringify(state.launch) === JSON.stringify(lifecycle.launch);
}

function createAsyncShutdown(
  listener: { close(): void },
  service: OperatorRuntimeService,
  writeDiagnostic: (message: string) => void,
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    if (closing) return closing;
    closing = (async () => {
      try {
        listener.close();
      } catch {
        writeDiagnostic("Operator runtime listener shutdown failed.");
      }
      try {
        await service.close();
      } catch {
        writeDiagnostic("Operator runtime service shutdown failed.");
      }
    })();
    return closing;
  };
}

function parseFlags(args: readonly string[]): {
  readonly json: boolean;
  readonly help: boolean;
  readonly globalRuntime: boolean;
  readonly instanceId?: string;
  readonly startedAt?: number;
} {
  let json = false;
  let help = false;
  let globalRuntime = false;
  let instanceId: string | undefined;
  let startedAt: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") { json = true; continue; }
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    if (arg === "--global-runtime") { globalRuntime = true; continue; }
    if (arg === "--instance-id") {
      const value = args[index + 1];
      if (!value) throw new Error("--instance-id requires a value.");
      instanceId = value;
      index += 1;
      continue;
    }
    if (arg === "--started-at") {
      const value = args[index + 1];
      if (!value || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error("--started-at requires an epoch-seconds integer.");
      startedAt = Number(value);
      if (!Number.isSafeInteger(startedAt)) throw new Error("--started-at requires an epoch-seconds integer.");
      index += 1;
      continue;
    }
    throw new Error(`Unknown operator-runtime option '${arg}'.`);
  }
  return {
    json,
    help,
    globalRuntime,
    ...(instanceId === undefined ? {} : { instanceId }),
    ...(startedAt === undefined ? {} : { startedAt }),
  };
}

function printResult(
  result: OperatorRuntimeSupervisorStatus | OperatorRuntimeSupervisorDoctor,
  json: boolean,
  log: (message: string) => void,
): void {
  if (json) {
    log(JSON.stringify(result));
    return;
  }
  if ("diagnostics" in result) {
    log(`Operator runtime doctor: ${result.status.state}; diagnostics: ${result.diagnostics.join(", ") || "none"}.`);
    return;
  }
  if (result.state === "ready") {
    log(`Operator runtime: ready (pid ${result.identity.pid}, instance ${result.identity.instanceId}, port ${result.identity.port}).`);
    return;
  }
  if (result.state === "foreign") {
    log(`Operator runtime: unavailable (${result.reason}).`);
    return;
  }
  log("Operator runtime: stopped.");
}

function registerProcessShutdown(close: () => Promise<void>): void {
  let invoked = false;
  const shutdown = (): void => {
    if (invoked) return;
    invoked = true;
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    void close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function printHelp(log: (message: string) => void): void {
  log("\nUsage: kiln operator-runtime <start|ensure|stop|restart|status|doctor> [--json]\n");
}
