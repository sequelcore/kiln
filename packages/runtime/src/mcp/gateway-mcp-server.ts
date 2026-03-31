// MCP server: exposes gateway capabilities as MCP tools via Streamable HTTP
// Uses the low-level Server class with raw JSON Schema (no Zod dependency)
// @modelcontextprotocol/sdk is an optional peer dep — dynamically imported

import type { GatewayMcpDeps } from "./gateway-mcp-types.js";
import { GATEWAY_MCP_TOOLS } from "./tool-schemas.js";
import type { GatewayMcpToolName } from "./tool-schemas.js";

const SERVER_NAME = "kilnai-gateway";
const SERVER_VERSION = "0.1.0";
const LLM_SCORER_NAMES = new Set([
  "faithfulness", "relevance", "coherence", "hallucination", "toxicity",
  "policy-adherence", "context-relevance", "tool-trajectory",
  "multi-turn-consistency", "safety-preservation", "handoff-quality", "custom-prompt",
]);

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
        case "memory_search":
          return await this.handleMemorySearch(args);
        case "knowledge_search":
          return await this.handleKnowledgeSearch(args);
        case "knowledge_sources":
          return await this.handleKnowledgeSources(args);
        case "cost_summary":
          return this.handleCostSummary();
        case "safety_metrics":
          return this.handleSafetyMetrics();
        case "integration_list":
          return this.handleIntegrationList();
        case "integration_execute":
          return await this.handleIntegrationExecute(args);
        case "routing_test":
          return await this.handleRoutingTest(args);
        case "eval_score":
          return await this.handleEvalScore(args);
        case "enrichment_get":
          return await this.handleEnrichmentGet(args);
        case "enrichment_list":
          return await this.handleEnrichmentList(args);
        case "cross_agent_memory_recall":
          return await this.handleCrossAgentMemoryRecall(args);
        case "cross_agent_memory_store":
          return await this.handleCrossAgentMemoryStore(args);
        case "cross_agent_memory_list":
          return await this.handleCrossAgentMemoryList(args);
        case "cross_agent_memory_delete":
          return await this.handleCrossAgentMemoryDelete(args);
        case "budget_check":
          return await this.handleBudgetCheck(args);
        case "budget_report":
          return await this.handleBudgetReport(args);
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

  private async handleMemorySearch(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[] }> {
    if (!this.deps.memorySearch) return this.errorResult("Memory search not available");
    const results = await this.deps.memorySearch(
      args["query"] as string,
      args["scope"] as string | undefined,
      args["limit"] as number | undefined,
    );
    return this.jsonResult(results);
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

  // -- Integration Runtime Phase 4 -----------------------------------------------

  private handleIntegrationList(): { content: { type: "text"; text: string }[] } {
    if (!this.deps.listIntegrations) return this.errorResult("Integration list not available");
    return this.jsonResult(this.deps.listIntegrations());
  }

  private async handleIntegrationExecute(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.executeIntegration) return this.errorResult("Integration execute not available");
    const result = await this.deps.executeIntegration(
      args["provider"] as string,
      args["operation"] as string,
      args["tenantId"] as string,
      (args["input"] as Record<string, unknown>) ?? {},
    );
    return this.jsonResult(result);
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
    const context = Array.isArray(args["context"])
      ? (args["context"] as string[])
      : undefined;
    const scorerOptions =
      typeof args["scorerOptions"] === "object" &&
      args["scorerOptions"] !== null &&
      !Array.isArray(args["scorerOptions"])
        ? (args["scorerOptions"] as Record<string, unknown>)
        : undefined;

    const llmNames = scorers?.filter((name) => LLM_SCORER_NAMES.has(name)) ?? [];
    const ruleNames = scorers?.filter((name) => !LLM_SCORER_NAMES.has(name));
    const allScores: { name: string; score: number; reasoning?: string }[] = [];

    if (!scorers) {
      if (!this.deps.evalScore) return this.errorResult("Eval scoring not available");
      const ruleScores = await this.deps.evalScore(
        args["input"] as string,
        args["output"] as string,
        args["expected"] as string | undefined,
        undefined,
      );
      allScores.push(...ruleScores);
      return this.jsonResult({ scores: allScores });
    }

    if (ruleNames && ruleNames.length > 0) {
      if (!this.deps.evalScore) return this.errorResult("Eval scoring not available");
      const ruleScores = await this.deps.evalScore(
        args["input"] as string,
        args["output"] as string,
        args["expected"] as string | undefined,
        ruleNames,
      );
      allScores.push(...ruleScores);
    }

    if (llmNames.length > 0) {
      if (!this.deps.evalScoreLlm) return this.errorResult("LLM eval scoring not available");
      const llmScores = await this.deps.evalScoreLlm(
        args["input"] as string,
        args["output"] as string,
        args["expected"] as string | undefined,
        context,
        llmNames,
        scorerOptions,
      );
      allScores.push(...llmScores);
    }

    return this.jsonResult({ scores: allScores });
  }

  private async handleEnrichmentGet(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.getEnrichment) return this.errorResult("Enrichment get not available");
    const result = await this.deps.getEnrichment(args["sessionId"] as string);
    if (!result) return this.errorResult(`No enrichment found for session: ${args["sessionId"] as string}`);
    return this.jsonResult(result);
  }

  private async handleEnrichmentList(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.listEnrichments) return this.errorResult("Enrichment list not available");
    const result = await this.deps.listEnrichments(
      args["tenantId"] as string,
      args["limit"] as number | undefined,
      args["cursor"] as string | undefined,
    );
    return this.jsonResult(result);
  }

  private async handleCrossAgentMemoryRecall(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.getCrossAgentMemory) return this.errorResult("Cross-agent memory not available");
    const teamId = args["teamId"] as string;
    const key = args["key"] as string | undefined;
    const tags = args["tags"] as string | undefined;
    const mergedTags = key ? (tags ? `key:${key},${tags}` : `key:${key}`) : tags;
    const entries = await this.deps.getCrossAgentMemory(
      teamId,
      args["query"] as string | undefined,
      mergedTags,
    );
    return this.jsonResult(entries);
  }

  private async handleCrossAgentMemoryStore(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.setCrossAgentMemory) return this.errorResult("Cross-agent memory not available");
    const result = await this.deps.setCrossAgentMemory(
      args["teamId"] as string,
      args["key"] as string,
      args["content"] as string,
      args["tags"] as string | undefined,
    );
    return this.jsonResult(result);
  }

  private async handleCrossAgentMemoryList(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.listCrossAgentMemory) return this.errorResult("Cross-agent memory not available");
    const entries = await this.deps.listCrossAgentMemory(
      args["teamId"] as string,
      args["tags"] as string | undefined,
      args["limit"] as number | undefined,
    );
    return this.jsonResult(entries);
  }

  private async handleCrossAgentMemoryDelete(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.deleteCrossAgentMemory) return this.errorResult("Cross-agent memory not available");
    const deleted = await this.deps.deleteCrossAgentMemory(
      args["teamId"] as string,
      args["id"] as string,
    );
    return this.jsonResult({ deleted });
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

  private async handleBudgetReport(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    if (!this.deps.reportUsage) return this.errorResult("Budget reporting not available");
    await this.deps.reportUsage(
      args["tenantId"] as string,
      args["appName"] as string,
      args["messages"] as number,
      args["tokens"] as number,
      args["model"] as string,
    );
    return this.jsonResult({ ok: true });
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
