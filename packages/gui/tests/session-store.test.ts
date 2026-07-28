import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuiProviderModelDiscoveryProjection } from "@kilnai/gateway-contracts";
import {
  deriveChangedFiles,
  derivePendingApprovals,
  deriveToolCallLog,
  deriveWorkItems,
  useSessionStore,
} from "../src/lib/session-store.js";

function resetSessionStore(): void {
  useSessionStore.setState({
    status: "idle",
    messages: [],
    timelineEntries: [],
    sessionEvents: [],
    currentAssistant: null,
    planMode: false,
    activity: null,
    errorBanner: null,
    providerCatalogStatus: "ready",
    providerCatalogError: null,
    providers: [],
    providerModelDiscovery: defaultProviderModelDiscovery(),
    activeProvider: null,
    activeModel: null,
    sessionList: [],
    selectedSessionId: null,
    liveSessionId: null,
    continuationTargetId: null,
    detachedSessionIds: [],
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
    turnCancelPending: false,
    providerSwitching: false,
    providerSwitchTarget: null,
    providerAuthenticating: false,
    providerAuthTarget: null,
    providerAuthMessage: null,
    providerExplicitSelection: false,
    authorityStatus: null,
    contextUsage: null,
    activityPhase: "idle",
    interactiveUseSnapshot: null,
    browserSessionState: null,
    browserLiveViewportFrame: null,
    browserOperatorInputAck: null,
    outboundSend: null,
    clearTimeoutId: null,
    providerSwitchTimeoutId: null,
    providerAuthTimeoutId: null,
  });
}

function efficiencyEvidenceFixture(input: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly observedAt: string;
}) {
  const totalTokens = input.inputTokens + input.outputTokens;
  const measuredCost = totalTokens === 0 ? 0 : input.costUsd * (input.outputTokens / totalTokens);
  return {
    schemaVersion: "verified-efficiency-evidence-v1" as const,
    sessionId: input.sessionId,
    turnId: input.turnId,
    observedAt: input.observedAt,
    provider: { providerId: "codex-oauth", modelId: input.modelId, billingMode: "metered" },
    policy: {
      owner: "ContextGovernor",
      policyId: "context-whole-block-static-v1",
      configurationHash: `sha256:${"a".repeat(64)}`,
    },
    totals: {
      providerTotalTokens: totalTokens,
      providerTotalCostUsd: input.costUsd,
      measured: { tokens: input.outputTokens, costUsd: measuredCost },
      estimated: { tokens: 0, costUsd: 0 },
      cached: { tokens: 0, costUsd: 0 },
      unknown: { tokens: input.inputTokens, costUsd: input.costUsd - measuredCost },
      cacheWritten: { tokens: 0, costUsd: 0 },
      avoided: { tokens: 0, costUsd: 0 },
    },
    outcome: "succeeded" as const,
    verification: { status: "not_run" as const, results: [] },
    actions: [],
    savings: [],
    evidenceUris: [],
  };
}

function providerModelDiscovery(
  providerId: string,
  providerModelId: string,
): GuiProviderModelDiscoveryProjection {
  return {
    catalogEvidence: {
      status: "complete",
      source: { kind: "test", id: "session-store" },
      observedAt: "2026-07-01T00:00:00.000Z",
      counts: { total: 1, returned: 1, omitted: 0 },
    },
    entries: [{
      providerRoute: { providerId, providerModelId },
      eligibility: { eligible: true, reasonCodes: [] },
    } as GuiProviderModelDiscoveryProjection["entries"][number]],
  };
}

function defaultProviderModelDiscovery(): GuiProviderModelDiscoveryProjection {
  return {
    catalogEvidence: {
      status: "complete",
      source: { kind: "test", id: "session-store" },
      observedAt: "2026-07-01T00:00:00.000Z",
      counts: { total: 0, returned: 0, omitted: 0 },
    },
    entries: [],
  };
}

