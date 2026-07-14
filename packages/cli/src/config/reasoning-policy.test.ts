import { describe, expect, it } from "vitest";
import {
  resolveConfiguredReasoningEffort,
  resolveConfiguredReasoningEffortEvidence,
} from "./reasoning-policy.js";

describe("resolveConfiguredReasoningEffort", () => {
  it("uses explicit effort as authoritative after capability validation", () => {
    expect(resolveConfiguredReasoningEffort({
      explicitReasoningEffort: "high",
      policy: {
        byTask: {
          "mechanical-edit": "low",
        },
      },
      task: "mechanical-edit",
      supportedReasoningEfforts: ["low", "high"],
    })).toBe("high");
  });

  it("gates xhigh task policy until budgeted promotion evidence exists", () => {
    expect(resolveConfiguredReasoningEffortEvidence({
      policy: {
        default: "medium",
        byTask: { "architecture-review": "xhigh" },
      },
      task: "architecture-review",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    })).toEqual({ status: "omitted", requested: "xhigh", reason: "xhigh-disabled" });

    expect(resolveConfiguredReasoningEffort({
      policy: {
        default: "medium",
        byTask: {
          "architecture-review": "xhigh",
        },
      },
      task: "architecture-review",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
      allowExperimentalXhigh: true,
      xhighPromotionEligible: true,
      budgetUsd: 1,
      estimatedEffortCostUsd: 0.2,
    })).toBe("xhigh");
  });

  it("omits automatic effort when support is unknown", () => {
    expect(resolveConfiguredReasoningEffort({
      policy: {
        default: "medium",
      },
    })).toBeUndefined();
  });

  it("omits automatic effort when the route does not support the configured value", () => {
    expect(resolveConfiguredReasoningEffort({
      policy: {
        default: "xhigh",
        unsupported: "omit",
      },
      supportedReasoningEfforts: ["low", "medium", "high"],
    })).toBeUndefined();
  });

  it("fails when policy requires support and the route rejects the configured value", () => {
    expect(() => resolveConfiguredReasoningEffort({
      policy: {
        default: "xhigh",
        unsupported: "fail",
      },
      provider: "opencode-go",
      model: "minimax-m2.7",
      supportedReasoningEfforts: ["low", "medium", "high"],
    })).toThrow("Requested reasoning effort 'xhigh' is unsupported or unavailable: unsupported");
  });

  it("fails closed when explicit effort support is unknown or unsupported", () => {
    expect(() => resolveConfiguredReasoningEffort({
      explicitReasoningEffort: "high",
      provider: "codex-oauth",
      model: "gpt-test",
    })).toThrow("Requested reasoning effort 'high' is unsupported or unavailable: capability-unknown");

    expect(resolveConfiguredReasoningEffortEvidence({
      explicitReasoningEffort: "high",
      policy: { unsupported: "omit" },
      supportedReasoningEfforts: ["low"],
    })).toEqual({ status: "omitted", requested: "high", reason: "unsupported" });
  });
});
