import { describe, expect, it } from "vitest";
import {
  adoptBoundedWorkContractRevision,
  assessBoundedWorkScope,
  normalizeBoundedWorkContractRevision,
  supersedeBoundedWorkContractRevision,
  type BoundedWorkContract,
} from "../../src/work-governance/index.js";

const contract = (): BoundedWorkContract => ({
  schema: "kiln.bounded-work-contract/v1",
  intent: {
    objective: "Add bounded work authority.",
    acceptanceCriteria: ["Attempts beyond the ceiling are denied."],
    nonGoals: ["Redesign provider economics."],
  },
  scope: {
    allowedWorkItemIds: ["work-core"],
    permittedEffects: ["modify_source", "run_verification"],
    permittedSurfaces: ["core", "runtime"],
    allowedRoots: ["packages/core", "packages/runtime"],
    deniedRoots: ["packages/gui"],
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
  },
  tripwires: {
    changedFiles: 6,
    changedLines: 500,
  },
  policy: {
    scopeExpansion: "approval_required",
    budgetExhaustion: "pause",
    minimumHarnessCapability: "authoritative",
  },
});

describe("bounded work contract", () => {
  it("adopts canonical content with a stable digest independent of object key order", () => {
    const first = adoptBoundedWorkContractRevision({
      contract: contract(),
      accountingLineageId: "goal-1",
      adoptedAt: "2026-08-12T18:00:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "approval-1" },
    });
    const reordered = {
      ...contract(),
      intent: {
        nonGoals: ["Redesign provider economics."],
        acceptanceCriteria: ["Attempts beyond the ceiling are denied."],
        objective: "Add bounded work authority.",
      },
      scope: {
        ...contract().scope,
        permittedSurfaces: ["runtime", "core"],
        allowedRoots: ["packages/runtime", "packages/core"],
      },
    } satisfies BoundedWorkContract;
    const second = adoptBoundedWorkContractRevision({
      contract: reordered,
      accountingLineageId: "goal-1",
      adoptedAt: "2026-08-12T18:00:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "approval-1" },
    });

    expect(first.contractDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(second.contractDigest).toBe(first.contractDigest);
    expect(first.revisionDigest).toBe(second.revisionDigest);
    expect(first.revision).toBe(1);
  });

  it("supersedes instead of mutating and preserves cumulative accounting lineage", () => {
    const first = adoptBoundedWorkContractRevision({
      contract: contract(),
      adoptedAt: "2026-08-12T18:00:00.000Z",
      adoptedBy: { kind: "approved_plan", planId: "plan-1", planDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      accountingLineageId: "goal-1",
    });
    const narrowed: BoundedWorkContract = {
      ...contract(),
      limits: { ...contract().limits, maxExecutionAttempts: 1 },
    };
    const second = supersedeBoundedWorkContractRevision({
      current: first,
      contract: narrowed,
      expectedRevisionDigest: first.revisionDigest,
      adoptedAt: "2026-08-12T18:10:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "approval-2" },
      accountingLineageId: "goal-1",
    });

    expect(first.contract.limits.maxExecutionAttempts).toBe(2);
    expect(second).toMatchObject({
      revision: 2,
      parentRevisionDigest: first.revisionDigest,
      accountingLineageId: "goal-1",
      contract: { limits: { maxExecutionAttempts: 1 } },
    });
    expect(() => supersedeBoundedWorkContractRevision({
      current: first,
      contract: narrowed,
      expectedRevisionDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      adoptedAt: "2026-08-12T18:10:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "approval-2" },
      accountingLineageId: "goal-1",
    })).toThrow("bounded-work revision conflict");
  });

  it("separates semantic scope decisions from size tripwires", () => {
    const revision = adoptBoundedWorkContractRevision({
      contract: contract(),
      accountingLineageId: "goal-1",
      adoptedAt: "2026-08-12T18:00:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "approval-1" },
    });

    expect(assessBoundedWorkScope({
      revision,
      workItemId: "work-core",
      effect: "modify_source",
      surface: "core",
      paths: ["packages/core/src/work-governance/bounded-work-contract.ts"],
      changedFiles: 7,
      changedLines: 600,
    })).toEqual({
      status: "within_scope",
      diagnostics: [
        { kind: "tripwire_exceeded", metric: "changed_files", actual: 7, threshold: 6 },
        { kind: "tripwire_exceeded", metric: "changed_lines", actual: 600, threshold: 500 },
      ],
    });

    expect(assessBoundedWorkScope({
      revision,
      workItemId: "work-core",
      effect: "modify_source",
      surface: "gui",
      paths: ["packages/gui/src/app.tsx"],
    })).toMatchObject({
      status: "scope_revision_required",
      violations: [
        { kind: "surface_not_permitted", value: "gui" },
        { kind: "path_denied", value: "packages/gui/src/app.tsx" },
      ],
    });

    const repositoryWide = adoptBoundedWorkContractRevision({
      contract: { ...contract(), scope: { ...contract().scope, allowedRoots: ["."], deniedRoots: [] } },
      accountingLineageId: "goal-root",
      adoptedAt: "2026-08-12T18:00:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "approval-root" },
    });
    expect(assessBoundedWorkScope({
      revision: repositoryWide,
      workItemId: "work-core",
      effect: "modify_source",
      surface: "core",
      paths: ["packages/core/src/index.ts"],
    })).toMatchObject({ status: "within_scope" });
  });

  it("rejects incomplete, permissive, or non-canonical authority input", () => {
    const invalid: BoundedWorkContract = {
      ...contract(),
      limits: { ...contract().limits, maxExecutionAttempts: 0 },
    };
    expect(() => adoptBoundedWorkContractRevision({
      contract: invalid,
      accountingLineageId: "goal-1",
      adoptedAt: "2026-08-12T18:00:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "approval-1" },
    })).toThrow("maxExecutionAttempts must be a positive integer");

    expect(() => adoptBoundedWorkContractRevision({
      contract: contract(),
      accountingLineageId: "goal-1",
      adoptedAt: "not-a-time",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "approval-1" },
    })).toThrow("adoptedAt must be a canonical ISO timestamp");

    expect(() => adoptBoundedWorkContractRevision({
      contract: contract(),
      accountingLineageId: " ",
      adoptedAt: "2026-08-12T18:00:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "approval-1" },
    })).toThrow("accountingLineageId is required");
  });

  it("rejects a forged durable revision digest", () => {
    const revision = adoptBoundedWorkContractRevision({
      contract: contract(),
      accountingLineageId: "goal-1",
      adoptedAt: "2026-08-12T18:00:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "approval-1" },
    });
    expect(() => normalizeBoundedWorkContractRevision({
      ...revision,
      contract: { ...revision.contract, limits: { ...revision.contract.limits, maxExecutionAttempts: 99 } },
    })).toThrow("bounded-work contract digest does not match content");
    expect(() => normalizeBoundedWorkContractRevision({
      ...revision,
      revisionDigest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    })).toThrow("bounded-work revision digest does not match identity");
  });
});
