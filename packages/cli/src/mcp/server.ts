import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Orchestrator, MemoryManager, MemoryLayer } from "@kilnai/core";
import { KILN_TOOLS, type KilnTool } from "./index.js";
import {
  createStdioTransport,
  createSSETransport,
  type TransportConfig,
} from "./transports.js";

type ToolHandler = (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;

function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/**
 * MCP server exposing 7 Kiln tools via stdio or SSE transport.
 * Bridges the MCP protocol to the Orchestrator.
 */
export class KilnMcpServer {
  private _mcpServer: McpServer | null = null;
  private _httpServer: Server | null = null;
  private readonly _handlers: Map<KilnTool, ToolHandler>;
  private readonly _memoryManager: MemoryManager | null;

  constructor(
    private readonly orchestrator: Orchestrator,
    memoryManager?: MemoryManager,
  ) {
    this._memoryManager = memoryManager ?? null;
    this._handlers = this._buildHandlers();
  }

  /** Start listening on the configured transport. */
  async start(config?: TransportConfig): Promise<void> {
    const transportType = config?.type ?? "stdio";

    if (transportType === "sse") {
      const result = createSSETransport(config?.port);
      this._httpServer = result.httpServer;

      // Each SSE client gets its own McpServer instance sharing the same handlers
      result.attachServerFactory(() => {
        const server = this._createMcpServer();
        this._registerToolsOn(server);
        return server;
      });
      return;
    }

    // stdio (default)
    this._mcpServer = this._createMcpServer();
    this._registerToolsOn(this._mcpServer);
    const result = createStdioTransport();
    await this._mcpServer.connect(result.transport);
  }

  /** Graceful shutdown. */
  async stop(): Promise<void> {
    if (this._httpServer) {
      await new Promise<void>((resolve) => {
        this._httpServer!.close(() => resolve());
      });
      this._httpServer = null;
    }
    if (this._mcpServer) {
      await this._mcpServer.close();
      this._mcpServer = null;
    }
  }

  /** Get a tool handler by name (for testing without stdio). */
  getHandler(toolName: KilnTool): ToolHandler | undefined {
    return this._handlers.get(toolName);
  }

  /** All registered tool names. */
  get toolNames(): readonly KilnTool[] {
    return [...this._handlers.keys()];
  }

  private _createMcpServer(): McpServer {
    return new McpServer(
      { name: "kiln", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
  }

  private _registerToolsOn(server: McpServer): void {
    for (const tool of KILN_TOOLS) {
      const handler = this._handlers.get(tool.name);
      if (!handler) continue;

      server.registerTool(tool.name, {
        description: tool.description,
        annotations: tool.annotations,
      }, async (args: Record<string, unknown>) => {
        return handler(args);
      });
    }
  }

  private _buildHandlers(): Map<KilnTool, ToolHandler> {
    const handlers = new Map<KilnTool, ToolHandler>();

    handlers.set("kiln_init", () =>
      jsonResult({
        sessionId: this.orchestrator.sessionId,
        status: this.orchestrator.status,
      }),
    );

    handlers.set("kiln_phase_start", () => {
      const result = this.orchestrator.advancePhase();
      // advancePhase can return Phase | Promise<Phase | null> | null
      // For sync results, return immediately
      if (result instanceof Promise) {
        return result.then((phase) => jsonResult({ phase, advanced: phase !== null }));
      }
      return jsonResult({ phase: result, advanced: result !== null });
    });

    handlers.set("kiln_memory_save", async (args) => {
      if (!this._memoryManager) {
        return jsonResult({ saved: true, id: randomUUID() });
      }
      const content = (args["content"] as string) ?? "";
      const layer = (args["layer"] as MemoryLayer) ?? "project";
      const tags = (args["tags"] as string[]) ?? [];
      const id = await this._memoryManager.save({ content, layer, tags });
      return jsonResult({ saved: true, id });
    });

    handlers.set("kiln_memory_recall", async (args) => {
      if (!this._memoryManager) {
        return jsonResult({ results: [] });
      }
      const query = (args["query"] as string) ?? "";
      const tokenBudget = (args["limit"] as number) ?? 2000;
      const text = await this._memoryManager.recall(query, tokenBudget);
      return jsonResult({ results: text });
    });

    handlers.set("kiln_memory_search", async (args) => {
      if (!this._memoryManager) {
        return jsonResult({ results: [] });
      }
      const query = (args["query"] as string) ?? "";
      const layer = args["layer"] as MemoryLayer | undefined;
      const limit = args["limit"] as number | undefined;
      const results = await this._memoryManager.search(query, layer, limit);
      return jsonResult({
        results: results.map((r) => ({
          id: r.entry.id,
          content: r.entry.content,
          layer: r.entry.layer,
          score: r.score,
          snippet: r.snippet,
          tags: r.entry.tags,
        })),
      });
    });

    handlers.set("kiln_cost_track", (args) => {
      const role = args["role"] as "architect" | "worker" | "optimizer";
      const inputTokens = (args["inputTokens"] as number) ?? 0;
      const outputTokens = (args["outputTokens"] as number) ?? 0;
      const cacheReadTokens = (args["cacheReadTokens"] as number) ?? 0;

      // Record via the orchestrator's EventBus -> CostTracker listens
      // CostTracker.record needs a model string; use a default for MCP-reported usage
      const costTracker = (this.orchestrator as unknown as { _costTracker: { record: (role: string, model: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) => void } })._costTracker;
      costTracker.record(role, "claude-sonnet-4-6", {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens: 0,
      });

      return jsonResult({ recorded: true });
    });

    handlers.set("kiln_cost_summary", () =>
      jsonResult(this.orchestrator.costSummary),
    );

    return handlers;
  }
}
