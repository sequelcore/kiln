import { createServer } from "node:http";
import { once } from "node:events";
import { createMcpHandler, Server } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { ResolvedMcpServer } from "../../../src/mcp/index.js";
import { KilnMcpClient, KilnMcpClientError } from "../../../src/mcp/client/index.js";

describe("KilnMcpClient Streamable HTTP integration", () => {
  it("rejects a legacy initialize opening instead of exposing a v1 route", async () => {
    const handler = createMcpHandler(() => createFixtureServer(), { legacy: "reject", responseMode: "auto" });
    try {
      const response = await handler.fetch(new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "legacy-client", version: "1.0.0" },
          },
        }),
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: -32022, data: { supported: ["2026-07-28"] } },
      });
    } finally {
      await handler.close();
    }
  });

  it("connects, discovers, sends referenced headers, and enforces request timeout", async () => {
    let observedAuthorization: string | undefined;
    const handler = createMcpHandler(() => createFixtureServer(), { legacy: "reject", responseMode: "auto" });
    const httpServer = createServer(async (request, response) => {
      observedAuthorization = request.headers.authorization;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const webRequest = new Request(`http://${request.headers.host ?? "127.0.0.1"}${request.url ?? "/mcp"}`, {
        method: request.method,
        headers: request.headers as Record<string, string>,
        body: body.length > 0 ? body : undefined,
      });
      const webResponse = await handler.fetch(webRequest);
      response.statusCode = webResponse.status;
      webResponse.headers.forEach((value, key) => response.setHeader(key, value));
      response.end(Buffer.from(await webResponse.arrayBuffer()));
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
      await handler.close();
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
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      supportedProtocolVersions: ["2026-07-28"],
    },
  );
  server.setRequestHandler("tools/list", async () => ({
    tools: [{ name: "echo", inputSchema: { type: "object" } }, { name: "wait", inputSchema: { type: "object" } }],
  }));
  server.setRequestHandler("resources/list", async () => ({ resources: [] }));
  server.setRequestHandler("prompts/list", async () => ({ prompts: [] }));
  server.setRequestHandler("tools/call", async ({ params }) => {
    if (params.name === "wait") await new Promise((resolve) => setTimeout(resolve, 1_000));
    return { content: [{ type: "text", text: "ok" }] };
  });
  return server;
}
