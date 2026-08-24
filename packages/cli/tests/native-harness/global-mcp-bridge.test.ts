import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { KILN_CONTROL_PLANE_SERVER_INSTRUCTIONS } from "@kilnai/core/skill";
import {
  OPERATOR_RUNTIME_BINDING_HEADERS,
  OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER,
  OPERATOR_RUNTIME_SESSION_PATH,
} from "@kilnai/runtime";
import {
  startGlobalMcpBridge,
  type GlobalMcpBridgeSdk,
} from "../../src/native-harness/global-mcp-bridge.js";

// Ambient `Request`/`Headers` resolve to conflicting declarations here (Bun's
// global types vs. undici's, both pulled transitively into this program).
// Deriving the captured-request type from the constructor call itself, rather
// than naming the ambient `Request` type directly, keeps the two in sync.
function captureFetchRequest(url: string | URL, init: RequestInit | undefined) {
  return new Request(url.toString(), init);
}
type CapturedRequest = ReturnType<typeof captureFetchRequest>;

const ROOT = "C:\\workspace\\kiln";
const PROJECT_RUNTIME_ID = `krp_${"a".repeat(64)}` as `krp_${string}`;
const COMPOSITION_REVISION = `sha256:${"b".repeat(64)}` as `sha256:${string}`;
const READY = {
  state: "ready" as const,
  identity: {
    protocolVersion: "3" as const,
    service: "kiln-operator-runtime" as const,
    instanceId: "runtime-test",
    version: "test",
    pid: 42,
    startedAt: 100,
    port: 43123,
  },
};

