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
    evalScoreLlm: vi.fn(async () => [{ name: "faithfulness", score: 0.9, reasoning: "Grounded in context" }]),
    getEnrichment: vi.fn(async () => ({
      sessionId: "sess-1", tenantId: "t-1", summary: "User asked about billing", effortScore: 3,
    })),
    listEnrichments: vi.fn(async () => ({
      enrichments: [{ sessionId: "sess-1", tenantId: "t-1", summary: "Billing question" }],
      nextCursor: undefined,
    })),
    getCrossAgentMemory: vi.fn(async () => [{ id: "cam-1", content: "shared context", tags: ["_team:team-1"] }]),
    setCrossAgentMemory: vi.fn(async () => ({ id: "cam-new-1" })),
    deleteCrossAgentMemory: vi.fn(async () => true),
    listCrossAgentMemory: vi.fn(async () => [{ id: "cam-1", content: "shared context", tags: ["_team:team-1"] }]),
    checkBudget: vi.fn(async () => ({ allowed: true, remaining: 500, unit: "tokens" })),
    reportUsage: vi.fn(async () => undefined),
    swarmJoin: vi.fn(async () => ({ members: ["agent-1", "agent-2"] })),
    swarmLeave: vi.fn(async () => undefined),
    swarmStatus: vi.fn(async () => ({
      members: [{ agentId: "agent-1", joinedAt: "2026-03-26T00:00:00.000Z" }],
      claims: [{ resourceId: "file.ts", agentId: "agent-1", claimedAt: "2026-03-26T00:00:00.000Z" }],
    })),
    swarmBroadcast: vi.fn(async () => ({ id: "broadcast-1" })),
    swarmClaim: vi.fn(async () => ({ claimed: true })),
    swarmRelease: vi.fn(async () => undefined),
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
    it("defines 25 tools", () => {
      expect(GATEWAY_MCP_TOOLS).toHaveLength(25);
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
    it("returns all 25 tools", async () => {
      const server = new GatewayMcpServer({ deps: makeDeps() });
      await server.initialize();
      const response = await listTools(server);
      expect(response.result.tools).toHaveLength(25);
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
      expect(names).toContain("cross_agent_memory_list");
      expect(names).toContain("cross_agent_memory_delete");
      expect(names).toContain("budget_check");
      expect(names).toContain("budget_report");
      expect(names).toContain("swarm_join");
      expect(names).toContain("swarm_leave");
      expect(names).toContain("swarm_status");
      expect(names).toContain("swarm_broadcast");
      expect(names).toContain("swarm_claim");
      expect(names).toContain("swarm_release");
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

    it("eval_score with rule-based scorer calls evalScore, not evalScoreLlm", async () => {
      const response = await callTool(server, "eval_score", {
        input: "What is 2+2?", output: "4", expected: "4", scorers: ["exact_match"],
      });
      expect(deps.evalScore).toHaveBeenCalledWith("What is 2+2?", "4", "4", ["exact_match"]);
      expect(deps.evalScoreLlm).not.toHaveBeenCalled();
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.scores[0].score).toBe(1.0);
    });

    it("eval_score with LLM scorer calls evalScoreLlm, not evalScore", async () => {
      const response = await callTool(server, "eval_score", {
        input: "Question", output: "Answer", scorers: ["faithfulness"],
      });
      expect(deps.evalScore).not.toHaveBeenCalled();
      expect(deps.evalScoreLlm).toHaveBeenCalledWith("Question", "Answer", undefined, undefined, ["faithfulness"], undefined);
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.scores[0].name).toBe("faithfulness");
    });

    it("eval_score without scorers only calls evalScore (not evalScoreLlm)", async () => {
      await callTool(server, "eval_score", { input: "q", output: "a" });
      expect(deps.evalScore).toHaveBeenCalledWith("q", "a", undefined, undefined);
      expect(deps.evalScoreLlm).not.toHaveBeenCalled();
    });

    it("eval_score passes context to evalScoreLlm", async () => {
      await callTool(server, "eval_score", {
        input: "q",
        output: "a",
        scorers: ["faithfulness"],
        context: ["chunk 1", "chunk 2"],
      });
      expect(deps.evalScoreLlm).toHaveBeenCalledWith("q", "a", undefined, ["chunk 1", "chunk 2"], ["faithfulness"], undefined);
    });

    it("eval_score returns error when LLM scorer requested but evalScoreLlm dep is missing", async () => {
      const depsWithoutLlm = makeDeps({ evalScoreLlm: undefined });
      const serverWithoutLlm = new GatewayMcpServer({ deps: depsWithoutLlm });
      await serverWithoutLlm.initialize();

      const response = await callTool(serverWithoutLlm, "eval_score", {
        input: "q",
        output: "a",
        scorers: ["faithfulness"],
      });

      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("LLM eval scoring not available");
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

    it("cross_agent_memory_recall uses getCrossAgentMemory with teamId", async () => {
      await callTool(server, "cross_agent_memory_recall", { teamId: "team-1", query: "shared context" });
      expect(deps.getCrossAgentMemory).toHaveBeenCalledWith("team-1", "shared context", undefined);
    });

    it("cross_agent_memory_recall uses key filter when key provided", async () => {
      await callTool(server, "cross_agent_memory_recall", { teamId: "team-1", key: "plan-v2" });
      expect(deps.getCrossAgentMemory).toHaveBeenCalledWith("team-1", undefined, "key:plan-v2");
    });

    it("cross_agent_memory_store uses setCrossAgentMemory", async () => {
      await callTool(server, "cross_agent_memory_store", {
        teamId: "team-1", key: "shared-goal", content: "ship by friday", tags: "priority",
      });
      expect(deps.setCrossAgentMemory).toHaveBeenCalledWith("team-1", "shared-goal", "ship by friday", "priority");
    });

    it("cross_agent_memory_list uses listCrossAgentMemory", async () => {
      const response = await callTool(server, "cross_agent_memory_list", {
        teamId: "team-1", tags: "priority", limit: 25,
      });
      expect(deps.listCrossAgentMemory).toHaveBeenCalledWith("team-1", "priority", 25);
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed).toHaveLength(1);
    });

    it("cross_agent_memory_delete uses deleteCrossAgentMemory", async () => {
      const response = await callTool(server, "cross_agent_memory_delete", {
        teamId: "team-1", id: "cam-1",
      });
      expect(deps.deleteCrossAgentMemory).toHaveBeenCalledWith("team-1", "cam-1");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.deleted).toBe(true);
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

    it("swarm_join calls swarmJoin with correct args", async () => {
      const response = await callTool(server, "swarm_join", {
        swarmId: "swarm-1", agentId: "agent-1", description: "planner",
      });
      expect(deps.swarmJoin).toHaveBeenCalledWith("swarm-1", "agent-1", "planner");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed).toEqual({ joined: true, members: ["agent-1", "agent-2"] });
    });

    it("swarm_leave calls swarmLeave with correct args", async () => {
      const response = await callTool(server, "swarm_leave", {
        swarmId: "swarm-1", agentId: "agent-1",
      });
      expect(deps.swarmLeave).toHaveBeenCalledWith("swarm-1", "agent-1");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed).toEqual({ ok: true });
    });

    it("swarm_status calls swarmStatus and returns members and claims", async () => {
      const response = await callTool(server, "swarm_status", { swarmId: "swarm-1" });
      expect(deps.swarmStatus).toHaveBeenCalledWith("swarm-1");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.members[0].agentId).toBe("agent-1");
      expect(parsed.claims[0].resourceId).toBe("file.ts");
    });

    it("swarm_broadcast calls swarmBroadcast and returns id", async () => {
      const response = await callTool(server, "swarm_broadcast", {
        swarmId: "swarm-1", agentId: "agent-1", message: "hello swarm",
      });
      expect(deps.swarmBroadcast).toHaveBeenCalledWith("swarm-1", "agent-1", "hello swarm");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed).toEqual({ ok: true, id: "broadcast-1" });
    });

    it("swarm_claim calls swarmClaim and returns result", async () => {
      const response = await callTool(server, "swarm_claim", {
        swarmId: "swarm-1", agentId: "agent-1", resourceId: "file.ts",
      });
      expect(deps.swarmClaim).toHaveBeenCalledWith("swarm-1", "agent-1", "file.ts");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed).toEqual({ claimed: true });
    });

    it("swarm_release calls swarmRelease and returns ok", async () => {
      const response = await callTool(server, "swarm_release", {
        swarmId: "swarm-1", agentId: "agent-1", resourceId: "file.ts",
      });
      expect(deps.swarmRelease).toHaveBeenCalledWith("swarm-1", "agent-1", "file.ts");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed).toEqual({ ok: true });
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
      const response = await callTool(server, "cross_agent_memory_recall", { teamId: "team-1", query: "q" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Cross-agent memory not available");
    });

    it("cross_agent_memory_store returns error when dep missing", async () => {
      const response = await callTool(server, "cross_agent_memory_store", { teamId: "team-1", key: "k", content: "c" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Cross-agent memory not available");
    });

    it("cross_agent_memory_list returns error when dep missing", async () => {
      const response = await callTool(server, "cross_agent_memory_list", { teamId: "team-1" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Cross-agent memory not available");
    });

    it("cross_agent_memory_delete returns error when dep missing", async () => {
      const response = await callTool(server, "cross_agent_memory_delete", { teamId: "team-1", id: "cam-1" });
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

    it("swarm_join returns error when dep missing", async () => {
      const response = await callTool(server, "swarm_join", { swarmId: "s1", agentId: "a1" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Swarm not available");
    });

    it("swarm_leave returns error when dep missing", async () => {
      const response = await callTool(server, "swarm_leave", { swarmId: "s1", agentId: "a1" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Swarm not available");
    });

    it("swarm_status returns error when dep missing", async () => {
      const response = await callTool(server, "swarm_status", { swarmId: "s1" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Swarm not available");
    });

    it("swarm_broadcast returns error when dep missing", async () => {
      const response = await callTool(server, "swarm_broadcast", { swarmId: "s1", agentId: "a1", message: "hi" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Swarm not available");
    });

    it("swarm_claim returns error when dep missing", async () => {
      const response = await callTool(server, "swarm_claim", { swarmId: "s1", agentId: "a1", resourceId: "f.ts" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Swarm not available");
    });

    it("swarm_release returns error when dep missing", async () => {
      const response = await callTool(server, "swarm_release", { swarmId: "s1", agentId: "a1", resourceId: "f.ts" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Swarm not available");
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
