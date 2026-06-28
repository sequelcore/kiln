export type {
  KilnConfigAppliedWrite,
  KilnConfigApplyResult,
  KilnConfigChangeApproval,
  KilnConfigChangeOperation,
  KilnConfigChangeProposal,
  KilnConfigChangeApprovalSurface,
  KilnConfigProjectionEffectResult,
  KilnConfigValidationDiagnostic,
} from "./config-mutation.js";
export {
  KILN_CONFIG_CHANGE_OPERATIONS,
} from "./config-mutation.js";

export type {
  OperatorCommandDefinition,
  OperatorCommandId,
  OperatorCommandSurfaceKind,
} from "./operator-commands.js";
export {
  OPERATOR_COMMANDS,
  findOperatorCommand,
  listOperatorCommands,
} from "./operator-commands.js";

export type {
  OperatorResourceContentKind,
  OperatorResourceProviderReadResult,
  OperatorResourceReadPresentation,
  OperatorResourceReadPresentationList,
  OperatorResourceReadPresentationMeta,
  OperatorResourceReadPresentationRow,
  OperatorResourceReadContent,
  OperatorResourceReadRequest,
  OperatorResourceReadResult,
  OperatorResourceReadSummary,
} from "./resource-inspector.js";
export {
  OPERATOR_RESOURCE_CONTENT_KINDS,
  OperatorResourceReadContentSchema,
  OperatorResourceReadRequestSchema,
  OperatorResourceReadResultSchema,
  OperatorResourceReadSummarySchema,
  projectOperatorResourceReadPresentation,
  projectOperatorResourceReadResult,
} from "./resource-inspector.js";

export type {
  KilnConfigProjectSnapshot,
  KilnConfigReadResult,
  KilnConfigReadView,
  KilnConfigSetupAction,
  KilnConfigSetupActionRequest,
  KilnConfigSetupActionResult,
  KilnConfigSetupActionStatus,
  KilnConfigSetupSnapshot,
  KilnConfigSourceSnapshot,
  KilnConfigSourceStatus,
  KilnConfigStatusSnapshot,
  KilnHarnessCapabilitySnapshot,
  KilnProjectionTargetSnapshot,
  KilnProjectionTargetStatus,
  KilnRepoShimProjectionSnapshot,
  KilnSkillAdmissionState,
  KilnSkillCatalogProjectionStatus,
  KilnSkillCatalogSnapshot,
  KilnSkillCatalogSnapshotEntry,
  KilnSkillOriginKind,
  KilnSkillProjectionTargetSnapshot,
} from "./config-status.js";
export {
  KILN_CONFIG_READ_VIEWS,
  KILN_CONFIG_SETUP_ACTION_STATUSES,
  KILN_CONFIG_SETUP_ACTIONS,
  KILN_CONFIG_SOURCE_STATUSES,
  KILN_PROJECTION_TARGET_STATUSES,
  KilnConfigSetupActionRequestSchema,
  KilnConfigSetupActionResultSchema,
  KilnConfigSetupSnapshotSchema,
  KilnConfigSourceSnapshotSchema,
  KilnProjectionTargetSnapshotSchema,
  KilnRepoShimProjectionSnapshotSchema,
  KilnSkillCatalogSnapshotEntrySchema,
  KilnSkillCatalogSnapshotSchema,
  KilnSkillProjectionTargetSnapshotSchema,
} from "./config-status.js";

