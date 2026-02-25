/**
 * Kiln MCP Server -- exposes memory, phases, and cost tools
 * to Claude Code (or any MCP client) during an active session.
 */

/** MCP tool names exposed by Kiln */
export type KilnTool =
  | "kiln_init"
  | "kiln_phase_start"
  | "kiln_memory_save"
  | "kiln_memory_recall"
  | "kiln_memory_search"
  | "kiln_cost_track"
  | "kiln_cost_summary";

/** MCP tool registration */
export interface McpToolDefinition {
  readonly name: KilnTool;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
  };
}

/** All tools the MCP server exposes */
export const KILN_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "kiln_init",
    description: "Initialize a Kiln session. Returns the session ID and current orchestrator status.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "kiln_phase_start",
    description: "Advance the orchestrator to the next phase. Returns the new phase name.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "kiln_memory_save",
    description: "Save an insight, pattern, or decision to persistent memory. The agent decides what is worth saving.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The insight or pattern to save" },
        layer: { type: "string", enum: ["user", "agent", "project"], description: "Which memory layer to save to" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
      },
      required: ["content", "layer"],
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  {
    name: "kiln_memory_recall",
    description: "Retrieve relevant memories for the current task. Searches all 3 layers with progressive disclosure.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        layer: { type: "string", enum: ["user", "agent", "project", "all"], description: "Which layer(s) to search" },
        limit: { type: "number", description: "Max results to return" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "kiln_memory_search",
    description: "Full-text search across all memory layers. Returns matching entries ranked by relevance.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results to return" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "kiln_cost_track",
    description: "Record token usage for a specific agent role.",
    inputSchema: {
      type: "object",
      properties: {
        role: { type: "string", description: "Agent role (e.g. architect, worker, optimizer)" },
        model: { type: "string", description: "Model identifier for cost calculation" },
        inputTokens: { type: "number" },
        outputTokens: { type: "number" },
        cacheReadTokens: { type: "number" },
      },
      required: ["role", "model", "inputTokens", "outputTokens"],
    },
  },
  {
    name: "kiln_cost_summary",
    description: "Get the current cost breakdown by role.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
] as const;

export { KilnMcpServer } from "./server.js";
export type { McpServerInfo } from "./server.js";
export type { TransportType, TransportConfig, TransportResult } from "./transports.js";
export { createStdioTransport, createSSETransport } from "./transports.js";
export { generateConfig } from "./config-generator.js";
export type { McpClient, McpClientConfig } from "./config-generator.js";

/**
 * When run directly by Claude Code (via MCP config), start a stdio MCP server.
 * This is the entry point that Claude Code spawns as a subprocess.
 */
if (import.meta.main) {
  const { Orchestrator } = await import("@kilnai/core");
  const { KilnMcpServer } = await import("./server.js");

  const orchestrator = new Orchestrator();
  const server = new KilnMcpServer(orchestrator);

  console.error("[kiln-mcp] Starting stdio MCP server...");

  try {
    await server.start({ type: "stdio" });
    console.error("[kiln-mcp] MCP server connected via stdio");
  } catch (err) {
    console.error("[kiln-mcp] Failed to start MCP server:", err);
    process.exit(1);
  }
}
