import { describe, expect, it } from "vitest";
import { projectAppGatewayOperatorSessionSummary } from "../../src/gateway/app-gateway-operator-session-history.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { deserializeSession, serializeSession } from "../../src/session/persistence/session-serializer.js";
import { runtimeCompletedDisposition } from "../session/runtime-terminal-fixture.js";

describe("App Gateway operator session history", () => {
  it("projects process-local live lifecycle with revisioned freshness and no restart inference", () => {
    const session = new RuntimeSession({
      sessionId: "session-live",
      appName: "support",
      tenantId: "tenant-1",
      userId: "user-1",
      systemPrompt: "Help the operator.",
    });
    const now = new Date("2026-08-25T08:00:00.000Z");

    expect(projectAppGatewayOperatorSessionSummary(session, now).liveLifecycle).toEqual({
      state: "idle",
      source: "runtime-session",
      revision: 0,
      observedAt: "2026-08-25T08:00:00.000Z",
      validUntil: "2026-08-25T08:00:05.000Z",
    });
    session.beginLiveTurn("turn-1");
    session.beginLiveTurn("turn-1");
    expect(projectAppGatewayOperatorSessionSummary(session, now).liveLifecycle).toMatchObject({ state: "running", revision: 1 });
    session.settleLiveTurn("turn-1");
    session.settleLiveTurn("turn-1");
    expect(projectAppGatewayOperatorSessionSummary(session, now).liveLifecycle).toMatchObject({ state: "idle", revision: 2 });

    const restored = deserializeSession(serializeSession(session));
    expect(projectAppGatewayOperatorSessionSummary(restored, now).liveLifecycle).toMatchObject({ state: "idle", revision: 0 });
  });

  it("projects exact latest route, terminal outcome, and accumulated cost from canonical events", () => {
    const session = new RuntimeSession({
      sessionId: "session-1",
      appName: "support",
      tenantId: "tenant-1",
      userId: "user-1",
      systemPrompt: "Help the operator.",
    });
    session.addUserMessage([{ type: "text", text: "Resolve the customer issue" }]);
    session.appendSessionEvents([
      {
        eventId: "event-1",
        kilnSessionId: session.id,
        sequence: 1,
        timestamp: new Date("2026-08-11T12:00:00.000Z"),
        kind: "provider_routed",
        routeId: "codex-sol",
        provider: { provider: "codex-oauth", model: "gpt-5.6-sol" },
        reason: "selected route",
      },
      {
        eventId: "event-2",
        kilnSessionId: session.id,
        sequence: 2,
        timestamp: new Date("2026-08-11T12:01:00.000Z"),
        kind: "cost_updated",
        provider: { provider: "codex-oauth", model: "gpt-5.6-sol" },
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cost: { currency: "USD", deltaUsd: 0.25, totalUsd: 0.25 },
      },
      {
        eventId: "event-3",
        kilnSessionId: session.id,
        sequence: 3,
        timestamp: new Date("2026-08-11T12:02:00.000Z"),
        kind: "turn_completed",
        ...runtimeCompletedDisposition(),
      },
    ]);

    expect(projectAppGatewayOperatorSessionSummary(session)).toMatchObject({
      sessionId: "session-1",
      title: "support",
      summary: "Resolve the customer issue",
      routesUsed: ["codex-sol"],
      lastRoute: { routeId: "codex-sol", provider: "codex-oauth", model: "gpt-5.6-sol" },
      lastTurnOutcome: "completed",
      costUsd: 0.25,
    });
  });

  it("does not manufacture a route when the runtime has no route evidence", () => {
    const session = new RuntimeSession({
      sessionId: "session-2",
      appName: "support",
      tenantId: "tenant-1",
      userId: "user-1",
      systemPrompt: "Help the operator.",
    });

    expect(projectAppGatewayOperatorSessionSummary(session)).toMatchObject({
      sessionId: "session-2",
      routesUsed: [],
      costUsd: 0,
    });
    expect(projectAppGatewayOperatorSessionSummary(session)).not.toHaveProperty("lastRoute");
  });

  it("accumulates turn-local cost deltas across the whole session", () => {
    const session = new RuntimeSession({
      sessionId: "session-cost",
      appName: "support",
      tenantId: "tenant-1",
      userId: "user-1",
      systemPrompt: "Help the operator.",
    });
    session.appendSessionEvents([
      {
        eventId: "turn-1-cost",
        kilnSessionId: session.id,
        sequence: 1,
        timestamp: new Date("2026-08-11T12:00:00.000Z"),
        kind: "cost_updated",
        provider: { provider: "codex-oauth", model: "gpt-5.6-sol" },
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cost: { currency: "USD", deltaUsd: 0.25, totalUsd: 0.25 },
      },
      {
        eventId: "turn-2-cost",
        kilnSessionId: session.id,
        sequence: 2,
        timestamp: new Date("2026-08-11T12:01:00.000Z"),
        kind: "cost_updated",
        provider: { provider: "opencode", model: "gpt-5.6" },
        usage: { inputTokens: 12, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cost: { currency: "USD", deltaUsd: 0.3, totalUsd: 0.3 },
      },
    ]);

    expect(projectAppGatewayOperatorSessionSummary(session).costUsd).toBeCloseTo(0.55);
  });
});