export type {
  GuiProviderDescriptor,
  GuiProviderDiscoveryResult,
  GuiModelRoutingDiagnostic,
  GuiModelRoutingRationale,
  GuiModelRoutingRankingEvidence,
  GuiProviderModelCapabilities,
  GuiProviderModelRouteHealth,
  GuiProviderReasoningEffort,
  GuiAuthorityCompleteness,
  GuiAuthorityLevel,
  GuiAuthorityPolicyInput,
  GuiAuthoritySandboxProjection,
  GuiAuthorityStatus,
  OperatorExecutionMode,
  OperatorTurnRequestedAuthority,
  GuiProviderDiscoveryStatus,
  GuiProviderAuthState,
  GuiProviderCatalogStatus,
  GuiProviderAuthMethod,
  GuiProviderAuthDeviceCodeStarted,
  GuiProviderAuthCompleted,
  GuiProviderAuthFailed,
  GuiSessionTurnOutcome,
  GuiSessionSummary,
  GuiSessionListResponse,
  GuiTelemetrySnapshot,
  GuiAppDescriptor,
  GuiAppTenantDescriptor,
  GuiContinuationInfo,
  GuiProviderThreadMeta,
  GuiDashboardSnapshot,
  GuiSessionMeta,
  OperatorSessionEventKind,
  OperatorAgentInvocationSessionEventKind,
  OperatorSessionEventSource,
  OperatorManagedAgentProviderRoute,
  OperatorManagedAgentRouteHealthSnapshot,
  OperatorManagedAgentProviderModelProofSnapshot,
  OperatorManagedAgentResourcePlaneSnapshot,
  OperatorManagedAgentResourceLeaseSnapshot,
  OperatorManagedAgentWorktreeReviewSnapshot,
  OperatorManagedAgentChildIdentitySnapshot,
  OperatorManagedAgentCapabilitySnapshot,
  OperatorManagedAgentInvocationEventPayload,
  OperatorManagedAgentInvocationSessionEvent,
  OperatorSessionEvent,
  GuiSessionEventKind,
  GuiSessionEventSource,
  GuiSessionEvent,
  GuiSessionDetail,
  OperatorActivityPhase,
  OperatorActivityPhaseFrame,
  GuiMemoryLatticeInvalidatedFrame,
  GuiInteractiveUseSnapshot,
  GuiInteractiveUseStatus,
  GuiInteractiveUseTarget,
  GuiInteractiveUseUpdatedFrame,
  GuiBrowserSessionCapture,
  GuiBrowserSessionOwnership,
  GuiBrowserSessionState,
  GuiBrowserSessionStream,
  GuiBrowserSessionStreamStatus,
  GuiBrowserSessionUpdatedFrame,
  GuiBrowserSessionViewMode,
  GuiBrowserLiveViewportFormat,
  GuiBrowserLiveViewportFrame,
  GuiBrowserLiveViewportTransport,
  GuiBrowserOperatorInput,
  GuiBrowserOperatorInputAckFrame,
  GuiBrowserOperatorInputAckStatus,
  GuiBrowserOperatorInputFrame,
  GuiBrowserOperatorPointerButton,
  GuiManagedAgentControlAction,
  GuiManagedAgentControlFrame,
  GuiManagedAgentControlResultFrame,
  GuiManagedAgentControlResultStatus,
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
  OperatorCockpitBenchmarkFixture,
  OperatorCockpitBenchmarkFixtureInput,
  OperatorCockpitBenchmarkFixtureSummary,
  OperatorCockpitBenchmarkEvidenceRecommendation,
  OperatorCockpitBenchmarkEvidenceReport,
  OperatorCockpitBenchmarkEvidenceReportInput,
  OperatorCockpitBenchmarkEvidenceStatus,
  OperatorCockpitBenchmarkRunnerAdmission,
  OperatorCockpitBenchmarkRunnerAdmissionFailedThreshold,
  OperatorCockpitBenchmarkRunnerAdmissionInput,
  OperatorCockpitBenchmarkRunnerAdmissionMissingPrerequisite,
  OperatorCockpitBenchmarkRunnerAdmissionPrerequisites,
  OperatorCockpitBenchmarkRunnerOrchestrationPlan,
  OperatorCockpitBenchmarkRunnerOrchestrationPlanBlockedReason,
  OperatorCockpitBenchmarkRunnerOrchestrationPlanInput,
  OperatorCockpitBenchmarkRunnerKind,
  OperatorCockpitBenchmarkSurface,
  OperatorCockpitBenchmarkWorkloadKind,
  OperatorCockpitBrowserRenderingBenchmarkEvidenceReport,
  OperatorCockpitDispatchEvidence,
  OperatorCockpitInteractionLatencyReport,
  OperatorCockpitMemoryReport,
  OperatorCockpitNativeRenderingBenchmarkEvidenceReport,
  OperatorCockpitProjectionBaseline,
  OperatorCockpitProjectionBaselineInput,
  OperatorCockpitProjectionSummary,
  OperatorCockpitReadOnlyProjectionBaseline,
  OperatorCockpitReadOnlyProjectionBaselineInput,
  OperatorCockpitTargetClarityReport,
  OperatorCockpitReadOnlyTimelineSummary,
  OperatorCockpitReadOnlyViewStateBaseline,
  OperatorCockpitReadOnlyViewStateBaselineInput,
} from "./operator-cockpit-benchmark.js";
export {
  createOperatorCockpitBenchmarkFixture,
  createOperatorCockpitBenchmarkRunnerAdmission,
  createOperatorCockpitBenchmarkRunnerOrchestrationPlan,
  createOperatorCockpitBenchmarkEvidenceReport,
  measureOperatorCockpitProjectionBaseline,
  measureOperatorCockpitReadOnlyProjectionBaseline,
  measureOperatorCockpitReadOnlyViewStateBaseline,
} from "./operator-cockpit-benchmark.js";

