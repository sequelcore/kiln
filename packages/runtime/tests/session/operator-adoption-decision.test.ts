import { describe, expect, it } from "vitest";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import {
  appendCanonicalOperatorAdoptionDecision,
  resolveCanonicalTurnIdentity,
} from "../../src/session/runtime-session-event-ledger.js";
import { prepareOperatorAdoptionTurn } from "../../src/session/operator-adoption-authority.js";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";

function replayEnvelope(sessionEvents: readonly Record<string, unknown>[]) {
  return {
    id: "session-1",
    appName: "test",
    tenantId: "tenant",
    userId: "operator",
    systemPrompt: "test",
    idleTimeoutMs: 1_000,
    sessionMode: "ai_active" as const,
    version: 0,
    createdAt: new Date(0).toISOString(),
    lastActivityAt: new Date(0).toISOString(),
    history: [],
    activeAgentId: null,
    agentTurnHistory: [],
    handoffCount: 0,
    lastRouteChangeAt: 0,
    sessionEvents: sessionEvents.map((event) => ({
      ...event,
      timestamp: new Date(0).toISOString(),
    })),
  };
}

describe("runtime operator adoption decision", () => {
  it("does not release the prepared authority until durable persistence completes", async () => {
    const session = new RuntimeSession({
      appName: "test",
      tenantId: "tenant",
      userId: "operator",
      sessionId: "session-1",
      systemPrompt: "test",
    });
    let releasePersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    let prepared = false;
    const preparation = prepareOperatorAdoptionTurn({
      session,
      actorId: "operator",
      correlationId: "request-1",
      persist: async () => persistence,
    }).then((result) => {
      prepared = true;
      return result;
    });

    await Promise.resolve();
    expect(prepared).toBe(false);
    expect(session.sessionEvents.map((event) => event.kind)).toEqual(["operator_adoption_decision"]);

    releasePersistence();
    const result = await preparation;
    expect(prepared).toBe(true);
    expect(result.turnId).toBe("session-1:turn:1");
    expect(result.operatorAdoptionDecision.contractAuthority).toEqual(
      result.event.contractAuthority,
    );
  });

  it("rejects the authority handoff when durable persistence fails", async () => {
    const session = new RuntimeSession({
      appName: "test",
      tenantId: "tenant",
      userId: "operator",
      sessionId: "session-1",
      systemPrompt: "test",
    });

    await expect(prepareOperatorAdoptionTurn({
      session,
      actorId: "operator",
      correlationId: "request-1",
      persist: async () => {
        throw new Error("transcript unavailable");
      },
    })).rejects.toThrow("transcript unavailable");
  });

  it("allocates a fresh canonical ordinal even when ingress claims a canonical-looking id", () => {
    const session = new RuntimeSession({
      appName: "test",
      tenantId: "tenant",
      userId: "operator",
      sessionId: "session-1",
      systemPrompt: "test",
    });
    const first = resolveCanonicalTurnIdentity(session, "request-1");
    appendCanonicalOperatorAdoptionDecision({
      session,
      turnId: first.turnId,
      actorId: "operator",
      correlationId: "request-1",
    });
    const retry = resolveCanonicalTurnIdentity(session, "request-1");
    expect(first.turnId).toBe("session-1:turn:1");
    expect(retry.turnId).toBe(first.turnId);
    expect(resolveCanonicalTurnIdentity(session, "session-1:turn:1").turnId).toBe("session-1:turn:2");
  });

  it("is idempotent for a persisted decision and rejects a conflicting decision", () => {
    const session = new RuntimeSession({
      appName: "test",
      tenantId: "tenant",
      userId: "operator",
      sessionId: "session-1",
      systemPrompt: "test",
    });
    const turnId = resolveCanonicalTurnIdentity(session, "attempt:1").turnId;
    const first = appendCanonicalOperatorAdoptionDecision({ session, turnId, actorId: "operator" });
    const second = appendCanonicalOperatorAdoptionDecision({ session, turnId, actorId: "operator" });
    expect(second).toBe(first);
    expect(session.sessionEvents).toHaveLength(1);
    expect(() => appendCanonicalOperatorAdoptionDecision({ session, turnId, actorId: "other" })).toThrow(
      "does not match the canonical turn authority",
    );
  });

  it("rehydrates bounded-contract supersession only after matching adoption authority", () => {
    const turnId = canonicalTurnId("session-1", 1);
    const authority = createOperatorAdoptionDecisionAuthority({
      ownerSessionId: "session-1",
      operatorTurnId: turnId,
      actorId: "operator",
    });
    const decision = {
      eventId: "decision",
      kilnSessionId: "session-1",
      sequence: 1,
      timestamp: new Date(0),
      kind: "operator_adoption_decision" as const,
      turnId,
      ...authority,
      turnOrdinal: 1,
    };
    const goal = {
      id: "goal-1",
      ownerSessionId: "session-1",
      boundedWorkContractRevision: { adoptedBy: authority.contractAuthority },
    };
    const supersession = {
      eventId: "goal-update",
      kilnSessionId: "session-1",
      sequence: 2,
      timestamp: new Date(0),
      kind: "goal.updated" as const,
      turnId,
      goal,
      changedFields: ["boundedWorkContractRevision"],
    };

    const rehydrated = RuntimeSession.fromSerialized(replayEnvelope([decision, supersession]));
    expect(rehydrated.sessionEvents).toHaveLength(2);

    expect(() => RuntimeSession.fromSerialized(replayEnvelope([{ ...supersession, sequence: 1 }]))).toThrow(
      "no preceding canonical operator adoption decision",
    );
    expect(() => RuntimeSession.fromSerialized(replayEnvelope([
      decision,
      {
        ...supersession,
        goal: {
          ...goal,
          boundedWorkContractRevision: { adoptedBy: { ...authority.contractAuthority, decisionId: "forged" } },
        },
      },
    ]))).toThrow("adoption authority does not match");
  });
});
