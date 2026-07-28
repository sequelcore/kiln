import { describe, expect, it } from "vitest";
import type { OperatorSessionEvent } from "../src/frames.js";
import {
  createOperatorCockpitBenchmarkFixture,
} from "../src/operator-cockpit-benchmark.js";
import {
  projectOperatorCockpitReadOnlyView,
} from "../src/operator-cockpit-projection.js";
import {
  createOperatorCockpitReadOnlyViewState,
} from "../src/operator-cockpit-view-state.js";
import {
  createOperatorWorkspaceConfigHealthSummary,
  createOperatorWorkspaceHomeProjection,
} from "../src/operator-workspace-home.js";
import {
  normalizeManagedAgentOperatorReplayEvents,
} from "../src/operator-cockpit-projection.js";
import {
  EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE,
  externalRuntimeGovernanceEvents,
} from "./fixtures/external-runtime-governance.js";

describe("operator workspace home projection", () => {
  it("preserves external-runtime governance evidence in one canonical projection", () => {
    const cockpitProjection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T09:01:00.000Z",
      attachTargets: [{
        instanceId: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.instanceId,
        label: "Synthetic external runtime",
        kind: "local",
      }],
      events: externalRuntimeGovernanceEvents,
    });
    const cockpitView = createOperatorCockpitReadOnlyViewState({
      projection: cockpitProjection,
      viewState: {},
    });

    const home = createOperatorWorkspaceHomeProjection({
      projectedAt: "2026-07-28T09:01:00.000Z",
      cockpitView,
      events: externalRuntimeGovernanceEvents,
    });

    expect(cockpitProjection.sessions[0]?.authority).toBe(
      EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.authorityProfile.authorityProfileId,
    );
    expect(cockpitProjection.invocations.find(
      (invocation) => invocation.managedInvocationId === EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.invocationId,
    )).toMatchObject({
      managedInvocationId: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.invocationId,
      status: "failed",
      externalRuntimeAttachment: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.attachment,
    });
    expect(cockpitProjection.invocations.find(
      (invocation) =>
        invocation.managedInvocationId === EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.recoveryInvocationId,
    )).toMatchObject({
      managedInvocationId: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.recoveryInvocationId,
      status: "completed",
      externalRuntimeAttachment: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.attachment,
    });
    expect(cockpitProjection.toolSummaries.find(
      (tool) => tool.toolCallId === EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.toolCallId,
    )).toMatchObject({
      toolCallId: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.toolCallId,
      status: "failed",
      externalFailure: {
        selector: "mcp:synthetic-runtime:tool:navigate_actor",
        category: "failed",
        attachment: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.attachment,
        diagnostic: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.safeFailureDiagnostic,
        redacted: true,
        blocked: true,
      },
    });
    expect(cockpitProjection.toolSummaries.find(
      (tool) => tool.toolCallId === EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.recoveryToolCallId,
    )).toMatchObject({
      toolCallId: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.recoveryToolCallId,
      status: "succeeded",
    });
    expect(cockpitView.managedAgents.items.find(
      (item) => item.managedInvocationId === EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.invocationId,
    )).toMatchObject({
      externalRuntimeAttachment: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.attachment,
      externalToolFailures: [{
        selector: "mcp:synthetic-runtime:tool:navigate_actor",
        diagnostic: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.safeFailureDiagnostic,
        redacted: true,
        blocked: true,
      }],
    });
    expect(home.work).toMatchObject({
      totalCount: 1,
      activeCount: 0,
      blockedCount: 0,
      missingEvidenceCount: 0,
      goalCount: 1,
      activeGoalCount: 0,
      items: [{
        workItemId: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.workItemId,
        status: "completed",
        pendingPauseCount: 0,
        failedVerificationGateCount: 0,
      }],
    });
    expect(home.approvals).toMatchObject({
      pendingCount: 0,
      resolvedCount: 2,
    });
  });

  it("replays the same external-runtime governance disposition without losing evidence", () => {
    const replayedEvents = normalizeManagedAgentOperatorReplayEvents(
      externalRuntimeGovernanceEvents,
      { defaultInstanceId: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.instanceId },
    );
    const replayProjection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T09:01:00.000Z",
      attachTargets: [{
        instanceId: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.instanceId,
        label: "Synthetic external runtime",
        kind: "local",
      }],
      events: replayedEvents,
    });
    const replayView = createOperatorCockpitReadOnlyViewState({
      projection: replayProjection,
      viewState: {},
    });
    const replayHome = createOperatorWorkspaceHomeProjection({
      projectedAt: "2026-07-28T09:01:00.000Z",
      cockpitView: replayView,
      events: replayedEvents,
    });

    expect(replayedEvents.map((event) => event.kind)).toEqual(
      externalRuntimeGovernanceEvents.map((event) => event.kind),
    );
    expect(replayView.managedAgents.items.find(
      (item) => item.managedInvocationId === EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.invocationId,
    )).toMatchObject({
      externalRuntimeAttachment: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.attachment,
      externalToolFailures: [{
        selector: "mcp:synthetic-runtime:tool:navigate_actor",
        diagnostic: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.safeFailureDiagnostic,
      }],
    });
    expect(replayHome).toMatchObject({
      work: {
        blockedCount: 0,
        activeGoalCount: 0,
        items: [{
          workItemId: EXTERNAL_RUNTIME_GOVERNANCE_FIXTURE.workItemId,
          status: "completed",
          pendingPauseCount: 0,
        }],
      },
      approvals: {
        pendingCount: 0,
        resolvedCount: 2,
      },
    });
    expect(replayedEvents.find(
      (event) => event.eventId === "external-runtime-parity:event:assistant-message",
    )?.payload).toMatchObject({
      content: "The external-runtime action failed; canonical work remains blocked.",
    });
    expect(replayedEvents.find(
      (event) => event.eventId === "external-runtime-parity:event:turn-completed",
    )?.payload).toMatchObject({
      outcome: "failed",
    });
    expect(replayedEvents.find(
      (event) => event.eventId === "external-runtime-parity:event:recovery-assistant-message",
    )?.payload).toMatchObject({
      content: "Recovery verified the external-runtime action; canonical work is complete.",
    });
    expect(replayedEvents.find(
      (event) => event.eventId === "external-runtime-parity:event:recovery-turn-completed",
    )?.payload).toMatchObject({
      outcome: "completed",
    });
  });

  it("fails closed when a well-formed pause requirement has an unknown status", () => {
    const malformedStatusEvent: OperatorSessionEvent = {
      eventId: "workspace-home-unknown-status:event:work",
      kilnSessionId: "workspace-home-unknown-status:session",
      sequence: 1,
      timestamp: "2026-07-28T09:02:00.000Z",
      kind: "work_item_updated",
      payload: {
        instanceId: "local",
        sessionId: "workspace-home-unknown-status:session",
        workItem: {
          id: "workspace-home-unknown-status:work",
          summary: "Do not lose an unknown blocker",
          status: "pending",
          workflowProfile: "verification-heavy",
          authorityProfile: "authority:workspace-write",
          pauseRequirements: [{
            id: "workspace-home-unknown-status:pause",
            kind: "capability",
            summary: "The producer emitted an unsupported disposition.",
            status: "future-status",
          }],
        },
      },
    };
    const cockpitProjection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T09:02:01.000Z",
      attachTargets: [{
        instanceId: "local",
        label: "Local",
        kind: "local",
      }],
      events: [malformedStatusEvent],
    });
    const home = createOperatorWorkspaceHomeProjection({
      projectedAt: "2026-07-28T09:02:01.000Z",
      cockpitView: createOperatorCockpitReadOnlyViewState({
        projection: cockpitProjection,
        viewState: {},
      }),
      events: [malformedStatusEvent],
    });

    expect(home.work.blockedCount).toBe(1);
    expect(home.work.items[0]?.pendingPauseCount).toBe(1);
  });

  it("fails closed when governed work has no explicit authority disposition", () => {
    const event: OperatorSessionEvent = {
      eventId: "workspace-home-missing-authority:event:work",
      kilnSessionId: "workspace-home-missing-authority:session",
      sequence: 1,
      timestamp: "2026-07-28T09:03:00.000Z",
      kind: "work_item_updated",
      payload: {
        instanceId: "local",
        sessionId: "workspace-home-missing-authority:session",
        workItem: {
          id: "workspace-home-missing-authority:work",
          summary: "Require explicit authority before execution",
          status: "pending",
          workflowProfile: "verification-heavy",
        },
      },
    };
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T09:03:01.000Z",
      attachTargets: [{ instanceId: "local", label: "Local", kind: "local" }],
      events: [event],
    });
    const home = createOperatorWorkspaceHomeProjection({
      projectedAt: projection.projectedAt,
      cockpitView: createOperatorCockpitReadOnlyViewState({
        projection,
        viewState: {},
      }),
      events: [event],
    });

    expect(home.work.blockedCount).toBe(1);
  });

  it("summarizes gateway targets, sessions, managed agents, resources, and attention from shared cockpit state", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "workspace-home",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 4,
      eventCount: 24,
      startedAt: "2026-06-25T12:00:00.000Z",
    });
    const resourceEvent: OperatorSessionEvent = {
      ...fixture.events[1]!,
      eventId: "workspace-home:event:resource",
      kind: "tool_call_completed",
      payload: {
        instanceId: "workspace-home:instance:1",
        sessionId: "workspace-home:session:1",
        toolCallScopeId: "workspace-home:response:1",
        toolCallId: "workspace-home:tool:read-many",
        toolName: "read_many",
        output: JSON.stringify({
          result: {
            output: "2 files read",
            metadata: {
              resourceLinks: [
                {
                  uri: "kiln://artifacts/workspace-home/content",
                  title: "Workspace Home Content",
                  mimeType: "application/json",
                  relation: "full_output",
                },
                {
                  uri: "kiln://artifacts/workspace-home/summary",
                  title: "Workspace Home Summary",
                  relation: "summary",
                },
              ],
            },
          },
        }),
        state: "succeeded",
      },
    };
    const workItemEvent: OperatorSessionEvent = {
      eventId: "workspace-home:event:work",
      kilnSessionId: "workspace-home:session:1",
      sequence: 30,
      timestamp: "2026-06-25T12:01:30.000Z",
      kind: "work_item_updated",
      payload: {
        instanceId: "workspace-home:instance:1",
        sessionId: "workspace-home:session:1",
        workItem: {
          id: "work-home-1",
          summary: "Promote workspace home work summary",
          status: "blocked",
          workflowProfile: "verification-heavy",
          authorityProfile: "authority:read-only",
          assignedAgentProfile: "researcher",
          pauseRequirements: [
            { id: "pause-1", kind: "capability", summary: "Missing route", status: "pending" },
          ],
          updatedAt: "2026-06-25T12:01:30.000Z",
        },
        missingEvidence: ["surface-map"],
        failedVerificationGates: ["typecheck"],
      },
    };
    const goalEvent: OperatorSessionEvent = {
      eventId: "workspace-home:event:goal",
      kilnSessionId: "workspace-home:session:1",
      sequence: 31,
      timestamp: "2026-06-25T12:01:31.000Z",
      kind: "goal.created",
      payload: {
        instanceId: "workspace-home:instance:1",
        sessionId: "workspace-home:session:1",
        goal: {
          id: "goal-home-1",
          status: "active",
        },
      },
    };
    const approvalRequestedEvent: OperatorSessionEvent = {
      eventId: "workspace-home:event:approval",
      kilnSessionId: "workspace-home:session:1",
      sequence: 32,
      timestamp: "2026-06-25T12:01:32.000Z",
      kind: "approval_requested",
      payload: {
        instanceId: "workspace-home:instance:1",
        sessionId: "workspace-home:session:1",
        approvalId: "approval-home-1",
        action: "Apply patch",
        justification: "Operator approval required.",
      },
    };
    const capabilitySnapshotEvent: OperatorSessionEvent = {
      eventId: "workspace-home:event:capability",
      kilnSessionId: "workspace-home:session:1",
      sequence: 33,
      timestamp: "2026-06-25T12:01:33.000Z",
      kind: "agent_invocation_requested",
      payload: {
        instanceId: "workspace-home:instance:1",
        sessionId: "workspace-home:session:1",
        invocationId: "workspace-home:child:health",
        agentId: "codex-oauth:foundation-readonly-plan",
        capabilitySnapshot: {
          snapshotId: "workspace-home:child:health:capability",
          capturedAt: "2026-06-25T12:01:33.000Z",
          routeId: "codex-oauth-readonly",
          routeSource: "explicit-managed-route",
          routeHealth: {
            status: "healthy",
            reason: "Configured route admitted by managed invocation policy.",
          },
          providerModelProof: {
            status: "live-proven",
            source: "provider-catalog",
            requiresToolCalls: true,
          },
          providerRoute: {
            providerId: "codex-oauth",
            model: "gpt-5.4-mini",
            surface: "direct-provider",
          },
          adapterKind: "direct",
          executionMode: "direct-provider",
        },
      },
    };
    const cockpitProjection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-06-25T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "workspace-home:instance:1",
          label: "Local Operator",
          kind: "local",
          gatewayUrl: "http://127.0.0.1:4810",
        },
        {
          instanceId: "workspace-home:instance:2",
          label: "Remote App",
          kind: "remote",
          gatewayUrl: "https://app.example.invalid",
          gatewayTarget: {
            targetId: "gateway:remote-app",
            kind: "remote-app-gateway",
            trust: "remote",
            appId: "support",
            tenantId: "acme",
          },
        },
      ],
      events: [
        ...fixture.events.slice(0, 1),
        resourceEvent,
        ...fixture.events.slice(2),
        workItemEvent,
        goalEvent,
        approvalRequestedEvent,
        capabilitySnapshotEvent,
      ],
    });
    const cockpitView = createOperatorCockpitReadOnlyViewState({
      projection: cockpitProjection,
      viewState: {},
    });

    const home = createOperatorWorkspaceHomeProjection({
      projectedAt: "2026-06-25T12:02:00.000Z",
      cockpitView,
      events: [
        ...fixture.events.slice(0, 1),
        resourceEvent,
        ...fixture.events.slice(2),
        workItemEvent,
        goalEvent,
        approvalRequestedEvent,
        capabilitySnapshotEvent,
      ],
    });

    expect(home).toMatchObject({
      mode: "read-only",
      projectedAt: "2026-06-25T12:02:00.000Z",
      managedAgents: {
        totalCount: cockpitView.managedAgents.items.length,
        activeCount: cockpitView.managedAgents.activeCount,
        attentionCount: cockpitView.managedAgents.attentionCount,
      },
      attention: cockpitView.attention,
    });
    expect(home.work).toMatchObject({
      totalCount: 1,
      activeCount: 1,
      blockedCount: 1,
      missingEvidenceCount: 1,
      goalCount: 1,
      activeGoalCount: 1,
      items: [
        {
          workItemId: "work-home-1",
          sessionId: "workspace-home:session:1",
          resourceUri: "kiln://session/work-items/work-home-1",
          pendingPauseCount: 1,
          failedVerificationGateCount: 1,
        },
      ],
    });
    expect(home.approvals).toMatchObject({
      pendingCount: 1,
      resolvedCount: 0,
      items: [
        {
          approvalId: "approval-home-1",
          sessionId: "workspace-home:session:1",
          action: "Apply patch",
          justification: "Operator approval required.",
        },
      ],
    });
    expect(home.configHealth).toEqual({
      status: "unknown",
      issueCount: 0,
      items: [],
    });
    expect(home.routeHealth).toMatchObject({
      totalCount: 1,
      healthyCount: 1,
      degradedCount: 0,
      blockedCount: 0,
      unknownCount: 0,
      items: [
        {
          routeId: "codex-oauth-readonly",
          routeSource: "explicit-managed-route",
          status: "healthy",
          providerId: "codex-oauth",
          model: "gpt-5.4-mini",
          adapterKind: "direct",
          executionMode: "direct-provider",
          reason: "Configured route admitted by managed invocation policy.",
        },
      ],
    });
    expect(home.providerReadiness).toMatchObject({
      totalCount: 1,
      liveProvenCount: 1,
      configuredCount: 0,
      unprovenCount: 0,
      unknownCount: 0,
      items: [
        {
          providerId: "codex-oauth",
          model: "gpt-5.4-mini",
          status: "live-proven",
          source: "provider-catalog",
          requiresToolCalls: true,
        },
      ],
    });
    expect(home.gatewayTargets).toHaveLength(2);
    expect(home.gatewayTargets[0]).toMatchObject({
      instanceId: "workspace-home:instance:1",
      gatewayTarget: {
        targetId: "workspace-home:instance:1",
        kind: "local-operator-gateway",
        trust: "local",
      },
    });
    expect(home.gatewayTargets[1]).toMatchObject({
      instanceId: "workspace-home:instance:2",
      gatewayTarget: {
        targetId: "gateway:remote-app",
        kind: "remote-app-gateway",
        trust: "remote",
        appId: "support",
        tenantId: "acme",
      },
    });
    expect(home.gatewayHealth).toMatchObject({
      status: "degraded",
      targetCount: 2,
      localCount: 1,
      remoteCount: 1,
      appTargetCount: 1,
      tenantTargetCount: 1,
    });
    expect(home.sessions.length).toBe(cockpitProjection.sessions.length);
    expect(home.resources).toMatchObject({
      linkedResourceCount: 2,
      totalCount: 2,
      items: [
        {
          uri: "kiln://artifacts/workspace-home/content",
          title: "Workspace Home Content",
          relation: "full_output",
          target: {
            gatewayTargetId: "workspace-home:instance:1",
            instanceId: "workspace-home:instance:1",
            sessionId: "workspace-home:session:1",
            toolCallScopeId: "workspace-home:response:1",
            toolCallId: "workspace-home:tool:read-many",
            resourceUri: "kiln://artifacts/workspace-home/content",
          },
        },
        {
          uri: "kiln://artifacts/workspace-home/summary",
          title: "Workspace Home Summary",
          relation: "summary",
        },
      ],
    });
  });

  it("does not count a superseded pause requirement as pending or blocking", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "workspace-home-superseded",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 0,
      childInvocationCount: 0,
      eventCount: 1,
      startedAt: "2026-07-26T12:00:00.000Z",
    });
    const workItemEvent: OperatorSessionEvent = {
      eventId: "workspace-home-superseded:event:work",
      kilnSessionId: "workspace-home-superseded:session:1",
      sequence: 30,
      timestamp: "2026-07-26T12:01:30.000Z",
      kind: "work_item_updated",
      payload: {
        instanceId: "workspace-home-superseded:instance:1",
        sessionId: "workspace-home-superseded:session:1",
        workItem: {
          id: "work-home-superseded-1",
          summary: "Work item with a superseded pause requirement only",
          status: "pending",
          workflowProfile: "verification-heavy",
          authorityProfile: "authority:workspace-write",
          pauseRequirements: [
            {
              id: "pause-1",
              kind: "capability",
              summary: "Missing route",
              status: "superseded",
              supersededByRequirementId: "pause-2",
              supersededAt: "2026-07-26T12:01:00.000Z",
              supersededBy: "operator",
              reason: "Replaced by a broader requirement.",
            },
          ],
          updatedAt: "2026-07-26T12:01:30.000Z",
        },
      },
    };
    const cockpitProjection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-26T12:02:00.000Z",
      attachTargets: [
        {
          instanceId: "workspace-home-superseded:instance:1",
          label: "Local Operator",
          kind: "local",
          gatewayUrl: "http://127.0.0.1:4810",
        },
      ],
      events: [...fixture.events, workItemEvent],
    });
    const cockpitView = createOperatorCockpitReadOnlyViewState({
      projection: cockpitProjection,
      viewState: {},
    });

    const home = createOperatorWorkspaceHomeProjection({
      projectedAt: "2026-07-26T12:02:00.000Z",
      cockpitView,
      events: [...fixture.events, workItemEvent],
    });

    expect(home.work.blockedCount).toBe(0);
    expect(home.work.items).toMatchObject([
      {
        workItemId: "work-home-superseded-1",
        pendingPauseCount: 0,
      },
    ]);
  });

  it("projects config setup diagnostics into workspace config health", () => {
    const health = createOperatorWorkspaceConfigHealthSummary({
      projectRoot: "C:/workspace/kiln",
      projectContext: {
        path: "C:/workspace/kiln/.kiln/project-context.md",
        status: "invalid",
        error: "Project context is malformed.",
        recommendation: "review-project-context",
      },
      repoShims: [
        {
          target: "agents",
          targetId: "repo-shim:agents",
          path: "C:/workspace/kiln/AGENTS.md",
          status: "stale",
          recommendation: "sync-repo-shims",
        },
      ],
      nativeProjections: [
        {
          targetId: "native-projection:codex",
          path: "C:/Users/ExampleUser/.codex/config.toml",
          kind: "native",
          status: "drifted",
          details: "Codex native projection drifted from resolved Kiln config.",
        },
      ],
      permissionIntegrity: [],
      recommendedActions: ["review-project-context", "sync-repo-shims", "review-native-projection-drift"],
    });

    expect(health).toMatchObject({
      status: "blocked",
      issueCount: 3,
      items: [
        {
          id: "project-context",
          status: "blocked",
          recommendation: "review-project-context",
        },
        {
          id: "repo-shim:agents",
          status: "degraded",
          recommendation: "sync-repo-shims",
        },
        {
          id: "native-projection:codex",
          status: "blocked",
        },
      ],
    });
  });

  it("projects permission integrity into workspace config health", () => {
    const health = createOperatorWorkspaceConfigHealthSummary({
      projectRoot: "C:/workspace/kiln",
      projectContext: {
        path: "C:/workspace/kiln/.kiln/project-context.md",
        status: "valid",
        recommendation: "none",
      },
      repoShims: [],
      nativeProjections: [],
      permissionIntegrity: [{
        harness: "codex",
        desired: {
          profile: "trusted-full-access",
          source: "operator-local-config",
          observedAt: "2026-07-01T15:00:00.000Z",
          verifiedAt: "2026-07-01T15:00:01.000Z",
          freshness: "current",
          proof: "proven",
        },
        effectiveRuntime: {
          profile: "workspace-write",
          source: "runtime-observation",
          observedAt: "2026-07-01T15:02:00.000Z",
          verifiedAt: "2026-07-01T15:02:01.000Z",
          freshness: "current",
          proof: "proven",
        },
        enforcement: {
          approvalControl: "enforced",
          filesystemSandbox: "enforced",
          networkBoundary: "enforced",
          strength: "strong",
        },
        authorization: {
          status: "authorized",
          scope: "operator-local",
          authorizedBy: "operator",
          authorizedAt: "2026-07-01T14:59:00.000Z",
          revocable: true,
        },
        semanticLoss: [],
        classification: "runtime-policy-mismatch",
        recommendation: "Restart Codex with proven Full Access or choose a narrower trusted profile.",
        remediationRequiresApproval: true,
        lastVerifiedAt: "2026-07-01T15:02:01.000Z",
      }],
      recommendedActions: ["none"],
    });

    expect(health).toMatchObject({
      status: "blocked",
      issueCount: 1,
      items: [{
        id: "permission-integrity:codex",
        status: "blocked",
        summary: "Codex permission integrity is runtime-policy-mismatch.",
        recommendation: "Restart Codex with proven Full Access or choose a narrower trusted profile.",
      }],
    });
  });
});
