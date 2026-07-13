import { describe, expect, it } from "vitest";
import type { CanonicalSessionEvent, WorkItem } from "@kilnai/core";
import { toOperatorSessionEventFrame } from "../../src/gateway/operator-session-event-frame.js";

function managedWorkItem(input: {
  readonly status?: WorkItem["status"];
  readonly managedInvocationId?: string;
  readonly verificationGateResults?: WorkItem["verificationGateResults"];
  readonly managedOrchestrationAdoption?: WorkItem["managedOrchestrationAdoption"];
} = {}): WorkItem {
  return {
    id: "work-adoption",
    summary: "Review managed child output.",
    status: input.status ?? "completed",
    workflowProfile: "sequel-standard",
    triggers: ["managed-orchestration"],
    expectedEvidence: ["managed-orchestration:adoption-gate"],
    providedEvidence: ["managed-orchestration:result-handoff"],
    verificationGates: ["managed orchestration adoption gate"],
    skippedVerificationGates: [],
    verificationGateResults: input.verificationGateResults ?? [],
    dependencies: [],
    createdAt: "2026-05-23T12:00:00.000Z",
    updatedAt: "2026-05-23T12:00:10.000Z",
    sequence: 1,
    executionAttempts: [],
    managedOrchestration: {
      orchestrationId: "orch-adoption",
      mode: "decomposition",
      childId: input.managedInvocationId ?? "child-adoption",
      ordinal: 1,
      roleIntent: "coder",
      expectedEvidence: [{
        kind: "result-handoff",
        label: "Result handoff",
        required: true,
      }],
      isolation: {
        required: true,
        reason: "Managed child uses isolated worktree.",
        workingDirectoryMode: "isolated-worktree",
      },
      mergePolicy: {
        mode: "manual",
        adoptionRequired: true,
      },
      adoptionGate: {
        required: true,
        target: "slice-6-handoff-review-adoption",
        reason: "Managed child output must be adopted before closeout.",
      },
    },
    ...(input.managedOrchestrationAdoption
      ? { managedOrchestrationAdoption: input.managedOrchestrationAdoption }
      : {}),
  };
}

function workItemEvent(workItem: WorkItem): CanonicalSessionEvent {
  return {
    eventId: "evt-work-item",
    kilnSessionId: "session-1",
    sequence: 1,
    timestamp: new Date("2026-05-23T12:00:10.000Z"),
    kind: "work_item_updated",
    source: "runtime",
    workItem,
    operation: "complete",
  };
}

