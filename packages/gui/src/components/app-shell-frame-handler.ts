import type {
  GuiInboundFrame,
  GuiOutboundFrame,
} from "@kilnai/gateway-contracts";
import { isOperatorThemeName, type OperatorThemeName } from "@kilnai/operator-appearance";

type ThemeResultFrame = Extract<GuiOutboundFrame, { type: "operator_theme_set_result" }>;

interface AppShellFrameHandlerInput {
  readonly onWelcome: (frame: Extract<GuiInboundFrame, { type: "welcome" }>) => void;
  readonly onSessionEvent: (event: Extract<GuiInboundFrame, { type: "session_event" }>["event"]) => void;
  readonly onDone: (frame: Extract<GuiInboundFrame, { type: "done" }>) => void;
  readonly onTurnCancelResult: (frame: Extract<GuiInboundFrame, { type: "turn_cancel_result" }>) => void;
  readonly onGoalControlResult: (frame: Extract<GuiInboundFrame, { type: "goal_control_result" }>) => void;
  readonly onApprovalResponseResult: (frame: Extract<GuiInboundFrame, { type: "approval_response_result" }>) => void;
  readonly onVoiceSynthesisCompleted: (frame: Extract<GuiInboundFrame, { type: "voice_synthesis_completed" }>) => void;
  readonly onVoiceSynthesisFailed: (frame: Extract<GuiInboundFrame, { type: "voice_synthesis_failed" }>) => void;
  readonly onError: (frame: Extract<GuiInboundFrame, { type: "error" }>) => void;
  readonly onCleared: () => void;
  readonly onExecutionRouteChanged: (frame: Extract<GuiInboundFrame, { type: "execution_route_changed" }>) => void;
  readonly onExecutionRouteChangeFailed: (frame: Extract<GuiInboundFrame, { type: "execution_route_change_failed" }>) => void;
  readonly onProviderAuthStarted: (frame: Extract<GuiInboundFrame, { type: "provider_auth_started" }>) => void;
  readonly onProviderAuthCompleted: (frame: Extract<GuiInboundFrame, { type: "provider_auth_completed" }>) => void;
  readonly onProviderAuthFailed: (frame: Extract<GuiInboundFrame, { type: "provider_auth_failed" }>) => void;
  readonly onExecutionRoutesRefreshed: (frame: Extract<GuiInboundFrame, { type: "execution_routes_refreshed" }>) => void;
  readonly onExecutionTargetWizardResult: (frame: Extract<GuiInboundFrame, { type: "execution_target_wizard_result" }>) => void;
  readonly onExecConfirmed: () => void;
  readonly onActivityPhase: (frame: Extract<GuiInboundFrame, { type: "activity_phase" }>) => void;
  readonly onInteractiveUseUpdated: (frame: Extract<GuiInboundFrame, { type: "interactive_use_updated" }>) => void;
  readonly onBrowserSessionUpdated: (frame: Extract<GuiInboundFrame, { type: "browser_session_updated" }>) => void;
  readonly onBrowserLiveViewportFrame: (frame: Extract<GuiInboundFrame, { type: "browser_live_viewport_frame" }>) => void;
  readonly setConnectionStatus: (status: "connecting" | "running" | "idle" | "error") => void;
  readonly setTheme: (theme: OperatorThemeName) => void;
  readonly sendThemeResult: (frame: ThemeResultFrame) => void;
  readonly onManagedAgentControlResult: (frame: Extract<GuiInboundFrame, { type: "managed_agent_control_result" }>) => void;
  readonly invalidateMemoryLattice: () => void;
}

async function handleOperatorThemeSet(
  frame: Extract<GuiInboundFrame, { type: "operator_theme_set" }>,
  input: AppShellFrameHandlerInput,
): Promise<void> {
  if (!isOperatorThemeName(frame.theme)) {
    input.sendThemeResult({
      type: "operator_theme_set_result",
      requestId: frame.requestId,
      ok: false,
      error: `Unknown theme '${frame.theme}'.`,
    });
    return;
  }
  input.setTheme(frame.theme);
  input.sendThemeResult({
    type: "operator_theme_set_result",
    requestId: frame.requestId,
    ok: true,
    appliedTheme: frame.theme,
  });
}

export function createAppShellFrameHandler(input: AppShellFrameHandlerInput) {
  return (frame: GuiInboundFrame): void => {
    switch (frame.type) {
      case "welcome":
        input.onWelcome(frame);
        return;
      case "operator_theme_set":
        void handleOperatorThemeSet(frame, input);
        return;
      case "session_event":
        input.onSessionEvent(frame.event);
        return;
      case "done":
        input.onDone(frame);
        return;
      case "turn_cancel_result":
        input.onTurnCancelResult(frame);
        return;
      case "goal_control_result":
        input.onGoalControlResult(frame);
        return;
      case "approval_response_result":
        input.onApprovalResponseResult(frame);
        return;
      case "voice_synthesis_completed":
        input.onVoiceSynthesisCompleted(frame);
        return;
      case "voice_synthesis_failed":
        input.onVoiceSynthesisFailed(frame);
        return;
      case "error":
        input.onError(frame);
        return;
      case "cleared":
        input.onCleared();
        return;
      case "execution_route_changed":
        input.onExecutionRouteChanged(frame);
        return;
      case "execution_route_change_failed":
        input.onExecutionRouteChangeFailed(frame);
        return;
      case "provider_auth_started":
        input.onProviderAuthStarted(frame);
        return;
      case "provider_auth_completed":
        input.onProviderAuthCompleted(frame);
        return;
      case "provider_auth_failed":
        input.onProviderAuthFailed(frame);
        return;
      case "execution_routes_refreshed":
        input.onExecutionRoutesRefreshed(frame);
        return;
      case "execution_target_wizard_result":
        input.onExecutionTargetWizardResult(frame);
        return;
      case "execution_mode_transitioned":
        input.onExecConfirmed();
        return;
      case "thinking":
        input.setConnectionStatus("running");
        return;
      case "activity_phase":
        input.onActivityPhase(frame);
        return;
      case "interactive_use_updated":
        input.onInteractiveUseUpdated(frame);
        return;
      case "browser_session_updated":
        input.onBrowserSessionUpdated(frame);
        return;
      case "browser_live_viewport_frame":
        input.onBrowserLiveViewportFrame(frame);
        return;
      case "managed_agent_control_result":
        input.onManagedAgentControlResult(frame);
        return;
      case "memory_lattice_invalidated":
        input.invalidateMemoryLattice();
        return;
    }
  };
}
