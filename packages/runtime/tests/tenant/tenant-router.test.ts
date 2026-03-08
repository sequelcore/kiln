import { describe, it, expect } from "vitest";
import { textParts } from "@kilnai/core";
import { DefaultTenantRouter } from "../../src/tenant/tenant-router.js";

describe("DefaultTenantRouter", () => {
  describe("regex rule matching", () => {
    it("basic regex match routes to correct agent", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I want to talk to sales"));
      expect(result.agentId).toBe("sales-agent");
    });

    it("case-insensitive matching", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("SALES please"));
      expect(result.agentId).toBe("sales-agent");
    });

    it("first match wins when multiple rules match", () => {
      const router = new DefaultTenantRouter({
        rules: [
          { match: "help", agent: "support-agent" },
          { match: "help", agent: "faq-agent" },
        ],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I need help"));
      expect(result.agentId).toBe("support-agent");
    });

    it("multiple rules, second one matches", () => {
      const router = new DefaultTenantRouter({
        rules: [
          { match: "billing", agent: "billing-agent" },
          { match: "support", agent: "support-agent" },
        ],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I need support"));
      expect(result.agentId).toBe("support-agent");
    });

    it("complex pattern: multi-word regex", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "book.*appointment", agent: "booking-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I want to book an appointment"));
      expect(result.agentId).toBe("booking-agent");
    });

    it("regex with special chars (word boundary)", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "\\bprice\\b", agent: "pricing-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("What is the price?"));
      expect(result.agentId).toBe("pricing-agent");
    });

    it("pattern with | alternation", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "refund|return|exchange", agent: "returns-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I need a return"));
      expect(result.agentId).toBe("returns-agent");
    });

    it("pattern with quantifiers (.*pricing.*)", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: ".*pricing.*", agent: "pricing-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("tell me about your pricing plans"));
      expect(result.agentId).toBe("pricing-agent");
    });

    it("long message matches rule in middle of text", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "billing", agent: "billing-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(
        textParts("Hello, I have a question. It is about billing for my account. Can you help?"),
      );
      expect(result.agentId).toBe("billing-agent");
    });

    it("unicode text in message (accented chars)", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "facturación", agent: "billing-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("Necesito ayuda con facturación"));
      expect(result.agentId).toBe("billing-agent");
    });
  });

  describe("fallback behavior", () => {
    it("no match falls to fallback", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("hello there"));
      expect(result.agentId).toBe("default-agent");
    });

    it("empty rules array falls to fallback immediately", () => {
      const router = new DefaultTenantRouter({
        rules: [],
        fallback: "default-agent",
      });
      const result = router.route(textParts("anything"));
      expect(result.agentId).toBe("default-agent");
    });

    it("no rules key falls to fallback immediately", () => {
      const router = new DefaultTenantRouter({
        fallback: "default-agent",
      });
      const result = router.route(textParts("anything"));
      expect(result.agentId).toBe("default-agent");
    });

    it("empty message text falls to fallback", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts(""));
      expect(result.agentId).toBe("default-agent");
    });
  });

  describe("invalid regex handling", () => {
    it("invalid regex in rules is skipped (fail-open), continues to next rule", () => {
      const router = new DefaultTenantRouter({
        rules: [
          { match: "[invalid(", agent: "broken-agent" },
          { match: "support", agent: "support-agent" },
        ],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I need support"));
      expect(result.agentId).toBe("support-agent");
    });

    it("mixed valid/invalid regex rules: invalid skipped, valid evaluated", () => {
      const router = new DefaultTenantRouter({
        rules: [
          { match: "(?invalid", agent: "bad-agent" },
          { match: "sales", agent: "sales-agent" },
          { match: "[broken", agent: "another-bad-agent" },
        ],
        fallback: "default-agent",
      });
      const result = router.route(textParts("sales question"));
      expect(result.agentId).toBe("sales-agent");
    });
  });

  describe("routing result shape", () => {
    it("has tier 'rule' for matched rule", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("sales"));
      expect(result.tier).toBe("rule");
    });

    it("has tier 'fallback' for unmatched", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("hello"));
      expect(result.tier).toBe("fallback");
    });

    it("includes matchedPattern for matched rule", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "book.*appointment", agent: "booking-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("I want to book an appointment"));
      expect(result.matchedPattern).toBe("book.*appointment");
    });

    it("omits matchedPattern for fallback", () => {
      const router = new DefaultTenantRouter({
        rules: [{ match: "sales", agent: "sales-agent" }],
        fallback: "default-agent",
      });
      const result = router.route(textParts("hello"));
      expect(result.matchedPattern).toBeUndefined();
    });
  });
});
