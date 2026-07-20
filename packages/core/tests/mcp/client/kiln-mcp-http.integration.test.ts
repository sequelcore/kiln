import { createServer } from "node:http";
import { once } from "node:events";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { ResolvedMcpServer } from "../../../src/mcp/index.js";
import { KilnMcpClient, KilnMcpClientError } from "../../../src/mcp/client/index.js";

describe("KilnMcpClient Streamable HTTP integration", () => {
  it("connects, discovers, sends referenced headers, and enforces request timeout", async () => {
    let observedAuthorization: string | undefined;
    const httpServer = createServer(async (request, response) => {
      observedAuthorization = request.headers.authorization;
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const sdkServer = createFixtureServer();
      await sdkServer.connect(transport);
      await transport.handleRequest(request, response);
      response.on("close", () => {
        void transport.close();
        void sdkServer.close();
      });
    });
    httpServer.listen(0, "127.0.0.1");
    await once(httpServer, "listening");
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("fixture did not bind");
    const config: ResolvedMcpServer = {
      id: "http-fixture",
      enabled: true,
      transport: "streamable-http",
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: { Authorization: { fromCredential: "fixture-auth" } },
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 200,
      admission: { state: "admitted" },
      source: "project",
      provenance: {},
      connection: { state: "not-tested" },
      projection: { state: "not-synchronized" },
    };
    const client = new KilnMcpClient(config, { credentialResolver: () => "Bearer integration-secret" });
    try {
      const discovery = await client.discover();
      expect(discovery.tools[0]?.selector).toBe("mcp:http-fixture:tool:echo");
      expect(observedAuthorization).toBe("Bearer integration-secret");
      await expect(client.callTool("mcp:http-fixture:tool:wait", {})).rejects.toBeInstanceOf(KilnMcpClientError);
    } finally {
      await client.disconnect();
      httpServer.close();
      await once(httpServer, "close");
    }
  });

  it("redacts URL and header values from HTTP failures", async () => {
    const config: ResolvedMcpServer = {
      id: "unreachable",
      enabled: true,
      transport: "streamable-http",
      url: "http://127.0.0.1:1/private-path",
      headers: { Authorization: { value: "Bearer literal-that-must-not-leak" } },
      startupTimeoutMs: 100,
      admission: { state: "admitted" },
      source: "project",
      provenance: {},
      connection: { state: "not-tested" },
      projection: { state: "not-synchronized" },
    };
    const client = new KilnMcpClient(config);
    const failure = await client.connect().catch((error: unknown) => error);
    expect((failure as Error).message).toBe("MCP server unreachable failed to connect");
    expect((failure as Error).message).not.toContain("private-path");
    expect((failure as Error).message).not.toContain("literal-that-must-not-leak");
  });
});

function createFixtureServer(): Server {
  const server = new Server(
    { name: "http-fixture", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "echo", inputSchema: { type: "object" } }, { name: "wait", inputSchema: { type: "object" } }],
  }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (params.name === "wait") await new Promise((resolve) => setTimeout(resolve, 1_000));
    return { content: [{ type: "text", text: "ok" }] };
  });
  return server;
}