export type {
  ManagedAgentOperatorReplayEnvelope,
  OperatorCockpitAttachTarget,
  OperatorCockpitAttachConnectionKind,
  OperatorCockpitAttachTargetKind,
  OperatorCockpitAttachTransport,
  OperatorCockpitCostProjection,
  OperatorCockpitInstanceProjection,
  OperatorCockpitInvocationProjection,
  OperatorCockpitInvocationDiagnosticPointerProjection,
  OperatorCockpitInvocationResultHandoffProjection,
  OperatorCockpitInvocationResourceLeaseProjection,
  OperatorCockpitInvocationStatus,
  OperatorCockpitInvocationTranscriptProjection,
  OperatorCockpitManagedOrchestrationAdoptionGateProjection,
  OperatorCockpitManagedOrchestrationAdoptionGateRejectionProjection,
  OperatorCockpitManagedOrchestrationAdoptionGateStatus,
  NormalizeManagedAgentOperatorEventsOptions,
  OperatorCockpitReadOnlyAttachPlan,
  OperatorCockpitReadOnlyAttachPlanInput,
  OperatorCockpitReadOnlyAttachPlanTarget,
  OperatorCockpitReadOnlyProjection,
  OperatorCockpitReadOnlyProjectionInput,
  OperatorCockpitResourceLinkProjection,
  OperatorCockpitSessionProjection,
  OperatorCockpitTimelineEntry,
  OperatorCockpitToolStatus,
  OperatorCockpitToolSummaryProjection,
} from "./operator-cockpit-projection.js";
export {
  OPERATOR_COCKPIT_ATTACH_TARGET_KINDS,
  createOperatorCockpitReadOnlyAttachPlan,
  normalizeManagedAgentOperatorEvents,
  normalizeManagedAgentOperatorReplayEvents,
  projectOperatorCockpitReadOnlyView,
} from "./operator-cockpit-projection.js";

export type {
  OperatorCockpitFocusTarget,
  OperatorCockpitManagedAgentAttentionState,
  OperatorCockpitManagedAgentCancelControl,
  OperatorCockpitManagedAgentDrilldownFailureReason,
  OperatorCockpitManagedAgentDrilldownTarget,
  OperatorCockpitManagedAgentDrilldownViewState,
  OperatorCockpitManagedAgentViewItem,
  OperatorCockpitManagedAgentViewState,
  OperatorCockpitReadOnlyViewState,
  OperatorCockpitReadOnlyViewStateInput,
  OperatorCockpitReplayCursorTarget,
  OperatorCockpitTimelineFilters,
} from "./operator-cockpit-view-state.js";
export {
  createOperatorCockpitReadOnlyViewState,
} from "./operator-cockpit-view-state.js";

export type {
  OperatorAttentionItem,
  OperatorAttentionReason,
  OperatorAttentionSeverity,
  OperatorAttentionSummary,
} from "./operator-attention.js";
export {
  OPERATOR_ATTENTION_REASONS,
  OPERATOR_ATTENTION_SEVERITIES,
  createOperatorAttentionSummary,
} from "./operator-attention.js";

export type {
  OperatorWorkspaceGatewayTargetSummary,
  OperatorWorkspaceApprovalItem,
  OperatorWorkspaceApprovalSummary,
  OperatorWorkspaceConfigHealthItem,
  OperatorWorkspaceConfigHealthSummary,
  OperatorWorkspaceGatewayHealthItem,
  OperatorWorkspaceGatewayHealthSummary,
  OperatorWorkspaceHealthStatus,
  OperatorWorkspaceHomeEmptyProjectionInput,
  OperatorWorkspaceHomeProjection,
  OperatorWorkspaceHomeProjectionInput,
  OperatorWorkspaceManagedAgentSummary,
  OperatorWorkspaceProviderReadinessItem,
  OperatorWorkspaceProviderReadinessSummary,
  OperatorWorkspaceResourceItem,
  OperatorWorkspaceResourceSummary,
  OperatorWorkspaceRouteHealthItem,
  OperatorWorkspaceRouteHealthSummary,
  OperatorWorkspaceSessionSummary,
  OperatorWorkspaceWorkItemSummary,
  OperatorWorkspaceWorkSummary,
} from "./operator-workspace-home.js";
export {
  createOperatorWorkspaceConfigHealthSummary,
  createEmptyOperatorWorkspaceHomeProjection,
  createOperatorWorkspaceHomeProjection,
} from "./operator-workspace-home.js";

export type {
  OperatorCockpitAction,
  OperatorCockpitActionAdmissionInput,
  OperatorCockpitActionTarget,
  OperatorCockpitCancellationRequest,
  OperatorGatewayTargetIdentity,
  OperatorGatewayTargetKind,
  OperatorGatewayTargetTrust,
  OperatorCockpitReadOnlyAction,
  OperatorCockpitReadOnlyActionIntent,
  OperatorCockpitReadOnlyActionIntentInput,
} from "./operator-cockpit-target.js";
export {
  OPERATOR_COCKPIT_ACTIONS,
  OPERATOR_COCKPIT_READ_ONLY_ACTIONS,
  OPERATOR_GATEWAY_TARGET_KINDS,
  OPERATOR_GATEWAY_TARGET_TRUST,
  OperatorCockpitActionTargetSchema,
  OperatorCockpitCancellationRequestSchema,
  OperatorGatewayTargetIdentitySchema,
  createOperatorCockpitCancellationRequest,
  createOperatorCockpitReadOnlyActionIntent,
  operatorCockpitActionAllowed,
} from "./operator-cockpit-target.js";

