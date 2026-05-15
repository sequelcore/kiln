import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuiOutboundFrame } from "@kilnai/gateway-contracts";
import { useSessionStore } from "../src/lib/session-store.js";

function resetSessionStore(): void {
  useSessionStore.setState({
    status: "idle",
    messages: [],
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
    resumeTargetId: null,
    routedProvider: null,
    routedModel: null,
    routeMode: "auto",
    respondingProvider: null,
    respondingModel: null,
    turnCounter: 0,
    clearPending: false,
    providerSwitching: false,
    providerSwitchTarget: null,
    providerAuthenticating: false,
    providerAuthTarget: null,
    providerAuthMessage: null,
    providerExplicitSelection: false,
    authorityStatus: null,
    outboundSend: null,
    clearTimeoutId: null,
    providerSwitchTimeoutId: null,
    providerAuthTimeoutId: null,
  });
}

function advertiseOpenAiModel(): void {
  useSessionStore.setState({
    providers: [
      {
        id: "openai",
        label: "OpenAI",
        group: "direct-api",
        free: false,
        available: true,
        models: ["gpt-5"],
      },
    ],
  });
}

function lastProviderRequestId(send: ReturnType<typeof vi.fn>): string {
  const frame = send.mock.calls.at(-1)?.[0] as GuiOutboundFrame | undefined;
  if (frame?.type !== "provider" || !frame.requestId) {
    throw new Error("Expected provider switch frame with requestId");
  }
  return frame.requestId;
}

