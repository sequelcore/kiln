import { describe, expect, it, vi } from "vitest";
import {
  defineManagedAgentInvocationRequest,
  type ManagedAgentInvocationRequest,
} from "@kilnai/core";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { appendManagedInvocationSessionEvents } from "../../src/agents/managed-invocation/session-events.js";
import {
  ManagedCliHarnessAdapter,
  RuntimeManagedAgentInvocationService,
} from "../../src/agents/managed-invocation/index.js";
import type {
  CliSession,
  CliSessionEvent,
  CliSessionRunOptions,
} from "../../src/execution/cli-session-contract.js";

function makeRequest(timeoutMs = 120000): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-opencode-1",
    agentId: "agent-reviewer",
    parentSessionId: "session-parent",
    parentTurnId: "session-parent:turn:1",
    profile: "foundation-readonly-plan",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId: "opencode",
      surface: "cli-harness",
      model: "sonic",
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
        path: "C:/Proyectos/Sequel/kiln",
        mode: "read-only",
      },
      timeoutMs,
      credentialRoute: {
        mode: "runtime-selected",
        routeId: "credential-route:opencode:primary",
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
    },
    input: {
      summary: "Inspect the managed invocation contract.",
      prompt: "Read the relevant files and return a compact review.",
    },
  });
}

function eventStream(events: readonly CliSessionEvent[]): AsyncIterable<CliSessionEvent> {
  return (async function* stream(): AsyncGenerator<CliSessionEvent> {
    for (const event of events) {
      yield event;
    }
  })();
}

describe("ManagedCliHarnessAdapter configured for OpenCode", () => {
  it("executes an admitted foundation-readonly-plan invocation and records replayable evidence", async () => {
    const run = vi.fn((options: CliSessionRunOptions) => eventStream([
      { type: "text_delta", content: "Review complete." },
      {
        type: "cost_update",
        usd: 0.02,
        provider: "opencode",
        model: "sonic",
        inputTokens: 42,
        outputTokens: 7,
        cacheReadTokens: 3,
      },
      { type: "completed", totalUsd: 0.02, durationMs: 25, isError: false, isPreflightCrash: false },
    ]));
    const dispose = vi.fn().mockResolvedValue(undefined);
    const session: CliSession = { run, dispose };
    const factory = vi.fn(() => session);
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory,
    });
    const service = new RuntimeManagedAgentInvocationService();
    const request = makeRequest();

    const result = await service.invoke(request, adapter);

    expect(result.status).toBe("completed");
    expect(factory).toHaveBeenCalledWith(
      "Inspect the managed invocation contract.",
      "C:/Proyectos/Sequel/kiln",
      { kilnSessionId: "session-parent:managed:invocation-opencode-1" },
    );
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kilnSessionId: "session-parent:managed:invocation-opencode-1",
      cwd: "C:/Proyectos/Sequel/kiln",
      prompt: "Read the relevant files and return a compact review.",
      system: "Inspect the managed invocation contract.",
    });
    expect(dispose).toHaveBeenCalledTimes(1);

    if (result.status !== "completed") {
      throw new Error("Expected completed managed invocation result");
    }
    expect(result.record).toMatchObject({
      invocationId: request.invocationId,
      childSessionId: "session-parent:managed:invocation-opencode-1",
      lifecycleState: "completed",
      transcript: {
        uri: "kiln://managed-invocations/invocation-opencode-1/transcript",
        redacted: "unknown",
        truncated: false,
        persisted: true,
        retention: "session",
      },
      usage: {
        source: "adapter",
        tokenClasses: [
          { name: "input_tokens", value: 42 },
          { name: "output_tokens", value: 7 },
          { name: "cache_read_tokens", value: 3 },
        ],
        cost: { currency: "USD", amount: 0.02 },
      },
      resultHandoff: {
        summary: "Review complete.",
        resourceUris: ["kiln://managed-invocations/invocation-opencode-1/transcript"],
        memoryWriteProposalUris: [],
      },
    });

    const runtimeSession = new RuntimeSession({
      sessionId: request.parentSessionId,
      appName: "test-app",
      tenantId: "tenant-a",
      userId: "user-1",
      systemPrompt: "test",
    });
    const events = appendManagedInvocationSessionEvents({
      session: runtimeSession,
      request,
      decision: result.decision,
      record: result.record,
      durationMs: 25,
      timestamp: new Date("2026-05-04T12:00:00.000Z"),
    });

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(events[2]).toMatchObject({
      resultSummary: "Review complete.",
      managedInvocationEvidence: {
        childSessionId: "session-parent:managed:invocation-opencode-1",
        transcript: {
          uri: "kiln://managed-invocations/invocation-opencode-1/transcript",
        },
        usage: {
          cost: { currency: "USD", amount: 0.02 },
        },
      },
    });
  });

  it("returns a timed-out record with diagnostic evidence and disposes the CLI session", async () => {
    const run = vi.fn(() =>
      (async function* neverFinishes(): AsyncGenerator<CliSessionEvent> {
        await new Promise(() => undefined);
      })(),
    );
    const dispose = vi.fn().mockResolvedValue(undefined);
    const adapter = new ManagedCliHarnessAdapter({
      providerId: "opencode",
      model: "sonic",
      factory: () => ({ run, dispose }),
    });
    const service = new RuntimeManagedAgentInvocationService();

    const result = await service.invoke(makeRequest(1), adapter);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("Expected completed managed invocation result");
    }
    expect(result.record.lifecycleState).toBe("timed-out");
    expect(result.record.diagnostics).toEqual([{
      uri: "kiln://managed-invocations/invocation-opencode-1/timeout",
      kind: "timeout",
    }]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
