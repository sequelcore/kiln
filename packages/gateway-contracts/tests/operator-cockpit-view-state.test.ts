import { describe, expect, it } from "vitest";
import {
  createOperatorCockpitBenchmarkFixture,
} from "../src/operator-cockpit-benchmark.js";
import {
  normalizeManagedAgentOperatorEvents,
  projectOperatorCockpitReadOnlyView,
} from "../src/operator-cockpit-projection.js";
import {
  createOperatorCockpitReadOnlyViewState,
} from "../src/operator-cockpit-view-state.js";

describe("operator cockpit read-only view state", () => {
  it("derives focused session, filtered timeline, and replay cursor without mutation dispatch", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "view-state",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 4,
      eventCount: 24,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "view-state:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
        {
          instanceId: "view-state:instance:2",
          label: "Simulated remote",
          kind: "simulated-remote",
        },
      ],
      events: fixture.events,
    });

    const replayEvent = projection.timeline[1]!;
    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        focusTarget: {
          instanceId: replayEvent.instanceId,
          sessionId: replayEvent.sessionId,
        },
        filters: {
          instanceId: replayEvent.instanceId,
          sessionId: replayEvent.sessionId,
          kinds: [replayEvent.kind],
        },
        replayCursor: {
          instanceId: replayEvent.instanceId,
          sessionId: replayEvent.sessionId,
          eventId: replayEvent.eventId,
        },
      },
    });

    expect(view.mode).toBe("read-only");
    expect(view.dispatch).toBe("not-dispatched");
    expect(view.mutationDispatch).toBe("disabled");
    expect(view.focus.resolved).toBe(true);
    expect(view.focus.target).toEqual({
      instanceId: replayEvent.instanceId,
      sessionId: replayEvent.sessionId,
    });
    expect(view.timeline.entries.length).toBeGreaterThan(0);
    expect(view.timeline.entries.every((entry) => (
      entry.instanceId === replayEvent.instanceId
      && entry.sessionId === replayEvent.sessionId
      && entry.kind === replayEvent.kind
    ))).toBe(true);
    expect(view.replay.resolved).toBe(true);
    expect(view.replay.entry?.eventId).toBe(replayEvent.eventId);
  });

  it("fails closed when focus, filters, or replay targets do not resolve", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "view-state-fail",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 8,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "view-state-fail:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: fixture.events,
    });
    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        focusTarget: {
          instanceId: "view-state-fail:instance:missing",
          sessionId: "view-state-fail:session:missing",
        },
        filters: {
          instanceId: "view-state-fail:instance:missing",
        },
        replayCursor: {
          instanceId: "view-state-fail:instance:missing",
          sessionId: "view-state-fail:session:missing",
          eventId: "view-state-fail:event:missing",
        },
      },
    });

    expect(view.focus.resolved).toBe(false);
    expect(view.timeline.entries).toEqual([]);
    expect(view.timeline.valid).toBe(false);
    expect(view.replay.resolved).toBe(false);
    expect(view.replay.entry).toBeUndefined();
    expect(view.replay.previousEventId).toBeUndefined();
    expect(view.replay.nextEventId).toBeUndefined();
  });

  it("does not resolve replay when filter state is invalid", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "view-state-invalid-filter-replay",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 8,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "view-state-invalid-filter-replay:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: fixture.events,
    });
    const replayEvent = projection.timeline[0]!;

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        filters: {
          instanceId: "view-state-invalid-filter-replay:instance:missing",
        },
        replayCursor: {
          instanceId: replayEvent.instanceId,
          sessionId: replayEvent.sessionId,
          eventId: replayEvent.eventId,
        },
      },
    });

    expect(view.timeline.valid).toBe(false);
    expect(view.replay.resolved).toBe(false);
    expect(view.replay.entry).toBeUndefined();
  });

  it("filters managed invocation and tool timelines from explicit projected targets", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "view-state-targets",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 2,
      eventCount: 18,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "view-state-targets:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: fixture.events,
    });
    const invocation = projection.invocations[0]!;
    const tool = projection.toolSummaries[0]!;

    const invocationView = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        filters: {
          instanceId: invocation.instanceId,
          sessionId: invocation.sessionId,
          managedInvocationId: invocation.managedInvocationId,
        },
      },
    });
    const toolView = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        filters: {
          instanceId: tool.instanceId,
          sessionId: tool.sessionId,
          toolCallId: tool.toolCallId,
        },
      },
    });

    expect(invocationView.timeline.valid).toBe(true);
    expect(invocationView.timeline.entries.length).toBeGreaterThan(0);
    expect(invocationView.timeline.entries.every((entry) => (
      entry.target.managedInvocationId === invocation.managedInvocationId
    ))).toBe(true);
    expect(toolView.timeline.valid).toBe(true);
    expect(toolView.timeline.entries.length).toBeGreaterThan(0);
    expect(toolView.timeline.entries.every((entry) => (
      entry.target.toolCallId === tool.toolCallId
    ))).toBe(true);
  });

  it("derives managed child cockpit items with attention state, timeline, and evidence resources", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [{
        instanceId: "managed-view:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [
        {
          eventId: "managed-view:event:running",
          kilnSessionId: "managed-view:session:1",
          sequence: 1,
          timestamp: "2026-05-23T12:00:00.000Z",
          kind: "agent_invocation_started",
          payload: {
            instanceId: "managed-view:instance:1",
            sessionId: "managed-view:session:1",
            managedInvocationId: "managed-view:child:running",
            invocationId: "managed-view:child:running",
            agentId: "agent-coder",
            lifecycleState: "running",
          },
        },
        {
          eventId: "managed-view:event:review",
          kilnSessionId: "managed-view:session:1",
          sequence: 2,
          timestamp: "2026-05-23T12:00:05.000Z",
          kind: "agent_invocation_completed",
          payload: {
            instanceId: "managed-view:instance:1",
            sessionId: "managed-view:session:1",
            managedInvocationId: "managed-view:child:review",
            invocationId: "managed-view:child:review",
            agentId: "agent-coder",
            lifecycleState: "completed",
            managedInvocationEvidence: {
              transcript: {
                uri: "kiln://managed-invocations/managed-view-child-review/transcript",
              },
              resultHandoff: {
                summary: "Review required.",
                resourceUris: ["kiln://managed-invocations/managed-view-child-review/handoff"],
                memoryWriteProposalUris: [],
              },
              lifecycle: {
                resourceLease: {
                  leaseId: "managed-view:child:review:lease",
                  createdAt: "2026-05-23T12:00:00.000Z",
                  healthStatus: "leaked",
                  cleanupStatus: "failed",
                  workingDirectoryPath: "C:/repo/.kiln/worktrees/managed-view-child-review",
                  workingDirectoryMode: "isolated-worktree",
                  resourceUris: ["kiln://managed-invocations/managed-view-child-review/worktree"],
                  diagnosticUris: ["kiln://managed-invocations/managed-view-child-review/cleanup"],
                  worktreeReview: {
                    status: "required",
                    reason: "dirty-worktree-preserved",
                    resourceUris: ["kiln://managed-invocations/managed-view-child-review/review"],
                    diagnosticUris: ["kiln://managed-invocations/managed-view-child-review/review-diagnostic"],
                  },
                },
              },
            },
          },
        },
      ],
    });

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {},
    });

    expect(view.managedAgents.activeCount).toBe(1);
    expect(view.managedAgents.attentionCount).toBe(2);
    expect(view.managedAgents.items).toEqual([
      expect.objectContaining({
        managedInvocationId: "managed-view:child:review",
        attentionState: "needs_review",
        dirtyWorkspaceReviewRequired: true,
        transcriptUri: "kiln://managed-invocations/managed-view-child-review/transcript",
        resourceUris: [
          "kiln://managed-invocations/managed-view-child-review/cleanup",
          "kiln://managed-invocations/managed-view-child-review/handoff",
          "kiln://managed-invocations/managed-view-child-review/review",
          "kiln://managed-invocations/managed-view-child-review/review-diagnostic",
          "kiln://managed-invocations/managed-view-child-review/transcript",
          "kiln://managed-invocations/managed-view-child-review/worktree",
        ],
        lifecycleTimeline: [
          expect.objectContaining({
            eventId: "managed-view:event:review",
          }),
        ],
      }),
      expect.objectContaining({
        managedInvocationId: "managed-view:child:running",
        attentionState: "active",
        dirtyWorkspaceReviewRequired: false,
        cancelControl: {
          status: "requires-control-channel",
          reason: "Read-only cockpit projection cannot dispatch cancellation.",
        },
      }),
    ]);
  });

  it("marks denied worktree conflicts as managed child review attention", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [{
        instanceId: "managed-conflict:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [
        {
          eventId: "managed-conflict:event:failed",
          kilnSessionId: "managed-conflict:session:1",
          sequence: 1,
          timestamp: "2026-05-23T12:00:00.000Z",
          kind: "agent_invocation_failed",
          payload: {
            instanceId: "managed-conflict:instance:1",
            sessionId: "managed-conflict:session:1",
            managedInvocationId: "managed-conflict:child:blocked",
            invocationId: "managed-conflict:child:blocked",
            agentId: "agent-coder",
            lifecycleState: "failed",
            managedInvocationEvidence: {
              lifecycle: {
                resourceLease: {
                  leaseId: "managed-conflict:child:blocked:lease",
                  createdAt: "2026-05-23T12:00:00.000Z",
                  healthStatus: "stale",
                  cleanupStatus: "not-required",
                  workingDirectoryPath: "C:/repo",
                  workingDirectoryMode: "workspace-write",
                  resourceUris: [],
                  diagnosticUris: ["kiln://managed-invocations/managed-conflict-child-blocked/conflict"],
                  worktreeConflict: {
                    status: "blocked",
                    reason: "same-checkout-write-conflict",
                    requestedInvocationId: "managed-conflict:child:blocked",
                    conflictingInvocationId: "managed-conflict:child:active",
                    workingDirectoryPath: "C:/repo",
                    workingDirectoryMode: "workspace-write",
                    policyId: "managed-agent.worktree.single-active-writer",
                    retryAfterInvocationIds: ["managed-conflict:child:active"],
                    resourceUris: [],
                    diagnosticUris: ["kiln://managed-invocations/managed-conflict-child-blocked/conflict"],
                  },
                },
              },
            },
          },
        },
      ],
    });

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {},
    });

    expect(view.managedAgents.attentionCount).toBe(1);
    expect(view.managedAgents.items[0]).toMatchObject({
      managedInvocationId: "managed-conflict:child:blocked",
      attentionState: "needs_review",
      dirtyWorkspaceReviewRequired: false,
      worktreeConflictBlocked: true,
      worktreeConflict: {
        status: "blocked",
        reason: "same-checkout-write-conflict",
        requestedInvocationId: "managed-conflict:child:blocked",
        conflictingInvocationId: "managed-conflict:child:active",
        workingDirectoryPath: "C:/repo",
        workingDirectoryMode: "workspace-write",
        policyId: "managed-agent.worktree.single-active-writer",
        retryAfterInvocationIds: ["managed-conflict:child:active"],
        resourceUris: [],
        diagnosticUris: ["kiln://managed-invocations/managed-conflict-child-blocked/conflict"],
      },
      resourceUris: ["kiln://managed-invocations/managed-conflict-child-blocked/conflict"],
    });
  });

  it("preserves timed-out terminal managed children as timeout attention", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-24T12:01:00.000Z",
      attachTargets: [{
        instanceId: "managed-timeout:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [
        {
          eventId: "managed-timeout:event:failed",
          kilnSessionId: "managed-timeout:session:1",
          sequence: 1,
          timestamp: "2026-05-24T12:00:00.000Z",
          kind: "agent_invocation_failed",
          payload: {
            instanceId: "managed-timeout:instance:1",
            sessionId: "managed-timeout:session:1",
            managedInvocationId: "managed-timeout:child:1",
            invocationId: "managed-timeout:child:1",
            agentId: "agent-coder",
            lifecycleState: "timed_out",
            childSessionId: "managed-timeout:child-session:1",
            childTurnId: "managed-timeout:child-turn:1",
            timeoutMs: 120000,
            timeoutSource: "explicit-route",
            providerRoute: {
              providerId: "codex-oauth",
              model: "gpt-5.5",
            },
            managedInvocationEvidence: {
              diagnostics: [{
                uri: "kiln://managed-invocations/managed-timeout-child-1/timeout",
                kind: "timeout",
              }],
              resultHandoff: {
                summary: "Managed child timed out after the configured limit.",
                resourceUris: ["kiln://managed-invocations/managed-timeout-child-1/handoff"],
                memoryWriteProposalUris: [],
              },
            },
          },
        },
      ],
    });

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {},
    });

    expect(view.managedAgents.activeCount).toBe(0);
    expect(view.managedAgents.attentionCount).toBe(1);
    expect(view.managedAgents.items[0]).toMatchObject({
      managedInvocationId: "managed-timeout:child:1",
      attentionState: "timed_out",
      status: "failed",
      lifecycleState: "timed_out",
      childSessionId: "managed-timeout:child-session:1",
      childTurnId: "managed-timeout:child-turn:1",
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      providerRoute: "codex-oauth/gpt-5.5",
      resourceUris: [
        "kiln://managed-invocations/managed-timeout-child-1/handoff",
        "kiln://managed-invocations/managed-timeout-child-1/timeout",
      ],
      cancelControl: {
        status: "unavailable",
        reason: "Managed invocation is not active.",
      },
    });
  });

  it("marks non-substantive managed handoff recovery as review attention", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-29T12:01:00.000Z",
      attachTargets: [{
        instanceId: "managed-recovery:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: normalizeManagedAgentOperatorEvents([{
        eventId: "managed-recovery:event:invoke",
        kilnSessionId: "managed-recovery:session:1",
        sequence: 1,
        timestamp: "2026-05-29T12:00:00.000Z",
        turnId: "managed-recovery:turn:1",
        kind: "tool_call_completed",
        payload: {
          sessionId: "managed-recovery:session:1",
          toolCallId: "managed-recovery:tool:invoke",
          toolName: "managed_agent.invoke",
          state: "succeeded",
          metadata: {
            kind: "managed-invocation",
            managedInvocationId: "managed-recovery:child:1",
            status: "handoff_not_substantive",
            lifecycleState: "completed",
            resultHandoff: {
              summary: "Direct provider managed invocation finished without final handoff text. Inspect the transcript resource before recording governed evidence.",
              resourceUris: ["kiln://managed-invocations/managed-recovery-child-1/content"],
              memoryWriteProposalUris: [],
            },
            managedInvocationRecovery: {
              status: "phase_evidence_required",
              nextTool: "work_item.update",
              thenTool: "work_item.execution.start",
              workItemId: "work-managed-recovery",
              evidenceToRecord: ["visual-reference-research"],
              requiredToolNames: ["read", "glob", "grep"],
              sourceResourceUris: ["kiln://managed-invocations/managed-recovery-child-1/content"],
              inspectionTool: "resource_read",
              blockedWorkItemUpdateInputTemplate: {
                id: "work-managed-recovery",
                status: "blocked",
                pauseRequirements: [{
                  id: "managed-invocation-handoff-recovery",
                  kind: "operator_input",
                  summary: "No qualifying evidence after inspection.",
                  status: "pending",
                }],
              },
            },
          },
        },
      }], {
        defaultInstanceId: "managed-recovery:instance:1",
      }),
    });

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {},
    });

    expect(view.managedAgents.activeCount).toBe(0);
    expect(view.managedAgents.attentionCount).toBe(1);
    expect(view.managedAgents.items[0]).toMatchObject({
      managedInvocationId: "managed-recovery:child:1",
      status: "failed",
      lifecycleState: "handoff_not_substantive",
      attentionState: "needs_review",
      managedInvocationRecovery: {
        status: "phase_evidence_required",
        nextTool: "work_item.update",
        thenTool: "work_item.execution.start",
        workItemId: "work-managed-recovery",
        evidenceToRecord: ["visual-reference-research"],
        requiredToolNames: ["read", "glob", "grep"],
        sourceResourceUris: ["kiln://managed-invocations/managed-recovery-child-1/content"],
        inspectionTool: "resource_read",
        blockedWorkItemUpdateInputTemplate: {
          id: "work-managed-recovery",
          status: "blocked",
          pauseRequirements: [{
            id: "managed-invocation-handoff-recovery",
            kind: "operator_input",
            summary: "No qualifying evidence after inspection.",
            status: "pending",
          }],
        },
      },
      resourceUris: ["kiln://managed-invocations/managed-recovery-child-1/content"],
    });
  });

  it("projects stale heartbeat recovery as distinct managed-child attention", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-24T12:01:00.000Z",
      attachTargets: [{
        instanceId: "managed-stale:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [
        {
          eventId: "managed-stale:event:failed",
          kilnSessionId: "managed-stale:session:1",
          sequence: 1,
          timestamp: "2026-05-24T12:00:00.000Z",
          kind: "agent_invocation_failed",
          payload: {
            instanceId: "managed-stale:instance:1",
            sessionId: "managed-stale:session:1",
            managedInvocationId: "managed-stale:child:1",
            invocationId: "managed-stale:child:1",
            agentId: "agent-coder",
            lifecycleState: "stale",
            providerRoute: {
              providerId: "opencode",
              model: "minimax-m2.5",
            },
            errorCode: "ENGINE_STALE",
            errorMessage: "Managed invocation heartbeat expired.",
            managedInvocationEvidence: {
              diagnostics: [{
                uri: "kiln://managed-invocations/managed-stale-child-1/heartbeat",
                kind: "heartbeat",
              }],
              resultHandoff: {
                summary: "Managed invocation heartbeat expired.",
                resourceUris: ["kiln://managed-invocations/managed-stale-child-1/handoff"],
                memoryWriteProposalUris: [],
              },
            },
          },
        },
      ],
    });

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {},
    });

    expect(view.managedAgents.activeCount).toBe(0);
    expect(view.managedAgents.attentionCount).toBe(1);
    expect(view.managedAgents.items[0]).toMatchObject({
      managedInvocationId: "managed-stale:child:1",
      attentionState: "stale",
      status: "failed",
      lifecycleState: "stale",
      providerRoute: "opencode/minimax-m2.5",
      resourceUris: [
        "kiln://managed-invocations/managed-stale-child-1/handoff",
        "kiln://managed-invocations/managed-stale-child-1/heartbeat",
      ],
      cancelControl: {
        status: "unavailable",
        reason: "Managed invocation is not active.",
      },
    });
  });

  it("projects ordinary adapter failures as failed managed-child attention", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-24T12:01:00.000Z",
      attachTargets: [{
        instanceId: "managed-failed:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [
        {
          eventId: "managed-failed:event:failed",
          kilnSessionId: "managed-failed:session:1",
          sequence: 1,
          timestamp: "2026-05-24T12:00:00.000Z",
          kind: "agent_invocation_failed",
          payload: {
            instanceId: "managed-failed:instance:1",
            sessionId: "managed-failed:session:1",
            managedInvocationId: "managed-failed:child:1",
            invocationId: "managed-failed:child:1",
            agentId: "agent-coder",
            lifecycleState: "failed",
            providerRoute: {
              providerId: "codex-oauth",
              model: "gpt-5.5",
            },
            errorCode: "ADAPTER_FAILURE",
            errorMessage: "Managed child adapter failed before handoff.",
            managedInvocationEvidence: {
              diagnostics: [{
                uri: "kiln://managed-invocations/managed-failed-child-1/failure",
                kind: "failure",
              }],
              resultHandoff: {
                summary: "Managed child adapter failed before handoff.",
                resourceUris: [
                  "kiln://managed-invocations/managed-failed-child-1/handoff",
                  "kiln://managed-invocations/managed-failed-child-1/failure",
                ],
                memoryWriteProposalUris: [],
              },
            },
          },
        },
      ],
    });

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {},
    });

    expect(view.managedAgents.activeCount).toBe(0);
    expect(view.managedAgents.attentionCount).toBe(1);
    expect(view.managedAgents.items[0]).toMatchObject({
      managedInvocationId: "managed-failed:child:1",
      attentionState: "failed",
      status: "failed",
      lifecycleState: "failed",
      providerRoute: "codex-oauth/gpt-5.5",
      resourceUris: [
        "kiln://managed-invocations/managed-failed-child-1/failure",
        "kiln://managed-invocations/managed-failed-child-1/handoff",
      ],
      cancelControl: {
        status: "unavailable",
        reason: "Managed invocation is not active.",
      },
    });
    expect(view.managedAgents.items[0]?.lifecycleTimeline[0]).toMatchObject({
      eventId: "managed-failed:event:failed",
      compactText: "codex-oauth/gpt-5.5 · Managed child adapter failed before handoff.",
      tone: "error",
    });
  });

  it("marks route-profile conflicts as managed child review attention", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-29T13:01:00.000Z",
      attachTargets: [{
        instanceId: "managed-route-conflict:instance:1",
        label: "GUI",
        kind: "local",
      }],
      events: [{
        eventId: "managed-route-conflict:event:failed",
        kilnSessionId: "managed-route-conflict:session:1",
        sequence: 1,
        timestamp: "2026-05-29T13:00:00.000Z",
        kind: "agent_invocation_failed",
        payload: {
          instanceId: "managed-route-conflict:instance:1",
          sessionId: "managed-route-conflict:session:1",
          managedInvocationId: "managed-route-conflict:child:1",
          invocationId: "managed-route-conflict:child:1",
          lifecycleState: "route_profile_conflict",
        },
      }],
    });

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {},
    });

    expect(view.managedAgents.activeCount).toBe(0);
    expect(view.managedAgents.attentionCount).toBe(1);
    expect(view.managedAgents.items[0]).toMatchObject({
      managedInvocationId: "managed-route-conflict:child:1",
      attentionState: "needs_review",
      status: "failed",
      lifecycleState: "route_profile_conflict",
    });
  });

  it("resolves managed child drilldown and scoped replay from canonical cockpit projection", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [{
        instanceId: "managed-detail:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [
        {
          eventId: "managed-detail:event:requested",
          kilnSessionId: "managed-detail:session:1",
          sequence: 1,
          timestamp: "2026-05-23T12:00:00.000Z",
          kind: "agent_invocation_requested",
          payload: {
            instanceId: "managed-detail:instance:1",
            sessionId: "managed-detail:session:1",
            managedInvocationId: "managed-detail:child:1",
            invocationId: "managed-detail:child:1",
            agentId: "agent-coder",
            lifecycleState: "pending",
          },
        },
        {
          eventId: "managed-detail:event:started",
          kilnSessionId: "managed-detail:session:1",
          sequence: 2,
          timestamp: "2026-05-23T12:00:01.000Z",
          kind: "agent_invocation_started",
          payload: {
            instanceId: "managed-detail:instance:1",
            sessionId: "managed-detail:session:1",
            managedInvocationId: "managed-detail:child:1",
            invocationId: "managed-detail:child:1",
            agentId: "agent-coder",
            lifecycleState: "running",
          },
        },
        {
          eventId: "managed-detail:event:completed",
          kilnSessionId: "managed-detail:session:1",
          sequence: 3,
          timestamp: "2026-05-23T12:00:02.000Z",
          kind: "agent_invocation_completed",
          payload: {
            instanceId: "managed-detail:instance:1",
            sessionId: "managed-detail:session:1",
            managedInvocationId: "managed-detail:child:1",
            invocationId: "managed-detail:child:1",
            agentId: "agent-coder",
            lifecycleState: "completed",
            managedInvocationEvidence: {
              transcript: {
                uri: "kiln://managed-invocations/managed-detail-child-1/transcript",
              },
              resultHandoff: {
                summary: "Child completed.",
                resourceUris: [
                  "kiln://managed-invocations/managed-detail-child-1/handoff",
                  "kiln://managed-invocations/managed-detail-child-1/report",
                ],
                memoryWriteProposalUris: [],
              },
              diagnostics: [{
                uri: "kiln://managed-invocations/managed-detail-child-1/diagnostic",
                kind: "adapter",
              }],
            },
          },
        },
      ],
    });

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        managedAgentDrilldownTarget: {
          instanceId: "managed-detail:instance:1",
          sessionId: "managed-detail:session:1",
          managedInvocationId: "managed-detail:child:1",
          replayEventId: "managed-detail:event:started",
        },
      },
    });

    expect(view.managedAgents.drilldown).toMatchObject({
      resolved: true,
      item: {
        managedInvocationId: "managed-detail:child:1",
        latestEventId: "managed-detail:event:completed",
      },
      replay: {
        entry: {
          eventId: "managed-detail:event:started",
        },
        previousEventId: "managed-detail:event:requested",
        nextEventId: "managed-detail:event:completed",
      },
    });
    expect(view.managedAgents.drilldown?.resolved && view.managedAgents.drilldown.item.lifecycleTimeline.map((entry) => entry.eventId)).toEqual([
      "managed-detail:event:requested",
      "managed-detail:event:started",
      "managed-detail:event:completed",
    ]);
    expect(view.managedAgents.drilldown?.resolved && view.managedAgents.drilldown.item.resourceUris).toEqual([
      "kiln://managed-invocations/managed-detail-child-1/diagnostic",
      "kiln://managed-invocations/managed-detail-child-1/handoff",
      "kiln://managed-invocations/managed-detail-child-1/report",
      "kiln://managed-invocations/managed-detail-child-1/transcript",
    ]);
  });

  it("projects runtime adoption-gate snapshots onto matching managed child drilldown only", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [{
        instanceId: "managed-adoption:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [
        {
          eventId: "managed-adoption:event:completed",
          kilnSessionId: "managed-adoption:session:1",
          sequence: 1,
          timestamp: "2026-05-23T12:00:00.000Z",
          kind: "agent_invocation_completed",
          payload: {
            instanceId: "managed-adoption:instance:1",
            sessionId: "managed-adoption:session:1",
            managedInvocationId: "managed-adoption:child:adopted",
            invocationId: "managed-adoption:child:adopted",
            lifecycleState: "completed",
          },
        },
        {
          eventId: "managed-adoption:event:adopted",
          kilnSessionId: "managed-adoption:session:1",
          sequence: 2,
          timestamp: "2026-05-23T12:00:01.000Z",
          kind: "work_item_updated",
          payload: {
            instanceId: "managed-adoption:instance:1",
            sessionId: "managed-adoption:session:1",
            workItemId: "work-adopted",
            managedOrchestrationAdoptionGate: {
              required: true,
              target: "slice-6-handoff-review-adoption",
              reason: "Managed child output must be adopted before closeout.",
              orchestrationId: "orch-adoption",
              childId: "managed-adoption:child:adopted",
              mergePolicyMode: "manual",
              status: "adopted",
              adoptedBy: "operator",
              adoptedAt: "2026-05-23T12:00:01.000Z",
              resourceUris: ["kiln://artifacts/orch-adoption/adoption-review"],
              blockingEvidence: [],
            },
          },
        },
        {
          eventId: "managed-adoption:event:mismatch",
          kilnSessionId: "managed-adoption:session:1",
          sequence: 3,
          timestamp: "2026-05-23T12:00:02.000Z",
          kind: "work_item_updated",
          payload: {
            instanceId: "managed-adoption:instance:1",
            sessionId: "managed-adoption:session:1",
            workItemId: "work-mismatch",
            managedOrchestrationAdoptionGate: {
              required: true,
              target: "slice-6-handoff-review-adoption",
              reason: "Must not attach to the selected child.",
              orchestrationId: "orch-mismatch",
              childId: "managed-adoption:child:other",
              mergePolicyMode: "manual",
              status: "pending_review",
              resourceUris: [],
              blockingEvidence: ["managed-orchestration:adoption-gate"],
            },
          },
        },
      ],
    });

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        managedAgentDrilldownTarget: {
          instanceId: "managed-adoption:instance:1",
          sessionId: "managed-adoption:session:1",
          managedInvocationId: "managed-adoption:child:adopted",
        },
      },
    });

    const item = view.managedAgents.items.find((candidate) =>
      candidate.managedInvocationId === "managed-adoption:child:adopted");

    expect(item?.adoptionGate).toEqual({
      required: true,
      target: "slice-6-handoff-review-adoption",
      reason: "Managed child output must be adopted before closeout.",
      orchestrationId: "orch-adoption",
      childId: "managed-adoption:child:adopted",
      mergePolicyMode: "manual",
      status: "adopted",
      adoptedBy: "operator",
      adoptedAt: "2026-05-23T12:00:01.000Z",
      resourceUris: ["kiln://artifacts/orch-adoption/adoption-review"],
      blockingEvidence: [],
    });
    expect(view.managedAgents.drilldown?.resolved && view.managedAgents.drilldown.item.adoptionGate?.status).toBe("adopted");
    expect(view.managedAgents.items).toHaveLength(1);
  });

  it("projects not-required adoption-gate snapshots when runtime provides child correlation", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [{
        instanceId: "managed-adoption-not-required:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [
        {
          eventId: "managed-adoption-not-required:event:completed",
          kilnSessionId: "managed-adoption-not-required:session:1",
          sequence: 1,
          timestamp: "2026-05-23T12:00:00.000Z",
          kind: "agent_invocation_completed",
          payload: {
            instanceId: "managed-adoption-not-required:instance:1",
            sessionId: "managed-adoption-not-required:session:1",
            managedInvocationId: "managed-adoption-not-required:child:1",
            invocationId: "managed-adoption-not-required:child:1",
            lifecycleState: "completed",
          },
        },
        {
          eventId: "managed-adoption-not-required:event:gate",
          kilnSessionId: "managed-adoption-not-required:session:1",
          sequence: 2,
          timestamp: "2026-05-23T12:00:01.000Z",
          kind: "work_item_updated",
          payload: {
            instanceId: "managed-adoption-not-required:instance:1",
            sessionId: "managed-adoption-not-required:session:1",
            workItemId: "work-not-required",
            managedOrchestrationAdoptionGate: {
              required: false,
              target: "slice-6-handoff-review-adoption",
              reason: "Managed fan-out orchestration does not require automatic parent adoption.",
              orchestrationId: "orch-fan-out",
              childId: "managed-adoption-not-required:child:1",
              mergePolicyMode: "compare-and-select",
              status: "not_required",
              resourceUris: [],
              blockingEvidence: [],
            },
          },
        },
      ],
    });

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {},
    });

    expect(view.managedAgents.items).toEqual([
      expect.objectContaining({
        managedInvocationId: "managed-adoption-not-required:child:1",
        attentionState: "clear",
        adoptionGate: expect.objectContaining({
          required: false,
          status: "not_required",
          childId: "managed-adoption-not-required:child:1",
        }),
      }),
    ]);
  });

  it("fails closed for unresolved managed child detail targets", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "view-state-missing-detail",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 8,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "view-state-missing-detail:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: fixture.events,
    });

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        managedAgentDrilldownTarget: {
          instanceId: "view-state-missing-detail:instance:1",
          sessionId: "view-state-missing-detail:session:1",
          managedInvocationId: "view-state-missing-detail:child:missing",
        },
      },
    });

    expect(view.managedAgents.drilldown).toEqual({
      resolved: false,
      reason: "managed-invocation-not-found",
    });
  });

  it("fails closed when managed child drilldown replay is outside the selected lifecycle", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [{
        instanceId: "managed-replay:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [
        {
          eventId: "managed-replay:event:child-1",
          kilnSessionId: "managed-replay:session:1",
          sequence: 1,
          timestamp: "2026-05-23T12:00:00.000Z",
          kind: "agent_invocation_started",
          payload: {
            instanceId: "managed-replay:instance:1",
            sessionId: "managed-replay:session:1",
            managedInvocationId: "managed-replay:child:1",
            invocationId: "managed-replay:child:1",
            lifecycleState: "running",
          },
        },
        {
          eventId: "managed-replay:event:child-2",
          kilnSessionId: "managed-replay:session:1",
          sequence: 2,
          timestamp: "2026-05-23T12:00:01.000Z",
          kind: "agent_invocation_started",
          payload: {
            instanceId: "managed-replay:instance:1",
            sessionId: "managed-replay:session:1",
            managedInvocationId: "managed-replay:child:2",
            invocationId: "managed-replay:child:2",
            lifecycleState: "running",
          },
        },
      ],
    });

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        managedAgentDrilldownTarget: {
          instanceId: "managed-replay:instance:1",
          sessionId: "managed-replay:session:1",
          managedInvocationId: "managed-replay:child:1",
          replayEventId: "managed-replay:event:child-2",
        },
      },
    });

    expect(view.managedAgents.drilldown).toEqual({
      resolved: false,
      reason: "replay-event-not-found",
    });
  });

  it("fails closed for scoped timeline filters without their enclosing target", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "view-state-scoped-targets",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 12,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "view-state-scoped-targets:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: fixture.events,
    });
    const invocation = projection.invocations[0]!;
    const tool = projection.toolSummaries[0]!;

    expect(createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        filters: {
          sessionId: invocation.sessionId,
        },
      },
    }).timeline.valid).toBe(false);
    expect(createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        filters: {
          instanceId: invocation.instanceId,
          managedInvocationId: invocation.managedInvocationId,
        },
      },
    }).timeline.valid).toBe(false);
    expect(createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        filters: {
          instanceId: tool.instanceId,
          toolCallId: tool.toolCallId,
        },
      },
    }).timeline.valid).toBe(false);
  });
});
