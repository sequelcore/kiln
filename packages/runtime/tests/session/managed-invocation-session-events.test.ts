import { describe, expect, it } from "vitest";
import type {
  ManagedAgentAdmissionDecision,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";
import {
  defineManagedAgentInvocationRecord,
  defineManagedAgentInvocationRequest,
} from "@kilnai/core";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import {
  appendManagedInvocationSessionEvents,
} from "../../src/agents/managed-invocation/session-events.js";

function makeSession(sessionId = "session-parent"): RuntimeSession {
  return new RuntimeSession({
    sessionId,
    appName: "test-app",
    tenantId: "tenant-a",
    userId: "user-1",
    systemPrompt: "test",
  });
}

function makeRequest(sessionId = "session-parent", turnId = `${sessionId}:turn:1`): ManagedAgentInvocationRequest {
  return defineManagedAgentInvocationRequest({
    invocationId: "invocation-1",
    agentId: "agent-reviewer",
    parentSessionId: sessionId,
    parentTurnId: turnId,
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
      timeoutMs: 120000,
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
      summary: "Inspect invocation contract",
    },
  });
}

function makeDecision(status: "admitted" | "denied"): ManagedAgentAdmissionDecision {
  if (status === "denied") {
    return {
      status: "denied",
      invocationId: "invocation-1",
      profile: "foundation-readonly-plan",
      reason: "foundation-readonly-plan denied: timeout.supported",
      missingCapabilities: ["timeout.supported"],
    };
  }
  return {
    status: "admitted",
    invocationId: "invocation-1",
    profile: "foundation-readonly-plan",
    adapterDescriptorId: "adapter:opencode:harness",
    authorityProfileId: "foundation-readonly",
    credentialRouteId: "credential-route:opencode:primary",
    memoryScope: { kind: "project", id: "kiln" },
  };
}

function makeRecord(lifecycleState: ManagedAgentInvocationRecord["lifecycleState"]): ManagedAgentInvocationRecord {
  const request = makeRequest();
  return defineManagedAgentInvocationRecord({
    invocationId: request.invocationId,
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    parentTurnId: request.parentTurnId,
    profile: request.profile,
    lifecycleState,
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    authority: request.authority,
    childSessionId: "child-session-1",
    childTurnId: "child-session-1:turn:3",
    transcript: {
      uri: "kiln://artifacts/invocation-1/transcript",
      redacted: "unknown",
      truncated: false,
      persisted: true,
      retention: "session",
    },
    diagnostics: lifecycleState === "timed-out"
      ? [{ uri: "kiln://artifacts/invocation-1/timeout", kind: "timeout" }]
      : lifecycleState === "failed"
        ? [{ uri: "kiln://artifacts/invocation-1/failure", kind: "failure" }]
        : undefined,
    usage: {
      source: "adapter",
      tokenClasses: [
        { name: "input_tokens", value: "unknown" },
        { name: "output_tokens", value: "unknown" },
      ],
      cost: { currency: "unknown", amount: "unknown" },
    },
    resultHandoff: {
      summary: "Inspection completed.",
      resourceUris: ["kiln://artifacts/invocation-1/result"],
      memoryWriteProposalUris: ["kiln://memory/write-proposals/1"],
    },
  });
}

