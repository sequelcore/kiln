import { describe, it, expect } from "vitest";
import type { WorkItemPauseRequirement } from "@kilnai/core";
import {
  buildManagedInvocationPhaseRecovery,
  buildManagedInvocationPhaseHandoffRecovery,
} from "../../../src/agents/managed-invocation/phase-recovery.js";

function executionFinishRequest(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    workItemId: "work-1",
    goalRunId: "goal-1",
    executionPhase: {
      completionTool: "work_item.execution.finish",
      expectedEvidence: ["tests"],
    },
    ...overrides,
  };
}

function updateRequest(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    workItemId: "work-1",
    goalRunId: "goal-1",
    executionPhase: {
      id: "visual-reference-research",
      completionTool: "work_item.update",
      expectedEvidence: ["surface-map"],
    },
    ...overrides,
  };
}

function readPauseRequirements(recovery: Record<string, unknown> | undefined): readonly WorkItemPauseRequirement[] {
  const template = recovery?.blockedWorkItemUpdateInputTemplate as
    | { readonly pauseRequirements?: readonly WorkItemPauseRequirement[] }
    | undefined;
  return template?.pauseRequirements ?? [];
}

describe("buildManagedInvocationPhaseRecovery - execution.finish pause requirement id", () => {
  it("derives a deterministic id from the request's attemptId", () => {
    const recovery = buildManagedInvocationPhaseRecovery(
      executionFinishRequest({ attemptId: "goal-1:work-1:attempt:1" }),
      "failed",
    );
    const [requirement] = readPauseRequirements(recovery);
    expect(requirement?.id).toBe("managed-invocation-capability:work-1:goal-1:work-1:attempt:1");
  });

  it("replaying the same request produces the identical id (determinism, no timestamps/counters)", () => {
    const request = executionFinishRequest({ attemptId: "goal-1:work-1:attempt:1" });
    const first = buildManagedInvocationPhaseRecovery(request, "failed");
    const second = buildManagedInvocationPhaseRecovery(request, "failed");
    expect(readPauseRequirements(first)[0]?.id).toBe(readPauseRequirements(second)[0]?.id);
  });

  it("two distinct failed attempts on the same work item derive distinct ids", () => {
    const attemptOne = buildManagedInvocationPhaseRecovery(
      executionFinishRequest({ attemptId: "goal-1:work-1:attempt:1" }),
      "failed",
    );
    const attemptTwo = buildManagedInvocationPhaseRecovery(
      executionFinishRequest({ attemptId: "goal-1:work-1:attempt:2" }),
      "failed",
    );
    const idOne = readPauseRequirements(attemptOne)[0]?.id;
    const idTwo = readPauseRequirements(attemptTwo)[0]?.id;
    expect(idOne).toBeDefined();
    expect(idTwo).toBeDefined();
    expect(idOne).not.toBe(idTwo);
  });
});

describe("buildManagedInvocationPhaseRecovery - regression guard for the last-wins normalizer collision", () => {
  it("keeps BOTH blocking requirements from two successive failed invocations on the same work item", () => {
    const attemptOne = buildManagedInvocationPhaseRecovery(
      executionFinishRequest({ attemptId: "goal-1:work-1:attempt:1" }),
      "failed",
    );
    const firstRequirement = readPauseRequirements(attemptOne)[0]!;

    // The runtime persists this template's pauseRequirements to the work item;
    // the second failed attempt is built while the work item still carries the
    // first attempt's still-pending requirement.
    const attemptTwo = buildManagedInvocationPhaseRecovery(
      executionFinishRequest({ attemptId: "goal-1:work-1:attempt:2" }),
      "failed",
      undefined,
      { priorPauseRequirements: [firstRequirement] },
    );
    const requirements = readPauseRequirements(attemptTwo);

    // Both the (now superseded) first attempt's requirement and the new
    // second attempt's requirement are present - neither was dropped nor
    // silently overwritten.
    expect(requirements).toHaveLength(2);
    expect(requirements.find((requirement) => requirement.id === firstRequirement.id)).toMatchObject({
      status: "superseded",
    });
    expect(requirements.find((requirement) => requirement.id !== firstRequirement.id)).toMatchObject({
      status: "pending",
    });
  });
});

