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
  GuiMemoryLatticeInvalidatedFrame,
  GuiOutboundFrame,
  GuiInboundFrame,
  GuiSessionConnectionState,
  OperatorThemeScope,
  OperatorThemeSetFrame,
  OperatorThemeSetResultFrame,
} from "./frames.js";

export type {
  ConversationProjectionActivityInput,
  ConversationProjectionEventInput,
  ConversationProjectionInput,
  ConversationProjectionItem,
  ConversationProjectionMessageInput,
  ConversationProjectionRole,
  ConversationTurnProjectionOptions,
} from "./conversation-turn-projection.js";
export {
  operatorEventAnchorsAssistantTurn,
  projectConversationTurnItems,
} from "./conversation-turn-projection.js";

export type {
  GuiMemoryLatticeError,
  GuiMemoryLatticeGraphEdge,
  GuiMemoryLatticeGraphFilters,
  GuiMemoryLatticeGraphNode,
  GuiMemoryLatticeGraphRequest,
  GuiMemoryLatticeGraphResponse,
  GuiMemoryLatticeGraphSnapshot,
  GuiMemoryLatticeLayerKind,
  GuiMemoryLatticeRelationType,
  GuiMemoryLatticeScope,
  GuiMemoryLatticeScopeKind,
} from "./memory-lattice.js";
export {
  GUI_MEMORY_LATTICE_LAYER_KINDS,
  GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH,
  GUI_MEMORY_LATTICE_RELATION_TYPES,
  GUI_MEMORY_LATTICE_SCOPE_KINDS,
  GuiMemoryLatticeErrorSchema,
  GuiMemoryLatticeGraphEdgeSchema,
  GuiMemoryLatticeGraphFiltersSchema,
  GuiMemoryLatticeGraphNodeSchema,
  GuiMemoryLatticeGraphRequestSchema,
  GuiMemoryLatticeGraphResponseSchema,
  GuiMemoryLatticeGraphSnapshotSchema,
  GuiMemoryLatticeScopeSchema,
} from "./memory-lattice.js";

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
  operatorEventTargetsSurface,
  presentOperatorEventPayload,
  presentOperatorSessionEvent,
} from "./operator-event-presentation.js";
export type {
  OperatorEventDetailItem,
  OperatorEventPresentation,
  OperatorEventSurface,
  OperatorEventTone,
  ToolResultOutputKind,
  ToolResultPresentation,
  ToolResultPreview,
  ToolResultRawAvailability,
  ToolResultResourceLinkPresentation,
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
