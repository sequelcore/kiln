import { describe, expect, it } from "vitest";
import {
  KNOWN_DELIBERATION_LEVEL_IDS,
  type ModelDeliberationCapabilities,
} from "@kilnai/core";
import { resolveConfiguredDeliberation } from "./deliberation-policy.js";

const LEVEL = KNOWN_DELIBERATION_LEVEL_IDS;
const CAPABILITIES: ModelDeliberationCapabilities = {
  provider: "codex-oauth",
  model: "gpt-test",
  levels: [LEVEL.low, LEVEL.medium, LEVEL.high, LEVEL.xhigh].map((id) => ({ id })),
  defaultLevel: LEVEL.medium,
  supportsAdaptive: true,
  evidence: {
    sourceIdentity: "synthetic-catalog",
    sourceRevision: "revision-1",
    observedAt: "2026-08-02T00:00:00.000Z",
  },
};

describe("resolveConfiguredDeliberation", () => {
  it("gives an explicit operator level precedence over every configured scope", () => {
    const resolution = resolveConfiguredDeliberation({
      explicitLevel: "high",
      policy: {
        default: { mode: "fixed", preferredLevel: "low" },
        byTask: { "mechanical-edit": { mode: "fixed", preferredLevel: "medium" } },
        byRoute: [{
          provider: "codex-oauth",
          model: "gpt-test",
          mode: "fixed",
          preferredLevel: "xhigh",
        }],
      },
      task: "mechanical-edit",
      capabilities: CAPABILITIES,
    });

    expect(resolution.status).toBe("exact");
    expect(resolution.source).toBe("operator");
    expect(resolution.status === "exact" && resolution.selectedLevel).toBe("high");
  });

  it("resolves route before task and project policy", () => {
    const resolution = resolveConfiguredDeliberation({
      policy: {
        default: { mode: "fixed", preferredLevel: "low" },
        byTask: { research: { mode: "fixed", preferredLevel: "medium" } },
        byRoute: [{
          provider: "codex-oauth",
          model: "gpt-test",
          mode: "adaptive",
          target: "quality-first",
        }],
      },
      task: "research",
      provider: "codex-oauth",
      model: "gpt-test",
      capabilities: CAPABILITIES,
    });

    expect(resolution.status).toBe("exact");
    expect(resolution.source).toBe("route");
    expect(resolution.status === "exact" && resolution.selectedLevel).toBe("xhigh");
  });

  it("uses the provider default without turning it into an explicit override", () => {
    const resolution = resolveConfiguredDeliberation({
      policy: { default: { mode: "provider-default" } },
      capabilities: CAPABILITIES,
    });

    expect(resolution).toMatchObject({
      status: "defaulted",
      source: "provider-default",
      selectedLevel: "medium",
    });
  });

  it("fails closed with evidence when capability is unknown", () => {
    expect(resolveConfiguredDeliberation({
      policy: { default: { mode: "fixed", preferredLevel: "high" } },
    })).toMatchObject({
      status: "denied",
      source: "project",
      reason: "capability-unknown",
    });
  });

  it("clamps only when the configured rule explicitly admits it", () => {
    expect(resolveConfiguredDeliberation({
      policy: {
        default: {
          mode: "fixed",
          preferredLevel: "xhigh",
          bounds: { max: "high" },
          onUnsupported: "allow-clamp",
        },
      },
      capabilities: CAPABILITIES,
    })).toMatchObject({
      status: "clamped",
      source: "project",
      selectedLevel: "high",
      reason: "preferred-level-outside-bounds",
    });
  });

  it("does not invent a provider default when no policy was requested", () => {
    expect(resolveConfiguredDeliberation({ capabilities: CAPABILITIES })).toEqual({
      status: "omitted",
      source: "provider-default",
      reason: "not-requested",
    });
  });
});
