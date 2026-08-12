import { adoptBoundedWorkContractRevision, type BoundedWorkContract } from "@kilnai/core";
import { existsSync, writeFileSync } from "node:fs";
import { SqliteBoundedWorkAuthority } from "../../src/work-governance/sqlite-bounded-work-authority.js";

const [path, id, ready, start, result] = process.argv.slice(-5);
if (!path || !id || !ready || !start || !result) throw new Error("Missing bounded-work worker arguments.");

const contract: BoundedWorkContract = {
  schema: "kiln.bounded-work-contract/v1",
  intent: { objective: "Compete for one attempt.", acceptanceCriteria: ["tests"], nonGoals: [] },
  scope: {
    allowedWorkItemIds: ["work-1"],
    permittedEffects: ["modify_source"],
    permittedSurfaces: ["core"],
    allowedRoots: ["packages/core"],
    deniedRoots: [],
    refactorAuthority: "scoped",
    migrationAuthority: "none",
    dependencyAuthority: "none",
  },
  limits: {
    maxExecutionAttempts: 1,
    maxManagedInvocations: 0,
    maxConcurrentManagedInvocations: 0,
    maxChildDepth: 0,
    maxReviewRounds: 0,
    maxRemediationRounds: 0,
  },
  tripwires: {},
  policy: { scopeExpansion: "deny", budgetExhaustion: "pause", minimumHarnessCapability: "authoritative" },
};
const revision = adoptBoundedWorkContractRevision({
  contract,
  accountingLineageId: "goal-1",
  adoptedAt: "2026-08-12T18:00:00.000Z",
  adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "process-test" },
});
const authority = new SqliteBoundedWorkAuthority({ path });
try {
  writeFileSync(ready, "ready");
  while (!existsSync(start)) await new Promise((resolve) => setTimeout(resolve, 10));
  const outcome = authority.reserve({
    projectRuntimeId: "project-1",
    goalRunId: "goal-1",
    workItemId: "work-1",
    contractRevision: revision,
    idempotencyKey: id,
    route: { routeId: "codex-oauth", harnessId: "kiln-direct" },
    harnessCapability: "authoritative",
    scope: {
      workItemId: "work-1",
      effect: "modify_source",
      surface: "core",
      paths: ["packages/core/src/index.ts"],
    },
    reservation: { kind: "execution_attempt", amount: 1 },
  });
  writeFileSync(result, JSON.stringify(outcome.decision));
} finally {
  authority.close();
}
