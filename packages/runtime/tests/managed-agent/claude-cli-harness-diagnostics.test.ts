import { describe, expect, it, vi } from "vitest";
import {
  defineManagedAgentInvocationRequest,
  type ExecutionSessionEvent,
  type ManagedAgentCapabilitySnapshotInput,
  type ManagedAgentInvocationRequest,
} from "@kilnai/core";
import {
  ManagedCliHarnessAdapter,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";

function makeRequest(): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-claude-1",
    agentId: "agent-reviewer",
    parentSessionId: "session-parent",
    parentTurnId: "session-parent:turn:1",
    profile: "foundation-readonly-plan",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId: "claude",
      surface: "cli-harness",
      model: "claude-fable-5",
    },
    adapterKind: "harness",
    executionMode: "cli-harness",
    authority: {
      authorityProfileId: "foundation-readonly",
      permissionProfile: "read-only",
      toolAuthority: {
        allowedToolNames: ["read", "rg"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/workspace/kiln",
        mode: "read-only",
      },
      timeoutMs: 120000,
      credentialRoute: {
        mode: "credentialless",
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
    },
    input: {
      summary: "Inspect the managed invocation contract.",
      prompt: "Read the relevant files and return a compact review.",
      handoff: {
        roleIntent: "managed reviewer",
        requiredResultFields: ["summary"],
      },
    },
  });
}

function snapshotInputFor(request: ManagedAgentInvocationRequest): ManagedAgentCapabilitySnapshotInput {
  return {
    capturedAt: "2026-08-01T08:00:00.000Z",
    routeId: `${request.providerRoute.providerId}:${request.profile}`,
    routeSource: "explicit-managed-route",
  };
}

function eventStream(events: readonly ExecutionSessionEvent[]): AsyncIterable<ExecutionSessionEvent> {
  return (async function* stream(): AsyncGenerator<ExecutionSessionEvent> {
    for (const event of events) {
      yield event;
    }
  })();
}

async function invokeWith(events: readonly ExecutionSessionEvent[]) {
  const run = vi.fn(() => eventStream(events));
  const dispose = vi.fn().mockResolvedValue(undefined);
  const adapter = new ManagedCliHarnessAdapter({
    providerId: "claude",
    model: "claude-fable-5",
    factory: () => ({ run, dispose }),
  });
  const service = new RuntimeManagedAgentInvocationService();
  const request = makeRequest();
  return service.invoke(request, adapter, snapshotInputFor(request));
}

describe("ManagedCliHarnessAdapter surfaces Claude terminal causes", () => {
  it("reports schema-retry exhaustion instead of an unexplained missing handoff", async () => {
    const result = await invokeWith([
      {
        type: "error",
        code: "error_max_structured_output_retries",
        message: "Claude Code exhausted its structured-output retries without producing a schema-valid result.",
        isRetryable: false,
      },
      { type: "completed", totalUsd: 0.01, durationMs: 1200, outcome: "failed", isPreflightCrash: false },
    ]);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff.summary).toContain("error_max_structured_output_retries");
    expect(result.record.resultHandoff.summary).not.toContain("without a result handoff");
    expect(result.record.diagnostics?.length ?? 0).toBeGreaterThan(0);
  });

  it("still reports the generic missing-handoff failure when the provider gave no cause", async () => {
    const result = await invokeWith([
      { type: "completed", totalUsd: 0, durationMs: 800, outcome: "completed", isPreflightCrash: false },
    ]);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.record.lifecycleState).toBe("failed");
    expect(result.record.resultHandoff.summary).toContain("without a result handoff");
  });
});
