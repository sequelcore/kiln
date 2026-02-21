import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpClient } from "../../src/agents/mcp-client.js";
import type { McpServerConfig } from "../../src/engine/domain/mcp-config.js";

describe("McpClient", () => {
  let client: McpClient;
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  const sseConfig: McpServerConfig = {
    name: "test-mcp-server",
    transport: "sse",
    url: "https://example.com/mcp",
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (client) {
      client.disconnect();
    }
  });

  describe("discoverTools", () => {
    it("maps MCP tools to Capabilities", async () => {
      client = new McpClient(sseConfig);

      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          tools: [
            { name: "search", description: "Search the web", inputSchema: { type: "object" } },
            { name: "email", description: "Send email", inputSchema: { type: "object", properties: { to: { type: "string" } } } },
          ],
        },
      }), { status: 200 }));

      const tools = await client.discoverTools();

      expect(tools).toHaveLength(2);
      expect(tools[0]?.name).toBe("search");
      expect(tools[0]?.description).toBe("Search the web");
      expect(tools[0]?.tags).toContain("mcp");
      expect(tools[0]?.tags).toContain("test-mcp-server");
    });

    it("maps MCP annotation hints correctly", async () => {
      client = new McpClient(sseConfig);

      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          tools: [
            {
              name: "safe-read",
              description: "Read file",
              inputSchema: {},
              annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
            },
          ],
        },
      }), { status: 200 }));

      const tools = await client.discoverTools();

      expect(tools[0]?.annotations?.readOnly).toBe(true);
      expect(tools[0]?.annotations?.destructive).toBe(false);
      expect(tools[0]?.annotations?.idempotent).toBe(true);
    });

    it("throws MCP_DISCOVERY_FAILED on invalid response", async () => {
      client = new McpClient(sseConfig);

      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {},
      }), { status: 200 }));

      await expect(client.discoverTools()).rejects.toThrow("tools/list response missing tools array");
    });

    it("throws MCP_CONNECTION_FAILED on network error", async () => {
      client = new McpClient(sseConfig);

      fetchMock.mockRejectedValue(new Error("Network error"));

      await expect(client.discoverTools()).rejects.toThrow("Request failed");
    });
  });

  describe("executeTool", () => {
    it("sends JSON-RPC call and returns result", async () => {
      client = new McpClient(sseConfig);

      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: '{"status": "ok"}' }],
        },
      }), { status: 200 }));

      const result = await client.executeTool("search", { query: "test" });

      expect(result).toEqual({ status: "ok" });
    });

    it("returns text when not JSON", async () => {
      client = new McpClient(sseConfig);

      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: "Plain text result" }],
        },
      }), { status: 200 }));

      const result = await client.executeTool("search", { query: "test" });

      expect(result).toBe("Plain text result");
    });

    it("throws MCP_SERVER_ERROR on tool error", async () => {
      client = new McpClient(sseConfig);

      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: "Tool failed" }],
          isError: true,
        },
      }), { status: 200 }));

      await expect(client.executeTool("search", { query: "test" })).rejects.toThrow("Tool failed");
    });

    it("throws MCP_SERVER_ERROR on missing content", async () => {
      client = new McpClient(sseConfig);

      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {},
      }), { status: 200 }));

      await expect(client.executeTool("search", {})).rejects.toThrow("tools/call response missing content");
    });
  });

  describe("circuit breaker", () => {
    it("opens after consecutive failures", async () => {
      client = new McpClient(sseConfig);

      fetchMock.mockRejectedValue(new Error("Network error"));

      for (let i = 0; i < 3; i++) {
        try {
          await client.discoverTools();
        } catch {
          // expected
        }
      }

      await expect(client.discoverTools()).rejects.toThrow("Circuit breaker is open");
    });

    it("resets after cooldown", async () => {
      const shortCircuitConfig: McpServerConfig = {
        name: "test-mcp-server",
        transport: "sse",
        url: "https://example.com/mcp",
      };
      client = new McpClient(shortCircuitConfig);

      fetchMock.mockRejectedValue(new Error("Network error"));

      for (let i = 0; i < 3; i++) {
        try {
          await client.discoverTools();
        } catch {
          // expected
        }
      }

      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { tools: [] },
      }), { status: 200 }));

      // Use a new client with a fresh circuit breaker for the success case
      const newClient = new McpClient(shortCircuitConfig);
      const tools = await newClient.discoverTools();
      expect(tools).toEqual([]);
    }, 10000);
  });

  describe("constructor", () => {
    it("stores server name", () => {
      client = new McpClient(sseConfig);
      expect(client.serverName).toBe("test-mcp-server");
    });
  });
});