describe("appendManagedInvocationSessionEvents", () => {
  it("maps requested and denied admission to canonical events with stable lineage", () => {
    const session = makeSession();
    const request = makeRequest(session.id, `${session.id}:turn:1`);
    const events = appendManagedInvocationSessionEvents({
      session,
      request,
      decision: makeDecision("denied"),
      timestamp: new Date("2026-05-03T10:00:00.000Z"),
    });

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_failed",
    ]);
    expect(events[0]).toMatchObject({
      sequence: 1,
      invocationId: request.invocationId,
      parentSessionId: request.parentSessionId,
      requestedBy: request.requestedBy,
      requestSource: request.requestSource,
      inputSummary: request.input.summary,
    });
    expect(events[1]).toMatchObject({
      sequence: 2,
      invocationId: request.invocationId,
      parentSessionId: request.parentSessionId,
      errorCode: "ADMISSION_DENIED",
      retriable: false,
    });
    expect(events[1]?.parentEventId).toBe(events[0]?.eventId);
    expect((events[1] as { errorMessage: string }).errorMessage).toContain("timeout.supported");
  });

  it("maps requested/started/completed with transcript, usage unknowns, handoff evidence and child lineage", () => {
    const session = makeSession();
    const request = makeRequest(session.id, `${session.id}:turn:1`);
    const record = makeRecord("completed");
    const events = appendManagedInvocationSessionEvents({
      session,
      request,
      decision: makeDecision("admitted"),
      record,
      timestamp: new Date("2026-05-03T10:00:05.000Z"),
      durationMs: 950,
    });

    expect(events.map((event) => event.kind)).toEqual([
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
    ]);
    expect(events[1]?.parentEventId).toBe(events[0]?.eventId);
    expect(events[2]?.parentEventId).toBe(events[1]?.eventId);
    expect(events[1]).toMatchObject({
      invocationId: request.invocationId,
      parentSessionId: request.parentSessionId,
      attempt: 1,
    });
    expect(events[2]).toMatchObject({
      invocationId: request.invocationId,
      parentSessionId: request.parentSessionId,
      durationMs: 950,
      resultSummary: "Inspection completed.",
    });

    const evidence = (events[2] as { managedInvocationEvidence?: Record<string, unknown> }).managedInvocationEvidence;
    expect(evidence).toMatchObject({
      childSessionId: "child-session-1",
      childTurnId: "child-session-1:turn:3",
      transcript: {
        uri: "kiln://artifacts/invocation-1/transcript",
        redacted: "unknown",
        truncated: false,
        persisted: true,
        retention: "session",
      },
      usage: {
        source: "adapter",
        tokenClasses: [
          { name: "input_tokens", value: "unknown" },
          { name: "output_tokens", value: "unknown" },
        ],
        cost: { currency: "unknown", amount: "unknown" },
      },
      resultHandoff: {
        summary: "Inspection completed.",
        resourceUris: ["kiln://artifacts/invocation-1/result"],
        memoryWriteProposalUris: ["kiln://memory/write-proposals/1"],
      },
    });
  });

  it("maps cancellation and timeout/failure terminals to canonical events", () => {
    const lifecycleCases: Array<{
      lifecycleState: ManagedAgentInvocationRecord["lifecycleState"];
      terminalKind: "agent_invocation_cancelled" | "agent_invocation_failed";
      errorCode?: string;
    }> = [
      { lifecycleState: "cancelled", terminalKind: "agent_invocation_cancelled" },
      { lifecycleState: "timed-out", terminalKind: "agent_invocation_failed", errorCode: "ENGINE_TIMEOUT" },
      { lifecycleState: "failed", terminalKind: "agent_invocation_failed", errorCode: "ENGINE_FAILURE" },
    ];

    for (const testCase of lifecycleCases) {
      const session = makeSession(`session-parent-${testCase.lifecycleState}`);
      const request = makeRequest(session.id, `${session.id}:turn:1`);
      const record = makeRecord(testCase.lifecycleState);
      const events = appendManagedInvocationSessionEvents({
        session,
        request,
        decision: makeDecision("admitted"),
        record,
        timestamp: new Date("2026-05-03T10:01:00.000Z"),
      });

      expect(events.map((event) => event.kind)).toEqual([
        "agent_invocation_requested",
        "agent_invocation_started",
        testCase.terminalKind,
      ]);
      expect(events[2]?.parentEventId).toBe(events[1]?.eventId);
      if (testCase.terminalKind === "agent_invocation_failed") {
        expect(events[2]).toMatchObject({ errorCode: testCase.errorCode });
      } else {
        expect(events[2]).toMatchObject({ reason: expect.stringContaining("cancelled") });
      }
    }
  });
});
