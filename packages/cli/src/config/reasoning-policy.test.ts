import { describe, expect, it } from "vitest";
import { resolveConfiguredReasoningEffort } from "./reasoning-policy.js";

describe("resolveConfiguredReasoningEffort", () => {
  it("uses explicit effort as authoritative", () => {
    expect(resolveConfiguredReasoningEffort({
      explicitReasoningEffort: "high",
      policy: {
        byTask: {
          "mechanical-edit": "low",
        },
      },
      task: "mechanical-edit",
      supportedReasoningEfforts: ["low"],
    })).toBe("high");
  });

  it("selects task policy before default when the route advertises support", () => {
    expect(resolveConfiguredReasoningEffort({
      policy: {
        default: "medium",
        byTask: {
          "architecture-review": "xhigh",
        },
      },
      task: "architecture-review",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
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
    })).toThrow("Reasoning effort 'xhigh' is not supported by opencode-go/minimax-m2.7");
  });
});
