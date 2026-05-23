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
});
