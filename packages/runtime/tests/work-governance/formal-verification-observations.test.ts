import { describe, expect, it } from "vitest";
import { formalVerificationToolMetadata } from "@kilnai/core/tools";
import type { CanonicalSessionEvent, SessionExecutionScope } from "@kilnai/core/events";
import { collectRuntimeFormalVerificationObservations } from "../../src/work-governance/formal-verification-observations.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

interface TestFormalVerificationExecution {
  readonly toolCallScopeId: string;
  readonly toolCallId?: string;
  readonly toolName: string;
  readonly success: boolean;
  readonly metadata?: unknown;
  readonly executionScope?: SessionExecutionScope;
}

const scope = {
  kind: "work_item",
  goalRunId: "goal-1",
  workItemId: "work-1",
  attemptId: "attempt-1",
} as const satisfies SessionExecutionScope;

function metadata(version = "4.11.0") {
  return formalVerificationToolMetadata({
    verifier: { name: "dafny", version },
    artifact: { contentDigest: `sha256:${"a".repeat(64)}` },
    subjects: [{ path: "src/Test.dfy", contentDigest: `sha256:${"e".repeat(64)}` }],
    checks: [{ symbol: "Invariant", check: "correctness", outcome: "proved" }],
  });
}

function execution(
  overrides: Partial<TestFormalVerificationExecution> = {},
): TestFormalVerificationExecution {
  return {
    toolCallScopeId: "session-1:turn:1:response:1",
    toolCallId: "formal-1",
    toolName: "formal_verify",
    success: true,
    metadata: metadata(),
    executionScope: scope,
    ...overrides,
  };
}

function replayEvent(
  overrides: Partial<Extract<CanonicalSessionEvent, { kind: "tool_call_completed" }>> = {},
): Extract<CanonicalSessionEvent, { kind: "tool_call_completed" }> {
  return {
    eventId: "event-1",
    kilnSessionId: "session-1",
    sequence: 1,
    timestamp: new Date("2026-08-19T12:00:00.000Z"),
    kind: "tool_call_completed",
    turnId: "session-1:turn:1",
    toolCallId: "formal-1",
    toolCallScopeId: "session-1:turn:1:response:1",
    toolName: "formal_verify",
    status: { state: "succeeded" },
    metadata: metadata(),
    executionScope: scope,
    ...overrides,
  };
}