describe("global MCP bridge", () => {
  it("contains no project-local composition or caller-supplied authority path", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/native-harness/global-mcp-bridge.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/createOperatorProject|createComposition|projectPath|process\.cwd\(\)/);
  });

  it.each(["codex", "claude", "opencode"] as const)("publishes the stable twelve-tool %s catalog before the supervisor resolves", async (harness) => {
    const deferred = promiseWithResolvers<typeof READY>();
    const fixture = sdkFixture();
    const handle = await startGlobalMcpBridge({
      harness,
      supervisor: { ensure: () => deferred.promise },
      readBridgeCredentials: async () => ({ schemaVersion: 1, controlToken: "c".repeat(43) }),
      resolveWorkspace: () => workspace(),
      sdkLoader: async () => fixture.sdk,
      registerProcessSignals: false,
    });

    expect(fixture.localConnected).toBe(true);
    expect(fixture.serverOptions).toEqual({
      capabilities: { tools: {} },
      instructions: KILN_CONTROL_PLANE_SERVER_INSTRUCTIONS,
    });
    const response = await fixture.listHandler!({ params: {} }) as { tools: readonly { name: string }[] };
    expect(response.tools).toHaveLength(12);
    expect(response.tools.map((tool) => tool.name)).toEqual([
      "kiln_status_inspect",
      "kiln_work_governance_inspect",
      "kiln_capability_inspect",
      "kiln_account_usage_inspect",
      "kiln_settings_read",
      "kiln_settings_propose",
      "kiln_settings_apply",
      "kiln_agent_task_submit",
      "kiln_agent_task_status",
      "kiln_agent_task_result",
      "kiln_agent_task_cancel",
      "kiln_agent_task_replay",
    ]);
    await handle.close();
    deferred.resolve(READY);
    await expect(handle.managedRuntime).resolves.toEqual({ status: "unavailable" });
  });

  it("opens a strict bound session and proxies tool results unchanged", async () => {
    const fixture = sdkFixture();
    const requests: CapturedRequest[] = [];
    const result = { content: [{ type: "text", text: "remote" }], structuredContent: { remote: true } };
    fixture.remoteResult = result;
    const handle = await startGlobalMcpBridge({
      harness: "codex",
      supervisor: { ensure: async () => READY },
      readBridgeCredentials: async () => ({ schemaVersion: 1, controlToken: "control-token-value-control-token-value" }),
      resolveWorkspace: () => workspace(),
      sdkLoader: async () => fixture.sdk,
      createSessionId: () => "session-01",
      nowEpochSeconds: () => 100,
      fetch: async (url, init) => {
        const request = captureFetchRequest(url, init);
        requests.push(request.clone() as CapturedRequest);
        if (new URL(request.url).pathname === OPERATOR_RUNTIME_SESSION_PATH) {
          return Response.json({ credential: "v3.payload.signature", expiresAt: 300 });
        }
        return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
      },
      registerProcessSignals: false,
    });
    await expect(handle.managedRuntime).resolves.toEqual({ status: "attached" });
    await expect(fixture.callHandler!({ params: { name: "kiln_status_inspect", arguments: {} } })).resolves.toBe(result);

    const session = requests.find((request) => new URL(request.url).pathname === OPERATOR_RUNTIME_SESSION_PATH)!;
    expect(session.method).toBe("POST");
    expect(session.headers.get("host")).toBe("127.0.0.1:43123");
    expect(session.headers.get("origin")).toBe("http://127.0.0.1:43123");
    expect(session.headers.get(OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER)).toBe("control-token-value-control-token-value");
    await expect(session.json()).resolves.toEqual({
      schemaVersion: 3,
      canonicalRoot: ROOT,
      binding: { projectRuntimeId: PROJECT_RUNTIME_ID, compositionRevision: COMPOSITION_REVISION },
      principal: { kind: "native-harness", harness: "codex" },
      sessionId: "session-01",
    });
    expect(fixture.remoteCalls).toEqual([{ name: "kiln_status_inspect", arguments: {} }]);
    await handle.close();
  });

  it("contains failed startup behind the stable unavailable envelope", async () => {
    const fixture = sdkFixture();
    const diagnostics: string[] = [];
    const handle = await startGlobalMcpBridge({
      harness: "claude",
      supervisor: { ensure: async () => ({ state: "stopped" }) },
      readBridgeCredentials: async () => null,
      resolveWorkspace: () => workspace(),
      sdkLoader: async () => fixture.sdk,
      writeDiagnostic: (message) => diagnostics.push(message),
      registerProcessSignals: false,
    });
    await expect(handle.managedRuntime).resolves.toEqual({ status: "unavailable" });
    await expect(fixture.callHandler!({ params: { name: "kiln_status_inspect", arguments: {} } })).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "KILN_OPERATOR_RUNTIME_UNAVAILABLE" } },
    });
    expect(diagnostics.join(" ")).not.toMatch(/token|workspace|\\/i);
    await handle.close();
  });

  it("coalesces concurrent supervisor attachment", async () => {
    const fixture = sdkFixture();
    const deferred = promiseWithResolvers<typeof READY>();
    const ensure = vi.fn(() => deferred.promise);
    const handle = await startGlobalMcpBridge({
      harness: "opencode",
      supervisor: { ensure },
      readBridgeCredentials: async () => ({ schemaVersion: 1, controlToken: "c".repeat(43) }),
      resolveWorkspace: () => workspace(),
      sdkLoader: async () => fixture.sdk,
      fetch: sessionFetch,
      registerProcessSignals: false,
    });
    const first = fixture.callHandler!({ params: { name: "kiln_status_inspect", arguments: {} } });
    const second = fixture.callHandler!({ params: { name: "kiln_status_inspect", arguments: {} } });
    expect(ensure).toHaveBeenCalledTimes(1);
    deferred.resolve(READY);
    await Promise.all([first, second, handle.managedRuntime]);
    expect(ensure).toHaveBeenCalledTimes(1);
    await handle.close();
  });

  it("renews proactively and retries one authenticated MCP request after a 401", async () => {
    const fixture = sdkFixture({ connectFetch: true });
    let sessionOpens = 0;
    let mcpRequests = 0;
    let now = 100;
    const handle = await startGlobalMcpBridge({
      harness: "codex",
      supervisor: { ensure: async () => READY },
      readBridgeCredentials: async () => ({ schemaVersion: 1, controlToken: "c".repeat(43) }),
      resolveWorkspace: () => workspace(),
      sdkLoader: async () => fixture.sdk,
      nowEpochSeconds: () => now,
      createSessionId: () => "session-renew",
      fetch: async (url, init) => {
        const request = captureFetchRequest(url, init);
        if (new URL(request.url).pathname === OPERATOR_RUNTIME_SESSION_PATH) {
          sessionOpens += 1;
          return Response.json({ credential: `v3.payload${sessionOpens}.signature`, expiresAt: sessionOpens === 1 ? 140 : 400 });
        }
        mcpRequests += 1;
        return mcpRequests === 2 ? new Response(null, { status: 401 }) : Response.json({ jsonrpc: "2.0", id: 1, result: {} });
      },
      registerProcessSignals: false,
    });
    await handle.managedRuntime;
    now = 115;
    await fixture.callHandler!({ params: { name: "kiln_status_inspect", arguments: {} } });
    expect(sessionOpens).toBeGreaterThanOrEqual(2);
    expect(mcpRequests).toBeGreaterThanOrEqual(3);
    await handle.close();
  });

  it("reopens through the supervisor without deadlocking when initial MCP connect receives 401", async () => {
    const fixture = sdkFixture({ connectFetch: true });
    let sessionOpens = 0;
    let mcpRequests = 0;
    let renewedHeaders: Headers | undefined;
    const ensure = vi.fn(async () => READY);
    const readCredentials = vi.fn(async () => ({ schemaVersion: 1 as const, controlToken: "c".repeat(43) }));
    const handle = await startGlobalMcpBridge({
      harness: "claude",
      supervisor: { ensure },
      readBridgeCredentials: readCredentials,
      resolveWorkspace: () => workspace(),
      sdkLoader: async () => fixture.sdk,
      createSessionId: () => "session-initial-401",
      nowEpochSeconds: () => 100,
      fetch: async (url, init) => {
        const request = captureFetchRequest(url, init);
        if (new URL(request.url).pathname === OPERATOR_RUNTIME_SESSION_PATH) {
          sessionOpens += 1;
          return Response.json({ credential: `v3.payload${sessionOpens}.signature`, expiresAt: 500 });
        }
        mcpRequests += 1;
        if (mcpRequests === 1) return new Response(null, { status: 401 });
        renewedHeaders = request.headers;
        return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
      },
      registerProcessSignals: false,
    });

    const managedRuntime = await handle.managedRuntime;
    expect(sessionOpens).toBe(2);
    expect(mcpRequests).toBe(2);
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(readCredentials).toHaveBeenCalledTimes(2);
    expect(renewedHeaders).toBeDefined();
    expect(renewedHeaders!.get("host")).toBe("127.0.0.1:43123");
    expect(renewedHeaders!.get("origin")).toBe("http://127.0.0.1:43123");
    expect(renewedHeaders!.get(OPERATOR_RUNTIME_BINDING_HEADERS.projectRuntimeId)).toBe(PROJECT_RUNTIME_ID);
    expect(renewedHeaders!.get(OPERATOR_RUNTIME_BINDING_HEADERS.compositionRevision)).toBe(COMPOSITION_REVISION);
    expect(renewedHeaders!.get(OPERATOR_RUNTIME_BINDING_HEADERS.principalKind)).toBe("native-harness");
    expect(renewedHeaders!.get(OPERATOR_RUNTIME_BINDING_HEADERS.principalId)).toBe("claude");
    expect(renewedHeaders!.get(OPERATOR_RUNTIME_BINDING_HEADERS.sessionId)).toBe("session-initial-401");
    expect(renewedHeaders!.get("authorization")).toBe("Bearer v3.payload2.signature");
    expect(managedRuntime).toEqual({ status: "attached" });
    await handle.close();
  });

  it("uses a new session id when the trusted composition binding changes", async () => {
    const fixture = sdkFixture();
    let current = workspace();
    const ids = ["session-old", "session-new"];
    const openedIds: string[] = [];
    const handle = await startGlobalMcpBridge({
      harness: "codex",
      supervisor: { ensure: async () => READY },
      readBridgeCredentials: async () => ({ schemaVersion: 1, controlToken: "c".repeat(43) }),
      resolveWorkspace: () => current,
      sdkLoader: async () => fixture.sdk,
      createSessionId: () => ids.shift()!,
      fetch: async (url, init) => {
        const request = captureFetchRequest(url, init);
        if (new URL(request.url).pathname === OPERATOR_RUNTIME_SESSION_PATH) {
          openedIds.push((await request.clone().json() as { sessionId: string }).sessionId);
          return Response.json({ credential: "v3.payload.signature", expiresAt: 500 });
        }
        return Response.json({});
      },
      registerProcessSignals: false,
    });
    await handle.managedRuntime;
    current = workspace({ compositionRevision: `sha256:${"c".repeat(64)}` });
    await fixture.callHandler!({ params: { name: "kiln_status_inspect", arguments: {} } });
    expect(openedIds).toEqual(["session-old", "session-new"]);
    await handle.close();
    await handle.close();
    expect(fixture.localCloseCount).toBe(1);
  });

  it("contains signal-triggered close failure in one safe diagnostic", async () => {
    const fixture = sdkFixture({ rejectLocalClose: true });
    const listeners = new Map<string, () => void>();
    const diagnostics: string[] = [];
    const handle = await startGlobalMcpBridge({
      harness: "codex",
      supervisor: { ensure: async () => ({ state: "stopped" }) },
      readBridgeCredentials: async () => null,
      resolveWorkspace: () => workspace(),
      sdkLoader: async () => fixture.sdk,
      writeDiagnostic: (message) => diagnostics.push(message),
      signals: {
        once: (signal, listener) => listeners.set(signal, listener),
        off: (signal) => listeners.delete(signal),
      },
    });
    await handle.managedRuntime;
    listeners.get("SIGTERM")!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(diagnostics).toContain("Kiln global MCP bridge shutdown did not complete cleanly.");
    expect(diagnostics.join(" ")).not.toContain(ROOT);
  });
});

