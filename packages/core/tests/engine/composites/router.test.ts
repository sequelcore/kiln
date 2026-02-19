import { describe, it, expect } from "vitest";
import type { Router, PatternRule } from "../../../src/engine/composites/router.js";
import { validateRouter } from "../../../src/engine/composites/router.js";
import type { Agent } from "../../../src/engine/domain/agent.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    name: "classifier",
    tier: "fast",
    tools: [],
    ...overrides,
  };
}

function makeRule(overrides: Partial<PatternRule> = {}): PatternRule {
  return {
    match: "^code:",
    team: "development",
    ...overrides,
  };
}

function makeRouter(overrides: Partial<Router> = {}): Router {
  return {
    rules: [makeRule()],
    fallback: "general",
    ...overrides,
  };
}

describe("Router composite", () => {
  describe("interface conformance", () => {
    it("accepts a valid Router", () => {
      const router = makeRouter();
      expect(router.fallback).toBe("general");
      expect(router.rules).toHaveLength(1);
      expect(router.classifier).toBeUndefined();
    });

    it("accepts a PatternRule", () => {
      const rule = makeRule();
      expect(rule.match).toBe("^code:");
      expect(rule.team).toBe("development");
    });

    it("accepts optional classifier agent", () => {
      const router = makeRouter({ classifier: makeAgent() });
      expect(router.classifier?.tier).toBe("fast");
    });

    it("accepts router with no rules", () => {
      const router = makeRouter({ rules: [] });
      expect(router.rules).toHaveLength(0);
    });
  });

  describe("validateRouter", () => {
    it("returns empty array for valid config", () => {
      expect(validateRouter(makeRouter())).toEqual([]);
    });

    it("returns empty array for router with no rules", () => {
      expect(validateRouter(makeRouter({ rules: [] }))).toEqual([]);
    });

    it("returns empty array for valid config with classifier", () => {
      const router = makeRouter({ classifier: makeAgent() });
      expect(validateRouter(router)).toEqual([]);
    });

    it("reports empty fallback", () => {
      const errors = validateRouter(makeRouter({ fallback: "" }));
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("fallback");
    });

    it("reports invalid regex in pattern rule", () => {
      const errors = validateRouter(makeRouter({ rules: [makeRule({ match: "[invalid" })] }));
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("rules[0].match");
      expect(errors[0]!.message).toContain("invalid regex");
    });

    it("reports empty rule match", () => {
      const errors = validateRouter(makeRouter({ rules: [makeRule({ match: "" })] }));
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("rules[0].match");
    });

    it("reports empty rule team", () => {
      const errors = validateRouter(makeRouter({ rules: [makeRule({ team: "" })] }));
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("rules[0].team");
    });

    it("reports non-fast classifier tier", () => {
      const errors = validateRouter(makeRouter({ classifier: makeAgent({ tier: "coding" }) }));
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("classifier.tier");
    });

    it("accumulates multiple errors", () => {
      const router = makeRouter({
        fallback: "",
        rules: [makeRule({ match: "[bad", team: "" })],
        classifier: makeAgent({ tier: "reasoning" }),
      });
      const errors = validateRouter(router);
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