describe("buildManagedInvocationPhaseRecovery - supersession", () => {
  it("a new recovery requirement supersedes the prior one and links to its id", () => {
    const attemptOne = buildManagedInvocationPhaseRecovery(
      executionFinishRequest({ attemptId: "goal-1:work-1:attempt:1" }),
      "failed",
    );
    const firstRequirement = readPauseRequirements(attemptOne)[0]!;

    const attemptTwo = buildManagedInvocationPhaseRecovery(
      executionFinishRequest({ attemptId: "goal-1:work-1:attempt:2" }),
      "failed",
      undefined,
      {
        priorPauseRequirements: [firstRequirement],
        now: () => "2026-07-01T00:00:00.000Z",
      },
    );
    const requirements = readPauseRequirements(attemptTwo);
    const superseded = requirements.find((requirement) => requirement.id === firstRequirement.id);
    const replacement = requirements.find((requirement) => requirement.id !== firstRequirement.id)!;

    expect(superseded).toMatchObject({
      status: "superseded",
      supersededByRequirementId: replacement.id,
      supersededAt: "2026-07-01T00:00:00.000Z",
    });
  });

  it("does not duplicate or resupersede when the exact same request is replayed", () => {
    const request = executionFinishRequest({ attemptId: "goal-1:work-1:attempt:1" });
    const first = buildManagedInvocationPhaseRecovery(request, "failed");
    const firstRequirement = readPauseRequirements(first)[0]!;

    const replay = buildManagedInvocationPhaseRecovery(request, "failed", undefined, {
      priorPauseRequirements: [firstRequirement],
    });
    const requirements = readPauseRequirements(replay);

    expect(requirements).toHaveLength(1);
    expect(requirements[0]).toEqual(firstRequirement);
  });

  it("does not supersede an unrelated pending pause requirement from a different family", () => {
    const unrelated: WorkItemPauseRequirement = {
      id: "operator-confirmation",
      kind: "operator_input",
      summary: "Confirm whether to continue.",
      status: "pending",
    };
    const recovery = buildManagedInvocationPhaseRecovery(
      executionFinishRequest({ attemptId: "goal-1:work-1:attempt:1" }),
      "failed",
      undefined,
      { priorPauseRequirements: [unrelated] },
    );
    const requirements = readPauseRequirements(recovery);
    expect(requirements).toHaveLength(2);
    expect(requirements.find((requirement) => requirement.id === "operator-confirmation")).toEqual(unrelated);
  });
});

describe("buildManagedInvocationPhaseHandoffRecovery - intermediate phase pause requirement id", () => {
  it("derives a deterministic id from the request's execution phase id", () => {
    const recovery = buildManagedInvocationPhaseHandoffRecovery(updateRequest(), undefined);
    const [requirement] = readPauseRequirements(recovery);
    expect(requirement?.id).toBe("managed-invocation-handoff-recovery:work-1:visual-reference-research");
  });

  it("two distinct execution phases on the same work item derive distinct ids", () => {
    const first = buildManagedInvocationPhaseHandoffRecovery(
      updateRequest({ executionPhase: { id: "phase-a", completionTool: "work_item.update", expectedEvidence: ["e"] } }),
      undefined,
    );
    const second = buildManagedInvocationPhaseHandoffRecovery(
      updateRequest({ executionPhase: { id: "phase-b", completionTool: "work_item.update", expectedEvidence: ["e"] } }),
      undefined,
    );
    expect(readPauseRequirements(first)[0]?.id).not.toBe(readPauseRequirements(second)[0]?.id);
  });

  it("supersedes a prior handoff-recovery requirement for a retried phase, keeping both", () => {
    const request = updateRequest();
    const attemptOne = buildManagedInvocationPhaseHandoffRecovery(request, undefined);
    const firstRequirement = readPauseRequirements(attemptOne)[0]!;

    // A retry of the SAME phase re-derives the same id (idempotent replay);
    // simulate a genuinely distinct retry via a different attemptId-bearing
    // request so the ids diverge, matching how the runtime would carry state
    // forward for a phase that failed, was retried under a new attempt, and
    // failed again.
    const attemptTwo = buildManagedInvocationPhaseHandoffRecovery(
      updateRequest({ attemptId: "goal-1:work-1:attempt:2" }),
      undefined,
      { priorPauseRequirements: [firstRequirement] },
    );
    const requirements = readPauseRequirements(attemptTwo);
    // attemptId takes precedence over phase id in id derivation, so this
    // resolves to a distinct id from the first (phase-id-only) attempt.
    expect(requirements).toHaveLength(2);
    expect(requirements.find((requirement) => requirement.id === firstRequirement.id)).toMatchObject({
      status: "superseded",
    });
  });
});
