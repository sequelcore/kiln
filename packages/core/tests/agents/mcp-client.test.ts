import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpClient } from "../../src/agents/mcp-client.js";
import type { McpServerConfig } from "../../src/engine/domain/mcp-config.js";

const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    connect = mockConnect;
    close = mockClose;
    listTools = mockListTools;
    callTool = mockCallTool;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockTransport {},
}));

describe("McpClient", () => {
  const config: McpServerConfig = {
    name: "test-mcp-server",
    url: "https://example.com/mcp",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("discoverTools", () => {
    it("maps MCP tools to Capabilities", async () => {
      const client = new McpClient(config);

      mockListTools.mockResolvedValue({
        tools: [
          { name: "search", description: "Search the web", inputSchema: { type: "object" } },
          { name: "email", description: "Send email", inputSchema: { type: "object", properties: { to: { type: "string" } } } },
        ],
      });

      const tools = await client.discoverTools();

      expect(tools).toHaveLength(2);
      expect(tools[0]?.name).toBe("search");
      expect(tools[0]?.description).toBe("Search the web");
      expect(tools[0]?.tags).toContain("mcp");
      expect(tools[0]?.tags).toContain("test-mcp-server");
    });

    it("maps MCP annotation hints correctly", async () => {
      const client = new McpClient(config);

      mockListTools.mockResolvedValue({
        tools: [
          {
            name: "safe-read",
            description: "Read file",
            inputSchema: {},
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
          },
        ],
      });

      const tools = await client.discoverTools();

      expect(tools[0]?.annotations?.readOnly).toBe(true);
      expect(tools[0]?.annotations?.destructive).toBe(false);
      expect(tools[0]?.annotations?.idempotent).toBe(true);
    });

    it("throws MCP_DISCOVERY_FAILED on SDK error", async () => {
      const client = new McpClient(config);

      mockListTools.mockRejectedValue(new Error("Connection refused"));

      await expect(client.discoverTools()).rejects.toThrow("Failed to discover tools");
    });
  });

  describe("executeTool", () => {
    it("calls tool and returns parsed JSON", async () => {
      const client = new McpClient(config);

      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: '{"status": "ok"}' }],
      });

      const result = await client.executeTool("search", { query: "test" });

      expect(result).toEqual({ status: "ok" });
      expect(mockCallTool).toHaveBeenCalledWith(
        { name: "search", arguments: { query: "test" } },
        undefined,
        expect.objectContaining({
          timeout: 120_000,
          resetTimeoutOnProgress: true,
          onprogress: expect.any(Function),
        }),
      );
    });

    it("extends the MCP request timeout from millisecond tool timeout arguments", async () => {
      const client = new McpClient(config);

      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: '{"status": "ok"}' }],
      });

      await client.executeTool("bash", { command: "bun run test", timeout: 360_000 });

      expect(mockCallTool).toHaveBeenCalledWith(
        { name: "bash", arguments: { command: "bun run test", timeout: 360_000 } },
        undefined,
        expect.objectContaining({
          timeout: 390_000,
          resetTimeoutOnProgress: true,
          onprogress: expect.any(Function),
        }),
      );
    });

    it("honors explicit MCP request timeout config", async () => {
      const client = new McpClient({ ...config, requestTimeoutMs: 500_000 });

      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: '{"status": "ok"}' }],
      });

      await client.executeTool("bash", { command: "bun run test", timeout: 360_000 });

      expect(mockCallTool).toHaveBeenCalledWith(
        { name: "bash", arguments: { command: "bun run test", timeout: 360_000 } },
        undefined,
        expect.objectContaining({
          timeout: 500_000,
        }),
      );
    });

    it("returns text when not JSON", async () => {
      const client = new McpClient(config);

      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: "Plain text result" }],
      });

      const result = await client.executeTool("search", { query: "test" });

      expect(result).toBe("Plain text result");
    });

    it("throws MCP_SERVER_ERROR on tool error", async () => {
      const client = new McpClient(config);

      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: "Tool failed" }],
        isError: true,
      });

      await expect(client.executeTool("search", { query: "test" })).rejects.toThrow("Tool failed");
    });

    it("returns content array for multi-block responses", async () => {
      const client = new McpClient(config);

      mockCallTool.mockResolvedValue({
        content: [
          { type: "text", text: "Line 1" },
          { type: "text", text: "Line 2" },
        ],
      });

      const result = await client.executeTool("search", { query: "test" });

      expect(result).toEqual([
        { type: "text", text: "Line 1" },
        { type: "text", text: "Line 2" },
      ]);
    });

    it("throws MCP_SERVER_ERROR on SDK error", async () => {
      const client = new McpClient(config);

      mockCallTool.mockRejectedValue(new Error("Timeout"));

      await expect(client.executeTool("search", {})).rejects.toThrow("Tool execution failed");
    });
  });

  describe("connect/disconnect", () => {
    it("connects via StreamableHTTPClientTransport", async () => {
      const client = new McpClient(config);

      await client.connect();

      expect(mockConnect).toHaveBeenCalled();
    });

    it("throws MCP_CONNECTION_FAILED when url is empty", async () => {
      const badConfig: McpServerConfig = { name: "bad", url: "" };
      const client = new McpClient(badConfig);

      await expect(client.connect()).rejects.toThrow("MCP server URL is required");
    });

    it("disconnects cleanly", async () => {
      const client = new McpClient(config);
      await client.connect();

      await client.disconnect();

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe("constructor", () => {
    it("stores server name", () => {
      const client = new McpClient(config);
      expect(client.serverName).toBe("test-mcp-server");
    });
  });
});
