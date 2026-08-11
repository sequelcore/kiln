import type { OperatorRuntimeHarness } from "@kilnai/gateway-contracts";
import {
  OPERATOR_RUNTIME_MCP_PATH,
  type OperatorRuntimeBridgeCredentials,
  type OperatorRuntimeSupervisorStatus,
} from "@kilnai/runtime";
import type {
  TrustedProcessContext,
  TrustedWorkspaceResolution,
} from "../application/trusted-workspace-resolution.js";
import { createOperatorRuntimeClientSession } from "../application/operator-runtime-client-session.js";
import {
  nativeHarnessMcpToolCatalog,
  type NativeHarnessMcpCallResult,
} from "./native-harness-mcp-tools.js";

interface LocalServer {
  setRequestHandler(schema: unknown, handler: (request: { params: Record<string, unknown> }) => unknown): void;
  connect(transport: ClosableTransport): Promise<void>;
  close(): Promise<void>;
}

interface RemoteClient {
  connect(transport: ClosableTransport): Promise<void>;
  callTool(params: { readonly name: string; readonly arguments?: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

interface ClosableTransport {
  close(): Promise<void>;
}

export interface GlobalMcpBridgeSdk {
  readonly Server: new (
    info: { readonly name: string; readonly version: string },
    options: { readonly capabilities: Record<string, unknown> },
  ) => LocalServer;
  readonly Client: new (
    info: { readonly name: string; readonly version: string },
    options: { readonly capabilities: Record<string, unknown> },
  ) => RemoteClient;
  readonly StdioServerTransport: new () => ClosableTransport;
  readonly StreamableHTTPClientTransport: new (
    url: URL,
    options: { readonly fetch: (url: string | URL, init?: RequestInit) => Promise<Response> },
  ) => ClosableTransport;
  readonly ListToolsRequestSchema: unknown;
  readonly CallToolRequestSchema: unknown;
}

export interface GlobalMcpBridgeSupervisor {
  ensure(): Promise<OperatorRuntimeSupervisorStatus>;
}

export interface StartGlobalMcpBridgeOptions {
  readonly harness: OperatorRuntimeHarness;
  readonly supervisor: GlobalMcpBridgeSupervisor;
  readonly readBridgeCredentials: () => Promise<OperatorRuntimeBridgeCredentials | null>;
  readonly processContext?: TrustedProcessContext;
  readonly resolveWorkspace?: (context: TrustedProcessContext) => TrustedWorkspaceResolution;
  readonly sdkLoader?: () => Promise<GlobalMcpBridgeSdk>;
  readonly fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
  readonly createSessionId?: () => string;
  readonly nowEpochSeconds?: () => number;
  readonly writeDiagnostic?: (message: string) => void;
  readonly registerProcessSignals?: boolean;
  readonly signals?: {
    once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
    off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  };
}

export interface GlobalMcpBridgeHandle {
  readonly managedRuntime: Promise<{ readonly status: "attached" | "unavailable" }>;
  close(): Promise<void>;
}

interface ActiveSession {
  readonly client: RemoteClient;
  readonly transport: ClosableTransport;
}

/**
 * Starts the protocol-facing stdio endpoint first, then attaches it to the
 * machine-global operator runtime without making MCP initialization depend on
 * supervisor availability.
 */
export async function startGlobalMcpBridge(options: StartGlobalMcpBridgeOptions): Promise<GlobalMcpBridgeHandle> {
  const sdk = await (options.sdkLoader ?? loadSdk)();
  const localServer = new sdk.Server(
    { name: `kiln-${options.harness}-control-plane`, version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  const localTransport = new sdk.StdioServerTransport();
  const runtimeSession = createOperatorRuntimeClientSession({
    principal: { kind: "native-harness", harness: options.harness },
    supervisor: options.supervisor,
    readBridgeCredentials: options.readBridgeCredentials,
    ...(options.processContext ? { processContext: options.processContext } : {}),
    ...(options.resolveWorkspace ? { resolveWorkspace: options.resolveWorkspace } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.createSessionId ? { createSessionId: options.createSessionId } : {}),
    ...(options.nowEpochSeconds ? { nowEpochSeconds: options.nowEpochSeconds } : {}),
  });
  const writeDiagnostic = options.writeDiagnostic ?? ((message: string) => process.stderr.write(`${message}\n`));
  const signals = options.signals ?? process;
  let active: ActiveSession | undefined;
  let attachInFlight: Promise<boolean> | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;

  const closeRemote = async (): Promise<void> => {
    const session = active;
    active = undefined;
    if (!session) return;
    await session.client.close().catch(() => undefined);
    await session.transport.close().catch(() => undefined);
  };

  const attach = async (): Promise<boolean> => {
    if (closed) return false;
    const endpoint = await runtimeSession.endpoint(OPERATOR_RUNTIME_MCP_PATH);
    if (closed) return false;
    if (active) return true;
    const transport = new sdk.StreamableHTTPClientTransport(
      endpoint.url,
      { fetch: endpoint.fetch },
    );
    const client = new sdk.Client(
      { name: `kiln-${options.harness}-global-bridge`, version: "0.1.0" },
      { capabilities: {} },
    );
    active = { transport, client };
    try {
      await client.connect(transport);
      return !closed;
    } catch {
      await closeRemote();
      return false;
    }
  };

  const ensureAttached = (): Promise<boolean> => {
    if (attachInFlight) return attachInFlight;
    const operation = attach().catch(() => false).finally(() => {
      if (attachInFlight === operation) attachInFlight = undefined;
    });
    attachInFlight = operation;
    return operation;
  };

  localServer.setRequestHandler(sdk.ListToolsRequestSchema, async () => ({ tools: nativeHarnessMcpToolCatalog() }));
  localServer.setRequestHandler(sdk.CallToolRequestSchema, async (request) => {
    const params = request.params as { readonly name?: unknown; readonly arguments?: unknown };
    try {
      if (!(await ensureAttached()) || !active) return unavailableResult();
      const result = await active.client.callTool({
        name: typeof params.name === "string" ? params.name : "",
        arguments: isRecord(params.arguments) ? params.arguments : {},
      });
      return result;
    } catch {
      return unavailableResult();
    }
  });

  await localServer.connect(localTransport);

  const onSignal = (): void => {
    void close().catch(() => writeDiagnostic("Kiln global MCP bridge shutdown did not complete cleanly."));
  };
  const unregisterSignals = (): void => {
    signals.off("SIGINT", onSignal);
    signals.off("SIGTERM", onSignal);
  };
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    unregisterSignals();
    closePromise = (async () => {
      await closeRemote();
      runtimeSession.close();
      await localTransport.close().catch(() => undefined);
      await localServer.close();
    })();
    return closePromise;
  };
  if (options.registerProcessSignals !== false) {
    signals.once("SIGINT", onSignal);
    signals.once("SIGTERM", onSignal);
  }
  const managedRuntime = ensureAttached()
    .then((attached) => ({ status: attached ? "attached" as const : "unavailable" as const }))
    .catch(() => ({ status: "unavailable" as const }));
  void managedRuntime.then((result) => {
    if (result.status === "unavailable" && !closed) {
      writeDiagnostic("Kiln operator Runtime is unavailable; MCP tools remain discoverable.");
    }
  });
  return { managedRuntime, close };
}

function unavailableResult(): NativeHarnessMcpCallResult {
  const structuredContent = {
    error: {
      code: "KILN_OPERATOR_RUNTIME_UNAVAILABLE",
      message: "The Kiln operator Runtime is unavailable.",
      operatorAction: "Retry after the Kiln operator Runtime is ready.",
    },
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadSdk(): Promise<GlobalMcpBridgeSdk> {
  const [server, client, stdio, streamable, types] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);
  return {
    Server: server.Server as unknown as GlobalMcpBridgeSdk["Server"],
    Client: client.Client as unknown as GlobalMcpBridgeSdk["Client"],
    StdioServerTransport: stdio.StdioServerTransport as unknown as GlobalMcpBridgeSdk["StdioServerTransport"],
    StreamableHTTPClientTransport: streamable.StreamableHTTPClientTransport as unknown as GlobalMcpBridgeSdk["StreamableHTTPClientTransport"],
    ListToolsRequestSchema: types.ListToolsRequestSchema,
    CallToolRequestSchema: types.CallToolRequestSchema,
  };
}