function workspace(overrides: Partial<ReturnType<typeof workspaceValue>> = {}) {
  return { ...workspaceValue(), ...overrides };
}

function workspaceValue() {
  return {
    status: "resolved" as const,
    canonicalRoot: ROOT,
    projectRuntimeId: PROJECT_RUNTIME_ID,
    projectStateRoot: `${ROOT}\\.kiln\\state`,
    adoptionRevision: `sha256:${"d".repeat(64)}` as `sha256:${string}`,
    globalConfigRevision: `sha256:${"e".repeat(64)}` as `sha256:${string}`,
    compositionRevision: COMPOSITION_REVISION,
  };
}

async function sessionFetch(url: string | URL): Promise<Response> {
  return new URL(url).pathname === OPERATOR_RUNTIME_SESSION_PATH
    ? Response.json({ credential: "v3.payload.signature", expiresAt: 500 })
    : Response.json({});
}

function sdkFixture(options: { connectFetch?: boolean; rejectLocalClose?: boolean } = {}) {
  const listSchema = Symbol("list");
  const callSchema = Symbol("call");
  const fixture: {
    sdk: GlobalMcpBridgeSdk;
    listHandler?: (request: { params: Record<string, unknown> }) => unknown;
    callHandler?: (request: { params: Record<string, unknown> }) => unknown;
    localConnected: boolean;
    localCloseCount: number;
    serverOptions?: Record<string, unknown>;
    remoteCalls: unknown[];
    remoteResult: unknown;
  } = {
    sdk: undefined as never,
    localConnected: false,
    localCloseCount: 0,
    remoteCalls: [],
    remoteResult: { content: [], structuredContent: {} },
  };
  class StreamTransport {
    constructor(readonly url: URL, readonly options: { fetch: (url: string | URL, init?: RequestInit) => Promise<Response> }) {}
    async close(): Promise<void> {}
  }
  fixture.sdk = {
    Server: class {
      constructor(_info: unknown, serverOptions: Record<string, unknown>) {
        fixture.serverOptions = serverOptions;
      }
      setRequestHandler(schema: unknown, handler: (request: { params: Record<string, unknown> }) => unknown): void {
        if (schema === listSchema) fixture.listHandler = handler;
        if (schema === callSchema) fixture.callHandler = handler;
      }
      async connect(): Promise<void> { fixture.localConnected = true; }
      async close(): Promise<void> {
        fixture.localCloseCount += 1;
        if (options.rejectLocalClose) throw new Error(`${ROOT} token=secret`);
      }
    },
    Client: class {
      private transport?: StreamTransport;
      async connect(transport: unknown): Promise<void> {
        this.transport = transport as StreamTransport;
        if (options.connectFetch) await this.transport.options.fetch(this.transport.url, { method: "POST", body: "{}" });
      }
      async callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown> {
        fixture.remoteCalls.push(params);
        if (options.connectFetch) await this.transport!.options.fetch(this.transport!.url, { method: "POST", body: "{}" });
        return fixture.remoteResult;
      }
      async close(): Promise<void> {}
    },
    StdioServerTransport: class { async close(): Promise<void> {} },
    StreamableHTTPClientTransport: StreamTransport,
    ListToolsRequestSchema: listSchema,
    CallToolRequestSchema: callSchema,
  };
  return fixture;
}

function promiseWithResolvers<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
