import { describe, expect, it } from "vitest";
import {
  buildWorkGovernanceContext,
  buildWorkGovernanceContextCandidate,
  withWorkGovernanceContext,
} from "./work-governance-context.js";
import type { KilnAppConfig } from "../config.js";

describe("work-governance-context", () => {
  it("projects orchestration policy as required instruction context", () => {
    const candidate = buildWorkGovernanceContextCandidate({
      defaultPosture: "orchestrate",
      directExecution: {
        maxFiles: 1,
        maxRisk: "low",
      },
      requireDelegationFor: ["architecture", "managed-agents"],
      requiredEvidence: ["surface-map", "residual-risk"],
    });

    expect(candidate).toMatchObject({
      kind: "instruction",
      source: "work-governance:resolved-kiln-config#workGovernance",
      required: true,
      score: 0.97,
    });
    expect(candidate?.content).toContain("Default posture: orchestrate");
    expect(candidate?.content).toContain("Require orchestration/delegation for: architecture, managed-agents");
    expect(candidate?.content).toContain("work_profile.list and work_item.update/list/complete");
    expect(candidate?.content).toContain("Model self-confidence is not evidence");
  });

  it("does not add context when no work governance config exists", () => {
    const appConfig: KilnAppConfig = {
      createRegistry: () => {
        throw new Error("not used");
      },
    };

    expect(buildWorkGovernanceContext(undefined)).toBeUndefined();
    expect(withWorkGovernanceContext(appConfig, undefined)).toBe(appConfig);
  });

  it("preserves existing context candidates when adding work governance", () => {
    const appConfig: KilnAppConfig = {
      createRegistry: () => {
        throw new Error("not used");
      },
      contextCandidates: [{
        kind: "instruction",
        source: "existing",
        content: "Existing context",
        score: 1,
      }],
    };

    const wrapped = withWorkGovernanceContext(appConfig, {
      defaultPosture: "orchestrate",
    });

    expect(wrapped.contextCandidates).toHaveLength(2);
    expect(wrapped.contextCandidates?.[0]?.source).toBe("existing");
    expect(wrapped.contextCandidates?.[1]?.source).toBe("work-governance:resolved-kiln-config#workGovernance");
  });
});
