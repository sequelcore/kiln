// Gateway
export { createGatewayApp } from "./gateway/gateway-routes.js";
export type { LoadedApp, GatewayServerConfig } from "./gateway/gateway-routes.js";
export { startGateway } from "./gateway/gateway-server.js";
export type { StartGatewayOptions } from "./gateway/gateway-server.js";
export { startDevServer } from "./gateway/gateway-server.js";
export type { DevServerOptions } from "./gateway/gateway-server.js";
export { startGuiGateway } from "./gateway/gui-gateway.js";
export {
  buildGuiOperatorDiscoveryResults,
  buildWelcomeProviderDescriptors,
  discoverCodexCliModelDiscovery,
  discoverGuiCliOperatorModels,
  discoverGuiDirectProviderModelDiscovery,
  discoverOpencodeCliModelDiscovery,
  markGuiProviderDiscoveryStale,
  projectGuiOperatorModels,
  providerRequiresSelectedModelMessage,
  resolveGuiOperatorDiscoveryResults,
  resolveGuiProviderSwitch,
} from "./gateway/gui-provider-models.js";
export { startProviderAuthRequest } from "./gateway/provider-auth.js";
export type { ProviderAuthRequest, ProviderAuthResult, ProviderAuthStartResult } from "./gateway/provider-auth.js";
export {
  CredentialFileStore,
  CredentialFileStoreError,
  CredentialHealthStore,
  CredentialPoolFactory,
  CredentialWatcher,
  CODEX_OAUTH_POOL_PROVIDER_ID,
  CodexOAuthCredentialPoolService,
  DirectProviderCredentialPoolService,
  HarnessCredentialPoolService,
  OPENCODE_POOL_PROVIDER_ID,
  OpenCodeCredentialPoolService,
  isHarnessPoolProviderId,
  isPooledDirectProviderId,
  mapCodexOAuthProviderError,
  mapDirectProviderError,
  mapOpenCodeProviderError,
  toHealthRecord,
} from "./agents/credential-pool/index.js";
export type {
  CodexOAuthCredentialPoolServiceConfig,
  CodexOAuthCredentialStatus,
  CodexOAuthPoolCredential,
  CreateDirectProviderPooledAdapterOptions,
  CredentialFileStatus,
  CredentialFileStoreConfig,
  CredentialHealthRecord,
  CredentialHealthStoreConfig,
  CredentialPoolFactoryConfig,
  CredentialWatcherConfig,
  CredentialWatcherListener,
  CreateCodexOAuthPooledAdapterOptions,
  DirectProviderAuth,
  DirectProviderCredentialPoolServiceConfig,
  DirectProviderCredentialStatus,
  HarnessCredentialPoolServiceConfig,
  HarnessCredentialStatus,
  HarnessHomeAuth,
  HarnessPoolProviderId,
  LoadCredentialPoolOptions,
  LinkCodexOAuthCredentialOptions,
  CreateOpenCodePooledAdapterOptions,
  LinkOpenCodeCredentialOptions,
  OpenCodeCredentialPoolServiceConfig,
  OpenCodeCredentialStatus,
  PooledDirectProviderId,
  RuntimeCredentialFile,
  WriteRuntimeCredential,
} from "./agents/credential-pool/index.js";
export {
  attachManagedInvocationSessionEventSink,
  createManagedAgentInvocationResourceProvider,
  createManagedAgentStartToolDefinition,
  createManagedInvocationToolExecutor,
  createManagedInvocationLifecycleToolExecutors,
  resolveManagedInvocationService,
  withManagedInvocationService,
  isManagedAgentInvocationResourceProvider,
  MANAGED_AGENT_INVOCATION_RESOURCE_PROVIDER_KIND,
  withManagedAgentInvocationResourceProvider,
  MANAGED_AGENT_CANCEL_CAPABILITY,
  MANAGED_AGENT_CANCEL_TOOL,
  MANAGED_AGENT_CANCEL_TOOL_NAME,
  MANAGED_AGENT_JOIN_CAPABILITY,
  MANAGED_AGENT_JOIN_TOOL,
  MANAGED_AGENT_JOIN_TOOL_NAME,
  MANAGED_AGENT_LIST_CAPABILITY,
  MANAGED_AGENT_LIST_TOOL,
  MANAGED_AGENT_LIST_TOOL_NAME,
  MANAGED_AGENT_INVOKE_CAPABILITY,
  MANAGED_AGENT_INVOKE_TOOL,
  MANAGED_AGENT_INVOKE_TOOL_NAME,
  MANAGED_AGENT_START_CAPABILITY,
  MANAGED_AGENT_START_TOOL,
  MANAGED_AGENT_START_TOOL_NAME,
  MANAGED_AGENT_STATUS_CAPABILITY,
  MANAGED_AGENT_STATUS_TOOL,
  MANAGED_AGENT_STATUS_TOOL_NAME,
  ManagedCliHarnessAdapter,
  ManagedDirectProviderRuntimeAdapter,
  ManagedRemoteHarnessAdapter,
  ManagedFilesystemArtifactDirectoryLeaseManager,
  ManagedFilesystemRuntimeRecoveryStore,
  ManagedGitWorktreeLeaseManager,
  ManagedInMemoryDevServerPortLeaseManager,
  ManagedAgentLeaseAcquireError,
  ManagedAgentRuntimeRecoveryDaemon,
  ManagedRuntimeCredentialRouteLeaseManager,
  ManagedRuntimeEnvironmentLeaseManager,
  ManagedRuntimeSandboxLeaseManager,
  ManagedAgentRuntimeAdmissionError,
  RuntimeManagedAgentInvocationService,
  runManagedAgentFanOutLifecycle,
} from "./agents/managed-invocation/index.js";
export type {
  ManagedAgentArtifactDirectoryLeaseManager,
  ManagedAgentArtifactDirectoryLeaseManagerInput,
  ManagedAgentArtifactDirectoryLeaseReleaseInput,
  ManagedAgentCredentialRouteLeaseManager,
  ManagedAgentCredentialRouteLeaseManagerInput,
  ManagedAgentCredentialRouteLeaseReleaseInput,
  ManagedAgentSandboxLeaseManager,
  ManagedAgentSandboxLeaseManagerInput,
  ManagedAgentSandboxLeaseReleaseInput,
  ManagedAgentDevServerPortLeaseManager,
  ManagedAgentDevServerPortLeaseManagerInput,
  ManagedAgentDevServerPortLeaseReleaseInput,
  ManagedAgentEnvironmentLease,
  ManagedAgentEnvironmentLeaseManager,
  ManagedAgentEnvironmentLeaseManagerInput,
  ManagedAgentEnvironmentLeaseReleaseInput,
  ManagedAgentEnvironmentVariables,
  ManagedCliHarnessAdapterConfig,
  ManagedCliHarnessFilesystemBoundaryConfig,
  ManagedDirectProviderRuntimeAdapterConfig,
  ManagedInvocationToolOptionsWithService,
  ManagedRemoteHarnessAdapterConfig,
  ManagedRemoteHarnessTransport,
  ManagedRemoteHarnessTransportCancelInput,
  ManagedRemoteHarnessTransportInvokeInput,
  ManagedFilesystemArtifactDirectoryLeaseManagerConfig,
  ManagedFilesystemRuntimeRecoveryStoreConfig,
  ManagedInMemoryDevServerPortLeaseManagerConfig,
  ManagedAgentPersistentRecoveryInput,
  ManagedRuntimeCredentialRouteLeaseManagerConfig,
  ManagedRuntimeEnvironmentBinding,
  ManagedRuntimeEnvironmentLeaseManagerConfig,
  ManagedAgentWorktreeLeaseManager,
  ManagedAgentWorktreeLeaseManagerInput,
  ManagedAgentWorktreeLeaseReleaseInput,
  ManagedGitWorktreeLeaseManagerConfig,
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeInvocationInput,
  ManagedAgentRuntimeInvocationResult,
  ManagedAgentRuntimeInvocationSnapshot,
  ManagedAgentRuntimeInvocationStartResult,
  ManagedAgentRuntimeRecoveryCheckpoint,
  ManagedAgentRuntimeRecoveryDaemonConfig,
  ManagedAgentRuntimeRecoveryDaemonRunInput,
  ManagedAgentRuntimeRecoveryDaemonRunResult,
  ManagedAgentRuntimeRecoveryDaemonService,
  ManagedAgentRuntimeRecoveryLeaseStage,
  ManagedAgentRuntimeRecoveryStore,
  ManagedAgentStaleRecoveryInput,
  ManagedAgentStaleRecoveryResult,
  ManagedAgentFanOutBudgetAdmissionInput,
  ManagedAgentFanOutLifecycleChildRecord,
  ManagedAgentFanOutLifecycleInput,
  ManagedAgentFanOutLifecycleResult,
  ManagedAgentFanOutLifecycleRouteSelector,
  ManagedInvocationContextResolution,
  ManagedInvocationContextResolver,
  ManagedInvocationContextResolverInput,
  ManagedInvocationSessionEventSink,
  ManagedInvocationAgentCatalogEntry,
  ManagedInvocationRouteProfile,
  ManagedInvocationToolOptions,
  ManagedInvocationToolRoute,
} from "./agents/managed-invocation/index.js";
export { createProviderCatalogService } from "./gateway/provider-catalog-service.js";
export type { ProviderCatalogService, ProviderCatalogSnapshot } from "./gateway/provider-catalog-service.js";
export {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
} from "./gateway/attached-runtime-tool-surface.js";
export type {
  AttachedRuntimeBuiltinToolSurface,
  AttachedRuntimeBuiltinToolSurfaceOptions,
} from "./gateway/attached-runtime-tool-surface.js";
export {
  PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE,
  PlaywrightBrowserUseProvider,
} from "./interactive/playwright-browser-use-provider.js";
export type {
  InteractiveArtifactSink,
  InteractiveArtifactWrite,
  PlaywrightBrowserLiveStreamOptions,
  PlaywrightBrowserSessionState,
  PlaywrightBrowserUseProviderOptions,
} from "./interactive/playwright-browser-use-provider.js";
export {
  PlaywrightBrowserCaptureRecorder,
} from "./interactive/playwright-browser-capture-recorder.js";
export type {
  PlaywrightBrowserExternalEditorExportOptions,
  PlaywrightBrowserExternalEditorExportProof,
  PlaywrightBrowserCaptureFrameInput,
  PlaywrightBrowserCaptureProof,
  PlaywrightBrowserCaptureRecorderOptions,
  PlaywrightBrowserCaptureTransport,
  PlaywrightBrowserOperationInput,
  PlaywrightBrowserOperationStatus,
  PlaywrightBrowserRenderProof,
  PlaywrightBrowserRenderVideoOptions,
} from "./interactive/playwright-browser-capture-recorder.js";
export {
  RecorderExternalEditorExporter,
} from "./interactive/recorder-external-editor-exporter.js";
export type {
  RecorderExternalEditorExporterOptions,
  RecorderExternalEditorExportInput,
  RecorderExternalEditorExportResult,
} from "./interactive/recorder-external-editor-exporter.js";
export {
  WindowsComputerCaptureRecorder,
} from "./interactive/windows-computer-capture-recorder.js";
export type {
  WindowsComputerCaptureProof,
  WindowsComputerCaptureRecorderOptions,
  WindowsComputerCaptureTransport,
  WindowsComputerOperationInput,
  WindowsComputerOperationStatus,
} from "./interactive/windows-computer-capture-recorder.js";
export {
  RecorderVoiceTrackRecorder,
} from "./interactive/recorder-voice-track.js";
export type {
  RecorderMicrophoneCaptureArtifactOptions,
  RecorderMicrophoneCaptureOptions,
  RecorderMicrophoneCaptureRecord,
  RecorderTtsNarrationOptions,
  RecorderTtsNarrationRecord,
  RecorderVoiceInputMode,
  RecorderVoiceInputOptions,
  RecorderVoiceInputRecord,
  RecorderVoiceTrackProof,
  RecorderVoiceTrackRecorderOptions,
} from "./interactive/recorder-voice-track.js";
export {
  createPlaywrightBrowserVideoEncoder,
  createPlaywrightBrowserVideoRenderer,
  renderPlaywrightBrowserVideo,
} from "./interactive/playwright-browser-video-renderer.js";
export type {
  BrowserVideoEncoder,
  BrowserVideoEncoderFrame,
  BrowserVideoEncoderInput,
  BrowserVideoEncoderResult,
  BrowserVideoOperationEvent,
  BrowserVideoOutputOptions,
  BrowserVideoSourceFrame,
  PlaywrightBrowserVideoRenderInput,
  PlaywrightBrowserVideoRenderer,
  PlaywrightBrowserVideoRenderResult,
  PlaywrightVideoEncoderModule,
  PlaywrightVideoEncoderOptions,
} from "./interactive/playwright-browser-video-renderer.js";
export {
  NUT_JS_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE,
  WindowsComputerUseProvider,
} from "./interactive/windows-computer-use-provider.js";
export type {
  ActiveApplicationResolver,
  NutJsLoader,
  WindowsComputerUseProviderOptions,
} from "./interactive/windows-computer-use-provider.js";
export {
  WINDOWS_UIA_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE,
  createWindowsUiaSidecarRunner,
  WindowsUiaComputerUseProvider,
} from "./interactive/windows-uia-computer-use-provider.js";
export type {
  WindowsUiaComputerUseProviderOptions,
  WindowsUiaSidecarRequest,
  WindowsUiaSidecarResponse,
  WindowsUiaSidecarRunner,
} from "./interactive/windows-uia-computer-use-provider.js";
export type {
  OperatorSurfaceController,
  OperatorSurfaceThemeController,
} from "./operator/operator-surface-controller.js";
export type {
  StartGuiGatewayOptions,
  GuiGateway,
  OperatorProviderPreference,
  GuiDashboardSnapshot,
  GuiSessionDetail,
  GuiSessionEvent,
  GuiSessionMeta,
  GuiProviderDescriptor,
  GuiSessionSummary,
  GuiTelemetrySnapshot,
  GuiOutboundFrame,
  GuiInboundFrame,
} from "./gateway/gui-gateway.js";
export { startTuiGateway } from "./gateway/tui-gateway.js";
export type { TuiGatewayOptions, TuiGateway } from "./gateway/tui-gateway.js";
export { resolveApps } from "./gateway/app-resolver.js";
export type { ResolvedApp } from "./gateway/app-resolver.js";
export { createProviderAdapterRoutes } from "./gateway/provider-adapter-routes.js";
export type { ProviderAdapterAppRuntime } from "./gateway/provider-adapter-routes.js";
export { KokoroLocalTtsAdapter, WhisperLocalSttAdapter } from "./gateway/local-voice-adapters.js";
export type { KokoroLocalTtsAdapterConfig, WhisperLocalSttAdapterConfig } from "./gateway/local-voice-adapters.js";
export { createSttAdapter } from "./gateway/stt-factory.js";
export { createTtsAdapter } from "./gateway/tts-factory.js";
export { checkBudget, reportUsage, checkTier } from "./gateway/budget-middleware.js";
export type { BudgetCheckResult, TierCheckResult, BillingConfig } from "./gateway/budget-middleware.js";
export { ConversationEventEmitter } from "./gateway/conversation-event-emitter.js";
export { executeDelegation, validateResponseSchema } from "./gateway/delegation-handler.js";
export type { DelegationTarget, DelegationRegistry } from "./gateway/delegation-handler.js";
export { createDelegationRoutes } from "./gateway/delegation-routes.js";
export { createTenantRoutes } from "./gateway/tenant-routes.js";
export type { TenantAppRuntime } from "./gateway/tenant-routes.js";
export { createWsTenantRoutes } from "./gateway/ws-tenant-routes.js";
export type { WsTenantRoutesConfig } from "./gateway/ws-tenant-routes.js";
export { createWhatsAppWebhookRoutes } from "./gateway/whatsapp-webhook-routes.js";
export type { WhatsAppWebhookConfig } from "./gateway/whatsapp-webhook-routes.js";
export { createInstagramWebhookRoutes } from "./gateway/instagram-webhook-routes.js";
export type { InstagramWebhookConfig } from "./gateway/instagram-webhook-routes.js";
export { createMessengerWebhookRoutes } from "./gateway/messenger-webhook-routes.js";
export type { MessengerWebhookConfig } from "./gateway/messenger-webhook-routes.js";
export { verifyMetaWebhook, validateMetaSignature } from "./gateway/meta-webhook-foundation.js";
export { WebhookDedup } from "./gateway/webhook-dedup.js";
export { createEmailWebhookRoutes } from "./gateway/email-webhook-routes.js";
export type { EmailWebhookConfig } from "./gateway/email-webhook-routes.js";
export { shouldRejectEmail, isAutoReply, isIgnoredSender } from "./gateway/email-loop-guard.js";
export { InMemoryEmailThreadStore } from "./gateway/email-thread-store.js";
export { SqliteEmailThreadStore } from "./gateway/sqlite-email-thread-store.js";
export type { EmailThread, EmailThreadStore } from "./gateway/email-thread-store.js";
export { createTenantAdminRoutes } from "./gateway/tenant-admin-routes.js";
export type { TenantAdminRoutesConfig } from "./gateway/tenant-admin-routes.js";
export { createOutboundRoutes } from "./gateway/outbound-routes.js";
export type { OutboundRoutesConfig } from "./gateway/outbound-routes.js";
export { createHandoffRoutes } from "./gateway/handoff-routes.js";
export type { HandoffRoutesConfig } from "./gateway/handoff-routes.js";
export { ApprovalGateRegistry } from "./gateway/approval-registry.js";
export type { ApprovalTarget } from "./gateway/approval-registry.js";
export { DevOrchestrator } from "./gateway/dev-orchestrator.js";
export type { DevOrchestratorConfig, DevRunResult } from "./gateway/dev-orchestrator.js";
export { DevTokenStore } from "./gateway/dev-token-store.js";
export type { DevToken } from "./gateway/dev-token-store.js";

