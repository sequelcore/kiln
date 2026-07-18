import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GoalRunStore } from "@kilnai/core";
import { TranscriptStore } from "../wrapper/session-store.js";
import { GoalControlService } from "./goal-control-service.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("GoalControlService", () => {
  it("persists operator lifecycle changes as canonical goal events", async () => {
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
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Operator-controlled implementation.",
      },
      routePolicy: { workflowProfile: "small-fix" },
      evidenceRequirements: [],
    });

    const updatedEvent = await service.control({
      goalRunId: "goal-1",
      action: "update_objective",
      objective: "Canonical revised objective.",
      requestedBy: "operator-1",
      sourceSurface: "gui",
    });
    const pausedEvent = await service.control({
      goalRunId: "goal-1",
      action: "pause",
      requestedBy: "operator-1",
      sourceSurface: "gui",
    });

    expect(updatedEvent).toMatchObject({
      kind: "goal.updated",
      goal: { objective: "Canonical revised objective.", status: "active" },
      changedFields: ["objective"],
    });
    expect(pausedEvent).toMatchObject({
      kind: "goal.updated",
      goal: { status: "paused", currentPhase: "operator_paused" },
    });
    const transcript = await transcriptStore.readTranscript("session-1");
    expect(transcript.map((event) => event.kind)).toEqual(["goal.updated", "goal.updated"]);
    expect(transcript[1]?.payload.goal).toMatchObject({ status: "paused" });
  });
});
