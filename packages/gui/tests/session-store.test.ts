import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "../src/lib/session-store.js";

function resetSessionStore(): void {
  useSessionStore.setState({
    status: "idle",
    messages: [],
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
    perProviderUsage: {},
    runtimeContinuityByProvider: {},
    changedFiles: [],
    currentTurnProvider: null,
    currentTurnTrackedCostUsd: 0,
    currentTurnTrackedInputTokens: 0,
    currentTurnTrackedOutputTokens: 0,
    clearPending: false,
    providerSwitching: false,
    providerExplicitSelection: false,
    authorityStatus: null,
    approvalQueue: [],
    toolCallLog: [],
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
    localStorage.setItem("kiln.gui.resume.claude", "session-123");

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
    expect(state.routedProvider).toBe("claude");
    expect(state.routedModel).toBe("sonnet");
  });

  it("tracks session telemetry from cost_update activity and file changes", () => {
    useSessionStore.setState({
      activeProvider: "claude",
      activeModel: "sonnet",
      status: "running",
      currentTurnProvider: "claude",
    });

    useSessionStore.getState().onActivity({
      type: "activity",
      activity: "cost_update",
      usd: 0.125,
      inputTokens: 1200,
      outputTokens: 340,
    });
    useSessionStore.getState().onActivity({
      type: "activity",
      activity: "file_changed",
      path: "packages/gui/src/app.tsx",
      changeType: "modified",
      linesAdded: 12,
      linesRemoved: 4,
    });

    const state = useSessionStore.getState();
    expect(state.sessionCostUsd).toBeCloseTo(0.125);
    expect(state.inputTokens).toBe(1200);
    expect(state.outputTokens).toBe(340);
    expect(state.perProviderUsage.claude).toEqual({
      costUsd: 0.125,
      inputTokens: 1200,
      outputTokens: 340,
    });
    expect(state.changedFiles).toHaveLength(1);
    expect(state.changedFiles[0]).toMatchObject({
      path: "packages/gui/src/app.tsx",
      changeType: "modified",
      linesAdded: 12,
      linesRemoved: 4,
    });
  });

  it("stores runtime continuity per finalized provider and reconciles done-token fallback", () => {
    useSessionStore.setState({
      activeProvider: "claude",
      activeModel: "sonnet",
      status: "running",
      currentTurnProvider: "claude",
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
    expect(state.perProviderUsage.codex).toEqual({
      costUsd: 0,
      inputTokens: 250,
      outputTokens: 75,
    });
    expect(state.runtimeContinuityByProvider.codex).toMatchObject({
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
    expect(state.messages[0]?.role).toBe("error");
    expect(state.errorBanner).toBe("Gateway failed");
    expect(state.status).toBe("ready");
  });

  it("onCleared empties transcript and drops resume target for active provider", () => {
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
    expect(state.resumeTargetId).toBeNull();
    expect(localStorage.getItem("kiln.gui.resume.claude")).toBeNull();
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

  it("persists planMode and per-provider resume target and reloads on welcome", () => {
    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "claude",
    });
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
    expect(localStorage.getItem("kiln.gui.resume.claude")).toBe("resume-42");
  });
});
