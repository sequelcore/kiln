import { describe, expect, it } from "vitest";
import {
  OperatorSessionHistoryResponseSchema,
  projectOperatorSessionSummary,
} from "../src/operator-session-summary.js";

describe("operator session summary projection", () => {
  it("merges transcript authority with newer ledger evidence", () => {
    expect(projectOperatorSessionSummary({
      transcript: {
        sessionId: "session-1",
        routeId: "codex-terra",
        provider: "codex-oauth",
        routesUsed: ["codex-terra"],
        title: "Plan shared session history",
        summary: "Initial session history plan.",
        tags: ["architecture"],
        task: "interactive",
        startedAt: "2026-08-11T12:00:00.000Z",
        completedAt: "2026-08-11T12:01:00.000Z",
        lastTurnOutcome: "completed",
        costUsd: 0,
      },
      ledger: {
        routeId: "opencode-sonic",
        provider: "opencode",
        routesUsed: ["opencode-sonic", "codex-terra"],
        summary: "Use one cross-surface session projection.",
        task: "interactive",
        completedAt: "2026-08-11T12:02:00.000Z",
        accumulatedCostUsd: 0.3,
      },
    })).toEqual({
      sessionId: "session-1",
      title: "Plan shared session history",
      summary: "Use one cross-surface session projection.",
      tags: ["architecture"],
      routesUsed: ["opencode-sonic", "codex-terra"],
      lastRoute: { routeId: "opencode-sonic", provider: "opencode" },
      lastTurnOutcome: "completed",
      updatedAt: "2026-08-11T12:02:00.000Z",
      costUsd: 0.3,
    });
  });

  it("uses deterministic transcript fallbacks without manufacturing route detail", () => {
    expect(projectOperatorSessionSummary({
      transcript: {
        sessionId: "session-2",
        routeId: "claude-route",
        provider: "claude-code",
        routesUsed: ["claude-route"],
        task: "Review the operator session boundary",
        startedAt: "2026-08-11T13:00:00.000Z",
      },
    })).toEqual({
      sessionId: "session-2",
      title: "Review the operator session boundary",
      tags: [],
      routesUsed: ["claude-route"],
      lastRoute: { routeId: "claude-route", provider: "claude-code" },
      updatedAt: "2026-08-11T13:00:00.000Z",
      costUsd: 0,
    });
  });

  it("never combines a provider with a model from older route evidence", () => {
    expect(projectOperatorSessionSummary({
      transcript: {
        sessionId: "session-route",
        routeId: "codex-terra",
        provider: "codex-oauth",
        routesUsed: ["codex-terra"],
        model: "gpt-5.6",
        task: "Verify route identity",
        startedAt: "2026-08-11T13:00:00.000Z",
      },
      ledger: {
        routeId: "opencode-sonic",
        provider: "opencode",
        routesUsed: ["opencode-sonic"],
        task: "Verify route identity",
        completedAt: "2026-08-11T13:01:00.000Z",
        accumulatedCostUsd: 0,
      },
    }).lastRoute).toEqual({ routeId: "opencode-sonic", provider: "opencode" });
  });

  it("does not promote provider-only execution evidence into a route identity", () => {
    expect(projectOperatorSessionSummary({
      transcript: {
        sessionId: "session-provider-only",
        provider: "codex-oauth",
        model: "gpt-5.6",
        task: "Inspect legacy evidence",
        startedAt: "2026-08-11T14:00:00.000Z",
      },
    })).toMatchObject({
      routesUsed: [],
    });
    expect(projectOperatorSessionSummary({
      transcript: {
        sessionId: "session-provider-only",
        provider: "codex-oauth",
        model: "gpt-5.6",
        task: "Inspect legacy evidence",
        startedAt: "2026-08-11T14:00:00.000Z",
      },
    })).not.toHaveProperty("lastRoute");
  });

  it("rejects malformed session entries at the transport boundary", () => {
    expect(OperatorSessionHistoryResponseSchema.safeParse({
      sessions: [{
        sessionId: "session-3",
        title: "Invalid timestamp",
        tags: [],
        routesUsed: [],
        updatedAt: "yesterday",
        costUsd: 0,
      }],
    }).success).toBe(false);
  });
});
