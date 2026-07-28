export { KilnProvider } from "./provider.js";
/** @internal Exposes raw ApiClient -- intended for dev tooling (e.g. Studio), not public consumers. */
export { useKilnContext } from "./provider.js";
export type { KilnProviderProps } from "./provider.js";

export { useApproval } from "./use-approval.js";
export type { UseApprovalReturn } from "./use-approval.js";
export { useKilnChat } from "./use-kiln-chat.js";
export { useKilnWsChat } from "./use-kiln-ws-chat.js";
export { useKilnEvents } from "./use-kiln-events.js";
export { useKilnState } from "./use-kiln-state.js";

export { ApiClient } from "./api-client.js";
export { SseClient } from "./sse-client.js";
export type { SseCallbacks } from "./sse-client.js";

export type {
  KilnConfig,
  ChatMessage,
  ChatOptions,
  ChatSendOptions,
  UseChatReturn,
  UseEventsReturn,
  UseStateReturn,
  KilnEventData,
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnConfigStatusSnapshot,
  InspectableWorkItemResource,
  InspectableWorkItemSnapshotResource,
  OperatorManagedAgentCapabilitySnapshot,
  OperatorManagedAgentInvocationEventPayload,
  OperatorTurnRequestedAuthority,
  OperatorSessionEvent,
  VisitorInfo,
  WsChatRequest,
  WsChatFrame,
} from "./types.js";

export {
  createOperatorCockpitReadOnlyViewState,
  createOperatorWorkspaceHomeProjection,
  KilnConfigSetupSnapshotSchema,
  normalizeManagedAgentOperatorReplayEvents,
  projectOperatorCockpitReadOnlyView,
  projectOperatorGovernedWorkItemSnapshot,
  projectOperatorGovernedWorkItems,
  VerifiedEfficiencyEvidenceProjectionSchema,
  formatVerifiedEfficiencyEvidence,
} from "@kilnai/gateway-contracts";

export type {
  OperatorCockpitExternalToolFailureProjection,
  OperatorCockpitInvocationProjection,
  OperatorCockpitManagedAgentViewItem,
  OperatorCockpitReadOnlyProjection,
  OperatorCockpitReadOnlyViewState,
  OperatorGovernedWorkItemProjection,
  OperatorWorkspaceHomeProjection,
  OperatorResourceReadRequest,
  OperatorResourceReadResult,
  OperatorResourceReadContent,
  OperatorResourceReadSummary,
  OperatorResourceReadPresentation,
  VerifiedEfficiencyEvidenceProjection,
} from "@kilnai/gateway-contracts";

export type {
  AuthorityStateRecord,
  AuthorityStateSnapshot,
  EffectiveTurnAuthoritySnapshot,
  GoalRunSnapshot,
  PlanStateSnapshot,
  ToolResourceContent,
  ToolResourceDescriptor,
  ToolResourceDisplayDescriptor,
  ToolResourceListOptions,
  ToolResourcePage,
  ToolResourceReadResult,
  ToolResourceTemplateDescriptor,
  WorkItemSnapshot,
} from "@kilnai/core";
