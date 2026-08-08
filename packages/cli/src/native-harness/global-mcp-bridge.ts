import { randomUUID } from "node:crypto";
import type { OperatorRuntimeHarness } from "@kilnai/gateway-contracts";
import {
  OPERATOR_RUNTIME_BINDING_HEADERS,
  OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER,
  OPERATOR_RUNTIME_MCP_PATH,
  OPERATOR_RUNTIME_SESSION_PATH,
  type OperatorRuntimeBridgeCredentials,
  type OperatorRuntimeSupervisorStatus,
} from "@kilnai/runtime";
import {
  resolveTrustedWorkspace,
  type TrustedProcessContext,
  type TrustedWorkspaceResolution,
} from "../application/trusted-workspace-resolution.js";
import {
  nativeHarnessMcpToolCatalog,
  type NativeHarnessMcpCallResult,
} from "./native-harness-mcp-tools.js";

const RENEWAL_WINDOW_SECONDS = 30;

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
  readonly workspace: Extract<TrustedWorkspaceResolution, { readonly status: "resolved" }>;
  readonly sessionId: string;
  readonly harness: OperatorRuntimeHarness;
  readonly port: number;
  credential: string;
  expiresAt: number;
  client?: RemoteClient;
  transport?: ClosableTransport;
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
  const resolveWorkspace = options.resolveWorkspace ?? resolveTrustedWorkspace;
  const processContext = options.processContext ?? process;
  const baseFetch = options.fetch ?? globalThis.fetch;
  const nowEpochSeconds = options.nowEpochSeconds ?? (() => Math.floor(Date.now() / 1_000));
  const createSessionId = options.createSessionId ?? randomUUID;
  const writeDiagnostic = options.writeDiagnostic ?? ((message: string) => process.stderr.write(`${message}\n`));
  const signals = options.signals ?? process;
  let active: ActiveSession | undefined;
  let attachInFlight: Promise<boolean> | undefined;
  let renewalInFlight: Promise<boolean> | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;

  const closeRemote = async (): Promise<void> => {
    const session = active;
    active = undefined;
    if (!session) return;
    await session.client?.close().catch(() => undefined);
    await session.transport?.close().catch(() => undefined);
  };

  const openSession = async (
    workspace: Extract<TrustedWorkspaceResolution, { readonly status: "resolved" }>,
    sessionId: string,
  ): Promise<{ readonly credential: string; readonly expiresAt: number; readonly port: number } | undefined> => {
    const status = await options.supervisor.ensure();
    if (closed || status.state !== "ready") return undefined;
    const credentials = await options.readBridgeCredentials();
    if (!credentials) return undefined;
    const port = status.identity.port;
    const authority = `127.0.0.1:${port}`;
    const response = await baseFetch(`http://${authority}${OPERATOR_RUNTIME_SESSION_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: authority,
        origin: `http://${authority}`,
        [OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER]: credentials.controlToken,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        canonicalRoot: workspace.canonicalRoot,
        binding: {
          projectRuntimeId: workspace.projectRuntimeId,
          markerDigest: workspace.markerDigest,
        },
        harness: options.harness,
        sessionId,
      }),
    });
    if (!response.ok) return undefined;
    const value: unknown = await response.json();
    const opened = parseSessionOpen(value);
    return opened ? { ...opened, port } : undefined;
  };

  const renewActiveSession = (): Promise<boolean> => {
    if (renewalInFlight) return renewalInFlight;
    const operation = (async () => {
      const session = active;
      if (!session || closed) return false;
      const workspace = resolveWorkspace(processContext);
      if (workspace.status !== "resolved" || !sameBinding(session.workspace, workspace)) return false;
      const opened = await openSession(workspace, session.sessionId);
      if (!opened || closed || active !== session || opened.port !== session.port) return false;
      session.credential = opened.credential;
      session.expiresAt = opened.expiresAt;
      return true;
    })().catch(() => false).finally(() => {
      if (renewalInFlight === operation) renewalInFlight = undefined;
    });
    renewalInFlight = operation;
    return operation;
  };

  const attach = async (forceRenewal = false): Promise<boolean> => {
    if (closed) return false;
    const workspace = resolveWorkspace(processContext);
    if (workspace.status !== "resolved") return false;
    const bindingChanged = active !== undefined && !sameBinding(active.workspace, workspace);
    if (bindingChanged) await closeRemote();
    if (!forceRenewal && active?.client && active.expiresAt - nowEpochSeconds() > RENEWAL_WINDOW_SECONDS) return true;

    const sessionId = active && !bindingChanged ? active.sessionId : createSessionId();
    const opened = await openSession(workspace, sessionId);
    if (!opened || closed) return false;
    if (active && !bindingChanged) {
      active.credential = opened.credential;
      active.expiresAt = opened.expiresAt;
      return active.client !== undefined;
    }

    const session: ActiveSession = { workspace, sessionId, harness: options.harness, ...opened };
    active = session;
    const authority = `127.0.0.1:${session.port}`;
    const authenticatedFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const first = await baseFetch(url, withSessionHeaders(init, authority, session));
      if (first.status !== 401 || closed) return first;
      const renewed = await renewActiveSession();
      return renewed && active
        ? baseFetch(url, withSessionHeaders(init, authority, active))
        : first;
    };
    const transport = new sdk.StreamableHTTPClientTransport(
      new URL(`http://${authority}${OPERATOR_RUNTIME_MCP_PATH}`),
      { fetch: authenticatedFetch },
    );
    const client = new sdk.Client(
      { name: `kiln-${options.harness}-global-bridge`, version: "0.1.0" },
      { capabilities: {} },
    );
    session.transport = transport;
    session.client = client;
    try {
      await client.connect(transport);
      return !closed;
    } catch {
      await closeRemote();
      return false;
    }
  };

  const ensureAttached = (forceRenewal = false): Promise<boolean> => {
    if (attachInFlight) return attachInFlight;
    const operation = attach(forceRenewal).catch(() => false).finally(() => {
      if (attachInFlight === operation) attachInFlight = undefined;
    });
    attachInFlight = operation;
    return operation;
  };

  localServer.setRequestHandler(sdk.ListToolsRequestSchema, async () => ({ tools: nativeHarnessMcpToolCatalog() }));
  localServer.setRequestHandler(sdk.CallToolRequestSchema, async (request) => {
    const params = request.params as { readonly name?: unknown; readonly arguments?: unknown };
    try {
      if (!(await ensureAttached()) || !active?.client) return unavailableResult();
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

function withSessionHeaders(init: RequestInit | undefined, authority: string, session: ActiveSession): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${session.credential}`);
  headers.set("host", authority);
  headers.set("origin", `http://${authority}`);
  headers.set(OPERATOR_RUNTIME_BINDING_HEADERS.projectRuntimeId, session.workspace.projectRuntimeId);
  headers.set(OPERATOR_RUNTIME_BINDING_HEADERS.markerDigest, session.workspace.markerDigest);
  headers.set(OPERATOR_RUNTIME_BINDING_HEADERS.harness, session.harness);
  headers.set(OPERATOR_RUNTIME_BINDING_HEADERS.sessionId, session.sessionId);
  return { ...init, headers };
}

function parseSessionOpen(value: unknown): { readonly credential: string; readonly expiresAt: number } | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "credential,expiresAt") return undefined;
  return typeof value.credential === "string"
    && /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.credential)
    && typeof value.expiresAt === "number"
    && Number.isSafeInteger(value.expiresAt)
    ? { credential: value.credential, expiresAt: value.expiresAt }
    : undefined;
}

function sameBinding(
  left: Extract<TrustedWorkspaceResolution, { readonly status: "resolved" }>,
  right: Extract<TrustedWorkspaceResolution, { readonly status: "resolved" }>,
): boolean {
  return left.canonicalRoot === right.canonicalRoot
    && left.projectRuntimeId === right.projectRuntimeId
    && left.markerDigest === right.markerDigest;
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