// Message Pipeline
export { processAdmittedTurn } from "./gateway/message-pipeline.js";
export type {
  AdmittedTurnContext,
  AdmittedTurnResult,
  BudgetDeniedResult,
  ProcessResult,
  RuntimeSessionHydrationResult,
  RuntimeSessionHydrator,
} from "./gateway/message-pipeline.js";

// Trace
export { TraceContext } from "./gateway/trace-context.js";

// Observability
export { CompositeEventStore } from "./observability/composite-event-store.js";
export { PrometheusCollector } from "./observability/prometheus-collector.js";
export type { PrometheusCollectorConfig } from "./observability/prometheus-collector.js";
export {
  CredentialPoolObservabilityRegistry,
} from "./agents/credential-pool/credential-pool-observability.js";
export type {
  CredentialPoolObservation,
} from "./agents/credential-pool/credential-pool-observability.js";
export {
  ProviderModelRouteHealthStore,
} from "./agents/provider-route-health/index.js";
export type {
  ProviderModelRouteHealthStoreConfig,
} from "./agents/provider-route-health/index.js";

// Session
export {
  RuntimeSession,
  RuntimeSessionOrchestrator,
  RuntimeBudgetAdmissionService,
  collectRuntimeFeedbackEvidence,
  deriveGovernedTurnOutcome,
  deriveGovernedTurnOutcomeFromToolRecords,
  buildEffectiveTurnAuthorityPolicyInputs,
  describeEffectiveTurnAuthorityActionability,
  formatEffectiveTurnAuthorityGuidance,
  SessionRegistry,
  InMemorySessionStore,
  RedisSessionStore,
  createRedisSessionStore,
  serializeSession,
  deserializeSession,
  getProjectContextArtifactCache,
  ProjectContextArtifactCache,
  isValidTransition,
  transitionSessionMode,
  DefaultEscalationDetector,
  wordOverlapSimilarity,
  DefaultContextSummarizer,
  DefaultAgentHandoffSummarizer,
} from "./session/index.js";
export type {
  RuntimeSessionConfig,
  RuntimeBudgetAdmissionPort,
  RuntimeBudgetAdmissionServiceOptions,
  RuntimeBudgetUsageReader,
  RuntimeBudgetUsageReaderInput,
  GovernedTurnOutcomeToolRecord,
  RuntimeFeedbackEvidenceCollectorInput,
  SerializedSessionData,
  AgentTurnEntry,
  EffectiveTurnAuthorityPolicyInput,
  EffectiveTurnAuthorityPolicyInputSource,
  EffectiveTurnAuthorityPolicyInputStatus,
  EffectiveTurnAuthoritySnapshot,
  OrchestratorDeps,
  OrchestrateResult,
  PerCallToolConfig,
  ToolExecutionSummary,
  SessionStore,
  RedisLike,
  SessionMode,
  EscalationSignal,
  EscalationDetector,
  DefaultEscalationDetectorConfig,
  ContextSummarizer,
  AgentHandoffSummarizer,
} from "./session/index.js";