describe("session-store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetSessionStore();
  });

  it("onWelcome seeds providers, restores plan mode, and clears stale continuation targets", () => {
    localStorage.setItem("kiln.gui.planMode", "true");
    localStorage.setItem("kiln.gui.continuationTarget", "session-123");

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
      providerModelDiscovery: providerModelDiscovery("claude", "sonnet"),
      executionMode: "execute",
    });

    const state = useSessionStore.getState();
    expect(state.providers.map((provider) => provider.id)).toEqual(["claude", "codex"]);
    expect(state.activeProvider).toBe("claude");
    expect(state.activeModel).toBe("sonnet");
    expect(state.planMode).toBe(true);
    expect(state.continuationTargetId).toBeNull();
    expect(localStorage.getItem("kiln.gui.continuationTarget")).toBeNull();
  });

  it("onTextDelta creates and appends to a single streaming assistant message", () => {
    useSessionStore.getState().onTextDelta({ type: "text_delta", kilnSessionId: "session-live", content: "Hello" });
    useSessionStore.getState().onTextDelta({ type: "text_delta", kilnSessionId: "session-live", content: " world" });

    const state = useSessionStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.timelineEntries).toHaveLength(1);
    expect(state.messages[0]?.role).toBe("assistant");
    expect(state.messages[0]?.content).toBe("Hello world");
    expect(state.messages[0]?.streaming).toBe(true);
    expect(state.currentAssistant).not.toBeNull();
  });

  it("onDone preserves assistant response parts for cross-surface media rendering", () => {
    useSessionStore.getState().onDone({
      type: "done",
      kilnSessionId: "session-live",
      sourceMessageId: "runtime-message-1",
      outcome: "completed",
      content: "spoken answer",
      parts: [
        { type: "text", text: "spoken answer" },
        { type: "audio", mimeType: "audio/mpeg", data: "AQID" },
      ],
      inputTokens: 3,
      outputTokens: 4,
    });

    const message = useSessionStore.getState().messages[0];
    expect(message?.parts).toEqual([
      { type: "text", text: "spoken answer" },
      { type: "audio", mimeType: "audio/mpeg", data: "AQID" },
    ]);
    expect(message?.sourceMessageId).toBe("runtime-message-1");
  });

  it("requests on-demand voice synthesis for canonical assistant messages", () => {
    const outboundSend = vi.fn();
    useSessionStore.setState({
      status: "running",
      outboundSend,
    });
    useSessionStore.getState().onDone({
      type: "done",
      kilnSessionId: "session-live",
      sourceMessageId: "runtime-message-1",
      outcome: "completed",
      content: "Generate audio later.",
      parts: [{ type: "text", text: "Generate audio later." }],
      inputTokens: 3,
      outputTokens: 4,
    });

    const message = useSessionStore.getState().messages[0];
    const sent = useSessionStore.getState().requestVoiceSynthesis(message?.id ?? "");

    expect(sent).toBe(true);
    expect(useSessionStore.getState().messages[0]).toMatchObject({
      voiceSynthesisStatus: "pending",
    });
    expect(outboundSend).toHaveBeenCalledWith(expect.objectContaining({
      type: "voice_synthesis_request",
      sourceMessageId: "runtime-message-1",
      requestId: expect.any(String),
    }));
  });

  it("patches on-demand synthesized audio into the source assistant message", () => {
    useSessionStore.getState().onDone({
      type: "done",
      kilnSessionId: "session-live",
      sourceMessageId: "runtime-message-1",
      outcome: "completed",
      content: "Generate audio later.",
      parts: [{ type: "text", text: "Generate audio later." }],
      inputTokens: 3,
      outputTokens: 4,
    });
    const messageId = useSessionStore.getState().messages[0]?.id ?? "";
    useSessionStore.setState({
      messages: useSessionStore.getState().messages.map((message) => (
        message.id === messageId
          ? { ...message, voiceSynthesisStatus: "pending" as const }
          : message
      )),
    });

    useSessionStore.getState().onVoiceSynthesisCompleted({
      type: "voice_synthesis_completed",
      requestId: "voice-request-1",
      sourceMessageId: "runtime-message-1",
      parts: [
        { type: "text", text: "Generate audio later." },
        { type: "audio", mimeType: "audio/wav", data: "BAUG", durationMs: 900 },
      ],
    });

    expect(useSessionStore.getState().messages[0]).toMatchObject({
      sourceMessageId: "runtime-message-1",
      voiceSynthesisStatus: "ready",
      parts: [
        { type: "text", text: "Generate audio later." },
        { type: "audio", mimeType: "audio/wav", data: "BAUG", durationMs: 900 },
      ],
    });
  });

  it("sendMessage sends voice input parts while displaying a compact local label", () => {
    const outboundSend = vi.fn();
    const parts = [
      { type: "audio", mimeType: "audio/webm", data: "YWJj", durationMs: 1234 },
    ];
    useSessionStore.setState({
      status: "ready",
      outboundSend,
    });

    const sent = useSessionStore.getState().sendMessage("", {
      displayContent: "Voice input 1.2s",
      parts,
    });

    expect(sent).toBe(true);
    expect(useSessionStore.getState().messages[0]).toMatchObject({
      role: "user",
      content: "Voice input 1.2s",
      parts,
    });
    expect(outboundSend).toHaveBeenCalledWith(expect.objectContaining({
      type: "message",
      content: "",
      parts,
    }));
  });

  it("sends governed work materialization as a typed gateway requirement", () => {
    const outboundSend = vi.fn();
    useSessionStore.setState({ status: "ready", outboundSend });

    const sent = useSessionStore.getState().sendMessage("Inspect the runtime after governance is established.", {
      governedWorkRequirement: {
        kind: "goal_materialization",
        requiredWorkItemCount: 3,
      },
    });

    expect(sent).toBe(true);
    expect(outboundSend).toHaveBeenCalledWith(expect.objectContaining({
      type: "message",
      content: "Inspect the runtime after governance is established.",
      governedWorkRequirement: {
        kind: "goal_materialization",
        requiredWorkItemCount: 3,
      },
    }));
  });

  it("replaces a local voice placeholder with the admitted transcript when the turn completes", () => {
    const outboundSend = vi.fn();
    const parts = [
      { type: "audio", mimeType: "audio/webm", data: "YWJj", durationMs: 1234 },
    ];
    useSessionStore.setState({
      status: "ready",
      outboundSend,
    });

    useSessionStore.getState().sendMessage("", {
      displayContent: "Voice input 1.2s",
      parts,
    });
    useSessionStore.getState().onDone({
      type: "done",
      kilnSessionId: "session-live",
      outcome: "completed",
      content: "Sure.",
      admittedInput: { content: "[Voice note transcription]: Can you summarize this?" },
      inputTokens: 3,
      outputTokens: 4,
    });

    const state = useSessionStore.getState();
    expect(state.messages[0]).toMatchObject({
      role: "user",
      content: "Can you summarize this?",
      parts,
    });
    expect(state.timelineEntries[0]).toMatchObject({
      type: "message",
      message: expect.objectContaining({
        content: "Can you summarize this?",
      }),
    });
  });

  it("keeps live tool events standalone until the first assistant text delta", () => {
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
        toolCallScopeId: "response-1",
        toolCallId: "tool-live",
        toolName: "patch",
        input: { patch: "*** Begin Patch" },
      },
    });

    const toolRunning = useSessionStore.getState();
    expect(toolRunning.messages.map((message) => message.role)).toEqual(["user"]);
    expect(toolRunning.currentAssistant).toBeNull();
    expect(toolRunning.timelineEntries.map((entry) => (
      entry.type === "message" ? `message:${entry.message.role}` : `event:${entry.eventKind}`
    ))).toEqual([
      "message:user",
      "event:tool_call_started",
    ]);

    useSessionStore.getState().onTextDelta({ type: "text_delta", kilnSessionId: "session-live", content: "Patched." });

    const withDelta = useSessionStore.getState();
    const assistant = withDelta.messages.find((message) => message.role === "assistant");
    expect(withDelta.currentAssistant).toBe(assistant?.id);
    expect(assistant).toMatchObject({
      content: "Patched.",
      streaming: true,
    });
    expect(withDelta.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  });

  it("folds live command output into the existing tool row by call id", () => {
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-command-start",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-04-30T14:00:00.000Z",
      kind: "tool_call_started",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "command-1",
        toolName: "bash",
        input: { command: "bun test" },
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-command-output-1",
      kilnSessionId: "session-live",
      sequence: 2,
      timestamp: "2026-04-30T14:00:01.000Z",
      kind: "tool_call_output_delta",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "command-1",
        toolName: "bash",
        stream: "stdout",
        delta: "RUN tests\n",
        chunkIndex: 0,
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-command-output-2",
      kilnSessionId: "session-live",
      sequence: 3,
      timestamp: "2026-04-30T14:00:02.000Z",
      kind: "tool_call_output_delta",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "command-1",
        toolName: "bash",
        stream: "stderr",
        delta: "warning\n",
        chunkIndex: 1,
      },
    });

    const toolEntries = useSessionStore.getState().timelineEntries.filter((entry) => entry.type === "event");
    expect(toolEntries).toHaveLength(1);
    expect(toolEntries[0]).toMatchObject({
      eventKind: "tool_call_started",
      details: expect.objectContaining({
        toolCallScopeId: "response-1",
        toolCallId: "command-1",
        liveOutput: "RUN tests\nwarning\n",
      }),
    });
  });

  it("does not create an assistant row from whitespace-only streaming deltas", () => {
    useSessionStore.setState({ status: "running" });

    useSessionStore.getState().onTextDelta({
      type: "text_delta",
      kilnSessionId: "session-live",
      content: "  \n",
    });

    expect(useSessionStore.getState().currentAssistant).toBeNull();
    expect(useSessionStore.getState().messages).toEqual([]);
    expect(useSessionStore.getState().timelineEntries).toEqual([]);

    useSessionStore.getState().onTextDelta({
      type: "text_delta",
      kilnSessionId: "session-live",
      content: "Visible response",
    });

    expect(useSessionStore.getState().messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "Visible response",
        streaming: true,
      }),
    ]);
  });

  it("creates the assistant response from done content without a prior empty shell", () => {
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
        toolCallScopeId: "response-1",
        toolCallId: "tool-live",
        toolName: "write",
        outputSummary: "1 file changed",
        status: { state: "succeeded" },
      },
    });
    expect(useSessionStore.getState().currentAssistant).toBeNull();
    expect(useSessionStore.getState().messages.filter((message) => message.role === "assistant")).toHaveLength(0);

    useSessionStore.getState().onDone({
      type: "done",
      kilnSessionId: "session-live",
      outcome: "completed",
      content: "Created live_test_visibility.txt.",
      inputTokens: 1,
      outputTokens: 1,
    });

    const state = useSessionStore.getState();
    expect(state.currentAssistant).toBeNull();
    expect(state.messages.find((message) => message.role === "assistant")).toMatchObject({
      role: "assistant",
      content: "Created live_test_visibility.txt.",
      streaming: false,
    });
    expect(state.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  });

  it("shows tool result envelope errors as failed tool calls even when the event completed", () => {
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-tool-error",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-05-08T14:01:00.000Z",
      kind: "tool_call_completed",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-error",
        toolName: "computer_observe",
        outputSummary: JSON.stringify({
          output: "Computer automation denied for active application 'msedge'.",
          isError: true,
          metadata: {
            toolName: "computer_observe",
            kind: "interactive",
            operation: "observe",
            provider: "windows-uia",
          },
        }),
        status: { state: "succeeded" },
      },
    });

    const state = useSessionStore.getState();
    const entry = state.timelineEntries.find((item) => item.type === "event" && item.eventKind === "tool_call_completed");
    expect(entry).toMatchObject({
      type: "event",
      title: "Failed computer_observe",
      tone: "error",
      details: expect.objectContaining({
        status: "failed",
        result: "Computer automation denied for active application 'msedge'.",
      }),
    });
    expect(deriveToolCallLog(state.timelineEntries)).toEqual([
      expect.objectContaining({
        callId: "tool-error",
        toolName: "computer_observe",
        status: "error",
      }),
    ]);
  });

  it("onDone closes streaming assistant and flips status to ready", () => {
    useSessionStore.getState().onTextDelta({ type: "text_delta", kilnSessionId: "session-live", content: "Hi" });
    useSessionStore.getState().onDone({
      type: "done",
      kilnSessionId: "session-live",
      outcome: "completed",
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

  it("presents a paused terminal outcome without misreporting success", () => {
    useSessionStore.getState().onDone({
      type: "done",
      kilnSessionId: "session-live",
      outcome: "paused",
      content: "Waiting for operator input.",
      inputTokens: 1,
      outputTokens: 1,
    });

    expect(useSessionStore.getState().timelineEntries.at(-1)).toMatchObject({
      eventKind: "turn_completed",
      title: "Turn paused",
      tone: "warning",
      details: expect.objectContaining({ outcome: "paused" }),
    });
  });

  it("ignores late frames from the detached live session after New Session clears the UI", () => {
    const outboundSend = vi.fn();
    useSessionStore.setState({
      status: "running",
      outboundSend,
      liveSessionId: "old-live-session",
      messages: [
        {
          id: "old-user",
          role: "user",
          content: "old turn",
          createdAt: "2026-06-05T18:00:00.000Z",
        },
      ],
    });

    expect(useSessionStore.getState().sendClear()).toBe(true);
    useSessionStore.getState().onCleared();
    useSessionStore.getState().onSessionEvent({
      eventId: "old-live-session:late:1",
      kilnSessionId: "old-live-session",
      sequence: 1,
      timestamp: "2026-06-05T18:00:01.000Z",
      kind: "assistant_delta",
      payload: {
        messageId: "old-live-session:live:assistant",
        delta: "late stale answer",
      },
    });
    useSessionStore.getState().onActivity({
      type: "activity",
      activity: "tool_use",
      kilnSessionId: "old-live-session",
      toolName: "stale-tool",
    });
    useSessionStore.getState().onDone({
      type: "done",
      kilnSessionId: "old-live-session",
      outcome: "completed",
      content: "late stale completion",
      inputTokens: 1,
      outputTokens: 1,
    });

    const cleared = useSessionStore.getState();
    expect(cleared.messages).toEqual([]);
    expect(cleared.sessionEvents).toEqual([]);
    expect(cleared.activity).toBeNull();
    expect(cleared.liveSessionId).toBeNull();
    expect(outboundSend).toHaveBeenCalledWith({ type: "clear" });
  });

  it("accepts scoped frames from a new live session after detaching the previous session", () => {
    const outboundSend = vi.fn();
    useSessionStore.setState({
      status: "running",
      outboundSend,
      liveSessionId: "old-live-session",
    });

    expect(useSessionStore.getState().sendClear()).toBe(true);
    useSessionStore.getState().onCleared();
    useSessionStore.setState({ status: "running" });
    useSessionStore.getState().onSessionEvent({
      eventId: "new-live-session:delta:1",
      kilnSessionId: "new-live-session",
      sequence: 1,
      timestamp: "2026-06-05T18:01:01.000Z",
      kind: "assistant_delta",
      payload: {
        messageId: "new-live-session:live:assistant",
        delta: "new scoped answer",
      },
    });
    useSessionStore.getState().onDone({
      type: "done",
      kilnSessionId: "new-live-session",
      outcome: "completed",
      content: "",
      inputTokens: 1,
      outputTokens: 1,
    });

    const state = useSessionStore.getState();
    expect(state.liveSessionId).toBe("new-live-session");
    expect(state.messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "new scoped answer",
        streaming: false,
      }),
    ]);
  });

  it("keeps managed invocation tool identity inspectable in live timeline details", () => {
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-managed-start",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-05-07T08:10:00.000Z",
      kind: "tool_call_started",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-managed",
        toolName: "managed_agent.invoke",
        input: {
          profile: "foundation-readonly-plan",
          providerRoute: {
            providerId: "codex-oauth",
            model: "gpt-5.4-mini",
          },
          agentProfile: "architecture-reviewer",
          skills: ["ddd-review"],
          contextMode: "isolated",
          task: "Inspect docs/architecture/managed-agents.md.",
          summary: "Inspect managed agents architecture doc",
        },
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-managed-complete",
      kilnSessionId: "session-live",
      sequence: 2,
      timestamp: "2026-05-07T08:10:01.000Z",
      kind: "tool_call_completed",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-managed",
        toolName: "managed_agent.invoke",
        outputSummary: JSON.stringify({
          output: "Inspection completed.",
          isError: false,
          metadata: {
            kind: "managed-invocation",
            invocationId: "inv-1",
            routeId: "codex-oauth",
            status: "completed",
            profile: "foundation-readonly-plan",
            providerRoute: {
              providerId: "codex-oauth",
              model: "gpt-5.4-mini",
              surface: "direct-provider",
            },
            context: {
              mode: "isolated",
              agentProfile: "architecture-reviewer",
              skills: ["ddd-review"],
              admittedAgentProfile: "architecture-reviewer",
              admittedSkills: ["ddd-review"],
            },
            adapterKind: "direct",
            executionMode: "runtime-direct",
            authorityProfileId: "authority:foundation-readonly-plan",
            childSessionId: "child-session-1",
          },
        }),
        status: { state: "succeeded" },
      },
    });

    const completedEntry = useSessionStore.getState().timelineEntries.find(
      (entry) => entry.type === "event" && entry.eventKind === "tool_call_completed",
    );

    expect(completedEntry).toMatchObject({
      type: "event",
      eventKind: "tool_call_completed",
      summary: "foundation-readonly-plan via codex-oauth/gpt-5.4-mini (direct-provider) · Inspection completed.",
    });
    expect(completedEntry?.type).toBe("event");
    if (completedEntry?.type !== "event") {
      return;
    }
    expect(completedEntry.presentationDetails).toContainEqual({ label: "Provider", value: "codex-oauth" });
    expect(completedEntry.presentationDetails).toContainEqual({ label: "Model", value: "gpt-5.4-mini" });
    expect(completedEntry.presentationDetails).toContainEqual({ label: "Surface", value: "direct-provider" });
    expect(completedEntry.presentationDetails).toContainEqual({ label: "Context mode", value: "isolated" });
    expect(completedEntry.presentationDetails).toContainEqual({ label: "Agent profile", value: "architecture-reviewer" });
    expect(completedEntry.presentationDetails).toContainEqual({ label: "Skills", value: "ddd-review" });
    expect(completedEntry.presentationDetails).not.toContainEqual({ label: "Provider Route", value: "Structured value" });
  });

  it("keeps canonical live session events available for managed-agent cockpit projection", () => {
    useSessionStore.setState({
      status: "running",
      liveSessionId: "session-managed-live",
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-managed-started",
      kilnSessionId: "session-managed-live",
      sequence: 1,
      timestamp: "2026-05-23T12:00:00.000Z",
      kind: "agent_invocation_started",
      payload: {
        invocationId: "child-live",
        providerRoute: {
          providerId: "codex-oauth",
          model: "gpt-5.5",
        },
      },
    });

    expect(useSessionStore.getState().sessionEvents).toEqual([
      expect.objectContaining({
        eventId: "evt-managed-started",
        kind: "agent_invocation_started",
        payload: expect.objectContaining({
          invocationId: "child-live",
        }),
      }),
    ]);
  });

  it("restores loaded canonical session events for managed-agent cockpit projection", () => {
    useSessionStore.getState().viewSessionDetail({
      id: "session-managed-loaded",
      meta: {
        kilnSessionId: "session-managed-loaded",
        title: "Loaded managed child",
        task: "Loaded managed child",
        startedAt: "2026-05-23T12:00:00.000Z",
      },
      events: [
        {
          eventId: "evt-managed-loaded",
          kilnSessionId: "session-managed-loaded",
          sequence: 1,
          timestamp: "2026-05-23T12:00:00.000Z",
          kind: "agent_invocation_completed",
          payload: {
            invocationId: "child-loaded",
            lifecycleState: "completed",
          },
        },
      ],
    });

    expect(useSessionStore.getState().sessionEvents).toEqual([
      expect.objectContaining({
        eventId: "evt-managed-loaded",
        kind: "agent_invocation_completed",
        payload: expect.objectContaining({
          invocationId: "child-loaded",
        }),
      }),
    ]);
  });

  it("deduplicates replayed live events and enriches restored tool rows with delayed terminal evidence", () => {
    useSessionStore.getState().viewSessionDetail({
      id: "session-tool-restore",
      meta: {
        kilnSessionId: "session-tool-restore",
        title: "Restored tool session",
        task: "Restored tool session",
        startedAt: "2026-07-03T12:00:00.000Z",
      },
      events: [
        {
          eventId: "evt-user",
          kilnSessionId: "session-tool-restore",
          sequence: 1,
          timestamp: "2026-07-03T12:00:00.000Z",
          kind: "user_message",
          turnId: "turn-1",
          payload: { content: "Read the plan" },
        },
        {
          eventId: "evt-tool-start",
          kilnSessionId: "session-tool-restore",
          sequence: 2,
          timestamp: "2026-07-03T12:00:01.000Z",
          kind: "tool_call_started",
          turnId: "turn-1",
          payload: {
            toolCallScopeId: "response-1",
            toolCallId: "tool-restore-1",
            toolName: "read",
            input: { path: "docs/plan.md" },
          },
        },
        {
          eventId: "evt-tool-start",
          kilnSessionId: "session-tool-restore",
          sequence: 2,
          timestamp: "2026-07-03T12:00:01.000Z",
          kind: "tool_call_started",
          turnId: "turn-1",
          payload: {
            toolCallScopeId: "response-1",
            toolCallId: "tool-restore-1",
            toolName: "read",
            input: { path: "duplicate-must-not-replace.md" },
          },
        },
      ],
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-tool-start",
      kilnSessionId: "session-tool-restore",
      sequence: 2,
      timestamp: "2026-07-03T12:00:01.000Z",
      kind: "tool_call_started",
      turnId: "turn-1",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-restore-1",
        toolName: "read",
        input: { path: "docs/plan.md" },
      },
    });
    const completedEvent = {
      eventId: "evt-tool-complete",
      kilnSessionId: "session-tool-restore",
      sequence: 3,
      timestamp: "2026-07-03T12:00:02.000Z",
      kind: "tool_call_completed",
      turnId: "turn-1",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-restore-1",
        toolName: "read",
        output: "plan contents",
        status: { state: "succeeded" },
      },
    } as const;
    useSessionStore.getState().onSessionEvent(completedEvent);
    useSessionStore.getState().onSessionEvent(completedEvent);

    const state = useSessionStore.getState();
    const toolRows = state.timelineEntries.filter((entry) => (
      entry.type === "event"
      && (entry.eventKind === "tool_call_started" || entry.eventKind === "tool_call_completed")
    ));
    expect(toolRows.map((entry) => entry.id)).toEqual([
      "timeline:evt-tool-start",
      "timeline:evt-tool-complete",
    ]);
    expect(state.sessionEvents.map((event) => event.eventId)).toEqual([
      "evt-user",
      "evt-tool-start",
      "evt-tool-complete",
    ]);
    const toolLog = deriveToolCallLog(state.timelineEntries);
    expect(toolLog).toEqual([
      expect.objectContaining({
        callId: "tool-restore-1",
        toolName: "read",
        input: { path: "docs/plan.md" },
        status: "success",
        result: expect.stringContaining("plan contents"),
      }),
    ]);
  });

  it("preserves an interrupted restored tool as terminal when its completion event is replayed", () => {
    const interruptedEvent = {
      eventId: "evt-tool-interrupted",
      kilnSessionId: "session-tool-interrupted",
      sequence: 2,
      timestamp: "2026-07-03T12:05:02.000Z",
      kind: "tool_call_completed",
      turnId: "turn-interrupted",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-interrupted-1",
        toolName: "shell",
        status: { state: "cancelled" },
      },
    } as const;
    useSessionStore.getState().viewSessionDetail({
      id: "session-tool-interrupted",
      meta: {
        kilnSessionId: "session-tool-interrupted",
        title: "Interrupted tool session",
        task: "Interrupted tool session",
        startedAt: "2026-07-03T12:05:00.000Z",
      },
      events: [
        {
          eventId: "evt-tool-interrupted-start",
          kilnSessionId: "session-tool-interrupted",
          sequence: 1,
          timestamp: "2026-07-03T12:05:01.000Z",
          kind: "tool_call_started",
          turnId: "turn-interrupted",
          payload: {
            toolCallScopeId: "response-1",
            toolCallId: "tool-interrupted-1",
            toolName: "shell",
            input: { command: "bun run build" },
          },
        },
        interruptedEvent,
      ],
    });

    useSessionStore.getState().onSessionEvent(interruptedEvent);

    expect(deriveToolCallLog(useSessionStore.getState().timelineEntries)).toEqual([
      expect.objectContaining({
        callId: "tool-interrupted-1",
        input: { command: "bun run build" },
        status: "error",
      }),
    ]);
    expect(useSessionStore.getState().sessionEvents).toHaveLength(2);
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
      kilnSessionId: "session-1",
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
      continuationTargetId: "session-a",
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

  it("clears continuation target when selecting a blank session", () => {
    useSessionStore.getState().setContinuation("session-a");
    useSessionStore.setState({
      selectedSessionId: "session-a",
      continuationTargetId: "session-a",
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
    expect(state.continuationTargetId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(localStorage.getItem("kiln.gui.continuationTarget")).toBeNull();
  });

  it("marks the first blank-session message as a fresh session boundary", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.getState().setContinuation("session-a");
    useSessionStore.setState({
      status: "ready",
      selectedSessionId: "session-a",
      continuationTargetId: "session-a",
    });

    useSessionStore.getState().setSelectedSessionId(null);
    const accepted = useSessionStore.getState().sendMessage("new task");

    expect(accepted).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "message",
      content: "new task",
      continuationSessionId: undefined,
      sessionIntent: "fresh",
    }));
  });

  it("does not mark follow-up turns in the active conversation as fresh", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      status: "ready",
      messages: [
        {
          id: "message-a",
          role: "user",
          content: "first task",
          createdAt: "2026-04-28T19:00:00.000Z",
        },
        {
          id: "message-b",
          role: "assistant",
          content: "first response",
          createdAt: "2026-04-28T19:00:01.000Z",
        },
      ],
      liveSessionId: "session-live",
      selectedSessionId: null,
      continuationTargetId: null,
    });

    const accepted = useSessionStore.getState().sendMessage("follow up");

    expect(accepted).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "message",
      content: "follow up",
      continuationSessionId: undefined,
    }));
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty("sessionIntent");
  });

  it("ignores live canonical events and phase frames for another visible session", () => {
    useSessionStore.setState({
      selectedSessionId: "session-visible",
      continuationTargetId: "session-visible",
      status: "ready",
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-foreign-tool",
      kilnSessionId: "session-foreign",
      sequence: 1,
      timestamp: "2026-04-28T19:10:00.000Z",
      kind: "tool_call_started",
      payload: {
        toolCallScopeId: "response-1",
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
        toolCallScopeId: "response-1",
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
        toolCallScopeId: "response-1",
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

  it("applies live canonical turn completion authority and routing state", () => {
    useSessionStore.setState({
      status: "running",
      liveSessionId: "session-live",
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-turn-completed",
      kilnSessionId: "session-live",
      sequence: 9,
      timestamp: "2026-05-12T20:02:00.000Z",
      kind: "turn_completed",
      payload: {
        outcome: "completed",
        routedProvider: "codex-oauth",
        routedModel: "gpt-5.4-mini",
        routingRationale: {
          selectedProvider: "codex-oauth",
          selectedModel: "gpt-5.4-mini",
          selectionMode: "auto",
          routingReason: "Auto by Kiln selected the default route.",
          routingTier: "default",
        },
        authorityStatus: {
          effective: "read_only",
          completeness: "authoritative",
        },
      },
    });

    const state = useSessionStore.getState();
    expect(state.status).toBe("ready");
    expect(state.routedProvider).toBe("codex-oauth");
    expect(state.routedModel).toBe("gpt-5.4-mini");
    expect(state.authorityStatus).toEqual({
      effective: "read_only",
      completeness: "authoritative",
    });
    expect(state.turnCounter).toBe(1);
    expect(state.timelineEntries).toContainEqual(expect.objectContaining({
      type: "event",
      eventKind: "turn_completed",
      details: expect.objectContaining({
        routingRationale: expect.objectContaining({
          selectionMode: "auto",
          routingReason: "Auto by Kiln selected the default route.",
        }),
        authorityStatus: {
          effective: "read_only",
          completeness: "authoritative",
        },
      }),
    }));
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
        toolCallScopeId: "response-1",
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

  it("stores paused work item execution as warning task state", () => {
    useSessionStore.setState({
      selectedSessionId: "session-live",
      liveSessionId: "session-live",
      status: "running",
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-work-item-paused",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-07-14T20:59:04.000Z",
      kind: "tool_call_completed",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-work-item-start",
        toolName: "work_item.execution.start",
        output: JSON.stringify({
          status: "paused",
          reason: "managedInvocationId is required before starting managed-delegation execution.",
          workItemId: "inspect-composer-activity-ownership",
          routeId: "opencode-go-qwen3-7-max-readonly",
          requiredEvidence: ["surface-map", "tests"],
        }),
        status: { state: "succeeded" },
      },
    });

    const entry = useSessionStore.getState().timelineEntries.find((item) => (
      item.type === "event" && item.eventKind === "tool_call_completed"
    ));
    expect(entry).toMatchObject({
      title: "Execution paused",
      tone: "warning",
      summary: "managedInvocationId is required before starting managed-delegation execution.",
      toolPresentation: {
        outputKind: "task",
        task: {
          status: "paused",
          workItemId: "inspect-composer-activity-ownership",
          items: [
            { label: "surface-map", status: "pending" },
            { label: "tests", status: "pending" },
          ],
        },
      },
    });
    expect(entry?.presentationDetails).toContainEqual({ label: "Status", value: "paused" });
    expect(entry?.toolPresentation?.preview).toBeUndefined();
  });

  it("stores structured tool errors as failed diagnostics regardless of transport status", () => {
    useSessionStore.setState({
      selectedSessionId: "session-live",
      liveSessionId: "session-live",
      status: "running",
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-goal-create-invalid-input",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-07-14T21:24:46.000Z",
      kind: "tool_call_completed",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-goal-create",
        toolName: "goal.create",
        output: JSON.stringify({
          error: {
            code: "invalid_input",
            message: "goal.create cannot combine preferredRouteId and managedAgentProfile.",
            recoverable: true,
            suggestedNextTool: "goal.create",
            requiredInputShape: {
              objective: "string",
              workItemIds: ["existing work item id"],
            },
          },
        }),
        status: { state: "succeeded" },
      },
    });

    const entry = useSessionStore.getState().timelineEntries.find((item) => (
      item.type === "event" && item.eventKind === "tool_call_completed"
    ));
    expect(entry).toMatchObject({
      title: "Failed goal.create",
      tone: "error",
      summary: "goal.create cannot combine preferredRouteId and managedAgentProfile.",
      toolPresentation: {
        outputKind: "diagnostic",
        title: "Invalid input",
        diagnostic: {
          code: "invalid_input",
          recoverable: true,
          suggestedNextTool: "goal.create",
          requiredInput: [
            { name: "objective", expected: "string" },
            { name: "workItemIds", expected: "existing work item id[]" },
          ],
        },
      },
    });
    expect(entry?.presentationDetails).toContainEqual({ label: "Status", value: "failed" });
    expect(entry?.toolPresentation?.preview).toBeUndefined();
  });

  it("stores governed tool results as semantic presentations instead of text fallbacks", () => {
    useSessionStore.setState({
      selectedSessionId: "session-live",
      liveSessionId: "session-live",
      status: "running",
    });

    const baseEvent = {
      kilnSessionId: "session-live",
      timestamp: "2026-07-14T21:24:46.000Z",
      kind: "tool_call_completed" as const,
    };
    useSessionStore.getState().onSessionEvent({
      ...baseEvent,
      eventId: "evt-work-item-update",
      sequence: 1,
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-work-item-update",
        toolName: "work_item.update",
        output: JSON.stringify({
          item: {
            id: "work-1",
            summary: "Inspect composer activity ownership.",
            status: "pending",
            expectedEvidence: ["surface-map", "tests"],
            providedEvidence: ["surface-map"],
            pauseRequirements: [],
          },
          nextRequiredTools: ["goal.create"],
        }),
        metadata: { kind: "work_item", operation: "update" },
        status: { state: "succeeded" },
      },
    });
    useSessionStore.getState().onSessionEvent({
      ...baseEvent,
      eventId: "evt-goal-create",
      sequence: 2,
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-goal-create",
        toolName: "goal.create",
        output: JSON.stringify({
          goal: {
            id: "goal-1",
            objective: "Perform evidence-backed UX verification.",
            status: "active",
            workItemIds: ["work-1"],
            evidenceRequirements: [],
          },
        }),
        metadata: { kind: "goal", operation: "create" },
        status: { state: "succeeded" },
      },
    });
    useSessionStore.getState().onSessionEvent({
      ...baseEvent,
      eventId: "evt-work-item-start",
      sequence: 3,
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-work-item-start",
        toolName: "work_item.execution.start",
        output: JSON.stringify({
          status: "started",
          item: {
            id: "work-1",
            summary: "Inspect composer activity ownership.",
            status: "in_progress",
            expectedEvidence: ["surface-map", "tests"],
            providedEvidence: ["surface-map"],
          },
        }),
        status: { state: "succeeded" },
      },
    });
    useSessionStore.getState().onSessionEvent({
      ...baseEvent,
      eventId: "evt-read-failed",
      sequence: 4,
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-read",
        toolName: "read",
        output: "ENOENT: no such file or directory, open 'C:\\repo\\missing.ts'",
        metadata: { kind: "file", operation: "read", filePath: "C:\\repo\\missing.ts", code: "ENOENT" },
        status: { state: "failed" },
      },
    });

    const entries = useSessionStore.getState().timelineEntries.filter((item) => (
      item.type === "event" && item.eventKind === "tool_call_completed"
    ));
    expect(entries.map((entry) => entry.type === "event" ? entry.toolPresentation?.outputKind : null)).toEqual([
      "work_item",
      "goal",
      "task",
      "diagnostic",
    ]);
    expect(JSON.stringify(entries.map((entry) => entry.type === "event" ? entry.toolPresentation : null))).not.toContain('"preview"');
    expect(entries[0]).toMatchObject({ summary: "Inspect composer activity ownership." });
    expect(entries[1]).toMatchObject({ summary: "Perform evidence-backed UX verification." });
    expect(entries[2]).toMatchObject({ summary: "Inspect composer activity ownership.", tone: "running" });
    expect(entries[3]).toMatchObject({ tone: "error", toolPresentation: { diagnostic: { code: "ENOENT" } } });
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
        toolCallScopeId: "response-1",
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
            toolCallScopeId: "response-1",
            toolCallId: "tool-tree",
            toolName: "tree",
            output: JSON.stringify({
              output: ".\npackages/\n  gui/",
              isError: false,
              metadata: {
                toolName: "tree",
                kind: "inspection",
                operation: "tree",
                path: "C:\\workspace\\kiln",
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
      summary: "55 entries under C:\\workspace\\kiln",
      toolPresentation: {
        outputKind: "tree",
        title: "C:\\workspace\\kiln",
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
        agentId: "codex-oauth:foundation-readonly-plan",
        requestedBy: "user",
        requestSource: "manual",
        profile: "foundation-readonly-plan",
        providerRoute: {
          providerId: "codex-oauth",
          model: "gpt-5.4-mini",
          surface: "direct-provider",
        },
        adapterKind: "direct",
        executionMode: "runtime-direct",
        authorityProfileId: "authority:foundation-readonly-plan",
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
        agentId: "codex-oauth:foundation-readonly-plan",
        profile: "foundation-readonly-plan",
        providerRoute: {
          providerId: "codex-oauth",
          model: "gpt-5.4-mini",
          surface: "direct-provider",
        },
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
        agentId: "codex-oauth:foundation-readonly-plan",
        profile: "foundation-readonly-plan",
        providerRoute: {
          providerId: "codex-oauth",
          model: "gpt-5.4-mini",
          surface: "direct-provider",
        },
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
      summary: "foundation-readonly-plan via codex-oauth/gpt-5.4-mini (direct-provider)",
    });
    expect(invocationEntries[1]).toMatchObject({
      type: "event",
      eventKind: "agent_invocation_started",
      title: "Agent invocation started",
      tone: "running",
      summary: "foundation-readonly-plan via codex-oauth/gpt-5.4-mini (direct-provider)",
    });
    expect(invocationEntries[2]).toMatchObject({
      type: "event",
      eventKind: "agent_invocation_completed",
      title: "Agent invocation completed",
      tone: "success",
      summary: "foundation-readonly-plan via codex-oauth/gpt-5.4-mini (direct-provider) · Planner returned focused steps",
    });
    expect(invocationEntries[3]).toMatchObject({
      type: "event",
      eventKind: "agent_invocation_failed",
      title: "Agent invocation failed",
      tone: "error",
      summary: "agent-coder · Worker timed out",
    });
    expect(invocationEntries[4]).toMatchObject({
      type: "event",
      eventKind: "agent_invocation_cancelled",
      title: "Agent invocation cancelled",
      tone: "warning",
      summary: "agent-reviewer · cancelled by operator",
    });
    expect(state.activity).toBeNull();
  });

  it("derives work item execution attempts and pause requirements from canonical events", () => {
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-work-update",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-05-12T20:00:00.000Z",
      kind: "work_item_updated",
      payload: {
        operation: "update",
        workItem: {
          id: "work-1",
          summary: "Run Slice 9 verification",
          status: "pending",
          workflowProfile: "verification-heavy",
          referenceRoots: ["/workspace/references/cloned"],
          expectedEvidence: ["tests"],
          providedEvidence: [],
          verificationGates: ["bun test"],
          pauseRequirements: [
            {
              id: "approval-1",
              kind: "approval",
              summary: "Approve execution",
              status: "pending",
            },
          ],
          updatedAt: "2026-05-12T20:00:00.000Z",
        },
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-work-started",
      kilnSessionId: "session-live",
      sequence: 2,
      timestamp: "2026-05-12T20:01:00.000Z",
      kind: "work_item_execution_started",
      payload: {
        workItem: {
          id: "work-1",
          summary: "Run Slice 9 verification",
          status: "in_progress",
          workflowProfile: "verification-heavy",
          expectedEvidence: ["tests"],
          providedEvidence: [],
          verificationGates: ["bun test"],
          executionAttempts: [
            {
              id: "goal-1:work-1:attempt:1",
              workItemId: "work-1",
              goalRunId: "goal-1",
              status: "started",
              executionMode: "managed_delegation",
              managedInvocationId: "invocation-1",
              startedAt: "2026-05-12T20:01:00.000Z",
              providedEvidence: [],
              missingEvidence: [],
              skippedVerificationGates: [],
              verificationGateResults: [],
              missingResidualRisk: false,
            },
          ],
          updatedAt: "2026-05-12T20:01:00.000Z",
        },
        attempt: {
          id: "goal-1:work-1:attempt:1",
          status: "started",
          executionMode: "managed_delegation",
          managedInvocationId: "invocation-1",
          startedAt: "2026-05-12T20:01:00.000Z",
        },
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-work-finished",
      kilnSessionId: "session-live",
      sequence: 3,
      timestamp: "2026-05-12T20:02:00.000Z",
      kind: "work_item_execution_finished",
      payload: {
        workItem: {
          id: "work-1",
          summary: "Run Slice 9 verification",
          status: "completed",
          workflowProfile: "verification-heavy",
          expectedEvidence: ["tests"],
          providedEvidence: ["tests"],
          verificationGates: ["bun test"],
          executionAttempts: [
            {
              id: "goal-1:work-1:attempt:1",
              workItemId: "work-1",
              goalRunId: "goal-1",
              status: "completed",
              executionMode: "managed_delegation",
              managedInvocationId: "invocation-1",
              startedAt: "2026-05-12T20:01:00.000Z",
              completedAt: "2026-05-12T20:02:00.000Z",
              providedEvidence: ["tests"],
              missingEvidence: [],
              skippedVerificationGates: [],
              verificationGateResults: [
                { gate: "bun test", status: "passed" },
                { gate: "bun run typecheck", status: "failed" },
              ],
              missingResidualRisk: false,
            },
          ],
          updatedAt: "2026-05-12T20:02:00.000Z",
        },
        attempt: {
          id: "goal-1:work-1:attempt:1",
          status: "completed",
          executionMode: "managed_delegation",
          managedInvocationId: "invocation-1",
          startedAt: "2026-05-12T20:01:00.000Z",
          completedAt: "2026-05-12T20:02:00.000Z",
        },
        missingEvidence: [],
        missingGoalEvidence: ["typecheck"],
        missingVerificationGates: ["adversarial managed-agent review"],
        failedVerificationGates: ["bun run typecheck"],
        missingResidualRisk: false,
      },
    });

    const items = deriveWorkItems(useSessionStore.getState().timelineEntries);

    expect(items).toEqual([
      expect.objectContaining({
        id: "work-1",
        resourceUri: "kiln://session/work-items/work-1",
        status: "completed",
        pauseRequirements: [
          expect.objectContaining({
            id: "approval-1",
            kind: "approval",
            status: "pending",
          }),
        ],
        executionAttempts: [
          expect.objectContaining({
            id: "goal-1:work-1:attempt:1",
            executionMode: "managed_delegation",
            status: "completed",
            managedInvocationId: "invocation-1",
          }),
        ],
        missingGoalEvidence: ["typecheck"],
        missingVerificationGates: ["adversarial managed-agent review"],
        failedVerificationGates: ["bun run typecheck"],
        referenceRoots: ["/workspace/references/cloned"],
      }),
    ]);
    expect(useSessionStore.getState().timelineEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "event",
        eventKind: "work_item_execution_started",
        title: "Work item execution started",
      }),
      expect.objectContaining({
        type: "event",
        eventKind: "work_item_execution_finished",
        title: "Work item execution completed",
      }),
    ]));
  });

  it("preserves supersession evidence and fails closed on a missing requirement status", () => {
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-work-superseded",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-07-26T20:00:00.000Z",
      kind: "work_item_updated",
      payload: {
        operation: "update",
        workItem: {
          id: "work-superseded",
          summary: "Run governed work after supersession.",
          status: "pending",
          workflowProfile: "verification-heavy",
          expectedEvidence: ["tests"],
          providedEvidence: [],
          verificationGates: ["bun test"],
          pauseRequirements: [
            {
              id: "approval-1",
              kind: "approval",
              summary: "Approve execution",
              status: "superseded",
              supersededByRequirementId: "approval-2",
              supersededAt: "2026-07-26T20:00:00.000Z",
              supersededBy: "operator",
              reason: "Replaced by a broader approval requirement.",
            },
            {
              id: "approval-2",
              kind: "approval",
              summary: "Malformed successor without a status",
            },
          ],
          updatedAt: "2026-07-26T20:00:00.000Z",
        },
      },
    });

    const items = deriveWorkItems(useSessionStore.getState().timelineEntries);

    expect(items).toEqual([
      expect.objectContaining({
        id: "work-superseded",
        pauseRequirements: [
          expect.objectContaining({
            id: "approval-1",
            kind: "approval",
            summary: "Approve execution",
            status: "superseded",
            supersededByRequirementId: "approval-2",
            supersededAt: "2026-07-26T20:00:00.000Z",
            supersededBy: "operator",
            reason: "Replaced by a broader approval requirement.",
          }),
          expect.objectContaining({
            id: "approval-2",
            status: "pending",
          }),
        ],
      }),
    ]);
  });

  it("projects plan, goal, and materialization lifecycle events into the GUI timeline", () => {
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-plan-submitted",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-05-12T21:00:00.000Z",
      kind: "plan_submitted",
      payload: {
        planId: "plan-1",
        mode: "plan",
        objective: "Implement operator workflow previews",
        summary: "Implement operator workflow previews",
        workflowProfile: "ui-change",
        riskClassification: "medium",
        sourceSpecificationId: "spec-1",
        proposedWorkItemCount: 2,
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-goal-created",
      kilnSessionId: "session-live",
      sequence: 2,
      timestamp: "2026-05-12T21:01:00.000Z",
      kind: "goal.created",
      payload: {
        goal: {
          id: "goal-1",
          objective: "Implement operator workflow previews",
          planId: "plan-1",
          status: "active",
          workItemIds: ["work-1", "work-2"],
          authorityEnvelope: {
            maximumAuthority: "audited",
            escalationPolicy: "approval_required",
          },
          routePolicy: {
            workflowProfile: "ui-change",
          },
        },
      },
    });
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-materialized",
      kilnSessionId: "session-live",
      sequence: 3,
      timestamp: "2026-05-12T21:02:00.000Z",
      kind: "work_items.materialized",
      payload: {
        materialization: {
          id: "mat-1",
          planId: "plan-1",
          planHash: "sha256:plan",
          approvalId: "approval-1",
          goalRunId: "goal-1",
          workItemIds: ["work-1", "work-2"],
          createdWorkItemIds: ["work-1", "work-2"],
          reusedWorkItemIds: [],
        },
      },
    });

    expect(useSessionStore.getState().timelineEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "event",
        eventKind: "plan_submitted",
        title: "Plan submitted",
        summary: "Implement operator workflow previews",
      }),
      expect.objectContaining({
        type: "event",
        eventKind: "goal.created",
        title: "Goal created",
        summary: "active · Implement operator workflow previews",
      }),
      expect.objectContaining({
        type: "event",
        eventKind: "work_items.materialized",
        title: "Work items materialized",
        summary: "2 work items · plan plan-1",
      }),
    ]));
  });

  it("loads plan, goal, and materialization lifecycle events from selected session detail", () => {
    useSessionStore.getState().viewSessionDetail({
      id: "session-workflow",
      meta: {
        kilnSessionId: "session-workflow",
        title: "Workflow preview",
        task: "Workflow preview",
        startedAt: "2026-05-12T21:00:00.000Z",
      },
      events: [
        {
          eventId: "evt-plan-submitted",
          kilnSessionId: "session-workflow",
          sequence: 1,
          timestamp: "2026-05-12T21:00:00.000Z",
          kind: "plan_submitted",
          payload: {
            planId: "plan-1",
            mode: "plan",
            objective: "Implement operator workflow previews",
            summary: "Implement operator workflow previews",
            workflowProfile: "ui-change",
            riskClassification: "medium",
            sourceSpecificationId: "spec-1",
            proposedWorkItemCount: 2,
          },
        },
        {
          eventId: "evt-goal-created",
          kilnSessionId: "session-workflow",
          sequence: 2,
          timestamp: "2026-05-12T21:01:00.000Z",
          kind: "goal.created",
          payload: {
            goal: {
              id: "goal-1",
              objective: "Implement operator workflow previews",
              planId: "plan-1",
              status: "active",
              workItemIds: ["work-1", "work-2"],
              authorityEnvelope: {
                maximumAuthority: "audited",
                escalationPolicy: "approval_required",
              },
              routePolicy: {
                workflowProfile: "ui-change",
              },
            },
          },
        },
        {
          eventId: "evt-materialized",
          kilnSessionId: "session-workflow",
          sequence: 3,
          timestamp: "2026-05-12T21:02:00.000Z",
          kind: "work_items.materialized",
          payload: {
            materialization: {
              id: "mat-1",
              planId: "plan-1",
              planHash: "sha256:plan",
              approvalId: "approval-1",
              goalRunId: "goal-1",
              workItemIds: ["work-1", "work-2"],
              createdWorkItemIds: ["work-1", "work-2"],
              reusedWorkItemIds: [],
            },
          },
        },
      ],
    });

    const state = useSessionStore.getState();
    expect(state.selectedSessionId).toBe("session-workflow");
    expect(state.timelineEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "event",
        eventKind: "plan_submitted",
        title: "Plan submitted",
      }),
      expect.objectContaining({
        type: "event",
        eventKind: "goal.created",
        title: "Goal created",
      }),
      expect.objectContaining({
        type: "event",
        eventKind: "work_items.materialized",
        title: "Work items materialized",
      }),
    ]));
  });

  it("stores runtime continuity per finalized provider and reconciles done-token fallback", () => {
    useSessionStore.setState({
      activeProvider: "claude",
      activeModel: "sonnet",
      status: "running",
    });

    useSessionStore.getState().onDone({
      type: "done",
      kilnSessionId: "session-live",
      outcome: "completed",
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
    expect(state.timelineEntries).toContainEqual(expect.objectContaining({
      type: "event",
      eventKind: "turn_completed",
      details: expect.objectContaining({
        runtimeContinuity: expect.objectContaining({
          strategy: "cache-first",
          feedbackLabel: "applied",
          pressure: "medium",
        }),
      }),
    }));
  });

  it("renders failed turn completion events with error tone", () => {
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-turn-failed",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-05-29T10:32:08.471Z",
      kind: "turn_completed",
      payload: {
        turnId: "session-live:turn:1",
        outcome: "failed",
        outputMessageId: "session-live:turn:1:assistant",
      },
    });

    const state = useSessionStore.getState();
    expect(state.timelineEntries).toContainEqual(expect.objectContaining({
      type: "event",
      eventKind: "turn_completed",
      summary: "failed",
      tone: "error",
    }));
  });

  it("renders cancelled turn completion events with neutral cancellation semantics", () => {
    useSessionStore.getState().onSessionEvent({
      eventId: "evt-turn-cancelled",
      kilnSessionId: "session-live",
      sequence: 1,
      timestamp: "2026-05-29T10:32:08.471Z",
      kind: "turn_completed",
      payload: {
        turnId: "session-live:turn:1",
        outcome: "cancelled",
      },
    });

    const state = useSessionStore.getState();
    expect(state.timelineEntries).toContainEqual(expect.objectContaining({
      type: "event",
      eventKind: "turn_completed",
      title: "Turn cancelled",
      summary: "cancelled",
      tone: "info",
    }));
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

  it("onCleared empties transcript and drops the session-scoped continuation target", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "claude",
    });
    useSessionStore.getState().setContinuation("session-a");
    useSessionStore.setState({ status: "ready" });
    useSessionStore.getState().sendMessage("test");
    useSessionStore.getState().onInteractiveUseUpdated({
      type: "interactive_use_updated",
      snapshot: {
        target: "browser",
        status: "succeeded",
        updatedAt: "2026-05-08T00:00:00.000Z",
        url: "https://example.com",
        screenshotDataUrl: "data:image/png;base64,abc",
      },
    });
    useSessionStore.getState().onCleared();

    const state = useSessionStore.getState();
    expect(state.messages).toHaveLength(0);
    expect(state.timelineEntries).toHaveLength(0);
    expect(state.interactiveUseSnapshot).toBeNull();
    expect(state.continuationTargetId).toBeNull();
    expect(localStorage.getItem("kiln.gui.continuationTarget")).toBeNull();
  });

  it("sendMessage rejects when status is not ready", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ status: "running" });
    const accepted = useSessionStore.getState().sendMessage("hello");
    expect(accepted).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("requests cancellation only for one active turn", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ status: "running" });

    expect(useSessionStore.getState().cancelActiveTurn()).toBe(true);
    expect(useSessionStore.getState().cancelActiveTurn()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "turn_cancel",
      reason: "Operator cancelled the active GUI turn.",
    }));
    expect(useSessionStore.getState().turnCancelPending).toBe(true);
  });

  it("sends typed goal controls independently from turn cancellation", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);

    expect(useSessionStore.getState().controlGoal({
      goalRunId: "goal-1",
      action: "pause",
    })).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "goal_control",
      goalRunId: "goal-1",
      action: "pause",
    }));
    expect(useSessionStore.getState().turnCancelPending).toBe(false);
  });

  it("returns to ready when cancellation finds no active gateway turn", () => {
    useSessionStore.setState({ status: "running", turnCancelPending: true });

    useSessionStore.getState().onTurnCancelResult({
      type: "turn_cancel_result",
      requestId: "cancel-1",
      status: "not_active",
    });

    expect(useSessionStore.getState()).toMatchObject({
      status: "ready",
      turnCancelPending: false,
      activityPhase: "idle",
    });
  });

  it("clears prior route-bound context evidence while the next turn streams", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      status: "ready",
      activeProvider: "anthropic",
      activeModel: "claude-sonnet",
      contextUsage: {
        state: "authoritative",
        usedTokens: 2_000,
        contextWindowTokens: 8_000,
        remainingTokens: 6_000,
        usedPercentage: 25,
        providerId: "codex-oauth",
        modelId: "gpt-5.6-terra",
        turnId: "prior:turn:1",
        observedAt: "2026-07-13T00:00:00.000Z",
        measurement: "provider_reported",
        lifecycle: "completed",
        contextWindowAuthority: "provider_reported",
        freshness: "fresh",
      },
    });

    expect(useSessionStore.getState().sendMessage("switch route")).toBe(true);
    expect(useSessionStore.getState()).toMatchObject({
      status: "running",
      respondingProvider: "anthropic",
      respondingModel: "claude-sonnet",
      contextUsage: null,
    });
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
      continuationSessionId: undefined,
      sessionIntent: "fresh",
      appName: "support",
      tenantId: "acme",
      reasoningEffort: "medium",
    });
  });

  it("setPlanMode(false) emits an execution transition frame through sender", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ planMode: true });
    useSessionStore.getState().setPlanMode(false, { gatewayTargetId: "gateway:local-app" });
    expect(send).toHaveBeenCalledWith({
      type: "execution_mode_transition",
      toMode: "execute",
      gatewayTargetId: "gateway:local-app",
    });
  });

  it("persists planMode but does not silently restore continuation target on welcome", () => {
    useSessionStore.getState().setPlanMode(true);
    useSessionStore.getState().setContinuation("resume-42");

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
    expect(state.continuationTargetId).toBeNull();
    expect(localStorage.getItem("kiln.gui.planMode")).toBe("true");
    expect(localStorage.getItem("kiln.gui.continuationTarget")).toBeNull();
  });

  it("treats historical selection as the active continuation target", () => {
    useSessionStore.getState().setContinuation("resume-session");
    useSessionStore.getState().setSelectedSessionId("preview-session");

    const state = useSessionStore.getState();
    expect(state.selectedSessionId).toBe("preview-session");
    expect(state.continuationTargetId).toBe("preview-session");
    expect(localStorage.getItem("kiln.gui.continuationTarget")).toBeNull();
  });

  it("keeps selected continuation state when submitting a continued live turn", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({ status: "ready" });
    useSessionStore.getState().setContinuation("resume-session");

    expect(useSessionStore.getState().sendMessage("continue with browser")).toBe(true);

    const state = useSessionStore.getState();
    expect(state.selectedSessionId).toBeNull();
    expect(state.continuationTargetId).toBe("resume-session");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "message",
      continuationSessionId: "resume-session",
    }));
  });

  it("continues the selected historical session on submit", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.getState().setSelectedSessionId("preview-session");
    useSessionStore.setState({
      status: "ready",
      messages: [
        {
          id: "historical-message",
          role: "assistant",
          content: "historical content",
          createdAt: "2026-05-08T20:00:00.000Z",
        },
      ],
      timelineEntries: [
        {
          id: "historical-entry",
          type: "message",
          createdAt: "2026-05-08T20:00:00.000Z",
          message: {
            id: "historical-message",
            role: "assistant",
            content: "historical content",
            createdAt: "2026-05-08T20:00:00.000Z",
          },
        },
      ],
    });

    expect(useSessionStore.getState().sendMessage("new browser check")).toBe(true);

    const state = useSessionStore.getState();
    expect(state.selectedSessionId).toBeNull();
    expect(state.continuationTargetId).toBe("preview-session");
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: "assistant", content: "historical content" });
    expect(state.messages[1]).toMatchObject({ role: "user", content: "new browser check" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "message",
      continuationSessionId: "preview-session",
    }));
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty("sessionIntent");
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
          payload: {
            toolCallScopeId: "response-1",
            toolCallId: "tool-1",
            toolName: "rg",
            input: { pattern: "resume" },
          },
        },
        {
          eventId: "evt-6",
          kilnSessionId: "session-77",
          sequence: 6,
          timestamp: "2026-04-21T10:03:01.000Z",
          kind: "tool_call_completed",
          payload: {
            toolCallScopeId: "response-1",
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
          eventId: "evt-context",
          kilnSessionId: "session-77",
          sequence: 9,
          timestamp: "2026-04-21T10:04:01.000Z",
          kind: "context_usage_observed",
          turnId: "session-77:turn:1",
          payload: {
            contextUsage: {
              state: "authoritative",
              usedTokens: 42,
              contextWindowTokens: 128,
              remainingTokens: 86,
              usedPercentage: 32.8125,
              observedAt: "2026-04-21T10:04:00.000Z",
              measurement: "provider_reported",
              lifecycle: "restored",
              contextWindowAuthority: "provider_reported",
              freshness: "historical",
            },
          },
        },
        {
          eventId: "evt-9",
          kilnSessionId: "session-77",
          sequence: 9,
          timestamp: "2026-04-21T10:04:05.000Z",
          kind: "lifecycle_attribution_recorded",
          turnId: "session-77:turn:1",
          payload: {
            ledger: {
              sourceEventId: "evt-8",
              context: { route: "codex-oauth/gpt-5.4-mini" },
              records: [
                { source: "unknown", tokenClass: "raw", tokens: 42 },
                { source: "unknown", tokenClass: "generated", tokens: 21 },
              ],
            },
            summary: {
              totalTokens: 63,
              totalCostUsd: 0.015,
              bySource: { unknown: 63 },
            },
            efficiencyEvidence: efficiencyEvidenceFixture({
              sessionId: "session-77",
              turnId: "session-77:turn:1",
              modelId: "gpt-5.4-mini",
              inputTokens: 42,
              outputTokens: 21,
              costUsd: 0.015,
              observedAt: "2026-04-21T10:04:05.000Z",
            }),
          },
        },
        {
          eventId: "evt-10",
          kilnSessionId: "session-77",
          sequence: 10,
          timestamp: "2026-04-21T10:04:10.000Z",
          kind: "continuity_decided",
          payload: {
            decision: "continue",
            reason: "single-source-cache",
          },
        },
        {
          eventId: "evt-11",
          kilnSessionId: "session-77",
          sequence: 11,
          timestamp: "2026-04-21T10:05:00.000Z",
          kind: "turn_completed",
          payload: { outcome: "completed" },
        },
      ],
    });

    const state = useSessionStore.getState();
    expect(state.selectedSessionId).toBe("session-77");
    expect(state.continuationTargetId).toBe("session-77");
    expect(localStorage.getItem("kiln.gui.continuationTarget")).toBeNull();
    expect(state.status).toBe("ready");
    expect(state.contextUsage).toMatchObject({
      state: "authoritative",
      lifecycle: "restored",
      freshness: "historical",
      usedPercentage: 32.8125,
    });
    expect(state.messages).toHaveLength(2);
    expect(state.timelineEntries).toHaveLength(10);
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
          title: "Searching files",
        }),
        expect.objectContaining({
          type: "event",
          eventKind: "tool_call_completed",
          title: "Searched files",
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
    expect(state.timelineEntries).toContainEqual(expect.objectContaining({
      type: "event",
      eventKind: "continuity_decided",
      details: expect.objectContaining({
        decision: "continue",
        reason: "single-source-cache",
      }),
    }));
    expect(state.timelineEntries).toContainEqual(expect.objectContaining({
      type: "event",
      eventKind: "lifecycle_attribution_recorded",
      title: "Verified efficiency evidence",
      summary: "Efficiency: 21 measured · 0 estimated · 0 cached · 0 avoided · verification not_run · context-whole-block-static-v1",
      turnId: "session-77:turn:1",
      details: expect.objectContaining({ schemaVersion: "verified-efficiency-evidence-v1" }),
    }));
  });

  it("projects lifecycle attribution as activity evidence without counting cost twice", () => {
    useSessionStore.setState({
      status: "running",
      liveSessionId: "session-attribution",
      sessionCostUsd: 0.25,
      inputTokens: 100,
      outputTokens: 20,
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-attribution",
      kilnSessionId: "session-attribution",
      sequence: 2,
      timestamp: "2026-06-30T18:00:00.000Z",
      kind: "lifecycle_attribution_recorded",
      turnId: "session-attribution:turn:1",
      payload: {
        ledger: {
          sourceEventId: "evt-cost",
          context: { route: "codex-oauth/gpt-5.5" },
          records: [
            { source: "unknown", tokenClass: "raw", tokens: 100 },
            { source: "unknown", tokenClass: "generated", tokens: 20 },
          ],
        },
        summary: {
          totalTokens: 120,
          totalCostUsd: 0.0123,
          bySource: { unknown: 120 },
        },
        efficiencyEvidence: efficiencyEvidenceFixture({
          sessionId: "session-attribution",
          turnId: "session-attribution:turn:1",
          modelId: "gpt-5.5",
          inputTokens: 100,
          outputTokens: 20,
          costUsd: 0.0123,
          observedAt: "2026-06-30T18:00:00.000Z",
        }),
      },
    });

    const state = useSessionStore.getState();
    expect(state.timelineEntries).toContainEqual(expect.objectContaining({
      type: "event",
      eventKind: "lifecycle_attribution_recorded",
      turnId: "session-attribution:turn:1",
      title: "Verified efficiency evidence",
      summary: "Efficiency: 20 measured · 0 estimated · 0 cached · 0 avoided · verification not_run · context-whole-block-static-v1",
      presentationDetails: expect.arrayContaining([
        { label: "Measured tokens", value: "20" },
        { label: "Policy", value: "ContextGovernor/context-whole-block-static-v1" },
        { label: "Source event", value: "evt-cost" },
      ]),
      details: expect.objectContaining({
        schemaVersion: "verified-efficiency-evidence-v1",
        policy: expect.objectContaining({ policyId: "context-whole-block-static-v1" }),
      }),
    }));
    expect(JSON.stringify(state.timelineEntries)).not.toContain("\"records\"");
    expect(state.sessionCostUsd).toBe(0.25);
    expect(state.inputTokens).toBe(100);
    expect(state.outputTokens).toBe(20);
  });

  it("restores selected-session authority and routing state from canonical turn completion", () => {
    useSessionStore.getState().viewSessionDetail({
      id: "session-authority-route",
      meta: {
        kilnSessionId: "session-authority-route",
        title: "Authority route replay",
        task: "Authority route replay",
        startedAt: "2026-05-12T20:00:00.000Z",
      },
      events: [
        {
          eventId: "evt-complete",
          kilnSessionId: "session-authority-route",
          sequence: 1,
          timestamp: "2026-05-12T20:01:00.000Z",
          kind: "turn_completed",
          payload: {
            outcome: "completed",
            routedProvider: "codex-oauth",
            routedModel: "gpt-5.4-mini",
            routingRationale: {
              selectedProvider: "codex-oauth",
              selectedModel: "gpt-5.4-mini",
              selectionMode: "auto",
              routingReason: "Auto by Kiln selected the default route.",
              routingTier: "default",
            },
            authorityStatus: {
              effective: "read_only",
              completeness: "authoritative",
            },
          },
        },
      ],
    });

    const state = useSessionStore.getState();
    expect(state.routedProvider).toBe("codex-oauth");
    expect(state.routedModel).toBe("gpt-5.4-mini");
    expect(state.authorityStatus).toEqual({
      effective: "read_only",
      completeness: "authoritative",
    });
    expect(state.timelineEntries).toContainEqual(expect.objectContaining({
      type: "event",
      eventKind: "turn_completed",
      details: expect.objectContaining({
        routingRationale: expect.objectContaining({
          selectionMode: "auto",
          routingReason: "Auto by Kiln selected the default route.",
        }),
        authorityStatus: {
          effective: "read_only",
          completeness: "authoritative",
        },
      }),
    }));
  });

  it("restores the latest interactive browser snapshot from canonical session events", () => {
    useSessionStore.getState().viewSessionDetail({
      id: "session-browser",
      meta: {
        kilnSessionId: "session-browser",
        title: "Browser test",
        task: "Browser test",
        startedAt: "2026-05-08T20:57:00.000Z",
      },
      events: [
        {
          eventId: "evt-browser",
          kilnSessionId: "session-browser",
          sequence: 1,
          timestamp: "2026-05-08T20:57:55.000Z",
          kind: "tool_call_completed",
          payload: {
            toolCallScopeId: "response-1",
            toolCallId: "tool-browser",
            toolName: "browser_observe",
            output: "Full tool output is available as resource links.",
            metadata: {
              kind: "interactive",
              target: "browser",
              operation: "observe",
              provider: "playwright",
              sessionId: "browser-1",
              observation: {
                url: "https://example.com/",
                title: "Example Domain",
                visibleText: "Example Domain",
                screenshotUri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
              },
            },
            status: { state: "succeeded" },
          },
        },
      ],
    });

    expect(useSessionStore.getState().interactiveUseSnapshot).toMatchObject({
      target: "browser",
      status: "succeeded",
      kilnSessionId: "session-browser",
      toolCallScopeId: "response-1",
      toolCallId: "tool-browser",
      toolName: "browser_observe",
      provider: "playwright",
      sessionId: "browser-1",
      operation: "observe",
      url: "https://example.com/",
      title: "Example Domain",
      screenshotUri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
    });
    expect(useSessionStore.getState().browserSessionState).toMatchObject({
      target: "browser",
      status: "succeeded",
      kilnSessionId: "session-browser",
      toolCallScopeId: "response-1",
      toolCallId: "tool-browser",
      toolName: "browser_observe",
      provider: "playwright",
      sessionId: "browser-1",
      operation: "observe",
      url: "https://example.com/",
      title: "Example Domain",
      ownership: "agent",
      viewMode: "snapshot",
      stream: {
        status: "unavailable",
        reason: "No live browser stream transport is configured.",
      },
      latestCapture: {
        uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
        relation: "snapshot",
      },
    });
  });

  it("opens the interactive browser snapshot from live canonical tool results", () => {
    useSessionStore.setState({
      status: "running",
      liveSessionId: "session-browser-live",
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-browser-live",
      kilnSessionId: "session-browser-live",
      sequence: 1,
      timestamp: "2026-05-08T23:11:00.000Z",
      kind: "tool_call_completed",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-browser-live",
        toolName: "browser_observe",
        output: "Full tool output is available as resource links.",
        metadata: {
          kind: "interactive",
          target: "browser",
          operation: "observe",
          provider: "playwright",
          sessionId: "browser-1",
          observation: {
            url: "https://example.com/",
            title: "Example Domain",
            visibleText: "Example Domain",
            screenshotUri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
          },
        },
        status: { state: "succeeded" },
      },
    });

    expect(useSessionStore.getState().interactiveUseSnapshot).toMatchObject({
      target: "browser",
      status: "succeeded",
      kilnSessionId: "session-browser-live",
      toolCallScopeId: "response-1",
      toolCallId: "tool-browser-live",
      toolName: "browser_observe",
      provider: "playwright",
      sessionId: "browser-1",
      operation: "observe",
      url: "https://example.com/",
      title: "Example Domain",
      screenshotUri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
    });
    expect(useSessionStore.getState().browserSessionState).toMatchObject({
      target: "browser",
      status: "succeeded",
      kilnSessionId: "session-browser-live",
      toolCallScopeId: "response-1",
      toolCallId: "tool-browser-live",
      toolName: "browser_observe",
      provider: "playwright",
      sessionId: "browser-1",
      operation: "observe",
      url: "https://example.com/",
      title: "Example Domain",
      ownership: "agent",
      viewMode: "snapshot",
      stream: {
        status: "unavailable",
        reason: "No live browser stream transport is configured.",
      },
      latestCapture: {
        uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
        relation: "snapshot",
      },
    });
  });

  it("clears browser session state when a later live interactive event targets the computer", () => {
    useSessionStore.setState({
      status: "running",
      liveSessionId: "session-interactive-targets",
      browserSessionState: {
        target: "browser",
        status: "running",
        updatedAt: "2026-05-08T23:10:00.000Z",
        kilnSessionId: "session-interactive-targets",
        ownership: "agent",
        viewMode: "snapshot",
        stream: {
          status: "unavailable",
          reason: "No live browser stream transport is configured.",
        },
      },
    });

    useSessionStore.getState().onSessionEvent({
      eventId: "evt-computer-live",
      kilnSessionId: "session-interactive-targets",
      sequence: 2,
      timestamp: "2026-05-08T23:12:00.000Z",
      kind: "tool_call_completed",
      payload: {
        toolCallScopeId: "response-1",
        toolCallId: "tool-computer-live",
        toolName: "computer_observe",
        output: "Window observed.",
        metadata: {
          kind: "interactive",
          target: "computer",
          operation: "observe",
          provider: "computer-use",
          sessionId: "computer-1",
          observation: {
            windowTitle: "Terminal",
            application: "Windows Terminal",
          },
        },
        status: { state: "succeeded" },
      },
    });

    expect(useSessionStore.getState().interactiveUseSnapshot).toMatchObject({
      target: "computer",
      status: "succeeded",
      sessionId: "computer-1",
    });
    expect(useSessionStore.getState().browserSessionState).toBeNull();
  });

  it("applies browser session lifecycle updates to the visible live session", () => {
    useSessionStore.setState({
      status: "running",
      liveSessionId: "session-browser-live",
    });

    useSessionStore.getState().onBrowserSessionUpdated({
      type: "browser_session_updated",
      browserSession: {
        target: "browser",
        status: "running",
        updatedAt: "2026-05-08T23:13:00.000Z",
        kilnSessionId: "session-browser-live",
        provider: "playwright",
        sessionId: "browser-1",
        ownership: "agent",
        viewMode: "live",
        stream: {
          status: "live",
        },
      },
    });

    expect(useSessionStore.getState().browserSessionState).toMatchObject({
      target: "browser",
      status: "running",
      kilnSessionId: "session-browser-live",
      provider: "playwright",
      sessionId: "browser-1",
      ownership: "agent",
      viewMode: "live",
      stream: {
        status: "live",
      },
    });
  });

  it("sends browser session control requests through the outbound socket", () => {
    const outboundSend = vi.fn();
    useSessionStore.setState({ outboundSend });

    const result = useSessionStore.getState().requestBrowserSessionControl("takeover", {
      sessionId: "browser-1",
      gatewayTargetId: "gateway:browser-app",
      reason: "Inspect before continuing.",
    });

    expect(result).toBe(true);
    expect(outboundSend).toHaveBeenCalledWith({
      type: "browser_session_control",
      action: "takeover",
      sessionId: "browser-1",
      gatewayTargetId: "gateway:browser-app",
      reason: "Inspect before continuing.",
    });
  });

  it("stores live viewport frames for the visible browser session", () => {
    useSessionStore.setState({
      status: "running",
      liveSessionId: "session-browser-live",
    });

    useSessionStore.getState().onBrowserLiveViewportFrame({
      type: "browser_live_viewport_frame",
      sessionId: "browser-1",
      kilnSessionId: "session-browser-live",
      frameId: "frame-1",
      sequence: 1,
      transport: "cdp-screencast",
      format: "jpeg",
      dataUrl: "data:image/jpeg;base64,abc123",
      width: 1280,
      height: 720,
      scale: 1,
      capturedAt: "2026-05-13T12:00:00.000Z",
    });

    expect(useSessionStore.getState().browserLiveViewportFrame).toMatchObject({
      sessionId: "browser-1",
      frameId: "frame-1",
      width: 1280,
      height: 720,
    });
  });

  it("clears stale browser live viewport frames when the browser session ends", () => {
    useSessionStore.setState({
      status: "running",
      liveSessionId: "session-browser-live",
      browserSessionState: {
        target: "browser",
        status: "running",
        updatedAt: "2026-05-13T12:00:00.000Z",
        kilnSessionId: "session-browser-live",
        provider: "playwright",
        sessionId: "browser-1",
        ownership: "operator",
        viewMode: "live",
        stream: { status: "live" },
      },
      browserLiveViewportFrame: {
        type: "browser_live_viewport_frame",
        sessionId: "browser-1",
        kilnSessionId: "session-browser-live",
        frameId: "frame-1",
        sequence: 1,
        transport: "snapshot-polling",
        format: "png",
        dataUrl: "data:image/png;base64,abc123",
        width: 1280,
        height: 720,
        scale: 1,
        capturedAt: "2026-05-13T12:00:01.000Z",
      },
    });

    useSessionStore.getState().onBrowserSessionUpdated({
      type: "browser_session_updated",
      browserSession: {
        target: "browser",
        status: "succeeded",
        updatedAt: "2026-05-13T12:00:02.000Z",
        kilnSessionId: "session-browser-live",
        provider: "playwright",
        sessionId: "browser-1",
        ownership: "released",
        viewMode: "snapshot",
        stream: { status: "ended" },
      },
    });

    expect(useSessionStore.getState().browserSessionState).toBeNull();
    expect(useSessionStore.getState().browserLiveViewportFrame).toBeNull();
  });

  it("sends brokered browser operator input and stores acknowledgements", () => {
    const outboundSend = vi.fn();
    useSessionStore.setState({ outboundSend });

    const sent = useSessionStore.getState().sendBrowserOperatorInput({
      sessionId: "browser-1",
      gatewayTargetId: "gateway:browser-app",
      input: {
        kind: "text",
        text: "hello",
      },
    });

    expect(sent).toBe(true);
    expect(outboundSend).toHaveBeenCalledWith({
      type: "browser_operator_input",
      requestId: expect.stringMatching(/^browser-input:/),
      sessionId: "browser-1",
      gatewayTargetId: "gateway:browser-app",
      input: {
        kind: "text",
        text: "hello",
      },
    });

    useSessionStore.getState().onBrowserOperatorInputAck({
      type: "browser_operator_input_ack",
      requestId: "browser-input-1",
      sessionId: "browser-1",
      status: "blocked",
      reason: "Operator does not own the session.",
      handledAt: "2026-05-13T12:00:00.000Z",
    });

    expect(useSessionStore.getState().browserOperatorInputAck).toMatchObject({
      requestId: "browser-input-1",
      status: "blocked",
      reason: "Operator does not own the session.",
    });
  });

  it("sends approval responses with explicit gateway target identity when provided", () => {
    const outboundSend = vi.fn();
    useSessionStore.setState({ outboundSend });

    expect(useSessionStore.getState().sendApprovalResponse(true, undefined, "approval-1", {
      gatewayTargetId: "gateway:local-app",
    })).toBe(true);
    expect(useSessionStore.getState().sendApprovalResponse(false, "Scope changed.", "approval-2", {
      gatewayTargetId: "gateway:local-app",
    })).toBe(true);

    expect(outboundSend).toHaveBeenNthCalledWith(1, {
      type: "approve",
      approvalId: "approval-1",
      gatewayTargetId: "gateway:local-app",
    });
    expect(outboundSend).toHaveBeenNthCalledWith(2, {
      type: "reject",
      approvalId: "approval-2",
      reason: "Scope changed.",
      gatewayTargetId: "gateway:local-app",
    });
  });

  it("ignores browser session lifecycle updates for another visible session", () => {
    useSessionStore.setState({
      status: "running",
      liveSessionId: "session-visible",
      browserSessionState: {
        target: "browser",
        status: "running",
        updatedAt: "2026-05-08T23:13:00.000Z",
        kilnSessionId: "session-visible",
        provider: "playwright",
        sessionId: "browser-visible",
        ownership: "agent",
        viewMode: "snapshot",
        stream: {
          status: "unavailable",
          reason: "No live browser stream transport is configured.",
        },
      },
    });

    useSessionStore.getState().onBrowserSessionUpdated({
      type: "browser_session_updated",
      browserSession: {
        target: "browser",
        status: "running",
        updatedAt: "2026-05-08T23:14:00.000Z",
        kilnSessionId: "session-other",
        provider: "playwright",
        sessionId: "browser-other",
        ownership: "agent",
        viewMode: "live",
        stream: {
          status: "live",
        },
      },
    });

    expect(useSessionStore.getState().browserSessionState?.sessionId).toBe("browser-visible");
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