describe("operator session event frame", () => {
  it("preserves terminal managed-child failure evidence on gateway frames", () => {
    const terminalEvents: readonly CanonicalSessionEvent[] = [
      terminalManagedInvocationEvent({
        eventId: "evt-timeout",
        kind: "agent_invocation_failed",
        lifecycleState: "timed_out",
        errorCode: "ENGINE_TIMEOUT",
        errorMessage: "Managed invocation timed out.",
        diagnosticKind: "timeout",
        diagnosticUri: "kiln://managed-invocations/child-timed_out/timeout",
      }),
      terminalManagedInvocationEvent({
        eventId: "evt-stale",
        kind: "agent_invocation_failed",
        lifecycleState: "stale",
        errorCode: "ENGINE_STALE",
        errorMessage: "Managed invocation heartbeat expired.",
        diagnosticKind: "heartbeat",
        diagnosticUri: "kiln://managed-invocations/child-stale/heartbeat",
      }),
      terminalManagedInvocationEvent({
        eventId: "evt-failed",
        kind: "agent_invocation_failed",
        lifecycleState: "failed",
        errorCode: "ENGINE_FAILURE",
        errorMessage: "Managed invocation failed.",
        diagnosticKind: "failure",
        diagnosticUri: "kiln://managed-invocations/child-failed/failure",
      }),
    ];

    for (const [index, event] of terminalEvents.entries()) {
      const lifecycleState = (event as { readonly lifecycleState: "timed_out" | "stale" | "failed" }).lifecycleState;
      const errorCode = (event as { readonly errorCode: string }).errorCode;
      const errorMessage = (event as { readonly errorMessage: string }).errorMessage;
      const frame = toOperatorSessionEventFrame(event, {
        eventId: `frame-terminal-${index + 1}`,
        sequence: index + 10,
        instanceId: "local-gui",
      });

      expect(frame.event.payload).toMatchObject({
        instanceId: "local-gui",
        sessionId: "session-1",
        invocationId: `child-${lifecycleState}`,
        managedInvocationId: `child-${lifecycleState}`,
        lifecycleState,
        errorCode,
        errorMessage,
        managedInvocationEvidence: {
          diagnostics: [{
            uri: expect.stringContaining(`child-${lifecycleState}`),
          }],
          resultHandoff: {
            resourceUris: [
              `kiln://managed-invocations/child-${lifecycleState}/handoff`,
            ],
          },
          lifecycle: {
            resourceLease: {
              leaseId: `child-${lifecycleState}:resource-lease`,
              cleanupStatus: "failed",
              diagnosticUris: [
                `kiln://artifacts/child-${lifecycleState}/lease-diagnostic`,
              ],
            },
          },
        },
      });
    }
  });

  it("exposes core-projected managed orchestration adoption gates on work-item frames", () => {
    const frame = toOperatorSessionEventFrame(workItemEvent(managedWorkItem({
      managedOrchestrationAdoption: {
        target: "slice-6-handoff-review-adoption",
        adoptedBy: "operator",
        adoptedAt: "2026-05-23T12:00:09.000Z",
        resourceUris: ["kiln://artifacts/orch-adoption/adoption-review"],
      },
    })), {
      eventId: "frame-1",
      sequence: 10,
      instanceId: "local-tui",
    });

    expect(frame.event.payload.instanceId).toBe("local-tui");
    expect(frame.event.payload.sessionId).toBe("session-1");
    expect(frame.event.payload.managedOrchestrationAdoptionGate).toEqual({
      required: true,
      target: "slice-6-handoff-review-adoption",
      reason: "Managed child output must be adopted before closeout.",
      orchestrationId: "orch-adoption",
      childId: "child-adoption",
      mergePolicyMode: "manual",
      resourceUris: ["kiln://artifacts/orch-adoption/adoption-review"],
      blockingEvidence: [],
      status: "adopted",
      adoptedBy: "operator",
      adoptedAt: "2026-05-23T12:00:09.000Z",
    });
  });

  it("does not add adoption-gate snapshots to non-work-item frames", () => {
    const frame = toOperatorSessionEventFrame({
      eventId: "evt-child",
      kilnSessionId: "session-1",
      sequence: 1,
      timestamp: new Date("2026-05-23T12:00:00.000Z"),
      kind: "agent_invocation_completed",
      source: "runtime",
      managedInvocationId: "child-adoption",
      invocationId: "child-adoption",
      agentId: "coder",
      status: "completed",
    } as CanonicalSessionEvent, {
      eventId: "frame-2",
      sequence: 11,
    });

    expect(frame.event.payload.managedOrchestrationAdoptionGate).toBeUndefined();
  });

  it("maps canonical context evidence through the Gateway contract without reinterpreting it", () => {
    const frame = toOperatorSessionEventFrame({
      eventId: "evt-context",
      kilnSessionId: "session-1",
      sequence: 1,
      timestamp: new Date("2026-07-13T00:00:00.000Z"),
      kind: "context_usage_observed",
      turnId: "turn-1",
      contextUsage: {
        state: "partial",
        usedTokens: 12,
        contextWindowTokens: 128,
        remainingTokens: 116,
        usedPercentage: 9.375,
        providerId: "codex-oauth",
        modelId: "gpt-5.6-terra",
        turnId: "turn-1",
        observedAt: "2026-07-13T00:00:00.000Z",
        measurement: "provider_reported",
        lifecycle: "completed",
        contextWindowAuthority: "runtime_observed",
        freshness: "fresh",
      },
    }, {
      eventId: "frame-context",
      sequence: 2,
    });

    expect(frame.event.payload.contextUsage).toMatchObject({
      state: "partial",
      lifecycle: "completed",
      freshness: "fresh",
      usedPercentage: 9.375,
    });
  });
});

function terminalManagedInvocationEvent(input: {
  readonly eventId: string;
  readonly kind: "agent_invocation_failed";
  readonly lifecycleState: "timed_out" | "stale" | "failed";
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly diagnosticKind: string;
  readonly diagnosticUri: string;
}): CanonicalSessionEvent {
  return {
    eventId: input.eventId,
    kilnSessionId: "session-1",
    sequence: 1,
    timestamp: new Date("2026-05-24T12:00:00.000Z"),
    kind: input.kind,
    source: "runtime",
    invocationId: `child-${input.lifecycleState}`,
    agentId: "agent-coder",
    parentSessionId: "session-1",
    lifecycleState: input.lifecycleState,
    providerRoute: {
      providerId: "opencode",
      model: "minimax-m2.5",
    },
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    managedInvocationEvidence: {
      diagnostics: [{
        uri: input.diagnosticUri,
        kind: input.diagnosticKind,
      }],
      resultHandoff: {
        summary: input.errorMessage,
        resourceUris: [`kiln://managed-invocations/child-${input.lifecycleState}/handoff`],
        memoryWriteProposalUris: [],
      },
      lifecycle: {
        lifecycleState: input.lifecycleState,
        invocationId: `child-${input.lifecycleState}`,
        parentSessionId: "session-1",
        parentTurnId: "session-1:turn:1",
        routeId: "opencode-readonly",
        providerId: "opencode",
        model: "minimax-m2.5",
        profile: "foundation-readonly-plan",
        contextMode: "isolated",
        authorityProfileId: "authority:opencode-readonly:foundation-readonly-plan",
        resourceLease: {
          leaseId: `child-${input.lifecycleState}:resource-lease`,
          healthStatus: "leaked",
          cleanupStatus: "failed",
          workingDirectoryPath: "C:/workspace/kiln",
          workingDirectoryMode: "isolated-worktree",
          resourceUris: [`kiln://artifacts/child-${input.lifecycleState}/lease`],
          diagnosticUris: [`kiln://artifacts/child-${input.lifecycleState}/lease-diagnostic`],
        },
        diagnosticUris: [input.diagnosticUri],
        handoffResourceUris: [`kiln://managed-invocations/child-${input.lifecycleState}/handoff`],
      },
    },
  } as CanonicalSessionEvent;
}