// Tenant
export { TenantRegistry, TenantNotFoundError, TenantValidationFailedError } from "./tenant/tenant-registry.js";
export { buildTenantSystemPrompt } from "./tenant/system-prompt-builder.js";
export { extractSuggestions, stripSuggestionTags } from "./tenant/suggestion-parser.js";
export type { ParsedResponse } from "./tenant/suggestion-parser.js";
export { DefaultTenantRouter, EmbeddingTenantRouter } from "./tenant/tenant-router.js";
export type { TenantRouter, RoutingResult } from "./tenant/tenant-router.js";
export { resolveAgentContext, resolveAgentContextAsync, buildAgentSystemPrompt } from "./tenant/agent-resolver.js";
export type { ResolvedAgentContext, AsyncAgentResolverDeps } from "./tenant/agent-resolver.js";
export { checkPingPong } from "./tenant/ping-pong-guard.js";
export type { PingPongCheckResult } from "./tenant/ping-pong-guard.js";
export { createRoutingTestRoutes } from "./gateway/routing-test-routes.js";
export type { RoutingTestRoutesConfig } from "./gateway/routing-test-routes.js";

// Triggers
export { TriggerRegistry } from "./trigger/trigger-registry.js";
export type { TriggerRegistryConfig } from "./trigger/trigger-registry.js";
export { createWebhookHandler, validateWebhookSignature } from "./trigger/webhook-handler.js";
export type { WebhookHandlerConfig } from "./trigger/webhook-handler.js";
export { EventListener, matchesFilter } from "./trigger/event-listener.js";
export type { EventListenerConfig } from "./trigger/event-listener.js";
export { Scheduler } from "./trigger/scheduler.js";
export type { ScheduleEntry } from "./trigger/scheduler.js";
export { executeTrigger, interpolateTemplate } from "./trigger/trigger-executor.js";
export type { TriggerExecutionContext } from "./trigger/trigger-executor.js";