export type {
  GuiMemoryLatticeError,
  GuiMemoryLatticeGraphEdge,
  GuiMemoryLatticeGraphFilters,
  GuiMemoryLatticeGraphNode,
  GuiMemoryLatticeNodeLifecycleEvidence,
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
  GuiMemoryLatticeNodeLifecycleEvidenceSchema,
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
  operatorIdentityInitials,
  projectAgentProfileIdentity,
  projectManagedAgentIdentity,
  projectMessageIdentity,
} from "./operator-identity.js";
export type {
  OperatorIdentityKind,
  OperatorIdentityProjection,
  OperatorMessageIdentityRole,
} from "./operator-identity.js";

export {
  OPERATOR_SURFACE_CAPABILITIES,
  OPERATOR_SURFACE_CAPABILITY_STATUSES,
  OPERATOR_SURFACE_KINDS,
  OperatorSurfaceCapabilityEntrySchema,
  OperatorSurfaceCapabilitySnapshotSchema,
  operatorSurfaceCapabilityStatus,
  operatorSurfaceSupports,
} from "./operator-surface-capability.js";
export type {
  OperatorSurfaceCapability,
  OperatorSurfaceCapabilityEntry,
  OperatorSurfaceCapabilitySnapshot,
  OperatorSurfaceCapabilityStatus,
  OperatorSurfaceKind,
} from "./operator-surface-capability.js";

export {
  formatVoiceAudioOutputForTerminal,
  projectVoiceAudioOutputParts,
} from "./voice-output-parts.js";
export type {
  VoiceAudioOutputProjection,
  VoiceAudioOutputSource,
} from "./voice-output-parts.js";

export {
  VOICE_INPUT_CAPTURE_MIME_TYPES,
  createVoiceInputParts,
  selectVoiceInputCaptureMimeType,
  voiceInputDisplayText,
} from "./voice-input-parts.js";
export type {
  VoiceInputAudioPart,
  VoiceInputBlobLike,
  VoiceInputContentPart,
  VoiceInputPartsInput,
  VoiceInputTextPart,
} from "./voice-input-parts.js";

export {
  formatOperatorEventValue,
  operatorEventTargetsConversation,
  operatorEventTargetsSurface,
  presentOperatorEventPayload,
  presentOperatorSessionEvent,
} from "./operator-event-presentation.js";
export type {
  OperatorEventConversationDisposition,
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
  PRESENTATION_INTENT_KINDS,
  formatPresentationIntentAsText,
  isPresentationIntent,
  parsePresentationIntent,
  presentationIntentBrief,
} from "./presentation-intent.js";
export type {
  ComparisonTablePresentationCell,
  ComparisonTablePresentationColumn,
  ComparisonTablePresentationIntent,
  DiagnosticReportPresentationIntent,
  DiagnosticReportPresentationSection,
  PresentationIntent,
  PresentationIntentBase,
  PresentationIntentConfidence,
  PresentationIntentField,
  PresentationIntentKind,
  PresentationIntentResourceLink,
  PresentationIntentSeverity,
  PresentationIntentStatus,
  ResourceBundlePresentationIntent,
  RiskMatrixPresentationIntent,
  RiskMatrixPresentationItem,
  SummaryPresentationIntent,
  TimelinePresentationIntent,
  TimelinePresentationItem,
} from "./presentation-intent.js";

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

export {
  SESSION_FEEDBACK_EVIDENCE_KINDS,
  SESSION_FEEDBACK_PUBLICATION_REASONS,
  SESSION_FEEDBACK_REPORTER_MODES,
  SessionFeedbackEvidencePreviewSchema,
  SessionFeedbackIssueDraftPreviewSchema,
  SessionFeedbackLocalArtifactsSchema,
  SessionFeedbackPreviewProjectionSchema,
  SessionFeedbackPublicationProjectionSchema,
  SessionFeedbackReporterProjectionSchema,
} from "./session-feedback-projection.js";
export type {
  SessionFeedbackEvidencePreview,
  SessionFeedbackIssueDraftPreview,
  SessionFeedbackLocalArtifacts,
  SessionFeedbackPreviewProjection,
  SessionFeedbackPublicationProjection,
  SessionFeedbackReporterProjection,
} from "./session-feedback-projection.js";
