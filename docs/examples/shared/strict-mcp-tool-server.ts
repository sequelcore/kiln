import { Server, createMcpHandler } from "@modelcontextprotocol/server";

const MCP_PROTOCOL_REVISION = "2026-07-28" as const;

export interface ExampleMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: { readonly type: "object"; readonly [key: string]: unknown };
}

interface StrictMcpToolServerOptions {
  readonly port: number;
  readonly name: string;
  readonly version: string;
  readonly tools: readonly ExampleMcpTool[];
  readonly executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export function startStrictMcpToolServer(options: StrictMcpToolServerOptions): void {
  const handler = createMcpHandler(
    () => {
      const server = new Server(
        { name: options.name, version: options.version },
        {
          capabilities: { tools: {} },
          supportedProtocolVersions: [MCP_PROTOCOL_REVISION],
        },
      );

      server.setRequestHandler("tools/list", async () => ({ tools: [...options.tools] }));
      server.setRequestHandler("tools/call", async (request) => {
        const params = request.params as { name: string; arguments?: Record<string, unknown> };
        try {
          const result = await options.executeTool(params.name, params.arguments ?? {});
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return {
            content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      });

      return server;
    },
    { legacy: "reject", responseMode: "json" },
  );

  Bun.serve({
    port: options.port,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") {
        return Response.json({ status: "ok", protocolRevision: MCP_PROTOCOL_REVISION });
      }
      if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
      return handler.fetch(request);
    },
  });

  console.log(`MCP ${options.name} server listening on http://localhost:${options.port}/mcp`);
}
