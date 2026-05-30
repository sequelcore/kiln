import { describe, expect, it } from "vitest";
import type { OperatorSessionEvent } from "../src/frames.js";
import {
  createOperatorCockpitBenchmarkFixture,
} from "../src/operator-cockpit-benchmark.js";
import {
  createOperatorCockpitReadOnlyAttachPlan,
  type ManagedAgentOperatorReplayEnvelope,
  normalizeManagedAgentOperatorEvents,
  normalizeManagedAgentOperatorReplayEvents,
  projectOperatorCockpitReadOnlyView,
} from "../src/operator-cockpit-projection.js";

describe("operator cockpit read-only projection", () => {
  it("projects canonical events into target-aware cockpit views without mutation authority", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "read-only",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 5,
      eventCount: 30,
      startedAt: "2026-05-14T12:00:00.000Z",
    });

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "read-only:instance:1",
          label: "Local / kiln",
          kind: "local",
          gatewayUrl: "http://127.0.0.1:4810",
        },
        {
          instanceId: "read-only:instance:2",
          label: "Simulated remote",
          kind: "simulated-remote",
          gatewayUrl: "https://example.invalid",
        },
      ],
      events: fixture.events,
    });

    expect(projection.mode).toBe("read-only");
    expect(projection.projectedAt).toBe("2026-05-14T12:01:00.000Z");
    expect(projection.instances).toHaveLength(2);
    expect(projection.instances[0]).toMatchObject({
      instanceId: "read-only:instance:1",
      label: "Local / kiln",
      kind: "local",
      gatewayUrl: "http://127.0.0.1:4810",
      eventCount: 20,
      sessionCount: 2,
    });
    expect(projection.sessions).toHaveLength(3);
    expect(projection.sessions[0]).toMatchObject({
      sessionId: "read-only:session:1",
      instanceId: "read-only:instance:1",
      target: {
        instanceId: "read-only:instance:1",
        sessionId: "read-only:session:1",
      },
      eventCount: 10,
      authority: "read",
    });
    expect(projection.timeline).toHaveLength(30);
    expect(projection.timeline[0]).toMatchObject({
      eventId: "read-only:event:1",
      title: "Turn Started",
      target: {
        instanceId: "read-only:instance:1",
        sessionId: "read-only:session:1",
        eventId: "read-only:event:1",
      },
    });
    expect(projection.invocations.length).toBeGreaterThan(0);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: expect.stringContaining("read-only:child:"),
      target: {
        instanceId: expect.stringContaining("read-only:instance:"),
        sessionId: expect.stringContaining("read-only:session:"),
        managedInvocationId: expect.stringContaining("read-only:child:"),
      },
    });
    expect(projection.toolSummaries.length).toBeGreaterThan(0);
    expect(projection.toolSummaries[0]).toMatchObject({
      toolName: "synthetic_tool",
      target: {
        instanceId: expect.stringContaining("read-only:instance:"),
        sessionId: expect.stringContaining("read-only:session:"),
      },
    });
    expect(projection.cost.inputTokens).toBeGreaterThan(0);
    expect(projection.cost.outputTokens).toBeGreaterThan(0);
    expect(projection.cost.totalUsd).toBeGreaterThan(0);
    expect(projection.cost.providerRoutes).toContain("synthetic/fixture");
  });

  it("fails closed when an event references an unattached instance", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "missing-target",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 5,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const unknownInstanceEvent: OperatorSessionEvent = {
      ...fixture.events[0]!,
      eventId: "missing-target:event:unknown",
      payload: {
        ...fixture.events[0]!.payload,
        instanceId: "missing-target:instance:unknown",
      },
    };

    expect(() => projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "missing-target:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: [
        ...fixture.events,
        unknownInstanceEvent,
      ],
    })).toThrow("unattached instance");
  });

  it("rejects ambiguous or unsupported attach targets before projection", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "bad-target",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 0,
      childInvocationCount: 0,
      eventCount: 1,
      startedAt: "2026-05-14T12:00:00.000Z",
    });

    expect(() => projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "bad-target:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
        {
          instanceId: "bad-target:instance:1",
          label: "Duplicate",
          kind: "local",
        },
      ],
      events: fixture.events,
    })).toThrow("duplicated");

    expect(() => projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "bad-target:instance:1",
          label: "Local / kiln",
          kind: "unsupported" as never,
        },
      ],
      events: fixture.events,
    })).toThrow("unsupported kind");
  });

  it("creates a read-only attach plan for local and simulated remote gateways without opening connections", () => {
    const plan = createOperatorCockpitReadOnlyAttachPlan({
      plannedAt: "2026-05-14T12:04:00.000Z",
      attachTargets: [
        {
          instanceId: "attach-plan:local",
          label: "Local / kiln",
          kind: "local",
          gatewayUrl: "http://127.0.0.1:4810",
        },
        {
          instanceId: "attach-plan:remote",
          label: "Simulated remote",
          kind: "simulated-remote",
          gatewayUrl: "https://example.invalid",
        },
      ],
    });

    expect(plan).toEqual({
      mode: "read-only",
      plannedAt: "2026-05-14T12:04:00.000Z",
      targetCount: 2,
      mutationDispatch: "disabled",
      targets: [
        {
          instanceId: "attach-plan:local",
          label: "Local / kiln",
          kind: "local",
          gatewayUrl: "http://127.0.0.1:4810",
          connectionKind: "operator-gateway",
          transport: "http-ws",
          connectionState: "planned",
          mutationDispatch: "disabled",
        },
        {
          instanceId: "attach-plan:remote",
          label: "Simulated remote",
          kind: "simulated-remote",
          gatewayUrl: "https://example.invalid",
          connectionKind: "simulated-app-gateway",
          transport: "simulated-http-ws",
          connectionState: "planned",
          mutationDispatch: "disabled",
        },
      ],
    });
  });

  it("fails read-only attach planning for missing or unsafe gateway URLs", () => {
    expect(() => createOperatorCockpitReadOnlyAttachPlan({
      plannedAt: "2026-05-14T12:04:00.000Z",
      attachTargets: [
        {
          instanceId: "attach-plan:local",
          label: "Local / kiln",
          kind: "local",
        },
      ],
    })).toThrow("requires gatewayUrl");

    expect(() => createOperatorCockpitReadOnlyAttachPlan({
      plannedAt: "2026-05-14T12:04:00.000Z",
      attachTargets: [
        {
          instanceId: "attach-plan:local",
          label: "Local / kiln",
          kind: "local",
          gatewayUrl: "file:///C:/workspace/kiln",
        },
      ],
    })).toThrow("must use http:// or https://");
  });

  it("preserves managed child lifecycle state while projecting read-only invocation status", () => {
    const started: OperatorSessionEvent = {
      eventId: "lifecycle:event:1",
      kilnSessionId: "lifecycle:session:1",
      sequence: 1,
      timestamp: "2026-05-21T12:00:00.000Z",
      kind: "agent_invocation_started",
      payload: {
        instanceId: "lifecycle:instance:1",
        sessionId: "lifecycle:session:1",
        managedInvocationId: "lifecycle:child:1",
        invocationId: "lifecycle:child:1",
        agentId: "agent-reviewer",
        lifecycleState: "running",
        providerRoute: {
          providerId: "opencode",
          model: "sonic",
        },
        capabilitySnapshot: {
          resourceLease: {
            leaseId: "lifecycle:child:1:resource-lease",
            createdAt: "2026-05-21T12:00:00.000Z",
            healthStatus: "healthy",
            cleanupStatus: "not-required",
            workingDirectoryPath: "C:/workspace/kiln",
            workingDirectoryMode: "read-only",
            resourceUris: ["kiln://resources/context.md"],
            diagnosticUris: [],
          },
        },
      },
    };
    const failed: OperatorSessionEvent = {
      eventId: "lifecycle:event:2",
      kilnSessionId: "lifecycle:session:1",
      sequence: 2,
      timestamp: "2026-05-21T12:00:05.000Z",
      kind: "agent_invocation_failed",
      payload: {
        instanceId: "lifecycle:instance:1",
        sessionId: "lifecycle:session:1",
        managedInvocationId: "lifecycle:child:1",
        invocationId: "lifecycle:child:1",
        agentId: "agent-reviewer",
        lifecycleState: "timed_out",
        errorCode: "ENGINE_TIMEOUT",
        capabilitySnapshot: {
          resourceLease: {
            leaseId: "lifecycle:child:1:resource-lease",
            createdAt: "2026-05-21T12:00:00.000Z",
            healthStatus: "healthy",
            cleanupStatus: "not-required",
            workingDirectoryPath: "C:/workspace/kiln",
            workingDirectoryMode: "read-only",
            resourceUris: ["kiln://resources/context.md"],
            diagnosticUris: [],
          },
        },
        managedInvocationEvidence: {
          lifecycle: {
            resourceLease: {
              leaseId: "lifecycle:child:1:resource-lease",
              createdAt: "2026-05-21T12:00:00.000Z",
              healthStatus: "released",
              cleanupStatus: "completed",
              workingDirectoryPath: "C:/workspace/kiln",
              workingDirectoryMode: "read-only",
              resourceUris: ["kiln://resources/context.md"],
              diagnosticUris: ["kiln://artifacts/lifecycle-child-1/lease-diagnostics"],
            },
          },
        },
      },
    };

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-21T12:01:00.000Z",
      attachTargets: [{
        instanceId: "lifecycle:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [started, failed],
    });

    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "lifecycle:child:1",
      status: "failed",
      lifecycleState: "timed_out",
      providerRoute: "opencode/sonic",
      resourceLease: {
        leaseId: "lifecycle:child:1:resource-lease",
        createdAt: "2026-05-21T12:00:00.000Z",
        healthStatus: "released",
        cleanupStatus: "completed",
        workingDirectoryPath: "C:/workspace/kiln",
        workingDirectoryMode: "read-only",
        resourceUris: ["kiln://resources/context.md"],
        diagnosticUris: ["kiln://artifacts/lifecycle-child-1/lease-diagnostics"],
      },
    });
  });

  it("projects terminal lifecycle resource lease evidence when no capability snapshot is attached", () => {
    const completed: OperatorSessionEvent = {
      eventId: "lifecycle:event:lease-only",
      kilnSessionId: "lifecycle:session:lease-only",
      sequence: 1,
      timestamp: "2026-05-21T12:00:00.000Z",
      kind: "agent_invocation_completed",
      payload: {
        instanceId: "lifecycle:instance:1",
        sessionId: "lifecycle:session:lease-only",
        managedInvocationId: "lifecycle:child:lease-only",
        invocationId: "lifecycle:child:lease-only",
        agentId: "agent-reviewer",
        lifecycleState: "completed",
        managedInvocationEvidence: {
          lifecycle: {
            resourceLease: {
              leaseId: "lifecycle:child:lease-only:resource-lease",
              createdAt: "2026-05-21T12:00:00.000Z",
              healthStatus: "leaked",
              cleanupStatus: "failed",
              workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/lifecycle-child-lease-only",
              workingDirectoryMode: "isolated-worktree",
              resourceUris: ["kiln://artifacts/lifecycle-child-lease-only/worktree-lease"],
              diagnosticUris: [
                "kiln://artifacts/lifecycle-child-lease-only/worktree-lease-cleanup-failed",
                "kiln://artifacts/lifecycle-child-lease-only/worktree-review-required",
              ],
              worktreeReview: {
                status: "required",
                reason: "dirty-worktree-preserved",
                resourceUris: ["kiln://artifacts/lifecycle-child-lease-only/worktree-review"],
                diagnosticUris: ["kiln://artifacts/lifecycle-child-lease-only/worktree-review-required"],
              },
            },
          },
        },
      },
    };

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-21T12:01:00.000Z",
      attachTargets: [{
        instanceId: "lifecycle:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [completed],
    });

    expect(projection.invocations[0]?.resourceLease).toEqual({
      leaseId: "lifecycle:child:lease-only:resource-lease",
      createdAt: "2026-05-21T12:00:00.000Z",
      healthStatus: "leaked",
      cleanupStatus: "failed",
      workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/lifecycle-child-lease-only",
      workingDirectoryMode: "isolated-worktree",
      resourceUris: ["kiln://artifacts/lifecycle-child-lease-only/worktree-lease"],
      diagnosticUris: [
        "kiln://artifacts/lifecycle-child-lease-only/worktree-lease-cleanup-failed",
        "kiln://artifacts/lifecycle-child-lease-only/worktree-review-required",
      ],
      worktreeReview: {
        status: "required",
        reason: "dirty-worktree-preserved",
        resourceUris: ["kiln://artifacts/lifecycle-child-lease-only/worktree-review"],
        diagnosticUris: ["kiln://artifacts/lifecycle-child-lease-only/worktree-review-required"],
      },
    });
  });

  it("projects denied worktree conflict evidence as resource lease state", () => {
    const failed: OperatorSessionEvent = {
      eventId: "lifecycle:event:worktree-conflict",
      kilnSessionId: "lifecycle:session:worktree-conflict",
      sequence: 1,
      timestamp: "2026-05-21T12:00:00.000Z",
      kind: "agent_invocation_failed",
      payload: {
        instanceId: "lifecycle:instance:1",
        sessionId: "lifecycle:session:worktree-conflict",
        managedInvocationId: "lifecycle:child:worktree-conflict",
        invocationId: "lifecycle:child:worktree-conflict",
        agentId: "agent-reviewer",
        lifecycleState: "failed",
        managedInvocationEvidence: {
          lifecycle: {
            resourceLease: {
              leaseId: "lifecycle:child:worktree-conflict:resource-lease",
              createdAt: "2026-05-21T12:00:00.000Z",
              healthStatus: "stale",
              cleanupStatus: "not-required",
              workingDirectoryPath: "C:/workspace/kiln",
              workingDirectoryMode: "workspace-write",
              resourceUris: [],
              diagnosticUris: ["kiln://artifacts/lifecycle-child-worktree-conflict/worktree-conflict"],
              worktreeConflict: {
                status: "blocked",
                reason: "same-checkout-write-conflict",
                requestedInvocationId: "lifecycle:child:worktree-conflict",
                conflictingInvocationId: "lifecycle:child:active",
                workingDirectoryPath: "C:/workspace/kiln",
                workingDirectoryMode: "workspace-write",
                policyId: "managed-agent.worktree.single-active-writer",
                retryAfterInvocationIds: ["lifecycle:child:active"],
                resourceUris: [],
                diagnosticUris: ["kiln://artifacts/lifecycle-child-worktree-conflict/worktree-conflict"],
              },
            },
          },
        },
      },
    };

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-21T12:01:00.000Z",
      attachTargets: [{
        instanceId: "lifecycle:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [failed],
    });

    expect(projection.invocations[0]?.resourceLease).toEqual({
      leaseId: "lifecycle:child:worktree-conflict:resource-lease",
      createdAt: "2026-05-21T12:00:00.000Z",
      healthStatus: "stale",
      cleanupStatus: "not-required",
      workingDirectoryPath: "C:/workspace/kiln",
      workingDirectoryMode: "workspace-write",
      resourceUris: [],
      diagnosticUris: ["kiln://artifacts/lifecycle-child-worktree-conflict/worktree-conflict"],
      worktreeConflict: {
        status: "blocked",
        reason: "same-checkout-write-conflict",
        requestedInvocationId: "lifecycle:child:worktree-conflict",
        conflictingInvocationId: "lifecycle:child:active",
        workingDirectoryPath: "C:/workspace/kiln",
        workingDirectoryMode: "workspace-write",
        policyId: "managed-agent.worktree.single-active-writer",
        retryAfterInvocationIds: ["lifecycle:child:active"],
        resourceUris: [],
        diagnosticUris: ["kiln://artifacts/lifecycle-child-worktree-conflict/worktree-conflict"],
      },
    });
    expect(projection.invocations[0]?.evidenceResourceUris).toEqual([
      "kiln://artifacts/lifecycle-child-worktree-conflict/worktree-conflict",
    ]);
  });

  it("projects managed child transcript, handoff, diagnostics, and review resources as invocation evidence targets", () => {
    const completed: OperatorSessionEvent = {
      eventId: "evidence:event:completed",
      kilnSessionId: "evidence:session:1",
      sequence: 1,
      timestamp: "2026-05-23T12:00:00.000Z",
      kind: "agent_invocation_completed",
      payload: {
        instanceId: "evidence:instance:1",
        sessionId: "evidence:session:1",
        managedInvocationId: "evidence:child:1",
        invocationId: "evidence:child:1",
        agentId: "agent-reviewer",
        lifecycleState: "completed",
        managedInvocationEvidence: {
          transcript: {
            uri: "kiln://managed-invocations/evidence-child-1/transcript",
            redacted: true,
            truncated: false,
            persisted: true,
            retention: "session",
          },
          diagnostics: [
            {
              uri: "kiln://managed-invocations/evidence-child-1/diagnostics",
              kind: "adapter",
            },
          ],
          resultHandoff: {
            summary: "Child produced review evidence.",
            resourceUris: ["kiln://managed-invocations/evidence-child-1/handoff"],
            memoryWriteProposalUris: ["kiln://managed-invocations/evidence-child-1/memory-proposal"],
          },
          writeEvidence: [{
            evidenceId: "evidence:child:1:write-attempt-1",
            invocationId: "evidence:child:1",
            kind: "write-attempt-timed-out",
            attemptId: "evidence:child:1:attempt-1",
            summary: "Partial workspace write was detected before timeout.",
            resourceUris: [
              "kiln://managed-invocations/evidence-child-1/write-attempts/1",
              "kiln://managed-invocations/evidence-child-1/handoff",
            ],
            recordedAt: "2026-05-23T12:00:05.000Z",
          }],
          lifecycle: {
            resourceLease: {
              leaseId: "evidence:child:1:resource-lease",
              createdAt: "2026-05-23T12:00:00.000Z",
              healthStatus: "leaked",
              cleanupStatus: "failed",
              workingDirectoryPath: "C:/workspace/kiln/.kiln/worktrees/evidence-child-1",
              workingDirectoryMode: "isolated-worktree",
              resourceUris: ["kiln://managed-invocations/evidence-child-1/worktree"],
              diagnosticUris: ["kiln://managed-invocations/evidence-child-1/cleanup-diagnostic"],
              worktreeReview: {
                status: "required",
                reason: "dirty-worktree-preserved",
                resourceUris: ["kiln://managed-invocations/evidence-child-1/worktree-review"],
                diagnosticUris: ["kiln://managed-invocations/evidence-child-1/worktree-review-diagnostic"],
              },
            },
          },
        },
      },
    };

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-23T12:01:00.000Z",
      attachTargets: [{
        instanceId: "evidence:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [completed],
    });

    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "evidence:child:1",
      transcript: {
        uri: "kiln://managed-invocations/evidence-child-1/transcript",
        redacted: true,
        truncated: false,
        persisted: true,
        retention: "session",
      },
      resultHandoff: {
        summary: "Child produced review evidence.",
        resourceUris: ["kiln://managed-invocations/evidence-child-1/handoff"],
        memoryWriteProposalUris: ["kiln://managed-invocations/evidence-child-1/memory-proposal"],
      },
      diagnosticPointers: [{
        uri: "kiln://managed-invocations/evidence-child-1/diagnostics",
        kind: "adapter",
      }],
      evidenceResourceUris: [
        "kiln://managed-invocations/evidence-child-1/cleanup-diagnostic",
        "kiln://managed-invocations/evidence-child-1/diagnostics",
        "kiln://managed-invocations/evidence-child-1/handoff",
        "kiln://managed-invocations/evidence-child-1/memory-proposal",
        "kiln://managed-invocations/evidence-child-1/transcript",
        "kiln://managed-invocations/evidence-child-1/worktree",
        "kiln://managed-invocations/evidence-child-1/worktree-review",
        "kiln://managed-invocations/evidence-child-1/worktree-review-diagnostic",
        "kiln://managed-invocations/evidence-child-1/write-attempts/1",
      ],
    });
  });

  it("drops incomplete resource lease projections instead of defaulting required evidence lists", () => {
    const started: OperatorSessionEvent = {
      eventId: "lifecycle:event:incomplete-lease",
      kilnSessionId: "lifecycle:session:incomplete-lease",
      sequence: 1,
      timestamp: "2026-05-21T12:00:00.000Z",
      kind: "agent_invocation_started",
      payload: {
        instanceId: "lifecycle:instance:1",
        sessionId: "lifecycle:session:incomplete-lease",
        managedInvocationId: "lifecycle:child:incomplete-lease",
        invocationId: "lifecycle:child:incomplete-lease",
        agentId: "agent-reviewer",
        lifecycleState: "running",
        capabilitySnapshot: {
          resourceLease: {
            leaseId: "lifecycle:child:incomplete-lease:resource-lease",
            createdAt: "2026-05-21T12:00:00.000Z",
            healthStatus: "healthy",
            cleanupStatus: "not-required",
            workingDirectoryPath: "C:/workspace/kiln",
            workingDirectoryMode: "read-only",
          },
        },
      },
    };

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-21T12:01:00.000Z",
      attachTargets: [{
        instanceId: "lifecycle:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [started],
    });

    expect(projection.invocations[0]?.resourceLease).toBeUndefined();
  });

  it("does not merge incomplete lifecycle lease deltas with admission snapshots", () => {
    const started: OperatorSessionEvent = {
      eventId: "lifecycle:event:partial-lease-delta",
      kilnSessionId: "lifecycle:session:partial-lease-delta",
      sequence: 1,
      timestamp: "2026-05-21T12:00:00.000Z",
      kind: "agent_invocation_completed",
      payload: {
        instanceId: "lifecycle:instance:1",
        sessionId: "lifecycle:session:partial-lease-delta",
        managedInvocationId: "lifecycle:child:partial-lease-delta",
        invocationId: "lifecycle:child:partial-lease-delta",
        agentId: "agent-reviewer",
        lifecycleState: "completed",
        capabilitySnapshot: {
          resourceLease: {
            leaseId: "lifecycle:child:partial-lease-delta:resource-lease",
            createdAt: "2026-05-21T12:00:00.000Z",
            healthStatus: "healthy",
            cleanupStatus: "pending",
            workingDirectoryPath: "C:/workspace/kiln",
            workingDirectoryMode: "workspace-write",
            resourceUris: ["kiln://resources/context.md"],
            diagnosticUris: [],
          },
        },
        managedInvocationEvidence: {
          lifecycle: {
            resourceLease: {
              healthStatus: "released",
              cleanupStatus: "completed",
              diagnosticUris: ["kiln://artifacts/lifecycle-child-partial-lease-delta/lease-diagnostics"],
            },
          },
        },
      },
    };

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-21T12:01:00.000Z",
      attachTargets: [{
        instanceId: "lifecycle:instance:1",
        label: "Local / kiln",
        kind: "local",
      }],
      events: [started],
    });

    expect(projection.invocations[0]?.resourceLease).toBeUndefined();
  });

  it("normalizes managed tool evidence snapshots into cross-surface cockpit events", () => {
    const rawEvents: readonly OperatorSessionEvent[] = [{
      eventId: "managed-tools:event:start",
      kilnSessionId: "managed-tools:session:1",
      sequence: 1,
      timestamp: "2026-05-26T12:00:00.000Z",
      kind: "tool_call_completed",
      payload: {
        sessionId: "managed-tools:session:1",
        toolCallId: "managed-tools:tool:start",
        toolName: "managed_agent.start",
        state: "succeeded",
        output: "Started child.",
        metadata: {
          kind: "managed-invocation",
          managedInvocationId: "managed-tools:child:1",
          agentId: "agent-reviewer",
          lifecycleState: "running",
          parentSessionId: "managed-tools:session:1",
          profile: "foundation-readonly-plan",
          providerRoute: {
            providerId: "opencode",
            model: "sonic",
          },
          adapterKind: "harness",
          executionMode: "cli-harness",
          timeoutMs: 120000,
          timeoutSource: "explicit-route",
        },
      },
    }, {
      eventId: "managed-tools:event:join",
      kilnSessionId: "managed-tools:session:1",
      sequence: 2,
      timestamp: "2026-05-26T12:00:03.000Z",
      kind: "tool_call_completed",
      payload: {
        sessionId: "managed-tools:session:1",
        toolCallId: "managed-tools:tool:join",
        toolName: "managed_agent.join",
        state: "succeeded",
        output: "Child timed out.",
        metadata: {
          kind: "managed-invocation",
          managedInvocationId: "managed-tools:child:1",
          agentId: "agent-reviewer",
          lifecycleState: "timed_out",
          childSessionId: "managed-tools:child-session:1",
          childTurnId: "managed-tools:child-turn:1",
          timeoutMs: 120000,
          timeoutSource: "explicit-route",
          transcript: {
            uri: "kiln://managed-agents/invocations/managed-tools%3Achild%3A1/transcript",
            persisted: true,
            truncated: false,
          },
          resultHandoff: {
            summary: "Child timed out after partial evidence.",
            resourceUris: ["kiln://managed-agents/invocations/managed-tools%3Achild%3A1/resources/timeout"],
            memoryWriteProposalUris: [],
          },
        },
      },
    }, {
      eventId: "managed-tools:event:list",
      kilnSessionId: "managed-tools:session:1",
      sequence: 3,
      timestamp: "2026-05-26T12:00:04.000Z",
      kind: "tool_call_completed",
      payload: {
        sessionId: "managed-tools:session:1",
        toolCallId: "managed-tools:tool:list",
        toolName: "managed_agent.list",
        state: "succeeded",
        output: JSON.stringify({
          invocations: [{
            invocationId: "managed-tools:child:1",
            agentId: "agent-reviewer",
            lifecycleState: "running",
            providerRoute: {
              providerId: "opencode",
              model: "sonic",
            },
            adapterKind: "harness",
            executionMode: "cli-harness",
          }, {
            invocationId: "managed-tools:child:2",
            agentId: "agent-researcher",
            lifecycleState: "timed_out",
            providerRoute: {
              providerId: "codex",
              model: "gpt-5.5",
            },
            adapterKind: "harness",
            executionMode: "cli-harness",
            timeoutMs: 45000,
            timeoutSource: "route-default",
            childSessionId: "managed-tools:child-session:2",
            childTurnId: "managed-tools:child-turn:2",
          }],
        }),
      },
    }];

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-26T12:01:00.000Z",
      attachTargets: [{
        instanceId: "managed-tools:instance:gui",
        label: "Local GUI",
        kind: "local",
      }],
      events: normalizeManagedAgentOperatorEvents(rawEvents, {
        defaultInstanceId: "managed-tools:instance:gui",
      }),
    });

    expect(projection.invocations).toHaveLength(2);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "managed-tools:child:1",
      status: "failed",
      lifecycleState: "timed_out",
      childSessionId: "managed-tools:child-session:1",
      childTurnId: "managed-tools:child-turn:1",
      timeoutMs: 120000,
      timeoutSource: "explicit-route",
      eventCount: 2,
      transcript: {
        uri: "kiln://managed-agents/invocations/managed-tools%3Achild%3A1/transcript",
        persisted: true,
        truncated: false,
      },
      resultHandoff: {
        summary: "Child timed out after partial evidence.",
        resourceUris: ["kiln://managed-agents/invocations/managed-tools%3Achild%3A1/resources/timeout"],
        memoryWriteProposalUris: [],
      },
    });
    expect(projection.invocations[1]).toMatchObject({
      managedInvocationId: "managed-tools:child:2",
      status: "failed",
      lifecycleState: "timed_out",
      childSessionId: "managed-tools:child-session:2",
      childTurnId: "managed-tools:child-turn:2",
      providerRoute: "codex/gpt-5.5",
      timeoutMs: 45000,
      timeoutSource: "route-default",
      target: {
        instanceId: "managed-tools:instance:gui",
        sessionId: "managed-tools:session:1",
        managedInvocationId: "managed-tools:child:2",
      },
    });
  });

  it("deduplicates repeated running managed-agent replay snapshots", () => {
    const rawEvents: readonly OperatorSessionEvent[] = [{
      eventId: "dedupe:event:start",
      kilnSessionId: "dedupe:session:1",
      sequence: 1,
      timestamp: "2026-05-27T12:00:00.000Z",
      kind: "tool_call_completed",
      payload: {
        sessionId: "dedupe:session:1",
        toolCallId: "dedupe:tool:start",
        toolName: "managed_agent.start",
        state: "succeeded",
        metadata: {
          kind: "managed-invocation",
          managedInvocationId: "dedupe:child:1",
          agentId: "agent-reviewer",
          lifecycleState: "running",
        },
      },
    }, {
      eventId: "dedupe:event:list-running",
      kilnSessionId: "dedupe:session:1",
      sequence: 2,
      timestamp: "2026-05-27T12:00:01.000Z",
      kind: "tool_call_completed",
      payload: {
        sessionId: "dedupe:session:1",
        toolCallId: "dedupe:tool:list",
        toolName: "managed_agent.list",
        state: "succeeded",
        output: JSON.stringify({
          invocations: [{
            invocationId: "dedupe:child:1",
            agentId: "agent-reviewer",
            lifecycleState: "running",
          }],
        }),
      },
    }, {
      eventId: "dedupe:event:join",
      kilnSessionId: "dedupe:session:1",
      sequence: 3,
      timestamp: "2026-05-27T12:00:02.000Z",
      kind: "tool_call_completed",
      payload: {
        sessionId: "dedupe:session:1",
        toolCallId: "dedupe:tool:join",
        toolName: "managed_agent.join",
        state: "succeeded",
        metadata: {
          kind: "managed-invocation",
          managedInvocationId: "dedupe:child:1",
          agentId: "agent-reviewer",
          lifecycleState: "completed",
        },
      },
    }];

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-27T12:01:00.000Z",
      attachTargets: [{
        instanceId: "dedupe:instance:gui",
        label: "Local GUI",
        kind: "local",
      }],
      events: normalizeManagedAgentOperatorEvents(rawEvents, {
        defaultInstanceId: "dedupe:instance:gui",
      }),
    });

    expect(projection.timeline.map((event) => event.eventId)).toEqual([
      "dedupe:event:start:managed:dedupe:child:1:agent_invocation_started",
      "dedupe:event:join:managed:dedupe:child:1:agent_invocation_completed",
    ]);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "dedupe:child:1",
      status: "completed",
      eventCount: 2,
    });
  });

  it("enriches a canonical started replay with later managed tool terminal evidence", () => {
    const rawEvents: readonly OperatorSessionEvent[] = [{
      eventId: "mixed-replay:event:started",
      kilnSessionId: "mixed-replay:session:1",
      sequence: 1,
      timestamp: "2026-05-27T12:00:00.000Z",
      kind: "agent_invocation_started",
      payload: {
        sessionId: "mixed-replay:session:1",
        managedInvocationId: "mixed-replay:child:1",
        agentId: "agent-reviewer",
        lifecycleState: "running",
      },
    }, {
      eventId: "mixed-replay:event:join",
      kilnSessionId: "mixed-replay:session:1",
      sequence: 2,
      timestamp: "2026-05-27T12:00:03.000Z",
      kind: "tool_call_completed",
      payload: {
        sessionId: "mixed-replay:session:1",
        toolCallId: "mixed-replay:tool:join",
        toolName: "managed_agent.join",
        state: "succeeded",
        metadata: {
          kind: "managed-invocation",
          managedInvocationId: "mixed-replay:child:1",
          agentId: "agent-reviewer",
          lifecycleState: "completed",
          transcript: {
            uri: "kiln://managed-agents/invocations/mixed-replay%3Achild%3A1/transcript",
            persisted: true,
            truncated: false,
          },
          resultHandoff: {
            summary: "Child completed from late join evidence.",
            resourceUris: ["kiln://managed-agents/invocations/mixed-replay%3Achild%3A1/transcript"],
            memoryWriteProposalUris: [],
          },
        },
      },
    }];

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-27T12:01:00.000Z",
      attachTargets: [{
        instanceId: "mixed-replay:instance:gui",
        label: "Local GUI",
        kind: "local",
      }],
      events: normalizeManagedAgentOperatorEvents(rawEvents, {
        defaultInstanceId: "mixed-replay:instance:gui",
      }),
    });

    expect(projection.timeline.map((event) => event.eventId)).toEqual([
      "mixed-replay:event:started",
      "mixed-replay:event:join:managed:mixed-replay:child:1:agent_invocation_completed",
    ]);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "mixed-replay:child:1",
      status: "completed",
      lifecycleState: "completed",
      eventCount: 2,
      transcript: {
        uri: "kiln://managed-agents/invocations/mixed-replay%3Achild%3A1/transcript",
        persisted: true,
        truncated: false,
      },
      resultHandoff: {
        summary: "Child completed from late join evidence.",
        resourceUris: ["kiln://managed-agents/invocations/mixed-replay%3Achild%3A1/transcript"],
        memoryWriteProposalUris: [],
      },
    });
  });

  it("keeps canonical start, terminal list replay, and richer join replay in order", () => {
    const rawEvents: readonly OperatorSessionEvent[] = [{
      eventId: "mixed-list-join:event:started",
      kilnSessionId: "mixed-list-join:session:1",
      sequence: 1,
      timestamp: "2026-05-27T12:00:00.000Z",
      kind: "agent_invocation_started",
      payload: {
        sessionId: "mixed-list-join:session:1",
        managedInvocationId: "mixed-list-join:child:1",
        agentId: "agent-reviewer",
        lifecycleState: "running",
      },
    }, {
      eventId: "mixed-list-join:event:list",
      kilnSessionId: "mixed-list-join:session:1",
      sequence: 2,
      timestamp: "2026-05-27T12:00:02.000Z",
      kind: "tool_call_completed",
      payload: {
        sessionId: "mixed-list-join:session:1",
        toolCallId: "mixed-list-join:tool:list",
        toolName: "managed_agent.list",
        state: "succeeded",
        output: JSON.stringify({
          invocations: [{
            invocationId: "mixed-list-join:child:1",
            agentId: "agent-reviewer",
            lifecycleState: "completed",
          }],
        }),
      },
    }, {
      eventId: "mixed-list-join:event:join",
      kilnSessionId: "mixed-list-join:session:1",
      sequence: 3,
      timestamp: "2026-05-27T12:00:03.000Z",
      kind: "tool_call_completed",
      payload: {
        sessionId: "mixed-list-join:session:1",
        toolCallId: "mixed-list-join:tool:join",
        toolName: "managed_agent.join",
        state: "succeeded",
        metadata: {
          kind: "managed-invocation",
          managedInvocationId: "mixed-list-join:child:1",
          agentId: "agent-reviewer",
          lifecycleState: "completed",
          transcript: {
            uri: "kiln://managed-agents/invocations/mixed-list-join%3Achild%3A1/transcript",
            persisted: true,
            truncated: false,
          },
          resultHandoff: {
            summary: "Child completed with richer join evidence.",
            resourceUris: ["kiln://managed-agents/invocations/mixed-list-join%3Achild%3A1/transcript"],
            memoryWriteProposalUris: [],
          },
        },
      },
    }];

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-27T12:01:00.000Z",
      attachTargets: [{
        instanceId: "mixed-list-join:instance:gui",
        label: "Local GUI",
        kind: "local",
      }],
      events: normalizeManagedAgentOperatorEvents(rawEvents, {
        defaultInstanceId: "mixed-list-join:instance:gui",
      }),
    });

    expect(projection.timeline.map((event) => event.eventId)).toEqual([
      "mixed-list-join:event:started",
      "mixed-list-join:event:list:managed:mixed-list-join:child:1:agent_invocation_completed",
      "mixed-list-join:event:join:managed:mixed-list-join:child:1:agent_invocation_completed",
    ]);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "mixed-list-join:child:1",
      status: "completed",
      lifecycleState: "completed",
      eventCount: 3,
      latestEventId: "mixed-list-join:event:join:managed:mixed-list-join:child:1:agent_invocation_completed",
      transcript: {
        uri: "kiln://managed-agents/invocations/mixed-list-join%3Achild%3A1/transcript",
        persisted: true,
        truncated: false,
      },
      resultHandoff: {
        summary: "Child completed with richer join evidence.",
        resourceUris: ["kiln://managed-agents/invocations/mixed-list-join%3Achild%3A1/transcript"],
        memoryWriteProposalUris: [],
      },
    });
  });

  it("allows join evidence to enrich a terminal list replay snapshot", () => {
    const rawEvents: readonly OperatorSessionEvent[] = [{
      eventId: "enrich:event:list-completed",
      kilnSessionId: "enrich:session:1",
      sequence: 1,
      timestamp: "2026-05-27T12:00:00.000Z",
      kind: "tool_call_completed",
      payload: {
        sessionId: "enrich:session:1",
        toolCallId: "enrich:tool:list",
        toolName: "managed_agent.list",
        state: "succeeded",
        output: JSON.stringify({
          invocations: [{
            invocationId: "enrich:child:1",
            agentId: "agent-reviewer",
            lifecycleState: "completed",
          }],
        }),
      },
    }, {
      eventId: "enrich:event:join-completed",
      kilnSessionId: "enrich:session:1",
      sequence: 2,
      timestamp: "2026-05-27T12:00:02.000Z",
      kind: "tool_call_completed",
      payload: {
        sessionId: "enrich:session:1",
        toolCallId: "enrich:tool:join",
        toolName: "managed_agent.join",
        state: "succeeded",
        metadata: {
          kind: "managed-invocation",
          managedInvocationId: "enrich:child:1",
          agentId: "agent-reviewer",
          lifecycleState: "completed",
          transcript: {
            uri: "kiln://managed-agents/invocations/enrich%3Achild%3A1/transcript",
            persisted: true,
            truncated: false,
          },
          resultHandoff: {
            summary: "Child completed with transcript evidence.",
            resourceUris: ["kiln://managed-agents/invocations/enrich%3Achild%3A1/transcript"],
            memoryWriteProposalUris: [],
          },
        },
      },
    }];

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-27T12:01:00.000Z",
      attachTargets: [{
        instanceId: "enrich:instance:gui",
        label: "Local GUI",
        kind: "local",
      }],
      events: normalizeManagedAgentOperatorEvents(rawEvents, {
        defaultInstanceId: "enrich:instance:gui",
      }),
    });

    expect(projection.timeline.map((event) => event.eventId)).toEqual([
      "enrich:event:list-completed:managed:enrich:child:1:agent_invocation_completed",
      "enrich:event:join-completed:managed:enrich:child:1:agent_invocation_completed",
    ]);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "enrich:child:1",
      status: "completed",
      lifecycleState: "completed",
      eventCount: 2,
      latestEventId: "enrich:event:join-completed:managed:enrich:child:1:agent_invocation_completed",
      transcript: {
        uri: "kiln://managed-agents/invocations/enrich%3Achild%3A1/transcript",
        persisted: true,
        truncated: false,
      },
      resultHandoff: {
        summary: "Child completed with transcript evidence.",
        resourceUris: ["kiln://managed-agents/invocations/enrich%3Achild%3A1/transcript"],
        memoryWriteProposalUris: [],
      },
    });
  });

  it("normalizes managed-agent transcript replay envelopes inside gateway contracts", () => {
    const replayEvents: readonly ManagedAgentOperatorReplayEnvelope[] = [{
      eventId: "replay:event:started",
      kilnSessionId: "replay:session:1",
      sequence: 1,
      timestamp: "2026-05-27T12:00:00.000Z",
      kind: "agent_invocation_started",
      payload: {
        invocationId: "replay:child:1",
        agentId: "agent-reviewer",
        lifecycleState: "running",
      },
    }, {
      eventId: "replay:event:mismatch",
      kilnSessionId: "replay:session:1",
      sequence: 2,
      timestamp: "2026-05-27T12:00:01.000Z",
      kind: "agent_invocation_completed",
      payload: {
        sessionId: "replay:session:other",
        invocationId: "replay:child:mismatch",
        agentId: "agent-reviewer",
        lifecycleState: "completed",
      },
    }, {
      eventId: "replay:event:join",
      kilnSessionId: "replay:session:1",
      sequence: 3,
      timestamp: "2026-05-27T12:00:02.000Z",
      kind: "tool_call_completed",
      payload: {
        toolName: "managed_agent.join",
        metadata: {
          kind: "managed-invocation",
          invocationId: "replay:child:2",
          lifecycleState: "completed",
          resultHandoff: {
            summary: "Replay child completed from persisted tool evidence.",
            resourceUris: ["kiln://managed-agents/invocations/replay%3Achild%3A2/handoff"],
            memoryWriteProposalUris: [],
          },
        },
      },
    }];

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-27T12:01:00.000Z",
      attachTargets: [{
        instanceId: "replay:instance:cli",
        label: "Local CLI",
        kind: "local",
      }],
      events: normalizeManagedAgentOperatorReplayEvents(replayEvents, {
        defaultInstanceId: "replay:instance:cli",
      }),
    });

    expect(projection.timeline.map((event) => event.eventId)).not.toContain("replay:event:mismatch");
    expect(projection.invocations.map((invocation) => invocation.managedInvocationId)).toEqual([
      "replay:child:1",
      "replay:child:2",
    ]);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "replay:child:1",
      sessionId: "replay:session:1",
      target: {
        instanceId: "replay:instance:cli",
        sessionId: "replay:session:1",
      },
    });
    expect(projection.invocations[1]).toMatchObject({
      managedInvocationId: "replay:child:2",
      status: "completed",
      resultHandoff: {
        summary: "Replay child completed from persisted tool evidence.",
        resourceUris: ["kiln://managed-agents/invocations/replay%3Achild%3A2/handoff"],
        memoryWriteProposalUris: [],
      },
    });
  });

  it("projects non-substantive managed handoff recovery from managed_agent.invoke evidence", () => {
    const rawEvents: readonly OperatorSessionEvent[] = [{
      eventId: "recovery:event:invoke",
      kilnSessionId: "recovery:session:1",
      sequence: 1,
      timestamp: "2026-05-29T12:00:00.000Z",
      turnId: "recovery:turn:1",
      kind: "tool_call_completed",
      payload: {
        sessionId: "recovery:session:1",
        toolCallId: "recovery:tool:invoke",
        toolName: "managed_agent.invoke",
        state: "succeeded",
        metadata: {
          kind: "managed-invocation",
          managedInvocationId: "recovery:child:1",
          invocationId: "recovery:child:1",
          parentSessionId: "recovery:session:1",
          parentTurnId: "recovery:turn:1",
          childSessionId: "recovery:child-session:1",
          childTurnId: "recovery:child-turn:1",
          routeId: "visual-researcher",
          routeSource: "phase-route",
          status: "handoff_not_substantive",
          lifecycleState: "completed",
          timeoutMs: 300000,
          timeoutSource: "explicit-route",
          providerRoute: {
            providerId: "opencode-go",
            model: "qwen3.6-plus",
          },
          transcript: {
            uri: "kiln://artifacts/managed-invocations/recovery-child/transcript",
            persisted: true,
            truncated: false,
          },
          resultHandoff: {
            summary: "Direct provider managed invocation finished without final handoff text. Inspect the transcript resource before recording governed evidence.",
            resourceUris: ["kiln://artifacts/managed-invocations/recovery-child/content"],
            memoryWriteProposalUris: [],
          },
          managedInvocationRecovery: {
            status: "phase_evidence_required",
            nextTool: "work_item.update",
            thenTool: "work_item.execution.start",
            workItemId: "work-1",
            evidenceToRecord: ["visual-reference-research"],
            requiredToolNames: ["read", "glob", "grep"],
            sourceResourceUris: [
              "kiln://artifacts/managed-invocations/recovery-child/content",
              "kiln://artifacts/managed-invocations/recovery-child/phase-recovery",
            ],
            inspectionTool: "resource_read",
            blockedWorkItemUpdateInputTemplate: {
              id: "work-1",
              status: "blocked",
              pauseRequirements: [{
                id: "managed-invocation-handoff-recovery",
                kind: "operator_input",
                summary: "No qualifying evidence after inspection.",
                status: "pending",
              }],
            },
            blockedWhen: "Use blockedWorkItemUpdateInputTemplate if sourceResourceUris and local recovery cannot produce qualifying evidence.",
          },
        },
      },
    }];

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-29T12:01:00.000Z",
      attachTargets: [{
        instanceId: "recovery:instance:gui",
        label: "GUI",
        kind: "local",
      }],
      events: normalizeManagedAgentOperatorEvents(rawEvents, {
        defaultInstanceId: "recovery:instance:gui",
      }),
    });

    expect(projection.timeline.map((event) => event.eventId)).toEqual([
      "recovery:event:invoke:managed:recovery:child:1:agent_invocation_failed",
    ]);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "recovery:child:1",
      status: "failed",
      lifecycleState: "handoff_not_substantive",
      parentTurnId: "recovery:turn:1",
      childSessionId: "recovery:child-session:1",
      childTurnId: "recovery:child-turn:1",
      routeId: "visual-researcher",
      routeSource: "phase-route",
      providerRoute: "opencode-go/qwen3.6-plus",
      timeoutMs: 300000,
      timeoutSource: "explicit-route",
      transcript: {
        uri: "kiln://artifacts/managed-invocations/recovery-child/transcript",
        persisted: true,
        truncated: false,
      },
      resultHandoff: {
        summary: "Direct provider managed invocation finished without final handoff text. Inspect the transcript resource before recording governed evidence.",
        resourceUris: ["kiln://artifacts/managed-invocations/recovery-child/content"],
        memoryWriteProposalUris: [],
      },
      managedInvocationRecovery: {
        status: "phase_evidence_required",
        nextTool: "work_item.update",
        thenTool: "work_item.execution.start",
        workItemId: "work-1",
        evidenceToRecord: ["visual-reference-research"],
        requiredToolNames: ["read", "glob", "grep"],
        sourceResourceUris: [
          "kiln://artifacts/managed-invocations/recovery-child/content",
          "kiln://artifacts/managed-invocations/recovery-child/phase-recovery",
        ],
        inspectionTool: "resource_read",
        blockedWorkItemUpdateInputTemplate: {
          id: "work-1",
          status: "blocked",
          pauseRequirements: [{
            id: "managed-invocation-handoff-recovery",
            kind: "operator_input",
            summary: "No qualifying evidence after inspection.",
            status: "pending",
          }],
        },
        blockedWhen: "Use blockedWorkItemUpdateInputTemplate if sourceResourceUris and local recovery cannot produce qualifying evidence.",
      },
    });
    expect(projection.invocations[0]?.evidenceResourceUris).toEqual([
      "kiln://artifacts/managed-invocations/recovery-child/content",
      "kiln://artifacts/managed-invocations/recovery-child/phase-recovery",
      "kiln://artifacts/managed-invocations/recovery-child/transcript",
    ]);
  });

  it("projects route-profile conflicts as failed managed invocation attention", () => {
    const rawEvents: readonly OperatorSessionEvent[] = [{
      eventId: "route-conflict:event:invoke",
      kilnSessionId: "route-conflict:session:1",
      sequence: 1,
      timestamp: "2026-05-29T13:00:00.000Z",
      turnId: "route-conflict:turn:1",
      kind: "tool_call_completed",
      payload: {
        sessionId: "route-conflict:session:1",
        toolCallId: "route-conflict:tool:invoke",
        toolName: "managed_agent.invoke",
        state: "failed",
        metadata: {
          kind: "managed-invocation",
          managedInvocationId: "route-conflict:child:1",
          invocationId: "route-conflict:child:1",
          parentSessionId: "route-conflict:session:1",
          parentTurnId: "route-conflict:turn:1",
          status: "route_profile_conflict",
          lifecycleState: "route_profile_conflict",
          nextTool: "managed_agent.invoke",
          forbiddenInputFields: ["agentProfile"],
          retryInputTemplate: {
            routeId: "opencode-readonly",
            workItemId: "work-ui",
            forbiddenInputFields: ["agentProfile"],
          },
        },
      },
    }];

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-29T13:01:00.000Z",
      attachTargets: [{
        instanceId: "route-conflict:instance:gui",
        label: "GUI",
        kind: "local",
      }],
      events: normalizeManagedAgentOperatorEvents(rawEvents, {
        defaultInstanceId: "route-conflict:instance:gui",
      }),
    });

    expect(projection.timeline.map((event) => event.eventId)).toEqual([
      "route-conflict:event:invoke:managed:route-conflict:child:1:agent_invocation_failed",
    ]);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "route-conflict:child:1",
      status: "failed",
      lifecycleState: "route_profile_conflict",
      parentTurnId: "route-conflict:turn:1",
    });
  });

  it("projects tool resource links as target-aware read-only cockpit resources", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "resource-links",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 0,
      childInvocationCount: 0,
      eventCount: 2,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const toolEvent: OperatorSessionEvent = {
      ...fixture.events[1]!,
      eventId: "resource-links:event:2",
      kind: "tool_call_completed",
      payload: {
        fixtureId: "resource-links",
        instanceId: "resource-links:instance:1",
        sessionId: "resource-links:session:1",
        toolCallId: "resource-links:tool:read-many",
        toolName: "read_many",
        output: JSON.stringify({
          result: {
            output: "2 files read",
            metadata: {
              operation: "read_many",
              fileCount: 2,
              resourceLinks: [
                {
                  uri: "kiln://artifacts/read-many/content",
                  title: "Read Many Content",
                  mimeType: "application/json",
                  relation: "full_output",
                },
                {
                  uri: "kiln://artifacts/read-many/summary",
                  title: "Read Many Summary",
                  relation: "summary",
                },
              ],
            },
          },
        }),
        state: "succeeded",
      },
    };

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:05:00.000Z",
      attachTargets: [
        {
          instanceId: "resource-links:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: [
        fixture.events[0]!,
        toolEvent,
      ],
    });

    expect(projection.instances[0]).toMatchObject({
      resourceLinkCount: 2,
    });
    expect(projection.sessions[0]).toMatchObject({
      resourceLinkCount: 2,
    });
    expect(projection.timeline[1]?.resourceLinks).toEqual([
      {
        uri: "kiln://artifacts/read-many/content",
        title: "Read Many Content",
        mimeType: "application/json",
        relation: "full_output",
        target: {
          instanceId: "resource-links:instance:1",
          sessionId: "resource-links:session:1",
          eventId: "resource-links:event:2",
          toolCallId: "resource-links:tool:read-many",
          resourceUri: "kiln://artifacts/read-many/content",
        },
      },
      {
        uri: "kiln://artifacts/read-many/summary",
        title: "Read Many Summary",
        relation: "summary",
        target: {
          instanceId: "resource-links:instance:1",
          sessionId: "resource-links:session:1",
          eventId: "resource-links:event:2",
          toolCallId: "resource-links:tool:read-many",
          resourceUri: "kiln://artifacts/read-many/summary",
        },
      },
    ]);
    expect(projection.toolSummaries[0]).toMatchObject({
      resourceLinkCount: 2,
      resourceLinks: [
        expect.objectContaining({
          uri: "kiln://artifacts/read-many/content",
          target: {
            instanceId: "resource-links:instance:1",
            sessionId: "resource-links:session:1",
            eventId: "resource-links:event:2",
            toolCallId: "resource-links:tool:read-many",
            resourceUri: "kiln://artifacts/read-many/content",
          },
        }),
        expect.objectContaining({
          uri: "kiln://artifacts/read-many/summary",
        }),
      ],
    });
  });
});
