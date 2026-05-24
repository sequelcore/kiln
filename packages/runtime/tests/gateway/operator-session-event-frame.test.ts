import { describe, expect, it } from "vitest";
import type { CanonicalSessionEvent, WorkItem } from "@kilnai/core";
import { toOperatorSessionEventFrame } from "../../src/gateway/operator-session-event-frame.js";

function managedWorkItem(input: {
  readonly status?: WorkItem["status"];
  readonly managedInvocationId?: string;
  readonly verificationGateResults?: WorkItem["verificationGateResults"];
  readonly managedOrchestrationAdoption?: WorkItem["managedOrchestrationAdoption"];
} = {}): WorkItem {
  return {
    id: "work-adoption",
    summary: "Review managed child output.",
    status: input.status ?? "completed",
    workflowProfile: "sequel-standard",
    triggers: ["managed-orchestration"],
    expectedEvidence: ["managed-orchestration:adoption-gate"],
    providedEvidence: ["managed-orchestration:result-handoff"],
    verificationGates: ["managed orchestration adoption gate"],
    skippedVerificationGates: [],
    verificationGateResults: input.verificationGateResults ?? [],
    dependencies: [],
    createdAt: "2026-05-23T12:00:00.000Z",
    updatedAt: "2026-05-23T12:00:10.000Z",
    sequence: 1,
    executionAttempts: [],
    managedOrchestration: {
      orchestrationId: "orch-adoption",
      mode: "decomposition",
      childId: input.managedInvocationId ?? "child-adoption",
      ordinal: 1,
      roleIntent: "coder",
      expectedEvidence: [{
        kind: "result-handoff",
        label: "Result handoff",
        required: true,
      }],
      isolation: {
        required: true,
        reason: "Managed child uses isolated worktree.",
        workingDirectoryMode: "isolated-worktree",
      },
      mergePolicy: {
        mode: "manual",
        adoptionRequired: true,
      },
      adoptionGate: {
        required: true,
        target: "slice-6-handoff-review-adoption",
        reason: "Managed child output must be adopted before closeout.",
      },
    },
    ...(input.managedOrchestrationAdoption
      ? { managedOrchestrationAdoption: input.managedOrchestrationAdoption }
      : {}),
  };
}

function workItemEvent(workItem: WorkItem): CanonicalSessionEvent {
  return {
    eventId: "evt-work-item",
    kilnSessionId: "session-1",
    sequence: 1,
    timestamp: new Date("2026-05-23T12:00:10.000Z"),
    kind: "work_item_updated",
    source: "runtime",
    workItem,
    operation: "complete",
  };
}

describe("operator session event frame", () => {
  it("exposes core-projected managed orchestration adoption gates on work-item frames", () => {
    const frame = toOperatorSessionEventFrame(workItemEvent(managedWorkItem({
      managedOrchestrationAdoption: {
        target: "slice-6-handoff-review-adoption",
        adoptedBy: "operator",
        adoptedAt: "2026-05-23T12:00:09.000Z",
        resourceUris: ["kiln://artifacts/orch-adoption/adoption-review"],
      },
    })), {
      eventId: "frame-1",
      sequence: 10,
      instanceId: "local-tui",
    });

    expect(frame.event.payload.instanceId).toBe("local-tui");
    expect(frame.event.payload.sessionId).toBe("session-1");
    expect(frame.event.payload.managedOrchestrationAdoptionGate).toEqual({
      required: true,
      target: "slice-6-handoff-review-adoption",
      reason: "Managed child output must be adopted before closeout.",
      orchestrationId: "orch-adoption",
      childId: "child-adoption",
      mergePolicyMode: "manual",
      resourceUris: ["kiln://artifacts/orch-adoption/adoption-review"],
      blockingEvidence: [],
      status: "adopted",
      adoptedBy: "operator",
      adoptedAt: "2026-05-23T12:00:09.000Z",
    });
  });

  it("does not add adoption-gate snapshots to non-work-item frames", () => {
    const frame = toOperatorSessionEventFrame({
      eventId: "evt-child",
      kilnSessionId: "session-1",
      sequence: 1,
      timestamp: new Date("2026-05-23T12:00:00.000Z"),
      kind: "agent_invocation_completed",
      source: "runtime",
      managedInvocationId: "child-adoption",
      invocationId: "child-adoption",
      agentId: "coder",
      status: "completed",
    } as CanonicalSessionEvent, {
      eventId: "frame-2",
      sequence: 11,
    });

    expect(frame.event.payload.managedOrchestrationAdoptionGate).toBeUndefined();
  });
});
