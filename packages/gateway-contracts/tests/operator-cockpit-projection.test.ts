import { describe, expect, it } from "vitest";
import type { OperatorSessionEvent } from "../src/frames.js";
import { createOperatorCockpitFixture } from "./fixtures/operator-cockpit.js";
import {
  createOperatorCockpitReadOnlyAttachPlan,
  type ManagedAgentOperatorReplayEnvelope,
  normalizeManagedAgentOperatorEvents,
  normalizeManagedAgentOperatorReplayEvents,
  projectOperatorCockpitReadOnlyView,
} from "../src/operator-cockpit-projection.js";
import {
  MANAGED_ACCOUNT_LEASE_FIXTURE,
  managedAccountLeaseEvents,
  managedAccountLeaseSettledEvent,
} from "./fixtures/managed-account-lease.js";
import {
  MANAGED_ECONOMIC_LIFECYCLE_FIXTURE,
  managedEconomicLifecycleEvents,
  managedEconomicLifecycleUnprojectableEvents,
} from "./fixtures/managed-economic-lifecycle.js";

describe("operator cockpit read-only projection", () => {
  it("projects the shared complete managed economic lifecycle and preserves invalid evidence as sanitized rejections", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-08-08T12:01:00.000Z",
      attachTargets: [{
        instanceId: MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.instanceId,
        label: "Synthetic managed economic runtime",
        kind: "local",
      }],
      events: [...managedEconomicLifecycleEvents, ...managedEconomicLifecycleUnprojectableEvents],
    });

    expect(projection.economicAttempts.find((attempt) => (
      attempt.economicAttemptId === MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.economicAttemptId
    ))).toEqual(expect.objectContaining({
      jobId: MANAGED_ECONOMIC_LIFECYCLE_FIXTURE.jobId,
      transition: "released",
      eventCount: 7,
      rejections: expect.arrayContaining([
        expect.objectContaining({ stage: "economic-selection" }),
        expect.objectContaining({ stage: "account-selection" }),
        expect.objectContaining({ stage: "local-capacity" }),
        expect.objectContaining({ stage: "commitment-conflict" }),
      ]),
    }));
    expect(projection.unprojectableEvidence).toEqual([
      expect.objectContaining({ eventId: "economic-lifecycle:event:8", field: "evidenceVersion" }),
      expect.objectContaining({ eventId: "economic-lifecycle:event:9", field: "evidenceVersion" }),
      expect.objectContaining({ eventId: "economic-lifecycle:event:10", field: "evidenceVersion" }),
      expect.objectContaining({ eventId: "economic-lifecycle:event:11", field: "rejections" }),
    ]);
    expect(JSON.stringify(projection)).not.toContain("secret-account-shaped-value");
    expect(JSON.stringify(projection)).not.toContain("secret-credential-shaped-value");
    expect(JSON.stringify(projection)).not.toContain("synthetic\\\\private-path");
  });

  it("projects the shared canonical managed account lease fixture", () => {
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T12:01:00.000Z",
      attachTargets: [{
        instanceId: MANAGED_ACCOUNT_LEASE_FIXTURE.instanceId,
        label: "Synthetic managed account runtime",
        kind: "local",
      }],
      events: managedAccountLeaseEvents,
    });

    expect(projection.invocations[0]?.accountLease).toMatchObject({
      leaseId: MANAGED_ACCOUNT_LEASE_FIXTURE.leaseId,
      accountPolicyId: MANAGED_ACCOUNT_LEASE_FIXTURE.accountPolicyId,
      accountRef: MANAGED_ACCOUNT_LEASE_FIXTURE.accountRef,
      lifecycleState: MANAGED_ACCOUNT_LEASE_FIXTURE.lifecycleState,
      selectionReason: MANAGED_ACCOUNT_LEASE_FIXTURE.selectionReason,
      candidateRejections: [{
        accountRef: "configured:fixture-rejected:opaque",
        reason: "unhealthy",
      }],
      usageEvidence: {
        freshness: "fresh",
        availability: "available",
        source: "provider-endpoint",
        confidence: "authoritative",
      },
    });
  });

  it("rejects contradictory managed account usage evidence", () => {
    const event = structuredClone(managedAccountLeaseSettledEvent);
    const payload = event.payload as Record<string, unknown> & {
      managedInvocationEvidence: {
        lifecycle: {
          accountLease: {
            usageEvidence: Record<string, unknown>;
          };
        };
      };
    };
    payload.managedInvocationEvidence.lifecycle.accountLease.usageEvidence = {
      health: "healthy",
      freshness: "missing",
      availability: "available",
    };

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T12:01:00.000Z",
      attachTargets: [{
        instanceId: MANAGED_ACCOUNT_LEASE_FIXTURE.instanceId,
        label: "Synthetic managed account runtime",
        kind: "local",
      }],
      events: [event],
    });

    expect(projection.invocations[0]?.accountLease).toBeUndefined();
  });

  it("projects successful managed affinity commit evidence without deriving policy", () => {
    const completed: OperatorSessionEvent = {
      ...structuredClone(managedAccountLeaseSettledEvent),
      kind: "agent_invocation_completed",
    };
    const payload = completed.payload as Record<string, unknown> & {
      lifecycleState: string;
      managedInvocationEvidence: {
        lifecycle: {
          accountLease: {
            affinityCommitOutcome?: string;
            diagnosticUris: string[];
            lifecycleState: string;
            releasedAt?: string;
          };
        };
      };
    };
    payload.lifecycleState = "completed";
    payload.managedInvocationEvidence.lifecycle.accountLease.affinityCommitOutcome = "won";
    payload.managedInvocationEvidence.lifecycle.accountLease.diagnosticUris = [];

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T12:01:00.000Z",
      attachTargets: [{
        instanceId: MANAGED_ACCOUNT_LEASE_FIXTURE.instanceId,
        label: "Synthetic managed account runtime",
        kind: "local",
      }],
      events: [completed],
    });

    expect(projection.invocations[0]?.accountLease).toMatchObject({
      accountRef: MANAGED_ACCOUNT_LEASE_FIXTURE.accountRef,
      lifecycleState: "released",
      affinityCommitOutcome: "won",
    });

    payload.managedInvocationEvidence.lifecycle.accountLease.lifecycleState = "held";
    delete payload.managedInvocationEvidence.lifecycle.accountLease.releasedAt;
    const premature = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T12:01:00.000Z",
      attachTargets: [{
        instanceId: MANAGED_ACCOUNT_LEASE_FIXTURE.instanceId,
        label: "Synthetic managed account runtime",
        kind: "local",
      }],
      events: [completed],
    });
    expect(premature.invocations[0]?.accountLease).toBeUndefined();

    payload.managedInvocationEvidence.lifecycle.accountLease.lifecycleState = "released";
    payload.managedInvocationEvidence.lifecycle.accountLease.releasedAt =
      MANAGED_ACCOUNT_LEASE_FIXTURE.releasedAt;
    payload.managedInvocationEvidence.lifecycle.accountLease.affinityCommitOutcome = "overwritten";
    const rejected = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-07-28T12:01:00.000Z",
      attachTargets: [{
        instanceId: MANAGED_ACCOUNT_LEASE_FIXTURE.instanceId,
        label: "Synthetic managed account runtime",
        kind: "local",
      }],
      events: [completed],
    });
    expect(rejected.invocations[0]?.accountLease).toBeUndefined();
  });

  it("projects canonical events into target-aware cockpit views without mutation authority", () => {
    const fixture = createOperatorCockpitFixture({
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
    const fixture = createOperatorCockpitFixture({
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
    const fixture = createOperatorCockpitFixture({
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
        {
          instanceId: "attach-plan:local-app",
          label: "Local app",
          kind: "local",
          gatewayUrl: "http://127.0.0.1:3800",
          gatewayTarget: {
            targetId: "gateway:local-app",
            kind: "local-app-gateway",
            trust: "local",
            appId: "crm",
            tenantId: "demo",
          },
        },
      ],
    });

    expect(plan).toEqual({
      mode: "read-only",
      plannedAt: "2026-05-14T12:04:00.000Z",
      targetCount: 3,
      mutationDispatch: "disabled",
      targets: [
        {
          instanceId: "attach-plan:local",
          label: "Local / kiln",
          kind: "local",
          gatewayTarget: {
            targetId: "attach-plan:local",
            kind: "local-operator-gateway",
            trust: "local",
            label: "Local / kiln",
            gatewayUrl: "http://127.0.0.1:4810",
          },
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
          gatewayTarget: {
            targetId: "attach-plan:remote",
            kind: "simulated-app-gateway",
            trust: "simulated",
            label: "Simulated remote",
            gatewayUrl: "https://example.invalid",
          },
          gatewayUrl: "https://example.invalid",
          connectionKind: "simulated-app-gateway",
          transport: "simulated-http-ws",
          connectionState: "planned",
          mutationDispatch: "disabled",
        },
        {
          instanceId: "attach-plan:local-app",
          label: "Local app",
          kind: "local",
          gatewayTarget: {
            targetId: "gateway:local-app",
            kind: "local-app-gateway",
            trust: "local",
            label: "Local app",
            gatewayUrl: "http://127.0.0.1:3800",
            appId: "crm",
            tenantId: "demo",
          },
          gatewayUrl: "http://127.0.0.1:3800",
          connectionKind: "app-gateway",
          transport: "http-ws",
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
            accountLease: {
              leaseId: "account-lease-1",
              accountPolicyId: "managed-opencode",
              accountRef: "configured:account-a",
              route: {
                providerId: "opencode",
                providerModelId: "sonic",
                scope: "virtual:managed-opencode",
              },
              jobId: "lifecycle:child:1",
              runtimeInvocationId: "lifecycle:child:1",
              credentialRevisionId: "a".repeat(64),
              selectionReason: "least-pressure",
              acquiredAt: "2026-05-21T12:00:00.000Z",
              lifecycleState: "settlement-pending",
              resourceUris: ["kiln://managed-accounts/leases/account-lease-1"],
              diagnosticUris: ["kiln://managed-accounts/leases/account-lease-1/settlement-pending"],
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
      accountLease: {
        leaseId: "account-lease-1",
        accountPolicyId: "managed-opencode",
        accountRef: "configured:account-a",
        lifecycleState: "settlement-pending",
      },
    });
    expect(projection.invocations[0]?.evidenceResourceUris).toEqual(expect.arrayContaining([
      "kiln://managed-accounts/leases/account-lease-1",
      "kiln://managed-accounts/leases/account-lease-1/settlement-pending",
    ]));
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
            sourceResourceUris: [
              "kiln://session/work-items/work-source",
              "kiln://managed-invocations/evidence-child-1/context",
            ],
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
      sourceResourceUris: [
        "kiln://managed-invocations/evidence-child-1/context",
        "kiln://session/work-items/work-source",
      ],
      evidenceResourceUris: [
        "kiln://managed-invocations/evidence-child-1/cleanup-diagnostic",
        "kiln://managed-invocations/evidence-child-1/context",
        "kiln://managed-invocations/evidence-child-1/diagnostics",
        "kiln://managed-invocations/evidence-child-1/handoff",
        "kiln://managed-invocations/evidence-child-1/memory-proposal",
        "kiln://managed-invocations/evidence-child-1/transcript",
        "kiln://managed-invocations/evidence-child-1/worktree",
        "kiln://managed-invocations/evidence-child-1/worktree-review",
        "kiln://managed-invocations/evidence-child-1/worktree-review-diagnostic",
        "kiln://managed-invocations/evidence-child-1/write-attempts/1",
        "kiln://session/work-items/work-source",
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
          sourceResourceUris: ["kiln://session/work-items/replay-work"],
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
      sourceResourceUris: ["kiln://session/work-items/replay-work"],
      evidenceResourceUris: [
        "kiln://managed-agents/invocations/replay%3Achild%3A2/handoff",
        "kiln://session/work-items/replay-work",
      ],
    });
  });

  it("projects admitted managed invocation prompts without downgrading running lifecycle state", () => {
    const rawEvents: readonly OperatorSessionEvent[] = [{
      eventId: "prompt-admission:event:started",
      kilnSessionId: "prompt-admission:session:1",
      sequence: 1,
      timestamp: "2026-06-05T16:00:00.000Z",
      turnId: "prompt-admission:turn:1",
      kind: "agent_invocation_started",
      payload: {
        instanceId: "prompt-admission:instance:gui",
        sessionId: "prompt-admission:session:1",
        managedInvocationId: "prompt-admission:child:1",
        invocationId: "prompt-admission:child:1",
        agentId: "agent-reviewer",
        lifecycleState: "running",
      },
    }, {
      eventId: "prompt-admission:event:prompt-1",
      kilnSessionId: "prompt-admission:session:1",
      sequence: 2,
      timestamp: "2026-06-05T16:00:05.000Z",
      turnId: "prompt-admission:turn:1",
      kind: "agent_invocation_prompt_admitted",
      payload: {
        instanceId: "prompt-admission:instance:gui",
        sessionId: "prompt-admission:session:1",
        managedInvocationId: "prompt-admission:child:1",
        invocationId: "prompt-admission:child:1",
        agentId: "agent-reviewer",
        parentTurnId: "prompt-admission:turn:1",
        promptAdmissionId: "prompt-admission:prompt:1",
        deliveryMode: "steer",
        admissionState: "admitted",
        inputSummary: "Use the latest runtime ledger evidence.",
        promptHash: "sha256:5d41402abc4b2a76b9719d911017c592",
        wakeRequested: true,
      },
    }, {
      eventId: "prompt-admission:event:prompt-2",
      kilnSessionId: "prompt-admission:session:1",
      sequence: 3,
      timestamp: "2026-06-05T16:00:10.000Z",
      turnId: "prompt-admission:turn:1",
      kind: "agent_invocation_prompt_admitted",
      payload: {
        instanceId: "prompt-admission:instance:gui",
        sessionId: "prompt-admission:session:1",
        managedInvocationId: "prompt-admission:child:1",
        invocationId: "prompt-admission:child:1",
        agentId: "agent-reviewer",
        parentTurnId: "prompt-admission:turn:1",
        promptAdmissionId: "prompt-admission:prompt:2",
        deliveryMode: "queue",
        admissionState: "admitted",
        inputSummary: "Queue follow-up until the child reaches a safe boundary.",
        promptHash: "sha256:7d793037a0760186574b0282f2f435e7",
        wakeRequested: false,
      },
    }];

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-06-05T16:01:00.000Z",
      attachTargets: [{
        instanceId: "prompt-admission:instance:gui",
        label: "GUI",
        kind: "local",
      }],
      events: rawEvents,
    });

    expect(projection.timeline.map((event) => event.title)).toEqual([
      "Agent invocation started",
      "Agent prompt admitted",
      "Agent prompt admitted",
    ]);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "prompt-admission:child:1",
      status: "running",
      lifecycleState: "running",
      promptAdmissionCount: 2,
      latestPromptAdmission: {
        promptAdmissionId: "prompt-admission:prompt:2",
        deliveryMode: "queue",
        admissionState: "admitted",
        inputSummary: "Queue follow-up until the child reaches a safe boundary.",
        wakeRequested: false,
        eventId: "prompt-admission:event:prompt-2",
        sequence: 3,
      },
    });
  });

  it("projects stuck prompt recovery as replayable managed invocation evidence", () => {
    const rawEvents: readonly OperatorSessionEvent[] = [{
      eventId: "prompt-recovery:event:started",
      kilnSessionId: "prompt-recovery:session:1",
      sequence: 1,
      timestamp: "2026-06-05T16:00:00.000Z",
      turnId: "prompt-recovery:turn:1",
      kind: "agent_invocation_started",
      payload: {
        instanceId: "prompt-recovery:instance:gui",
        sessionId: "prompt-recovery:session:1",
        managedInvocationId: "prompt-recovery:child:1",
        invocationId: "prompt-recovery:child:1",
        agentId: "agent-reviewer",
        lifecycleState: "running",
      },
    }, {
      eventId: "prompt-recovery:event:prompt-1",
      kilnSessionId: "prompt-recovery:session:1",
      sequence: 2,
      timestamp: "2026-06-05T16:00:05.000Z",
      turnId: "prompt-recovery:turn:1",
      kind: "agent_invocation_prompt_admitted",
      payload: {
        instanceId: "prompt-recovery:instance:gui",
        sessionId: "prompt-recovery:session:1",
        managedInvocationId: "prompt-recovery:child:1",
        invocationId: "prompt-recovery:child:1",
        agentId: "agent-reviewer",
        parentTurnId: "prompt-recovery:turn:1",
        promptAdmissionId: "prompt-recovery:prompt:1",
        deliveryMode: "queue",
        deliveryState: "queued",
        admissionState: "admitted",
        inputSummary: "Queue follow-up until the child reaches a safe boundary.",
        promptHash: "sha256:7d793037a0760186574b0282f2f435e7",
        wakeRequested: false,
      },
    }, {
      eventId: "prompt-recovery:event:prompt-1:recovered",
      kilnSessionId: "prompt-recovery:session:1",
      sequence: 3,
      timestamp: "2026-06-05T16:02:05.000Z",
      turnId: "prompt-recovery:turn:1",
      kind: "agent_invocation_prompt_recovered",
      payload: {
        instanceId: "prompt-recovery:instance:gui",
        sessionId: "prompt-recovery:session:1",
        managedInvocationId: "prompt-recovery:child:1",
        invocationId: "prompt-recovery:child:1",
        agentId: "agent-reviewer",
        parentTurnId: "prompt-recovery:turn:1",
        promptAdmissionId: "prompt-recovery:prompt:1",
        deliveryMode: "queue",
        previousDeliveryState: "queued",
        deliveryState: "stale",
        recoveryReason: "Prompt remained queued beyond the managed-agent control timeout.",
        recoveredAt: "2026-06-05T16:02:05.000Z",
      },
    }];

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-06-05T16:03:00.000Z",
      attachTargets: [{
        instanceId: "prompt-recovery:instance:gui",
        label: "GUI",
        kind: "local",
      }],
      events: rawEvents,
    });

    expect(projection.timeline.map((event) => event.title)).toEqual([
      "Agent invocation started",
      "Agent prompt admitted",
      "Agent prompt recovered",
    ]);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "prompt-recovery:child:1",
      status: "running",
      lifecycleState: "running",
      promptAdmissionCount: 1,
      latestPromptAdmission: {
        promptAdmissionId: "prompt-recovery:prompt:1",
        deliveryMode: "queue",
        deliveryState: "stale",
        recovery: {
          reason: "Prompt remained queued beyond the managed-agent control timeout.",
          recoveredAt: "2026-06-05T16:02:05.000Z",
          eventId: "prompt-recovery:event:prompt-1:recovered",
        },
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
    const fixture = createOperatorCockpitFixture({
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
        toolCallScopeId: "resource-links:response:1",
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
          gatewayTargetId: "resource-links:instance:1",
          instanceId: "resource-links:instance:1",
          sessionId: "resource-links:session:1",
          eventId: "resource-links:event:2",
          toolCallId: "resource-links:tool:read-many",
          toolCallScopeId: "resource-links:response:1",
          resourceUri: "kiln://artifacts/read-many/content",
        },
      },
      {
        uri: "kiln://artifacts/read-many/summary",
        title: "Read Many Summary",
        relation: "summary",
        target: {
          gatewayTargetId: "resource-links:instance:1",
          instanceId: "resource-links:instance:1",
          sessionId: "resource-links:session:1",
          eventId: "resource-links:event:2",
          toolCallId: "resource-links:tool:read-many",
          toolCallScopeId: "resource-links:response:1",
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
            gatewayTargetId: "resource-links:instance:1",
            instanceId: "resource-links:instance:1",
            sessionId: "resource-links:session:1",
            eventId: "resource-links:event:2",
            toolCallId: "resource-links:tool:read-many",
            toolCallScopeId: "resource-links:response:1",
            resourceUri: "kiln://artifacts/read-many/content",
          },
        }),
        expect.objectContaining({
          uri: "kiln://artifacts/read-many/summary",
        }),
      ],
    });
  });

  it("folds managed_economic_lifecycle events into a top-level economic attempt, not an invocation", () => {
    const held: OperatorSessionEvent = {
      eventId: "economic:event:1",
      kilnSessionId: "economic:session:1",
      sequence: 1,
      timestamp: "2026-08-06T12:00:00.000Z",
      kind: "managed_economic_lifecycle",
      turnId: "economic:turn:1",
      payload: {
        instanceId: "economic:instance:1",
        sessionId: "economic:session:1",
        evidenceVersion: 1,
        jobId: "managed-economic-job:fixture",
        economicAttemptId: "economic-attempt:fixture:1",
        transition: "held",
        policyId: "fixture-policy",
        policyRevision: "1",
        policyDigest: "sha256:fixture-policy-digest",
        commitmentId: "fixture-commitment",
        reservationId: "fixture-reservation",
        selectedRoute: {
          routeId: "fixture-route",
          providerId: "codex-oauth",
          modelId: "gpt-test",
          adapterCapabilityId: "fixture-adapter",
          adapterCapabilityVersion: "1",
        },
        selectedAccount: { kind: "accountless" },
      },
    };
    const settled: OperatorSessionEvent = {
      eventId: "economic:event:2",
      kilnSessionId: "economic:session:1",
      sequence: 2,
      timestamp: "2026-08-06T12:00:05.000Z",
      kind: "managed_economic_lifecycle",
      turnId: "economic:turn:1",
      payload: {
        instanceId: "economic:instance:1",
        sessionId: "economic:session:1",
        evidenceVersion: 1,
        jobId: "managed-economic-job:fixture",
        economicAttemptId: "economic-attempt:fixture:1",
        transition: "released",
        policyId: "fixture-policy",
        policyRevision: "1",
        policyDigest: "sha256:fixture-policy-digest",
        commitmentId: "fixture-commitment",
        reservationId: "fixture-reservation",
        settlementKind: "charged",
        settlementAuthority: "provider-reported",
      },
    };

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-08-06T12:01:00.000Z",
      attachTargets: [{
        instanceId: "economic:instance:1",
        label: "Synthetic economic runtime",
        kind: "local",
      }],
      events: [held, settled],
    });

    expect(projection.economicAttempts).toHaveLength(1);
    expect(projection.economicAttempts[0]).toMatchObject({
      jobId: "managed-economic-job:fixture",
      economicAttemptId: "economic-attempt:fixture:1",
      transition: "released",
      policyId: "fixture-policy",
      selectedRoute: {
        providerId: "codex-oauth",
        modelId: "gpt-test",
      },
      selectedAccount: { kind: "accountless" },
      settlementKind: "charged",
      settlementAuthority: "provider-reported",
      eventCount: 2,
    });
    expect(projection.invocations).toHaveLength(0);
  });

  it("rejects legacy or incomplete settlement evidence without silently projecting it", () => {
    const basePayload = {
      instanceId: "economic:instance:1",
      sessionId: "economic:session:1",
      evidenceVersion: 1,
      jobId: "managed-economic-job:settlement-contract",
      economicAttemptId: "economic-attempt:settlement-contract:1",
      transition: "released",
      policyId: "fixture-policy",
      policyRevision: "1",
      policyDigest: "sha256:fixture-policy-digest",
    };
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-08-06T12:01:00.000Z",
      attachTargets: [{ instanceId: "economic:instance:1", label: "Synthetic economic runtime", kind: "local" }],
      events: [
        { eventId: "economic:settlement:legacy", kilnSessionId: "economic:session:1", sequence: 1, timestamp: "2026-08-06T12:00:00.000Z", kind: "managed_economic_lifecycle", payload: { ...basePayload, settlementKind: "charge", settlementAuthority: "authoritative" } },
        { eventId: "economic:settlement:orphan-authority", kilnSessionId: "economic:session:1", sequence: 2, timestamp: "2026-08-06T12:00:01.000Z", kind: "managed_economic_lifecycle", payload: { ...basePayload, settlementAuthority: "configured" } },
        { eventId: "economic:settlement:pending-authority", kilnSessionId: "economic:session:1", sequence: 3, timestamp: "2026-08-06T12:00:02.000Z", kind: "managed_economic_lifecycle", payload: { ...basePayload, settlementKind: "pending", settlementAuthority: "configured" } },
      ],
    });

    expect(projection.economicAttempts).toHaveLength(1);
    expect(projection.economicAttempts[0]).not.toHaveProperty("settlementKind");
    expect(projection.economicAttempts[0]).not.toHaveProperty("settlementAuthority");
    expect(projection.unprojectableEvidence).toEqual([
      expect.objectContaining({ eventId: "economic:settlement:legacy", field: "settlementKind" }),
      expect.objectContaining({ eventId: "economic:settlement:orphan-authority", field: "settlementKind" }),
      expect.objectContaining({ eventId: "economic:settlement:pending-authority", field: "settlementAuthority" }),
    ]);
  });

  describe("unprojectable evidence", () => {
    const attachTargets = [{
      instanceId: "economic:instance:1",
      label: "Synthetic economic runtime",
      kind: "local" as const,
    }];

    function economicEvent(
      sequence: number,
      payloadOverrides: Record<string, unknown>,
    ): OperatorSessionEvent {
      return {
        eventId: `economic:event:${sequence}`,
        kilnSessionId: "economic:session:1",
        sequence,
        timestamp: `2026-08-06T12:00:0${sequence}.000Z`,
        kind: "managed_economic_lifecycle",
        turnId: "economic:turn:1",
        payload: {
          instanceId: "economic:instance:1",
          sessionId: "economic:session:1",
          evidenceVersion: 1,
          jobId: "managed-economic-job:fixture",
          economicAttemptId: "economic-attempt:fixture:1",
          transition: "held",
          policyId: "fixture-policy",
          policyRevision: "1",
          policyDigest: "sha256:fixture-policy-digest",
          ...payloadOverrides,
        },
      };
    }

    it("rejects an economic event missing a required field instead of discarding it", () => {
      const projection = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-08-06T12:01:00.000Z",
        attachTargets,
        events: [economicEvent(1, { policyDigest: undefined })],
      });

      expect(projection.economicAttempts).toHaveLength(0);
      expect(projection.unprojectableEvidence).toEqual([{
        eventId: "economic:event:1",
        sequence: 1,
        kind: "managed_economic_lifecycle",
        reason: "missing-required-field",
        field: "policyDigest",
      }]);
    });

    it.each([
      ["missing", undefined, "missing-required-field"],
      ["malformed", "1", "contract-violation"],
      ["unsupported", 2, "unsupported-version"],
    ] as const)("rejects a %s economic evidence version without compatibility inference", (_label, evidenceVersion, reason) => {
      const projection = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-08-06T12:01:00.000Z",
        attachTargets,
        events: [economicEvent(1, { evidenceVersion })],
      });

      expect(projection.economicAttempts).toHaveLength(0);
      expect(projection.unprojectableEvidence).toEqual([{
        eventId: "economic:event:1",
        sequence: 1,
        kind: "managed_economic_lifecycle",
        reason,
        field: "evidenceVersion",
      }]);
    });

    it("projects typed staged denials without account-shaped evidence", () => {
      const projection = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-08-06T12:01:00.000Z",
        attachTargets,
        events: [economicEvent(1, {
          transition: "denied",
          rejections: [
            { stage: "economic-selection", routeId: "route-codex", reason: "ceiling-exceeded" },
            { stage: "account-selection", routeId: "route-opencode", reason: "lease-conflict", count: 2 },
            { stage: "local-capacity", routeId: "route-opencode", reason: "route-capacity-exhausted" },
            { stage: "commitment-conflict", reason: "identity-revision-conflict" },
          ],
        })],
      });

      expect(projection.economicAttempts[0]).toMatchObject({
        transition: "denied",
        rejections: [
          { stage: "economic-selection", routeId: "route-codex", reason: "ceiling-exceeded" },
          { stage: "account-selection", routeId: "route-opencode", reason: "lease-conflict", count: 2 },
          { stage: "local-capacity", routeId: "route-opencode", reason: "route-capacity-exhausted" },
          { stage: "commitment-conflict", reason: "identity-revision-conflict" },
        ],
      });
      const serialized = JSON.stringify(projection);
      expect(serialized).not.toContain("accountRef");
      expect(serialized).not.toContain("credentialRevision");
    });

    it("rejects account-shaped fields in staged denial evidence", () => {
      const projection = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-08-06T12:01:00.000Z",
        attachTargets,
        events: [economicEvent(1, {
          transition: "denied",
          rejections: [{
            stage: "account-selection",
            routeId: "route-opencode",
            reason: "lease-conflict",
            count: 1,
            accountRef: "secret-account-ref",
          }],
        })],
      });

      expect(projection.economicAttempts).toHaveLength(1);
      expect(projection.economicAttempts[0]?.rejections).toBeUndefined();
      expect(projection.unprojectableEvidence).toEqual([{
        eventId: "economic:event:1",
        sequence: 1,
        kind: "managed_economic_lifecycle",
        reason: "contract-violation",
        field: "rejections",
      }]);
      expect(JSON.stringify(projection)).not.toContain("secret-account-ref");
    });

    it("projects the exact Runtime economic identity shapes and rejects malformed or secret-shaped variants", () => {
      const route = {
        routeId: "route-opencode",
        providerId: "opencode-go",
        modelId: "go-test",
        adapterCapabilityId: "opencode-adapter",
        adapterCapabilityVersion: "1",
      };
      const account = {
        kind: "account-bound",
        capacityIdentity: "capacity:opencode:1",
        creditPosture: "committed",
        overagePosture: "disabled",
      };
      const projection = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-08-06T12:01:00.000Z",
        attachTargets,
        events: [
          economicEvent(1, { selectedRoute: route, selectedAccount: account }),
          economicEvent(2, {
            selectedRoute: { ...route, credential: "secret-route-credential" },
            selectedAccount: { kind: "accountless", accountRef: "secret-account-reference" },
          }),
          economicEvent(3, {
            selectedRoute: { ...route, adapterCapabilityVersion: undefined },
            selectedAccount: { kind: "account-bound", capacityIdentity: account.capacityIdentity },
          }),
        ],
      });

      expect(projection.economicAttempts).toHaveLength(1);
      expect(projection.economicAttempts[0]).toMatchObject({
        selectedRoute: route,
        selectedAccount: account,
        eventCount: 3,
      });
      expect(projection.unprojectableEvidence).toEqual([
        expect.objectContaining({ eventId: "economic:event:2", field: "selectedRoute" }),
        expect.objectContaining({ eventId: "economic:event:2", field: "selectedAccount" }),
        expect.objectContaining({ eventId: "economic:event:3", field: "selectedRoute" }),
        expect.objectContaining({ eventId: "economic:event:3", field: "selectedAccount" }),
      ]);
      const serialized = JSON.stringify(projection);
      expect(serialized).not.toContain("secret-route-credential");
      expect(serialized).not.toContain("secret-account-reference");
    });

    it("rejects an unrecognized transition instead of projecting it as a rendered string", () => {
      const projection = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-08-06T12:01:00.000Z",
        attachTargets,
        events: [economicEvent(1, { transition: "definitely-not-a-transition" })],
      });

      expect(projection.economicAttempts).toHaveLength(0);
      expect(projection.unprojectableEvidence).toEqual([{
        eventId: "economic:event:1",
        sequence: 1,
        kind: "managed_economic_lifecycle",
        reason: "invalid-discriminator",
        field: "transition",
      }]);
    });

    it("never carries the offending value, only its field name", () => {
      const projection = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-08-06T12:01:00.000Z",
        attachTargets,
        events: [economicEvent(1, { transition: "sk-live-secret-shaped-value" })],
      });

      const serialized = JSON.stringify(projection.unprojectableEvidence);
      expect(serialized).not.toContain("sk-live-secret-shaped-value");
      expect(projection.unprojectableEvidence[0]?.field).toBe("transition");
    });

    it("does not treat an event kind it never folds as a rejection", () => {
      const projection = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-08-06T12:01:00.000Z",
        attachTargets,
        events: [{
          eventId: "unrelated:event:1",
          kilnSessionId: "economic:session:1",
          sequence: 1,
          timestamp: "2026-08-06T12:00:01.000Z",
          kind: "turn_completed",
          payload: {
            instanceId: "economic:instance:1",
            sessionId: "economic:session:1",
          },
        }],
      });

      expect(projection.unprojectableEvidence).toEqual([]);
    });

    it("changes observably when the malformed events are removed from the stream", () => {
      const wellFormed = economicEvent(1, { transition: "held" });
      const malformed = economicEvent(2, { transition: "not-a-transition" });

      const withMalformed = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-08-06T12:01:00.000Z",
        attachTargets,
        events: [wellFormed, malformed],
      });
      const withoutMalformed = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-08-06T12:01:00.000Z",
        attachTargets,
        events: [wellFormed],
      });

      expect(withMalformed.economicAttempts).toHaveLength(1);
      expect(withoutMalformed.economicAttempts).toHaveLength(1);
      expect(withMalformed.unprojectableEvidence).toHaveLength(1);
      expect(withoutMalformed.unprojectableEvidence).toHaveLength(0);
    });

    function managedInvocationEvent(
      sequence: number,
      kind: OperatorSessionEvent["kind"],
      payloadOverrides: Record<string, unknown>,
    ): OperatorSessionEvent {
      return {
        eventId: `managed:event:${sequence}`,
        kilnSessionId: "economic:session:1",
        sequence,
        timestamp: `2026-08-07T12:00:0${sequence}.000Z`,
        kind,
        turnId: "managed:turn:1",
        payload: {
          instanceId: "economic:instance:1",
          sessionId: "economic:session:1",
          managedInvocationId: "managed:invocation:1",
          ...payloadOverrides,
        },
      };
    }

    it("accepts absent optional evidence lists but rejects present malformed lists without retaining values", () => {
      const resourceLease = {
        leaseId: "lease:optional-lists",
        createdAt: "2026-08-07T12:00:00.000Z",
        healthStatus: "healthy",
        cleanupStatus: "not-required",
        workingDirectoryPath: "/synthetic/workspace",
        workingDirectoryMode: "workspace-write",
        resourceUris: [],
        diagnosticUris: [],
      };
      const absent = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-08-07T12:01:00.000Z",
        attachTargets,
        events: [managedInvocationEvent(1, "agent_invocation_completed", {
          managedInvocationEvidence: { lifecycle: {} },
        })],
      });
      const malformed = projectOperatorCockpitReadOnlyView({
        projectedAt: "2026-08-07T12:01:00.000Z",
        attachTargets,
        events: [
          managedInvocationEvent(1, "agent_invocation_completed", {
            managedInvocationEvidence: {
              lifecycle: { sourceResourceUris: ["kiln://safe", 7] },
              resultHandoff: { resourceUris: "secret-list-shaped-value" },
              writeEvidence: [{ resourceUris: ["kiln://safe", false] }],
            },
          }),
          managedInvocationEvent(2, "agent_invocation_failed", {
            managedInvocationPhaseCompletion: { evidenceToRecord: ["kiln://safe", {}] },
          }),
          managedInvocationEvent(3, "agent_invocation_failed", {
            managedInvocationEvidence: { lifecycle: { resourceLease: { ...resourceLease, worktreeReview: "malformed" } } },
          }),
          managedInvocationEvent(4, "agent_invocation_failed", {
            managedInvocationEvidence: { lifecycle: { resourceLease: { ...resourceLease, worktreeConflict: "malformed" } } },
          }),
          managedInvocationEvent(5, "agent_invocation_completed", {
            managedInvocationEvidence: { resultHandoff: { memoryWriteProposalUris: ["kiln://safe", 7] } },
          }),
          managedInvocationEvent(6, "agent_invocation_failed", {
            managedInvocationPhaseCompletion: { requiredToolNames: ["resource_read", 7] },
          }),
          managedInvocationEvent(7, "agent_invocation_failed", {
            managedInvocationPhaseCompletion: { sourceResourceUris: ["kiln://safe", 7] },
          }),
        ],
      });

      expect(absent.unprojectableEvidence).toEqual([]);
      expect(malformed.unprojectableEvidence.map((rejection) => rejection.field)).toEqual([
        "managedInvocationEvidence.lifecycle.sourceResourceUris",
        "resultHandoff.resourceUris",
        "managedInvocationEvidence.writeEvidence.resourceUris",
        "managedInvocationPhaseCompletion.evidenceToRecord",
        "resourceLease.worktreeReview",
        "resourceLease.worktreeConflict",
        "resultHandoff.memoryWriteProposalUris",
        "managedInvocationPhaseCompletion.requiredToolNames",
        "managedInvocationPhaseCompletion.sourceResourceUris",
      ]);
      expect(JSON.stringify(malformed)).not.toContain("secret-list-shaped-value");
    });

    describe("prompt admission", () => {
      it("is not a rejection when the event kind carries no prompt admission evidence", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_completed", {})],
        });

        expect(projection.unprojectableEvidence).toEqual([]);
      });

      it("rejects an admitted prompt missing its required promptAdmissionId", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_prompt_admitted", {
            deliveryMode: "steer",
            admissionState: "admitted",
            inputSummary: "do the thing",
            promptHash: "sha256:fixture",
            wakeRequested: false,
          })],
        });

        expect(projection.invocations[0]?.promptAdmissionCount).toBe(0);
        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "agent_invocation_prompt_admitted",
          reason: "missing-required-field",
          field: "promptAdmissionId",
        }]);
      });

      it("rejects an unrecognized delivery mode as an invalid discriminator", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_prompt_admitted", {
            promptAdmissionId: "prompt:1",
            deliveryMode: "not-a-mode",
            admissionState: "admitted",
            inputSummary: "do the thing",
            promptHash: "sha256:fixture",
            wakeRequested: false,
          })],
        });

        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "agent_invocation_prompt_admitted",
          reason: "invalid-discriminator",
          field: "deliveryMode",
        }]);
      });
    });

    describe("external tool failure", () => {
      function toolEvent(sequence: number, metadataOverrides: Record<string, unknown>): OperatorSessionEvent {
        return managedInvocationEvent(sequence, "tool_call_completed", {
          toolCallId: "tool-call:1",
          toolCallScopeId: "tool-scope:1",
          toolName: "managed_agent.invoke",
          metadata: {
            kind: "external_tool_failure",
            ...metadataOverrides,
          },
        });
      }

      it("is not a rejection when tool metadata carries no external tool failure evidence", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "tool_call_completed", {
            toolCallId: "tool-call:1",
            toolCallScopeId: "tool-scope:1",
            toolName: "managed_agent.invoke",
            metadata: { kind: "tool_output" },
          })],
        });

        expect(projection.unprojectableEvidence).toEqual([]);
      });

      it("rejects an external tool failure missing its required selector", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [toolEvent(1, {
            category: "invocation-error",
            diagnostic: "the external runtime rejected the call",
            redacted: false,
            blocked: false,
          })],
        });

        expect(projection.toolSummaries[0]?.externalFailure).toBeUndefined();
        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "tool_call_completed",
          reason: "missing-required-field",
          field: "metadata.selector",
        }]);
      });

      it("rejects a selector that does not carry the mcp: scheme as a contract violation", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [toolEvent(1, {
            selector: "http:not-an-mcp-selector",
            category: "invocation-error",
            diagnostic: "the external runtime rejected the call",
            redacted: false,
            blocked: false,
          })],
        });

        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "tool_call_completed",
          reason: "contract-violation",
          field: "metadata.selector",
        }]);
      });
    });

    describe("resource lease", () => {
      it("is not a rejection when no resource lease evidence is offered", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_failed", {})],
        });

        expect(projection.unprojectableEvidence).toEqual([]);
      });

      it("rejects a resource lease present in the payload but missing leaseId", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_failed", {
            managedInvocationEvidence: {
              lifecycle: {
                resourceLease: {
                  createdAt: "2026-08-07T12:00:00.000Z",
                  healthStatus: "healthy",
                  cleanupStatus: "not-required",
                  workingDirectoryPath: "/workspace",
                  workingDirectoryMode: "workspace-write",
                  resourceUris: [],
                  diagnosticUris: [],
                },
              },
            },
          })],
        });

        expect(projection.invocations[0]?.resourceLease).toBeUndefined();
        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "agent_invocation_failed",
          reason: "missing-required-field",
          field: "resourceLease.leaseId",
        }]);
      });

      it("rejects an unrecognized health status as an invalid discriminator", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_failed", {
            managedInvocationEvidence: {
              lifecycle: {
                resourceLease: {
                  leaseId: "lease:1",
                  createdAt: "2026-08-07T12:00:00.000Z",
                  healthStatus: "not-a-health-status",
                  cleanupStatus: "not-required",
                  workingDirectoryPath: "/workspace",
                  workingDirectoryMode: "workspace-write",
                  resourceUris: [],
                  diagnosticUris: [],
                },
              },
            },
          })],
        });

        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "agent_invocation_failed",
          reason: "invalid-discriminator",
          field: "resourceLease.healthStatus",
        }]);
      });
    });

    describe("account lease", () => {
      it("is not a rejection when no account lease evidence is offered", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_failed", {})],
        });

        expect(projection.unprojectableEvidence).toEqual([]);
      });

      it("rejects an account lease present in the payload but missing selectionReason", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_failed", {
            managedInvocationEvidence: {
              lifecycle: {
                accountLease: {
                  leaseId: "lease:1",
                  accountPolicyId: "policy:1",
                  accountRef: "configured:account:opaque",
                  route: { providerId: "openai", providerModelId: "gpt-test", scope: "virtual:policy" },
                  jobId: "managed:invocation:1",
                  runtimeInvocationId: "managed:invocation:1",
                  credentialRevisionId: "a".repeat(64),
                  acquiredAt: "2026-08-07T12:00:00.000Z",
                  lifecycleState: "held",
                  resourceUris: [],
                  diagnosticUris: [],
                },
              },
            },
          })],
        });

        expect(projection.invocations[0]?.accountLease).toBeUndefined();
        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "agent_invocation_failed",
          reason: "missing-required-field",
          field: "accountLease.selectionReason",
        }]);
      });

      it("never carries the offending credential value, only its field name", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_failed", {
            managedInvocationEvidence: {
              lifecycle: {
                accountLease: {
                  leaseId: "lease:1",
                  accountPolicyId: "policy:1",
                  accountRef: "configured:account:opaque",
                  route: { providerId: "openai", providerModelId: "gpt-test", scope: "virtual:policy" },
                  jobId: "managed:invocation:1",
                  runtimeInvocationId: "managed:invocation:1",
                  credentialRevisionId: "sk-live-not-a-real-hex-digest",
                  selectionReason: "least-pressure",
                  acquiredAt: "2026-08-07T12:00:00.000Z",
                  lifecycleState: "held",
                  resourceUris: [],
                  diagnosticUris: [],
                },
              },
            },
          })],
        });

        const serialized = JSON.stringify(projection.unprojectableEvidence);
        expect(serialized).not.toContain("sk-live-not-a-real-hex-digest");
        expect(projection.unprojectableEvidence[0]).toEqual({
          eventId: "managed:event:1",
          sequence: 1,
          kind: "agent_invocation_failed",
          reason: "contract-violation",
          field: "accountLease.credentialRevisionId",
        });
      });
    });

    describe("invocation transcript", () => {
      it("is not a rejection when no transcript evidence is offered", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_completed", {
            managedInvocationEvidence: { lifecycle: { sourceResourceUris: ["kiln://fixture"] } },
          })],
        });

        expect(projection.unprojectableEvidence).toEqual([]);
      });

      it("rejects a transcript present in the payload but missing uri", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_completed", {
            managedInvocationEvidence: { transcript: { redacted: false } },
          })],
        });

        expect(projection.invocations[0]?.transcript).toBeUndefined();
        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "agent_invocation_completed",
          reason: "missing-required-field",
          field: "transcript.uri",
        }]);
      });
    });

    describe("invocation result handoff", () => {
      it("is not a rejection when no result handoff evidence is offered", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_completed", {
            managedInvocationEvidence: { transcript: { uri: "kiln://fixture/transcript" } },
          })],
        });

        expect(projection.unprojectableEvidence).toEqual([]);
      });

      it("rejects a result handoff present but not shaped as an object", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_completed", {
            managedInvocationEvidence: { resultHandoff: "not-an-object" },
          })],
        });

        expect(projection.invocations[0]?.resultHandoff).toBeUndefined();
        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "agent_invocation_completed",
          reason: "contract-violation",
          field: "resultHandoff",
        }]);
      });
    });

    describe("managed invocation recovery", () => {
      it("is not a rejection when no recovery evidence is offered", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_failed", {})],
        });

        expect(projection.unprojectableEvidence).toEqual([]);
      });

      it("rejects a recovery block present but not shaped as an object", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_failed", {
            managedInvocationRecovery: "not-an-object",
          })],
        });

        expect(projection.invocations[0]?.managedInvocationRecovery).toBeUndefined();
        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "agent_invocation_failed",
          reason: "contract-violation",
          field: "managedInvocationRecovery",
        }]);
      });
    });

    describe("managed invocation phase completion", () => {
      it("is not a rejection when no phase completion evidence is offered", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_completed", {})],
        });

        expect(projection.unprojectableEvidence).toEqual([]);
      });

      it("rejects a phase completion block present but not shaped as an object", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_completed", {
            managedInvocationPhaseCompletion: 42,
          })],
        });

        expect(projection.invocations[0]?.managedInvocationPhaseCompletion).toBeUndefined();
        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "agent_invocation_completed",
          reason: "contract-violation",
          field: "managedInvocationPhaseCompletion",
        }]);
      });
    });

    describe("managed orchestration adoption gate", () => {
      it("is not a rejection when no adoption gate evidence is offered", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_completed", {})],
        });

        expect(projection.unprojectableEvidence).toEqual([]);
      });

      it("rejects an adoption gate present in the payload but missing required", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_completed", {
            managedOrchestrationAdoptionGate: {
              status: "pending_review",
              childId: "child:1",
              resourceUris: [],
              blockingEvidence: [],
            },
          })],
        });

        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "agent_invocation_completed",
          reason: "missing-required-field",
          field: "managedOrchestrationAdoptionGate.required",
        }]);
      });

      it("rejects an unrecognized adoption gate status as an invalid discriminator", () => {
        const projection = projectOperatorCockpitReadOnlyView({
          projectedAt: "2026-08-07T12:01:00.000Z",
          attachTargets,
          events: [managedInvocationEvent(1, "agent_invocation_completed", {
            managedOrchestrationAdoptionGate: {
              required: true,
              status: "not-a-status",
              childId: "child:1",
              resourceUris: [],
              blockingEvidence: [],
            },
          })],
        });

        expect(projection.unprojectableEvidence).toEqual([{
          eventId: "managed:event:1",
          sequence: 1,
          kind: "agent_invocation_completed",
          reason: "invalid-discriminator",
          field: "managedOrchestrationAdoptionGate.status",
        }]);
      });
    });
  });
});
