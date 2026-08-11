import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ManagedAgentCockpitPanel } from "../src/components/managed-agent-cockpit-panel.js";
import {
  createOperatorCockpitReadOnlyViewState,
  projectOperatorCockpitReadOnlyView,
  type OperatorCockpitManagedAgentViewState,
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

describe("ManagedAgentCockpitPanel", () => {
  it("renders canonical managed account lease evidence", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T12:01:00.000Z",
      attachTargets: [{
        instanceId: MANAGED_ACCOUNT_LEASE_FIXTURE.instanceId,
        label: "Synthetic account lease",
        kind: "local",
      }],
      events: managedAccountLeaseEvents,
    });
    const viewState = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {},
    }).managedAgents;

    render(<ManagedAgentCockpitPanel viewState={viewState} />);

    expect(screen.getByText(`account ${MANAGED_ACCOUNT_LEASE_FIXTURE.accountRef}`)).toBeVisible();
    expect(screen.getByText(`account lease ${MANAGED_ACCOUNT_LEASE_FIXTURE.lifecycleState}`)).toBeVisible();
  });

  it("renders canonical external-runtime attachment and redacted failure evidence", () => {
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

    render(<ManagedAgentCockpitPanel viewState={viewState} />);

    expect(screen.getAllByText("External runtime evidence")).toHaveLength(2);
    expect(screen.getAllByText(
      `${EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.attachment.runtimeId} / ${EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.attachment.attachmentId}`,
    )).toHaveLength(2);
    expect(screen.getAllByText(/External runtime navigation failed after redaction/u)).not.toHaveLength(0);
  });

  it("renders shared managed-child view state with review and active controls", () => {
    const onOpenResource = vi.fn();
    const viewState: OperatorCockpitManagedAgentViewState = {
      activeCount: 1,
      attentionCount: 2,
      items: [
        {
          managedInvocationId: "child-review",
          instanceId: "local",
          sessionId: "session-1",
          status: "completed",
          lifecycleState: "completed",
          providerRoute: "codex-oauth/gpt-5.5",
          attentionState: "needs_review",
          dirtyWorkspaceReviewRequired: true,
          transcriptUri: "kiln://managed-agents/child-review/transcript",
          resourceUris: [
            "kiln://managed-agents/child-review/handoff",
            "kiln://managed-agents/child-review/review",
          ],
          latestEventId: "event-review",
          lifecycleTimeline: [
            {
              eventId: "event-review",
              instanceId: "local",
              sessionId: "session-1",
              sequence: 2,
              timestamp: "2026-05-23T12:01:00.000Z",
              kind: "agent_invocation_completed",
              title: "Agent invocation completed",
              summary: "Review required.",
              tone: "success",
              target: {
                instanceId: "local",
                sessionId: "session-1",
                eventId: "event-review",
                managedInvocationId: "child-review",
              },
            },
          ],
          cancelControl: {
            status: "unavailable",
            reason: "Managed invocation is not active.",
          },
        },
        {
          managedInvocationId: "child-running",
          gatewayTargetId: "gateway:local-app",
          instanceId: "local",
          sessionId: "session-1",
          status: "running",
          lifecycleState: "running",
          providerRoute: "codex-oauth/gpt-5.5",
          attentionState: "active",
          dirtyWorkspaceReviewRequired: false,
          resourceUris: [],
          latestEventId: "event-running",
          lifecycleTimeline: [
            {
              eventId: "event-running",
              instanceId: "local",
              sessionId: "session-1",
              sequence: 1,
              timestamp: "2026-05-23T12:00:00.000Z",
              kind: "agent_invocation_started",
              title: "Agent invocation started",
              tone: "running",
              target: {
                instanceId: "local",
                sessionId: "session-1",
                eventId: "event-running",
                managedInvocationId: "child-running",
              },
            },
          ],
          cancelControl: {
            status: "requires-control-channel",
            reason: "Read-only cockpit projection cannot dispatch cancellation.",
          },
        },
      ],
    };

    render(
      <ManagedAgentCockpitPanel
        viewState={viewState}
        onOpenResource={onOpenResource}
        actionFailure={{
          action: "cancel",
          invocationId: "child-running",
          message: "The child already exited.",
        }}
      />,
    );

    expect(screen.getByLabelText("Managed agents")).toHaveTextContent("2 attention");
    expect(screen.getByLabelText("Managed agents")).toHaveTextContent("1 active");
    expect(screen.getByText("child-review")).toBeVisible();
    expect(screen.getByText("Review required")).toBeVisible();
    expect(screen.getByText("Dirty worktree preserved")).toBeVisible();
    expect(screen.getByText("child-running")).toBeVisible();
    expect(screen.getByText("Cancel requires control channel")).toBeDisabled();
    expect(screen.getByText("event-running")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("The child already exited.");

    fireEvent.click(screen.getByText("Transcript"));
    fireEvent.click(screen.getByText("handoff"));

    expect(onOpenResource).toHaveBeenNthCalledWith(1, "kiln://managed-agents/child-review/transcript", {
      instanceId: "local",
      sessionId: "session-1",
      managedInvocationId: "child-review",
      resourceUri: "kiln://managed-agents/child-review/transcript",
    });
    expect(onOpenResource).toHaveBeenNthCalledWith(2, "kiln://managed-agents/child-review/handoff", {
      instanceId: "local",
      sessionId: "session-1",
      managedInvocationId: "child-review",
      resourceUri: "kiln://managed-agents/child-review/handoff",
    });
  });

  it("renders an empty read-only state without controls", () => {
    render(<ManagedAgentCockpitPanel viewState={{ activeCount: 0, attentionCount: 0, items: [] }} />);

    expect(screen.getByLabelText("Managed agents")).toHaveTextContent("No managed children in the current session");
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("renders worktree conflict evidence without dirty-worktree copy", () => {
    const onOpenResource = vi.fn();
    const viewState: OperatorCockpitManagedAgentViewState = {
      activeCount: 0,
      attentionCount: 1,
      items: [
        {
          managedInvocationId: "child-blocked",
          instanceId: "local",
          sessionId: "session-1",
          status: "failed",
          lifecycleState: "failed",
          providerRoute: "opencode/minimax-m2.5",
          attentionState: "needs_review",
          dirtyWorkspaceReviewRequired: false,
          worktreeConflictBlocked: true,
          worktreeConflict: {
            status: "blocked",
            reason: "same-checkout-write-conflict",
            requestedInvocationId: "child-blocked",
            conflictingInvocationId: "child-active",
            workingDirectoryPath: "C:/work/kiln",
            workingDirectoryMode: "workspace-write",
            policyId: "managed-agent.worktree.single-active-writer",
            retryAfterInvocationIds: ["child-active"],
            resourceUris: ["kiln://managed-agents/child-blocked/conflict-resource"],
            diagnosticUris: ["kiln://managed-agents/child-blocked/conflict-diagnostic"],
          },
          resourceUris: [
            "kiln://managed-agents/child-blocked/conflict-resource",
            "kiln://managed-agents/child-blocked/conflict-diagnostic",
          ],
          latestEventId: "event-conflict",
          lifecycleTimeline: [
            {
              eventId: "event-conflict",
              instanceId: "local",
              sessionId: "session-1",
              sequence: 1,
              timestamp: "2026-05-24T12:00:00.000Z",
              kind: "agent_invocation_failed",
              title: "Agent invocation failed",
              summary: "Managed child write conflict.",
              tone: "danger",
              target: {
                instanceId: "local",
                sessionId: "session-1",
                eventId: "event-conflict",
                managedInvocationId: "child-blocked",
              },
            },
          ],
          cancelControl: {
            status: "unavailable",
            reason: "Managed invocation is not active.",
          },
        },
      ],
    };

    render(<ManagedAgentCockpitPanel viewState={viewState} onOpenResource={onOpenResource} />);

    expect(screen.getByText("child-blocked")).toBeVisible();
    expect(screen.getByText("Review required")).toBeVisible();
    expect(screen.getByText("Worktree conflict")).toBeVisible();
    expect(screen.getByText("status blocked")).toBeVisible();
    expect(screen.getByText("same-checkout-write-conflict")).toBeVisible();
    expect(screen.getByText("requested child-blocked")).toBeVisible();
    expect(screen.getByText("conflicting child-active")).toBeVisible();
    expect(screen.getByText("retry after child-active")).toBeVisible();
    expect(screen.queryByText("Dirty worktree preserved")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("conflict resource"));
    fireEvent.click(screen.getByText("conflict diagnostic"));

    expect(onOpenResource).toHaveBeenNthCalledWith(1, "kiln://managed-agents/child-blocked/conflict-resource", {
      instanceId: "local",
      sessionId: "session-1",
      managedInvocationId: "child-blocked",
      resourceUri: "kiln://managed-agents/child-blocked/conflict-resource",
    });
    expect(onOpenResource).toHaveBeenNthCalledWith(2, "kiln://managed-agents/child-blocked/conflict-diagnostic", {
      instanceId: "local",
      sessionId: "session-1",
      managedInvocationId: "child-blocked",
      resourceUri: "kiln://managed-agents/child-blocked/conflict-diagnostic",
    });
  });

  it("renders managed invocation recovery as an actionable next work-item step", () => {
    const viewState: OperatorCockpitManagedAgentViewState = {
      activeCount: 0,
      attentionCount: 1,
      items: [
        {
          managedInvocationId: "child-recovery",
          instanceId: "local",
          sessionId: "session-1",
          status: "failed",
          lifecycleState: "timed_out",
          attentionState: "needs_review",
          dirtyWorkspaceReviewRequired: false,
          worktreeConflictBlocked: false,
          managedInvocationRecovery: {
            status: "phase_evidence_required",
            reason: "Child produced partial research evidence before timeout.",
            nextTool: "work_item.update",
            thenTool: "work_item.execution.start",
            workItemId: "work-42",
            evidenceToRecord: ["source-map", "risk-hypothesis"],
            requiredToolNames: ["resource_read"],
            sourceResourceUris: ["kiln://managed-agents/child-recovery/resources/handoff"],
          },
          resourceUris: ["kiln://managed-agents/child-recovery/resources/handoff"],
          latestEventId: "event-recovery",
          lifecycleTimeline: [],
          cancelControl: {
            status: "unavailable",
            reason: "Managed invocation is not active.",
          },
        },
      ],
    };

    render(<ManagedAgentCockpitPanel viewState={viewState} />);

    expect(screen.getByText("Next governed action")).toBeVisible();
    expect(screen.getByText("work_item.update -> work_item.execution.start")).toBeVisible();
    expect(screen.getByText("work work-42")).toBeVisible();
    expect(screen.getByText("Child produced partial research evidence before timeout.")).toBeVisible();
    expect(screen.getByText("evidence source-map, risk-hypothesis")).toBeVisible();
    expect(screen.getByText("tools resource_read")).toBeVisible();
    expect(screen.getByText("source kiln://managed-agents/child-recovery/resources/handoff")).toBeVisible();
  });

  it("renders timed-out managed children as distinct attention", () => {
    const viewState: OperatorCockpitManagedAgentViewState = {
      activeCount: 0,
      attentionCount: 1,
      items: [
        {
          managedInvocationId: "child-timeout",
          instanceId: "local",
          sessionId: "session-1",
          status: "failed",
          lifecycleState: "timed_out",
          parentTurnId: "session-1:turn:1",
          childSessionId: "child-timeout-session",
          childTurnId: "child-timeout-turn",
          providerRoute: "codex-oauth/gpt-5.5",
          routeSource: "explicit-managed-route",
          timeoutMs: 120000,
          timeoutSource: "explicit-route",
          attentionState: "timed_out",
          dirtyWorkspaceReviewRequired: false,
          worktreeConflictBlocked: false,
          resourceUris: ["kiln://managed-agents/child-timeout/timeout"],
          latestEventId: "event-timeout",
          lifecycleTimeline: [
            {
              eventId: "event-timeout",
              instanceId: "local",
              sessionId: "session-1",
              sequence: 1,
              timestamp: "2026-05-24T12:00:00.000Z",
              kind: "agent_invocation_failed",
              title: "Agent invocation failed",
              summary: "Managed child timed out.",
              tone: "danger",
              target: {
                instanceId: "local",
                sessionId: "session-1",
                eventId: "event-timeout",
                managedInvocationId: "child-timeout",
              },
            },
          ],
          cancelControl: {
            status: "unavailable",
            reason: "Managed invocation is not active.",
          },
        },
      ],
    };

    render(<ManagedAgentCockpitPanel viewState={viewState} />);

    expect(screen.getByLabelText("Managed agents")).toHaveTextContent("1 attention");
    expect(screen.getByText("child-timeout")).toBeVisible();
    expect(screen.getByText("Timed out")).toBeVisible();
    expect(screen.getByText("failed")).toBeVisible();
    expect(screen.getByText("lifecycle timed_out")).toBeVisible();
    expect(screen.getByText("route source explicit-managed-route")).toBeVisible();
    expect(screen.getByText("parent turn session-1:turn:1")).toBeVisible();
    expect(screen.getByText("child session child-timeout-session")).toBeVisible();
    expect(screen.getByText("child turn child-timeout-turn")).toBeVisible();
    expect(screen.getByText("timeout 120000ms explicit-route")).toBeVisible();
    expect(screen.getByText("Cancel unavailable")).toBeDisabled();
    expect(screen.getByText("timeout")).toBeVisible();
  });

  it("renders stale heartbeat managed children as distinct terminal attention", () => {
    const viewState: OperatorCockpitManagedAgentViewState = {
      activeCount: 0,
      attentionCount: 1,
      items: [
        {
          managedInvocationId: "child-stale",
          instanceId: "local",
          sessionId: "session-1",
          status: "failed",
          lifecycleState: "stale",
          providerRoute: "opencode/minimax-m2.5",
          attentionState: "stale",
          dirtyWorkspaceReviewRequired: false,
          worktreeConflictBlocked: false,
          resourceUris: ["kiln://managed-agents/child-stale/heartbeat"],
          latestEventId: "event-stale",
          lifecycleTimeline: [
            {
              eventId: "event-stale",
              instanceId: "local",
              sessionId: "session-1",
              sequence: 1,
              timestamp: "2026-05-24T12:00:00.000Z",
              kind: "agent_invocation_failed",
              title: "Agent invocation failed",
              summary: "Managed invocation heartbeat expired.",
              tone: "danger",
              target: {
                instanceId: "local",
                sessionId: "session-1",
                eventId: "event-stale",
                managedInvocationId: "child-stale",
              },
            },
          ],
          cancelControl: {
            status: "unavailable",
            reason: "Managed invocation is not active.",
          },
        },
      ],
    };

    render(<ManagedAgentCockpitPanel viewState={viewState} />);

    expect(screen.getByText("child-stale")).toBeVisible();
    expect(screen.getByText("Stale heartbeat")).toBeVisible();
    expect(screen.getByText("failed")).toBeVisible();
    expect(screen.getByText("lifecycle stale")).toBeVisible();
    expect(screen.getByText("heartbeat")).toBeVisible();
  });

  it("renders ordinary adapter failure as failed managed-child attention", () => {
    const onOpenResource = vi.fn();
    const viewState: OperatorCockpitManagedAgentViewState = {
      activeCount: 0,
      attentionCount: 1,
      items: [
        {
          managedInvocationId: "child-failed",
          instanceId: "local",
          sessionId: "session-1",
          status: "failed",
          lifecycleState: "failed",
          providerRoute: "codex-oauth/gpt-5.5",
          attentionState: "failed",
          dirtyWorkspaceReviewRequired: false,
          worktreeConflictBlocked: false,
          resourceUris: [
            "kiln://managed-agents/child-failed/failure",
            "kiln://managed-agents/child-failed/handoff",
          ],
          latestEventId: "event-failed",
          lifecycleTimeline: [
            {
              eventId: "event-failed",
              instanceId: "local",
              sessionId: "session-1",
              sequence: 1,
              timestamp: "2026-05-24T12:00:00.000Z",
              kind: "agent_invocation_failed",
              title: "Agent invocation failed",
              compactText: "codex-oauth/gpt-5.5 · Managed child adapter failed before handoff.",
              tone: "error",
              target: {
                instanceId: "local",
                sessionId: "session-1",
                eventId: "event-failed",
                managedInvocationId: "child-failed",
              },
            },
          ],
          cancelControl: {
            status: "unavailable",
            reason: "Managed invocation is not active.",
          },
        },
      ],
    };

    render(<ManagedAgentCockpitPanel viewState={viewState} onOpenResource={onOpenResource} />);

    expect(screen.getByLabelText("Managed agents")).toHaveTextContent("1 attention");
    expect(screen.getByText("child-failed")).toBeVisible();
    expect(screen.getByText("Failed")).toBeVisible();
    expect(screen.getByText("failed")).toBeVisible();
    expect(screen.getByText("lifecycle failed")).toBeVisible();
    expect(screen.getByText("Cancel unavailable")).toBeDisabled();
    expect(screen.getByText("Agent invocation failed: codex-oauth/gpt-5.5 · Managed child adapter failed before handoff.")).toBeVisible();

    fireEvent.click(screen.getByText("failure"));
    fireEvent.click(screen.getByText("handoff"));

    expect(onOpenResource).toHaveBeenNthCalledWith(1, "kiln://managed-agents/child-failed/failure", {
      instanceId: "local",
      sessionId: "session-1",
      managedInvocationId: "child-failed",
      resourceUri: "kiln://managed-agents/child-failed/failure",
    });
    expect(onOpenResource).toHaveBeenNthCalledWith(2, "kiln://managed-agents/child-failed/handoff", {
      instanceId: "local",
      sessionId: "session-1",
      managedInvocationId: "child-failed",
      resourceUri: "kiln://managed-agents/child-failed/handoff",
    });
  });

  it("dispatches live cancel when a control channel callback is present", () => {
    const onCancel = vi.fn();
    const viewState: OperatorCockpitManagedAgentViewState = {
      activeCount: 1,
      attentionCount: 1,
      items: [
        {
          managedInvocationId: "child-running",
          gatewayTargetId: "gateway:local-app",
          instanceId: "local",
          sessionId: "session-1",
          status: "running",
          lifecycleState: "running",
          attentionState: "active",
          dirtyWorkspaceReviewRequired: false,
          resourceUris: [],
          latestEventId: "event-running",
          lifecycleTimeline: [],
          cancelControl: {
            status: "requires-control-channel",
            reason: "Read-only cockpit projection cannot dispatch cancellation.",
          },
        },
      ],
    };

    render(<ManagedAgentCockpitPanel viewState={viewState} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel managed child child-running" }));

    expect(onCancel).toHaveBeenCalledWith({
      sessionId: "session-1",
      invocationId: "child-running",
      gatewayTargetId: "gateway:local-app",
    });
  });

  it("dispatches prompt follow-ups with explicit queued delivery semantics", () => {
    const onPrompt = vi.fn();
    const viewState: OperatorCockpitManagedAgentViewState = {
      activeCount: 1,
      attentionCount: 1,
      items: [
        {
          managedInvocationId: "child-running",
          gatewayTargetId: "gateway:local-app",
          instanceId: "local",
          sessionId: "session-1",
          status: "running",
          lifecycleState: "running",
          attentionState: "active",
          dirtyWorkspaceReviewRequired: false,
          resourceUris: [],
          latestEventId: "event-running",
          lifecycleTimeline: [],
          cancelControl: {
            status: "requires-control-channel",
            reason: "Read-only cockpit projection cannot dispatch cancellation.",
          },
        },
      ],
    };

    render(<ManagedAgentCockpitPanel viewState={viewState} onPrompt={onPrompt} />);

    fireEvent.change(screen.getByLabelText("Prompt managed child child-running"), {
      target: { value: "Continue from the latest runtime ledger evidence." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Queue prompt delivery for child-running" }));
    fireEvent.click(screen.getByRole("button", { name: "Send prompt to managed child child-running" }));

    expect(onPrompt).toHaveBeenCalledWith({
      sessionId: "session-1",
      invocationId: "child-running",
      gatewayTargetId: "gateway:local-app",
      prompt: "Continue from the latest runtime ledger evidence.",
      deliveryMode: "queue",
      wakeRequested: false,
    });
  });

  it("renders economic attempts as their own section, not nested under an invocation", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-08-06T12:01:00.000Z",
      attachTargets: [{
        instanceId: "gui-economic:instance:1",
        label: "Synthetic economic runtime",
        kind: "local",
      }],
      events: [{
        eventId: "gui-economic:event:1",
        kilnSessionId: "gui-economic:session:1",
        sequence: 1,
        timestamp: "2026-08-06T12:00:00.000Z",
        kind: "managed_economic_lifecycle",
        payload: {
          instanceId: "gui-economic:instance:1",
          sessionId: "gui-economic:session:1",
          evidenceVersion: 1,
          jobId: "managed-economic-job:gui-fixture",
          economicAttemptId: "economic-attempt:gui-fixture:1",
          transition: "held",
          policyId: "gui-fixture-policy",
          policyRevision: "1",
          policyDigest: "sha256:gui-fixture-policy-digest",
          selectedRoute: {
            routeId: "gui-fixture-route",
            providerId: "codex-oauth",
            modelId: "gpt-test",
            adapterCapabilityId: "gui-fixture-adapter",
            adapterCapabilityVersion: "1",
          },
        },
      }],
    });
    const view = createOperatorCockpitReadOnlyViewState({ projection, viewState: {} });

    render(<ManagedAgentCockpitPanel viewState={view.managedAgents} economicAttempts={view.economicAttempts} />);

    expect(screen.getByText("Economic attempts")).toBeVisible();
    expect(screen.getByText("managed-economic-job:gui-fixture")).toBeVisible();
    expect(screen.getByText("held")).toBeVisible();
    expect(screen.getByText("route codex-oauth/gpt-test")).toBeVisible();
    expect(view.managedAgents.items).toHaveLength(0);
    expect(screen.queryByLabelText("Unprojectable evidence")).toBeNull();
  });

  it("surfaces unprojectable evidence so a degraded panel cannot read as a complete one", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-08-06T12:01:00.000Z",
      attachTargets: [{
        instanceId: "gui-economic:instance:1",
        label: "Synthetic economic runtime",
        kind: "local",
      }],
      events: [{
        eventId: "gui-economic:event:malformed",
        kilnSessionId: "gui-economic:session:1",
        sequence: 1,
        timestamp: "2026-08-06T12:00:00.000Z",
        kind: "managed_economic_lifecycle",
        payload: {
          instanceId: "gui-economic:instance:1",
          sessionId: "gui-economic:session:1",
          evidenceVersion: 1,
          jobId: "managed-economic-job:gui-fixture",
          economicAttemptId: "economic-attempt:gui-fixture:1",
          transition: "not-a-real-transition",
          policyId: "gui-fixture-policy",
          policyRevision: "1",
          policyDigest: "sha256:gui-fixture-policy-digest",
        },
      }],
    });
    const view = createOperatorCockpitReadOnlyViewState({ projection, viewState: {} });

    render(
      <ManagedAgentCockpitPanel
        viewState={view.managedAgents}
        economicAttempts={view.economicAttempts}
        unprojectableEvidence={view.unprojectableEvidence}
      />,
    );

    expect(view.economicAttempts).toHaveLength(0);
    expect(screen.getByLabelText("Unprojectable evidence")).toBeVisible();
    expect(screen.getByText("Unprojectable evidence (1) — view incomplete")).toBeVisible();
    expect(screen.getByText(/invalid-discriminator/)).toBeVisible();
    expect(screen.queryByText("Economic attempts")).toBeNull();
    expect(document.body.textContent).not.toContain("not-a-real-transition");
  });

  it("renders shared staged rejection evidence and degraded lifecycle evidence", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-08-08T12:01:00.000Z",
      attachTargets: [{ instanceId: MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.instanceId, label: "Synthetic", kind: "local" }],
      events: [...managedEconomicLifecycleEvents, ...managedEconomicLifecycleUnprojectableEvents],
    });
    const view = createOperatorCockpitReadOnlyViewState({ projection, viewState: {} });
    render(
      <ManagedAgentCockpitPanel
        viewState={view.managedAgents}
        economicAttempts={view.economicAttempts}
        unprojectableEvidence={view.unprojectableEvidence}
      />,
    );

    expect(screen.getByText("rejection economic-selection: ceiling-exceeded")).toBeVisible();
    expect(screen.getByLabelText("Unprojectable evidence")).toBeVisible();
    expect(document.body.textContent).not.toContain("secret-account-shaped-value");
  });
});
