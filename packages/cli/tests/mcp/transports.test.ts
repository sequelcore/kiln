import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { createStdioTransport, createSSETransport } from "../../src/mcp/transports.js";

describe("transports", () => {
  const servers: Server[] = [];

  afterEach(() => {
    for (const s of servers) {
      s.close();
    }
    servers.length = 0;
  });

  describe("createStdioTransport", () => {
    it("returns a stdio transport result", () => {
      const result = createStdioTransport();
      expect(result.type).toBe("stdio");
      expect(result.transport).toBeDefined();
    });
  });

  describe("createSSETransport", () => {
    it("creates HTTP server with SSE result type", () => {
      const result = createSSETransport(0); // port 0 = OS-assigned
      servers.push(result.httpServer);
      expect(result.type).toBe("sse");
      expect(result.httpServer).toBeDefined();
      expect(typeof result.attachServerFactory).toBe("function");
    });

    it("HTTP server is listening after creation", (ctx) => {
      return new Promise<void>((resolve, reject) => {
        const result = createSSETransport(0);
        servers.push(result.httpServer);

        // Server should be listening -- check via the listening event or address
        result.httpServer.on("listening", () => {
          const addr = result.httpServer.address();
          expect(addr).not.toBeNull();
          resolve();
        });

        // If already listening, resolve immediately
        if (result.httpServer.listening) {
          const addr = result.httpServer.address();
          expect(addr).not.toBeNull();
          resolve();
        }

        setTimeout(() => reject(new Error("Server did not start listening")), 2000);
      });
    });

    it("responds 404 for unknown routes", async () => {
      const result = createSSETransport(0);
      servers.push(result.httpServer);

      await waitForListening(result.httpServer);
      const port = getPort(result.httpServer);

      const res = await fetch(`http://localhost:${port}/unknown`);
      expect(res.status).toBe(404);
    });

    it("responds 200 on /health", async () => {
      const result = createSSETransport(0);
      servers.push(result.httpServer);

      await waitForListening(result.httpServer);
      const port = getPort(result.httpServer);

      const res = await fetch(`http://localhost:${port}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; sessions: number };
      expect(body.status).toBe("ok");
      expect(body.sessions).toBe(0);
    });

    it("responds 503 on /sse when no server factory attached", async () => {
      const result = createSSETransport(0);
      servers.push(result.httpServer);

      await waitForListening(result.httpServer);
      const port = getPort(result.httpServer);

      const res = await fetch(`http://localhost:${port}/sse`);
      expect(res.status).toBe(503);
    });

    it("responds 400 on POST /message without sessionId", async () => {
      const result = createSSETransport(0);
      servers.push(result.httpServer);

      await waitForListening(result.httpServer);
      const port = getPort(result.httpServer);

      const res = await fetch(`http://localhost:${port}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(400);
    });

    it("responds 404 on POST /message with unknown sessionId", async () => {
      const result = createSSETransport(0);
      servers.push(result.httpServer);

      await waitForListening(result.httpServer);
      const port = getPort(result.httpServer);

      const res = await fetch(`http://localhost:${port}/message?sessionId=nonexistent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(404);
    });
  });
});

function waitForListening(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) {
      resolve();
      return;
    }
    server.on("listening", () => resolve());
  });
}

function getPort(server: Server): number {
  const addr = server.address();
  if (addr && typeof addr === "object") {
    return addr.port;
  }
  throw new Error("Server not bound to a port");
}