// Channels
export { EventBridge, toEngineEvent } from "./channels/event-bridge.js";
export { ChannelRegistry } from "./channels/channel-registry.js";
export { formatForChannel, toWhatsAppFormat, toInstagramFormat, toMessengerFormat, toEmailFormat } from "./channels/message-formatter.js";
export type { ChannelConfig, ChannelStatus, IdentityMapping, IdentityResolver } from "./channels/types.js";
export { InMemoryIdentityResolver } from "./channels/types.js";
export { CliChannel } from "./channels/cli-channel.js";
export { WebChannel } from "./channels/web-channel.js";
export type { WebSocketLike } from "./channels/web-channel.js";
export { ChannelRouter } from "./channels/channel-router.js";
export type { RouteResult, ChannelRouterRule } from "./channels/channel-router.js";
export { WhatsAppChannel } from "./channels/whatsapp-channel.js";
export type { WhatsAppConfig } from "./channels/whatsapp-channel.js";
export { InstagramChannel } from "./channels/instagram-channel.js";
export type { InstagramConfig } from "./channels/instagram-channel.js";
export { MessengerChannel } from "./channels/messenger-channel.js";
export type { MessengerConfig } from "./channels/messenger-channel.js";
export { SlackChannel } from "./channels/slack-channel.js";
export type { SlackConfig } from "./channels/slack-channel.js";
export { ApiChannel } from "./channels/api-channel.js";
export type { SseWriter } from "./channels/api-channel.js";
export {
  sendWhatsAppAudioMessage,
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  whatsappMessagesUrl,
  WHATSAPP_GRAPH_API_VERSION,
} from "./channels/whatsapp-api.js";
export type {
  WhatsAppTemplateComponent,
  WhatsAppTemplateParameter,
  WhatsAppSendResult,
} from "./channels/whatsapp-api.js";
export {
  sendInstagramMessage,
  sendInstagramMediaMessage,
  instagramMessagesUrl,
  INSTAGRAM_GRAPH_API_VERSION,
} from "./channels/instagram-api.js";
export type { InstagramSendResult } from "./channels/instagram-api.js";
export {
  sendMessengerMessage,
  sendMessengerMediaMessage,
  messengerMessagesUrl,
  MESSENGER_GRAPH_API_VERSION,
} from "./channels/messenger-api.js";
export type { MessengerSendResult } from "./channels/messenger-api.js";
export { EmailChannel } from "./channels/email-channel.js";
export type { EmailChannelConfig } from "./channels/email-channel.js";
export { createEmailTransport } from "./channels/email-api.js";
export type { EmailTransport, OutboundEmail, EmailSendResult } from "./channels/email-api.js";
export { renderEmailHtml, renderEmailPlainText } from "./channels/email-template.js";
export type { EmailBranding } from "./channels/email-template.js";

