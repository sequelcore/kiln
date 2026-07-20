import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  EventBus,
  KilnMcpClient,
  textParts,
  type AuditLog,
  type ProviderAdapter,
  type ResolvedMcpServer,
  type ToolAuthorizer,
} from "@kilnai/core";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

const stdioFixture = fileURLToPath(new URL("../../../core/tests/mcp/client/fixtures/stdio-server.mjs", import.meta.url));

function resolvedServer(id: string, transport: ResolvedMcpServer["transport"], connection: Partial<ResolvedMcpServer>): ResolvedMcpServer {
  return {
    id, enabled: true, transport, admission: { state: "admitted" }, source: "project", provenance: {},
    connection: { state: "not-tested" }, projection: { state: "not-synchronized" },
    startupTimeoutMs: 2_000, requestTimeoutMs: 500, ...connection,
  };
}

function toolCallProvider(selector: string): ProviderAdapter {
  let round = 0;
  return {
    name: "fixture-model",
    createMessage: vi.fn(async () => {
      round += 1;
      return round === 1
        ? { parts: textParts("calling"), inputTokens: 2, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, toolCalls: [{ id: "mcp-call-1", name: selector, input: { value: "hello" } }], stopReason: "tool_use" }
        : { parts: textParts("observed result"), inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, toolCalls: [], stopReason: "end_turn" };
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

async function runModelToolCall(client: KilnMcpClient, selector: string, allowed: boolean) {
  const capabilities = await client.discoverProviderCapabilities();
  const capability = capabilities.find((entry) => entry.name === selector);
  if (!capability) throw new Error(`Fixture capability '${selector}' was not discovered.`);
  const eventBus = new EventBus(100);
  const append = vi.fn();
  const auditLog: AuditLog = { append };
  const authorizer: ToolAuthorizer = {
    authorize: vi.fn(() => ({ level: allowed ? 1 : 4, allowed, requiresApproval: false, reason: allowed ? "fixture read admitted" : "fixture denied" })),
  };
  const provider = toolCallProvider(selector);
  const orchestrator = new RuntimeSessionOrchestrator({
    provider,
    tools: capabilities.map((entry) => ({ name: entry.name, description: entry.description, inputSchema: entry.schema, tags: new Set(entry.tags) })),
    capabilityMap: new Map(capabilities.map((entry) => [entry.name, entry])),
    mcpClients: [client],
    toolAuthorizer: authorizer,
    auditLog,
    eventBus,
  });
  const result = await orchestrator.processMessage(
    new RuntimeSession({ appName: "mcp-e2e", tenantId: "tenant-a", userId: "operator", systemPrompt: "Use admitted tools." }),
    textParts("Use the fixture."),
  );
  return { result, provider, append, eventBus };
}

describe("canonical MCP execution end to end", () => {
  it("discovers, authorizes, executes, transcripts, and audits a real stdio tool call", async () => {
    const server = resolvedServer("stdio-fixture", "stdio", { command: process.execPath, args: [stdioFixture] });
    const client = new KilnMcpClient(server);
    try {
      const evidence = await runModelToolCall(client, "mcp:stdio-fixture:tool:echo", true);
      expect(evidence.result.toolExecutions).toContainEqual(expect.objectContaining({ toolName: "mcp:stdio-fixture:tool:echo", success: true }));
      expect(evidence.eventBus.history()).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "tool_called", toolName: "mcp:stdio-fixture:tool:echo" }),
        expect.objectContaining({ type: "tool_result", toolName: "mcp:stdio-fixture:tool:echo", success: true }),
      ]));
      expect(evidence.append).toHaveBeenCalledWith(expect.objectContaining({ action: "tool_execution", outcome: "success", resource: "mcp:stdio-fixture:tool:echo" }));
      expect((evidence.provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]).toEqual(expect.objectContaining({ messages: expect.any(Array) }));
    } finally {
      await client.disconnect();
    }
  });

  it("blocks a denied stdio tool before the MCP client performs external execution", async () => {
    const client = new KilnMcpClient(resolvedServer("stdio-fixture", "stdio", { command: process.execPath, args: [stdioFixture] }));
    try {
      const execute = vi.spyOn(client, "executeCapability");
      const evidence = await runModelToolCall(client, "mcp:stdio-fixture:tool:echo", false);
      expect(execute).not.toHaveBeenCalled();
      expect(evidence.result.toolExecutions).toContainEqual(expect.objectContaining({ success: false, resultSummary: expect.stringContaining("Authorization denied") }));
      expect(evidence.append).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error", metadata: expect.objectContaining({ authorityAllowed: false }) }));
    } finally {
      await client.disconnect();
    }
  });

  it("executes the equivalent admitted path over Streamable HTTP", async () => {
    const httpServer = createServer(async (request, response) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const sdkServer = new Server({ name: "http-e2e", version: "1.0.0" }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
      sdkServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "echo", inputSchema: { type: "object" } }] }));
      sdkServer.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
      sdkServer.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
      sdkServer.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "http-ok" }] }));
      await sdkServer.connect(transport);
      await transport.handleRequest(request, response);
      response.on("close", () => { void transport.close(); void sdkServer.close(); });
    });
    httpServer.listen(0, "127.0.0.1");
    await once(httpServer, "listening");
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("HTTP fixture did not bind.");
    const client = new KilnMcpClient(resolvedServer("http-fixture", "streamable-http", { url: `http://127.0.0.1:${address.port}/mcp` }));
    try {
      const evidence = await runModelToolCall(client, "mcp:http-fixture:tool:echo", true);
      expect(evidence.result.toolExecutions).toContainEqual(expect.objectContaining({ toolName: "mcp:http-fixture:tool:echo", success: true }));
      expect(evidence.append).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
    } finally {
      await client.disconnect();
      httpServer.close();
      await once(httpServer, "close");
    }
  });
});
