import { describe, it, expect } from "vitest";
import type { TenantConfig, UserContext } from "@kilnai/core";
import { textParts } from "@kilnai/core";
import { resolveAgentContext, buildAgentSystemPrompt } from "../../src/tenant/agent-resolver.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

function makeTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "test-biz",
    appName: "test-app",
    name: "Test Business",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as TenantConfig;
}

const salesAgent = {
  id: "sales-agent",
  name: "Sales Bot",
  role: "Sales specialist",
  goal: "Help customers buy products",
} as const;

const supportAgent = {
  id: "support-agent",
  name: "Support Bot",
  role: "Customer support",
  goal: "Resolve customer issues",
} as const;

describe("buildAgentSystemPrompt", () => {
  it("adds agent identity section", () => {
    const prompt = buildAgentSystemPrompt("Base prompt.", salesAgent);
    expect(prompt).toContain("## Your Agent Identity");
    expect(prompt).toContain('"Sales Bot"');
    expect(prompt).toContain("Sales specialist");
    expect(prompt).toContain("Help customers buy products");
  });

  it("includes backstory when present", () => {
    const agent = { ...salesAgent, backstory: "10 years of experience in retail." };
    const prompt = buildAgentSystemPrompt("Base.", agent);
    expect(prompt).toContain("Background: 10 years of experience in retail.");
  });

  it("includes instructions section when present", () => {
    const agent = { ...salesAgent, instructions: "Always upsell premium plans." };
    const prompt = buildAgentSystemPrompt("Base.", agent);
    expect(prompt).toContain("## Operating Instructions");
    expect(prompt).toContain("Always upsell premium plans.");
  });

  it("omits instructions section when not present", () => {
    const prompt = buildAgentSystemPrompt("Base.", salesAgent);
    expect(prompt).not.toContain("## Operating Instructions");
  });
});

describe("buildAgentSystemPrompt — user token interpolation", () => {
  it("replaces {{user.role}} in agent role field", () => {
    const agent = { ...salesAgent, role: "{{user.role}} specialist" };
    const userContext: UserContext = { role: "admin" };
    const prompt = buildAgentSystemPrompt("Base.", agent, userContext);
    expect(prompt).toContain("admin specialist");
    expect(prompt).not.toContain("{{user.role}}");
  });

  it("replaces {{user.name}} in agent backstory", () => {
    const agent = { ...salesAgent, backstory: "Serving {{user.name}} since 2020." };
    const userContext: UserContext = { name: "John" };
    const prompt = buildAgentSystemPrompt("Base.", agent, userContext);
    expect(prompt).toContain("Serving John since 2020.");
    expect(prompt).not.toContain("{{user.name}}");
  });

  it("replaces {{user.locale}} in agent instructions", () => {
    const agent = { ...salesAgent, instructions: "Respond in {{user.locale}}." };
    const userContext: UserContext = { locale: "es" };
    const prompt = buildAgentSystemPrompt("Base.", agent, userContext);
    expect(prompt).toContain("Respond in es.");
    expect(prompt).not.toContain("{{user.locale}}");
  });

  it("resolves unknown token to empty string", () => {
    const agent = { ...salesAgent, role: "{{user.unknown}} role" };
    const userContext: UserContext = { role: "admin" };
    const prompt = buildAgentSystemPrompt("Base.", agent, userContext);
    expect(prompt).toContain(" role");
    expect(prompt).not.toContain("{{user.unknown}}");
  });

  it("leaves {{user.role}} untouched when userContext is undefined", () => {
    const agent = { ...salesAgent, role: "{{user.role}} specialist" };
    const prompt = buildAgentSystemPrompt("Base.", agent, undefined);
    expect(prompt).toContain("{{user.role}}");
  });
});

