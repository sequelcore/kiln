import { describe, expect, it, vi } from "vitest";
import { createAppShellFrameHandler } from "../src/components/app-shell-frame-handler.js";
import { OPERATOR_THEME_NAMES } from "@kilnai/gateway-contracts";

function createInput(overrides: Partial<Parameters<typeof createAppShellFrameHandler>[0]> = {}) {
  return {
    onWelcome: vi.fn(),
    onSessionEvent: vi.fn(),
    onDone: vi.fn(),
    onTurnCancelResult: vi.fn(),
    onGoalControlResult: vi.fn(),
    onApprovalResponseResult: vi.fn(),
    onVoiceSynthesisCompleted: vi.fn(),
    onVoiceSynthesisFailed: vi.fn(),
    onError: vi.fn(),
    onCleared: vi.fn(),
    onExecutionRouteChanged: vi.fn(),
    onExecutionRouteChangeFailed: vi.fn(),
    onProviderAuthStarted: vi.fn(),
    onProviderAuthCompleted: vi.fn(),
    onProviderAuthFailed: vi.fn(),
    onExecutionRoutesRefreshed: vi.fn(),
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
    persistThemePreference: vi.fn(async () => {}),
    sendThemeResult: vi.fn(),
    onManagedAgentControlResult: vi.fn(),
    invalidateMemoryLattice: vi.fn(),
    ...overrides,
  };
}

describe("createAppShellFrameHandler", () => {
  it("applies valid persisted theme requests and acknowledges them", async () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "operator_theme_set",
      requestId: "theme-1",
      theme: OPERATOR_THEME_NAMES[0],
      scope: "persisted",
    } as never);

    expect(input.persistThemePreference).toHaveBeenCalledWith(OPERATOR_THEME_NAMES[0]);
    await vi.waitFor(() => expect(input.sendThemeResult).toHaveBeenCalledWith({
      type: "operator_theme_set_result",
      requestId: "theme-1",
      ok: true,
      appliedTheme: OPERATOR_THEME_NAMES[0],
    }));
  });

  it("reports persisted theme failures without claiming the theme was applied", async () => {
    const input = createInput({ persistThemePreference: vi.fn(async () => { throw new Error("approval failed"); }) });
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "operator_theme_set",
      requestId: "theme-failed",
      theme: OPERATOR_THEME_NAMES[0],
      scope: "persisted",
    } as never);

    await vi.waitFor(() => expect(input.sendThemeResult).toHaveBeenCalledWith({
      type: "operator_theme_set_result",
      requestId: "theme-failed",
      ok: false,
      error: "approval failed",
    }));
    expect(input.setTheme).not.toHaveBeenCalled();
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

  it("keeps provider authentication separate from execution-route refresh", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "provider_auth_completed",
      provider: "codex-oauth",
    } as never);

    expect(input.onProviderAuthCompleted).toHaveBeenCalledTimes(1);
    expect(input.onExecutionRoutesRefreshed).not.toHaveBeenCalled();
  });

  it("routes managed-agent control results to the cockpit owner", () => {
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

    expect(input.onManagedAgentControlResult).toHaveBeenCalledTimes(2);
    expect(input.onManagedAgentControlResult).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: "failed",
      reason: "Child already exited",
    }));
  });

  it("surfaces rejected goal controls without mutating transcript state", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "goal_control_result",
      requestId: "goal-control-1",
      goalRunId: "goal-1",
      action: "pause",
      status: "failed",
      reason: "Goal is already terminal.",
    });

    expect(input.onGoalControlResult).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      reason: "Goal is already terminal.",
    }));
    expect(input.onSessionEvent).not.toHaveBeenCalled();
  });

  it("routes execution-route and approval failures to their operation owners", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "execution_route_change_failed",
      requestId: "execution-route-change-1",
      routeId: "openai-gpt",
      reason: "The selected route is unavailable.",
    });
    handleFrame({
      type: "approval_response_result",
      requestId: "approval-response-1",
      approvalId: "approval-1",
      decision: "approve",
      status: "failed",
      reason: "Approval is no longer pending.",
    });

    expect(input.onExecutionRouteChangeFailed).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "execution-route-change-1",
    }));
    expect(input.onApprovalResponseResult).toHaveBeenCalledWith(expect.objectContaining({
      approvalId: "approval-1",
      status: "failed",
    }));
    expect(input.onError).not.toHaveBeenCalled();
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
      operatorTerminalAvailable: true,
    } as never);
    const output = { type: "operator_terminal_output", terminalId: "term-1", data: "ready\r\n" } as const;
    handleFrame(output);

    expect(input.onOperatorTerminalAvailability).toHaveBeenCalledWith(true);
    expect(input.onOperatorTerminalFrame).toHaveBeenCalledWith(output);
    expect(input.onSessionEvent).not.toHaveBeenCalled();
  });
});
