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
  "MCP-Protocol-Version": "2026-07-28",
};

const MCP_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "kiln-runtime-test", version: "1.0.0" },
};

function jsonRpc(method: string, params: Record<string, unknown> = {}, id = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function mcpRequest(method: string, params: Record<string, unknown> = {}, extraHeaders?: Record<string, string>): Request {
  const headers: Record<string, string> = { ...MCP_HEADERS, "MCP-Method": method, ...extraHeaders };
  if (typeof params["name"] === "string") headers["MCP-Name"] = params["name"];
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers,
    body: jsonRpc(method, { ...params, _meta: MCP_META }),
  });
}

function makeDeps(overrides?: Partial<GatewayMcpDeps>): GatewayMcpDeps {
  return {
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
    testRouting: vi.fn(async () => ({
      agentId: "support",
      agentName: "Support Agent",
      tier: "rule",
      matchedPattern: "help|support",
      confidence: null,
      allRules: [{ pattern: "help|support", agent: "support", matched: true }],
    })),
    evalScore: vi.fn(async () => [{ name: "exact_match", score: 1.0, reasoning: "Exact match" }]),
    checkBudget: vi.fn(async () => ({ allowed: true, remaining: 500, unit: "tokens" })),
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
  const body = await res.json() as { result?: { content: { type: string; text: string }[]; isError?: boolean }; error?: unknown };
  if (!body.result) throw new Error(`MCP tools/call failed: ${JSON.stringify(body.error)}`);
  return { result: body.result };
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
    it("defines the governed gateway tools", () => {
      expect(GATEWAY_MCP_TOOLS).toHaveLength(13);
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
    it("returns gateway tools without legacy memory or budget-reporting contracts", async () => {
      const server = new GatewayMcpServer({ deps: makeDeps() });
      await server.initialize();
      const response = await listTools(server);
      expect(response.result.tools).toHaveLength(13);
      const names = response.result.tools.map((t) => t.name);
      expect(names).not.toContain("memory_recall");
      expect(names).not.toContain("memory_store");
      expect(names).not.toContain("memory_delete");
      expect(names).not.toContain("memory_search");
      expect(names).not.toContain("memory_list");
      expect(names).not.toContain("memory_forget");
      expect(names).toContain("cost_summary");
      expect(names).toContain("safety_metrics");
      expect(names).toContain("safety_check");
      expect(names).toContain("integration_list");
      expect(names).toContain("routing_test");
      expect(names).toContain("eval_score");
      expect(names).not.toContain("cross_agent_memory_recall");
      expect(names).not.toContain("cross_agent_memory_store");
      expect(names).not.toContain("cross_agent_memory_list");
      expect(names).not.toContain("cross_agent_memory_delete");
      expect(names).toContain("budget_check");
      expect(names).not.toContain("budget_report");
      expect(names).toContain("swarm_join");
      expect(names).toContain("swarm_leave");
      expect(names).toContain("swarm_status");
      expect(names).toContain("swarm_broadcast");
      expect(names).toContain("swarm_claim");
      expect(names).toContain("swarm_release");
    });
  });

  describe("protocol contract", () => {
    it("rejects requests that omit the exact 2026-07-28 envelope", async () => {
      const server = new GatewayMcpServer({ deps: makeDeps() });
      await server.initialize();
      const response = await server.handleRequest(new Request("http://localhost/mcp", {
        method: "POST",
        headers: { ...MCP_HEADERS, "MCP-Method": "tools/list" },
        body: jsonRpc("tools/list"),
      }));
      const body = await response.json() as { error?: { code?: number } };
      expect(body.error?.code).toBe(-32602);
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

    it("routing_test calls testRouting with correct args", async () => {
      const response = await callTool(server, "routing_test", { tenantId: "t-1", message: "I need help" });
      expect(deps.testRouting).toHaveBeenCalledWith("t-1", "I need help");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.agentId).toBe("support");
      expect(parsed.tier).toBe("rule");
    });

    it("eval_score with rule-based scorer calls evalScore", async () => {
      const response = await callTool(server, "eval_score", {
        input: "What is 2+2?", output: "4", expected: "4", scorers: ["exact_match"],
      });
      expect(deps.evalScore).toHaveBeenCalledWith("What is 2+2?", "4", "4", ["exact_match"]);
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.scores[0].score).toBe(1.0);
    });

    it("eval_score without scorers calls evalScore", async () => {
      await callTool(server, "eval_score", { input: "q", output: "a" });
      expect(deps.evalScore).toHaveBeenCalledWith("q", "a", undefined, undefined);
    });

    it("budget_check calls checkBudget with correct args", async () => {
      const response = await callTool(server, "budget_check", { tenantId: "t-1", appName: "my-app" });
      expect(deps.checkBudget).toHaveBeenCalledWith("t-1", "my-app");
      const parsed = JSON.parse(response.result.content[0]!.text);
      expect(parsed.allowed).toBe(true);
      expect(parsed.remaining).toBe(500);
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

    it("budget_check returns error when dep missing", async () => {
      const response = await callTool(server, "budget_check", { tenantId: "t", appName: "a" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("Budget check not available");
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
        evalScore: vi.fn(async () => { throw new Error("eval backend lost"); }),
      });
      const server = new GatewayMcpServer({ deps });
      await server.initialize();

      const response = await callTool(server, "eval_score", { input: "q", output: "a" });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0]!.text).toBe("eval backend lost");
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
