import { describe, expect, it } from "vitest";
import { textParts } from "@kilnai/core/engine";
import { DefaultTenantRouter } from "../../src/tenant/tenant-router.js";

describe("DefaultTenantRouter", () => {
  it("routes the first matching rule", () => {
    const router = new DefaultTenantRouter({
      rules: [
        { match: "billing", agent: "billing-agent" },
        { match: "support", agent: "support-agent" },
      ],
      fallback: "default-agent",
    });

    expect(router.route(textParts("I need billing help")).agentId).toBe("billing-agent");
    expect(router.route(textParts("I need support")).agentId).toBe("support-agent");
  });

  it("uses the configured fallback when no rule matches", () => {
    const router = new DefaultTenantRouter({
      rules: [{ match: "sales", agent: "sales-agent" }],
      fallback: "default-agent",
    });

    expect(router.route(textParts("hello there"))).toMatchObject({
      agentId: "default-agent",
      tier: "fallback",
    });
  });

  it("skips invalid rules and continues matching", () => {
    const router = new DefaultTenantRouter({
      rules: [
        { match: "[invalid(", agent: "broken-agent" },
        { match: "support", agent: "support-agent" },
      ],
      fallback: "default-agent",
    });

    expect(router.route(textParts("I need support")).agentId).toBe("support-agent");
  });
});
