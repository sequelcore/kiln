import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OperatorSessionEvent } from "@kilnai/gateway-contracts";
import {
  createNativeCockpitReadOnlyProjection,
  createNativeCockpitReadOnlyViewState,
} from "../src/shared/native-cockpit-contract.js";
import { ManagedAgentCockpitPanel } from "../src/renderer/managed-agent-cockpit-panel.js";

function managedEvent(
  eventId: string,
  sequence: number,
  kind: OperatorSessionEvent["kind"],
  payload: Record<string, unknown>,
): OperatorSessionEvent {
  return {
    eventId,
    kilnSessionId: "session-1",
    sequence,
    timestamp: `2026-05-23T12:00:0${sequence}.000Z`,
    kind,
    turnId: "session-1:turn:live",
    payload: {
      instanceId: "native-local",
      sessionId: "session-1",
      ...payload,
    },
  };
}

describe("native managed-agent cockpit panel", () => {
  it("renders active and review child state from shared read-only cockpit view-state", () => {
    const projection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "native-local",
          label: "Local native",
          kind: "local",
        },
      ],
      events: [
        managedEvent("evt-running", 1, "agent_invocation_started", {
          managedInvocationId: "child-running",
          providerRoute: {
            providerId: "codex-oauth",
            model: "gpt-5.5",
          },
          lifecycleState: "running",
        }),
        managedEvent("evt-review", 2, "agent_invocation_completed", {
          managedInvocationId: "child-review",
          providerRoute: {
            providerId: "opencode-go",
            model: "minimax-m2.5",
          },
          lifecycleState: "completed",
          capabilitySnapshot: {
            resourceLease: {
              leaseId: "lease-1",
              createdAt: "2026-05-23T12:00:00.000Z",
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
            resultHandoff: {
              summary: "Review required before adoption.",
              resourceUris: ["kiln://managed-agent/child-review/handoff"],
              memoryWriteProposalUris: [],
            },
          },
        }),
      ],
    });
    const cockpit = createNativeCockpitReadOnlyViewState({
      surfaceId: "native:local",
      projection: projection.view,
      viewState: {},
    });

    const markup = renderToStaticMarkup(<ManagedAgentCockpitPanel cockpit={cockpit} />);

    expect(markup).toContain("Managed Agents");
    expect(markup).toContain("<dd>2</dd>");
    expect(markup).toContain("child-running");
    expect(markup).toContain("active");
    expect(markup).toContain("requires-control-channel");
    expect(markup).toContain("child-review");
    expect(markup).toContain("needs_review");
    expect(markup).toContain("dirty worktree");
    expect(markup).toContain("kiln://managed-agent/child-review/transcript");
    expect(markup).toContain("kiln://managed-agent/child-review/diff");
    expect(markup).toContain("agent_invocation_completed");
    expect(markup).toContain("Cancel disabled");
    expect(markup).toContain("disabled");
  });

  it("renders an empty read-only native state without synthetic child data", () => {
    const projection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "native-local",
          label: "Local native",
          kind: "local",
        },
      ],
      events: [
        {
          eventId: "evt-turn",
          kilnSessionId: "session-1",
          sequence: 1,
          timestamp: "2026-05-23T12:00:00.000Z",
          kind: "turn_started",
          payload: {
            instanceId: "native-local",
            sessionId: "session-1",
          },
        },
      ],
    });
    const cockpit = createNativeCockpitReadOnlyViewState({
      surfaceId: "native:local",
      projection: projection.view,
      viewState: {},
    });

    const markup = renderToStaticMarkup(<ManagedAgentCockpitPanel cockpit={cockpit} />);

    expect(markup).toContain("No managed child invocations are visible.");
    expect(markup).toContain("<dd>0</dd>");
    expect(markup).not.toContain("child-");
  });

  it("renders timed-out managed child attention from shared view-state", () => {
    const projection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-24T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "native-local",
          label: "Local native",
          kind: "local",
        },
      ],
      events: [
        managedEvent("evt-timeout", 1, "agent_invocation_failed", {
          managedInvocationId: "child-timeout",
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
        }),
      ],
    });
    const cockpit = createNativeCockpitReadOnlyViewState({
      surfaceId: "native:local",
      projection: projection.view,
      viewState: {},
    });

    const markup = renderToStaticMarkup(<ManagedAgentCockpitPanel cockpit={cockpit} />);

    expect(markup).toContain("<dd>1</dd>");
    expect(markup).toContain("child-timeout");
    expect(markup).toContain("data-attention=\"timed_out\"");
    expect(markup).toContain("timed_out");
    expect(markup).toContain("failed");
    expect(markup).toContain("unavailable");
    expect(markup).toContain("kiln://managed-agent/child-timeout/handoff");
    expect(markup).toContain("kiln://managed-agent/child-timeout/timeout");
    expect(markup).toContain("agent_invocation_failed");
  });

  it("renders stale heartbeat managed child attention from shared view-state", () => {
    const projection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-24T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "native-local",
          label: "Local native",
          kind: "local",
        },
      ],
      events: [
        managedEvent("evt-stale", 1, "agent_invocation_failed", {
          managedInvocationId: "child-stale",
          providerRoute: {
            providerId: "opencode",
            model: "minimax-m2.5",
          },
          lifecycleState: "stale",
          errorCode: "ENGINE_STALE",
          errorMessage: "Managed invocation heartbeat expired.",
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
        }),
      ],
    });
    const cockpit = createNativeCockpitReadOnlyViewState({
      surfaceId: "native:local",
      projection: projection.view,
      viewState: {},
    });

    const markup = renderToStaticMarkup(<ManagedAgentCockpitPanel cockpit={cockpit} />);

    expect(markup).toContain("<dd>1</dd>");
    expect(markup).toContain("child-stale");
    expect(markup).toContain("data-attention=\"stale\"");
    expect(markup).toContain("Stale heartbeat");
    expect(markup).toContain("failed");
    expect(markup).toContain("<dd>stale</dd>");
    expect(markup).toContain("kiln://managed-agent/child-stale/handoff");
    expect(markup).toContain("kiln://managed-agent/child-stale/heartbeat");
    expect(markup).toContain("agent_invocation_failed");
  });

  it("enables native cancellation only when a live gateway control callback is present", () => {
    const projection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "native-local",
          label: "Local native",
          kind: "local",
        },
      ],
      events: [
        managedEvent("evt-running", 1, "agent_invocation_started", {
          managedInvocationId: "child-running",
          providerRoute: {
            providerId: "codex-oauth",
            model: "gpt-5.5",
          },
          lifecycleState: "running",
        }),
      ],
    });
    const cockpit = createNativeCockpitReadOnlyViewState({
      surfaceId: "native:local",
      projection: projection.view,
      viewState: {},
    });

    const markup = renderToStaticMarkup(
      <ManagedAgentCockpitPanel cockpit={cockpit} onCancel={() => undefined} />,
    );

    expect(markup).toContain("Cancel</button>");
    expect(markup).not.toContain("Cancel disabled");
    expect(markup).not.toContain("disabled=\"\"");
  });

  it("renders selected managed child detail with full lifecycle and resources from shared state", () => {
    const projection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "native-local",
          label: "Local native",
          kind: "local",
        },
      ],
      events: [
        managedEvent("evt-requested", 1, "agent_invocation_requested", {
          managedInvocationId: "child-detail",
          lifecycleState: "pending",
        }),
        managedEvent("evt-started", 2, "agent_invocation_started", {
          managedInvocationId: "child-detail",
          lifecycleState: "running",
        }),
        managedEvent("evt-completed", 3, "agent_invocation_completed", {
          managedInvocationId: "child-detail",
          lifecycleState: "completed",
          managedInvocationEvidence: {
            transcript: {
              uri: "kiln://managed-agent/child-detail/transcript",
              retention: "session",
            },
            resultHandoff: {
              summary: "Child detail completed.",
              resourceUris: [
                "kiln://managed-agent/child-detail/handoff",
                "kiln://managed-agent/child-detail/report",
                "kiln://managed-agent/child-detail/review",
                "kiln://managed-agent/child-detail/diff",
                "kiln://managed-agent/child-detail/log",
              ],
              memoryWriteProposalUris: [],
            },
          },
        }),
      ],
    });
    const cockpit = createNativeCockpitReadOnlyViewState({
      surfaceId: "native:local",
      projection: projection.view,
      viewState: {
        managedAgentDrilldownTarget: {
          instanceId: "native-local",
          sessionId: "session-1",
          managedInvocationId: "child-detail",
          replayEventId: "evt-started",
        },
      },
    });

    const markup = renderToStaticMarkup(
      <ManagedAgentCockpitPanel cockpit={cockpit} selectedManagedInvocationId="child-detail" />,
    );

    expect(markup).toContain("Managed Agent Detail");
    expect(markup).toContain("child-detail");
    expect(markup).toContain("Replay");
    expect(markup).toContain("evt-requested");
    expect(markup).toContain("evt-started");
    expect(markup).toContain("evt-completed");
    expect(markup).toContain("kiln://managed-agent/child-detail/diff");
    expect(markup).toContain("kiln://managed-agent/child-detail/handoff");
    expect(markup).toContain("kiln://managed-agent/child-detail/log");
    expect(markup).toContain("kiln://managed-agent/child-detail/report");
    expect(markup).toContain("kiln://managed-agent/child-detail/review");
    expect(markup).toContain("kiln://managed-agent/child-detail/transcript");
  });

  it("renders runtime adoption-gate state for selected managed child detail", () => {
    const projection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "native-local",
          label: "Local native",
          kind: "local",
        },
      ],
      events: [
        managedEvent("evt-completed", 1, "agent_invocation_completed", {
          managedInvocationId: "child-adopted",
          lifecycleState: "completed",
        }),
        managedEvent("evt-adoption", 2, "work_item_updated", {
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
            adoptedAt: "2026-05-23T12:00:02.000Z",
            resourceUris: ["kiln://artifacts/orch-adoption/adoption-review"],
            blockingEvidence: [],
          },
        }),
      ],
    });
    const cockpit = createNativeCockpitReadOnlyViewState({
      surfaceId: "native:local",
      projection: projection.view,
      viewState: {
        managedAgentDrilldownTarget: {
          instanceId: "native-local",
          sessionId: "session-1",
          managedInvocationId: "child-adopted",
        },
      },
    });

    const markup = renderToStaticMarkup(
      <ManagedAgentCockpitPanel cockpit={cockpit} selectedManagedInvocationId="child-adopted" />,
    );

    expect(markup).toContain("Adoption");
    expect(markup).toContain("adopted");
    expect(markup).toContain("operator");
    expect(markup).toContain("2026-05-23T12:00:02.000Z");
    expect(markup).toContain("kiln://artifacts/orch-adoption/adoption-review");
    expect(markup).not.toContain("Merge ready");
  });

  it("renders blocked adoption-gate detail without merge-readiness text", () => {
    const projection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "native-local",
          label: "Local native",
          kind: "local",
        },
      ],
      events: [
        managedEvent("evt-completed", 1, "agent_invocation_completed", {
          managedInvocationId: "child-rejected",
          lifecycleState: "completed",
        }),
        managedEvent("evt-rejected", 2, "work_item_updated", {
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
              completedAt: "2026-05-23T12:00:02.000Z",
            },
          },
        }),
      ],
    });
    const cockpit = createNativeCockpitReadOnlyViewState({
      surfaceId: "native:local",
      projection: projection.view,
      viewState: {
        managedAgentDrilldownTarget: {
          instanceId: "native-local",
          sessionId: "session-1",
          managedInvocationId: "child-rejected",
        },
      },
    });

    const markup = renderToStaticMarkup(
      <ManagedAgentCockpitPanel cockpit={cockpit} selectedManagedInvocationId="child-rejected" />,
    );

    expect(markup).toContain("Adoption");
    expect(markup).toContain("rejected");
    expect(markup).toContain("Blocking Evidence");
    expect(markup).toContain("managed-orchestration:adoption-gate");
    expect(markup).toContain("Rejection");
    expect(markup).toContain("managed orchestration adoption gate");
    expect(markup).toContain("Reviewer rejected the child handoff.");
    expect(markup).toContain("kiln://artifacts/orch-rejected/review");
    expect(markup).not.toContain("Merge ready");
  });

  it("renders unresolved managed child drilldown without synthetic detail data", () => {
    const projection = createNativeCockpitReadOnlyProjection({
      surfaceId: "native:local",
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "native-local",
          label: "Local native",
          kind: "local",
        },
      ],
      events: [
        managedEvent("evt-running", 1, "agent_invocation_started", {
          managedInvocationId: "child-running",
          lifecycleState: "running",
        }),
      ],
    });
    const cockpit = createNativeCockpitReadOnlyViewState({
      surfaceId: "native:local",
      projection: projection.view,
      viewState: {
        managedAgentDrilldownTarget: {
          instanceId: "native-local",
          sessionId: "session-1",
          managedInvocationId: "child-missing",
        },
      },
    });

    const markup = renderToStaticMarkup(<ManagedAgentCockpitPanel cockpit={cockpit} />);

    expect(markup).toContain("Managed Agent Detail");
    expect(markup).toContain("Detail unavailable: managed-invocation-not-found");
    expect(markup).not.toContain("child-missing</strong>");
  });
});
