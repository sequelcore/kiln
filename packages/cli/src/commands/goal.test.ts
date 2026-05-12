import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoalRun } from "@kilnai/core";
import { goalCommand, loadGoalSnapshotFromTranscript } from "./goal.js";
import { TranscriptStore } from "../wrapper/session-store.js";

const roots: string[] = [];

describe("goal command", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("replays persisted canonical goal events from the transcript store", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendGoalCreated(transcriptStore, "session-1", makeGoal({ id: "goal-1" }));

    const snapshot = await loadGoalSnapshotFromTranscript(transcriptStore, "session-1");

    expect(snapshot.goals).toHaveLength(1);
    expect(snapshot.goals[0]).toMatchObject({
      id: "goal-1",
      objective: "Finish Slice 10 CLI goal commands.",
      status: "active",
      planId: "plan-1",
    });
  });

  it("lists and inspects goals from canonical session events", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendGoalCreated(transcriptStore, "session-1", makeGoal({ id: "goal-1" }));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await goalCommand({ createRegistry: (() => undefined) as never }, "list", ["--session", "session-1"], { projectPath: root });
    await goalCommand({ createRegistry: (() => undefined) as never }, "inspect", ["goal-1", "--session", "session-1"], { projectPath: root });

    expect(log.mock.calls[0]?.[0]).toContain("goal-1");
    expect(log.mock.calls[0]?.[0]).toContain("active");
    expect(log.mock.calls[1]?.[0]).toContain("Objective: Finish Slice 10 CLI goal commands.");
    expect(log.mock.calls[1]?.[0]).toContain("Authority: audited");
  });

  it("cancels an active goal by appending a canonical cancellation event", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendGoalCreated(transcriptStore, "session-1", makeGoal({ id: "goal-1" }));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await goalCommand(
      { createRegistry: (() => undefined) as never },
      "cancel",
      ["goal-1", "--session", "session-1", "--reason", "Operator stopped this goal.", "--cancelled-by", "ricardo"],
      {
        projectPath: root,
        now: () => new Date("2026-05-12T22:00:00.000Z"),
        eventId: () => "event-goal-cancelled",
      },
    );

    const snapshot = await loadGoalSnapshotFromTranscript(transcriptStore, "session-1");
    expect(snapshot.goals).toHaveLength(1);
    expect(snapshot.goals[0]).toMatchObject({
      id: "goal-1",
      status: "cancelled",
      terminalReason: "Operator stopped this goal. (ricardo)",
      updatedAt: "2026-05-12T22:00:00.000Z",
    });
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kiln-goal-command-"));
  roots.push(root);
  return root;
}

async function appendGoalCreated(
  transcriptStore: TranscriptStore,
  sessionId: string,
  goal: GoalRun,
): Promise<void> {
  await transcriptStore.append(sessionId, {
    eventId: `event-${goal.id}`,
    kilnSessionId: sessionId,
    sequence: goal.sequence,
    timestamp: goal.createdAt,
    kind: "goal.created",
    source: { actor: "runtime", surface: "cli", component: "goal-command-test" },
    payload: { goal },
  });
}

function makeGoal(input: { readonly id: string }): GoalRun {
  return {
    id: input.id,
    objective: "Finish Slice 10 CLI goal commands.",
    ownerSessionId: "session-1",
    planId: "plan-1",
    planHash: "sha256:plan",
    status: "active",
    workItemIds: ["work-1"],
    authorityEnvelope: {
      maximumAuthority: "audited",
      escalationPolicy: "approval_required",
      reason: "Approved plan.",
    },
    routePolicy: {
      workflowProfile: "cli-change",
      preferredRouteId: "codex",
      managedAgentProfile: "coder",
    },
    evidenceRequirements: [
      {
        id: "tests",
        description: "Focused tests pass.",
        required: true,
      },
    ],
    currentPhase: "ready",
    createdAt: "2026-05-12T21:00:00.000Z",
    updatedAt: "2026-05-12T21:00:00.000Z",
    sequence: 1,
  };
}