describe("resolveAgentContext", () => {
  describe("no agents configured", () => {
    it("returns base system prompt, no activeAgentId", () => {
      const tenant = makeTenant();
      const result = resolveAgentContext(tenant, textParts("hello"));
      expect(result.activeAgentId).toBeUndefined();
      expect(result.activeAgentName).toBeUndefined();
      expect(result.systemPrompt).toBeTruthy();
    });

    it("empty agents array returns base system prompt, no activeAgentId", () => {
      const tenant = makeTenant({ agents: [] });
      const result = resolveAgentContext(tenant, textParts("hello"));
      expect(result.activeAgentId).toBeUndefined();
      expect(result.activeAgentName).toBeUndefined();
    });
  });

  describe("single agent", () => {
    it("returns agent-overlaid system prompt, activeAgentId set", () => {
      const tenant = makeTenant({ agents: [salesAgent] });
      const result = resolveAgentContext(tenant, textParts("hello"));
      expect(result.activeAgentId).toBe("sales-agent");
      expect(result.activeAgentName).toBe("Sales Bot");
      expect(result.systemPrompt).toContain("Sales Bot");
    });

    it("prompt contains agent name, role, goal", () => {
      const tenant = makeTenant({ agents: [salesAgent] });
      const result = resolveAgentContext(tenant, textParts("hello"));
      expect(result.systemPrompt).toContain("Sales Bot");
      expect(result.systemPrompt).toContain("Sales specialist");
      expect(result.systemPrompt).toContain("Help customers buy products");
    });

    it("agent with backstory includes backstory in prompt", () => {
      const agent = { ...salesAgent, backstory: "Expert in B2B." };
      const tenant = makeTenant({ agents: [agent] });
      const result = resolveAgentContext(tenant, textParts("hello"));
      expect(result.systemPrompt).toContain("Expert in B2B.");
    });

    it("agent with instructions includes instructions in prompt", () => {
      const agent = { ...salesAgent, instructions: "Be concise." };
      const tenant = makeTenant({ agents: [agent] });
      const result = resolveAgentContext(tenant, textParts("hello"));
      expect(result.systemPrompt).toContain("Be concise.");
    });

    it("no routingResult in response", () => {
      const tenant = makeTenant({ agents: [salesAgent] });
      const result = resolveAgentContext(tenant, textParts("hello"));
      expect(result.routingResult).toBeUndefined();
    });
  });

  describe("multi-agent with routing", () => {
    const multiTenant = makeTenant({
      agents: [salesAgent, supportAgent],
      routing: {
        rules: [
          { match: "sales|pricing|buy", agent: "sales-agent" },
          { match: "support|help|issue", agent: "support-agent" },
        ],
        fallback: "support-agent",
      },
    });

    it("message matching sales rule routes to sales agent", () => {
      const result = resolveAgentContext(multiTenant, textParts("I want to buy something"));
      expect(result.activeAgentId).toBe("sales-agent");
      expect(result.activeAgentName).toBe("Sales Bot");
    });

    it("no match falls to fallback agent", () => {
      const result = resolveAgentContext(multiTenant, textParts("good morning"));
      expect(result.activeAgentId).toBe("support-agent");
      expect(result.activeAgentName).toBe("Support Bot");
    });

    it("routed agent not found fails open to first agent", () => {
      const tenant = makeTenant({
        agents: [salesAgent, supportAgent],
        routing: {
          rules: [{ match: "billing", agent: "nonexistent-agent" }],
          fallback: "nonexistent-fallback",
        },
      });
      const result = resolveAgentContext(tenant, textParts("billing question"));
      // Should fall back to first agent since routed agent doesn't exist
      expect(result.activeAgentId).toBe("sales-agent");
    });

    it("routingResult present in response", () => {
      const result = resolveAgentContext(multiTenant, textParts("I need help"));
      expect(result.routingResult).toBeDefined();
      expect(result.routingResult!.agentId).toBe("support-agent");
      expect(result.routingResult!.tier).toBe("rule");
    });

    it("previousAgentId from session", () => {
      const session = new RuntimeSession({
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "user1",
        systemPrompt: "Hello",
      });
      session.setActiveAgent("sales-agent");

      const result = resolveAgentContext(
        multiTenant,
        textParts("I need help"),
        undefined,
        session,
      );
      expect(result.previousAgentId).toBe("sales-agent");
    });

    it("activeAgentId populated", () => {
      const result = resolveAgentContext(multiTenant, textParts("pricing info"));
      expect(result.activeAgentId).toBeDefined();
    });

    it("activeAgentName populated", () => {
      const result = resolveAgentContext(multiTenant, textParts("pricing info"));
      expect(result.activeAgentName).toBeDefined();
    });
  });

  describe("multi-agent without routing config", () => {
    it("falls to first agent", () => {
      const tenant = makeTenant({
        agents: [salesAgent, supportAgent],
      });
      const result = resolveAgentContext(tenant, textParts("hello"));
      expect(result.activeAgentId).toBe("sales-agent");
      expect(result.activeAgentName).toBe("Sales Bot");
    });
  });

  describe("tool scoping", () => {
    it("agent with tools restricts allowlist (intersection with tenant tools)", () => {
      const tenant = makeTenant({
        agents: [{ ...salesAgent, tools: ["check_inventory", "get_pricing"] }],
        tools: ["check_inventory", "get_pricing", "create_ticket"],
      });
      const result = resolveAgentContext(tenant, textParts("hello"));
      const allowlist = result.tenantToolContext.toolAllowlist;
      expect(allowlist).toBeDefined();
      expect(allowlist!.has("check_inventory")).toBe(true);
      expect(allowlist!.has("get_pricing")).toBe(true);
      expect(allowlist!.has("create_ticket")).toBe(false);
    });

    it("agent without tools gets empty allowlist (zero-trust)", () => {
      const tenant = makeTenant({
        agents: [salesAgent],
        tools: ["check_inventory", "get_pricing"],
      });
      const result = resolveAgentContext(tenant, textParts("hello"));
      const allowlist = result.tenantToolContext.toolAllowlist;
      expect(allowlist).toBeDefined();
      expect(allowlist!.size).toBe(0);
    });

    it("agent with wildcard tools inherits full tenant allowlist", () => {
      const tenant = makeTenant({
        agents: [{ ...salesAgent, tools: ["*"] }],
        tools: ["check_inventory", "get_pricing"],
      });
      const result = resolveAgentContext(tenant, textParts("hello"));
      const allowlist = result.tenantToolContext.toolAllowlist;
      expect(allowlist).toBeDefined();
      expect(allowlist!.has("check_inventory")).toBe(true);
      expect(allowlist!.has("get_pricing")).toBe(true);
    });

    it("agent with wildcard and no tenant tools gets no allowlist restriction", () => {
      const tenant = makeTenant({
        agents: [{ ...salesAgent, tools: ["*"] }],
      });
      const result = resolveAgentContext(tenant, textParts("hello"));
      expect(result.tenantToolContext.toolAllowlist).toBeUndefined();
    });

    it("agent with tools but no tenant tools uses agent tools directly", () => {
      const tenant = makeTenant({
        agents: [{ ...salesAgent, tools: ["agent_tool_a", "agent_tool_b"] }],
      });
      const result = resolveAgentContext(tenant, textParts("hello"));
      const allowlist = result.tenantToolContext.toolAllowlist;
      expect(allowlist).toBeDefined();
      expect(allowlist!.has("agent_tool_a")).toBe(true);
      expect(allowlist!.has("agent_tool_b")).toBe(true);
    });

    it("existingBuiltins passed through to tool context", () => {
      const builtins = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
      builtins.set("notify_owner", async () => ({ ok: true }));

      const tenant = makeTenant({ agents: [{ ...salesAgent, tools: ["*"] }] });
      const result = resolveAgentContext(tenant, textParts("hello"), undefined, undefined, builtins);
      expect(result.tenantToolContext.callBuiltinTools.has("notify_owner")).toBe(true);
    });
  });

  describe("channel parameter", () => {
    it("resolveAgentContext with channel parameter", () => {
      const tenant = makeTenant({ agents: [salesAgent] });
      const result = resolveAgentContext(tenant, textParts("hello"), "whatsapp");
      expect(result.activeAgentId).toBe("sales-agent");
      expect(result.systemPrompt).toBeTruthy();
    });
  });
});
