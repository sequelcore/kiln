import { describe, it, expect } from "vitest";
import { mapEventToSpan } from "../../src/observability/span-mapper.js";
import type { PiiDetectedEvent, ContentClassifiedEvent, PolicyEvaluatedEvent } from "../../src/events/index.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makePiiDetectedEvent(overrides: Partial<PiiDetectedEvent> = {}): PiiDetectedEvent {
  return {
    type: "pii_detected",
    sessionId: "s1",
    timestamp: new Date(),
    direction: "input",
    piiTypes: ["email", "phone"],
    action: "redact",
    count: 2,
    tier: "heuristic",
    ...overrides,
  };
}

function makeContentClassifiedEvent(overrides: Partial<ContentClassifiedEvent> = {}): ContentClassifiedEvent {
  return {
    type: "content_classified",
    sessionId: "s1",
    timestamp: new Date(),
    direction: "output",
    categories: { hate: 0.1 },
    blocked: false,
    tier: "heuristic",
    ...overrides,
  };
}

function makePolicyEvaluatedEvent(overrides: Partial<PolicyEvaluatedEvent> = {}): PolicyEvaluatedEvent {
  return {
    type: "policy_evaluated",
    sessionId: "s1",
    timestamp: new Date(),
    railType: "topic",
    allowed: true,
    direction: "input",
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("mapEventToSpan - safety events", () => {
  it("pii_detected event maps to addEvent with safety.pii_detected name", () => {
    const event = makePiiDetectedEvent();
    const op = mapEventToSpan(event);

    expect(op.action).toBe("addEvent");
    if (op.action === "addEvent") {
      expect(op.name).toBe("safety.pii_detected");
    }
  });

  it("content_classified event maps to addEvent with safety.content_classified name", () => {
    const event = makeContentClassifiedEvent();
    const op = mapEventToSpan(event);

    expect(op.action).toBe("addEvent");
    if (op.action === "addEvent") {
      expect(op.name).toBe("safety.content_classified");
    }
  });

  it("policy_evaluated event maps to addEvent with safety.policy_evaluated name", () => {
    const event = makePolicyEvaluatedEvent();
    const op = mapEventToSpan(event);

    expect(op.action).toBe("addEvent");
    if (op.action === "addEvent") {
      expect(op.name).toBe("safety.policy_evaluated");
    }
  });

  it("pii_detected includes direction, piiTypes (joined), action, count, tier attributes", () => {
    const event = makePiiDetectedEvent({
      direction: "output",
      piiTypes: ["ssn", "credit_card"],
      action: "block",
      count: 3,
      tier: "heuristic",
    });
    const op = mapEventToSpan(event);

    expect(op.action).toBe("addEvent");
    if (op.action === "addEvent") {
      expect(op.attributes["direction"]).toBe("output");
      expect(op.attributes["piiTypes"]).toBe("ssn,credit_card");
      expect(op.attributes["action"]).toBe("block");
      expect(op.attributes["count"]).toBe(3);
      expect(op.attributes["tier"]).toBe("heuristic");
    }
  });

  it("content_classified includes direction, blocked, tier attributes", () => {
    const event = makeContentClassifiedEvent({
      direction: "input",
      blocked: true,
      tier: "heuristic",
    });
    const op = mapEventToSpan(event);

    expect(op.action).toBe("addEvent");
    if (op.action === "addEvent") {
      expect(op.attributes["direction"]).toBe("input");
      expect(op.attributes["blocked"]).toBe(true);
      expect(op.attributes["tier"]).toBe("heuristic");
    }
  });

  it("policy_evaluated includes railType, allowed, direction attributes", () => {
    const event = makePolicyEvaluatedEvent({
      railType: "compliance",
      allowed: false,
      direction: "output",
    });
    const op = mapEventToSpan(event);

    expect(op.action).toBe("addEvent");
    if (op.action === "addEvent") {
      expect(op.attributes["railType"]).toBe("compliance");
      expect(op.attributes["allowed"]).toBe(false);
      expect(op.attributes["direction"]).toBe("output");
    }
  });

  it("policy_evaluated with reason includes reason truncated to 256", () => {
    const longReason = "X".repeat(300);
    const event = makePolicyEvaluatedEvent({ reason: longReason });
    const op = mapEventToSpan(event);

    expect(op.action).toBe("addEvent");
    if (op.action === "addEvent") {
      const reason = op.attributes["reason"] as string;
      expect(reason).toBeDefined();
      expect(reason.length).toBe(256);
      expect(reason).toBe("X".repeat(256));
    }
  });
});
