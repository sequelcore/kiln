import { describe, expect, it } from "vitest";
import {
  adoptBoundedWorkContractRevision,
  decideBoundedWorkAdmission,
  decideBoundedWorkCloseout,
  type BoundedWorkAccountingSnapshot,
  type BoundedWorkContract,
} from "../../src/work-governance/index.js";

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

const contract: BoundedWorkContract = {
  schema: "kiln.bounded-work-contract/v1",
  intent: {
    objective: "Bound execution.",
    acceptanceCriteria: ["tests", "review"],
    nonGoals: [],
  },
  scope: {
    allowedWorkItemIds: ["work-1"],
    permittedEffects: ["modify_source", "invoke_managed_agent"],
    permittedSurfaces: ["core"],
    allowedRoots: ["packages/core"],
    deniedRoots: [],
    refactorAuthority: "scoped",
    migrationAuthority: "none",
    dependencyAuthority: "none",
  },
  limits: {
    maxExecutionAttempts: 2,
    maxManagedInvocations: 1,
    maxConcurrentManagedInvocations: 1,
    maxChildDepth: 1,
    maxReviewRounds: 1,
    maxRemediationRounds: 1,
    maxToolCalls: 5,
  },
  tripwires: {},
  policy: {
    scopeExpansion: "approval_required",
    budgetExhaustion: "pause",
    minimumHarnessCapability: "authoritative",
  },
};

const revision = adoptBoundedWorkContractRevision({
  contract,
  accountingLineageId: "goal-1",
  adoptedAt: "2026-08-12T18:00:00.000Z",
  adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-1" },
});

const snapshot = (overrides: Partial<BoundedWorkAccountingSnapshot> = {}): BoundedWorkAccountingSnapshot => ({
  schema: "kiln.bounded-work-accounting/v1",
  accountingLineageId: "goal-1",
  contractRevisionDigest: revision.revisionDigest,
  revision: 3,
  executionAttempts: 1,
  managedInvocations: 0,
  activeManagedInvocations: 0,
  reviewRounds: 0,
  remediationRounds: 0,
  toolCalls: { kind: "observed", value: 2 },
  activeDurationMs: { kind: "observed", value: 1_000 },
  ...overrides,
});

const request = {
  harnessCapability: "authoritative" as const,
  scope: {
    workItemId: "work-1",
    effect: "modify_source" as const,
    surface: "core",
    paths: ["packages/core/src/index.ts"],
  },
};

describe("bounded work decision", () => {
  it("admits only while the cumulative accounting snapshot remains below every ceiling", () => {
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot(),
      ...request,
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toMatchObject({ kind: "admitted", reserved: { executionAttempts: 1 } });

    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot({ executionAttempts: 2 }),
      ...request,
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toMatchObject({
      kind: "pause_budget_exhausted",
      exhaustedLimits: ["execution_attempts"],
      continuation: { action: "request_budget_revision", accountingRevision: 3 },
    });
  });

  it("fails closed when a hard measured limit has unknown usage", () => {
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot({ toolCalls: { kind: "unknown" } }),
      ...request,
      reservation: { kind: "tool_call", amount: 1 },
    })).toMatchObject({
      kind: "pause_capability_unavailable",
      unavailableMetrics: ["tool_calls"],
      continuation: { action: "select_capable_harness" },
    });
  });

  it("applies managed child total, concurrency, and depth limits together", () => {
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot({ managedInvocations: 1, activeManagedInvocations: 1 }),
      ...request,
      reservation: { kind: "managed_invocation", amount: 1, childDepth: 2 },
    })).toMatchObject({
      kind: "pause_budget_exhausted",
      exhaustedLimits: ["managed_invocations", "concurrent_managed_invocations", "child_depth"],
    });
  });

  it("requires semantic scope and the contract's minimum harness capability", () => {
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot(),
      ...request,
      harnessCapability: "advisory_only",
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toMatchObject({
      kind: "pause_capability_unavailable",
      unavailableMetrics: ["harness_authority"],
    });
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot(),
      ...request,
      scope: { ...request.scope, paths: ["packages/runtime/src/index.ts"] },
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toMatchObject({
      kind: "pause_scope_revision_required",
      violations: [{ kind: "path_not_permitted", value: "packages/runtime/src/index.ts" }],
      continuation: { action: "request_scope_revision" },
    });
  });

  it("honors the contract's terminal budget-exhaustion policy", () => {
    const stopRevision = adoptBoundedWorkContractRevision({
      contract: { ...contract, policy: { ...contract.policy, budgetExhaustion: "stop" } },
      accountingLineageId: "goal-1",
      adoptedAt: "2026-08-12T18:00:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-stop" },
    });
    expect(decideBoundedWorkAdmission({
      revision: stopRevision,
      snapshot: snapshot({ contractRevisionDigest: stopRevision.revisionDigest, executionAttempts: 2 }),
      ...request,
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toMatchObject({
      kind: "stop_budget_exhausted",
      exhaustedLimits: ["execution_attempts"],
    });
  });

  it("requires review and remediation reservations to name exact candidates", () => {
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot(),
      ...request,
      reservation: { kind: "review_round", amount: 1, candidateDigest: sha("c") },
    })).toMatchObject({ kind: "admitted", reserved: { reviewRounds: 1 } });
    expect(() => decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot(),
      ...request,
      reservation: {
        kind: "remediation_round",
        amount: 1,
        candidateDigest: sha("c"),
        previousCandidateDigest: sha("c"),
      },
    })).toThrow("remediation must create a successor candidate");
  });

  it("fails closed on corrupt durable accounting", () => {
    expect(() => decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot({ executionAttempts: -1 }),
      ...request,
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toThrow("accounting.executionAttempts must be a non-negative integer");
  });

  it("cannot claim acceptance without exact candidate-bound criteria evidence", () => {
    expect(decideBoundedWorkCloseout({
      revision,
      snapshot: snapshot(),
      candidateDigest: sha("c"),
      satisfiedCriteria: [
        { criterion: "tests", candidateDigest: sha("c"), evidenceDigest: sha("d") },
      ],
    })).toMatchObject({
      kind: "pause_acceptance_incomplete",
      missingCriteria: ["review"],
    });

    expect(decideBoundedWorkCloseout({
      revision,
      snapshot: snapshot(),
      candidateDigest: sha("c"),
      satisfiedCriteria: [
        { criterion: "tests", candidateDigest: sha("c"), evidenceDigest: sha("d") },
        { criterion: "review", candidateDigest: sha("c"), evidenceDigest: sha("e") },
      ],
    })).toMatchObject({ kind: "stop_acceptance_complete", candidateDigest: sha("c") });

    expect(() => decideBoundedWorkCloseout({
      revision,
      snapshot: snapshot(),
      candidateDigest: sha("c"),
      satisfiedCriteria: [
        { criterion: "tests", candidateDigest: sha("f"), evidenceDigest: sha("d") },
        { criterion: "review", candidateDigest: sha("c"), evidenceDigest: sha("e") },
      ],
    })).toThrow("acceptance evidence is stale");
  });
});
