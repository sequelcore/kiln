import { describe, it, expect, vi, beforeEach } from "vitest";
import { GatewayMcpServer } from "../../src/mcp/gateway-mcp-server.js";
import type { GatewayMcpDeps } from "../../src/mcp/gateway-mcp-types.js";
import { GATEWAY_MCP_TOOLS } from "../../src/mcp/tool-schemas.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

function jsonRpc(method: string, params: Record<string, unknown> = {}, id = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function mcpRequest(method: string, params: Record<string, unknown> = {}, extraHeaders?: Record<string, string>): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: { ...MCP_HEADERS, ...extraHeaders },
    body: jsonRpc(method, params),
  });
}

function makeDeps(overrides?: Partial<GatewayMcpDeps>): GatewayMcpDeps {
  return {
    getMemoryByScope: vi.fn(async () => [{ id: "m1", content: "test memory" }]),
    createMemoryEntry: vi.fn(async () => ({ id: "new-1" })),
    deleteMemoryEntry: vi.fn(async () => true),
    searchKnowledge: vi.fn(async () => ({
      results: [{ content: "knowledge chunk", score: 0.95, source: "docs.md" }],
    })),
    listKnowledgeSources: vi.fn(() => ({
      sources: [{ id: "s1", name: "docs", type: "file" }],
    })),
    getCostSummary: vi.fn(() => ({
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalToolCalls: 3,
      totalCostUsd: 0.015,
      byRoleModel: {},
    })),
    getSafetyMetrics: vi.fn(() => ({ enabled: true, piiDetections: 2 })),
    listIntegrations: vi.fn(() => [
      { provider: "stripe", version: "1.0.0", operations: [{ name: "create_link", description: "Create payment link" }] },
    ]),
    executeIntegration: vi.fn(async () => ({ paymentUrl: "https://pay.stripe.com/abc" })),
    testRouting: vi.fn(async () => ({
      agentId: "support",
      agentName: "Support Agent",
      tier: "rule",
      matchedPattern: "help|support",
      confidence: null,
      allRules: [{ pattern: "help|support", agent: "support", matched: true }],
    })),
    evalScore: vi.fn(async () => [{ name: "exact_match", score: 1.0, reasoning: "Exact match" }]),
    getEnrichment: vi.fn(async () => ({
      sessionId: "sess-1", tenantId: "t-1", summary: "User asked about billing", effortScore: 3,
    })),
    listEnrichments: vi.fn(async () => ({
      enrichments: [{ sessionId: "sess-1", tenantId: "t-1", summary: "Billing question" }],
      nextCursor: undefined,
    })),
    checkBudget: vi.fn(async () => ({ allowed: true, remaining: 500, unit: "tokens" })),
    reportUsage: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function callTool(
  server: GatewayMcpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ result: { content: { type: string; text: string }[]; isError?: boolean } }> {
  const res = await server.handleRequest(mcpRequest("tools/call", { name, arguments: args }));
  return res.json();
}

async function listTools(server: GatewayMcpServer): Promise<{ result: { tools: { name: string }[] } }> {
  const res = await server.handleRequest(mcpRequest("tools/list"));
  return res.json();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GatewayMcpServer", () => {
  describe("before initialization", () => {
    it("returns 503 when not initialized", async () => {
      const server = new GatewayMcpServer({ deps: makeDeps() });
      const res = await server.handleRequest(mcpRequest("tools/list"));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("MCP server not initialized");
    });
  });

  describe("authentication", () => {
    it("returns 401 when apiKey is set but request has no auth header", async () => {
      const server = new GatewayMcpServer({ deps: makeDeps(), apiKey: "secret-123" });
      await server.initialize();
      const res = await server.handleRequest(mcpRequest("tools/list"));
      expect(res.status).toBe(401);
    });

    it("returns 401 when apiKey does not match", async () => {
      const server = new GatewayMcpServer({ deps: makeDeps(), apiKey: "secret-123" });
      await server.initialize();
      const res = await server.handleRequest(
        mcpRequest("tools/list", {}, { Authorization: "Bearer wrong-key" }),
      );
      expect(res.status).toBe(401);
    });

    it("allows request when apiKey matches", async () => {
      const server = new GatewayMcpServer({ deps: makeDeps(), apiKey: "secret-123" });
      await server.initialize();
      const res = await server.handleRequest(
        mcpRequest("tools/list", {}, { Authorization: "Bearer secret-123" }),
      );
      expect(res.status).toBe(200);
    });

    it("allows request when no apiKey is configured", async () => {
      const server = new GatewayMcpServer({ deps: makeDeps() });
      await server.initialize();
      const res = await server.handleRequest(mcpRequest("tools/list"));
      expect(res.status).toBe(200);
    });
  });

  describe("tool schemas", () => {
    it("defines 17 tools", () => {
      expect(GATEWAY_MCP_TOOLS).toHaveLength(17);
    });

    it("all tools have name, description, and inputSchema", () => {
      for (const tool of GATEWAY_MCP_TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });

    it("tool names are unique", () => {
      const names = GATEWAY_MCP_TOOLS.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe("tools/list", () => {
    it("returns all 17 tools", async () => {
      const server = new GatewayMcpServer({ deps: makeDeps() });
      await server.initialize();
      const response = await listTools(server);
      expect(response.result.tools).toHaveLength(17);
      const names = response.result.tools.map((t) => t.name);
      expect(names).toContain("memory_recall");
      expect(names).toContain("memory_store");
      expect(names).toContain("memory_delete");
      expect(names).toContain("knowledge_search");
      expect(names).toContain("knowledge_sources");
      expect(names).toContain("cost_summary");
      expect(names).toContain("safety_metrics");
      expect(names).toContain("integration_list");
      expect(names).toContain("integration_execute");
      expect(names).toContain("routing_test");
      expect(names).toContain("eval_score");
      expect(names).toContain("enrichment_get");
      expect(names).toContain("enrichment_list");
      expect(names).toContain("cross_agent_memory_recall");
      expect(names).toContain("cross_agent_memory_store");
      expect(names).toContain("budget_check");
      expect(names).toContain("budget_report");
    });
  });

  describe("tool dispatch", () => {
    let server: GatewayMcpServer;
    let deps: GatewayMcpDeps;

    beforeEach(async () => {
      deps = makeDeps();
      server = new GatewayMcpServer({ deps });
      await server.initialize();
    });

    it("memory_recall calls getMemoryByScope with correct args", async () => {
      const response = await callTool(server, "memory_recall", { scope: "user", query: "test" });
      expect(deps.getMemoryByScope).toHaveBeenCalledWith("user", "test", undefined);
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed).toEqual([{ id: "m1", content: "test memory" }]);
    });

    it("memory_store calls createMemoryEntry", async () => {
      const response = await callTool(server, "memory_store", {
        scope: "project", key: "k1", content: "hello", tags: "a,b",
      });
      expect(deps.createMemoryEntry).toHaveBeenCalledWith({
        scope: "project", key: "k1", content: "hello", tags: "a,b",
      });
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.id).toBe("new-1");
    });

    it("memory_delete calls deleteMemoryEntry", async () => {
      const response = await callTool(server, "memory_delete", { id: "m1" });
      expect(deps.deleteMemoryEntry).toHaveBeenCalledWith("m1");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.deleted).toBe(true);
    });

    it("knowledge_search calls searchKnowledge", async () => {
      const response = await callTool(server, "knowledge_search", {
        appName: "my-app", query: "how to deploy", limit: 3,
      });
      expect(deps.searchKnowledge).toHaveBeenCalledWith("my-app", "how to deploy", 3);
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.results[0].content).toBe("knowledge chunk");
    });

    it("knowledge_sources calls listKnowledgeSources", async () => {
      const response = await callTool(server, "knowledge_sources", { appName: "my-app" });
      expect(deps.listKnowledgeSources).toHaveBeenCalledWith("my-app");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.sources).toHaveLength(1);
    });

    it("cost_summary returns cost data", async () => {
      const response = await callTool(server, "cost_summary");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.totalCostUsd).toBe(0.015);
      expect(parsed.totalInputTokens).toBe(1000);
    });

    it("safety_metrics returns safety data", async () => {
      const response = await callTool(server, "safety_metrics");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.enabled).toBe(true);
      expect(parsed.piiDetections).toBe(2);
    });

    it("handles multiple sequential requests (stateless transport)", async () => {
      const r1 = await callTool(server, "cost_summary");
      const r2 = await callTool(server, "safety_metrics");
      expect(JSON.parse(r1.result.content[0]!.text).totalCostUsd).toBe(0.015);
      expect(JSON.parse(r2.result.content[0]!.text).enabled).toBe(true);
    });

    it("integration_list returns adapter list", async () => {
      const response = await callTool(server, "integration_list");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(deps.listIntegrations).toHaveBeenCalled();
      expect(parsed[0].provider).toBe("stripe");
      expect(parsed[0].operations).toHaveLength(1);
    });

    it("integration_execute calls executeIntegration with correct args", async () => {
      const response = await callTool(server, "integration_execute", {
        provider: "stripe", operation: "create_link", tenantId: "t-1", input: { amount: 100 },
      });
      expect(deps.executeIntegration).toHaveBeenCalledWith("stripe", "create_link", "t-1", { amount: 100 });
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.paymentUrl).toBe("https://pay.stripe.com/abc");
    });

    it("routing_test calls testRouting with correct args", async () => {
      const response = await callTool(server, "routing_test", { tenantId: "t-1", message: "I need help" });
      expect(deps.testRouting).toHaveBeenCalledWith("t-1", "I need help");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.agentId).toBe("support");
      expect(parsed.tier).toBe("rule");
    });

    it("eval_score calls evalScore with correct args", async () => {
      const response = await callTool(server, "eval_score", {
        input: "What is 2+2?", output: "4", expected: "4", scorers: ["exact_match"],
      });
      expect(deps.evalScore).toHaveBeenCalledWith("What is 2+2?", "4", "4", ["exact_match"]);
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.scores[0].score).toBe(1.0);
    });

    it("eval_score omits scorers when not provided", async () => {
      await callTool(server, "eval_score", { input: "q", output: "a" });
      expect(deps.evalScore).toHaveBeenCalledWith("q", "a", undefined, undefined);
    });

    it("enrichment_get returns enrichment data", async () => {
      const response = await callTool(server, "enrichment_get", { sessionId: "sess-1" });
      expect(deps.getEnrichment).toHaveBeenCalledWith("sess-1");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.sessionId).toBe("sess-1");
    });

    it("enrichment_get returns error when session not found", async () => {
      const notFoundDeps = makeDeps({
        getEnrichment: vi.fn(async () => undefined),
      });
      const notFoundServer = new GatewayMcpServer({ deps: notFoundDeps });
      await notFoundServer.initialize();
      const response = await callTool(notFoundServer, "enrichment_get", { sessionId: "sess-missing" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toContain("sess-missing");
    });

    it("enrichment_list calls listEnrichments with correct args", async () => {
      const response = await callTool(server, "enrichment_list", {
        tenantId: "t-1", limit: 10, cursor: "2026-01-01T00:00:00.000Z",
      });
      expect(deps.listEnrichments).toHaveBeenCalledWith("t-1", 10, "2026-01-01T00:00:00.000Z");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.enrichments).toHaveLength(1);
    });

    it("cross_agent_memory_recall uses scope=team", async () => {
      await callTool(server, "cross_agent_memory_recall", { query: "shared context" });
      expect(deps.getMemoryByScope).toHaveBeenCalledWith("team", "shared context", undefined);
    });

    it("cross_agent_memory_recall uses key filter when key provided", async () => {
      await callTool(server, "cross_agent_memory_recall", { key: "plan-v2" });
      expect(deps.getMemoryByScope).toHaveBeenCalledWith("team", undefined, "key:plan-v2");
    });

    it("cross_agent_memory_store uses scope=team", async () => {
      await callTool(server, "cross_agent_memory_store", {
        key: "shared-goal", content: "ship by friday", tags: "priority",
      });
      expect(deps.createMemoryEntry).toHaveBeenCalledWith({
        scope: "team", key: "shared-goal", content: "ship by friday", tags: "priority",
      });
    });

    it("budget_check calls checkBudget with correct args", async () => {
      const response = await callTool(server, "budget_check", { tenantId: "t-1", appName: "my-app" });
      expect(deps.checkBudget).toHaveBeenCalledWith("t-1", "my-app");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.allowed).toBe(true);
      expect(parsed.remaining).toBe(500);
    });

    it("budget_report calls reportUsage and returns ok", async () => {
      const response = await callTool(server, "budget_report", {
        tenantId: "t-1", appName: "my-app", messages: 1, tokens: 200, model: "claude-sonnet-4-5",
      });
      expect(deps.reportUsage).toHaveBeenCalledWith("t-1", "my-app", 1, 200, "claude-sonnet-4-5");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.ok).toBe(true);
    });
  });

  describe("missing deps", () => {
    let server: GatewayMcpServer;

    beforeEach(async () => {
      server = new GatewayMcpServer({ deps: {} });
      await server.initialize();
    });

    it("memory_recall returns error when dep missing", async () => {
      const response = await callTool(server, "memory_recall", { scope: "user" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Memory recall not available");
    });

    it("memory_store returns error when dep missing", async () => {
      const response = await callTool(server, "memory_store", { scope: "user", key: "k", content: "c" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Memory store not available");
    });

    it("memory_delete returns error when dep missing", async () => {
      const response = await callTool(server, "memory_delete", { id: "m1" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Memory delete not available");
    });

    it("knowledge_search returns error when dep missing", async () => {
      const response = await callTool(server, "knowledge_search", { appName: "a", query: "q" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Knowledge search not available");
    });

    it("knowledge_sources returns error when dep missing", async () => {
      const response = await callTool(server, "knowledge_sources", { appName: "a" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Knowledge sources not available");
    });

    it("cost_summary returns error when dep missing", async () => {
      const response = await callTool(server, "cost_summary");
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Cost summary not available");
    });

    it("safety_metrics returns error when dep missing", async () => {
      const response = await callTool(server, "safety_metrics");
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Safety metrics not available");
    });

    it("integration_list returns error when dep missing", async () => {
      const response = await callTool(server, "integration_list");
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Integration list not available");
    });

    it("integration_execute returns error when dep missing", async () => {
      const response = await callTool(server, "integration_execute", {
        provider: "stripe", operation: "op", tenantId: "t", input: {},
      });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Integration execute not available");
    });

    it("routing_test returns error when dep missing", async () => {
      const response = await callTool(server, "routing_test", { tenantId: "t", message: "hi" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Routing test not available");
    });

    it("eval_score returns error when dep missing", async () => {
      const response = await callTool(server, "eval_score", { input: "q", output: "a" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Eval scoring not available");
    });

    it("enrichment_get returns error when dep missing", async () => {
      const response = await callTool(server, "enrichment_get", { sessionId: "s" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Enrichment get not available");
    });

    it("enrichment_list returns error when dep missing", async () => {
      const response = await callTool(server, "enrichment_list", { tenantId: "t" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Enrichment list not available");
    });

    it("cross_agent_memory_recall returns error when dep missing", async () => {
      const response = await callTool(server, "cross_agent_memory_recall", { query: "q" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Cross-agent memory not available");
    });

    it("cross_agent_memory_store returns error when dep missing", async () => {
      const response = await callTool(server, "cross_agent_memory_store", { key: "k", content: "c" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Cross-agent memory not available");
    });

    it("budget_check returns error when dep missing", async () => {
      const response = await callTool(server, "budget_check", { tenantId: "t", appName: "a" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Budget check not available");
    });

    it("budget_report returns error when dep missing", async () => {
      const response = await callTool(server, "budget_report", {
        tenantId: "t", appName: "a", messages: 1, tokens: 1, model: "m",
      });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Budget reporting not available");
    });
  });

  describe("error handling", () => {
    it("catches exceptions from deps and returns error result", async () => {
      const deps = makeDeps({
        getMemoryByScope: vi.fn(async () => { throw new Error("DB connection lost"); }),
      });
      const server = new GatewayMcpServer({ deps });
      await server.initialize();

      const response = await callTool(server, "memory_recall", { scope: "user" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("DB connection lost");
    });
  });

  describe("close", () => {
    it("can close without initialization", async () => {
      const server = new GatewayMcpServer({ deps: makeDeps() });
      await expect(server.close()).resolves.toBeUndefined();
    });

    it("can close after initialization", async () => {
      const server = new GatewayMcpServer({ deps: makeDeps() });
      await server.initialize();
      await expect(server.close()).resolves.toBeUndefined();
    });

    it("returns 503 after close", async () => {
      const server = new GatewayMcpServer({ deps: makeDeps() });
      await server.initialize();
      await server.close();
      const res = await server.handleRequest(mcpRequest("tools/list"));
      expect(res.status).toBe(503);
    });
  });
});
