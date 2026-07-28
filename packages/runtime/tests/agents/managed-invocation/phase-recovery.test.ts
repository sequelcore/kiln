import { describe, it, expect } from "vitest";
import type { WorkItemPauseRequirement } from "@kilnai/core";
import {
  buildManagedInvocationPhaseRecovery,
  buildManagedInvocationPhaseHandoffRecovery,
  isManagedInvocationRecoveryPauseRequirementId,
  MANAGED_INVOCATION_HANDOFF_RECOVERY_PAUSE_BASE_ID,
} from "../../../src/agents/managed-invocation/phase-recovery.js";

// Production shape note: `work-governance-tool.ts` (the real producer of the
// `request` these functions receive) always sets `executionPhase.id`, but
// NEVER sets `request.attemptId` at recovery-construction time - attemptId is
// only read back from a managed invocation's own resumed output AFTER it has
// already succeeded (attached-runtime-tool-surface.ts). These fixtures match
// that real shape: a phase id, no attemptId. Per-attempt distinction comes
// from `recoveryInvocationId`, the discriminator the real attached-runtime
// caller derives from its own tool-call identity and passes through
// `evidenceOptions` - never from a fabricated `attemptId`.
function executionFinishRequest(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    workItemId: "work-1",
    goalRunId: "goal-1",
    executionPhase: {
      id: "final-phase",
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

describe("isManagedInvocationRecoveryPauseRequirementId", () => {
  it("matches scoped derivations and rejects unscoped or unrelated ids", () => {
    expect(isManagedInvocationRecoveryPauseRequirementId("managed-invocation-capability", "managed-invocation-capability")).toBe(false);
    expect(isManagedInvocationRecoveryPauseRequirementId("managed-invocation-capability:work-1:x", "managed-invocation-capability")).toBe(true);
    expect(isManagedInvocationRecoveryPauseRequirementId("managed-invocation-capability-other", "managed-invocation-capability")).toBe(false);
    expect(isManagedInvocationRecoveryPauseRequirementId("operator-confirmation", "managed-invocation-capability")).toBe(false);
  });
});

describe("buildManagedInvocationPhaseRecovery - execution.finish pause requirement id", () => {
  it("derives a deterministic id from the caller-supplied recoveryInvocationId (request carries no attemptId, matching production)", () => {
    const request = executionFinishRequest();
    expect(request.attemptId).toBeUndefined();
    const recovery = buildManagedInvocationPhaseRecovery(request, "failed", undefined, {
      recoveryInvocationId: "tool-call-1:managed-invocation:1",
    });
    const [requirement] = readPauseRequirements(recovery);
    expect(requirement?.id).toBe("managed-invocation-capability:work-1:tool-call-1:managed-invocation:1");
  });

  it("replaying the same recovery attempt produces the identical id (determinism, no timestamps/counters)", () => {
    const request = executionFinishRequest();
    const first = buildManagedInvocationPhaseRecovery(request, "failed", undefined, {
      recoveryInvocationId: "tool-call-1:managed-invocation:1",
    });
    const second = buildManagedInvocationPhaseRecovery(request, "failed", undefined, {
      recoveryInvocationId: "tool-call-1:managed-invocation:1",
    });
    expect(readPauseRequirements(first)[0]?.id).toBe(readPauseRequirements(second)[0]?.id);
  });

  it("two distinct real failed attempts of the SAME work item and SAME phase derive distinct ids", () => {
    // Both attempts share the identical request (same work item, same phase,
    // no attemptId) - exactly what the real attached-runtime recovery path
    // builds on every failure of that phase. Only the caller-supplied
    // recoveryInvocationId (derived from each distinct outer tool call)
    // differs, mirroring two separate real retries.
    const request = executionFinishRequest();
    const attemptOne = buildManagedInvocationPhaseRecovery(request, "failed", undefined, {
      recoveryInvocationId: "tool-call-1:managed-invocation:1",
    });
    const attemptTwo = buildManagedInvocationPhaseRecovery(request, "failed", undefined, {
      recoveryInvocationId: "tool-call-2:managed-invocation:1",
    });
    const idOne = readPauseRequirements(attemptOne)[0]?.id;
    const idTwo = readPauseRequirements(attemptTwo)[0]?.id;
    expect(idOne).toBeDefined();
    expect(idTwo).toBeDefined();
    expect(idOne).not.toBe(idTwo);
  });
});

describe("buildManagedInvocationPhaseRecovery - regression guard for the last-wins normalizer collision", () => {
  it("keeps BOTH blocking requirements from two successive failed invocations of the same work item and phase, without ever fabricating an attemptId", () => {
    const request = executionFinishRequest();
    const attemptOne = buildManagedInvocationPhaseRecovery(request, "failed", undefined, {
      recoveryInvocationId: "tool-call-1:managed-invocation:1",
    });
    const firstRequirement = readPauseRequirements(attemptOne)[0]!;

    // The runtime persists this template's pauseRequirements to the work
    // item; a second real failure of the identical work item/phase is built
    // while the work item still carries the first attempt's still-pending
    // requirement. The only thing that differs between the two failures is
    // the outer tool call that produced them - never a hand-supplied
    // attemptId, which the real request never carries.
    const attemptTwo = buildManagedInvocationPhaseRecovery(request, "failed", undefined, {
      priorPauseRequirements: [firstRequirement],
      recoveryInvocationId: "tool-call-2:managed-invocation:1",
    });
    const requirements = readPauseRequirements(attemptTwo);

    // Both the (now superseded) first attempt's requirement and the new
    // second attempt's requirement are present - neither was dropped,
    // silently overwritten, nor collided into one id.
    expect(requirements).toHaveLength(2);
    expect(requirements.find((requirement) => requirement.id === firstRequirement.id)).toMatchObject({
      status: "superseded",
    });
    expect(requirements.find((requirement) => requirement.id !== firstRequirement.id)).toMatchObject({
      status: "pending",
    });
  });

  it("a genuinely new failure after a prior requirement in this family was already resolved still yields a live pending blocker", () => {
    const resolvedPrior: WorkItemPauseRequirement = {
      id: "managed-invocation-capability:work-1:tool-call-1:managed-invocation:1",
      kind: "capability",
      summary: "Prior managed invocation failure, since resolved by the operator.",
      status: "resolved",
    };
    const recovery = buildManagedInvocationPhaseRecovery(executionFinishRequest(), "failed", undefined, {
      priorPauseRequirements: [resolvedPrior],
      recoveryInvocationId: "tool-call-2:managed-invocation:1",
    });
    const requirements = readPauseRequirements(recovery);

    // The resolved prior requirement is left exactly as it was - never
    // resuperseded or mutated - and the new, genuinely distinct failure still
    // produces a live pending blocker rather than silently stopping blocking.
    expect(requirements).toHaveLength(2);
    expect(requirements.find((requirement) => requirement.id === resolvedPrior.id)).toEqual(resolvedPrior);
    expect(requirements.find((requirement) => requirement.id !== resolvedPrior.id)).toMatchObject({
      status: "pending",
    });
  });
});

describe("buildManagedInvocationPhaseRecovery - supersession", () => {
  it("a new recovery requirement supersedes the prior one and links to its id", () => {
    const request = executionFinishRequest();
    const attemptOne = buildManagedInvocationPhaseRecovery(request, "failed", undefined, {
      recoveryInvocationId: "tool-call-1:managed-invocation:1",
    });
    const firstRequirement = readPauseRequirements(attemptOne)[0]!;

    const attemptTwo = buildManagedInvocationPhaseRecovery(request, "failed", undefined, {
      priorPauseRequirements: [firstRequirement],
      recoveryInvocationId: "tool-call-2:managed-invocation:1",
      now: () => "2026-07-01T00:00:00.000Z",
    });
    const requirements = readPauseRequirements(attemptTwo);
    const superseded = requirements.find((requirement) => requirement.id === firstRequirement.id);
    const replacement = requirements.find((requirement) => requirement.id !== firstRequirement.id)!;

    expect(superseded).toMatchObject({
      status: "superseded",
      supersededByRequirementId: replacement.id,
      supersededAt: "2026-07-01T00:00:00.000Z",
    });
  });

  it("does not duplicate or resupersede when the exact same recovery attempt is replayed", () => {
    const request = executionFinishRequest();
    const first = buildManagedInvocationPhaseRecovery(request, "failed", undefined, {
      recoveryInvocationId: "tool-call-1:managed-invocation:1",
    });
    const firstRequirement = readPauseRequirements(first)[0]!;

    const replay = buildManagedInvocationPhaseRecovery(request, "failed", undefined, {
      priorPauseRequirements: [firstRequirement],
      recoveryInvocationId: "tool-call-1:managed-invocation:1",
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
    const recovery = buildManagedInvocationPhaseRecovery(executionFinishRequest(), "failed", undefined, {
      priorPauseRequirements: [unrelated],
      recoveryInvocationId: "tool-call-1:managed-invocation:1",
    });
    const requirements = readPauseRequirements(recovery);
    expect(requirements).toHaveLength(2);
    expect(requirements.find((requirement) => requirement.id === "operator-confirmation")).toEqual(unrelated);
  });
});

describe("buildManagedInvocationPhaseHandoffRecovery - intermediate phase pause requirement id", () => {
  it("derives a deterministic id from the request's execution phase id when no recoveryInvocationId is supplied", () => {
    const recovery = buildManagedInvocationPhaseHandoffRecovery(updateRequest(), undefined);
    const [requirement] = readPauseRequirements(recovery);
    expect(requirement?.id).toBe(`${MANAGED_INVOCATION_HANDOFF_RECOVERY_PAUSE_BASE_ID}:work-1:visual-reference-research`);
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

  it("two distinct real failures of the SAME phase derive distinct ids via recoveryInvocationId and keep both blockers", () => {
    // Same request every time (same phase, no attemptId) - only the caller's
    // recoveryInvocationId differs between two genuinely separate retries of
    // this phase, exactly mirroring the attached-runtime recovery path.
    const request = updateRequest();
    const attemptOne = buildManagedInvocationPhaseHandoffRecovery(request, undefined, {
      recoveryInvocationId: "tool-call-1:managed-invocation:1",
    });
    const firstRequirement = readPauseRequirements(attemptOne)[0]!;

    const attemptTwo = buildManagedInvocationPhaseHandoffRecovery(request, undefined, {
      priorPauseRequirements: [firstRequirement],
      recoveryInvocationId: "tool-call-2:managed-invocation:1",
    });
    const requirements = readPauseRequirements(attemptTwo);

    expect(requirements).toHaveLength(2);
    expect(requirements.find((requirement) => requirement.id === firstRequirement.id)).toMatchObject({
      status: "superseded",
    });
    expect(requirements.find((requirement) => requirement.id !== firstRequirement.id)).toMatchObject({
      status: "pending",
    });
  });
});
