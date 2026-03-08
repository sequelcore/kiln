import { describe, it, expect } from "vitest";
import type { TenantConfig } from "../../../src/engine/gateway/tenant-config.js";
import { validateTenantConfig } from "../../../src/engine/gateway/tenant-config.js";

function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "test-tenant",
    appName: "test-app",
    name: "Test",
    enabled: true,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

function makeAgent(overrides: Partial<TenantConfig["agents"] extends readonly (infer T)[] | undefined ? T : never> = {}) {
  return {
    id: "agent-1",
    name: "Agent One",
    role: "Support",
    goal: "Help users",
    ...overrides,
  };
}

describe("TenantConfig multi-agent validation", () => {
  // ── Backward Compatibility ──────────────────────────────────────────

  describe("backward compatibility", () => {
    it("passes when no agents field is present", () => {
      const config = makeTenantConfig();
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("passes with an empty agents array", () => {
      const config = makeTenantConfig({ agents: [] });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("passes with a single agent and no routing", () => {
      const config = makeTenantConfig({
        agents: [makeAgent()],
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("passes with a single agent and routing (routing ignored but not rejected)", () => {
      const config = makeTenantConfig({
        agents: [makeAgent()],
        routing: { fallback: "agent-1", rules: [] },
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });
  });

  // ── Multi-Agent Valid Cases ─────────────────────────────────────────

  describe("multi-agent valid cases", () => {
    it("passes with 3 agents and valid routing", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({ id: "sales", name: "Sales", role: "Sales", goal: "Sell" }),
          makeAgent({ id: "support", name: "Support", role: "Support", goal: "Help" }),
          makeAgent({ id: "billing", name: "Billing", role: "Billing", goal: "Invoice" }),
        ],
        routing: {
          fallback: "support",
          rules: [
            { match: "price|cost", agent: "sales" },
            { match: "invoice|payment", agent: "billing" },
          ],
        },
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("passes when an agent has the isDefault flag", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({ id: "primary", isDefault: true }),
          makeAgent({ id: "secondary", name: "Secondary", role: "Backup", goal: "Fallback" }),
        ],
        routing: { fallback: "primary" },
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("passes when an agent has backstory and instructions", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({
            backstory: "Created to handle complex queries",
            instructions: "Always be polite and thorough",
          }),
        ],
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("passes when agent tools are a subset of tenant tools", () => {
      const config = makeTenantConfig({
        tools: ["search", "calendar", "email"],
        agents: [makeAgent({ tools: ["search", "calendar"] })],
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("passes when agent tools reference webhookTools", () => {
      const config = makeTenantConfig({
        webhookTools: [
          { name: "crm_lookup", url: "https://api.example.com/crm", secret: "s3cret" },
        ],
        agents: [makeAgent({ tools: ["crm_lookup"] })],
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });
  });

  // ── Agent Validation Errors ─────────────────────────────────────────

  describe("agent validation errors", () => {
    it("reports error for duplicate agent IDs", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({ id: "dup" }),
          makeAgent({ id: "dup", name: "Duplicate" }),
        ],
        routing: { fallback: "dup" },
      });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "agents[1].id" && e.message.includes("duplicate"))).toBe(true);
    });

    it("reports error for agent with empty id", () => {
      const config = makeTenantConfig({
        agents: [makeAgent({ id: "" })],
      });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "agents[0].id")).toBe(true);
    });

    it("reports error for agent with empty name", () => {
      const config = makeTenantConfig({
        agents: [makeAgent({ name: "" })],
      });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "agents[0].name")).toBe(true);
    });

    it("reports error for agent with empty role", () => {
      const config = makeTenantConfig({
        agents: [makeAgent({ role: "" })],
      });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "agents[0].role")).toBe(true);
    });

    it("reports error for agent with empty goal", () => {
      const config = makeTenantConfig({
        agents: [makeAgent({ goal: "" })],
      });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "agents[0].goal")).toBe(true);
    });

    it("reports error for agent tool not in tenant tools or webhookTools", () => {
      const config = makeTenantConfig({
        tools: ["search"],
        agents: [makeAgent({ tools: ["unknown_tool"] })],
      });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "agents[0].tools[0]" && e.message.includes("unknown_tool"))).toBe(true);
    });
  });

  // ── Routing Validation ──────────────────────────────────────────────

  describe("routing validation", () => {
    it("reports error when agents.length > 1 without routing", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({ id: "a1" }),
          makeAgent({ id: "a2", name: "Two", role: "Two", goal: "Two" }),
        ],
      });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "routing" && e.message.includes("required when agents.length > 1"))).toBe(true);
    });

    it("reports error when routing.fallback references unknown agent", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({ id: "a1" }),
          makeAgent({ id: "a2", name: "Two", role: "Two", goal: "Two" }),
        ],
        routing: { fallback: "nonexistent" },
      });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "routing.fallback" && e.message.includes("unknown agent"))).toBe(true);
    });

    it("reports error when routing.fallback is empty", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({ id: "a1" }),
          makeAgent({ id: "a2", name: "Two", role: "Two", goal: "Two" }),
        ],
        routing: { fallback: "" },
      });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "routing.fallback")).toBe(true);
    });

    it("reports error when routing rule has invalid regex", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({ id: "a1" }),
          makeAgent({ id: "a2", name: "Two", role: "Two", goal: "Two" }),
        ],
        routing: {
          fallback: "a1",
          rules: [{ match: "[invalid(", agent: "a1" }],
        },
      });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "routing.rules[0].match" && e.message.includes("invalid regex"))).toBe(true);
    });

    it("reports error when routing rule agent references unknown agent", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({ id: "a1" }),
          makeAgent({ id: "a2", name: "Two", role: "Two", goal: "Two" }),
        ],
        routing: {
          fallback: "a1",
          rules: [{ match: "hello", agent: "ghost" }],
        },
      });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "routing.rules[0].agent" && e.message.includes("unknown agent"))).toBe(true);
    });

    it("reports error when routing rule agent is empty", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({ id: "a1" }),
          makeAgent({ id: "a2", name: "Two", role: "Two", goal: "Two" }),
        ],
        routing: {
          fallback: "a1",
          rules: [{ match: "hello", agent: "" }],
        },
      });
      const errors = validateTenantConfig(config);
      expect(errors.some((e) => e.field === "routing.rules[0].agent")).toBe(true);
    });

    it("passes with valid routing containing multiple rules", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({ id: "sales", name: "Sales", role: "Sales", goal: "Sell" }),
          makeAgent({ id: "support", name: "Support", role: "Support", goal: "Help" }),
          makeAgent({ id: "billing", name: "Billing", role: "Billing", goal: "Invoice" }),
        ],
        routing: {
          fallback: "support",
          rules: [
            { match: "price|quote|buy", agent: "sales" },
            { match: "invoice|charge|refund", agent: "billing" },
            { match: "help|issue|problem", agent: "support" },
          ],
        },
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("passes with empty routing rules (only fallback used)", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({ id: "a1" }),
          makeAgent({ id: "a2", name: "Two", role: "Two", goal: "Two" }),
        ],
        routing: { fallback: "a1", rules: [] },
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("passes when agent has an empty tools array (inherits tenant tools)", () => {
      const config = makeTenantConfig({
        tools: ["search"],
        agents: [makeAgent({ tools: [] })],
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("passes with 2 agents and routing (minimum multi-agent)", () => {
      const config = makeTenantConfig({
        agents: [
          makeAgent({ id: "a" }),
          makeAgent({ id: "b", name: "B", role: "B", goal: "B" }),
        ],
        routing: { fallback: "a" },
      });
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("passes agent tools validation when tenant has no tools defined", () => {
      const config = makeTenantConfig({
        agents: [makeAgent({ tools: ["anything"] })],
      });
      // No tenant tools and no webhookTools → allToolNames is empty → skip tool subset check
      expect(validateTenantConfig(config)).toEqual([]);
    });

    it("returns multiple validation errors simultaneously", () => {
      const config = makeTenantConfig({
        agents: [
          { id: "", name: "", role: "", goal: "" },
          { id: "", name: "", role: "", goal: "" },
        ],
      });
      const errors = validateTenantConfig(config);
      // Should have errors for: agent[0].id, agent[0].name, agent[0].role, agent[0].goal,
      // agent[1].id, agent[1].name, agent[1].role, agent[1].goal, and routing (required for >1 agents)
      expect(errors.length).toBeGreaterThanOrEqual(9);
    });
  });
});
