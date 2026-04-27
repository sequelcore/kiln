import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveChangedFiles,
  derivePendingApprovals,
  deriveRuntimeContinuity,
  deriveToolCallLog,
  useSessionStore,
} from "../src/lib/session-store.js";

function resetSessionStore(): void {
  useSessionStore.setState({
    status: "idle",
    messages: [],
    timelineEntries: [],
    currentAssistant: null,
    planMode: false,
    activity: null,
    errorBanner: null,
    providers: [],
    activeProvider: null,
    activeModel: null,
    sessionList: [],
    selectedSessionId: null,
    resumeTargetId: null,
    routedProvider: null,
    routedModel: null,
    routeMode: "auto",
    respondingProvider: null,
    respondingModel: null,
    turnCounter: 0,
    sessionCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    currentTurnTrackedInputTokens: 0,
    currentTurnTrackedOutputTokens: 0,
    clearPending: false,
    providerSwitching: false,
    providerExplicitSelection: false,
    authorityStatus: null,
    activityPhase: "idle",
    outboundSend: null,
    clearTimeoutId: null,
    providerSwitchTimeoutId: null,
  });
}

describe("session-store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetSessionStore();
  });

  it("onWelcome seeds providers and persisted plan mode wins", () => {
    localStorage.setItem("kiln.gui.planMode", "true");
    localStorage.setItem("kiln.gui.resumeTarget", "session-123");

    useSessionStore.getState().onWelcome({
      type: "welcome",
      models: { claude: ["sonnet"], codex: ["o3"] },
      activeProvider: "claude",
      activeModel: "sonnet",
      planMode: false,
    });

    const state = useSessionStore.getState();
    expect(state.providers.map((provider) => provider.id)).toEqual(["claude", "codex"]);
    expect(state.activeProvider).toBe("claude");
    expect(state.activeModel).toBe("sonnet");
    expect(state.planMode).toBe(true);
    expect(state.resumeTargetId).toBe("session-123");
  });

  it("onTextDelta creates and appends to a single streaming assistant message", () => {
    useSessionStore.getState().onTextDelta({ type: "text_delta", content: "Hello" });
    useSessionStore.getState().onTextDelta({ type: "text_delta", content: " world" });

    const state = useSessionStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.timelineEntries).toHaveLength(1);
    expect(state.messages[0]?.role).toBe("assistant");
    expect(state.messages[0]?.content).toBe("Hello world");
    expect(state.messages[0]?.streaming).toBe(true);
    expect(state.currentAssistant).not.toBeNull();
  });

  it("onDone closes streaming assistant and flips status to ready", () => {
    useSessionStore.getState().onTextDelta({ type: "text_delta", content: "Hi" });
    useSessionStore.getState().onDone({
      type: "done",
      content: "",
      inputTokens: 1,
      outputTokens: 1,
      routedProvider: "claude",
      routedModel: "sonnet",
    });

    const state = useSessionStore.getState();
    expect(state.status).toBe("ready");
    expect(state.currentAssistant).toBeNull();
    expect(state.messages[0]?.streaming).toBe(false);
    expect(state.timelineEntries.at(-1)).toMatchObject({
      type: "event",
      eventKind: "turn_completed",
    });
    expect(state.routedProvider).toBe("claude");
    expect(state.routedModel).toBe("sonnet");
  });

  it("tracks session telemetry from cost updates and canonical file-change events", () => {
    useSessionStore.setState({
      activeProvider: "claude",
      activeModel: "sonnet",
      status: "running",
    });

    useSessionStore.getState().onActivity({
      type: "activity",
      activity: "cost_update",
      usd: 0.125,
      inputTokens: 1200,
      outputTokens: 340,
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-file-1",
      kilnSessionId: "session-1",
      sequence: 1,
      timestamp: "2026-04-23T18:00:00.000Z",
      kind: "file_changed",
      payload: {
        change: {
          path: "packages/gui/src/app.tsx",
          changeType: "modified",
          linesAdded: 12,
          linesRemoved: 4,
          diffPreview: "- old\n+ new",
          diffTruncated: false,
        },
      },
    });

    const state = useSessionStore.getState();
    expect(state.sessionCostUsd).toBeCloseTo(0.125);
    expect(state.inputTokens).toBe(1200);
    expect(state.outputTokens).toBe(340);
    expect(deriveChangedFiles(state.timelineEntries)).toEqual([
      expect.objectContaining({
        path: "packages/gui/src/app.tsx",
        changeType: "modified",
      }),
    ]);
    expect(deriveChangedFiles(state.timelineEntries)[0]).toMatchObject({
      path: "packages/gui/src/app.tsx",
      changeType: "modified",
      linesAdded: 12,
      linesRemoved: 4,
      diffPreview: "- old\n+ new",
      diffTruncated: false,
    });
  });

  it("applies live canonical session events to streaming/tool/approval state", () => {
    useSessionStore.setState({
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      status: "running",
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-provider",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-04-23T19:00:00.000Z",
      kind: "provider_routed",
      payload: {
        provider: {
          provider: "codex-oauth",
          model: "gpt-5.4-mini",
        },
        reason: "configured",
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-delta",
      kilnSessionId: "session-live",
      sequence: 2,
      timestamp: "2026-04-23T19:00:01.000Z",
      kind: "assistant_delta",
      payload: {
        messageId: "msg-live",
        delta: "hello",
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-tool-start",
      kilnSessionId: "session-live",
      sequence: 3,
      timestamp: "2026-04-23T19:00:02.000Z",
      kind: "tool_call_started",
      payload: {
        toolCallId: "tool-live",
        toolName: "write",
        input: { path: "demo.txt" },
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-approval",
      kilnSessionId: "session-live",
      sequence: 4,
      timestamp: "2026-04-23T19:00:03.000Z",
      kind: "approval_requested",
      payload: {
        approvalId: "approval-live",
        action: "Write demo.txt",
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-cost",
      kilnSessionId: "session-live",
      sequence: 5,
      timestamp: "2026-04-23T19:00:04.000Z",
      kind: "cost_updated",
      payload: {
        provider: {
          provider: "codex-oauth",
          model: "gpt-5.4-mini",
        },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
        },
        cost: {
          deltaUsd: 0.02,
        },
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-file",
      kilnSessionId: "session-live",
      sequence: 6,
      timestamp: "2026-04-23T19:00:05.000Z",
      kind: "file_changed",
      payload: {
        change: {
          path: "demo.txt",
          changeType: "updated",
          linesAdded: 7,
          linesRemoved: 2,
          diffPreview: "- previous\n+ current",
          diffTruncated: true,
        },
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-tool-end",
      kilnSessionId: "session-live",
      sequence: 7,
      timestamp: "2026-04-23T19:00:06.000Z",
      kind: "tool_call_completed",
      payload: {
        toolCallId: "tool-live",
        toolName: "write",
        outputSummary: "Wrote demo.txt",
        status: {
          state: "succeeded",
        },
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-approval-end",
      kilnSessionId: "session-live",
      sequence: 8,
      timestamp: "2026-04-23T19:00:07.000Z",
      kind: "approval_resolved",
      payload: {
        approvalId: "approval-live",
        resolution: {
          decision: "approved",
          resolvedBy: "operator",
        },
      },
    });

    const state = useSessionStore.getState();
    expect(state.messages[0]).toMatchObject({
      role: "assistant",
      content: "hello",
    });
    expect(state.timelineEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "message" }),
        expect.objectContaining({ type: "event", eventKind: "provider_routed" }),
        expect.objectContaining({ type: "event", eventKind: "tool_call_started" }),
        expect.objectContaining({ type: "event", eventKind: "approval_requested" }),
        expect.objectContaining({ type: "event", eventKind: "cost_updated" }),
        expect.objectContaining({ type: "event", eventKind: "file_changed" }),
        expect.objectContaining({ type: "event", eventKind: "tool_call_completed" }),
        expect.objectContaining({ type: "event", eventKind: "approval_resolved" }),
      ]),
    );
    expect(state.respondingProvider).toBe("codex-oauth");
    expect(state.respondingModel).toBe("gpt-5.4-mini");
    expect(deriveToolCallLog(state.timelineEntries)).toEqual([
      expect.objectContaining({
        callId: "tool-live",
        toolName: "write",
        status: "success",
      }),
    ]);
    expect(derivePendingApprovals(state.timelineEntries)).toHaveLength(0);
    expect(state.sessionCostUsd).toBeCloseTo(0.02);
    expect(deriveChangedFiles(state.timelineEntries)).toEqual([
      expect.objectContaining({
        path: "demo.txt",
        changeType: "modified",
        linesAdded: 7,
        linesRemoved: 2,
        diffPreview: "- previous\n+ current",
        diffTruncated: true,
      }),
    ]);
  });

  it("stores runtime continuity per finalized provider and reconciles done-token fallback", () => {
    useSessionStore.setState({
      activeProvider: "claude",
      activeModel: "sonnet",
      status: "running",
    });

    useSessionStore.getState().onDone({
      type: "done",
      content: "done",
      inputTokens: 250,
      outputTokens: 75,
      routedProvider: "codex",
      routedModel: "o3",
      runtimeContinuity: {
        strategy: "cache-first",
        feedbackLabel: "applied",
        pressure: "medium",
        supportArtifactCount: 2,
        supportArtifactSources: ["session", "project"],
        fallbackLabel: "support available",
        usedCachedSupport: true,
        selectionReason: "recent continuity",
      },
    });

    const state = useSessionStore.getState();
    expect(state.inputTokens).toBe(250);
    expect(state.outputTokens).toBe(75);
    expect(deriveRuntimeContinuity(state.timelineEntries, "codex")).toMatchObject({
      strategy: "cache-first",
      feedbackLabel: "applied",
      pressure: "medium",
    });
  });

  it("onError adds error row and sets banner", () => {
    useSessionStore.getState().onError({
      type: "error",
      message: "Gateway failed",
    });

    const state = useSessionStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.timelineEntries).toHaveLength(1);
    expect(state.messages[0]?.role).toBe("error");
    expect(state.errorBanner).toBe("Gateway failed");
    expect(state.status).toBe("ready");
  });

  it("onCleared empties transcript and drops the session-scoped resume target", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "claude",
    });
    useSessionStore.getState().setResume("session-a");
    useSessionStore.setState({ status: "ready" });
    useSessionStore.getState().sendMessage("test");
    useSessionStore.getState().onCleared();

    const state = useSessionStore.getState();
    expect(state.messages).toHaveLength(0);
    expect(state.timelineEntries).toHaveLength(0);
    expect(state.resumeTargetId).toBeNull();
    expect(localStorage.getItem("kiln.gui.resumeTarget")).toBeNull();
  });

  it("sendMessage rejects when status is not ready", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ status: "running" });
    const accepted = useSessionStore.getState().sendMessage("hello");
    expect(accepted).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("setPlanMode(false) emits exec frame through sender", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ planMode: true });
    useSessionStore.getState().setPlanMode(false);
    expect(send).toHaveBeenCalledWith({ type: "exec" });
  });

  it("persists planMode and session-scoped resume target and reloads on welcome", () => {
    useSessionStore.getState().setPlanMode(true);
    useSessionStore.getState().setResume("resume-42");

    resetSessionStore();
    useSessionStore.getState().onWelcome({
      type: "welcome",
      models: { claude: ["sonnet"] },
      activeProvider: "claude",
      activeModel: "sonnet",
      planMode: false,
    });

    const state = useSessionStore.getState();
    expect(state.planMode).toBe(true);
    expect(state.resumeTargetId).toBe("resume-42");
    expect(localStorage.getItem("kiln.gui.planMode")).toBe("true");
    expect(localStorage.getItem("kiln.gui.resumeTarget")).toBe("resume-42");
  });

  it("keeps preview selection separate from explicit resume target", () => {
    useSessionStore.getState().setSelectedSessionId("preview-session");
    useSessionStore.getState().setResume("resume-session");

    const state = useSessionStore.getState();
    expect(state.selectedSessionId).toBe("preview-session");
    expect(state.resumeTargetId).toBe("resume-session");
  });

  it("loads selected session detail from canonical session events", () => {
    useSessionStore.getState().viewSessionDetail({
      id: "session-77",
      meta: {
        kilnSessionId: "session-77",
        title: "Inspect resume UX",
        task: "Inspect resume UX",
        startedAt: "2026-04-21T10:00:00.000Z",
        completedAt: "2026-04-21T10:05:00.000Z",
        lastProvider: "codex-oauth",
      },
      events: [
        {
          eventId: "evt-1",
          kilnSessionId: "session-77",
          sequence: 1,
          timestamp: "2026-04-21T10:01:00.000Z",
          kind: "user_message",
          payload: { messageId: "msg-user-1", content: "What was this session about?" },
        },
        {
          eventId: "evt-2",
          kilnSessionId: "session-77",
          sequence: 2,
          timestamp: "2026-04-21T10:01:30.000Z",
          kind: "provider_routed",
          payload: {
            provider: {
              provider: "codex-oauth",
              model: "gpt-5.4-mini",
            },
            reason: "selected",
          },
        },
        {
          eventId: "evt-3",
          kilnSessionId: "session-77",
          sequence: 3,
          timestamp: "2026-04-21T10:02:00.000Z",
          kind: "assistant_delta",
          payload: { messageId: "msg-assistant-1", delta: "It reviewed " },
        },
        {
          eventId: "evt-4",
          kilnSessionId: "session-77",
          sequence: 4,
          timestamp: "2026-04-21T10:02:01.000Z",
          kind: "assistant_message",
          payload: {
            messageId: "msg-assistant-1",
            content: "It reviewed resume behavior.",
            provider: {
              provider: "codex-oauth",
              model: "gpt-5.4-mini",
            },
          },
        },
        {
          eventId: "evt-5",
          kilnSessionId: "session-77",
          sequence: 5,
          timestamp: "2026-04-21T10:03:00.000Z",
          kind: "tool_call_started",
          payload: { toolCallId: "tool-1", toolName: "rg", input: { pattern: "resume" } },
        },
        {
          eventId: "evt-6",
          kilnSessionId: "session-77",
          sequence: 6,
          timestamp: "2026-04-21T10:03:01.000Z",
          kind: "tool_call_completed",
          payload: {
            toolCallId: "tool-1",
            toolName: "rg",
            outputSummary: "1 match",
            status: { state: "succeeded" },
          },
        },
        {
          eventId: "evt-7",
          kilnSessionId: "session-77",
          sequence: 7,
          timestamp: "2026-04-21T10:03:30.000Z",
          kind: "file_changed",
          payload: {
            change: {
              changeType: "updated",
              path: "packages/gui/src/lib/session-store.ts",
              linesAdded: 18,
              linesRemoved: 5,
            },
          },
        },
        {
          eventId: "evt-8",
          kilnSessionId: "session-77",
          sequence: 8,
          timestamp: "2026-04-21T10:04:00.000Z",
          kind: "cost_updated",
          payload: {
            provider: {
              provider: "codex-oauth",
              model: "gpt-5.4-mini",
            },
            usage: {
              inputTokens: 42,
              outputTokens: 21,
            },
            cost: {
              deltaUsd: 0.015,
            },
          },
        },
        {
          eventId: "evt-9",
          kilnSessionId: "session-77",
          sequence: 9,
          timestamp: "2026-04-21T10:04:10.000Z",
          kind: "continuity_decided",
          payload: {
            decision: "continue",
            reason: "single-source-cache",
          },
        },
        {
          eventId: "evt-10",
          kilnSessionId: "session-77",
          sequence: 10,
          timestamp: "2026-04-21T10:05:00.000Z",
          kind: "turn_completed",
          payload: { outcome: "completed" },
        },
      ],
    });

    const state = useSessionStore.getState();
    expect(state.selectedSessionId).toBe("session-77");
    expect(state.resumeTargetId).toBe("session-77");
    expect(localStorage.getItem("kiln.gui.resumeTarget")).toBe("session-77");
    expect(state.status).toBe("ready");
    expect(state.messages).toHaveLength(2);
    expect(state.timelineEntries).toHaveLength(9);
    expect(state.messages[0]).toMatchObject({
      role: "user",
      content: "What was this session about?",
    });
    expect(state.messages[1]).toMatchObject({
      role: "assistant",
      content: "It reviewed resume behavior.",
      routedProvider: "codex-oauth",
      routedModel: "gpt-5.4-mini",
    });
    expect(deriveToolCallLog(state.timelineEntries)).toEqual([
      expect.objectContaining({
        callId: "tool-1",
        toolName: "rg",
        status: "success",
        result: "1 match",
      }),
    ]);
    expect(state.timelineEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "event",
          eventKind: "tool_call_started",
          title: "Tool started: rg",
        }),
        expect.objectContaining({
          type: "event",
          eventKind: "tool_call_completed",
          title: "Tool completed: rg",
          summary: "1 match",
        }),
      ]),
    );
    expect(deriveChangedFiles(state.timelineEntries)).toEqual([
      expect.objectContaining({
        path: "packages/gui/src/lib/session-store.ts",
        changeType: "modified",
        linesAdded: 18,
        linesRemoved: 5,
      }),
    ]);
    expect(state.sessionCostUsd).toBeCloseTo(0.015);
    expect(state.inputTokens).toBe(42);
    expect(state.outputTokens).toBe(21);
    expect(state.turnCounter).toBe(1);
    expect(deriveRuntimeContinuity(state.timelineEntries, "codex-oauth")).toMatchObject({
      strategy: "continue",
      selectionReason: "single-source-cache",
    });
  });

  it("does not auto-select an old session when refreshing the session list", () => {
    useSessionStore.getState().setSessionList([
      {
        id: "session-1",
        providersUsed: ["codex-oauth"],
        lastProvider: "codex-oauth",
        completedAt: "2026-04-21T10:00:00.000Z",
        cost: 0,
        taskSummary: "Old test",
      },
    ]);

    expect(useSessionStore.getState().selectedSessionId).toBeNull();
  });
});
