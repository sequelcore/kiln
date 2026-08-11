import type {
  GuiDeliberationIntent,
  GuiDeliberationLevelId,
  OperatorGoalMaterializationRequirement,
  OperatorTurnRequestedAuthority,
} from "@kilnai/gateway-contracts";

export interface ComposerTurnOptions {
  readonly deliberationIntent?: GuiDeliberationIntent;
  readonly requestedAuthority: OperatorTurnRequestedAuthority;
  readonly governedWorkRequirement?: OperatorGoalMaterializationRequirement;
  readonly gatewayTargetId?: string;
  readonly appName?: string;
  readonly tenantId?: string;
}

export function buildComposerTurnOptions(input: {
  readonly selectedDeliberationLevel: GuiDeliberationLevelId | null;
  readonly requestedAuthority: OperatorTurnRequestedAuthority;
  readonly governedWorkItemCount: number | null;
  readonly gatewayTargetId?: string;
  readonly appName?: string;
  readonly tenantId?: string;
}): ComposerTurnOptions {
  return {
    ...(input.selectedDeliberationLevel ? {
      deliberationIntent: {
        mode: "fixed",
        preferredLevel: input.selectedDeliberationLevel,
        onUnsupported: "deny",
      },
    } : {}),
    requestedAuthority: input.requestedAuthority,
    ...(input.governedWorkItemCount !== null ? {
      governedWorkRequirement: {
        kind: "goal_materialization",
        requiredWorkItemCount: input.governedWorkItemCount,
      },
    } : {}),
    ...(input.gatewayTargetId ? { gatewayTargetId: input.gatewayTargetId } : {}),
    ...(input.appName ? { appName: input.appName } : {}),
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
  };
}