function lastProviderAuthRequestId(send: ReturnType<typeof vi.fn>): string {
  const frame = send.mock.calls.at(-1)?.[0] as GuiOutboundFrame | undefined;
  if (frame?.type !== "provider_auth" || !frame.requestId) {
    throw new Error("Expected provider auth frame with requestId");
  }
  return frame.requestId;
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
    useSessionStore.setState({
      providers: [
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: true,
          models: ["sonnet-4.6"],
        },
      ],
    });

    const accepted = useSessionStore.getState().switchProvider("claude", "sonnet-4.6");

    expect(accepted).toBe(true);
    expect(send).toHaveBeenCalledWith({
      type: "provider",
      provider: "claude",
      model: "sonnet-4.6",
      requestId: expect.any(String),
    });
  });

  it("switchProvider rejects provider changes until the provider catalog is ready", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      providerCatalogStatus: "pending",
      providers: [
        {
          id: "codex-oauth",
          label: "Codex OAuth",
          group: "subscription",
          free: true,
          available: true,
          models: ["gpt-5.4"],
        },
      ],
    });

    const accepted = useSessionStore.getState().switchProvider("codex-oauth", "gpt-5.4");

    expect(accepted).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(useSessionStore.getState().errorBanner).toBe("Provider catalog is still loading. Please retry once startup completes.");
  });

  it("authenticateProvider emits provider_auth and applies completed provider descriptors", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);

    const accepted = useSessionStore.getState().authenticateProvider("opencode-go", {
      apiKey: "sk-test",
      tier: "go",
    });
    const requestId = lastProviderAuthRequestId(send);

    expect(accepted).toBe(true);
    expect(send).toHaveBeenCalledWith({
      type: "provider_auth",
      provider: "opencode-go",
      requestId,
      apiKey: "sk-test",
      tier: "go",
    });

    useSessionStore.getState().onProviderAuthCompleted({
      type: "provider_auth_completed",
      provider: "opencode-go",
      requestId,
      models: { "opencode-go": ["minimax-m2.5"] },
      providerDiscovery: [],
      providers: [
        {
          id: "opencode-go",
          label: "OpenCode Go",
          group: "subscription",
          free: true,
          available: true,
          models: ["minimax-m2.5"],
        },
      ],
    });

    const state = useSessionStore.getState();
    expect(state.providerAuthenticating).toBe(false);
    expect(state.providerAuthTarget).toBeNull();
    expect(state.providers).toEqual([
      expect.objectContaining({
        id: "opencode-go",
        available: true,
        models: ["minimax-m2.5"],
      }),
    ]);
  });

  it("switchProvider accepts model-less Claude and emits a provider frame without model", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      providers: [
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: true,
          models: [],
        },
      ],
    });

    const accepted = useSessionStore.getState().switchProvider("claude");

    expect(accepted).toBe(true);
    expect(send).toHaveBeenCalledWith({
      type: "provider",
      provider: "claude",
      requestId: expect.any(String),
    });
  });

  it("switchProvider rejects a known unavailable provider", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: false,
          models: [],
        },
      ],
    });

    const accepted = useSessionStore.getState().switchProvider("openai");

    expect(accepted).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(useSessionStore.getState().errorBanner).toBe("OpenAI is unavailable.");
  });

  it("switchProvider rejects available provider descriptors without models", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      providers: [
        {
          id: "opencode",
          label: "OpenCode",
          group: "harness",
          free: false,
          available: true,
          models: [],
        },
      ],
    });

    const accepted = useSessionStore.getState().switchProvider("opencode");

    expect(accepted).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(useSessionStore.getState().errorBanner).toBe("OpenCode is unavailable.");
  });

  it("provider_changed ack updates provider/model and clears switching flag", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      providers: [
        {
          id: "codex",
          label: "Codex",
          group: "harness",
          free: false,
          available: true,
          models: ["o3"],
        },
      ],
    });
    useSessionStore.getState().switchProvider("codex", "o3");
    const requestId = lastProviderRequestId(send);

    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "codex",
      model: "o3",
      requestId,
    });

    const state = useSessionStore.getState();
    expect(state.activeProvider).toBe("codex");
    expect(state.activeModel).toBe("o3");
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.routeMode).toBe("user");
  });

  it("provider_changed matching a pending model switch survives a transient provider catalog refresh", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    advertiseOpenAiModel();
    useSessionStore.getState().switchProvider("openai", "gpt-5");
    const requestId = lastProviderRequestId(send);

    useSessionStore.setState({ providers: [] });
    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "openai",
      model: "gpt-5",
      requestId,
    });

    const state = useSessionStore.getState();
    expect(state.activeProvider).toBe("openai");
    expect(state.activeModel).toBe("gpt-5");
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTarget).toBeNull();
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).toBeNull();
  });

  it("provider_changed without model is ignored", () => {
    useSessionStore.setState({
      providers: [
        {
          id: "opencode",
          label: "OpenCode",
          group: "harness",
          free: false,
          available: true,
          models: ["minimax-m2.5"],
        },
      ],
      activeProvider: "codex",
      activeModel: "o3",
    });

    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "opencode",
    });

    const state = useSessionStore.getState();
    expect(state.activeProvider).toBe("codex");
    expect(state.activeModel).toBe("o3");
  });

  it("provider_changed without model accepts a pending model-less Claude switch", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      providers: [
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: true,
          models: [],
        },
      ],
      activeProvider: "codex",
      activeModel: "o3",
    });
    useSessionStore.getState().switchProvider("claude");
    const requestId = lastProviderRequestId(send);

    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "claude",
      requestId,
    });

    const state = useSessionStore.getState();
    expect(state.activeProvider).toBe("claude");
    expect(state.activeModel).toBeNull();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.routeMode).toBe("user");
  });

  it("provider_changed matching a pending model-less switch survives a transient provider catalog refresh", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      providers: [
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: true,
          models: [],
        },
      ],
      activeProvider: "codex",
      activeModel: "o3",
    });
    useSessionStore.getState().switchProvider("claude");
    const requestId = lastProviderRequestId(send);

    useSessionStore.setState({ providers: [] });
    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "claude",
      requestId,
    });

    const state = useSessionStore.getState();
    expect(state.activeProvider).toBe("claude");
    expect(state.activeModel).toBeNull();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTarget).toBeNull();
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).toBeNull();
  });

  it("welcome without authoritative provider selection clears stale active provider and model", () => {
    useSessionStore.setState({
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
    });

    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [],
      models: {},
      executionMode: "execute",
    });

    const state = useSessionStore.getState();
    expect(state.activeProvider).toBeNull();
    expect(state.activeModel).toBeNull();
  });

  it("restores the last valid GUI provider selection after welcome when runtime has no active selection", () => {
    const send = vi.fn();
    localStorage.setItem("kiln.gui.providerSelection", JSON.stringify({
      provider: "codex-oauth",
      model: "gpt-5.5",
    }));
    useSessionStore.getState().setSender(send);

    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "codex-oauth",
          label: "Codex OAuth",
          group: "direct-api",
          free: false,
          available: true,
          models: ["gpt-5.5"],
        },
      ],
      models: {
        "codex-oauth": ["gpt-5.5"],
      },
      executionMode: "execute",
    });

    expect(send).toHaveBeenCalledWith({
      type: "provider",
      provider: "codex-oauth",
      model: "gpt-5.5",
      requestId: expect.any(String),
    });
    expect(useSessionStore.getState().providerSwitching).toBe(true);
  });

  it("restores the last valid GUI provider selection over the startup default", () => {
    const send = vi.fn();
    localStorage.setItem("kiln.gui.providerSelection", JSON.stringify({
      provider: "codex-oauth",
      model: "gpt-5.5",
    }));
    useSessionStore.getState().setSender(send);

    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "openrouter",
          label: "OpenRouter",
          group: "direct-api",
          free: true,
          available: true,
          models: ["openrouter/free"],
        },
        {
          id: "codex-oauth",
          label: "Codex OAuth",
          group: "direct-api",
          free: false,
          available: true,
          models: ["gpt-5.5"],
        },
      ],
      models: {
        openrouter: ["openrouter/free"],
        "codex-oauth": ["gpt-5.5"],
      },
      activeProvider: "openrouter",
      activeModel: "openrouter/free",
      executionMode: "execute",
    });

    expect(send).toHaveBeenCalledWith({
      type: "provider",
      provider: "codex-oauth",
      model: "gpt-5.5",
      requestId: expect.any(String),
    });
    expect(useSessionStore.getState().providerSwitching).toBe(true);
  });

  it("persists acknowledged GUI provider selections", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: true,
          models: ["gpt-5"],
        },
      ],
    });

    expect(useSessionStore.getState().switchProvider("openai", "gpt-5")).toBe(true);
    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "openai",
      model: "gpt-5",
      requestId: lastProviderRequestId(send),
    });

    expect(localStorage.getItem("kiln.gui.providerSelection")).toBe(JSON.stringify({
      provider: "openai",
      model: "gpt-5",
    }));
  });

  it("welcome accepts model-less Claude as the active authoritative selection", () => {
    useSessionStore.setState({
      activeProvider: "codex",
      activeModel: "o3",
    });

    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: true,
          models: [],
        },
      ],
      models: {
        claude: [],
      },
      activeProvider: "claude",
      executionMode: "execute",
    });

    const state = useSessionStore.getState();
    expect(state.providers).toEqual([
      expect.objectContaining({
        id: "claude",
        available: true,
        models: [],
      }),
    ]);
    expect(state.activeProvider).toBe("claude");
    expect(state.activeModel).toBeNull();
  });

  it("welcome with provider descriptors but no active selection does not infer a first active provider", () => {
    useSessionStore.setState({
      activeProvider: "openai",
      activeModel: "gpt-4o",
    });

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
      models: {
        claude: ["claude-sonnet-4-6"],
      },
      executionMode: "execute",
    });

    const state = useSessionStore.getState();
    expect(state.providers.map((provider) => provider.id)).toEqual(["claude"]);
    expect(state.activeProvider).toBeNull();
    expect(state.activeModel).toBeNull();
  });

  it("welcome preserves structurally valid provider descriptors with unknown ids", () => {
    useSessionStore.setState({
      activeProvider: "openai",
      activeModel: "gpt-4o",
    });

    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "unknown-provider",
          label: "Unknown Provider",
          group: "direct-api",
          free: false,
          available: true,
          models: ["mystery-1"],
        },
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: true,
          models: ["claude-sonnet-4-6"],
        },
      ],
      models: {
        "unknown-provider": ["mystery-1"],
        claude: ["claude-sonnet-4-6"],
      },
      executionMode: "execute",
    });

    const state = useSessionStore.getState();
    expect(state.providers.map((provider) => provider.id)).toEqual(["unknown-provider", "claude"]);
    expect(state.providers.find((provider) => provider.id === "unknown-provider")).toEqual(
      expect.objectContaining({
        id: "unknown-provider",
        available: true,
        models: ["mystery-1"],
      }),
    );
    expect(state.activeProvider).toBeNull();
    expect(state.activeModel).toBeNull();
  });

  it("welcome treats available provider descriptors without models as unavailable and clears explicit selection", () => {
    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "opencode",
          label: "OpenCode",
          group: "harness",
          free: false,
          available: true,
          models: [],
        },
      ],
      activeProvider: "opencode",
      executionMode: "execute",
    });

    const state = useSessionStore.getState();
    expect(state.providers).toEqual([
      expect.objectContaining({
        id: "opencode",
        available: false,
        models: [],
      }),
    ]);
    expect(state.activeProvider).toBeNull();
    expect(state.activeModel).toBeNull();
    expect(state.providerExplicitSelection).toBe(false);
  });

  it("welcome treats blank model ids as unavailable and clears explicit selection", () => {
    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "opencode",
          label: "OpenCode",
          group: "harness",
          free: false,
          available: true,
          models: ["", "   "],
        },
      ],
      activeProvider: "opencode",
      activeModel: "   ",
      executionMode: "execute",
    });

    const state = useSessionStore.getState();
    expect(state.providers).toEqual([
      expect.objectContaining({
        id: "opencode",
        available: false,
        models: [],
      }),
    ]);
    expect(state.activeProvider).toBeNull();
    expect(state.activeModel).toBeNull();
    expect(state.providerExplicitSelection).toBe(false);
  });

  it("dashboard provider refresh clears stale active provider and stale model lists", () => {
    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: true,
          models: ["gpt-5"],
        },
      ],
      activeProvider: "openai",
      activeModel: "gpt-5",
      executionMode: "execute",
    });

    useSessionStore.getState().onProvidersRefreshed([
      {
        id: "openai",
        label: "OpenAI",
        group: "direct-api",
        free: false,
        available: false,
        models: [],
      },
    ]);

    const state = useSessionStore.getState();
    expect(state.providers).toEqual([
      expect.objectContaining({
        id: "openai",
        available: false,
        models: [],
      }),
    ]);
    expect(state.activeProvider).toBeNull();
    expect(state.activeModel).toBeNull();
    expect(state.providerExplicitSelection).toBe(false);
  });

  it("dashboard provider refresh preserves unknown runtime providers with valid descriptors", () => {
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
      executionMode: "execute",
    });

    useSessionStore.getState().onProvidersRefreshed([
      {
        id: "runtime-only-provider",
        label: "Runtime Only",
        group: "direct-api",
        free: false,
        available: true,
        models: ["runtime-model-1"],
      },
    ]);

    const state = useSessionStore.getState();
    expect(state.providers).toEqual([
      expect.objectContaining({
        id: "runtime-only-provider",
        label: "Runtime Only",
        available: true,
        models: ["runtime-model-1"],
      }),
    ]);
    expect(state.activeProvider).toBeNull();
    expect(state.activeModel).toBeNull();
    expect(state.providerExplicitSelection).toBe(false);
  });

  it("provider_changed ignores unavailable or unadvertised provider selections", () => {
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
      executionMode: "execute",
    });

    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "unknown-provider",
      model: "mystery-1",
    });

    const state = useSessionStore.getState();
    expect(state.activeProvider).toBe("claude");
    expect(state.activeModel).toBe("claude-sonnet-4-6");
    expect(state.providerSwitching).toBe(false);
  });

  it("provider_changed ignores valid unsolicited selections when no provider switch is pending", () => {
    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: true,
          models: ["gpt-5"],
        },
      ],
      executionMode: "execute",
    });

    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "openai",
      model: "gpt-5",
    });

    const state = useSessionStore.getState();
    expect(state.activeProvider).toBeNull();
    expect(state.activeModel).toBeNull();
    expect(state.providerSwitching).toBe(false);
  });

  it("invalid provider_changed rejects a pending valid provider switch", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: true,
          models: ["gpt-5"],
        },
      ],
    });

    const accepted = useSessionStore.getState().switchProvider("openai", "gpt-5");
    const timeoutId = useSessionStore.getState().providerSwitchTimeoutId;

    expect(accepted).toBe(true);
    expect(useSessionStore.getState().providerSwitching).toBe(true);
    expect(timeoutId).not.toBeNull();

    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "unknown-provider",
      model: "mystery-1",
    });

    const state = useSessionStore.getState();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).toBe("Provider switch acknowledgement did not match the pending request.");
    expect(timeoutId).not.toBeNull();
  });

  it("valid but mismatched provider_changed rejects a pending valid provider switch", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: true,
          models: ["gpt-5"],
        },
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: true,
          models: ["claude-sonnet-4-6"],
        },
      ],
    });

    const accepted = useSessionStore.getState().switchProvider("openai", "gpt-5");
    const timeoutId = useSessionStore.getState().providerSwitchTimeoutId;

    expect(accepted).toBe(true);
    expect(timeoutId).not.toBeNull();

    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "claude",
      model: "claude-sonnet-4-6",
    });

    const state = useSessionStore.getState();
    expect(state.activeProvider).toBeNull();
    expect(state.activeModel).toBeNull();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).toBe("Provider switch acknowledgement did not match the pending request.");
    expect(timeoutId).not.toBeNull();
  });

  it("synchronous provider_changed ack during outbound send resolves the switch without arming a stale timeout", () => {
    vi.useFakeTimers();
    useSessionStore.setState({
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: true,
          models: ["gpt-5"],
        },
      ],
    });
    const send = vi.fn((frame: GuiOutboundFrame) => {
      useSessionStore.getState().onProviderChanged({
        type: "provider_changed",
        provider: "openai",
        model: "gpt-5",
        requestId: frame.type === "provider" ? frame.requestId : undefined,
      });
    });
    useSessionStore.getState().setSender(send);

    const accepted = useSessionStore.getState().switchProvider("openai", "gpt-5");

    expect(accepted).toBe(true);
    expect(send).toHaveBeenCalledWith({
      type: "provider",
      provider: "openai",
      model: "gpt-5",
      requestId: expect.any(String),
    });

    let state = useSessionStore.getState();
    expect(state.activeProvider).toBe("openai");
    expect(state.activeModel).toBe("gpt-5");
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();

    vi.advanceTimersByTime(5_000);

    state = useSessionStore.getState();
    expect(state.errorBanner).toBeNull();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
  });

  it("welcome clears a pending provider switch timer after authoritative reconnect state", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    advertiseOpenAiModel();

    const accepted = useSessionStore.getState().switchProvider("openai", "gpt-5");

    expect(accepted).toBe(true);
    expect(useSessionStore.getState().providerSwitching).toBe(true);
    expect(useSessionStore.getState().providerSwitchTimeoutId).not.toBeNull();

    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: true,
          models: ["gpt-5"],
        },
      ],
      activeProvider: "openai",
      activeModel: "gpt-5",
      executionMode: "execute",
    });

    let state = useSessionStore.getState();
    expect(state.activeProvider).toBe("openai");
    expect(state.activeModel).toBe("gpt-5");
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTarget).toBeNull();
    expect(state.providerSwitchTimeoutId).toBeNull();

    vi.advanceTimersByTime(5_000);

    state = useSessionStore.getState();
    expect(state.errorBanner).toBeNull();
    expect(state.providerSwitching).toBe(false);
  });

  it("switchProvider rolls back pending state when outbound send throws", () => {
    vi.useFakeTimers();
    const send = vi.fn(() => {
      throw new Error("socket closed");
    });
    useSessionStore.getState().setSender(send);
    advertiseOpenAiModel();

    const accepted = useSessionStore.getState().switchProvider("openai", "gpt-5");

    expect(accepted).toBe(false);
    expect(send).toHaveBeenCalledWith({
      type: "provider",
      provider: "openai",
      model: "gpt-5",
      requestId: expect.any(String),
    });

    let state = useSessionStore.getState();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTarget).toBeNull();
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).toBe("socket closed");

    vi.advanceTimersByTime(5_000);

    state = useSessionStore.getState();
    expect(state.errorBanner).toBe("socket closed");
    expect(state.providerSwitching).toBe(false);
  });

  it("invalid switchProvider request does not cancel a pending valid provider switch", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.setState({
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: true,
          models: ["gpt-5"],
        },
      ],
    });

    const accepted = useSessionStore.getState().switchProvider("openai", "gpt-5");
    const timeoutId = useSessionStore.getState().providerSwitchTimeoutId;

    expect(accepted).toBe(true);
    expect(timeoutId).not.toBeNull();

    const rejected = useSessionStore.getState().switchProvider("openai", "not-advertised");

    expect(rejected).toBe(false);
    expect(useSessionStore.getState().providerSwitching).toBe(true);
    expect(useSessionStore.getState().providerSwitchTimeoutId).toBe(timeoutId);

    vi.advanceTimersByTime(5_000);

    const state = useSessionStore.getState();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).toBe("Provider switch timed out. Please retry.");
  });

  it("welcome with no valid provider descriptors clears stale providers and selection", () => {
    useSessionStore.setState({
      providers: [
        {
          id: "opencode-go",
          label: "OpenCode Go",
          group: "subscription",
          free: true,
          available: true,
          models: ["minimax-m2.5"],
        },
        {
          id: "opencode-zen",
          label: "OpenCode Zen",
          group: "direct-api",
          free: false,
          available: true,
          models: ["anthropic/claude-sonnet-4-6"],
        },
      ],
      activeProvider: "opencode-go",
      activeModel: "minimax-m2.5",
    });

    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [{ id: "broken-provider" } as never],
      models: {},
      executionMode: "execute",
    });

    const state = useSessionStore.getState();
    expect(state.providers).toEqual([]);
    expect(state.activeProvider).toBeNull();
    expect(state.activeModel).toBeNull();
  });

  it("welcome with only unknown provider descriptors preserves runtime providers and clears stale selection", () => {
    useSessionStore.setState({
      providers: [
        {
          id: "opencode-go",
          label: "OpenCode Go",
          group: "subscription",
          free: true,
          available: true,
          models: ["minimax-m2.5"],
        },
        {
          id: "opencode-zen",
          label: "OpenCode Zen",
          group: "direct-api",
          free: false,
          available: true,
          models: ["anthropic/claude-sonnet-4-6"],
        },
      ],
      activeProvider: "opencode-go",
      activeModel: "minimax-m2.5",
    });

    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "unknown-provider",
          label: "Unknown Provider",
          group: "direct-api",
          free: false,
          available: true,
          models: ["mystery-1"],
        },
      ],
      models: {
        "unknown-provider": ["mystery-1"],
      },
      executionMode: "execute",
    });

    const state = useSessionStore.getState();
    expect(state.providers).toEqual([
      expect.objectContaining({
        id: "unknown-provider",
        available: true,
        models: ["mystery-1"],
      }),
    ]);
    expect(state.activeProvider).toBeNull();
    expect(state.activeModel).toBeNull();
  });

  it("welcome canonicalizes duplicate provider ids before provider switching validation", () => {
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    useSessionStore.getState().onWelcome({
      type: "welcome",
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: false,
          models: [],
        },
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: true,
          models: ["gpt-5"],
        },
      ],
      activeProvider: "openai",
      activeModel: "gpt-5",
      executionMode: "execute",
    });

    const state = useSessionStore.getState();
    expect(state.providers).toEqual([
      expect.objectContaining({
        id: "openai",
        available: true,
        models: ["gpt-5"],
      }),
    ]);
    expect(state.activeProvider).toBe("openai");
    expect(state.activeModel).toBe("gpt-5");

    const accepted = useSessionStore.getState().switchProvider("openai", "gpt-5");

    expect(accepted).toBe(true);
    expect(send).toHaveBeenCalledWith({
      type: "provider",
      provider: "openai",
      model: "gpt-5",
      requestId: expect.any(String),
    });
  });

  it("provider_changed without matching requestId rejects a same-provider retry", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    advertiseOpenAiModel();

    expect(useSessionStore.getState().switchProvider("openai", "gpt-5")).toBe(true);
    const firstRequestId = lastProviderRequestId(send);
    vi.advanceTimersByTime(5_000);
    expect(useSessionStore.getState().providerSwitching).toBe(false);

    expect(useSessionStore.getState().switchProvider("openai", "gpt-5")).toBe(true);
    const secondTimeoutId = useSessionStore.getState().providerSwitchTimeoutId;

    useSessionStore.getState().onProviderChanged({
      type: "provider_changed",
      provider: "openai",
      model: "gpt-5",
      requestId: firstRequestId,
    });

    const state = useSessionStore.getState();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).toBe("Provider switch acknowledgement did not match the pending request.");
    expect(state.activeProvider).toBeNull();
    expect(secondTimeoutId).not.toBeNull();
  });

  it("welcome without providers does not synthesize provider availability from models and clears stale selection", () => {
    useSessionStore.setState({
      providers: [
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: false,
          models: [],
        },
      ],
      activeProvider: "codex",
      activeModel: "gpt-5.4",
    });

    useSessionStore.getState().onWelcome({
      type: "welcome",
      models: {
        claude: ["claude-sonnet-4-6"],
      },
      executionMode: "execute",
    });

    expect(useSessionStore.getState().providers).toEqual([]);
    expect(useSessionStore.getState().activeProvider).toBeNull();
    expect(useSessionStore.getState().activeModel).toBeNull();
  });

  it("provider switch timeout sets error banner and clears switching state", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    advertiseOpenAiModel();

    useSessionStore.getState().switchProvider("openai", "gpt-5");
    vi.advanceTimersByTime(5_000);

    const state = useSessionStore.getState();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).toBe("Provider switch timed out. Please retry.");
  });

  it("runtime error clears pending provider switch timeout without overwriting the runtime banner", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    advertiseOpenAiModel();

    const accepted = useSessionStore.getState().switchProvider("openai", "gpt-5");

    expect(accepted).toBe(true);
    expect(useSessionStore.getState().providerSwitching).toBe(true);
    expect(useSessionStore.getState().providerSwitchTimeoutId).not.toBeNull();

    useSessionStore.getState().onError({
      type: "error",
      message: "Runtime provider failure",
    });

    let state = useSessionStore.getState();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).toBe("Runtime provider failure");

    vi.advanceTimersByTime(5_000);

    state = useSessionStore.getState();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).toBe("Runtime provider failure");
  });

  it("cleared resets a pending provider switch and prevents the timeout banner from surfacing later", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    useSessionStore.getState().setSender(send);
    advertiseOpenAiModel();

    const accepted = useSessionStore.getState().switchProvider("openai", "gpt-5");

    expect(accepted).toBe(true);
    expect(useSessionStore.getState().providerSwitching).toBe(true);
    expect(useSessionStore.getState().providerSwitchTimeoutId).not.toBeNull();

    useSessionStore.getState().onCleared();

    let state = useSessionStore.getState();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).toBeNull();

    vi.advanceTimersByTime(5_000);

    state = useSessionStore.getState();
    expect(state.providerSwitching).toBe(false);
    expect(state.providerSwitchTimeoutId).toBeNull();
    expect(state.errorBanner).not.toBe("Provider switch timed out. Please retry.");
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
      routingRationale: {
        selectedProvider: "claude",
        selectedModel: "claude-sonnet-4-6",
        selectionMode: "auto",
        routingReason: "Rule matched",
        confidence: 1,
        routingTier: "rule",
        inputsUsed: {
          tenantId: "default",
          complexityClass: "simple",
          complexityScore: 0.2,
          hasTools: false,
          toolCount: 0,
          requiresStreaming: false,
        },
        rankingEvidence: [],
        diagnostics: [],
      },
    });

    const state = useSessionStore.getState();
    expect(state.messages[0]?.role).toBe("assistant");
    expect(state.messages[0]?.routedProvider).toBe("claude");
    expect(state.messages[0]?.routedModel).toBe("claude-sonnet-4-6");
    expect(state.messages[0]?.routingRationale).toMatchObject({
      selectedProvider: "claude",
      selectedModel: "claude-sonnet-4-6",
      selectionMode: "auto",
      routingReason: "Rule matched",
    });
    expect(state.timelineEntries.at(-1)).toMatchObject({
      type: "event",
      eventKind: "turn_completed",
      details: {
        routingRationale: {
          selectionMode: "auto",
          routingReason: "Rule matched",
        },
      },
    });
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
      executionMode: "execute",
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
      executionMode: "execute",
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
