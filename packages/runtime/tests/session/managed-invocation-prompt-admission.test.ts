import { describe, expect, it } from "vitest";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import {
  appendManagedInvocationPromptAdmissionSessionEvent,
} from "../../src/agents/managed-invocation/prompt-admission.js";

function makeSession(sessionId = "session-parent"): RuntimeSession {
  return new RuntimeSession({
    sessionId,
    appName: "test-app",
    tenantId: "tenant-a",
    userId: "user-1",
    systemPrompt: "test",
  });
}

describe("appendManagedInvocationPromptAdmissionSessionEvent", () => {
  it("persists an admitted operator prompt as a canonical managed invocation event", () => {
    const session = makeSession();

    const event = appendManagedInvocationPromptAdmissionSessionEvent({
      session,
      promptAdmissionId: "prompt-admission-1",
      invocationId: "invocation-1",
      agentId: "agent-reviewer",
      parentTurnId: "session-parent:turn:1",
      prompt: "Review the latest runtime harness evidence and continue only from ledger state.",
      deliveryMode: "steer",
      requestedBy: "operator",
      requestSource: "gui",
      wakeRequested: true,
      timestamp: new Date("2026-06-05T16:00:00.000Z"),
    });

    expect(session.sessionEvents).toHaveLength(1);
    expect(event).toMatchObject({
      kind: "agent_invocation_prompt_admitted",
      sequence: 1,
      kilnSessionId: "session-parent",
      invocationId: "invocation-1",
      agentId: "agent-reviewer",
      parentSessionId: "session-parent",
      parentTurnId: "session-parent:turn:1",
      promptAdmissionId: "prompt-admission-1",
      deliveryMode: "steer",
      admissionState: "admitted",
      inputSummary: "Review the latest runtime harness evidence and continue only from ledger state.",
      requestedBy: "operator",
      requestSource: "gui",
      wakeRequested: true,
    });
    expect(event.promptHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("is idempotent for exact retries and fails closed on conflicting replay ids", () => {
    const session = makeSession();
    const input = {
      session,
      promptAdmissionId: "prompt-admission-retry",
      invocationId: "invocation-1",
      agentId: "agent-reviewer",
      parentTurnId: "session-parent:turn:1",
      prompt: "Continue from the persisted managed invocation transcript.",
      deliveryMode: "queue" as const,
      requestedBy: "operator",
      requestSource: "tui",
      wakeRequested: false,
      timestamp: new Date("2026-06-05T16:01:00.000Z"),
    };

    const first = appendManagedInvocationPromptAdmissionSessionEvent(input);
    const retry = appendManagedInvocationPromptAdmissionSessionEvent(input);

    expect(retry).toBe(first);
    expect(session.sessionEvents).toHaveLength(1);
    expect(() => appendManagedInvocationPromptAdmissionSessionEvent({
      ...input,
      prompt: "Different prompt with reused admission id.",
    })).toThrow("prompt admission id already exists");
  });

  it("survives session serialization as replayable prompt admission evidence", () => {
    const session = makeSession();
    appendManagedInvocationPromptAdmissionSessionEvent({
      session,
      promptAdmissionId: "prompt-admission-replay",
      invocationId: "invocation-1",
      agentId: "agent-reviewer",
      parentTurnId: "session-parent:turn:2",
      prompt: "Queue this follow-up after the child reaches a safe boundary.",
      deliveryMode: "queue",
      requestedBy: "operator",
      requestSource: "cli",
      wakeRequested: false,
      timestamp: new Date("2026-06-05T16:02:00.000Z"),
    });

    const restored = RuntimeSession.fromSerialized({
      id: session.id,
      appName: session.appName,
      tenantId: session.tenantId,
      userId: session.userId,
      systemPrompt: session.systemPrompt,
      idleTimeoutMs: session.idleTimeoutMs,
      sessionMode: session.sessionMode,
      version: session.version,
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      history: session.conversationHistory,
      activeAgentId: session.activeAgentId,
      agentTurnHistory: session.agentTurnHistory,
      handoffCount: session.handoffCount,
      lastRouteChangeAt: session.lastRouteChangeAt,
      sessionEvents: session.sessionEvents.map((event) => ({
        ...event,
        timestamp: event.timestamp.toISOString(),
      })),
    });

    expect(restored.sessionEvents[0]).toMatchObject({
      kind: "agent_invocation_prompt_admitted",
      promptAdmissionId: "prompt-admission-replay",
      deliveryMode: "queue",
      wakeRequested: false,
    });
    expect(restored.sessionEvents[0]?.timestamp).toBeInstanceOf(Date);
  });
});
