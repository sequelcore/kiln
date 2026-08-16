import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adoptBoundedWorkContractRevision, GoalRunStore } from "@kilnai/core/work-governance";
import { TranscriptStore } from "../wrapper/session-store.js";
import { GoalControlService } from "./goal-control-service.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("GoalControlService", () => {
  it("persists lifecycle changes but rejects objective mutation", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-goal-control-"));
    roots.push(root);
    const store = new GoalRunStore({ now: () => "2026-07-18T20:00:00.000Z" });
    const transcriptStore = new TranscriptStore(root);
    const service = new GoalControlService(store, transcriptStore);
    store.create({
      id: "goal-1",
      objective: "Original objective.",
      ownerSessionId: "session-1",
      source: { kind: "operator_direct", turnId: "turn-1" },
      boundedWorkContractRevision: adoptBoundedWorkContractRevision({
        accountingLineageId: "goal-1",
        adoptedAt: "2026-07-18T20:00:00.000Z",
        adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-1" },
        contract: boundedWorkContract("Original objective.", ["work-1"]),
      }),
      workItemIds: ["work-1"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Operator-controlled implementation.",
      },
      routePolicy: { workflowProfile: "small-fix" },
      evidenceRequirements: [],
    });

    await expect(service.control({
      goalRunId: "goal-1",
      action: "update_objective",
      objective: "Canonical revised objective.",
      requestedBy: "operator-1",
      sourceSurface: "gui",
    })).rejects.toThrow("Goal objective is immutable");
    const pausedEvent = await service.control({
      goalRunId: "goal-1",
      action: "pause",
      requestedBy: "operator-1",
      sourceSurface: "gui",
    });

    expect(pausedEvent).toMatchObject({
      kind: "goal.updated",
      goal: { status: "paused", currentPhase: "operator_paused" },
    });
    const transcript = await transcriptStore.readTranscript("session-1");
    expect(transcript.map((event) => event.kind)).toEqual(["goal.updated"]);
    expect(transcript[0]?.payload.goal).toMatchObject({ status: "paused" });
  });
});

function boundedWorkContract(objective: string, workItemIds: readonly string[]) {
  return {
    schema: "kiln.bounded-work-contract/v1" as const,
    intent: { objective, acceptanceCriteria: ["Complete the bounded work."], nonGoals: [] },
    scope: { allowedWorkItemIds: workItemIds, permittedEffects: ["inspect"] as const, permittedSurfaces: ["cli"], allowedRoots: ["packages/cli"], deniedRoots: [], refactorAuthority: "none" as const, migrationAuthority: "none" as const, dependencyAuthority: "none" as const },
    limits: { maxExecutionAttempts: 1, maxManagedInvocations: 0, maxConcurrentManagedInvocations: 0, maxChildDepth: 0, maxReviewRounds: 0, maxRemediationRounds: 0 },
    tripwires: {},
    policy: { scopeExpansion: "deny" as const, budgetExhaustion: "stop" as const, minimumHarnessCapability: "advisory_only" as const },
  };
}
