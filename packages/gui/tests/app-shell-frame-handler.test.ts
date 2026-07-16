import { describe, expect, it, vi } from "vitest";
import { createAppShellFrameHandler } from "../src/components/app-shell-frame-handler.js";
import type { GuiProviderModelDiscoveryProjection } from "@kilnai/gateway-contracts";

const EMPTY_PROVIDER_MODEL_DISCOVERY: GuiProviderModelDiscoveryProjection = {
  catalogEvidence: {
    status: "failed",
    source: {
      kind: "test",
      id: "app-shell-frame-handler",
    },
    observedAt: "2026-07-01T00:00:00.000Z",
    counts: {
      total: 0,
      returned: 0,
      omitted: 0,
    },
    failure: {
      classification: "catalog-unavailable",
      summary: "No provider model discovery fixture.",
    },
  },
  entries: [],
};

function createInput(overrides: Partial<Parameters<typeof createAppShellFrameHandler>[0]> = {}) {
  return {
    onWelcome: vi.fn(),
    onSessionEvent: vi.fn(),
    onDone: vi.fn(),
    onVoiceSynthesisCompleted: vi.fn(),
    onVoiceSynthesisFailed: vi.fn(),
    onError: vi.fn(),
    onCleared: vi.fn(),
    onProviderChanged: vi.fn(),
    onProviderAuthStarted: vi.fn(),
    onProviderAuthCompleted: vi.fn(),
    onProviderAuthFailed: vi.fn(),
    onProvidersRefreshed: vi.fn(),
    onExecConfirmed: vi.fn(),
    onActivityPhase: vi.fn(),
    onInteractiveUseUpdated: vi.fn(),
    onBrowserSessionUpdated: vi.fn(),
    onBrowserLiveViewportFrame: vi.fn(),
    onBrowserOperatorInputAck: vi.fn(),
    onOperatorTerminalAvailability: vi.fn(),
    onOperatorTerminalFrame: vi.fn(),
    setConnectionStatus: vi.fn(),
    setTheme: vi.fn(),
    persistThemePreference: vi.fn(),
    sendThemeResult: vi.fn(),
    getProviders: vi.fn(() => [{ id: "codex", models: ["gpt"], available: true }]),
    refetchDashboard: vi.fn(),
    setErrorBanner: vi.fn(),
    clearErrorBanner: vi.fn(),
    invalidateMemoryLattice: vi.fn(),
    ...overrides,
  };
}

describe("createAppShellFrameHandler", () => {
  it("applies valid persisted theme requests and acknowledges them", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "operator_theme_set",
      requestId: "theme-1",
      theme: "kiln-light",
      scope: "persisted",
    } as never);

    expect(input.setTheme).toHaveBeenCalledWith("kiln-light");
    expect(input.persistThemePreference).toHaveBeenCalledWith("kiln-light");
    expect(input.sendThemeResult).toHaveBeenCalledWith({
      type: "operator_theme_set_result",
      requestId: "theme-1",
      ok: true,
      appliedTheme: "kiln-light",
    });
  });

  it("rejects unknown theme requests without changing the active theme", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "operator_theme_set",
      requestId: "theme-1",
      theme: "neon",
      scope: "session",
    } as never);

    expect(input.setTheme).not.toHaveBeenCalled();
    expect(input.sendThemeResult).toHaveBeenCalledWith({
      type: "operator_theme_set_result",
      requestId: "theme-1",
      ok: false,
      error: "Unknown theme 'neon'.",
    });
  });

  it("refreshes provider discovery after provider auth completion", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "provider_auth_completed",
      provider: "codex",
      providers: undefined,
      providerDiscovery: [{ provider: "codex" }],
      providerModelDiscovery: EMPTY_PROVIDER_MODEL_DISCOVERY,
    } as never);

    expect(input.onProviderAuthCompleted).toHaveBeenCalledTimes(1);
    expect(input.onProvidersRefreshed).toHaveBeenCalledWith(
      [{ id: "codex", models: ["gpt"], available: true }],
      [{ provider: "codex" }],
      EMPTY_PROVIDER_MODEL_DISCOVERY,
    );
    expect(input.refetchDashboard).toHaveBeenCalledTimes(1);
  });

  it("maps managed-agent control failures to the error banner and clears successful results", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "managed_agent_control_result",
      status: "failed",
      action: "cancel",
      invocationId: "child-1",
      reason: "Child already exited",
    } as never);
    handleFrame({
      type: "managed_agent_control_result",
      status: "accepted",
      action: "prompt",
      invocationId: "child-1",
    } as never);

    expect(input.setErrorBanner).toHaveBeenCalledWith("Child already exited");
    expect(input.clearErrorBanner).toHaveBeenCalledTimes(1);
  });

  it("routes memory invalidation and thinking frames to their focused state updates", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({ type: "thinking" } as never);
    handleFrame({ type: "memory_lattice_invalidated" } as never);

    expect(input.setConnectionStatus).toHaveBeenCalledWith("running");
    expect(input.invalidateMemoryLattice).toHaveBeenCalledTimes(1);
  });

  it("projects terminal availability and routes terminal frames outside the transcript", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);
    handleFrame({
      type: "welcome",
      providerModelDiscovery: EMPTY_PROVIDER_MODEL_DISCOVERY,
      operatorTerminalAvailable: true,
    } as never);
    const output = { type: "operator_terminal_output", terminalId: "term-1", data: "ready\r\n" } as const;
    handleFrame(output);

    expect(input.onOperatorTerminalAvailability).toHaveBeenCalledWith(true);
    expect(input.onOperatorTerminalFrame).toHaveBeenCalledWith(output);
    expect(input.onSessionEvent).not.toHaveBeenCalled();
  });
});