describe("runtime formal-verification observation collection", () => {
  it("normalizes only an executor-owned successful result and stamps its provenance", () => {
    const observations = collectRuntimeFormalVerificationObservations({
      currentScope: scope,
      currentTurnToolExecutions: [execution()],
    });
    const [observation] = observations;

    expect(Object.isFrozen(observations)).toBe(true);
    expect(observation).toBeDefined();
    if (!observation) throw new Error("expected a formal-verification observation");
    expect(observation).toMatchObject({
      toolCallScopeId: "session-1:turn:1:response:1",
      toolCallId: "formal-1",
      executionScope: scope,
      metadata: {
        schema: "kiln.formal-verification-observation/v2",
        establishes: [],
      },
    });
    expect(Object.isFrozen(observation)).toBe(true);
    expect(Object.isFrozen(observation.metadata)).toBe(true);
  });

  it("replays an equal canonical duplicate without duplicating the observation", () => {
    const observations = collectRuntimeFormalVerificationObservations({
      currentScope: scope,
      sessionEvents: [replayEvent()],
      currentTurnToolExecutions: [execution()],
    });

    expect(observations).toHaveLength(1);
    const [observation] = observations;
    expect(observation?.metadata.verifier.version).toBe("4.11.0");
    expect(observation).not.toHaveProperty("timestamp");
  });

  it("filters foreign session events at session replay before formal observations are collected", () => {
    const foreign = replayEvent({
      eventId: "foreign-event",
      kilnSessionId: "session-foreign",
      sequence: 2,
      toolCallId: "foreign-formal-1",
    });
    const restored = RuntimeSession.fromSerialized({
      id: "session-1",
      appName: "kiln",
      tenantId: "test-tenant",
      userId: "operator",
      systemPrompt: "test",
      idleTimeoutMs: 30_000,
      sessionMode: "ai_active",
      version: 2,
      createdAt: "2026-08-19T11:59:00.000Z",
      lastActivityAt: "2026-08-19T12:00:00.000Z",
      history: [],
      activeAgentId: null,
      agentTurnHistory: [],
      handoffCount: 0,
      lastRouteChangeAt: 0,
      sessionEvents: [replayEvent(), foreign].map((event) => ({
        ...event,
        timestamp: event.timestamp.toISOString(),
      })),
    });

    expect(restored.sessionEvents.map((event) => event.kilnSessionId)).toEqual(["session-1"]);
    expect(collectRuntimeFormalVerificationObservations({
      currentScope: scope,
      sessionEvents: restored.sessionEvents,
    }).map((observation) => observation.toolCallId)).toEqual(["formal-1"]);
  });

  it("deduplicates equal current-turn summaries", () => {
    const observations = collectRuntimeFormalVerificationObservations({
      currentScope: scope,
      currentTurnToolExecutions: [
        execution(),
        execution(),
      ],
    });

    expect(observations).toHaveLength(1);
  });

  it("keeps repeated provider tool-call ids distinct across tool-call scopes", () => {
    const observations = collectRuntimeFormalVerificationObservations({
      currentScope: scope,
      currentTurnToolExecutions: [
        execution({ toolCallScopeId: "session-1:turn:1:response:1" }),
        execution({ toolCallScopeId: "session-1:turn:1:response:2" }),
      ],
    });

    expect(observations.map((entry) => [entry.toolCallScopeId, entry.toolCallId])).toEqual([
      ["session-1:turn:1:response:1", "formal-1"],
      ["session-1:turn:1:response:2", "formal-1"],
    ]);
  });

  it("omits conflicting replay/current duplicates instead of first-wins", () => {
    const observations = collectRuntimeFormalVerificationObservations({
      currentScope: scope,
      sessionEvents: [replayEvent()],
      currentTurnToolExecutions: [execution({ metadata: metadata("4.12.0") })],
    });

    expect(observations).toEqual([]);
  });

  it("rejects failed, malformed, attributed, unscoped, wrong-tool, and cross-scope records", () => {
    const otherScope = { ...scope, attemptId: "attempt-2" } as const;
    const managedScope = { ...scope, managedInvocationId: "managed-1" } as const;
    const malformed = { ...metadata(), criterionId: "acceptance-1" };
    const establishes = { ...metadata(), establishes: ["acceptance-1"] };
    const observations = collectRuntimeFormalVerificationObservations({
      currentScope: scope,
      currentTurnToolExecutions: [
        execution({ toolCallId: "failed", success: false }),
        execution({ toolCallId: "wrong-tool", toolName: "read" }),
        execution({ toolCallId: "malformed", metadata: { kind: "formal_verification" } }),
        execution({ toolCallId: "criterion", metadata: malformed }),
        execution({ toolCallId: "establishes", metadata: establishes }),
        execution({ toolCallId: "unscoped", executionScope: undefined }),
        execution({ toolCallId: "missing-scope", toolCallScopeId: "" }),
        execution({ toolCallId: "missing-attempt", executionScope: {
          kind: "work_item",
          goalRunId: "goal-1",
          workItemId: "work-1",
        } }),
        execution({ toolCallId: "goal-scope", executionScope: { kind: "goal", goalRunId: "goal-1" } }),
        execution({ toolCallId: "cross-attempt", executionScope: otherScope }),
        execution({ toolCallId: "managed-scope", executionScope: managedScope }),
      ],
    });

    expect(observations).toEqual([]);
  });

  it("requires exact optional scope presence and value, including managed invocation identity", () => {
    const managedScope = { ...scope, managedInvocationId: "managed-1" } as const;
    const observations = collectRuntimeFormalVerificationObservations({
      currentScope: managedScope,
      currentTurnToolExecutions: [
        execution({ toolCallId: "missing-managed", executionScope: scope }),
        execution({ toolCallId: "other-managed", executionScope: { ...managedScope, managedInvocationId: "managed-2" } }),
        execution({ toolCallId: "matching-managed", executionScope: managedScope }),
      ],
    });

    expect(observations.map((entry) => entry.toolCallId)).toEqual(["matching-managed"]);
  });
});
