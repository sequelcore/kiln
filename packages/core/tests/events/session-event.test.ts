import { describe, it, expect } from "vitest";
import { createSessionEvent, compareSessionEvents } from "../../src/events/index.js";
import type {
  CanonicalSessionEvent,
  CanonicalSessionEventKind,
  SessionCost,
  SessionProviderIdentity,
  SessionTokenUsage,
} from "../../src/events/index.js";

describe("session event envelope", () => {
  it("fills eventId and timestamp with deterministic injection", () => {
    const fixedTimestamp = new Date("2026-04-23T18:00:00.000Z");
    const event = createSessionEvent(
      {
        kind: "turn_started",
        kilnSessionId: "kiln-session-1",
        sequence: 1,
        turnOrdinal: 1,
        trigger: "user_message",
      },
      {
        generateEventId: () => "evt-fixed-001",
        now: () => fixedTimestamp,
      },
    );

    expect(event.eventId).toBe("evt-fixed-001");
    expect(event.timestamp).toBe(fixedTimestamp);
  });

  it("rejects sequence lower than 1", () => {
    expect(() => createSessionEvent({
      kind: "turn_started",
      kilnSessionId: "kiln-session-1",
      sequence: 0,
      turnOrdinal: 1,
      trigger: "user_message",
    })).toThrow(RangeError);
  });

  it("constructs typed events for every roadmap kind", () => {
    const provider: SessionProviderIdentity = {
      provider: "openai",
      model: "gpt-5.4",
      canonicalModel: "gpt-5.4",
      providerSessionId: "provider-session-9",
      providerRequestId: "req-22",
    };
    const usage: SessionTokenUsage = {
      inputTokens: 120,
      outputTokens: 45,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    const cost: SessionCost = {
      currency: "USD",
      deltaUsd: 0.0045,
      totalUsd: 0.0045,
    };

    let idCounter = 0;
    const kinds: readonly CanonicalSessionEventKind[] = [
      "turn_started",
      "user_message",
      "assistant_message",
      "assistant_delta",
      "plan_analysis_reported",
      "plan_approved",
      "provider_routed",
      "tool_call_started",
      "tool_call_completed",
      "approval_requested",
      "approval_resolved",
      "file_changed",
      "cost_updated",
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
      "agent_invocation_failed",
      "agent_invocation_cancelled",
      "continuity_decided",
      "error_recorded",
      "turn_completed",
    ];

    const events: CanonicalSessionEvent[] = [
      createSessionEvent({
        kind: "turn_started",
        kilnSessionId: "kiln-session-1",
        sequence: 1,
        turnId: "turn-1",
        turnOrdinal: 1,
        trigger: "user_message",
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "user_message",
        kilnSessionId: "kiln-session-1",
        sequence: 2,
        turnId: "turn-1",
        messageId: "msg-user-1",
        content: "Hello",
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "assistant_message",
        kilnSessionId: "kiln-session-1",
        sequence: 3,
        turnId: "turn-1",
        messageId: "msg-assistant-1",
        content: "Hi there",
        provider,
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "assistant_delta",
        kilnSessionId: "kiln-session-1",
        sequence: 4,
        turnId: "turn-1",
        messageId: "msg-assistant-1",
        delta: "Hi",
        deltaIndex: 0,
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "plan_analysis_reported",
        kilnSessionId: "kiln-session-1",
        sequence: 5,
        reportId: "analysis_report_1",
        planId: "plan_1",
        specificationId: "spec_1",
        status: "ready",
        highestSeverity: "medium",
        findingIds: ["analysis_finding_1"],
        blockingFindingIds: [],
        findingCount: 1,
        findings: [{
          id: "analysis_finding_1",
          fingerprint: "fingerprint-1",
          category: "terminology_drift",
          severity: "medium",
          title: "Actor Terminology Drift",
          detail: "Actor is not referenced in the plan.",
          references: ["specification:spec_1", "plan:plan_1"],
          status: "open",
        }],
        summary: "No critical findings. Ready for approval.",
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "plan_approved",
        kilnSessionId: "kiln-session-1",
        sequence: 6,
        planId: "plan_1",
        approvalId: "plan_approval_1",
        planHash: "sha256:abc123",
        approvedAt: "2026-05-11T12:00:00.000Z",
        fromMode: "plan",
        toMode: "execute",
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "provider_routed",
        kilnSessionId: "kiln-session-1",
        sequence: 7,
        provider,
        reason: "latency policy",
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "tool_call_started",
        kilnSessionId: "kiln-session-1",
        sequence: 8,
        turnId: "turn-1",
        toolCallId: "tool-1",
        toolName: "read_file",
        input: { path: "README.md" },
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "tool_call_completed",
        kilnSessionId: "kiln-session-1",
        sequence: 9,
        turnId: "turn-1",
        toolCallId: "tool-1",
        toolName: "read_file",
        status: { state: "succeeded" },
        durationMs: 32,
        outputSummary: "read 1 file",
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "approval_requested",
        kilnSessionId: "kiln-session-1",
        sequence: 10,
        approvalId: "approval-1",
        action: "write_file",
        justification: "modify core contract",
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "approval_resolved",
        kilnSessionId: "kiln-session-1",
        sequence: 11,
        approvalId: "approval-1",
        resolution: {
          decision: "approved",
          resolvedBy: "user",
          reason: "safe change",
        },
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "file_changed",
        kilnSessionId: "kiln-session-1",
        sequence: 12,
        turnId: "turn-1",
        toolCallId: "tool-1",
        change: {
          changeType: "updated",
          path: "packages/core/src/events/session-event.ts",
          linesAdded: 12,
          linesRemoved: 4,
        },
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "cost_updated",
        kilnSessionId: "kiln-session-1",
        sequence: 13,
        provider,
        usage,
        cost,
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "agent_invocation_requested",
        kilnSessionId: "kiln-session-1",
        sequence: 14,
        turnId: "turn-1",
        invocationId: "inv-1",
        agentId: "agent-coder",
        agentName: "Coder",
        parentSessionId: "kiln-session-parent",
        requestedBy: "user",
        requestSource: "manual",
        inputSummary: "Implement contract slice B4",
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "agent_invocation_started",
        kilnSessionId: "kiln-session-1",
        sequence: 15,
        turnId: "turn-1",
        invocationId: "inv-1",
        agentId: "agent-coder",
        agentName: "Coder",
        parentSessionId: "kiln-session-parent",
        requestedBy: "user",
        requestSource: "manual",
        attempt: 1,
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "agent_invocation_completed",
        kilnSessionId: "kiln-session-1",
        sequence: 16,
        turnId: "turn-1",
        invocationId: "inv-1",
        agentId: "agent-coder",
        agentName: "Coder",
        parentSessionId: "kiln-session-parent",
        requestedBy: "user",
        requestSource: "manual",
        durationMs: 2280,
        resultSummary: "Applied contract updates",
        outputMessageId: "msg-assistant-2",
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "agent_invocation_failed",
        kilnSessionId: "kiln-session-1",
        sequence: 17,
        turnId: "turn-1",
        invocationId: "inv-2",
        agentId: "agent-reviewer",
        requestedBy: "runtime",
        requestSource: "retry",
        errorCode: "ENGINE_UNAVAILABLE",
        errorMessage: "Worker pool exhausted",
        retriable: true,
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "agent_invocation_cancelled",
        kilnSessionId: "kiln-session-1",
        sequence: 18,
        turnId: "turn-1",
        invocationId: "inv-3",
        agentId: "agent-planner",
        requestedBy: "operator",
        requestSource: "manual",
        reason: "User stopped execution",
        cancelledBy: "operator",
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "continuity_decided",
        kilnSessionId: "kiln-session-1",
        sequence: 19,
        decision: "continue",
        reason: "await user follow-up",
        nextTurnId: "turn-2",
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "error_recorded",
        kilnSessionId: "kiln-session-1",
        sequence: 20,
        turnId: "turn-1",
        errorCode: "TOOL_TIMEOUT",
        message: "Tool timed out",
        retriable: true,
      }, { generateEventId: () => `evt-${++idCounter}` }),
      createSessionEvent({
        kind: "turn_completed",
        kilnSessionId: "kiln-session-1",
        sequence: 21,
        turnId: "turn-1",
        outcome: "completed",
        outputMessageId: "msg-assistant-1",
        durationMs: 1450,
      }, { generateEventId: () => `evt-${++idCounter}` }),
    ];

    expect(events).toHaveLength(kinds.length);
    expect(events.map((event) => event.kind)).toEqual(kinds);
  });

  it("sorts by sequence and tie-breakers (timestamp, then eventId)", () => {
    const events = [
      createSessionEvent({
        kind: "turn_started",
        eventId: "evt-b",
        timestamp: new Date("2026-04-23T20:00:01.000Z"),
        kilnSessionId: "kiln-session-1",
        sequence: 1,
        turnOrdinal: 1,
        trigger: "user_message",
      }),
      createSessionEvent({
        kind: "turn_started",
        eventId: "evt-a",
        timestamp: new Date("2026-04-23T20:00:01.000Z"),
        kilnSessionId: "kiln-session-1",
        sequence: 1,
        turnOrdinal: 1,
        trigger: "user_message",
      }),
      createSessionEvent({
        kind: "turn_started",
        eventId: "evt-z",
        timestamp: new Date("2026-04-23T20:00:00.000Z"),
        kilnSessionId: "kiln-session-1",
        sequence: 1,
        turnOrdinal: 1,
        trigger: "user_message",
      }),
      createSessionEvent({
        kind: "turn_started",
        eventId: "evt-next",
        timestamp: new Date("2026-04-23T20:00:00.000Z"),
        kilnSessionId: "kiln-session-1",
        sequence: 2,
        turnOrdinal: 2,
        trigger: "continuation",
      }),
    ];

    events.sort(compareSessionEvents);
    expect(events.map((event) => event.eventId)).toEqual([
      "evt-z",
      "evt-a",
      "evt-b",
      "evt-next",
    ]);
  });

  it("uses kilnSessionId as the canonical session key", () => {
    const event = createSessionEvent({
      kind: "provider_routed",
      kilnSessionId: "kiln-session-canonical",
      sequence: 7,
      provider: {
        provider: "openai",
        model: "gpt-5.4",
        providerSessionId: "provider-session-external",
      },
      reason: "routing policy",
    });

    expect(event.kilnSessionId).toBe("kiln-session-canonical");
    expect(event.provider.providerSessionId).toBe("provider-session-external");
    expect(event.kilnSessionId).not.toBe(event.provider.providerSessionId);
    expect("sessionId" in event).toBe(false);
  });
});
