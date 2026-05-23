import { describe, expect, it } from "vitest";
import type { OperatorSessionEvent } from "@kilnai/gateway-contracts";
import {
  EMPTY_TUI_MANAGED_AGENT_VIEW_STATE,
  appendManagedAgentSessionEvent,
  formatManagedAgentCockpitLines,
  projectTuiManagedAgentViewState,
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
  });

  it("formats the empty state without local lifecycle fallback text", () => {
    expect(formatManagedAgentCockpitLines(EMPTY_TUI_MANAGED_AGENT_VIEW_STATE)).toEqual(["(none)"]);
  });
});
