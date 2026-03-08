import { describe, it, expect } from "vitest";
import { getRoutingTemplate, listRoutingTemplates } from "../../src/domains/routing-templates.js";
import type { RoutingTemplate } from "../../src/domains/routing-templates.js";
import { validateTenantConfig } from "../../src/engine/gateway/tenant-config.js";
import type { TenantConfig } from "../../src/engine/gateway/tenant-config.js";

function wrapAsConfig(template: RoutingTemplate): TenantConfig {
  return {
    tenantId: "test-tenant",
    appName: "test-app",
    name: template.name,
    enabled: true,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    agents: template.agents,
    routing: template.routing,
  };
}

const VALID_CATEGORIES = ["service", "ecommerce", "support", "hospitality"] as const;

describe("routing-templates", () => {
  it("all templates pass validateTenantConfig", () => {
    for (const template of listRoutingTemplates()) {
      const errors = validateTenantConfig(wrapAsConfig(template));
      expect(errors, `template "${template.id}" has validation errors`).toEqual([]);
    }
  });

  it("getRoutingTemplate returns correct template by id", () => {
    for (const template of listRoutingTemplates()) {
      const found = getRoutingTemplate(template.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(template.id);
      expect(found!.name).toBe(template.name);
    }
  });

  it("getRoutingTemplate returns undefined for unknown id", () => {
    expect(getRoutingTemplate("nonexistent")).toBeUndefined();
  });

  it("listRoutingTemplates returns all 3 templates", () => {
    expect(listRoutingTemplates()).toHaveLength(3);
  });

  it("template agent IDs match routing rule references", () => {
    for (const template of listRoutingTemplates()) {
      const agentIds = new Set(template.agents.map((a) => a.id));
      for (const rule of template.routing.rules ?? []) {
        expect(agentIds.has(rule.agent), `rule agent "${rule.agent}" missing in template "${template.id}"`).toBe(true);
      }
    }
  });

  it("template routing fallback references existing agent", () => {
    for (const template of listRoutingTemplates()) {
      const agentIds = new Set(template.agents.map((a) => a.id));
      expect(
        agentIds.has(template.routing.fallback),
        `fallback "${template.routing.fallback}" missing in template "${template.id}"`,
      ).toBe(true);
    }
  });

  it("no duplicate agent IDs within templates", () => {
    for (const template of listRoutingTemplates()) {
      const ids = template.agents.map((a) => a.id);
      expect(new Set(ids).size, `duplicate agent IDs in template "${template.id}"`).toBe(ids.length);
    }
  });

  it("all template categories are valid", () => {
    for (const template of listRoutingTemplates()) {
      expect(VALID_CATEGORIES).toContain(template.category);
    }
  });
});
