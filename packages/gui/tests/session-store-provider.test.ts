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
    clearPending: false,
    providerSwitching: false,
    providerExplicitSelection: false,
    authorityStatus: null,
    outboundSend: null,
    clearTimeoutId: null,
    providerSwitchTimeoutId: null,
  });
}

describe("session-store provider selection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    resetSessionStore();
  });

  it("switchProvider emits provider outbound frame", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);

    const accepted = useSessionStore.getState().switchProvider("claude", "sonnet-4.6");

    expect(accepted).toBe(true);
    expect(send).toHaveBeenCalledWith({
      type: "provider",
      provider: "claude",
      model: "sonnet-4.6",
    });
  });

  it("provider_changed ack updates provider/model and clears switching flag", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.getState().switchProvider("codex", "o3");

    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "codex",
      model: "o3",
    });

    const state = useSessionStore.getState();
    expect(state.activeProvider).toBe("codex");
    expect(state.activeModel).toBe("o3");
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.routeMode).toBe("user");
  });

  it("provider switch timeout sets error banner and clears switching state", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    useSessionStore.getState().setSender(send);

    useSessionStore.getState().switchProvider("openai", "gpt-5");
    vi.advanceTimersByTime(5_000);

    const state = useSessionStore.getState();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).toBe("Provider switch timed out. Please retry.");
  });

  it("done attaches routed provider/model to finalized assistant message", () => {
    useSessionStore.getState().onTextDelta({ type: "text_delta", content: "partial" });
    useSessionStore.getState().onDone({
      type: "done",
      content: "",
      inputTokens: 1,
      outputTokens: 2,
      routedProvider: "claude",
      routedModel: "claude-sonnet-4-6",
    });

    const state = useSessionStore.getState();
    expect(state.messages[0]?.role).toBe("assistant");
    expect(state.messages[0]?.routedProvider).toBe("claude");
    expect(state.messages[0]?.routedModel).toBe("claude-sonnet-4-6");
  });

  it("routeMode transitions user -> responding -> user", () => {
    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: true,
          models: ["claude-sonnet-4-6"],
        },
      ],
      activeProvider: "claude",
      activeModel: "claude-sonnet-4-6",
      planMode: false,
    });
    expect(useSessionStore.getState().routeMode).toBe("user");

    useSessionStore.getState().onActivity({
      type: "activity",
      activity: "tool_use",
      toolName: "bash",
      input: { cmd: "echo hi" },
    });
    expect(useSessionStore.getState().routeMode).toBe("responding");

    useSessionStore.getState().onDone({
      type: "done",
      content: "",
      inputTokens: 1,
      outputTokens: 1,
      routedProvider: "claude",
      routedModel: "claude-sonnet-4-6",
    });
    expect(useSessionStore.getState().routeMode).toBe("user");
  });

  it("stores authorityStatus from welcome and updates it from done", () => {
    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: true,
          models: ["claude-sonnet-4-6"],
        },
      ],
      activeProvider: "claude",
      activeModel: "claude-sonnet-4-6",
      planMode: false,
      authorityStatus: {
        effective: "audited",
        completeness: "partial",
      },
    });

    expect(useSessionStore.getState().authorityStatus).toEqual({
      effective: "audited",
      completeness: "partial",
    });

    useSessionStore.getState().onDone({
      type: "done",
      content: "done",
      inputTokens: 1,
      outputTokens: 1,
      authorityStatus: {
        effective: "fail_closed",
        completeness: "authoritative",
      },
    });

    expect(useSessionStore.getState().authorityStatus).toEqual({
      effective: "fail_closed",
      completeness: "authoritative",
    });
  });
});
