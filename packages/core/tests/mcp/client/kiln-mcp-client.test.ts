import { describe, expect, it, vi } from "vitest";
import type { ResolvedMcpServer } from "../../../src/mcp/index.js";
import {
  KilnMcpClient,
  KilnMcpClientError,
  McpCapabilityRegistry,
  type McpSdkClient,
  type McpTransportHandle,
} from "../../../src/mcp/client/index.js";

function server(overrides: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
  return {
    id: "fixture",
    enabled: true,
    transport: "stdio",
    command: "cmd.exe",
    args: ["/c", "C:\\Program Files\\Fixture MCP\\server.bat", "argument with spaces"],
    source: "project",
    provenance: {},
    connection: { state: "not-tested" },
    projection: { state: "not-synchronized" },
    admission: { state: "admitted" },
    ...overrides,
  };
}

function sdkClient(overrides: Partial<McpSdkClient> = {}): McpSdkClient {
  return {
    connect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    listTools: vi.fn(async () => ({
      tools: [{ name: "same-name", description: "Untrusted text", inputSchema: { type: "object" } }],
    })),
    listResources: vi.fn(async () => ({
      resources: [{ uri: "fixture://state", name: "state" }],
    })),
    listPrompts: vi.fn(async () => ({ prompts: [{ name: "inspect" }] })),
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
    readResource: vi.fn(async () => ({ contents: [{ uri: "fixture://state", text: "ready" }] })),
    getPrompt: vi.fn(async () => ({ messages: [{ role: "user", content: { type: "text", text: "inspect" } }] })),
    ...overrides,
  };
}