// Enrichment
export { SqliteEnrichmentStore } from "./enrichment/sqlite-enrichment-store.js";
export { EnrichmentRunner } from "./enrichment/enrichment-runner.js";
export type { EnrichmentRunnerConfig } from "./enrichment/enrichment-runner.js";
export { createEnrichmentAdminRoutes } from "./gateway/enrichment-admin-routes.js";
export type { EnrichmentAdminRoutesConfig } from "./gateway/enrichment-admin-routes.js";

// Integration Runtime
export { IntegrationRegistry } from "./gateway/integration-registry.js";
export type { ResolvedOperation } from "./gateway/integration-registry.js";
export { IntegrationExecutor } from "./gateway/integration-executor.js";
export { LocalCredentialResolver } from "./gateway/local-credential-resolver.js";
export { configureIntegrationDeps, clearIntegrationDeps } from "./gateway/tenant-tool-factory.js";
export type { IntegrationDeps } from "./gateway/tenant-tool-factory.js";

// MCP Server
export { GatewayMcpServer, GATEWAY_MCP_TOOLS } from "./mcp/index.js";
export type { GatewayMcpServerOptions, GatewayMcpDeps, GatewayMcpToolName } from "./mcp/index.js";

// Auth
export { requireApiKey, requireBearer, requireWebhookSignature, isOriginAllowed } from "./gateway/auth-middleware.js";

// Utils
export { verifyHmacSha256 } from "./utils/hmac.js";

// Execution Backends
export { CliSubscriptionExecutor } from "./execution/cli-subscription-executor.js";
export type { CliSessionFactory, CliSessionFactoryContext, CliSession, CliSessionEvent, CliSessionRunOptions } from "./execution/cli-subscription-executor.js";

