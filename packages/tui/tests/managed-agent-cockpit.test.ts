import { describe, expect, it } from "vitest";
import {
  createOperatorCockpitReadOnlyViewState,
  projectOperatorCockpitReadOnlyView,
  type OperatorSessionEvent,
} from "@kilnai/gateway-contracts";
import {
  EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE,
  externalRuntimeGovernanceEvents,
} from "../../gateway-contracts/tests/fixtures/external-runtime-governance.js";
import {
  MANAGED_ACCOUNT_LEASE_FIXTURE,
  managedAccountLeaseEvents,
} from "../../gateway-contracts/tests/fixtures/managed-account-lease.js";
import {
  MANAGED_ECONOMIC_LIFECYCLE_FIXTURE,
  managedEconomicLifecycleEvents,
  managedEconomicLifecycleUnprojectableEvents,
} from "../../gateway-contracts/tests/fixtures/managed-economic-lifecycle.js";
import {
  EMPTY_TUI_MANAGED_AGENT_VIEW_STATE,
  EMPTY_TUI_OPERATOR_WORKSPACE_HOME,
  appendManagedAgentSessionEvent,
  formatManagedAgentCockpitLines,
  projectTuiManagedAgentViewState,
  projectTuiOperatorWorkspaceState,
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
  it("renders canonical managed account lease evidence", () => {
    const tuiEvents = managedAccountLeaseEvents.map((entry) => ({
      ...entry,
      payload: { ...entry.payload, instanceId: "local-tui" },
    }));
    const output = formatManagedAgentCockpitLines(
      projectTuiManagedAgentViewState(tuiEvents),
    ).join("\n");

    expect(output).toContain(`account ${MANAGED_ACCOUNT_LEASE_FIXTURE.accountRef}`);
    expect(output).toContain(`lease:${MANAGED_ACCOUNT_LEASE_FIXTURE.lifecycleState}`);
    expect(output).toContain(`selection:${MANAGED_ACCOUNT_LEASE_FIXTURE.selectionReason}`);
  });

  it("formats canonical external-runtime attachment and redacted failure evidence", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T09:01:00.000Z",
      attachTargets: [{
        instanceId: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.instanceId,
        label: "Synthetic external runtime",
        kind: "local",
      }],
      events: externalRuntimeGovernanceEvents,
    });
    const viewState = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {},
    }).managedAgents;

    const output = formatManagedAgentCockpitLines(viewState).join("\n");

    expect(output).toContain(
      `attachment ${EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.attachment.runtimeId}/${EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.attachment.attachmentId}`,
    );
    expect(output).toContain(EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.safeFailureDiagnostic);
  });

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

  it("projects the TUI operator workspace home from the shared cockpit contract", () => {
    const events = appendManagedAgentSessionEvent([], event("evt-running", 1, "agent_invocation_started", {
      invocationId: "child-running",
      lifecycleState: "running",
      managedInvocationEvidence: {
        transcript: {
          uri: "kiln://managed-agent/child-running/transcript",
          retention: "session",
        },
      },
    }));

    const workspaceState = projectTuiOperatorWorkspaceState(events);

    expect(workspaceState.cockpitView.managedAgents.activeCount).toBe(1);
    expect(workspaceState.home.managedAgents).toEqual({
      totalCount: 1,
      activeCount: 1,
      attentionCount: 1,
    });
    expect(workspaceState.home.attention.items[0]).toMatchObject({
      reason: "managed-agent-active",
      target: {
        gatewayTargetId: "local-tui",
        instanceId: "local-tui",
        sessionId: "session-1",
        managedInvocationId: "child-running",
      },
    });
    expect(workspaceState.home.gatewayTargets[0]?.gatewayTarget).toMatchObject({
      targetId: "local-tui",
      kind: "local-operator-gateway",
      trust: "local",
    });
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

  it("formats worktree conflict evidence from shared managed-agent view state", () => {
    const failed = event("evt-conflict", 1, "agent_invocation_failed", {
      invocationId: "child-blocked",
      lifecycleState: "failed",
      providerRoute: {
        providerId: "opencode",
        model: "minimax-m2.5",
      },
      managedInvocationEvidence: {
        lifecycle: {
          resourceLease: {
            leaseId: "lease-conflict",
            createdAt: "2026-05-23T12:00:00.000Z",
            healthStatus: "stale",
            cleanupStatus: "not-required",
            workingDirectoryPath: "C:/work/kiln",
            workingDirectoryMode: "workspace-write",
            resourceUris: ["kiln://managed-agent/child-blocked/conflict-resource"],
            diagnosticUris: ["kiln://managed-agent/child-blocked/conflict-diagnostic"],
            worktreeConflict: {
              status: "blocked",
              reason: "same-checkout-write-conflict",
              requestedInvocationId: "child-blocked",
              conflictingInvocationId: "child-active",
              workingDirectoryPath: "C:/work/kiln",
              workingDirectoryMode: "workspace-write",
              policyId: "managed-agent.worktree.single-active-writer",
              retryAfterInvocationIds: ["child-active"],
              resourceUris: ["kiln://managed-agent/child-blocked/conflict-resource"],
              diagnosticUris: ["kiln://managed-agent/child-blocked/conflict-diagnostic"],
            },
          },
        },
      },
    });

    const viewState = projectTuiManagedAgentViewState(appendManagedAgentSessionEvent([], failed));

    expect(viewState.items[0]).toMatchObject({
      managedInvocationId: "child-blocked",
      attentionState: "needs_review",
      dirtyWorkspaceReviewRequired: false,
      worktreeConflictBlocked: true,
      worktreeConflict: {
        status: "blocked",
        reason: "same-checkout-write-conflict",
        conflictingInvocationId: "child-active",
        retryAfterInvocationIds: ["child-active"],
      },
      resourceUris: expect.arrayContaining([
        "kiln://managed-agent/child-blocked/conflict-resource",
        "kiln://managed-agent/child-blocked/conflict-diagnostic",
      ]),
    });
    expect(formatManagedAgentCockpitLines(viewState)).toEqual(expect.arrayContaining([
      "! child-blocked needs_review failed opencode/minimax-m2.5 conflict:blocked events:1 resources:2",
      "  conflict same-checkout-write-conflict requested:child-blocked conflicting:child-active",
      "  retry-after child-active",
      "  conflict-res kiln://managed-agent/child-blocked/conflict-resource",
      "  conflict-diag kiln://managed-agent/child-blocked/conflict-diagnostic",
    ]));
    expect(formatManagedAgentCockpitLines(viewState)).not.toEqual(expect.arrayContaining([
      "  res kiln://managed-agent/child-blocked/conflict-resource",
      "  res kiln://managed-agent/child-blocked/conflict-diagnostic",
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
      parentTurnId: "session-1:turn:1",
      childSessionId: "child-timeout-session",
      childTurnId: "child-timeout-turn",
      routeSource: "explicit-managed-route",
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
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
      parentTurnId: "session-1:turn:1",
      childSessionId: "child-timeout-session",
      childTurnId: "child-timeout-turn",
      routeSource: "explicit-managed-route",
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      resourceUris: [
        "kiln://managed-agent/child-timeout/handoff",
        "kiln://managed-agent/child-timeout/timeout",
      ],
    });
    expect(formatManagedAgentCockpitLines(viewState)).toEqual(expect.arrayContaining([
      "attention: 1  active: 0",
      "! child-timeout timed_out failed codex-oauth/gpt-5.5 events:1 resources:2",
      "  lineage parent:session-1:turn:1 child-session:child-timeout-session child-turn:child-timeout-turn",
      "  route-source explicit-managed-route timeout 120000ms source:explicit-route",
      "  res kiln://managed-agent/child-timeout/handoff",
      "  res kiln://managed-agent/child-timeout/timeout",
      "drilldown child-timeout",
      "  lifecycle timed_out",
      "  timeline:",
      "    1 agent_invocation_failed evt-timeout",
    ]));
  });

  it("formats managed invocation recovery as an actionable next work-item step", () => {
    const failed = event("evt-recovery", 1, "agent_invocation_failed", {
      invocationId: "child-recovery",
      lifecycleState: "timed_out",
      managedInvocationRecovery: {
        status: "phase_evidence_required",
        reason: "Child produced partial research evidence before timeout.",
        nextTool: "work_item.update",
        thenTool: "work_item.execution.start",
        workItemId: "work-42",
        evidenceToRecord: ["source-map", "risk-hypothesis"],
        requiredToolNames: ["resource_read"],
        sourceResourceUris: ["kiln://managed-agent/child-recovery/handoff"],
      },
    });

    const lines = formatManagedAgentCockpitLines(projectTuiManagedAgentViewState(
      appendManagedAgentSessionEvent([], failed),
    ));

    expect(lines).toEqual(expect.arrayContaining([
      "! child-recovery needs_review failed events:1 resources:1",
      "  next work_item.update -> work_item.execution.start work:work-42",
      "  reason Child produced partial research evidence before timeout.",
      "  evidence source-map,risk-hypothesis",
      "  tools resource_read",
      "  source kiln://managed-agent/child-recovery/handoff",
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
    expect(EMPTY_TUI_OPERATOR_WORKSPACE_HOME.managedAgents).toEqual({
      totalCount: 0,
      activeCount: 0,
      attentionCount: 0,
    });
  });

  it("projects and renders managed_economic_lifecycle events as their own section, not nested under an invocation", () => {
    const held = event("evt-economic-held", 1, "managed_economic_lifecycle", {
      instanceId: "local-tui",
      sessionId: "session-1",
      evidenceVersion: 1,
      jobId: "managed-economic-job:tui-fixture",
      economicAttemptId: "economic-attempt:tui-fixture:1",
      transition: "held",
      policyId: "tui-fixture-policy",
      policyRevision: "1",
      policyDigest: "sha256:tui-fixture-policy-digest",
      selectedRoute: {
        routeId: "tui-fixture-route",
        providerId: "codex-oauth",
        modelId: "gpt-test",
        adapterCapabilityId: "tui-fixture-adapter",
        adapterCapabilityVersion: "1",
      },
      selectedTarget: {
        targetId: "tui-fixture-route",
        providerId: "codex-oauth",
        modelId: "gpt-test",
        reason: "only-admitted-target",
      },
      billingClass: "metered",
      providerAllowance: { status: "available", evidenceFreshness: "fresh" },
      workLimitProgress: { dimension: "turns", consumed: 2, limit: 4, status: "within-limit" },
      reservedAmount: { atoms: "25", scale: 2, unit: "request", scheme: { kind: "currency", currency: "USD" } },
      settledAmount: { atoms: "12", scale: 2, unit: "request", scheme: { kind: "currency", currency: "USD" } },
      perChildConsumption: [{ childId: "child-tui", comparability: "comparable" }],
      evidenceFreshness: "fresh",
      terminalCause: "completed",
    });

    const events = appendManagedAgentSessionEvent([], held);
    const workspaceState = projectTuiOperatorWorkspaceState(events);

    expect(workspaceState.cockpitView.economicAttempts).toHaveLength(1);
    expect(workspaceState.cockpitView.economicAttempts[0]).toMatchObject({
      jobId: "managed-economic-job:tui-fixture",
      transition: "held",
    });
    expect(workspaceState.cockpitView.managedAgents.items).toHaveLength(0);

    const lines = formatManagedAgentCockpitLines(
      workspaceState.cockpitView.managedAgents,
      workspaceState.cockpitView.economicAttempts,
    );
    expect(lines).toEqual(expect.arrayContaining([
      "economic attempts:",
    ]));
    const economicLine = lines.find((line) => line.includes("managed-economic-job:tui-fixture"))!;
    expect(economicLine).toContain("target:tui-fixture-route(only-admitted-target)");
    expect(economicLine).toContain("billing:metered");
    expect(economicLine).toContain("allowance:available/fresh");
    expect(economicLine).toContain("work:turns=2/4");
    expect(economicLine).toContain("reserved:25e-2 request USD");
    expect(economicLine).toContain("settled:12e-2 request USD");
    expect(economicLine).toContain("children:child-tui[none]");
    expect(economicLine).toContain("evidence:fresh");
    expect(economicLine).toContain("terminal:completed");
  });

  it("reports unprojectable evidence so a degraded cockpit cannot read as a complete one", () => {
    const malformed = event("evt-economic-malformed", 1, "managed_economic_lifecycle", {
      instanceId: "local-tui",
      sessionId: "session-1",
      evidenceVersion: 1,
      jobId: "managed-economic-job:tui-fixture",
      economicAttemptId: "economic-attempt:tui-fixture:1",
      transition: "not-a-real-transition",
      policyId: "tui-fixture-policy",
      policyRevision: "1",
      policyDigest: "sha256:tui-fixture-policy-digest",
    });

    const events = appendManagedAgentSessionEvent([], malformed);
    const workspaceState = projectTuiOperatorWorkspaceState(events);

    expect(workspaceState.cockpitView.economicAttempts).toHaveLength(0);
    expect(workspaceState.cockpitView.unprojectableEvidence).toEqual([{
      eventId: "evt-economic-malformed",
      sequence: 1,
      kind: "managed_economic_lifecycle",
      reason: "invalid-discriminator",
      field: "transition",
    }]);

    const lines = formatManagedAgentCockpitLines(
      workspaceState.cockpitView.managedAgents,
      workspaceState.cockpitView.economicAttempts,
      workspaceState.cockpitView.unprojectableEvidence,
    );
    expect(lines).toEqual(expect.arrayContaining([
      "unprojectable evidence (1) - view incomplete:",
      "managed_economic_lifecycle  invalid-discriminator  transition",
    ]));
  });

  it("renders no unprojectable section when every event projects", () => {
    const lines = formatManagedAgentCockpitLines(
      projectTuiOperatorWorkspaceState([]).cockpitView.managedAgents,
    );
    expect(lines.some((line) => line.includes("unprojectable"))).toBe(false);
  });

  it("renders the shared economic lifecycle stages and its degraded evidence", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-08-08T12:01:00.000Z",
      attachTargets: [{ instanceId: MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.instanceId, label: "Synthetic", kind: "local" }],
      events: [...managedEconomicLifecycleEvents, ...managedEconomicLifecycleUnprojectableEvents],
    });
    const view = createOperatorCockpitReadOnlyViewState({ projection, viewState: {} });
    const lines = formatManagedAgentCockpitLines(view.managedAgents, view.economicAttempts, view.unprojectableEvidence);

    expect(view.economicAttempts.find((attempt) => attempt.jobId === MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.jobId)?.rejections)
      .toEqual(expect.arrayContaining([expect.objectContaining({ stage: "economic-selection" })]));
    expect(view.unprojectableEvidence).toHaveLength(4);
    expect(lines.join("\n")).toContain("rejection:economic-selection:ceiling-exceeded");
    expect(lines.join("\n")).toContain("unprojectable evidence (4) - view incomplete:");
  });
});
