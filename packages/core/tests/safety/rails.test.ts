import { describe, it, expect } from "vitest";
import { TopicRail, CompetitorRail, EscalationRail, ComplianceRail, createRail } from "../../src/safety/rails.js";
import type { RailConfig } from "../../src/engine/domain/safety-config.js";

describe("TopicRail", () => {
  it("blocks on matched blocked topic (case-insensitive)", () => {
    const rail = new TopicRail({ type: "topic", block: ["Gambling"] });
    const result = rail.evaluate("I want to talk about gambling strategies.", "input");
    expect(result.allowed).toBe(false);
    expect(result.railType).toBe("topic");
    expect(result.reason).toContain("Gambling");
  });

  it("allows when no match", () => {
    const rail = new TopicRail({ type: "topic", block: ["gambling"] });
    const result = rail.evaluate("Tell me about cooking recipes.", "input");
    expect(result.allowed).toBe(true);
  });

  it("sets escalate flag on escalation topic match", () => {
    const rail = new TopicRail({ type: "topic", escalate: ["speak to a manager"] });
    const result = rail.evaluate("I need to speak to a manager now.", "input");
    expect(result.allowed).toBe(true);
    expect(result.escalate).toBe(true);
    expect(result.reason).toContain("speak to a manager");
  });
});

describe("CompetitorRail", () => {
  const competitorConfig = {
    type: "competitor" as const,
    competitors: ["OpenAI", "Google"],
    response: "We focus on our own products.",
  };

  it("blocks on competitor name match with response suggestion", () => {
    const rail = new CompetitorRail(competitorConfig);
    const result = rail.evaluate("How does this compare to openai?", "input");
    expect(result.allowed).toBe(false);
    expect(result.railType).toBe("competitor");
    expect(result.suggestion).toBe("We focus on our own products.");
  });

  it("allows when no competitor mentioned", () => {
    const rail = new CompetitorRail(competitorConfig);
    const result = rail.evaluate("Tell me about your product.", "input");
    expect(result.allowed).toBe(true);
  });
});

describe("EscalationRail", () => {
  it("always allowed, sets escalate on trigger match", () => {
    const rail = new EscalationRail({ type: "escalation", triggers: ["urgent", "emergency"] });
    const result = rail.evaluate("This is an emergency!", "input");
    expect(result.allowed).toBe(true);
    expect(result.escalate).toBe(true);
    expect(result.railType).toBe("escalation");
  });

  it("allowed without escalate when no trigger", () => {
    const rail = new EscalationRail({ type: "escalation", triggers: ["urgent", "emergency"] });
    const result = rail.evaluate("Just a regular question.", "input");
    expect(result.allowed).toBe(true);
    expect(result.escalate).toBeUndefined();
  });
});

describe("ComplianceRail", () => {
  it("allows input always (direction-specific)", () => {
    const rail = new ComplianceRail({
      type: "compliance",
      required: ["disclaimer"],
      forbid: ["guaranteed"],
    });
    // Input should always be allowed regardless of content
    const result = rail.evaluate("This is guaranteed returns with no disclaimer.", "input");
    expect(result.allowed).toBe(true);
    expect(result.railType).toBe("compliance");
  });

  it("blocks output when required phrase missing", () => {
    const rail = new ComplianceRail({
      type: "compliance",
      required: ["past performance is not indicative of future results"],
    });
    const result = rail.evaluate("Our fund has returned 20% annually.", "output");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Required phrase missing");
  });

  it("blocks output when forbidden phrase present", () => {
    const rail = new ComplianceRail({
      type: "compliance",
      forbid: ["guaranteed returns"],
    });
    const result = rail.evaluate("We offer guaranteed returns on your investment.", "output");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Forbidden phrase detected");
  });

  it("allows output when all requirements met and no forbidden phrases", () => {
    const rail = new ComplianceRail({
      type: "compliance",
      required: ["disclaimer"],
      forbid: ["guaranteed"],
    });
    const result = rail.evaluate("See our disclaimer for full details.", "output");
    expect(result.allowed).toBe(true);
  });
});

describe("createRail factory", () => {
  it("creates TopicRail for type 'topic'", () => {
    const rail = createRail({ type: "topic", block: ["spam"] });
    expect(rail).toBeInstanceOf(TopicRail);
  });

  it("creates CompetitorRail for type 'competitor'", () => {
    const rail = createRail({ type: "competitor", competitors: ["Rival"], response: "No comment." });
    expect(rail).toBeInstanceOf(CompetitorRail);
  });

  it("creates EscalationRail for type 'escalation'", () => {
    const rail = createRail({ type: "escalation", triggers: ["help"] });
    expect(rail).toBeInstanceOf(EscalationRail);
  });

  it("creates ComplianceRail for type 'compliance'", () => {
    const rail = createRail({ type: "compliance", required: ["terms"] });
    expect(rail).toBeInstanceOf(ComplianceRail);
  });
});
