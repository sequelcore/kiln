/**
 * Kiln MCP Server -- exposes memory, phases, verification, and cost tools
 * to Claude Code (or any MCP client) during an active session.
 */

/** MCP tool names exposed by Kiln */
export type KilnTool =
  | "kiln_init"
  | "kiln_phase_start"
  | "kiln_phase_gate"
  | "kiln_memory_save"
  | "kiln_memory_recall"
  | "kiln_memory_search"
  | "kiln_task_create"
  | "kiln_task_score"
  | "kiln_task_action"
  | "kiln_verify"
  | "kiln_cost_track"
  | "kiln_cost_summary"
  | "kiln_domain_detect";

/** MCP server configuration */
export interface McpServerConfig {
  readonly port: number;
  readonly transport: "stdio" | "sse" | "http";
}

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
    name: "kiln_phase_gate",
    description: "Run quality gate checks for the current phase. Returns pass/fail with violations.",
    inputSchema: {
      type: "object",
      properties: {
        phase: { type: "string", enum: ["analyze", "research", "architect", "implement", "verify", "synthesize"] },
      },
      required: ["phase"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "kiln_task_create",
    description: "Add a task to the exploration tree with priority and parent reference.",
    inputSchema: {
      type: "object",
      properties: {
        statement: { type: "string", description: "Task description" },
        parentId: { type: "string", description: "Parent task ID (null for root)" },
        priority: { type: "number", description: "Priority 0-1" },
      },
      required: ["statement"],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: "kiln_task_score",
    description: "Score a task based on priority, complexity, and evidence. Returns a numeric score 0-1.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID to score" },
      },
      required: ["taskId"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "kiln_task_action",
    description: "Apply a tree action to a task: deepen (create subtask), branch (alternative approach), prune (abandon).",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        action: { type: "string", enum: ["deepen", "branch", "prune"] },
        reason: { type: "string", description: "Why this action was chosen" },
      },
      required: ["taskId", "action"],
    },
  },
  {
    name: "kiln_verify",
    description: "Run the verification loop: tests, lint, types, coverage. Returns pass/fail per check.",
    inputSchema: {
      type: "object",
      properties: {
        checks: { type: "array", items: { type: "string" }, description: "Which checks to run" },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "kiln_cost_track",
    description: "Record token usage for a specific agent role.",
    inputSchema: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["architect", "worker", "optimizer"] },
        inputTokens: { type: "number" },
        outputTokens: { type: "number" },
        cacheReadTokens: { type: "number" },
      },
      required: ["role", "inputTokens", "outputTokens"],
    },
  },
  {
    name: "kiln_cost_summary",
    description: "Get the current cost breakdown by role.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "kiln_domain_detect",
    description: "Auto-detect the project's tech stack from files in the current directory.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
] as const;

export { KilnMcpServer } from "./server.js";
export type { TransportType, TransportConfig, TransportResult } from "./transports.js";
export { createStdioTransport, createSSETransport } from "./transports.js";
export { generateConfig } from "./config-generator.js";
export type { McpClient, McpClientConfig } from "./config-generator.js";

/**
 * When run directly by Claude Code (via MCP config), start a stdio MCP server.
 * This is the entry point that Claude Code spawns as a subprocess.
 */
if (import.meta.main) {
  const { Orchestrator } = await import("@kiln/core");
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
