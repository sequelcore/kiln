import { describe, expect, it, vi } from "vitest";
import { createSessionEvent } from "@kilnai/core/events";
import type { CanonicalSessionEvent, CostUpdateEvent, ToolCalledEvent, ToolResultEvent } from "@kilnai/core/events";
import { CanonicalTurnLifecycle } from "../../src/session/runtime-session-event-ledger.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

describe("CanonicalTurnLifecycle", () => {
  function createOptions(session: RuntimeSession, persist: (events: readonly CanonicalSessionEvent[]) => Promise<void>) {
    return {
      session,
      turnId: `${session.id}:turn:1`,
      channel: "gui",
      userMessageContent: "read the file",
      turnStartedAt: new Date("2026-08-25T01:00:00.000Z"),
      continuity: { strategy: "fresh" },
      persist,
    } as const;
  }

  it("does not re-append runtime evidence already represented by the session ledger", async () => {
    const session = new RuntimeSession({
      sessionId: "runtime-lifecycle-session",
      appName: "test-app",
      tenantId: "test-tenant",
      userId: "test-user",
      systemPrompt: "test",
    });
    const turnId = `${session.id}:turn:1`;
    const toolEvent: ToolCalledEvent = {
      type: "tool_called",
      sessionId: session.id,
      toolCallId: "tool-1",
      toolCallScopeId: `${turnId}:response:1`,
      toolName: "read_file",
      toolInput: { path: "README.md" },
      timestamp: new Date("2026-08-25T01:00:01.000Z"),
    };
    const persist = vi.fn().mockResolvedValue(undefined);
    const options = {
      session,
      turnId,
      channel: "gui",
      userMessageContent: "read the file",
      turnStartedAt: new Date("2026-08-25T01:00:00.000Z"),
      continuity: { strategy: "fresh" },
      persist,
    } as const;

    const firstLifecycle = new CanonicalTurnLifecycle(options);
    await firstLifecycle.start();
    firstLifecycle.appendRuntimeEvent(toolEvent);
    await firstLifecycle.flush();

    const secondLifecycle = new CanonicalTurnLifecycle(options);
    await secondLifecycle.start();
    secondLifecycle.appendRuntimeEvent(toolEvent);
    await secondLifecycle.flush();

    expect(session.sessionEvents.filter((event) => event.kind === "turn_started")).toHaveLength(1);
    expect(session.sessionEvents.filter((event) => event.kind === "tool_call_started")).toHaveLength(1);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("rejects a settled turn before a duplicate provider dispatch", async () => {
    const session = new RuntimeSession({
      sessionId: "runtime-settlement-session",
      appName: "test-app",
      tenantId: "test-tenant",
      userId: "test-user",
      systemPrompt: "test",
    });
    const turnId = `${session.id}:turn:1`;
    const first = new CanonicalTurnLifecycle({
      session,
      turnId,
      channel: "gui",
      userMessageContent: "finish the turn",
      turnStartedAt: new Date("2026-08-25T01:00:00.000Z"),
      continuity: { strategy: "fresh" },
    });
    await first.start();
    await first.settle({
      queued: false,
      turnOutcome: "completed",
      turnCompletedAt: new Date("2026-08-25T01:00:01.000Z"),
    });
    expect(session.sessionEvents.filter((event) => event.kind === "turn_completed")).toHaveLength(1);
    const duplicate = new CanonicalTurnLifecycle({
      session,
      turnId,
      channel: "gui",
      userMessageContent: "finish the turn",
      turnStartedAt: new Date("2026-08-25T01:00:00.000Z"),
      continuity: { strategy: "fresh" },
    });
    await expect(duplicate.start()).rejects.toThrow(`Canonical turn ${turnId} is already settled as completed.`);
    expect(session.sessionEvents.filter((event) => event.kind === "turn_completed")).toHaveLength(1);
  });

  it("does not poison the session or dedupe state when the durable sink fails", async () => {
    const session = new RuntimeSession({
      sessionId: "runtime-persistence-failure-session",
      appName: "test-app",
      tenantId: "test-tenant",
      userId: "test-user",
      systemPrompt: "test",
    });
    const failure = new Error("durable sink unavailable");
    const rejectedPersist = vi.fn().mockRejectedValue(failure);
    const first = new CanonicalTurnLifecycle(createOptions(session, rejectedPersist));

    await expect(first.start()).rejects.toBe(failure);
    expect(first.state).toBe("failed");
    expect(session.sessionEvents).toEqual([]);

    const recoveredPersist = vi.fn().mockResolvedValue(undefined);
    const second = new CanonicalTurnLifecycle(createOptions(session, recoveredPersist));
    await second.start();
    const toolEvent: ToolCalledEvent = {
      type: "tool_called",
      sessionId: session.id,
      toolCallId: "tool-after-failure",
      toolCallScopeId: `${session.id}:turn:1:response:1`,
      toolName: "read_file",
      toolInput: { path: "README.md" },
      timestamp: new Date("2026-08-25T01:00:01.000Z"),
    };
    expect(second.appendRuntimeEvent(toolEvent)).toBe(true);
    await second.flush();
    expect(session.sessionEvents.filter((event) => event.kind === "tool_call_started")).toHaveLength(1);
    expect(recoveredPersist).toHaveBeenCalledTimes(2);
  });

  it("commits synchronous EventBus-style bursts in arrival order", async () => {
    const session = new RuntimeSession({
      sessionId: "runtime-ordered-burst-session",
      appName: "test-app",
      tenantId: "test-tenant",
      userId: "test-user",
      systemPrompt: "test",
    });
    const persisted: string[] = [];
    const persist = vi.fn(async (events: readonly { readonly kind: string }[]) => {
      persisted.push(...events.map((event) => event.kind));
    });
    const lifecycle = new CanonicalTurnLifecycle(createOptions(session, persist));
    await lifecycle.start();
    const turnId = `${session.id}:turn:1`;
    const called: ToolCalledEvent = {
      type: "tool_called",
      sessionId: session.id,
      toolCallId: "burst-tool",
      toolCallScopeId: `${turnId}:response:1`,
      toolName: "read_file",
      toolInput: { path: "README.md" },
      timestamp: new Date("2026-08-25T01:00:01.000Z"),
    };
    const result: ToolResultEvent = {
      type: "tool_result",
      sessionId: session.id,
      toolCallId: "burst-tool",
      toolCallScopeId: `${turnId}:response:1`,
      toolName: "read_file",
      durationMs: 10,
      success: true,
      output: "ok",
      resultSummary: "ok",
      timestamp: new Date("2026-08-25T01:00:02.000Z"),
    };
    expect(lifecycle.appendRuntimeEvent(called)).toBe(true);
    expect(lifecycle.appendRuntimeEvent(result)).toBe(true);
    await lifecycle.flush();
    expect(persisted).toEqual([
      "turn_started",
      "user_message",
      "continuity_decided",
      "tool_call_started",
      "tool_call_completed",
    ]);
    expect(session.sessionEvents.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "owns exactly one %s terminal and ignores late runtime events",
    async (outcome) => {
      const session = new RuntimeSession({
        sessionId: `runtime-terminal-${outcome}-session`,
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "test-user",
        systemPrompt: "test",
      });
      const persist = vi.fn().mockResolvedValue(undefined);
      const lifecycle = new CanonicalTurnLifecycle(createOptions(session, persist));
      await lifecycle.start();
      await lifecycle.settle({
        queued: false,
        turnOutcome: outcome,
        turnCompletedAt: new Date("2026-08-25T01:00:03.000Z"),
      });
      expect(lifecycle.state).toBe("settled");
      expect(lifecycle.appendRuntimeEvent({
        type: "cost_update",
        provider: "codex-oauth",
        model: "gpt-5.5",
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: 0.001,
        byRoleModel: {},
        timestamp: new Date("2026-08-25T01:00:04.000Z"),
        sessionId: session.id,
      } satisfies CostUpdateEvent)).toBe(false);
      expect(session.sessionEvents.filter((event) => event.kind === "turn_completed")).toHaveLength(1);
      await lifecycle.settle({
        queued: false,
        turnOutcome: outcome,
        turnCompletedAt: new Date("2026-08-25T01:00:05.000Z"),
      });
      expect(session.sessionEvents.filter((event) => event.kind === "turn_completed")).toHaveLength(1);
    },
  );

  it("does not duplicate cost or tool evidence in one lifecycle", async () => {
    const session = new RuntimeSession({
      sessionId: "runtime-dedupe-session",
      appName: "test-app",
      tenantId: "test-tenant",
      userId: "test-user",
      systemPrompt: "test",
    });
    const lifecycle = new CanonicalTurnLifecycle(createOptions(session, vi.fn().mockResolvedValue(undefined)));
    await lifecycle.start();
    const toolEvent: ToolCalledEvent = {
      type: "tool_called",
      sessionId: session.id,
      toolCallId: "dedupe-tool",
      toolCallScopeId: `${session.id}:turn:1:response:1`,
      toolName: "read_file",
      toolInput: { path: "README.md" },
      timestamp: new Date("2026-08-25T01:00:01.000Z"),
    };
    const costEvent: CostUpdateEvent = {
      type: "cost_update",
      provider: "codex-oauth",
      model: "gpt-5.5",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCostUsd: 0.001,
      byRoleModel: {},
      timestamp: new Date("2026-08-25T01:00:02.000Z"),
      sessionId: session.id,
    };
    expect(lifecycle.appendRuntimeEvent(toolEvent)).toBe(true);
    expect(lifecycle.appendRuntimeEvent(toolEvent)).toBe(false);
    expect(lifecycle.appendRuntimeEvent(costEvent)).toBe(true);
    expect(lifecycle.appendRuntimeEvent(costEvent)).toBe(false);
    await lifecycle.flush();
    expect(session.sessionEvents.filter((event) => event.kind === "tool_call_started")).toHaveLength(1);
    expect(session.sessionEvents.filter((event) => event.kind === "cost_updated")).toHaveLength(1);
  });

  it("serializes sequence allocation across concurrent turn lifecycles", async () => {
    const session = new RuntimeSession({
      sessionId: "runtime-sequence-owner-session",
      appName: "test-app",
      tenantId: "test-tenant",
      userId: "test-user",
      systemPrompt: "test",
    });
    let releaseFirstPersist!: () => void;
    const firstPersistGate = new Promise<void>((resolve) => {
      releaseFirstPersist = resolve;
    });
    let persistCalls = 0;
    const persist = vi.fn(async () => {
      persistCalls += 1;
      if (persistCalls === 1) await firstPersistGate;
    });
    const first = new CanonicalTurnLifecycle({
      ...createOptions(session, persist),
      turnId: `${session.id}:turn:1`,
      userMessageContent: "first",
    });
    const second = new CanonicalTurnLifecycle({
      ...createOptions(session, persist),
      turnId: `${session.id}:turn:2`,
      userMessageContent: "second",
    });

    const firstStart = first.start();
    const secondStart = second.start();
    for (let index = 0; index < 5 && persistCalls === 0; index += 1) {
      await Promise.resolve();
    }
    expect(persist).toHaveBeenCalledTimes(1);
    expect(() => session.appendSessionEvents([createSessionEvent<"turn_started">({
      kilnSessionId: session.id,
      sequence: 1,
      kind: "turn_started",
      turnId: `${session.id}:turn:external`,
      turnOrdinal: 99,
      trigger: "user_message",
      source: { actor: "runtime", surface: "runtime", component: "test" },
      timestamp: new Date("2026-08-25T01:00:00.000Z"),
    })])).toThrow("active Runtime session owner");
    releaseFirstPersist();
    await Promise.all([firstStart, secondStart]);
    await Promise.all([
      first.settle({
        queued: false,
        turnOutcome: "completed",
        turnCompletedAt: new Date("2026-08-25T01:00:01.000Z"),
      }),
      second.settle({
        queued: false,
        turnOutcome: "completed",
        turnCompletedAt: new Date("2026-08-25T01:00:02.000Z"),
      }),
    ]);

    const sequences = session.sessionEvents.map((event) => event.sequence);
    expect(sequences).toEqual(Array.from({ length: sequences.length }, (_, index) => index + 1));
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(session.sessionEvents.filter((event) => event.kind === "turn_completed")).toHaveLength(2);
  });

  it("aborts execution immediately when incremental progress persistence fails", async () => {
    const session = new RuntimeSession({
      sessionId: "runtime-progress-abort-session",
      appName: "test-app",
      tenantId: "test-tenant",
      userId: "test-user",
      systemPrompt: "test",
    });
    const abortController = new AbortController();
    const failure = new Error("progress sink unavailable");
    const persist = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure);
    const lifecycle = new CanonicalTurnLifecycle({
      ...createOptions(session, persist),
      requestAbort: (reason) => abortController.abort(reason),
    });
    await lifecycle.start();
    expect(lifecycle.appendRuntimeEvent({
      type: "tool_called",
      sessionId: session.id,
      toolCallId: "abort-tool",
      toolCallScopeId: `${session.id}:turn:1:response:1`,
      toolName: "read_file",
      toolInput: { path: "README.md" },
      timestamp: new Date("2026-08-25T01:00:01.000Z"),
    })).toBe(true);

    await expect(lifecycle.flush()).rejects.toBe(failure);
    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe(failure);
    expect(session.sessionEvents.filter((event) => event.kind === "turn_completed")).toHaveLength(0);
  });
});
