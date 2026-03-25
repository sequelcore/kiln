import { IncomingMessage, ServerResponse, createServer, type Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export type TransportType = "stdio" | "sse";

export interface TransportConfig {
  readonly type: TransportType;
  readonly port?: number; // SSE only, default 3001
}

export interface StdioTransportResult {
  readonly type: "stdio";
  readonly transport: StdioServerTransport;
}

export interface SSETransportResult {
  readonly type: "sse";
  readonly httpServer: Server;
  /**
   * Attach an MCP server factory so each SSE client connection
   * gets its own McpServer instance with tools registered.
   *
   * SSEServerTransport requires a live ServerResponse at construction,
   * so transports are created per-connection, not upfront.
   */
  readonly attachServerFactory: (factory: () => McpServer) => void;
}

export type TransportResult = StdioTransportResult | SSETransportResult;

export function createStdioTransport(): StdioTransportResult {
  return { type: "stdio", transport: new StdioServerTransport() };
}

export function createSSETransport(port: number = 3001): SSETransportResult {
  const transports = new Map<string, SSEServerTransport>();
  let serverFactory: (() => McpServer) | null = null;

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const baseUrl = getRequestBaseUrl(req, httpServer);
    const url = new URL(req.url ?? "/", baseUrl);

    if (req.method === "GET" && url.pathname === "/sse") {
      if (!serverFactory) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("Server not ready");
        return;
      }

      try {
        const transport = new SSEServerTransport("/message", res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);

        transport.onclose = () => {
          transports.delete(sessionId);
        };

        const mcpServer = serverFactory();
        await mcpServer.connect(transport);
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Error establishing SSE stream");
        }
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/message") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing sessionId parameter");
        return;
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Session not found");
        return;
      }

      try {
        // Read the request body
        const body = await readBody(req);
        const parsed: unknown = JSON.parse(body);
        await transport.handlePostMessage(req, res, parsed);
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Error handling message");
        }
      }
      return;
    }

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", sessions: transports.size }));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  httpServer.listen(port);

  // On server close, clean up all transports
  httpServer.on("close", () => {
    for (const transport of transports.values()) {
      transport.close().catch(() => {});
    }
    transports.clear();
  });

  return {
    type: "sse",
    httpServer,
    attachServerFactory: (factory: () => McpServer) => {
      serverFactory = factory;
    },
  };
}

function getRequestBaseUrl(req: IncomingMessage, server: Server): string {
  const hostHeader = req.headers.host;
  if (hostHeader) {
    return `http://${hostHeader}`;
  }

  const address = server.address();
  if (address && typeof address === "object") {
    return `http://127.0.0.1:${address.port}`;
  }

  return "http://127.0.0.1";
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
