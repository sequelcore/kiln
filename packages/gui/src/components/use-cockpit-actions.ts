import type {
  GuiOutboundFrame,
  OperatorCockpitActionTarget,
  OperatorWorkspaceGatewayTargetSummary,
} from "@kilnai/gateway-contracts";
import type { GuiGatewayClient } from "../api/client.js";

interface CockpitActionsInput {
  readonly gatewayClient: GuiGatewayClient;
  readonly selectedGatewayTarget: OperatorWorkspaceGatewayTargetSummary | null;
  readonly selectedSessionId: string | null;
  readonly sendFrame: (() => ((frame: GuiOutboundFrame) => void) | null);
  readonly onError: (message: string) => void;
}

export function createResourceTarget(
  input: Pick<CockpitActionsInput, "selectedGatewayTarget" | "selectedSessionId">,
  uri: string,
  target?: OperatorCockpitActionTarget,
): OperatorCockpitActionTarget {
  return {
    ...(input.selectedGatewayTarget ? {
      gatewayTargetId: input.selectedGatewayTarget.gatewayTarget.targetId,
      instanceId: input.selectedGatewayTarget.instanceId,
    } : {}),
    ...(input.selectedSessionId ? { sessionId: input.selectedSessionId } : {}),
    ...(target ?? {}),
    resourceUri: target?.resourceUri ?? uri,
  };
}

export function useCockpitActions(input: CockpitActionsInput) {
  const resourceTarget = (uri: string, target?: OperatorCockpitActionTarget): OperatorCockpitActionTarget => (
    createResourceTarget(input, uri, target)
  );

  const openResource = async (uri: string, target?: OperatorCockpitActionTarget): Promise<void> => {
    const resourceWindow = window.open("about:blank", "_blank", "noopener,noreferrer");
    if (!resourceWindow) {
      input.onError("Browser blocked the resource window.");
      return;
    }
    try {
      const dataUrl = await input.gatewayClient.loadResourceDataUrl(uri, resourceTarget(uri, target));
      if (!dataUrl) {
        throw new Error("Resource is not available.");
      }
      resourceWindow.location.href = dataUrl;
    } catch (error) {
      resourceWindow.close();
      input.onError(error instanceof Error ? error.message : "Could not open resource.");
    }
  };

  const cancelManagedAgent = (control: {
    readonly sessionId: string;
    readonly invocationId: string;
    readonly gatewayTargetId?: string;
  }): void => {
    const send = input.sendFrame();
    if (!send) {
      input.onError("Managed agent control is unavailable until the gateway connection is open.");
      return;
    }
    send({
      type: "managed_agent_control",
      action: "cancel",
      ...(control.gatewayTargetId ? { gatewayTargetId: control.gatewayTargetId } : {}),
      sessionId: control.sessionId,
      invocationId: control.invocationId,
      reason: "Operator cancelled the managed child from the GUI cockpit.",
    });
  };

  const promptManagedAgent = (control: {
    readonly sessionId: string;
    readonly invocationId: string;
    readonly gatewayTargetId?: string;
    readonly prompt: string;
    readonly deliveryMode: "steer" | "queue";
    readonly wakeRequested: boolean;
  }): void => {
    const send = input.sendFrame();
    if (!send) {
      input.onError("Managed agent control is unavailable until the gateway connection is open.");
      return;
    }
    send({
      type: "managed_agent_control",
      action: "prompt",
      ...(control.gatewayTargetId ? { gatewayTargetId: control.gatewayTargetId } : {}),
      sessionId: control.sessionId,
      invocationId: control.invocationId,
      prompt: control.prompt,
      deliveryMode: control.deliveryMode,
      wakeRequested: control.wakeRequested,
      reason: "Operator sent a managed-child follow-up prompt from the GUI cockpit.",
    });
  };

  return {
    resourceTarget,
    openResource,
    cancelManagedAgent,
    promptManagedAgent,
  };
}