describe("KilnMcpClient", () => {
  it("passes stdio command and arguments as an array without string splitting", async () => {
    const sdk = sdkClient();
    const makeTransport = vi.fn((): McpTransportHandle => ({ close: vi.fn(async () => undefined) }));
    const client = new KilnMcpClient(server(), { sdkClient: sdk, makeTransport });

    await client.connect();

    expect(makeTransport).toHaveBeenCalledWith(expect.objectContaining({
      kind: "stdio",
      command: "cmd.exe",
      args: ["/c", "C:\\Program Files\\Fixture MCP\\server.bat", "argument with spaces"],
    }));
  });

  it("closes every transport across explicit reconnect cycles", async () => {
    const sdk = sdkClient();
    const transports = [
      { close: vi.fn(async () => undefined) },
      { close: vi.fn(async () => undefined) },
    ];
    const makeTransport = vi.fn(() => transports.shift()!);
    const client = new KilnMcpClient(server(), { sdkClient: sdk, makeTransport });

    await client.connect();
    const first = makeTransport.mock.results[0]?.value as McpTransportHandle;
    await client.disconnect();
    await client.connect();
    const second = makeTransport.mock.results[1]?.value as McpTransportHandle;
    await client.disconnect();

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(sdk.close).toHaveBeenCalledTimes(2);
  });

  it("discovers tools, resources, and prompts with qualified collision-safe selectors", async () => {
    const client = new KilnMcpClient(server(), { sdkClient: sdkClient(), makeTransport: () => ({ close: async () => undefined }) });

    const discovery = await client.discover();

    expect(discovery.tools[0]?.selector).toBe("mcp:fixture:tool:same-name");
    expect(discovery.resources[0]?.selector).toBe("mcp:fixture:resource:fixture%3A%2F%2Fstate");
    expect(discovery.prompts[0]?.selector).toBe("mcp:fixture:prompt:inspect");
    expect(discovery.tools[0]?.annotations).toBeUndefined();
  });

  it("calls, reads, and gets capabilities using qualified selectors", async () => {
    const sdk = sdkClient();
    const client = new KilnMcpClient(server(), { sdkClient: sdk, makeTransport: () => ({ close: async () => undefined }) });

    await expect(client.callTool("mcp:fixture:tool:same-name", { value: 1 })).resolves.toMatchObject({ content: [{ text: "ok" }] });
    await expect(client.readResource("mcp:fixture:resource:fixture%3A%2F%2Fstate")).resolves.toMatchObject({ contents: [{ text: "ready" }] });
    await expect(client.getPrompt("mcp:fixture:prompt:inspect", { detail: "short" })).resolves.toMatchObject({ messages: expect.any(Array) });
    expect(sdk.callTool).toHaveBeenCalledWith({ name: "same-name", arguments: { value: 1 } }, undefined, expect.objectContaining({ timeout: 120_000 }));
  });

  it("projects admitted resources and prompts as qualified provider capabilities and dispatches by kind", async () => {
    const sdk = sdkClient();
    const client = new KilnMcpClient(server(), { sdkClient: sdk, makeTransport: () => ({ close: async () => undefined }) });

    const capabilities = await client.discoverProviderCapabilities();

    expect(capabilities.map((capability) => capability.name)).toEqual(expect.arrayContaining([
      "mcp:fixture:tool:same-name",
      "mcp:fixture:resource:fixture%3A%2F%2Fstate",
      "mcp:fixture:prompt:inspect",
    ]));
    await client.executeCapability("mcp:fixture:resource:fixture%3A%2F%2Fstate", {});
    await client.executeCapability("mcp:fixture:prompt:inspect", { detail: "short" });
    expect(sdk.readResource).toHaveBeenCalledWith({ uri: "fixture://state" }, expect.anything());
    expect(sdk.getPrompt).toHaveBeenCalledWith({ name: "inspect", arguments: { detail: "short" } }, expect.anything());
  });

  it("rejects oversized external responses before they enter the runtime transcript", async () => {
    const client = new KilnMcpClient(server(), {
      sdkClient: sdkClient({ callTool: vi.fn(async () => ({ content: [{ type: "text", text: "x".repeat(1_100_000) }] })) }),
      makeTransport: () => ({ close: async () => undefined }),
    });
    await expect(client.callTool("mcp:fixture:tool:same-name", {})).rejects.toMatchObject({ code: "MCP_RESPONSE_TOO_LARGE" });
  });

  it("fails closed when discovery exceeds the bounded capability catalog", async () => {
    const client = new KilnMcpClient(server({ maxCapabilities: 2 }), {
      sdkClient: sdkClient(),
      makeTransport: () => ({ close: async () => undefined }),
    });

    await expect(client.discover()).rejects.toMatchObject({ code: "MCP_CATALOG_LIMIT_EXCEEDED" });
  });

  it("filters discovery and blocks external calls outside canonical capability admission", async () => {
    const sdk = sdkClient({
      listTools: vi.fn(async () => ({
        tools: [
          { name: "allowed", inputSchema: {} },
          { name: "denied", inputSchema: {} },
        ],
      })),
    });
    const client = new KilnMcpClient(server({
      admission: { state: "admitted", tools: { allow: ["allowed"] } },
    }), { sdkClient: sdk, makeTransport: () => ({ close: async () => undefined }) });

    const discovery = await client.discover();

    expect(discovery.tools.map((tool) => tool.descriptor.name)).toEqual(["allowed"]);
    await expect(client.callTool("mcp:fixture:tool:denied", {})).rejects.toMatchObject({ code: "MCP_NOT_ADMITTED" });
    expect(sdk.callTool).not.toHaveBeenCalled();
  });

  it("ignores untrusted annotations for authority and uses only operator-owned effect policy", async () => {
    const sdk = sdkClient({
      listTools: vi.fn(async () => ({
        tools: [{ name: "same-name", inputSchema: {}, annotations: { readOnlyHint: true } }],
      })),
    });
    const conservative = new KilnMcpClient(server(), { sdkClient: sdk, makeTransport: () => ({ close: async () => undefined }) });
    expect((await conservative.discoverTools())[0]?.effectEnvelope?.operation).toBe("mutate");

    const readOnly = new KilnMcpClient(server({
      admission: {
        state: "admitted",
        effects: {
          "same-name": {
            operation: "observe",
            boundaries: ["external-system"],
            reversibility: "reversible",
            dataEgress: "none",
            identityUse: "none",
            consequences: [],
            idempotency: "idempotent",
          },
        },
      },
    }), { sdkClient: sdkClient(), makeTransport: () => ({ close: async () => undefined }) });
    expect((await readOnly.discoverTools())[0]?.effectEnvelope?.operation).toBe("observe");
  });

  it("passes cancellation and configured request timeout to every request", async () => {
    const sdk = sdkClient();
    const client = new KilnMcpClient(server({ requestTimeoutMs: 25 }), { sdkClient: sdk, makeTransport: () => ({ close: async () => undefined }) });
    const controller = new AbortController();

    await client.discover({ signal: controller.signal });

    expect(sdk.listTools).toHaveBeenCalledWith(undefined, expect.objectContaining({ signal: controller.signal, timeout: 25 }));
    expect(sdk.listResources).toHaveBeenCalledWith(undefined, expect.objectContaining({ signal: controller.signal, timeout: 25 }));
    expect(sdk.listPrompts).toHaveBeenCalledWith(undefined, expect.objectContaining({ signal: controller.signal, timeout: 25 }));
  });

  it("closes a transport when startup times out and reports no command or secret", async () => {
    const transport = { close: vi.fn(async () => undefined) };
    const sdk = sdkClient({ connect: vi.fn(() => new Promise<void>(() => undefined)) });
    const client = new KilnMcpClient(server({ startupTimeoutMs: 5, command: "secret-command" }), {
      sdkClient: sdk,
      makeTransport: () => transport,
    });

    const failure = await client.connect().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(KilnMcpClientError);
    expect((failure as Error).message).toBe("MCP server fixture did not start within its configured timeout");
    expect((failure as Error).message).not.toContain("secret-command");
    expect(transport.close).toHaveBeenCalled();
  });

  it("resolves HTTP header references without exposing values in failures", async () => {
    const makeTransport = vi.fn((): McpTransportHandle => ({ close: vi.fn(async () => undefined) }));
    const sdk = sdkClient({ connect: vi.fn(async () => { throw new Error("Bearer super-secret"); }) });
    const client = new KilnMcpClient(server({
      transport: "streamable-http",
      command: undefined,
      args: undefined,
      url: "https://example.invalid/mcp",
      headers: { Authorization: { fromCredential: "fixture-token" } },
    }), {
      sdkClient: sdk,
      makeTransport,
      credentialResolver: () => "super-secret",
    });

    const failure = await client.connect().catch((error: unknown) => error);

    expect(makeTransport).toHaveBeenCalledWith(expect.objectContaining({ headers: { Authorization: "super-secret" } }));
    expect((failure as Error).message).not.toContain("super-secret");
    expect((failure as Error).message).not.toContain("example.invalid");
  });

  it("refreshes discovery when the SDK reports a capability-list change", async () => {
    let changed: (() => Promise<void>) | undefined;
    const sdk = sdkClient();
    const onDiscoveryChanged = vi.fn();
    const client = new KilnMcpClient(server(), {
      sdkClient: sdk,
      makeTransport: () => ({ close: async () => undefined }),
      installListChangedHandler: (handler) => { changed = handler; },
      onDiscoveryChanged,
    });
    await client.connect();

    await changed?.();

    expect(onDiscoveryChanged).toHaveBeenCalledWith(expect.objectContaining({ tools: expect.any(Array) }));
    await expect(client.executeCapability("mcp:fixture:tool:same-name", {})).rejects.toMatchObject({ code: "MCP_CATALOG_CHANGED" });
  });

  it("disconnect is idempotent and prevents transport orphans", async () => {
    const transport = { close: vi.fn(async () => undefined) };
    const sdk = sdkClient();
    const client = new KilnMcpClient(server(), { sdkClient: sdk, makeTransport: () => transport });
    await client.connect();

    await Promise.all([client.disconnect(), client.disconnect()]);

    expect(sdk.close).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalled();
  });
});

describe("McpCapabilityRegistry", () => {
  it("routes identical capability names to the explicitly qualified server", async () => {
    const firstSdk = sdkClient();
    const secondSdk = sdkClient();
    const registry = new McpCapabilityRegistry([
      new KilnMcpClient(server({ id: "first" }), { sdkClient: firstSdk, makeTransport: () => ({ close: async () => undefined }) }),
      new KilnMcpClient(server({ id: "second" }), { sdkClient: secondSdk, makeTransport: () => ({ close: async () => undefined }) }),
    ]);
    await registry.discover();

    await registry.callTool("mcp:second:tool:same-name", {});

    expect(firstSdk.callTool).not.toHaveBeenCalled();
    expect(secondSdk.callTool).toHaveBeenCalled();
    await expect(registry.callTool("same-name", {})).rejects.toThrow("qualified");
  });
});
