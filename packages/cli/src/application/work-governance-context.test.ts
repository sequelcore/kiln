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
    expect(candidate?.content).toContain("recommendations are advisory until the operator requests formal tracked execution");
    expect(candidate?.content).toContain("Research, comparison, explanation, diagnosis, review, and planning-as-answer turns");
    expect(candidate?.content).toContain("without creating work_item, goal, or work_item.execution records");
    expect(candidate?.content).toContain("Use work_profile.list and work_item.update/list/complete only after formal governed work is required");
    expect(candidate?.content).toContain("Choose a stable work item id before the first work_item.update call");
    expect(candidate?.content).toContain("never use a temporary provenance id such as pending");
    expect(candidate?.content).toContain("work_item.complete is only for standalone work items");
    expect(candidate?.content).toContain("owning goal reaches a canonical terminal state");
    expect(candidate?.content).toContain("exact managedInvocationRequest object");
    expect(candidate?.content).toContain("do not add agentProfile when it is absent");
    expect(candidate?.content).toContain("executionPhase is intermediate");
    expect(candidate?.content).toContain("recovery.workItemUpdateInputTemplate");
    expect(candidate?.content).toContain("Do not stop after scout");
    expect(candidate?.content).toContain("phaseRoutes.visual-reference-research");
    expect(candidate?.content).toContain("visual_reference_phase_route_required");
    expect(candidate?.content).toContain("do not paste JSON into assistant text");
    expect(candidate?.content).toContain("Model self-confidence and independent LLM review are not verification");
    expect(candidate?.content).toContain("omit scratch notes");
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
