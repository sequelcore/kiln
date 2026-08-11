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
        provider: "codex-oauth",
        providersUsed: ["codex-oauth"],
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
        provider: "opencode",
        providersUsed: ["opencode", "codex-oauth"],
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
      providersUsed: ["opencode", "codex-oauth"],
      lastRoute: { provider: "opencode" },
      lastTurnOutcome: "completed",
      updatedAt: "2026-08-11T12:02:00.000Z",
      costUsd: 0.3,
    });
  });

  it("uses deterministic transcript fallbacks without manufacturing route detail", () => {
    expect(projectOperatorSessionSummary({
      transcript: {
        sessionId: "session-2",
        provider: "claude-code",
        task: "Review the operator session boundary",
        startedAt: "2026-08-11T13:00:00.000Z",
      },
    })).toEqual({
      sessionId: "session-2",
      title: "Review the operator session boundary",
      tags: [],
      providersUsed: ["claude-code"],
      lastRoute: { provider: "claude-code" },
      updatedAt: "2026-08-11T13:00:00.000Z",
      costUsd: 0,
    });
  });

  it("never combines a provider with a model from older route evidence", () => {
    expect(projectOperatorSessionSummary({
      transcript: {
        sessionId: "session-route",
        provider: "codex-oauth",
        model: "gpt-5.6",
        task: "Verify route identity",
        startedAt: "2026-08-11T13:00:00.000Z",
      },
      ledger: {
        provider: "opencode",
        task: "Verify route identity",
        completedAt: "2026-08-11T13:01:00.000Z",
        accumulatedCostUsd: 0,
      },
    }).lastRoute).toEqual({ provider: "opencode" });
  });

  it("rejects malformed session entries at the transport boundary", () => {
    expect(OperatorSessionHistoryResponseSchema.safeParse({
      sessions: [{
        sessionId: "session-3",
        title: "Invalid timestamp",
        tags: [],
        providersUsed: [],
        updatedAt: "yesterday",
        costUsd: 0,
      }],
    }).success).toBe(false);
  });
});
