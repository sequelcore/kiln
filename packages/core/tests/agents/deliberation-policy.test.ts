import { describe, expect, it } from "vitest";
import {
  KNOWN_DELIBERATION_LEVEL_IDS,
  defineDeliberationLevelId,
  resolveDeliberation,
  type DeliberationIntent,
  type ModelDeliberationCapabilities,
} from "../../src/index.js";

const LEVEL = KNOWN_DELIBERATION_LEVEL_IDS;

const CAPABILITIES: ModelDeliberationCapabilities = {
  provider: "test-provider",
  model: "test-model",
  levels: [LEVEL.low, LEVEL.medium, LEVEL.high].map((id) => ({ id })),
  defaultLevel: LEVEL.medium,
  supportsAdaptive: true,
  evidence: {
    sourceIdentity: "test-catalog",
    sourceRevision: "revision-7",
    observedAt: "2026-08-02T00:00:00.000Z",
  },
};

function intent(overrides: Partial<DeliberationIntent> = {}): DeliberationIntent {
  return {
    mode: "fixed",
    preferredLevel: LEVEL.medium,
    onUnsupported: "deny",
    ...overrides,
  };
}

describe("deliberation level identity", () => {
  it("accepts known and provider-defined portable identifiers", () => {
    expect(defineDeliberationLevelId("max")).toBe("max");
    expect(defineDeliberationLevelId("provider.custom-2")).toBe("provider.custom-2");
  });

  it("rejects identifiers that cannot cross provider and wire boundaries", () => {
    expect(() => defineDeliberationLevelId(" High ")).toThrow("portable identifier");
    expect(() => defineDeliberationLevelId("provider/custom")).toThrow("portable identifier");
  });
});

describe("resolveDeliberation", () => {
  it("preserves explicit source authority for an exact fixed selection", () => {
    expect(resolveDeliberation({
      intent: intent({ preferredLevel: LEVEL.high }),
      source: "operator",
      capabilities: CAPABILITIES,
    })).toEqual({
      status: "exact",
      requested: intent({ preferredLevel: LEVEL.high }),
      selectedLevel: LEVEL.high,
      source: "operator",
      capabilityEvidence: CAPABILITIES.evidence,
    });
  });

  it("returns fail-closed denial evidence instead of throwing", () => {
    expect(resolveDeliberation({
      intent: intent({ preferredLevel: LEVEL.xhigh }),
      source: "work-item",
      capabilities: CAPABILITIES,
    })).toEqual({
      status: "denied",
      requested: intent({ preferredLevel: LEVEL.xhigh }),
      source: "work-item",
      reason: "preferred-level-unsupported",
      capabilityEvidence: CAPABILITIES.evidence,
    });
  });

  it("clamps only through the selected model's ordered bounds", () => {
    expect(resolveDeliberation({
      intent: intent({
        preferredLevel: LEVEL.high,
        bounds: { max: LEVEL.medium },
        onUnsupported: "allow-clamp",
      }),
      source: "route",
      capabilities: CAPABILITIES,
    })).toMatchObject({
      status: "clamped",
      selectedLevel: LEVEL.medium,
      source: "route",
      reason: "preferred-level-outside-bounds",
    });

    const custom = defineDeliberationLevelId("provider.unadvertised");
    expect(resolveDeliberation({
      intent: intent({ preferredLevel: custom, onUnsupported: "allow-clamp" }),
      source: "route",
      capabilities: CAPABILITIES,
    })).toMatchObject({
      status: "denied",
      reason: "preferred-level-unsupported",
    });
  });

  it("reports provider defaults without converting them into operator choices", () => {
    expect(resolveDeliberation({
      intent: {
        mode: "provider-default",
        onUnsupported: "omit",
      },
      source: "project",
      capabilities: CAPABILITIES,
    })).toEqual({
      status: "defaulted",
      requested: {
        mode: "provider-default",
        onUnsupported: "omit",
      },
      selectedLevel: LEVEL.medium,
      source: "provider-default",
      capabilityEvidence: CAPABILITIES.evidence,
    });
  });

  it("omits when provider-default is requested without capability evidence", () => {
    expect(resolveDeliberation({
      intent: {
        mode: "provider-default",
        onUnsupported: "omit",
      },
      source: "project",
    })).toEqual({
      status: "omitted",
      requested: {
        mode: "provider-default",
        onUnsupported: "omit",
      },
      source: "provider-default",
      reason: "capability-unknown",
    });
  });

  it.each([
    ["latency-first", LEVEL.medium],
    ["balanced", LEVEL.medium],
    ["quality-first", LEVEL.high],
  ] as const)("selects adaptive %s work inside advertised bounds", (target, expected) => {
    expect(resolveDeliberation({
      intent: {
        mode: "adaptive",
        target,
        bounds: { min: LEVEL.medium, max: LEVEL.high },
        onUnsupported: "deny",
      },
      source: "task",
      capabilities: CAPABILITIES,
    })).toMatchObject({
      status: "exact",
      selectedLevel: expected,
      source: "task",
    });
  });

  it("denies adaptive intent when the model does not advertise adaptive support", () => {
    expect(resolveDeliberation({
      intent: {
        mode: "adaptive",
        target: "balanced",
        onUnsupported: "deny",
      },
      source: "task",
      capabilities: { ...CAPABILITIES, supportsAdaptive: false },
    })).toMatchObject({ status: "denied", reason: "adaptive-unsupported" });
  });

  it("denies reversed bounds and unsupported custom bounds deterministically", () => {
    expect(resolveDeliberation({
      intent: intent({ bounds: { min: LEVEL.high, max: LEVEL.low } }),
      source: "operator",
      capabilities: CAPABILITIES,
    })).toMatchObject({ status: "denied", reason: "invalid-bounds" });

    expect(resolveDeliberation({
      intent: intent({ bounds: { min: defineDeliberationLevelId("provider.unknown") } }),
      source: "operator",
      capabilities: CAPABILITIES,
    })).toMatchObject({ status: "denied", reason: "bound-unsupported" });
  });

  it("accepts capability-gated custom levels when advertised", () => {
    const custom = defineDeliberationLevelId("provider.deep");
    expect(resolveDeliberation({
      intent: intent({ preferredLevel: custom }),
      source: "agent-profile",
      capabilities: {
        ...CAPABILITIES,
        levels: [...CAPABILITIES.levels, { id: custom }],
      },
    })).toMatchObject({
      status: "exact",
      selectedLevel: custom,
      source: "agent-profile",
    });
  });
});
