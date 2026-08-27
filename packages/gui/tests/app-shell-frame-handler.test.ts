import { describe, expect, it, vi } from "vitest";
import { createAppShellFrameHandler } from "../src/components/app-shell-frame-handler.js";
import { OPERATOR_THEME_NAMES } from "@kilnai/operator-appearance";

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
    onExecutionTargetChanged: vi.fn(),
    onExecutionTargetChangeFailed: vi.fn(),
    onProviderAuthStarted: vi.fn(),
    onProviderAuthCompleted: vi.fn(),
    onProviderAuthFailed: vi.fn(),
    onProviderCatalogState: vi.fn(),
    onModelCatalogRefreshed: vi.fn(),
    onModelCatalogRefreshFailed: vi.fn(),
    onExecutionTargetWizardResult: vi.fn(),
    onExecConfirmed: vi.fn(),
    onActivityPhase: vi.fn(),
    onInteractiveUseUpdated: vi.fn(),
    onBrowserSessionUpdated: vi.fn(),
    onBrowserLiveViewportFrame: vi.fn(),
    setConnectionStatus: vi.fn(),
    setTheme: vi.fn(),
    sendThemeResult: vi.fn(),
    onManagedAgentControlResult: vi.fn(),
    invalidateMemoryLattice: vi.fn(),
    ...overrides,
  };
}

describe("createAppShellFrameHandler", () => {
  it("applies valid session theme requests and acknowledges them", async () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "operator_theme_set",
      requestId: "theme-1",
      theme: OPERATOR_THEME_NAMES[0],
    } as never);

    expect(input.setTheme).toHaveBeenCalledWith(OPERATOR_THEME_NAMES[0]);
    await vi.waitFor(() => expect(input.sendThemeResult).toHaveBeenCalledWith({
      type: "operator_theme_set_result",
      requestId: "theme-1",
      ok: true,
      appliedTheme: OPERATOR_THEME_NAMES[0],
    }));
  });

  it("rejects unknown theme requests without changing the active theme", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "operator_theme_set",
      requestId: "theme-1",
      theme: "neon",
    } as never);

    expect(input.setTheme).not.toHaveBeenCalled();
    expect(input.sendThemeResult).toHaveBeenCalledWith({
      type: "operator_theme_set_result",
      requestId: "theme-1",
      ok: false,
      error: "Unknown theme 'neon'.",
    });
  });

  it("keeps provider authentication separate from model-catalog refresh", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "provider_auth_completed",
      provider: "codex-oauth",
    } as never);

    expect(input.onProviderAuthCompleted).toHaveBeenCalledTimes(1);
    expect(input.onModelCatalogRefreshed).not.toHaveBeenCalled();
  });

  it("routes provider catalog lifecycle frames to the catalog owner", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({ type: "provider_catalog_state", status: "pending" });

    expect(input.onProviderCatalogState).toHaveBeenCalledWith({
      type: "provider_catalog_state",
      status: "pending",
    });
  });

  it("routes model-catalog refresh failures to the refresh lifecycle owner", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "model_catalog_refresh_failed",
      requestId: "refresh-1",
      message: "Provider discovery timed out.",
    });

    expect(input.onModelCatalogRefreshFailed).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "refresh-1",
    }));
    expect(input.onError).not.toHaveBeenCalled();
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

  it("routes execution-target and approval failures to their operation owners", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({
      type: "execution_target_change_failed",
      requestId: "execution-target-change-1",
      targetId: "openai-gpt",
      reasonCode: "target-health-unavailable",
      reason: "The selected target is unavailable.",
      repairActions: ["refresh-model-catalog"],
    });
    handleFrame({
      type: "approval_response_result",
      requestId: "approval-response-1",
      approvalId: "approval-1",
      decision: "approve",
      status: "failed",
      reason: "Approval is no longer pending.",
    });

    expect(input.onExecutionTargetChangeFailed).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "execution-target-change-1",
    }));
    expect(input.onApprovalResponseResult).toHaveBeenCalledWith(expect.objectContaining({
      approvalId: "approval-1",
      status: "failed",
    }));
    expect(input.onError).not.toHaveBeenCalled();
  });

  it("routes target wizard results to their lifecycle owner", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);
    handleFrame({
      type: "execution_target_wizard_result",
      requestId: "target-wizard-1",
      status: "rejected",
      code: "TARGET_DISCOVERY_STALE",
      action: "refresh-and-retry",
      message: "Refresh current discovery evidence.",
    });
    expect(input.onExecutionTargetWizardResult).toHaveBeenCalledWith(expect.objectContaining({ requestId: "target-wizard-1" }));
  });

  it("routes memory invalidation and thinking frames to their focused state updates", () => {
    const input = createInput();
    const handleFrame = createAppShellFrameHandler(input);

    handleFrame({ type: "thinking" } as never);
    handleFrame({ type: "memory_lattice_invalidated" } as never);

    expect(input.setConnectionStatus).toHaveBeenCalledWith("running");
    expect(input.invalidateMemoryLattice).toHaveBeenCalledTimes(1);
  });

});
