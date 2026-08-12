import {
  adoptBoundedWorkContractRevision,
  type BoundedWorkContractRevision,
} from "../../src/work-governance/index.js";

export function testBoundedWorkRevision(
  goalRunId: string,
  workItemIds: readonly string[] = ["test-work-item"],
  objective = `Bounded test goal ${goalRunId}.`,
): BoundedWorkContractRevision {
  return adoptBoundedWorkContractRevision({
    accountingLineageId: goalRunId,
    adoptedAt: "2026-08-12T18:00:00.000Z",
    adoptedBy: { kind: "operator", actorId: "test-operator", decisionId: `decision:${goalRunId}` },
    contract: {
      schema: "kiln.bounded-work-contract/v1",
      intent: {
        objective,
        acceptanceCriteria: ["test evidence"],
        nonGoals: [],
      },
      scope: {
        allowedWorkItemIds: workItemIds.length > 0 ? workItemIds : ["test-work-item"],
        permittedEffects: ["inspect", "modify_source", "run_verification"],
        permittedSurfaces: ["core", "runtime", "cli", "session"],
        allowedRoots: ["packages/core", "packages/runtime", "packages/cli"],
        deniedRoots: [],
        refactorAuthority: "scoped",
        migrationAuthority: "none",
        dependencyAuthority: "none",
      },
      limits: {
        maxExecutionAttempts: 10,
        maxManagedInvocations: 10,
        maxConcurrentManagedInvocations: 3,
        maxChildDepth: 2,
        maxReviewRounds: 3,
        maxRemediationRounds: 3,
        maxToolCalls: 100,
        maxActiveDurationMs: 3_600_000,
      },
      tripwires: {},
      policy: {
        scopeExpansion: "approval_required",
        budgetExhaustion: "pause",
        minimumHarnessCapability: "authoritative",
      },
    },
  });
}

export function testBoundedWorkCloseoutDecision(
  goalRunId: string,
  revision: BoundedWorkContractRevision,
  candidateDigest = `sha256:${"d".repeat(64)}`,
) {
  return {
    kind: "stop_acceptance_complete" as const,
    candidateDigest,
    contractRevisionDigest: revision.revisionDigest,
    accounting: {
      schema: "kiln.bounded-work-accounting/v1" as const,
      accountingLineageId: goalRunId,
      contractRevisionDigest: revision.revisionDigest,
      revision: 1,
      executionAttempts: 1,
      managedInvocations: 0,
      activeManagedInvocations: 0,
      reviewRounds: 0,
      remediationRounds: 0,
      toolCalls: { kind: "unavailable" as const },
      activeDurationMs: { kind: "unavailable" as const },
    },
  };
}
