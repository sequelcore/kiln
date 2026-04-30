export type {
  GuiProviderDescriptor,
  GuiProviderDiscoveryResult,
  GuiProviderModelCapabilities,
  GuiProviderReasoningEffort,
  GuiProviderDiscoveryStatus,
  GuiProviderAuthState,
  GuiProviderCatalogStatus,
  GuiProviderAuthMethod,
  GuiProviderAuthDeviceCodeStarted,
  GuiProviderAuthCompleted,
  GuiProviderAuthFailed,
  GuiSessionSummary,
  GuiSessionListResponse,
  GuiTelemetrySnapshot,
  GuiAppDescriptor,
  GuiAppTenantDescriptor,
  GuiResumeInfo,
  GuiProviderThreadMeta,
  GuiDashboardSnapshot,
  GuiSessionMeta,
  OperatorSessionEventKind,
  OperatorSessionEventSource,
  OperatorSessionEvent,
  GuiSessionEventKind,
  GuiSessionEventSource,
  GuiSessionEvent,
  GuiSessionDetail,
  OperatorActivityPhase,
  OperatorActivityPhaseFrame,
  GuiOutboundFrame,
  GuiInboundFrame,
  GuiSessionConnectionState,
  OperatorThemeScope,
  OperatorThemeSetFrame,
  OperatorThemeSetResultFrame,
} from "./frames.js";

export type {
  OperatorWorkspaceDirectorySnapshot,
  OperatorWorkspaceEntryKind,
  OperatorWorkspaceError,
  OperatorWorkspaceErrorCode,
  OperatorWorkspaceExplorer,
  OperatorWorkspaceFileSnapshot,
  OperatorWorkspacePreviewKind,
  OperatorWorkspaceTreeEntry,
  OperatorWorkspaceVcsState,
  OperatorWorkspaceVcsStatus,
} from "./workspace.js";

export {
  OPERATOR_EMPTY_STATE_PHRASES,
  operatorEmptyStatePhraseAt,
} from "./operator-empty-state.js";
export type {
  OperatorEmptyStatePhrase,
} from "./operator-empty-state.js";

export {
  formatOperatorEventValue,
  presentOperatorEventPayload,
  presentOperatorSessionEvent,
} from "./operator-event-presentation.js";
export type {
  OperatorEventDetailItem,
  OperatorEventPresentation,
  OperatorEventTone,
} from "./operator-event-presentation.js";

export {
  OPERATOR_THEME_LABELS,
  OPERATOR_THEME_NAMES,
  OPERATOR_THEME_PALETTES,
  isDarkOperatorTheme,
  isOperatorThemeName,
  resolveOperatorThemePalette,
} from "./operator-themes.js";
export type {
  ConcreteOperatorThemeName,
  OperatorThemeName,
  OperatorThemePalette,
} from "./operator-themes.js";

export {
  GUI_PROVIDER_DISPLAY_ORDER,
  GUI_PROVIDER_METADATA,
  getGuiProviderMetadata,
  isGuiProviderModeless,
} from "./provider-metadata.js";
export type {
  GuiProviderGroup,
  GuiProviderMetadata,
} from "./provider-metadata.js";
