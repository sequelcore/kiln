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
    opts: { capabilities: Record<string, unknown>; instructionsText?: string },
  ) => McpServerInstance;
  WebStandardStreamableHTTPServerTransport: new (opts: {
    sessionIdGenerator?: (() => string) | undefined;
    enableJsonResponse?: boolean;
  }) => McpTransport;
  ListToolsRequestSchema: unknown;
  CallToolRequestSchema: unknown;
}

const EAGER_TOOL_NAMES = new Set(["cost_summary", "safety_check"] as const);

function buildInstructionsText(
  allTools: ReadonlyArray<{ name: string; description: string }>,
): string {
  const eagerTools = allTools.filter((t) => EAGER_TOOL_NAMES.has(t.name as never));

  const formatTool = (t: { name: string; description: string }) =>
    `  - ${t.name}: ${t.description.split("\n")[0]}`;

  return [
    "## Kiln Gateway MCP Tools",
    "",
    "### Always Available (Eager)",
    "",
    ...eagerTools.map(formatTool),
    "",
    "### Admin / Management Tools (Deferred — use when needed)",
    "",
    "The following additional admin tools are available but not listed here to save context:",
    "integrations (list), routing_test, eval_score,",
    "budget (check), swarm (join, leave, status, broadcast, claim, release).",
    "13 tools total — call listTools to see all schemas.",
    "",
    "## Usage Notes",
    "- Memory reads use the shared resource plane through resource tools and kiln://memory/... URIs.",
    "- Memory writes use the core governed memory tool surface, not Gateway MCP handlers.",
    "- swarm_* tools enable multi-agent coordination with optimistic locking",
    "- budget_check observes per-tenant billing",
    "- All tools return JSON; isError=true indicates a failure",
  ].join("\n");
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

let sdkModulesPromise: Promise<SdkModules> | undefined;

function loadSdkModules(): Promise<SdkModules> {
  return Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]).then(([serverModule, transportModule, typesModule]) => ({
    Server: serverModule.Server as unknown as SdkModules["Server"],
    WebStandardStreamableHTTPServerTransport:
      transportModule.WebStandardStreamableHTTPServerTransport as unknown as SdkModules["WebStandardStreamableHTTPServerTransport"],
    ListToolsRequestSchema: typesModule.ListToolsRequestSchema,
    CallToolRequestSchema: typesModule.CallToolRequestSchema,
  }));
}

// Warm the optional MCP SDK imports as soon as this module is loaded so the
// first request path does not pay the full dynamic-import cost under test/workspace load.
const sdkWarmupPromise = loadSdkModules();
void sdkWarmupPromise.catch(() => undefined);

/**
 * MCP server that exposes governed gateway capabilities (cost, safety,
 * integrations, routing, evaluation, budget, and swarm coordination)
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
    sdkModulesPromise ??= sdkWarmupPromise;

    this.sdk = await sdkModulesPromise;
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
    const instructions = buildInstructionsText(GATEWAY_MCP_TOOLS);
    const server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} }, instructionsText: instructions },
    );

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
        case "cost_summary":
          return this.handleCostSummary();
        case "safety_metrics":
        case "safety_check":
          return this.handleSafetyMetrics();
        case "integration_list":
          return this.handleIntegrationList();
        case "routing_test":
          return await this.handleRoutingTest(args);
        case "eval_score":
          return await this.handleEvalScore(args);
        case "budget_check":
          return await this.handleBudgetCheck(args);
        case "swarm_join":
          return await this.handleSwarmJoin(args);
        case "swarm_leave":
          return await this.handleSwarmLeave(args);
        case "swarm_status":
          return await this.handleSwarmStatus(args);
        case "swarm_broadcast":
          return await this.handleSwarmBroadcast(args);
        case "swarm_claim":
          return await this.handleSwarmClaim(args);
        case "swarm_release":
          return await this.handleSwarmRelease(args);
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

  private handleCostSummary(): { content: { type: "text"; text: string }[] } {
    if (!this.deps.getCostSummary) return this.errorResult("Cost summary not available");
    return this.jsonResult(this.deps.getCostSummary());
  }

  private handleSafetyMetrics(): { content: { type: "text"; text: string }[] } {
    if (!this.deps.getSafetyMetrics) return this.errorResult("Safety metrics not available");
    return this.jsonResult(this.deps.getSafetyMetrics());
  }

  // -- Integration Runtime Phase 4 -----------------------------------------------

  private handleIntegrationList(): { content: { type: "text"; text: string }[] } {
    if (!this.deps.listIntegrations) return this.errorResult("Integration list not available");
    return this.jsonResult(this.deps.listIntegrations());
  }

  // -- MCP-First Orchestration Phase 2 -------------------------------------------

  private async handleRoutingTest(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.testRouting) return this.errorResult("Routing test not available");
    const result = await this.deps.testRouting(
      args["tenantId"] as string,
      args["message"] as string,
    );
    return this.jsonResult(result);
  }

  private async handleEvalScore(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    const scorers = Array.isArray(args["scorers"])
      ? (args["scorers"] as string[])
      : undefined;
    if (!this.deps.evalScore) return this.errorResult("Eval scoring not available");
    const scores = await this.deps.evalScore(
      args["input"] as string,
      args["output"] as string,
      args["expected"] as string | undefined,
      scorers,
    );
    return this.jsonResult({ scores });
  }

  private async handleBudgetCheck(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.checkBudget) return this.errorResult("Budget check not available");
    const result = await this.deps.checkBudget(
      args["tenantId"] as string,
      args["appName"] as string,
    );
    return this.jsonResult(result);
  }

  private async handleSwarmJoin(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.swarmJoin) return this.errorResult("Swarm not available");
    const result = await this.deps.swarmJoin(
      args["swarmId"] as string,
      args["agentId"] as string,
      args["description"] as string | undefined,
    );
    return this.jsonResult({ joined: true, members: result.members });
  }

  private async handleSwarmLeave(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.swarmLeave) return this.errorResult("Swarm not available");
    await this.deps.swarmLeave(
      args["swarmId"] as string,
      args["agentId"] as string,
    );
    return this.jsonResult({ ok: true });
  }

  private async handleSwarmStatus(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.swarmStatus) return this.errorResult("Swarm not available");
    const result = await this.deps.swarmStatus(args["swarmId"] as string);
    return this.jsonResult(result);
  }

  private async handleSwarmBroadcast(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.swarmBroadcast) return this.errorResult("Swarm not available");
    const result = await this.deps.swarmBroadcast(
      args["swarmId"] as string,
      args["agentId"] as string,
      args["message"] as string,
    );
    return this.jsonResult({ ok: true, id: result.id });
  }

  private async handleSwarmClaim(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.swarmClaim) return this.errorResult("Swarm not available");
    const result = await this.deps.swarmClaim(
      args["swarmId"] as string,
      args["agentId"] as string,
      args["resourceId"] as string,
    );
    return this.jsonResult(result);
  }

  private async handleSwarmRelease(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.swarmRelease) return this.errorResult("Swarm not available");
    await this.deps.swarmRelease(
      args["swarmId"] as string,
      args["agentId"] as string,
      args["resourceId"] as string,
    );
    return this.jsonResult({ ok: true });
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
