import { describe, it, expect } from "vitest";
import { type ContentPart, textParts } from "@kilnai/core/engine";
import { createSessionEvent } from "@kilnai/core/events";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { serializeSession, deserializeSession } from "../../src/session/persistence/session-serializer.js";
import type { SessionMode } from "../../src/session/session-mode.js";

function makeSession(overrides: {
  tenantId?: string;
  idleTimeoutMs?: number;
} = {}): RuntimeSession {
  return new RuntimeSession({
    appName: "test-app",
    tenantId: "test-tenant",
    userId: "user-1",
    systemPrompt: "You are a test assistant.",
    ...overrides,
  });
}

describe("serializeSession / deserializeSession", () => {
  it("roundtrips a session with text-only history", () => {
    const session = makeSession();
    session.addUserMessage(textParts("hello"));
    session.addAssistantMessage(textParts("hi there"));

    const json = serializeSession(session);
    const restored = deserializeSession(json);

    expect(restored.id).toBe(session.id);
    expect(restored.appName).toBe("test-app");
    expect(restored.userId).toBe("user-1");
    expect(restored.systemPrompt).toBe("You are a test assistant.");
    expect(restored.messageCount).toBe(2);
    expect(restored.conversationHistory[0]!.role).toBe("user");
    expect(restored.conversationHistory[1]!.role).toBe("assistant");
  });

  it("roundtrips a session with tool_use + tool_result parts", () => {
    const session = makeSession();
    const toolUseParts: ContentPart[] = [
      { type: "text", text: "Let me look that up." },
    ];
    const toolResultParts: ContentPart[] = [
      { type: "text", text: "The result is 42." },
    ];
    session.addAssistantMessage(toolUseParts);
    session.addUserMessage(toolResultParts);

    const json = serializeSession(session);
    const restored = deserializeSession(json);

    expect(restored.messageCount).toBe(2);
    expect(restored.conversationHistory[0]!.role).toBe("assistant");
    expect(restored.conversationHistory[0]!.parts[0]).toEqual({ type: "text", text: "Let me look that up." });
    expect(restored.conversationHistory[1]!.role).toBe("user");
    expect(restored.conversationHistory[1]!.parts[0]).toEqual({ type: "text", text: "The result is 42." });
  });

  it("preserves all 4 SessionMode values", () => {
    const modes: SessionMode[] = ["ai_active", "queued", "human_active", "resolved"];
    for (const mode of modes) {
      const session = makeSession();
      // Use transitions to reach the desired mode
      if (mode === "queued") {
        session.setSessionMode("queued");
      } else if (mode === "human_active") {
        session.setSessionMode("queued");
        session.setSessionMode("human_active");
      } else if (mode === "resolved") {
        session.setSessionMode("queued");
        session.setSessionMode("human_active");
        session.setSessionMode("resolved");
      }

      const json = serializeSession(session);
      const restored = deserializeSession(json);
      expect(restored.sessionMode).toBe(mode);
    }
  });

  it("preserves date precision (createdAt, lastActivityAt)", () => {
    const session = makeSession();
    const json = serializeSession(session);
    const restored = deserializeSession(json);

    // Dates should match within 1ms (ISO serialization preserves milliseconds)
    expect(Math.abs(restored.createdAt.getTime() - session.createdAt.getTime())).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.lastActivityAt.getTime() - session.lastActivityAt.getTime())).toBeLessThanOrEqual(1);
  });

  it("roundtrips a session with empty history", () => {
    const session = makeSession();

    const json = serializeSession(session);
    const restored = deserializeSession(json);

    expect(restored.messageCount).toBe(0);
    expect(restored.conversationHistory).toHaveLength(0);
  });

  it("roundtrips a session with tenantId", () => {
    const session = makeSession({ tenantId: "tenant-x" });

    const json = serializeSession(session);
    const restored = deserializeSession(json);

    expect(restored.tenantId).toBe("tenant-x");
    expect(restored.id).toContain("tenant-x");
  });

  it("preserves idleTimeoutMs", () => {
    const session = makeSession({ idleTimeoutMs: 60000 });

    const json = serializeSession(session);
    const restored = deserializeSession(json);

    expect(restored.idleTimeoutMs).toBe(60000);
  });

  it("preserves default idleTimeoutMs", () => {
    const session = makeSession();

    const json = serializeSession(session);
    const restored = deserializeSession(json);

    // Default is 30 * 60 * 1000 = 1800000
    expect(restored.idleTimeoutMs).toBe(1800000);
  });

  it("roundtrips a session with userContext", () => {
    const session = makeSession();
    session.updateUserContext({ role: "admin", locale: "es" });

    const json = serializeSession(session);
    const restored = deserializeSession(json);

    expect(restored.userContext).toEqual({ role: "admin", locale: "es" });
  });

  it("roundtrips a session without userContext — backward compat", () => {
    const session = makeSession();

    const json = serializeSession(session);
    const restored = deserializeSession(json);

    expect(restored.userContext).toBeUndefined();
  });

  it("roundtrips canonical session events with timestamp restoration", () => {
    const session = makeSession();
    session.appendSessionEvents([
      createSessionEvent({
        kilnSessionId: session.id,
        sequence: 1,
        kind: "turn_started",
        turnId: `${session.id}:turn:1`,
        turnOrdinal: 1,
        trigger: "user_message",
      }),
      createSessionEvent({
        kilnSessionId: session.id,
        sequence: 2,
        kind: "user_message",
        turnId: `${session.id}:turn:1`,
        messageId: `${session.id}:turn:1:user`,
        content: "hello",
      }),
      createSessionEvent({
        kilnSessionId: session.id,
        sequence: 3,
        kind: "agent_invocation_requested",
        turnId: `${session.id}:turn:1`,
        invocationId: "inv-1",
        agentId: "agent-planner",
        agentName: "Planner",
        requestedBy: "user",
        requestSource: "manual",
      }),
      createSessionEvent({
        kilnSessionId: session.id,
        sequence: 4,
        kind: "agent_invocation_started",
        turnId: `${session.id}:turn:1`,
        invocationId: "inv-1",
        agentId: "agent-planner",
        attempt: 1,
      }),
      createSessionEvent({
        kilnSessionId: session.id,
        sequence: 5,
        kind: "agent_invocation_completed",
        turnId: `${session.id}:turn:1`,
        invocationId: "inv-1",
        agentId: "agent-planner",
        durationMs: 950,
        resultSummary: "Plan generated",
        managedInvocationEvidence: {
          writeAuthority: {
            profile: "foundation-propose-writes",
            scope: {
              workspace: {
                mode: "propose",
                allowedPaths: ["C:/workspace/kiln/packages/core/src"],
                deniedPaths: ["C:/workspace/kiln/.git"],
              },
              memory: {
                mode: "propose",
                scope: { kind: "project", id: "kiln" },
                operations: ["create", "update"],
              },
              artifacts: {
                mode: "propose",
                resourceUris: ["kiln://artifacts/inv-1/proposal"],
                retention: "session",
              },
              tools: {
                allowedToolNames: ["read", "rg"],
                deniedToolNames: ["git-commit"],
              },
            },
            approval: {
              mode: "required-before-apply",
              evidenceRequired: true,
            },
          },
          writeEvidence: [{
            evidenceId: "write-evidence-1",
            invocationId: "inv-1",
            kind: "write-proposal-created",
            proposalId: "write-proposal-1",
            summary: "Write proposal created.",
            resourceUris: ["kiln://artifacts/inv-1/proposal"],
            recordedAt: "2026-05-04T19:44:00.000Z",
          }],
        },
      }),
      createSessionEvent({
        kilnSessionId: session.id,
        sequence: 6,
        kind: "agent_invocation_failed",
        turnId: `${session.id}:turn:1`,
        invocationId: "inv-2",
        agentId: "agent-coder",
        errorCode: "ENGINE_TIMEOUT",
        errorMessage: "Timed out",
      }),
      createSessionEvent({
        kilnSessionId: session.id,
        sequence: 7,
        kind: "agent_invocation_cancelled",
        turnId: `${session.id}:turn:1`,
        invocationId: "inv-3",
        agentId: "agent-reviewer",
        reason: "Cancelled by operator",
      }),
    ]);

    const json = serializeSession(session);
    const restored = deserializeSession(json);

    expect(restored.sessionEvents).toHaveLength(7);
    expect(restored.sessionEvents.map((event) => event.kind)).toEqual([
      "turn_started",
      "user_message",
      "agent_invocation_requested",
      "agent_invocation_started",
      "agent_invocation_completed",
      "agent_invocation_failed",
      "agent_invocation_cancelled",
    ]);
    expect(restored.sessionEvents[1]).toMatchObject({
      kind: "user_message",
      sequence: 2,
      content: "hello",
    });
    expect(restored.sessionEvents[4]).toMatchObject({
      kind: "agent_invocation_completed",
      resultSummary: "Plan generated",
      managedInvocationEvidence: {
        writeAuthority: {
          profile: "foundation-propose-writes",
        },
        writeEvidence: [{
          evidenceId: "write-evidence-1",
          kind: "write-proposal-created",
          resourceUris: ["kiln://artifacts/inv-1/proposal"],
        }],
      },
    });
    expect(restored.sessionEvents[0]?.timestamp).toBeInstanceOf(Date);
  });
});
