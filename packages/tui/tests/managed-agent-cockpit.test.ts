import { describe, expect, it } from "vitest";
import type { OperatorSessionEvent } from "@kilnai/gateway-contracts";
import {
  EMPTY_TUI_MANAGED_AGENT_VIEW_STATE,
  appendManagedAgentSessionEvent,
  formatManagedAgentCockpitLines,
  projectTuiManagedAgentViewState,
  selectTuiManagedAgentDrilldownTarget,
} from "../src/managed-agent-cockpit.js";

function event(
  eventId: string,
  sequence: number,
  kind: OperatorSessionEvent["kind"],
  payload: Record<string, unknown>,
): OperatorSessionEvent {
  return {
    eventId,
    kilnSessionId: "session-1",
    sequence,
    timestamp: `2026-05-22T20:00:0${sequence}.000Z`,
    kind,
    turnId: "session-1:turn:live",
    payload,
  };
}

describe("TUI managed-agent cockpit projection", () => {
  it("normalizes managed invocation events and projects them through shared cockpit view state", () => {
    const started = event("evt-started", 2, "agent_invocation_started", {
      invocationId: "child-running",
      profile: "reviewer",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.5",
      },
    });
    const completedWithReview = event("evt-completed", 3, "agent_invocation_completed", {
      invocationId: "child-review",
      profile: "coder",
      providerRoute: {
        providerId: "opencode-go",
        model: "minimax-m2.5",
      },
      lifecycleState: "completed",
      capabilitySnapshot: {
        resourceLease: {
          leaseId: "lease-1",
          createdAt: "2026-05-22T20:00:00.000Z",
          healthStatus: "healthy",
          cleanupStatus: "pending",
          workingDirectoryPath: "C:/work/kiln",
          workingDirectoryMode: "isolated-worktree",
          resourceUris: ["kiln://managed-agent/child-review/worktree"],
          diagnosticUris: [],
          worktreeReview: {
            status: "required",
            reason: "dirty-worktree-preserved",
            resourceUris: ["kiln://managed-agent/child-review/diff"],
            diagnosticUris: ["kiln://managed-agent/child-review/status"],
          },
        },
      },
      managedInvocationEvidence: {
        transcript: {
          uri: "kiln://managed-agent/child-review/transcript",
          retention: "session",
        },
      },
    });

    const ignored = event("evt-tool", 1, "tool_call_started", {
      toolCallId: "tool-1",
      toolName: "read",
    });

    let events = appendManagedAgentSessionEvent([], ignored);
    expect(events).toHaveLength(0);

    events = appendManagedAgentSessionEvent(events, completedWithReview);
    events = appendManagedAgentSessionEvent(events, started);
    events = appendManagedAgentSessionEvent(events, started);

    expect(events.map((entry) => entry.eventId)).toEqual(["evt-started", "evt-completed"]);
    expect(events[0]?.payload).toMatchObject({
      instanceId: "local-tui",
      sessionId: "session-1",
      managedInvocationId: "child-running",
    });
    expect(selectTuiManagedAgentDrilldownTarget(events)).toEqual({
      instanceId: "local-tui",
      sessionId: "session-1",
      managedInvocationId: "child-review",
      replayEventId: "evt-completed",
    });

    const viewState = projectTuiManagedAgentViewState(events);
    expect(viewState.activeCount).toBe(1);
    expect(viewState.attentionCount).toBe(2);
    expect(viewState.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        managedInvocationId: "child-running",
        attentionState: "active",
        cancelControl: expect.objectContaining({
          status: "requires-control-channel",
        }),
      }),
      expect.objectContaining({
        managedInvocationId: "child-review",
        attentionState: "needs_review",
        dirtyWorkspaceReviewRequired: true,
        transcriptUri: "kiln://managed-agent/child-review/transcript",
        resourceUris: expect.arrayContaining([
          "kiln://managed-agent/child-review/diff",
          "kiln://managed-agent/child-review/status",
          "kiln://managed-agent/child-review/transcript",
          "kiln://managed-agent/child-review/worktree",
        ]),
      }),
    ]));

    expect(formatManagedAgentCockpitLines(viewState)).toEqual(expect.arrayContaining([
      "attention: 2  active: 1",
      "! child-review needs_review completed opencode-go/minimax-m2.5 dirty events:1 resources:4",
      "  tx kiln://managed-agent/child-review/transcript",
      "  res kiln://managed-agent/child-review/diff",
      "> child-running active running codex-oauth/gpt-5.5 events:1 cancel:control",
    ]));

    const drilldownViewState = projectTuiManagedAgentViewState(events, {
      drilldownTarget: {
        instanceId: "local-tui",
        sessionId: "session-1",
        managedInvocationId: "child-review",
      },
    });

    expect(formatManagedAgentCockpitLines(drilldownViewState)).toEqual(expect.arrayContaining([
      "drilldown child-review",
      "  lifecycle completed",
      "  latest evt-completed",
      "  replay evt-completed",
      "  prev -- next --",
      "  timeline:",
      "    3 agent_invocation_completed evt-completed",
      "  resources:",
      "    kiln://managed-agent/child-review/diff",
      "    kiln://managed-agent/child-review/status",
      "    kiln://managed-agent/child-review/transcript",
      "    kiln://managed-agent/child-review/worktree",
    ]));
  });

  it("formats unresolved drilldown from shared view state without local fallback data", () => {
    const started = event("evt-started", 1, "agent_invocation_started", {
      invocationId: "child-running",
      lifecycleState: "running",
    });
    const events = appendManagedAgentSessionEvent([], started);

    const viewState = projectTuiManagedAgentViewState(events, {
      drilldownTarget: {
        instanceId: "local-tui",
        sessionId: "session-1",
        managedInvocationId: "child-missing",
      },
    });

    expect(formatManagedAgentCockpitLines(viewState)).toEqual(expect.arrayContaining([
      "drilldown unresolved managed-invocation-not-found",
    ]));
  });

  it("formats timed-out managed children from shared timeout attention", () => {
    const failed = event("evt-timeout", 1, "agent_invocation_failed", {
      invocationId: "child-timeout",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.5",
      },
      lifecycleState: "timed_out",
      managedInvocationEvidence: {
        diagnostics: [{
          uri: "kiln://managed-agent/child-timeout/timeout",
          kind: "timeout",
        }],
        resultHandoff: {
          summary: "Managed child timed out after the configured limit.",
          resourceUris: ["kiln://managed-agent/child-timeout/handoff"],
          memoryWriteProposalUris: [],
        },
      },
    });
    const events = appendManagedAgentSessionEvent([], failed);

    const viewState = projectTuiManagedAgentViewState(events, {
      drilldownTarget: {
        instanceId: "local-tui",
        sessionId: "session-1",
        managedInvocationId: "child-timeout",
      },
    });

    expect(viewState.items[0]).toMatchObject({
      managedInvocationId: "child-timeout",
      attentionState: "timed_out",
      status: "failed",
      lifecycleState: "timed_out",
      resourceUris: [
        "kiln://managed-agent/child-timeout/handoff",
        "kiln://managed-agent/child-timeout/timeout",
      ],
    });
    expect(formatManagedAgentCockpitLines(viewState)).toEqual(expect.arrayContaining([
      "attention: 1  active: 0",
      "! child-timeout timed_out failed codex-oauth/gpt-5.5 events:1 resources:2",
      "  res kiln://managed-agent/child-timeout/handoff",
      "  res kiln://managed-agent/child-timeout/timeout",
      "drilldown child-timeout",
      "  lifecycle timed_out",
      "  timeline:",
      "    1 agent_invocation_failed evt-timeout",
    ]));
  });

  it("formats stale heartbeat recovery from shared stale attention", () => {
    const failed = event("evt-stale", 1, "agent_invocation_failed", {
      invocationId: "child-stale",
      providerRoute: {
        providerId: "opencode",
        model: "minimax-m2.5",
      },
      lifecycleState: "stale",
      managedInvocationEvidence: {
        diagnostics: [{
          uri: "kiln://managed-agent/child-stale/heartbeat",
          kind: "heartbeat",
        }],
        resultHandoff: {
          summary: "Managed invocation heartbeat expired.",
          resourceUris: ["kiln://managed-agent/child-stale/handoff"],
          memoryWriteProposalUris: [],
        },
      },
    });
    const events = appendManagedAgentSessionEvent([], failed);

    const viewState = projectTuiManagedAgentViewState(events, {
      drilldownTarget: {
        instanceId: "local-tui",
        sessionId: "session-1",
        managedInvocationId: "child-stale",
      },
    });

    expect(viewState.items[0]).toMatchObject({
      managedInvocationId: "child-stale",
      attentionState: "stale",
      status: "failed",
      lifecycleState: "stale",
    });
    expect(formatManagedAgentCockpitLines(viewState)).toEqual(expect.arrayContaining([
      "attention: 1  active: 0",
      "! child-stale stale failed opencode/minimax-m2.5 events:1 resources:2",
      "drilldown child-stale",
      "  lifecycle stale",
      "    1 agent_invocation_failed evt-stale",
    ]));
  });

  it("formats ordinary adapter failure from shared failed attention", () => {
    const failed = event("evt-failed", 1, "agent_invocation_failed", {
      invocationId: "child-failed",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.5",
      },
      lifecycleState: "failed",
      errorCode: "ADAPTER_FAILURE",
      errorMessage: "Managed child adapter failed before handoff.",
      managedInvocationEvidence: {
        diagnostics: [{
          uri: "kiln://managed-agent/child-failed/failure",
          kind: "failure",
        }],
        resultHandoff: {
          summary: "Managed child adapter failed before handoff.",
          resourceUris: [
            "kiln://managed-agent/child-failed/handoff",
            "kiln://managed-agent/child-failed/failure",
          ],
          memoryWriteProposalUris: [],
        },
      },
    });
    const events = appendManagedAgentSessionEvent([], failed);

    const viewState = projectTuiManagedAgentViewState(events, {
      drilldownTarget: {
        instanceId: "local-tui",
        sessionId: "session-1",
        managedInvocationId: "child-failed",
      },
    });

    expect(viewState.items[0]).toMatchObject({
      managedInvocationId: "child-failed",
      attentionState: "failed",
      status: "failed",
      lifecycleState: "failed",
      resourceUris: [
        "kiln://managed-agent/child-failed/failure",
        "kiln://managed-agent/child-failed/handoff",
      ],
    });
    expect(formatManagedAgentCockpitLines(viewState)).toEqual(expect.arrayContaining([
      "attention: 1  active: 0",
      "! child-failed failed failed codex-oauth/gpt-5.5 events:1 resources:2",
      "  res kiln://managed-agent/child-failed/failure",
      "  res kiln://managed-agent/child-failed/handoff",
      "drilldown child-failed",
      "  lifecycle failed",
      "  timeline:",
      "    1 agent_invocation_failed evt-failed",
      "    kiln://managed-agent/child-failed/failure",
      "    kiln://managed-agent/child-failed/handoff",
    ]));
  });

  it("retains runtime adoption-gate snapshots and formats managed child drilldown adoption state", () => {
    let events = appendManagedAgentSessionEvent([], event("evt-completed", 1, "agent_invocation_completed", {
      invocationId: "child-adopted",
      lifecycleState: "completed",
    }));
    events = appendManagedAgentSessionEvent(events, event("evt-adoption", 2, "work_item_updated", {
      instanceId: "local-tui",
      sessionId: "session-1",
      workItemId: "work-adopted",
      managedOrchestrationAdoptionGate: {
        required: true,
        target: "slice-6-handoff-review-adoption",
        reason: "Managed child output must be adopted before closeout.",
        orchestrationId: "orch-adoption",
        childId: "child-adopted",
        mergePolicyMode: "manual",
        status: "adopted",
        adoptedBy: "operator",
        adoptedAt: "2026-05-22T20:00:02.000Z",
        resourceUris: ["kiln://artifacts/orch-adoption/adoption-review"],
        blockingEvidence: [],
      },
    }));

    expect(events.map((entry) => entry.eventId)).toEqual(["evt-completed", "evt-adoption"]);
    expect(selectTuiManagedAgentDrilldownTarget(events)).toEqual({
      instanceId: "local-tui",
      sessionId: "session-1",
      managedInvocationId: "child-adopted",
      replayEventId: "evt-adoption",
    });

    const viewState = projectTuiManagedAgentViewState(events, {
      drilldownTarget: {
        instanceId: "local-tui",
        sessionId: "session-1",
        managedInvocationId: "child-adopted",
      },
    });

    expect(formatManagedAgentCockpitLines(viewState)).toEqual(expect.arrayContaining([
      "- child-adopted clear completed events:1 adoption:adopted resources:1",
      "drilldown child-adopted",
      "  adoption adopted",
      "  adopted by operator at 2026-05-22T20:00:02.000Z",
      "  adoption resources:",
      "    kiln://artifacts/orch-adoption/adoption-review",
    ]));
  });

  it("formats blocked adoption-gate detail without implying merge readiness", () => {
    let events = appendManagedAgentSessionEvent([], event("evt-completed", 1, "agent_invocation_completed", {
      invocationId: "child-rejected",
      lifecycleState: "completed",
    }));
    events = appendManagedAgentSessionEvent(events, event("evt-rejected", 2, "work_item_updated", {
      instanceId: "local-tui",
      sessionId: "session-1",
      workItemId: "work-rejected",
      managedOrchestrationAdoptionGate: {
        required: true,
        target: "slice-6-handoff-review-adoption",
        reason: "Managed child output must be adopted before closeout.",
        orchestrationId: "orch-rejected",
        childId: "child-rejected",
        mergePolicyMode: "manual",
        status: "rejected",
        resourceUris: [],
        blockingEvidence: ["managed-orchestration:adoption-gate"],
        rejection: {
          gate: "managed orchestration adoption gate",
          summary: "Reviewer rejected the child handoff.",
          evidence: ["kiln://artifacts/orch-rejected/review"],
          completedAt: "2026-05-22T20:00:02.000Z",
        },
      },
    }));

    const lines = formatManagedAgentCockpitLines(projectTuiManagedAgentViewState(events, {
      drilldownTarget: {
        instanceId: "local-tui",
        sessionId: "session-1",
        managedInvocationId: "child-rejected",
      },
    }));

    expect(lines).toEqual(expect.arrayContaining([
      "! child-rejected needs_review completed events:1 adoption:rejected resources:1",
      "  adoption rejected",
      "  rejection managed orchestration adoption gate",
      "  rejection summary Reviewer rejected the child handoff.",
      "  rejection evidence kiln://artifacts/orch-rejected/review",
      "  blocking managed-orchestration:adoption-gate",
    ]));
    expect(lines.join("\n")).not.toContain("merge");
  });

  it("rejects adoption-gate frames without matching gateway identity", () => {
    const completed = event("evt-completed", 1, "agent_invocation_completed", {
      invocationId: "child-adoption",
      lifecycleState: "completed",
    });
    const missingIdentity = event("evt-missing-identity", 2, "work_item_updated", {
      managedOrchestrationAdoptionGate: {
        required: true,
        target: "slice-6-handoff-review-adoption",
        childId: "child-adoption",
        status: "adopted",
        resourceUris: ["kiln://artifacts/orch-adoption/adoption-review"],
        blockingEvidence: [],
      },
    });
    const crossSession = event("evt-cross-session", 3, "work_item_updated", {
      instanceId: "local-tui",
      sessionId: "session-other",
      managedOrchestrationAdoptionGate: {
        required: true,
        target: "slice-6-handoff-review-adoption",
        childId: "child-adoption",
        status: "adopted",
        resourceUris: ["kiln://artifacts/orch-adoption/adoption-review"],
        blockingEvidence: [],
      },
    });

    let events = appendManagedAgentSessionEvent([], completed);
    events = appendManagedAgentSessionEvent(events, missingIdentity);
    events = appendManagedAgentSessionEvent(events, crossSession);

    expect(events.map((entry) => entry.eventId)).toEqual(["evt-completed"]);
    expect(projectTuiManagedAgentViewState(events).items[0]?.adoptionGate).toBeUndefined();
  });

  it("keeps requested empty-event drilldown fail-closed", () => {
    const viewState = projectTuiManagedAgentViewState([], {
      drilldownTarget: {
        instanceId: "local-tui",
        sessionId: "session-1",
        managedInvocationId: "child-missing",
      },
    });

    expect(viewState.drilldown).toEqual({
      resolved: false,
      reason: "managed-invocation-not-found",
    });
    expect(formatManagedAgentCockpitLines(viewState)).toEqual([
      "(none)",
      "drilldown unresolved managed-invocation-not-found",
    ]);
  });

  it("formats the empty state without local lifecycle fallback text", () => {
    expect(formatManagedAgentCockpitLines(EMPTY_TUI_MANAGED_AGENT_VIEW_STATE)).toEqual(["(none)"]);
  });
});
