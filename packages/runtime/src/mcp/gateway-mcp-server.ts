// MCP server: exposes gateway capabilities as MCP tools via Streamable HTTP
// Uses the low-level Server class with raw JSON Schema (no Zod dependency)
// @modelcontextprotocol/sdk is an optional peer dep — dynamically imported

import type { GatewayMcpDeps } from "./gateway-mcp-types.js";
import { GATEWAY_MCP_TOOLS } from "./tool-schemas.js";
import type { GatewayMcpToolName } from "./tool-schemas.js";

const SERVER_NAME = "kilnai-gateway";
const SERVER_VERSION = "0.1.0";

export interface GatewayMcpServerOptions {
  readonly deps: GatewayMcpDeps;
  /** Optional API key for authentication (resolved from config.auth.keyEnv by the gateway) */
  readonly apiKey?: string;
}

// Dynamically-resolved SDK types (set once during initialize)
interface SdkModules {
  Server: new (
    info: { name: string; version: string },
    opts: { capabilities: Record<string, unknown> },
  ) => McpServerInstance;
  WebStandardStreamableHTTPServerTransport: new (opts: {
    sessionIdGenerator?: (() => string) | undefined;
    enableJsonResponse?: boolean;
  }) => McpTransport;
  ListToolsRequestSchema: unknown;
  CallToolRequestSchema: unknown;
}

interface McpServerInstance {
  setRequestHandler(schema: unknown, handler: (request: { params: Record<string, unknown> }) => unknown): void;
  connect(transport: McpTransport): Promise<void>;
  close(): Promise<void>;
}

interface McpTransport {
  handleRequest(req: Request): Promise<Response>;
  close?(): Promise<void>;
}

/**
 * MCP server that exposes gateway capabilities (memory, knowledge, cost, safety)
 * as tools for external agents via Streamable HTTP transport.
 *
 * Each request creates a fresh Server+Transport pair (stateless mode) to comply with
 * the MCP Streamable HTTP spec. Handler registration is amortized via a shared setup fn.
 *
 * Dynamic-imports @modelcontextprotocol/sdk at startup — fails gracefully if not installed.
 */
export class GatewayMcpServer {
  private readonly deps: GatewayMcpDeps;
  private readonly apiKey?: string;
  private sdk: SdkModules | undefined;

  constructor(options: GatewayMcpServerOptions) {
    this.deps = options.deps;
    this.apiKey = options.apiKey;
  }

  /** Load SDK modules. Must be called before handleRequest(). */
  async initialize(): Promise<void> {
    const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
    const { WebStandardStreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
    );
    const { ListToolsRequestSchema, CallToolRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");

    this.sdk = {
      Server: Server as unknown as SdkModules["Server"],
      WebStandardStreamableHTTPServerTransport:
        WebStandardStreamableHTTPServerTransport as unknown as SdkModules["WebStandardStreamableHTTPServerTransport"],
      ListToolsRequestSchema,
      CallToolRequestSchema,
    };
  }

  /** Route an incoming HTTP request to a per-request MCP server. */
  async handleRequest(req: Request): Promise<Response> {
    if (!this.sdk) {
      return new Response(JSON.stringify({ error: "MCP server not initialized" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (this.apiKey) {
      const auth = req.headers.get("Authorization");
      if (!auth || auth !== `Bearer ${this.apiKey}`) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Stateless mode: fresh Server + Transport per request (MCP Streamable HTTP spec)
    const server = this.createServer();
    const transport = new this.sdk.WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);

    try {
      return await transport.handleRequest(req);
    } finally {
      await server.close();
    }
  }

  /** Shut down (no-op for stateless mode, kept for interface symmetry). */
  async close(): Promise<void> {
    this.sdk = undefined;
  }

  // ---------------------------------------------------------------------------
  // Server factory (creates a configured Server per request)
  // ---------------------------------------------------------------------------

  private createServer(): McpServerInstance {
    const { Server, ListToolsRequestSchema, CallToolRequestSchema } = this.sdk!;
    const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: GATEWAY_MCP_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request: { params: Record<string, unknown> }) => {
      const params = request.params as { name: string; arguments?: Record<string, unknown> };
      return this.dispatch(params.name as GatewayMcpToolName, params.arguments ?? {});
    });

    return server;
  }

  // ---------------------------------------------------------------------------
  // Tool dispatch
  // ---------------------------------------------------------------------------

  private async dispatch(
    toolName: GatewayMcpToolName,
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    try {
      switch (toolName) {
        case "memory_recall":
          return await this.handleMemoryRecall(args);
        case "memory_store":
          return await this.handleMemoryStore(args);
        case "memory_delete":
          return await this.handleMemoryDelete(args);
        case "knowledge_search":
          return await this.handleKnowledgeSearch(args);
        case "knowledge_sources":
          return await this.handleKnowledgeSources(args);
        case "cost_summary":
          return this.handleCostSummary();
        case "safety_metrics":
          return this.handleSafetyMetrics();
        default:
          return this.errorResult(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.errorResult(err instanceof Error ? err.message : String(err));
    }
  }

  // ---------------------------------------------------------------------------
  // Tool handlers
  // ---------------------------------------------------------------------------

  private async handleMemoryRecall(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[] }> {
    if (!this.deps.getMemoryByScope) return this.errorResult("Memory recall not available");
    const scope = args["scope"] as string;
    const query = args["query"] as string | undefined;
    const tags = args["tags"] as string | undefined;
    const entries = await this.deps.getMemoryByScope(scope, query, tags);
    return this.jsonResult(entries);
  }

  private async handleMemoryStore(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[] }> {
    if (!this.deps.createMemoryEntry) return this.errorResult("Memory store not available");
    const result = await this.deps.createMemoryEntry({
      scope: args["scope"],
      key: args["key"],
      content: args["content"],
      ...(args["tags"] ? { tags: args["tags"] } : {}),
    });
    return this.jsonResult(result);
  }

  private async handleMemoryDelete(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[] }> {
    if (!this.deps.deleteMemoryEntry) return this.errorResult("Memory delete not available");
    const deleted = await this.deps.deleteMemoryEntry(args["id"] as string);
    return this.jsonResult({ deleted });
  }

  private async handleKnowledgeSearch(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[] }> {
    if (!this.deps.searchKnowledge) return this.errorResult("Knowledge search not available");
    const result = await this.deps.searchKnowledge(
      args["appName"] as string,
      args["query"] as string,
      args["limit"] as number | undefined,
    );
    return this.jsonResult(result);
  }

  private async handleKnowledgeSources(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[] }> {
    if (!this.deps.listKnowledgeSources) return this.errorResult("Knowledge sources not available");
    const result = this.deps.listKnowledgeSources(args["appName"] as string);
    return this.jsonResult(result);
  }

  private handleCostSummary(): { content: { type: "text"; text: string }[] } {
    if (!this.deps.getCostSummary) return this.errorResult("Cost summary not available");
    return this.jsonResult(this.deps.getCostSummary());
  }

  private handleSafetyMetrics(): { content: { type: "text"; text: string }[] } {
    if (!this.deps.getSafetyMetrics) return this.errorResult("Safety metrics not available");
    return this.jsonResult(this.deps.getSafetyMetrics());
  }

  // ---------------------------------------------------------------------------
  // Result helpers
  // ---------------------------------------------------------------------------

  private jsonResult(data: unknown): { content: { type: "text"; text: string }[] } {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }

  private errorResult(message: string): { content: { type: "text"; text: string }[]; isError: true } {
    return { content: [{ type: "text", text: message }], isError: true };
  }
}
