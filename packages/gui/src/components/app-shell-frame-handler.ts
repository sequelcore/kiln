import {
  isOperatorThemeName,
  type GuiInboundFrame,
  type GuiOutboundFrame,
  type GuiProviderModelDiscoveryProjection,
  type OperatorThemeName,
} from "@kilnai/gateway-contracts";
import type { ProviderDescriptor } from "../lib/session-store.js";

type ThemeResultFrame = Extract<GuiOutboundFrame, { type: "operator_theme_set_result" }>;

interface AppShellFrameHandlerInput {
  readonly onWelcome: (frame: Extract<GuiInboundFrame, { type: "welcome" }>) => void;
  readonly onSessionEvent: (event: Extract<GuiInboundFrame, { type: "session_event" }>["event"]) => void;
  readonly onDone: (frame: Extract<GuiInboundFrame, { type: "done" }>) => void;
  readonly onVoiceSynthesisCompleted: (frame: Extract<GuiInboundFrame, { type: "voice_synthesis_completed" }>) => void;
  readonly onVoiceSynthesisFailed: (frame: Extract<GuiInboundFrame, { type: "voice_synthesis_failed" }>) => void;
  readonly onError: (frame: Extract<GuiInboundFrame, { type: "error" }>) => void;
  readonly onCleared: () => void;
  readonly onProviderChanged: (frame: Extract<GuiInboundFrame, { type: "provider_changed" }>) => void;
  readonly onProviderAuthStarted: (frame: Extract<GuiInboundFrame, { type: "provider_auth_started" }>) => void;
  readonly onProviderAuthCompleted: (frame: Extract<GuiInboundFrame, { type: "provider_auth_completed" }>) => void;
  readonly onProviderAuthFailed: (frame: Extract<GuiInboundFrame, { type: "provider_auth_failed" }>) => void;
  readonly onProvidersRefreshed: (
    providers: readonly ProviderDescriptor[],
    providerDiscovery?: Extract<GuiInboundFrame, { type: "providers_refreshed" }>["providerDiscovery"],
    providerModelDiscovery?: GuiProviderModelDiscoveryProjection,
  ) => void;
  readonly onExecConfirmed: () => void;
  readonly onActivityPhase: (frame: Extract<GuiInboundFrame, { type: "activity_phase" }>) => void;
  readonly onInteractiveUseUpdated: (frame: Extract<GuiInboundFrame, { type: "interactive_use_updated" }>) => void;
  readonly onBrowserSessionUpdated: (frame: Extract<GuiInboundFrame, { type: "browser_session_updated" }>) => void;
  readonly onBrowserLiveViewportFrame: (frame: Extract<GuiInboundFrame, { type: "browser_live_viewport_frame" }>) => void;
  readonly onBrowserOperatorInputAck: (frame: Extract<GuiInboundFrame, { type: "browser_operator_input_ack" }>) => void;
  readonly setConnectionStatus: (status: "connecting" | "running" | "idle" | "error") => void;
  readonly setTheme: (theme: OperatorThemeName) => void;
  readonly persistThemePreference: (theme: OperatorThemeName) => void;
  readonly sendThemeResult: (frame: ThemeResultFrame) => void;
  readonly getProviders: () => readonly ProviderDescriptor[];
  readonly refetchDashboard: () => void;
  readonly setErrorBanner: (message: string) => void;
  readonly clearErrorBanner: () => void;
  readonly invalidateMemoryLattice: () => void;
}

function handleOperatorThemeSet(
  frame: Extract<GuiInboundFrame, { type: "operator_theme_set" }>,
  input: AppShellFrameHandlerInput,
): void {
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
  if (frame.scope === "persisted") {
    input.persistThemePreference(frame.theme);
  }
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
        handleOperatorThemeSet(frame, input);
        return;
      case "session_event":
        input.onSessionEvent(frame.event);
        return;
      case "done":
        input.onDone(frame);
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
      case "provider_changed":
        input.onProviderChanged(frame);
        return;
      case "provider_auth_started":
        input.onProviderAuthStarted(frame);
        return;
      case "provider_auth_completed":
        input.onProviderAuthCompleted(frame);
        input.onProvidersRefreshed(
          frame.providers ?? input.getProviders(),
          frame.providerDiscovery,
          frame.providerModelDiscovery,
        );
        input.refetchDashboard();
        return;
      case "provider_auth_failed":
        input.onProviderAuthFailed(frame);
        return;
      case "providers_refreshed":
        input.onProvidersRefreshed(
          frame.providers ?? input.getProviders(),
          frame.providerDiscovery,
          frame.providerModelDiscovery,
        );
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
      case "browser_operator_input_ack":
        input.onBrowserOperatorInputAck(frame);
        return;
      case "managed_agent_control_result":
        if (frame.status === "failed") {
          input.setErrorBanner(frame.reason ?? `Managed agent ${frame.action} failed for ${frame.invocationId}.`);
        } else {
          input.clearErrorBanner();
        }
        return;
      case "memory_lattice_invalidated":
        input.invalidateMemoryLattice();
        return;
    }
  };
}
