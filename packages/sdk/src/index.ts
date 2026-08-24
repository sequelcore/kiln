export { KilnProvider } from "./provider.js";
export { useKilnContext } from "./provider.js";
export type { KilnProviderProps } from "./provider.js";

export { useKilnChat } from "./use-kiln-chat.js";
export { useKilnWsChat } from "./use-kiln-ws-chat.js";

export { ApiClient } from "./api-client.js";
export type { ApiClientOptions } from "./api-client.js";

export type {
  KilnConfig,
  ChatMessage,
  ChatOptions,
  ChatSendOptions,
  UseChatReturn,
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnSkillCatalogDiagnosticsSnapshot,
  KilnConfigStatusSnapshot,
  KilnEffectiveConfigFieldSnapshot,
  KilnEffectiveConfigSnapshot,
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
  KILN_EFFECTIVE_CONFIG_SCHEMA_REVISION,
  KilnConfigSetupSnapshotSchema,
  KilnSkillCatalogDiagnosticsSnapshotSchema,
  KilnEffectiveConfigSnapshotSchema,
  normalizeManagedAgentOperatorReplayEvents,
  projectOperatorCockpitReadOnlyView,
  projectOperatorGovernedWorkItemSnapshot,
  projectOperatorGovernedWorkItems,
  VerifiedEfficiencyEvidenceProjectionSchema,
  formatVerifiedEfficiencyEvidence,
} from "@kilnai/gateway-contracts";

export type {
  OperatorCockpitExternalToolFailureProjection,
  OperatorCockpitEconomicAttemptProjection,
  OperatorCockpitEvidenceRejection,
  OperatorCockpitInvocationAccountLeaseProjection,
  OperatorCockpitInvocationProjection,
  OperatorCockpitManagedAgentViewItem,
  OperatorCockpitReadOnlyProjection,
  OperatorCockpitReadOnlyViewState,
  OperatorGovernedWorkItemProjection,
  OperatorWorkspaceHomeProjection,
  KilnSettingsApplyRequest,
  KilnSettingsMutationResult,
  KilnSettingsProposalProjection,
  KilnSettingsProposalRequest,
  KilnSettingsSnapshot,
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
