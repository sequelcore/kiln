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
    providerCatalogStatus: "ready",
    providerCatalogError: null,
    providers: [],
    activeProvider: null,
    activeModel: null,
    sessionList: [],
    selectedSessionId: null,
    liveSessionId: null,
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
    providerSwitchTarget: null,
    providerAuthenticating: false,
    providerAuthTarget: null,
    providerAuthMessage: null,
    providerExplicitSelection: false,
    authorityStatus: null,
    activityPhase: "idle",
    outboundSend: null,
    clearTimeoutId: null,
    providerSwitchTimeoutId: null,
    providerAuthTimeoutId: null,
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
      providers: [
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: true,
          models: ["sonnet"],
        },
        {
          id: "codex",
          label: "Codex",
          group: "harness",
          free: false,
          available: true,
          models: ["o3"],
        },
      ],
      activeProvider: "claude",
      activeModel: "sonnet",
      executionMode: "execute",
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

  it("anchors live tool events to an assistant shell before the first text delta", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ status: "ready" });
    useSessionStore.getState().sendMessage("patch the file");

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-tool-start",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-04-30T14:00:00.000Z",
      kind: "tool_call_started",
      payload: {
        toolCallId: "tool-live",
        toolName: "patch",
        input: { patch: "*** Begin Patch" },
      },
    });

    const anchored = useSessionStore.getState();
    const assistant = anchored.messages.find((message) => message.role === "assistant");
    expect(anchored.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(assistant).toMatchObject({
      content: "",
      streaming: true,
    });
    expect(anchored.currentAssistant).toBe(assistant?.id);
    expect(anchored.timelineEntries.map((entry) => (
      entry.type === "message" ? `message:${entry.message.role}` : `event:${entry.eventKind}`
    ))).toEqual([
      "message:user",
      "message:assistant",
      "event:tool_call_started",
    ]);

    useSessionStore.getState().onTextDelta({ type: "text_delta", content: "Patched." });

    const withDelta = useSessionStore.getState();
    expect(withDelta.currentAssistant).toBe(assistant?.id);
    expect(withDelta.messages.find((message) => message.id === assistant?.id)).toMatchObject({
      content: "Patched.",
      streaming: true,
    });
    expect(withDelta.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  });

  it("fills an empty live assistant shell from done content when no text delta streamed", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ status: "ready" });
    useSessionStore.getState().sendMessage("write a file");

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-tool-complete",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-04-30T14:01:00.000Z",
      kind: "tool_call_completed",
      payload: {
        toolCallId: "tool-live",
        toolName: "write",
        outputSummary: "1 file changed",
        status: { state: "succeeded" },
      },
    });
    const assistantId = useSessionStore.getState().currentAssistant;

    useSessionStore.getState().onDone({
      type: "done",
      content: "Created live_test_visibility.txt.",
      inputTokens: 1,
      outputTokens: 1,
    });

    const state = useSessionStore.getState();
    expect(state.currentAssistant).toBeNull();
    expect(state.messages.find((message) => message.id === assistantId)).toMatchObject({
      role: "assistant",
      content: "Created live_test_visibility.txt.",
      streaming: false,
    });
    expect(state.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
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

  it("clears visible operational state when selecting another session", () => {
    useSessionStore.setState({
      selectedSessionId: "session-a",
      resumeTargetId: "session-a",
      status: "running",
      activity: { phase: "tool_running", toolName: "write" },
      activityPhase: "tool_running",
      messages: [
        {
          id: "message-a",
          role: "assistant",
          content: "old visible message",
          createdAt: "2026-04-28T19:00:00.000Z",
        },
      ],
      timelineEntries: [
        {
          id: "event-a",
          type: "event",
          eventKind: "file_changed",
          createdAt: "2026-04-28T19:00:01.000Z",
          title: "File changed",
          summary: "modified: old.txt",
          tone: "info",
          details: { path: "old.txt", changeType: "modified" },
          sessionId: "session-a",
        },
      ],
    });

    useSessionStore.getState().setSelectedSessionId("session-b");

    const state = useSessionStore.getState();
    expect(state.selectedSessionId).toBe("session-b");
    expect(state.messages).toEqual([]);
    expect(state.timelineEntries).toEqual([]);
    expect(state.activity).toBeNull();
    expect(state.activityPhase).toBe("idle");
  });

  it("clears resume target when selecting a blank session", () => {
    useSessionStore.getState().setResume("session-a");
    useSessionStore.setState({
      selectedSessionId: "session-a",
      resumeTargetId: "session-a",
      messages: [
        {
          id: "message-a",
          role: "assistant",
          content: "old visible message",
          createdAt: "2026-04-28T19:00:00.000Z",
        },
      ],
    });

    useSessionStore.getState().setSelectedSessionId(null);

    const state = useSessionStore.getState();
    expect(state.selectedSessionId).toBeNull();
    expect(state.resumeTargetId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(localStorage.getItem("kiln.gui.resumeTarget")).toBeNull();
  });

  it("does not resume the previous session after starting a blank session", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.getState().setResume("session-a");
    useSessionStore.setState({
      status: "ready",
      selectedSessionId: "session-a",
      resumeTargetId: "session-a",
    });

    useSessionStore.getState().setSelectedSessionId(null);
    const accepted = useSessionStore.getState().sendMessage("new task");

    expect(accepted).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "message",
      content: "new task",
      resumeSessionId: undefined,
    }));
  });

  it("ignores live canonical events and phase frames for another visible session", () => {
    useSessionStore.setState({
      selectedSessionId: "session-visible",
      resumeTargetId: "session-visible",
      status: "ready",
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-foreign-tool",
      kilnSessionId: "session-foreign",
      sequence: 1,
      timestamp: "2026-04-28T19:10:00.000Z",
      kind: "tool_call_started",
      payload: {
        toolCallId: "tool-foreign",
        toolName: "write",
        input: { path: "foreign.txt" },
      },
    });
    useSessionStore.getState().onActivityPhase({
      type: "activity_phase",
      kilnSessionId: "session-foreign",
      phase: "tool_running",
      toolName: "write",
    });

    const state = useSessionStore.getState();
    expect(state.timelineEntries).toEqual([]);
    expect(state.activity).toBeNull();
    expect(state.activityPhase).toBe("idle");
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
        toolName: "patch",
        outputSummary: JSON.stringify({
          output: "1 file changed, 7 additions, 2 removals",
          isError: false,
          metadata: {
            toolName: "patch",
            kind: "file",
            operation: "patch",
            filePath: "demo.txt",
            linesAdded: 7,
            linesRemoved: 2,
            diffPreview: "- previous\n+ current",
            diffTruncated: true,
          },
        }),
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
        toolName: "patch",
        status: "success",
      }),
    ]);
    expect(state.timelineEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventKind: "tool_call_completed",
        summary: "1 file changed, 7 additions, 2 removals",
        toolPresentation: expect.objectContaining({
          outputKind: "diff",
          title: "demo.txt",
        }),
      }),
    ]));
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

  it("stores unwrapped typed read presentations for nested tool result envelopes", () => {
    useSessionStore.setState({
      selectedSessionId: "session-live",
      liveSessionId: "session-live",
      status: "running",
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-read-nested",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-04-30T10:00:00.000Z",
      kind: "tool_call_completed",
      payload: {
        toolCallId: "tool-read",
        toolName: "read",
        outputSummary: JSON.stringify({
          output: JSON.stringify({
            output: "# Session Model\n\nKiln session identity is provider-agnostic.",
            isError: false,
            metadata: {
              toolName: "read",
              kind: "file",
              operation: "read",
              filePath: "docs/architecture/session-model.md",
            },
          }),
          isError: false,
          metadata: {
            toolName: "read",
            kind: "file",
            operation: "read",
          },
        }),
        status: { state: "succeeded" },
      },
    });

    const entry = useSessionStore.getState().timelineEntries.find((item) => (
      item.type === "event" && item.eventKind === "tool_call_completed"
    ));
    expect(entry).toMatchObject({
      summary: "# Session Model",
      toolPresentation: {
        outputKind: "markdown",
        title: "docs/architecture/session-model.md",
        preview: {
          text: "# Session Model\n\nKiln session identity is provider-agnostic.",
        },
      },
    });
    expect(JSON.stringify(entry?.toolPresentation)).not.toContain("\"output\"");
  });

  it("stores live read output from the full payload envelope when the summary is raw JSON", () => {
    useSessionStore.setState({
      selectedSessionId: "session-live",
      liveSessionId: "session-live",
      status: "running",
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-read-live",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-04-30T10:01:00.000Z",
      kind: "tool_call_completed",
      payload: {
        toolCallId: "tool-read-live",
        toolName: "read",
        output: JSON.stringify({
          output: "# Session Model\n\nKiln session identity is provider-agnostic.",
          isError: false,
          metadata: {
            toolName: "read",
            kind: "file",
            operation: "read",
            filePath: "docs/architecture/session-model.md",
          },
        }),
        outputSummary: "{\"output\":\"# Session Model\\n\\nKiln session identity is provider-agnostic.\",\"isError\":false,\"metadata\":{\"toolName\":\"read\"",
        status: { state: "succeeded" },
      },
    });

    const entry = useSessionStore.getState().timelineEntries.find((item) => (
      item.type === "event" && item.eventKind === "tool_call_completed"
    ));
    expect(entry).toMatchObject({
      summary: "# Session Model",
      details: {
        result: "# Session Model",
      },
      toolPresentation: {
        outputKind: "markdown",
        title: "docs/architecture/session-model.md",
        preview: {
          text: "# Session Model\n\nKiln session identity is provider-agnostic.",
        },
      },
    });
    expect(JSON.stringify(entry)).not.toContain("\"output\"");
  });

  it("loads persisted tree output as a tree presentation from the full payload envelope", () => {
    useSessionStore.getState().viewSessionDetail({
      id: "session-tree",
      meta: {
        kilnSessionId: "session-tree",
        title: "Tree inspection",
        task: "Tree inspection",
        startedAt: "2026-04-30T10:02:00.000Z",
      },
      events: [
        {
          eventId: "evt-tree",
          kilnSessionId: "session-tree",
          sequence: 1,
          timestamp: "2026-04-30T10:02:01.000Z",
          kind: "tool_call_completed",
          payload: {
            toolCallId: "tool-tree",
            toolName: "tree",
            output: JSON.stringify({
              output: ".\npackages/\n  gui/",
              isError: false,
              metadata: {
                toolName: "tree",
                kind: "inspection",
                operation: "tree",
                path: "C:\\Proyectos\\Sequel\\kiln",
                depth: 2,
                entryCount: 55,
                resourceLinks: [
                  {
                    uri: "kiln://artifacts/tool-results/artifact_tree/content",
                    title: "tree full output",
                    mimeType: "text/plain",
                    size: 9000,
                    relation: "full_output",
                  },
                ],
              },
            }),
            outputSummary: "{\"output\":\".\\npackages/\",\"isError\":false,\"metadata\":{\"toolName\":\"tree\"",
            status: { state: "succeeded" },
          },
        },
      ],
    });

    const entry = useSessionStore.getState().timelineEntries.find((item) => (
      item.type === "event" && item.eventKind === "tool_call_completed"
    ));
    expect(entry).toMatchObject({
      summary: "55 entries under C:\\Proyectos\\Sequel\\kiln",
      toolPresentation: {
        outputKind: "tree",
        title: "C:\\Proyectos\\Sequel\\kiln",
        preview: {
          text: ".\npackages/\n  gui/",
        },
      },
    });
    expect(JSON.stringify(entry)).not.toContain("\"output\"");
  });

  it("projects agent invocation lifecycle events into timeline entries", () => {
    useSessionStore.setState({
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4",
      status: "running",
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-inv-requested",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-04-24T00:00:01.000Z",
      kind: "agent_invocation_requested",
      payload: {
        invocationId: "inv-1",
        agentId: "agent-planner",
        agentName: "Planner",
        requestedBy: "user",
        requestSource: "manual",
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-inv-started",
      kilnSessionId: "session-live",
      sequence: 2,
      timestamp: "2026-04-24T00:00:02.000Z",
      kind: "agent_invocation_started",
      payload: {
        invocationId: "inv-1",
        agentId: "agent-planner",
        agentName: "Planner",
        attempt: 1,
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-inv-completed",
      kilnSessionId: "session-live",
      sequence: 3,
      timestamp: "2026-04-24T00:00:03.000Z",
      kind: "agent_invocation_completed",
      payload: {
        invocationId: "inv-1",
        agentId: "agent-planner",
        resultSummary: "Planner returned focused steps",
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-inv-failed",
      kilnSessionId: "session-live",
      sequence: 4,
      timestamp: "2026-04-24T00:00:04.000Z",
      kind: "agent_invocation_failed",
      payload: {
        invocationId: "inv-2",
        agentId: "agent-coder",
        errorCode: "ENGINE_TIMEOUT",
        errorMessage: "Worker timed out",
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-inv-cancelled",
      kilnSessionId: "session-live",
      sequence: 5,
      timestamp: "2026-04-24T00:00:05.000Z",
      kind: "agent_invocation_cancelled",
      payload: {
        invocationId: "inv-3",
        agentId: "agent-reviewer",
        reason: "cancelled by operator",
      },
    });

    const state = useSessionStore.getState();
    const invocationEntries = state.timelineEntries.filter(
      (entry) => entry.type === "event" && entry.eventKind.startsWith("agent_invocation_"),
    );

    expect(invocationEntries).toHaveLength(5);
    expect(invocationEntries[0]).toMatchObject({
      type: "event",
      eventKind: "agent_invocation_requested",
      title: "Agent invocation requested",
      tone: "info",
      summary: expect.stringContaining("Planner"),
    });
    expect(invocationEntries[1]).toMatchObject({
      type: "event",
      eventKind: "agent_invocation_started",
      title: "Agent invocation started",
      tone: "running",
      summary: expect.stringContaining("attempt 1"),
    });
    expect(invocationEntries[2]).toMatchObject({
      type: "event",
      eventKind: "agent_invocation_completed",
      title: "Agent invocation completed",
      tone: "success",
      summary: "Planner returned focused steps",
    });
    expect(invocationEntries[3]).toMatchObject({
      type: "event",
      eventKind: "agent_invocation_failed",
      title: "Agent invocation failed",
      tone: "error",
      summary: "Worker timed out",
    });
    expect(invocationEntries[4]).toMatchObject({
      type: "event",
      eventKind: "agent_invocation_cancelled",
      title: "Agent invocation cancelled",
      tone: "warning",
      summary: "cancelled by operator",
    });
    expect(state.activity).toBeNull();
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

  it("sendMessage forwards selected app and tenant target", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ status: "ready", planMode: true });

    const accepted = useSessionStore.getState().sendMessage("hello", {
      appName: "support",
      tenantId: "acme",
      reasoningEffort: "medium",
    });

    expect(accepted).toBe(true);
    expect(send).toHaveBeenCalledWith({
      type: "message",
      content: "hello",
      executionMode: "plan",
      resumeSessionId: undefined,
      appName: "support",
      tenantId: "acme",
      reasoningEffort: "medium",
    });
  });

  it("setPlanMode(false) emits an execution transition frame through sender", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ planMode: true });
    useSessionStore.getState().setPlanMode(false);
    expect(send).toHaveBeenCalledWith({ type: "execution_mode_transition", toMode: "execute" });
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
      executionMode: "execute",
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
          title: "Using rg",
        }),
        expect.objectContaining({
          type: "event",
          eventKind: "tool_call_completed",
          title: "Completed rg",
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
