// Gateway

export type {
  AgentTaskCommitmentRecoveryPort,
  AgentTaskCommitmentRecoveryState,
  AgentTaskDataPolicyProof,
  AgentTaskDiagnosticCode,
  AgentTaskEconomicAdoption,
  AgentTaskEconomicAdoptionPort,
  AgentTaskEconomicCommitmentPort,
  AgentTaskEconomicFenceResult,
  AgentTaskEconomicReplay,
  AgentTaskEconomicReplayPort,
  AgentTaskExecutionContext,
  AgentTaskExecutionFailureClassification,
  AgentTaskFailureEvidence,
  AgentTaskGovernanceEvidence,
  AgentTaskGovernancePort,
  AgentTaskLifecycleEntry,
  AgentTaskNativeDeliberationResolution,
  AgentTaskNativeHarnessAcknowledgement,
  AgentTaskNativeHarnessExecutionPort,
  AgentTaskNativeHarnessFenceResult,
  AgentTaskNativeHarnessProfile,
  AgentTaskNativeHarnessRoute,
  AgentTaskProfile,
  AgentTaskProfilePort,
  AgentTaskProjectPort,
  AgentTaskRecord,
  AgentTaskReplayQuery,
  AgentTaskResult,
  AgentTaskResultAvailability,
  AgentTaskResultQuery,
  AgentTaskRoutePort,
  AgentTaskRouteResolutionContext,
  AgentTaskState,
  AgentTaskStore,
  AgentTaskSubmission,
  TrustedAgentTaskProject,
  TrustedAgentTaskQueryContext,
} from "./agent-tasks/index.js";
export {
  AGENT_TASK_RECOVERY_POLICY,
  AGENT_TASK_SCHEMA_VERSION,
  AgentTaskApplicationError,
  AgentTaskApplicationService,
  AgentTaskExecutionFailure,
  FilesystemAgentTaskStore,
  InMemoryAgentTaskStore,
} from "./agent-tasks/index.js";
export type { CredentialPoolObservation } from "./agents/credential-pool/credential-pool-observability.js";
export { CredentialPoolObservabilityRegistry } from "./agents/credential-pool/credential-pool-observability.js";
export { ProviderCredentialApplicationService } from "./agents/credential-acquisition/provider-credential-application-service.js";
export type {
  CodexNativeActivationResult,
  CodexNativeActivationSelection,
  CredentialPermissionFinding,
  ImportNativeOpenCodeCredentialOptions,
  LegacyProviderCredentialStatus,
  ProviderCredentialApplicationServiceConfig,
  ProviderCredentialInspection,
} from "./agents/credential-acquisition/provider-credential-application-service.js";
export type { OpenCodeTier } from "./agents/credential-acquisition/opencode-credentials.js";
export type {
  CodexOAuthCredentialPoolServiceConfig,
  CodexOAuthCredentialStatus,
  CodexOAuthExecutionAccount,
  CodexOAuthExecutionCredential,
  CodexOAuthPoolCredential,
  CreateExactCodexOAuthAdapterOptions,
  CredentialHealthRecord,
  CredentialHealthStoreConfig,
  CredentialPoolFactoryConfig,
  CredentialWatcherConfig,
  CredentialWatcherListener,
  DirectProviderAuth,
  DirectProviderCredentialPoolServiceConfig,
  DirectProviderCredentialStatus,
  HarnessCredentialPoolServiceConfig,
  HarnessCredentialStatus,
  HarnessHomeAuth,
  HarnessPoolProviderId,
  LinkCodexOAuthCredentialOptions,
  LinkOpenCodeCredentialOptions,
  LoadCredentialPoolOptions,
  OpenCodeCredentialPoolServiceConfig,
  OpenCodeCredentialStatus,
  PooledDirectProviderId,
} from "./agents/credential-pool/index.js";
export {
  CODEX_OAUTH_POOL_PROVIDER_ID,
  CodexOAuthCredentialPoolService,
  CredentialHealthStore,
  CredentialPoolFactory,
  CredentialWatcher,
  DirectProviderCredentialPoolService,
  HarnessCredentialPoolService,
  isHarnessPoolProviderId,
  isPooledDirectProviderId,
  mapCodexOAuthProviderError,
  mapDirectProviderError,
  mapOpenCodeProviderError,
  OPENCODE_POOL_PROVIDER_ID,
  OpenCodeCredentialPoolService,
  toHealthRecord,
} from "./agents/credential-pool/index.js";
export type {
  ManagedAgentArtifactDirectoryLeaseManager,
  ManagedAgentArtifactDirectoryLeaseManagerInput,
  ManagedAgentArtifactDirectoryLeaseReleaseInput,
  ManagedAgentCredentialRouteLeaseManager,
  ManagedAgentCredentialRouteLeaseManagerInput,
  ManagedAgentCredentialRouteLeaseReleaseInput,
  ManagedAgentDevServerPortLeaseManager,
  ManagedAgentDevServerPortLeaseManagerInput,
  ManagedAgentDevServerPortLeaseReleaseInput,
  ManagedAgentEnvironmentLease,
  ManagedAgentEnvironmentLeaseManager,
  ManagedAgentEnvironmentLeaseManagerInput,
  ManagedAgentEnvironmentLeaseReleaseInput,
  ManagedAgentEnvironmentVariables,
  ManagedAgentOrchestrationLifecycleChildRecord,
  ManagedAgentOrchestrationLifecycleInput,
  ManagedAgentOrchestrationLifecycleResult,
  ManagedAgentOrchestrationLifecycleRouteSelector,
  ManagedAgentPersistentRecoveryInput,
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeAuthorityObserver,
  ManagedAgentRuntimeCancellationResult,
  ManagedAgentRuntimeConsumedWriteApproval,
  ManagedAgentRuntimeInvocationCancelResult,
  ManagedAgentRuntimeInvocationInput,
  ManagedAgentRuntimeInvocationProgressEvent,
  ManagedAgentRuntimeInvocationRecord,
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
  ManagedAgentRuntimeResultPendingEvidence,
  ManagedAgentSandboxLeaseManager,
  ManagedAgentSandboxLeaseManagerInput,
  ManagedAgentSandboxLeaseReleaseInput,
  ManagedAgentStaleRecoveryInput,
  ManagedAgentStaleRecoveryResult,
  ManagedAgentWorktreeLeaseManager,
  ManagedAgentWorktreeLeaseManagerInput,
  ManagedAgentWorktreeLeaseReleaseInput,
  ManagedChildAuthorityAdmission,
  ManagedChildAuthorityAdmissionContract,
  ManagedChildAuthorityAdmissionInput,
  ManagedCliHarnessAdapterConfig,
  ManagedCliHarnessFilesystemBoundaryConfig,
  ManagedCommittedInvocationRequest,
  ManagedCommittedRouteMismatchEvidence,
  ManagedDirectProviderRuntimeAdapterConfig,
  ManagedEconomicCandidateDescriptor,
  ManagedEconomicCandidateRejection,
  ManagedEconomicCandidateRejectionReason,
  ManagedEconomicCandidateSet,
  ManagedEconomicDispatchAdoption,
  ManagedEconomicDispatchAuthorityPort,
  ManagedEconomicDispatchCoordinatorOptions,
  ManagedEconomicDispatchPreparation,
  ManagedEconomicDispatchPrepareInput,
  ManagedEconomicInvocationCommand,
  ManagedEconomicLifecycleEventPort,
  ManagedFilesystemArtifactDirectoryLeaseManagerConfig,
  ManagedFilesystemRuntimeRecoveryStoreConfig,
  ManagedGitWorktreeLeaseManagerConfig,
  ManagedInMemoryDevServerPortLeaseManagerConfig,
  ManagedAttendedTrustedExecutionContext,
  ManagedInvocationAgentCatalogEntry,
  ManagedInvocationContextResolution,
  ManagedInvocationContextResolver,
  ManagedInvocationContextResolverInput,
  ManagedInvocationRouteProfile,
  ManagedInvocationSessionEventSink,
  ManagedInvocationToolAttachment,
  ManagedInvocationToolOptions,
  ManagedInvocationToolOptionsWithService,
  ManagedInvocationToolRoute,
  ManagedRemoteHarnessAdapterConfig,
  ManagedRemoteHarnessTransport,
  ManagedRemoteHarnessTransportCancelInput,
  ManagedRemoteHarnessTransportInvokeInput,
  ManagedRuntimeCredentialRouteLeaseManagerConfig,
  ManagedRuntimeEnvironmentBinding,
  ManagedRuntimeEnvironmentLeaseManagerConfig,
} from "./agents/managed-invocation/index.js";
export {
  admitManagedChildAuthority,
  assertManagedChildAuthorityAdmissionBoundary,
  attachManagedInvocationSessionEventSink,
  buildManagedAgentCoordinationUsage,
  collectManagedEconomicCandidates,
  createManagedAgentInvocationResourceProvider,
  createManagedAgentOrchestrateToolDefinition,
  createManagedAgentStartToolDefinition,
  createManagedInvocationLifecycleToolExecutors,
  createManagedInvocationToolAttachment,
  createManagedInvocationToolExecutor,
  digestManagedEconomicCandidateProfileAuthority,
  isManagedAgentInvocationResourceProvider,
  isManagedExternalInvocationPermit,
  MANAGED_AGENT_CANCEL_CAPABILITY,
  MANAGED_AGENT_CANCEL_TOOL,
  MANAGED_AGENT_CANCEL_TOOL_NAME,
  MANAGED_AGENT_INVOCATION_RESOURCE_PROVIDER_KIND,
  MANAGED_AGENT_INVOKE_CAPABILITY,
  MANAGED_AGENT_INVOKE_TOOL,
  MANAGED_AGENT_INVOKE_TOOL_NAME,
  MANAGED_AGENT_JOIN_CAPABILITY,
  MANAGED_AGENT_JOIN_TOOL,
  MANAGED_AGENT_JOIN_TOOL_NAME,
  MANAGED_AGENT_LIST_CAPABILITY,
  MANAGED_AGENT_LIST_TOOL,
  MANAGED_AGENT_LIST_TOOL_NAME,
  MANAGED_AGENT_ORCHESTRATE_CAPABILITY,
  MANAGED_AGENT_ORCHESTRATE_TOOL,
  MANAGED_AGENT_ORCHESTRATE_TOOL_NAME,
  MANAGED_AGENT_START_CAPABILITY,
  MANAGED_AGENT_START_TOOL,
  MANAGED_AGENT_START_TOOL_NAME,
  MANAGED_AGENT_STATUS_CAPABILITY,
  MANAGED_AGENT_STATUS_TOOL,
  MANAGED_AGENT_STATUS_TOOL_NAME,
  MANAGED_ATTENDED_TRUSTED_EXECUTION_ENFORCEMENT_REVISION,
  ManagedAgentLeaseAcquireError,
  ManagedAgentRuntimeAdmissionError,
  ManagedAgentRuntimeRecoveryDaemon,
  ManagedCliHarnessAdapter,
  ManagedCommittedRouteMismatchError,
  ManagedDirectProviderRuntimeAdapter,
  ManagedEconomicDispatchCoordinator,
  ManagedFilesystemArtifactDirectoryLeaseManager,
  ManagedFilesystemRuntimeRecoveryStore,
  ManagedGitWorktreeLeaseManager,
  ManagedInMemoryDevServerPortLeaseManager,
  ManagedRemoteHarnessAdapter,
  ManagedRuntimeCredentialRouteLeaseManager,
  ManagedRuntimeEnvironmentLeaseManager,
  ManagedRuntimeSandboxLeaseManager,
  RuntimeManagedAgentInvocationService,
  requireManagedAttendedTrustedExecution,
  resolveAdHocManagedInvocationRouteProfile,
  resolveConfiguredManagedInvocationRouteProfile,
  resolveManagedInvocationCallerIdentity,
  resolveManagedInvocationRouteProfile,
  resolveManagedInvocationService,
  runManagedAgentOrchestrationLifecycle,
  withManagedAgentInvocationResourceProvider,
  withManagedChildAuthorityAdmission,
  withManagedInvocationService,
} from "./agents/managed-invocation/index.js";
export type { ProviderModelRouteHealthStoreConfig } from "./agents/provider-route-health/index.js";
export { ProviderModelRouteHealthStore } from "./agents/provider-route-health/index.js";
export type {
  CodexUsageHeaders,
  ParseCodexProviderUsageInput,
} from "./agents/provider-usage/index.js";
export {
  InMemoryProviderUsageStore,
  parseCodexProviderUsage,
} from "./agents/provider-usage/index.js";
export { projectCapabilityCatalog } from "./capabilities/capability-catalog-projector.js";
export type {
  ChannelEgressActionClaim,
  ChannelEgressActionClaimContext,
  ChannelEgressActionClaimId,
  ChannelEgressActionClaimPermit,
  ChannelEgressActionClaimRecord,
  ChannelEgressActionClaimSettlement,
  ChannelEgressActionClaimStore,
  ChannelEgressActionDigest,
  ChannelEgressAdmissionReadInput,
  ChannelEgressClaimStatus,
  ChannelEgressDispatchInput,
} from "./channels/channel-egress-action-claim.js";
export {
  assertCanonicalSha256Id,
  ChannelEgressClaimedError,
  ChannelEgressPreDispatchCancellationError,
  channelEgressDigest,
  defineChannelEgressActionClaim,
  dispatchChannelEgress,
  prepareChannelEgressActionClaim,
} from "./channels/channel-egress-action-claim.js";
export type { EmailBranding } from "./channels/email-template.js";
export { renderEmailHtml, renderEmailPlainText } from "./channels/email-template.js";
// Channels
export {
  formatForChannel,
  toEmailFormat,
  toInstagramFormat,
  toMessengerFormat,
  toWhatsAppFormat,
} from "./channels/message-formatter.js";
export type { ChannelConfig, ChannelStatus, IdentityMapping, IdentityResolver } from "./channels/types.js";
export { InMemoryIdentityResolver } from "./channels/types.js";
export type { WebSocketLike } from "./channels/web-channel.js";
export { WebChannel } from "./channels/web-channel.js";
export type {
  CliDeliberationTransport,
  CliDeliberationTransportSource,
  CliSession,
  CliSessionFactory,
  CliSessionFactoryContext,
} from "./execution/cli-subscription-executor.js";
// Execution Backends
export { CliSubscriptionExecutor } from "./execution/cli-subscription-executor.js";
export type {
  AttendedTrustedExecutionLeaseApprovalBinding,
  AttendedTrustedExecutionLeaseApprovalDecision,
  AttendedTrustedExecutionLeaseApprovalPort,
  AttendedTrustedExecutionLeaseAuthorityBinding,
  AttendedTrustedExecutionLeaseAuthorityLifecycle,
  AttendedTrustedExecutionLeaseAuthorityOptions,
  AttendedTrustedExecutionLeaseIssueDenialReason,
  AttendedTrustedExecutionLeaseIssueRequest,
  AttendedTrustedExecutionLeaseIssueResult,
  AttendedTrustedExecutionLeaseUseRequest,
} from "./execution-kernel/attended-trusted-execution-lease-authority.js";
export {
  AttendedTrustedExecutionLeaseAuthority,
  TRUSTED_EXECUTION_LEASE_MAX_DURATION_MS,
} from "./execution-kernel/attended-trusted-execution-lease-authority.js";
export type {
  AttendedTrustedExecutionLeaseSessionAuthorityErrorCode,
  AttendedTrustedExecutionLeaseSessionAuthorityLifecycle,
  AttendedTrustedExecutionLeaseSessionAuthorityOptions,
  AttendedTrustedExecutionLeaseSessionBinding,
} from "./execution-kernel/attended-trusted-execution-lease-session-authority.js";
export {
  AttendedTrustedExecutionLeaseSessionAuthority,
  AttendedTrustedExecutionLeaseSessionAuthorityError,
} from "./execution-kernel/attended-trusted-execution-lease-session-authority.js";
export type { GovernedOneRoundDispatchPermit } from "./execution-kernel/dispatch-permit.js";
export type {
  AccountCapacityAcquireInput,
  AccountCapacityAcquireResult,
  AccountCapacityRecord,
  AccountCapacitySettlement,
  ExecutionAccountAffinityRequest,
  ExecutionAccountCandidateBinding,
  ExecutionAccountCapacityAuthority,
  ExecutionAccountCapacityObservation,
} from "./execution-kernel/execution-account-capacity-authority.js";
export type {
  GovernedOneRoundAdmissionEvidencePort,
  GovernedOneRoundAdmissionReceipt,
  GovernedOneRoundAffinityPolicy,
  GovernedOneRoundAttemptEvidence,
  GovernedOneRoundAttemptEvidenceSink,
  GovernedOneRoundAttemptPhase,
  GovernedOneRoundAuthorityAdmissionPort,
  GovernedOneRoundAuthorityEvidence,
  GovernedOneRoundBudgetAdmissionPort,
  GovernedOneRoundBudgetEvidence,
  GovernedOneRoundCandidate,
  GovernedOneRoundCandidateCatalog,
  GovernedOneRoundCloseout,
  GovernedOneRoundCloseoutDiagnostic,
  GovernedOneRoundCloseoutDiagnosticCode,
  GovernedOneRoundDispatchClaimPort,
  GovernedOneRoundDispatcherResolver,
  GovernedOneRoundIdentity,
  GovernedOneRoundInvocationErrorCode,
  GovernedOneRoundInvocationInput,
  GovernedOneRoundInvocationPorts,
  GovernedOneRoundInvocationResult,
  GovernedOneRoundResolvedDispatch,
  GovernedOneRoundToolExecutionMode,
} from "./execution-kernel/governed-one-round-invocation.js";
export {
  GovernedOneRoundCommittedError,
  GovernedOneRoundInvocationError,
  invokeGovernedOneRound,
} from "./execution-kernel/governed-one-round-invocation.js";
export type {
  CodexOAuthModelTurnDispatcherOptions,
  CodexOAuthModelTurnErrorCode,
  CodexOAuthResolvedCredential,
  CodexOAuthSseLimits,
} from "./execution-kernel/provider-adapters/codex-oauth-model-turn-dispatcher.js";
export {
  CODEX_OAUTH_RESPONSES_ENDPOINT,
  CODEX_OAUTH_SSE_LIMITS,
  CodexOAuthModelTurnDispatcher,
  CodexOAuthModelTurnError,
  encodeCodexOAuthResponsesRequest,
} from "./execution-kernel/provider-adapters/codex-oauth-model-turn-dispatcher.js";
export type {
  ProviderAdapterOneRoundDispatcherOptions,
  ProviderAdapterOneRoundErrorCode,
} from "./execution-kernel/provider-adapters/provider-adapter-one-round-dispatcher.js";
export {
  ProviderAdapterOneRoundDispatcher,
  ProviderAdapterOneRoundError,
} from "./execution-kernel/provider-adapters/provider-adapter-one-round-dispatcher.js";
export type { ProviderDispatchTerminalEvidence } from "./execution-kernel/provider-dispatch-terminal-error.js";
export { ProviderDispatchTerminalError } from "./execution-kernel/provider-dispatch-terminal-error.js";
export type {
  RuntimeMediaActionClaim,
  RuntimeMediaActionClaimContext,
  RuntimeMediaActionClaimId,
  RuntimeMediaActionClaimPermit,
  RuntimeMediaActionClaimRecord,
  RuntimeMediaActionClaimSettlement,
  RuntimeMediaActionClaimStatus,
  RuntimeMediaActionClaimStore,
  RuntimeMediaActionDigest,
  RuntimeMediaActionDispatchInput,
  RuntimeMediaActionKind,
  RuntimeMediaAdmissionReadInput,
} from "./execution-kernel/runtime-media-action-claim.js";
export {
  assertCanonicalSha256Id as assertRuntimeMediaActionSha256Id,
  createRuntimeMediaActionClaimContext,
  defineRuntimeMediaActionClaim,
  dispatchRuntimeMediaAction,
  prepareRuntimeMediaActionClaim,
  RuntimeMediaActionClaimedError,
  RuntimeMediaActionPreDispatchCancellationError,
  runtimeMediaActionDigest,
} from "./execution-kernel/runtime-media-action-claim.js";
export type {
  ExecutionTargetDataPolicyIdentity,
  ExecutionTargetDataPolicyInput,
  SanitizedExecutionTargetDataPolicyDecision,
  SanitizedExecutionTargetDataPolicyEvidence,
} from "./execution-routing/execution-target-data-policy-authority.js";
export {
  ExecutionTargetDataPolicyAuthority,
  ExecutionTargetDataPolicyDeniedError,
  evaluateExecutionTargetDataPolicy,
} from "./execution-routing/execution-target-data-policy-authority.js";
export type {
  OperatorAuthorityAdmissionCoordinatorOptions,
  OperatorAuthorityAdmissionSessionResolution,
} from "./execution-routing/operator-authority-admission-coordinator.js";
export { OperatorAuthorityAdmissionCoordinator } from "./execution-routing/operator-authority-admission-coordinator.js";
export { defineOperatorAuthorityAdmissionFacets } from "./execution-routing/operator-authority-admission-facets.js";
export type {
  OperatorSessionAuthorityAdmissionFacets,
  OperatorSessionAuthorityAdmissionPort,
  OperatorSessionCommittedExecution,
  OperatorSessionCommittedExecutionEvidence,
  OperatorSessionCredentialPort,
  OperatorSessionExecutionCandidate,
  OperatorSessionExecutionCandidatePort,
  OperatorSessionExecutionTargetCatalogSnapshot,
  OperatorSessionExecutionTargetCatalogSource,
  OperatorSessionExecutionDispatch,
  OperatorSessionExecutionRequest,
  OperatorSessionExecutionResult,
  OperatorSessionExecutionRoutingFailureCode,
  OperatorSessionExecutionRoutingServiceOptions,
  OperatorSessionResolvedCredential,
} from "./execution-routing/operator-session-execution-routing-service.js";
export {
  createOperatorSessionAccountCapacityAuthority,
  OperatorSessionExecutionRoutingError,
  OperatorSessionExecutionRoutingService,
  OperatorSessionPreDispatchCancellationError,
  OperatorSessionPreProviderLaunchRejectionError,
} from "./execution-routing/operator-session-execution-routing-service.js";
export type {
  OperatorTurnDispatchPayload,
  OperatorTurnDispatchPort,
  OperatorTurnDispatchRequest,
  OperatorTurnDispatchResult,
  OperatorTurnGuiDispatchPayload,
  OperatorTurnTuiDispatchPayload,
} from "./execution-routing/operator-turn-dispatcher.js";
export {
  fingerprintOperatorTurnIntent,
  OperatorSessionAuthorityAdmissionBridge,
  OperatorSessionExecutionBridge,
  OperatorTurnDispatcher,
} from "./execution-routing/operator-turn-dispatcher.js";
export type {
  AppGatewayListenerInspection,
  AppGatewayShutdownResult,
  GatewayDrainController,
} from "./gateway/app-gateway-control.js";
export {
  createGatewayDrainController,
  handleAppGatewayControlRequest,
  inspectAppGatewayListener,
  requestAppGatewayShutdown,
} from "./gateway/app-gateway-control.js";
export type {
  AppGatewayChildCredentials,
  AppGatewayLaunchDescriptor,
  AppGatewayProcessAdapter,
  AppGatewayRuntimeState,
  AppGatewaySpawnDescriptor,
  AppGatewaySupervisorDoctor,
  AppGatewaySupervisorStatus,
} from "./gateway/app-gateway-supervisor.js";
export {
  AppGatewaySupervisor,
  nodeAppGatewayProcessAdapter,
  readAppGatewayChildCredentials,
  readAppGatewayRuntimeState,
} from "./gateway/app-gateway-supervisor.js";
export type { ResolvedApp } from "./gateway/app-resolver.js";
export { resolveApps } from "./gateway/app-resolver.js";
export { createSqliteMemoryRepository } from "./gateway/memory/sqlite-repository.js";
export type { ApprovalTarget } from "./gateway/approval-registry.js";
export { ApprovalGateRegistry } from "./gateway/approval-registry.js";
export type {
  AttachedRuntimeBuiltinToolSurface,
  AttachedRuntimeBuiltinToolSurfaceOptions,
  AttachedRuntimeManagedInvocationConfig,
  AttachedRuntimeToolAdmissionProjection,
} from "./gateway/attached-runtime-tool-surface.js";
export {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
  deriveAttachedRuntimeToolAdmissionProjection,
} from "./gateway/attached-runtime-tool-surface.js";
// Auth
export { isOriginAllowed, requireApiKey, requireBearer, requireWebhookSignature } from "./gateway/auth-middleware.js";
export type { ConfiguredModelTarget, ModelMetadataRecord } from "./gateway/model-catalog-projector.js";
export { projectModelCatalog } from "./gateway/model-catalog-projector.js";
export type { BillingConfig, BudgetCheckResult, TierCheckResult } from "./gateway/budget-middleware.js";
export { checkBudget, checkTier } from "./gateway/budget-middleware.js";
export {
  CODEX_RESPONSES_COMPATIBILITY,
  type CodexResponsesNativeClientCompatibility,
  evaluateCodexResponsesNativeClient,
} from "./gateway/codex-responses-compatibility.js";
export {
  restoreGatewayContextUsageProjection,
  toGatewayContextUsageProjection,
} from "./gateway/context-usage-projection-mapper.js";
export type { DelegationRegistry, DelegationTarget } from "./gateway/delegation-handler.js";
export { executeDelegation, validateResponseSchema } from "./gateway/delegation-handler.js";
export { createDelegationRoutes } from "./gateway/delegation-routes.js";
export { isAutoReply, isIgnoredSender, shouldRejectEmail } from "./gateway/email-loop-guard.js";
export type { EmailThread, EmailThreadStore } from "./gateway/email-thread-store.js";
export { InMemoryEmailThreadStore } from "./gateway/email-thread-store.js";
export type { EmailWebhookConfig } from "./gateway/email-webhook-routes.js";
export { createEmailWebhookRoutes } from "./gateway/email-webhook-routes.js";
export type {
  ExecutionTargetWizardApplicationResult,
  ExecutionTargetWizardDiscoveryEvidence,
} from "./gateway/execution-target-wizard-handler.js";
export { executionTargetWizardDiscoveryEvidence } from "./gateway/execution-target-wizard-handler.js";
export type {
  GatewayAppConfigurationSource,
  GatewayConfigurationRevision,
  GatewayConfigurationSource,
  GatewayConfigurationTextSource,
} from "./gateway/gateway-configuration-source.js";
export { readGatewayConfigurationSource } from "./gateway/gateway-configuration-source.js";
export type { GatewayPrivateStatePaths } from "./gateway/gateway-private-state.js";
export { resolveGatewayPrivateState } from "./gateway/gateway-private-state.js";
export type { GatewayServerConfig, LoadedApp } from "./gateway/gateway-routes.js";
export { createGatewayApp } from "./gateway/gateway-routes.js";
export type {
  AppGatewayExecutionBundle,
  ModelGatewayExecutionBundle,
  StartGatewayOptions,
} from "./gateway/gateway-server.js";
export { startGateway } from "./gateway/gateway-server.js";
export type {
  GuiDashboardSnapshot,
  GuiGateway,
  GuiInboundFrame,
  GuiOutboundFrame,
  GuiProviderDescriptor,
  GuiSessionDetail,
  GuiSessionEvent,
  GuiSessionMeta,
  GuiTelemetrySnapshot,
  OperatorSessionSummary,
  StartGuiGatewayOptions,
} from "./gateway/gui-gateway.js";
export { startGuiGateway } from "./gateway/gui-gateway.js";
export type {
  ClaudeCodeExecutableResolution,
  OpenCodeExecutableResolution,
} from "./gateway/gui-provider-models.js";
export {
  buildGuiOperatorDiscoveryResults,
  buildWelcomeProviderDescriptors,
  discoverClaudeCliModelDiscovery,
  discoverCodexCliModelDiscovery,
  discoverGuiCliOperatorModels,
  discoverGuiDirectProviderModelDiscovery,
  discoverOpencodeCliModelDiscovery,
  markGuiProviderDiscoveryStale,
  projectGuiOperatorModels,
  projectGuiProviderModelDiscovery,
  providerRequiresSelectedModelMessage,
  resolveClaudeCodeExecutable,
  resolveGuiOperatorDiscoveryResults,
  resolveOpenCodeExecutable,
} from "./gateway/gui-provider-models.js";
export type { HandoffRoutesConfig } from "./gateway/handoff-routes.js";
export { createHandoffRoutes } from "./gateway/handoff-routes.js";
export type { HarnessIngressRoutesConfig } from "./gateway/harness-ingress-routes.js";
export { createHarnessIngressRoutes } from "./gateway/harness-ingress-routes.js";
export type { InstagramWebhookConfig } from "./gateway/instagram-webhook-routes.js";
export { createInstagramWebhookRoutes } from "./gateway/instagram-webhook-routes.js";
export { IntegrationExecutor } from "./gateway/integration-executor.js";
export type { ResolvedOperation } from "./gateway/integration-registry.js";
// Integration Runtime
export { IntegrationRegistry } from "./gateway/integration-registry.js";
export { LocalCredentialResolver } from "./gateway/local-credential-resolver.js";
export { createEncryptedSecretStore } from "./credentials/encrypted-secret-store.js";
export type { FileArtifactResourceStoreOptions } from "./artifacts/file-artifact-resource-store.js";
export { createFileArtifactResourceStore } from "./artifacts/file-artifact-resource-store.js";
export type {
  AcceptTrustedExecutionSemanticLimitationInput,
  RevokeTrustedExecutionSemanticLimitationInput,
} from "./security/trusted-execution-limitation-receipts.js";
export {
  acceptTrustedExecutionSemanticLimitation,
  readTrustedExecutionSemanticLimitationAcceptance,
  revokeTrustedExecutionSemanticLimitation,
} from "./security/trusted-execution-limitation-receipts.js";
export type { FilesystemDomainRegistryOptions } from "./domain/filesystem-domain-registry.js";
export { createFilesystemDomainRegistry } from "./domain/filesystem-domain-registry.js";
export type { FilesystemSkillRegistryOptions } from "./skill/filesystem-skill-registry.js";
export {
  createFilesystemSkillRegistry,
  discoverSkillsFromDirectories,
  discoverSkillsFromDirectory,
  readSkillMd,
  readSkillMdIndex,
} from "./skill/filesystem-skill-registry.js";
export { inspectSkillPackage } from "./skill/package-health.js";
export type { RuntimeKilnMcpClientOptions } from "./mcp/kiln-mcp-client.js";
export { createKilnMcpClient } from "./mcp/kiln-mcp-client.js";
export type {
  DevToolsMcpCallResult,
  DevToolsMcpListResourcesResult,
  DevToolsMcpListResourceTemplatesResult,
  DevToolsMcpServerOptions,
  DevToolsMcpToolSchema,
} from "./mcp/dev-tools-server.js";
export { DevToolsMcpServer } from "./mcp/dev-tools-server.js";
export type { QualityAnalyzeToolOptions } from "./verification/quality/quality-analyze-tool.js";
export { createQualityAnalyzeTool } from "./verification/quality/quality-analyze-tool.js";
export type {
  DafnyLogReader,
  DafnyVerificationRequest,
  DafnyVerifierOptions,
} from "./verification/dafny/dafny-verifier.js";
export { DafnyVerifier } from "./verification/dafny/dafny-verifier.js";
export type { FormalVerifyToolOptions } from "./verification/dafny/formal-verify-tool.js";
export {
  createFormalVerifyTool,
  FORMAL_VERIFY_CAPABILITY,
} from "./verification/dafny/formal-verify-tool.js";
export type { GentleAiClientOptions } from "./verification/gentle-ai/gentle-ai-client.js";
export { GentleAiClient } from "./verification/gentle-ai/gentle-ai-client.js";
export type { GentleReviewToolOptions } from "./verification/gentle-ai/gentle-review-tool.js";
export { createGentleReviewTool } from "./verification/gentle-ai/gentle-review-tool.js";
export type { OxlintAnalyzerOptions } from "./verification/oxlint/oxlint-analyzer.js";
export {
  OXLINT_ISOLATED_CONFIG,
  OXLINT_ISOLATED_CONFIG_FILE,
  OxlintAnalyzer,
} from "./verification/oxlint/oxlint-analyzer.js";
export type { StaticAnalyzeToolOptions } from "./verification/oxlint/static-analyze-tool.js";
export {
  createStaticAnalyzeTool,
  STATIC_ANALYZE_CAPABILITY,
} from "./verification/oxlint/static-analyze-tool.js";
export type {
  SkillPackageHealth,
  SkillPackageHealthOptions,
  SkillPackageHealthStatus,
  SkillPackageRiskKind,
} from "./skill/package-health.js";
export type {
  AdmittedTurnContext,
  AdmittedTurnResult,
  BudgetDeniedResult,
  CanonicalSessionEventPersistence,
  ProcessResult,
  RuntimeSessionHydrationResult,
  RuntimeSessionHydrator,
} from "./gateway/message-pipeline/index.js";
// Message Pipeline
export { processAdmittedTurn } from "./gateway/message-pipeline/index.js";
export type { MessengerWebhookConfig } from "./gateway/messenger-webhook-routes.js";
export { createMessengerWebhookRoutes } from "./gateway/messenger-webhook-routes.js";
export { validateMetaSignature, verifyMetaWebhook } from "./gateway/meta-webhook-foundation.js";
export type {
  OpenAIResponsesCapabilityIssue,
  OpenAIResponsesEventProjection,
  OpenAIResponsesModelTurnCapability,
  OpenAIResponsesModelTurnCapabilitySummary,
  OpenAIResponsesModelTurnErrorCode,
  OpenAIResponsesProjectionOmission,
} from "./gateway/openai-responses-model-turn.js";
export {
  inspectOpenAIResponsesModelTurnCapabilities,
  mapModelTurnResultToOpenAIResponsesEvents,
  mapOpenAIResponsesRequestToModelTurn,
  OpenAIResponsesModelTurnError,
  preflightOpenAIResponsesModelTurn,
} from "./gateway/openai-responses-model-turn.js";
export type {
  OpenAIResponsesRequest,
  ResponsesFailureCode,
  ResponsesSseEvent,
} from "./gateway/openai-responses-protocol.js";
export {
  createResponsesStreamState,
  encodeSseEvent,
  OPENAI_RESPONSES_PROTOCOL_LIMITS,
  OpenAIResponsesProtocolError,
  parseOpenAIResponsesRequest,
} from "./gateway/openai-responses-protocol.js";
export type {
  OpenAIResponsesCompatibilityEvidence,
  OpenAIResponsesIngressConfig,
  OpenAIResponsesObservedCorrelation,
  OpenAIResponsesResolvedVirtualModel,
  OpenAIResponsesTrustedPrincipal,
} from "./gateway/openai-responses-routes.js";
export { createOpenAIResponsesRoutes, OPENAI_RESPONSES_RAW_BODY_MAX_BYTES } from "./gateway/openai-responses-routes.js";
export type {
  OperatorExecutionTargetAdmission,
  OperatorExecutionTargetAdmissionResult,
  OperatorExecutionTargetCatalogEntry,
  OperatorExecutionTargetSelectionPort,
} from "./gateway/operator-execution-target-selection.js";
export type { OutboundRoutesConfig } from "./gateway/outbound-routes.js";
export { createOutboundRoutes } from "./gateway/outbound-routes.js";
export type { ProviderAdapterAppRuntime } from "./gateway/provider-adapter-routes.js";
export { createProviderAdapterRoutes } from "./gateway/provider-adapter-routes.js";
export type { ProviderAuthRequest, ProviderAuthResult, ProviderAuthStartResult } from "./gateway/provider-auth.js";
export { startProviderAuthRequest } from "./gateway/provider-auth.js";
export type {
  ProviderCatalogClassification,
  ProviderCatalogEvidence,
  ProviderCatalogFreshness,
  ProviderCatalogService,
  ProviderCatalogSnapshot,
} from "./gateway/provider-catalog-service.js";
export { createProviderCatalogService } from "./gateway/provider-catalog-service.js";
export type {
  NormalizedProviderCatalogObservation,
  NormalizedProviderCatalogRawEntry,
  ProviderCatalogFailureInput,
  ProviderCatalogObservationClassification,
  ProviderCatalogObservationInput,
  ProviderCatalogObservationStatus,
  ProviderCatalogRawEntryInput,
  ProviderCatalogStateEvidenceInput,
} from "./gateway/provider-model-adapters/catalog-normalization.js";
export { normalizeProviderCatalogObservation } from "./gateway/provider-model-adapters/catalog-normalization.js";
export type {
  RuntimeProviderAdapterFamily,
  RuntimeProviderCatalogInput,
  RuntimeProviderModelDiscoverySnapshot,
} from "./gateway/provider-model-adapters/runtime-discovery-catalogs.js";
export { normalizeRuntimeProviderDiscoveryCatalog } from "./gateway/provider-model-adapters/runtime-discovery-catalogs.js";
export type { RoutingTestRoutesConfig } from "./gateway/routing-test-routes.js";
export { createRoutingTestRoutes } from "./gateway/routing-test-routes.js";
export { SqliteEmailThreadStore } from "./gateway/sqlite-email-thread-store.js";
export { createSttAdapter } from "./voice/stt-factory.js";
export type { TenantAdminRoutesConfig } from "./gateway/tenant-admin-routes.js";
export { createTenantAdminRoutes } from "./gateway/tenant-admin-routes.js";
export type { TenantAppRuntime } from "./gateway/tenant-routes.js";
export { createTenantRoutes } from "./gateway/tenant-routes.js";
export type { IntegrationDeps } from "./gateway/tenant-tool-factory.js";
export { clearIntegrationDeps, configureIntegrationDeps } from "./gateway/tenant-tool-factory.js";
// Trace
export { TraceContext } from "./gateway/trace-context.js";
export { createTtsAdapter } from "./voice/tts-factory.js";
export type { TuiGateway, TuiGatewayOptions } from "./gateway/tui-gateway.js";
export { startTuiGateway } from "./gateway/tui-gateway.js";
export { WebhookDedup } from "./gateway/webhook-dedup.js";
export type { WhatsAppWebhookConfig } from "./gateway/whatsapp-webhook-routes.js";
export { createWhatsAppWebhookRoutes } from "./gateway/whatsapp-webhook-routes.js";
export type { WsTenantRoutesConfig } from "./gateway/ws-tenant-routes.js";
export { createWsTenantRoutes } from "./gateway/ws-tenant-routes.js";
export type {
  PlaywrightBrowserCaptureFrameInput,
  PlaywrightBrowserCaptureProof,
  PlaywrightBrowserCaptureRecorderOptions,
  PlaywrightBrowserCaptureTransport,
  PlaywrightBrowserExternalEditorExportOptions,
  PlaywrightBrowserExternalEditorExportProof,
  PlaywrightBrowserOperationInput,
  PlaywrightBrowserOperationStatus,
  PlaywrightBrowserRenderProof,
  PlaywrightBrowserRenderVideoOptions,
} from "./interactive/playwright-browser-capture-recorder.js";
export { PlaywrightBrowserCaptureRecorder } from "./interactive/playwright-browser-capture-recorder.js";
export type {
  InteractiveArtifactSink,
  InteractiveArtifactWrite,
  PlaywrightBrowserLiveStreamOptions,
  PlaywrightBrowserSessionState,
  PlaywrightBrowserUseProviderOptions,
} from "./interactive/playwright-browser-use-provider.js";
export {
  PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE,
  PlaywrightBrowserUseProvider,
} from "./interactive/playwright-browser-use-provider.js";
export type {
  BrowserVideoEncoder,
  BrowserVideoEncoderFrame,
  BrowserVideoEncoderInput,
  BrowserVideoEncoderResult,
  BrowserVideoOperationEvent,
  BrowserVideoOutputOptions,
  BrowserVideoSourceFrame,
  PlaywrightBrowserVideoRenderer,
  PlaywrightBrowserVideoRenderInput,
  PlaywrightBrowserVideoRenderResult,
  PlaywrightVideoEncoderModule,
  PlaywrightVideoEncoderOptions,
} from "./interactive/playwright-browser-video-renderer.js";
export {
  createPlaywrightBrowserVideoEncoder,
  createPlaywrightBrowserVideoRenderer,
  renderPlaywrightBrowserVideo,
} from "./interactive/playwright-browser-video-renderer.js";
export type {
  RecorderExternalEditorExporterOptions,
  RecorderExternalEditorExportInput,
  RecorderExternalEditorExportResult,
} from "./interactive/recorder-external-editor-exporter.js";
export { RecorderExternalEditorExporter } from "./interactive/recorder-external-editor-exporter.js";
export type {
  WindowsComputerCaptureProof,
  WindowsComputerCaptureRecorderOptions,
  WindowsComputerCaptureTransport,
  WindowsComputerOperationInput,
  WindowsComputerOperationStatus,
} from "./interactive/windows-computer-capture-recorder.js";
export { WindowsComputerCaptureRecorder } from "./interactive/windows-computer-capture-recorder.js";
export type {
  ActiveApplicationResolver,
  NutJsLoader,
  WindowsComputerUseProviderOptions,
} from "./interactive/windows-computer-use-provider.js";
export {
  NUT_JS_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE,
  WindowsComputerUseProvider,
} from "./interactive/windows-computer-use-provider.js";
export type {
  WindowsUiaComputerUseProviderOptions,
  WindowsUiaSidecarRequest,
  WindowsUiaSidecarResponse,
  WindowsUiaSidecarRunner,
} from "./interactive/windows-uia-computer-use-provider.js";
export {
  createWindowsUiaSidecarRunner,
  WINDOWS_UIA_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE,
  WindowsUiaComputerUseProvider,
} from "./interactive/windows-uia-computer-use-provider.js";
export type {
  ConfiguredCodexExecutionAccountPool,
  ConfiguredExecutionAccountRuntimeOptions,
  ConfiguredExecutionCredential,
} from "./managed-account-leases/configured-execution-account-runtime.js";
export { ConfiguredExecutionAccountRuntime } from "./managed-account-leases/configured-execution-account-runtime.js";
export type {
  AccountOutcomeIncident,
  AccountOutcomeIncidentInspectionOptions,
  ManagedAccountCandidatePort,
  ManagedAccountCandidateResolution,
  ManagedEconomicAccountLeaseEvidence,
  ManagedEconomicAuthorityDecisionEvidence,
  ManagedEconomicAuthorityRejection,
  ManagedEconomicCommitmentAcquireInput,
  ManagedEconomicCommitmentAcquireResult,
  ManagedEconomicCommitmentRecord,
  ManagedEconomicCommitmentRecoveryInput,
  ManagedEconomicCommitmentRecoveryPort,
  ManagedEconomicCommitmentRecoveryState,
  ManagedEconomicCommitmentReleaseFailureInput,
  ManagedEconomicCommitmentState,
  ManagedEconomicReplayEvidence,
  ManagedEconomicReplayInspectionPort,
  ManagedEconomicRouteCapacity,
  SharedAccountCapacityParticipantKind,
  SqliteManagedAccountLeaseAuthorityOptions,
} from "./managed-account-leases/managed-account-lease-authority.js";
export {
  readAccountOutcomeIncidents,
  SqliteManagedAccountLeaseAuthority,
} from "./managed-account-leases/managed-account-lease-authority.js";
export type {
  ManagedWriteApprovalBinding,
  ManagedWriteApprovalReceipt,
  ManagedWriteApprovalState,
} from "./managed-write-approvals/contracts.js";
export type {
  ManagedWriteApprovalErrorCode,
  SqliteManagedWriteApprovalAuthorityOptions,
} from "./managed-write-approvals/sqlite-managed-write-approval-authority.js";
export {
  ManagedWriteApprovalError,
  SQLITE_MANAGED_WRITE_APPROVAL_SCHEMA_VERSION,
  SqliteManagedWriteApprovalAuthority,
} from "./managed-write-approvals/sqlite-managed-write-approval-authority.js";
export type { GatewayMcpDeps, GatewayMcpServerOptions, GatewayMcpToolName } from "./mcp/index.js";
// MCP Server
export { GATEWAY_MCP_TOOLS, GatewayMcpServer } from "./mcp/index.js";
export type { AnthropicMessagesModelTurnCapability } from "./model-gateway/anthropic-messages-model-turn.js";
export {
  AnthropicMessagesModelTurnError,
  inspectAnthropicMessagesCapabilities,
  mapAnthropicMessagesRequestToModelTurn,
  mapModelTurnResultToAnthropicMessagesEvents,
} from "./model-gateway/anthropic-messages-model-turn.js";
export type {
  AnthropicMessagesRequest,
  AnthropicMessagesSseEvent,
} from "./model-gateway/anthropic-messages-protocol.js";
export {
  ANTHROPIC_MESSAGES_PROTOCOL_LIMITS,
  ANTHROPIC_MESSAGES_VERSION,
  AnthropicMessagesProtocolError,
  encodeAnthropicMessagesSseEvent,
  parseAnthropicMessagesRequest,
} from "./model-gateway/anthropic-messages-protocol.js";
export type {
  AnthropicMessagesIngressConfig,
  AnthropicMessagesObservedCorrelation,
  AnthropicMessagesResolvedVirtualModel,
  AnthropicMessagesTrustedPrincipal,
} from "./model-gateway/anthropic-messages-routes.js";
export { createAnthropicMessagesRoutes } from "./model-gateway/anthropic-messages-routes.js";
export {
  CODEX_COMPOSITE_PATH_PREFIX,
  type CodexCompositeFetchOptions,
  createCodexCompositeCapability,
  createCodexCompositeFetch,
} from "./model-gateway/codex-composite-router.js";
export type {
  GovernedIngressExecution,
  GovernedIngressExecutorInput,
  GovernedIngressInvocationPorts,
  ModelGatewayCompatibilityEvidence,
  ModelGatewayIngressId,
} from "./model-gateway/governed-ingress-executor.js";
export {
  executeGovernedIngress,
  GovernedIngressCommittedExecutionError,
} from "./model-gateway/governed-ingress-executor.js";
export type { LocalModelGatewayStoreOptions } from "./model-gateway/local-model-gateway-store.js";
export { LocalModelGatewayStore } from "./model-gateway/local-model-gateway-store.js";
export {
  callerOwnedToolContractForTurn,
  createModelGatewayAuthorityAdmissionPort,
} from "./model-gateway/model-gateway-authority-admission.js";
export type {
  ModelGatewayAutostartStatus,
  ModelGatewayTaskSchedulerResult,
} from "./model-gateway/model-gateway-autostart.js";
export {
  createModelGatewayAutostartDigest,
  WindowsModelGatewayAutostartAdapter,
} from "./model-gateway/model-gateway-autostart.js";
export type {
  ModelGatewayExecutionCandidatePort,
  ModelGatewayExecutionRoutingPort,
  ModelGatewayIngressHandle,
  ModelGatewayIngressOptions,
} from "./model-gateway/model-gateway-ingress.js";
export {
  createModelGatewayExecutionRoutingPort,
  createModelGatewayIngress,
} from "./model-gateway/model-gateway-ingress.js";
export type {
  ModelGatewayListenerHandle,
  ModelGatewayListenerIdentity,
  ModelGatewayListenerIdentityInput,
  ModelGatewayListenerInspection,
  ModelGatewayShutdownResult,
  StartModelGatewayListenerOptions,
} from "./model-gateway/model-gateway-listener.js";
export {
  createModelGatewayConfigDigest,
  inspectModelGatewayListener,
  MODEL_GATEWAY_HEALTH_PATH,
  MODEL_GATEWAY_HEALTH_PROTOCOL_VERSION,
  MODEL_GATEWAY_SHUTDOWN_PATH,
  requestModelGatewayShutdown,
  startModelGatewayListener,
} from "./model-gateway/model-gateway-listener.js";
export type {
  ModelGatewayHostIdentity,
  ModelGatewayHostRuntimeKind,
  ModelGatewayHostSource,
  ModelGatewayLaunchDescriptor,
  ModelGatewayProcessAdapter,
  ModelGatewayRuntimeState,
  ModelGatewaySpawnDescriptor,
  ModelGatewaySupervisorDoctor,
  ModelGatewaySupervisorStatus,
} from "./model-gateway/model-gateway-supervisor.js";
export {
  ModelGatewaySupervisor,
  nodeModelGatewayProcessAdapter,
  validateModelGatewayHostIdentity,
} from "./model-gateway/model-gateway-supervisor.js";
export type {
  ModelGatewayReplayClaim,
  ModelGatewayReplayFence,
  ModelGatewayReplayKey,
} from "./model-gateway/replay-claim.js";
export {
  claimModelGatewayReplayAction,
  completeModelGatewayReplayClaim,
  createModelGatewayReplayClaim,
  persistModelGatewayReplayAdmission,
  settleModelGatewayReplayClaimUnknown,
} from "./model-gateway/replay-claim.js";
export type {
  ModelGatewayAdmissionReceipt,
  ModelGatewayReplayActionInput,
  ModelGatewayReplayCompletedValue,
  ModelGatewayReplayDecision,
  ModelGatewayReplayFingerprintInput,
  ModelGatewayReplayGuard,
} from "./model-gateway/replay-guard.js";
// Observability
export { CompositeEventStore } from "./observability/composite-event-store.js";
export type { PrometheusCollectorConfig } from "./observability/prometheus-collector.js";
export { PrometheusCollector } from "./observability/prometheus-collector.js";
export type {
  OperatorSurfaceController,
  OperatorSurfaceThemeController,
} from "./operator/operator-surface-controller.js";
export type {
  OperatorRuntimeApplicationCommand,
  OperatorRuntimeListener,
  OperatorRuntimeListenerFetch,
  OperatorRuntimeListenerInspection,
  OperatorRuntimeMcpRequest,
  OperatorRuntimeSessionOpenInput,
  OperatorRuntimeSessionOpenResult,
  StartOperatorRuntimeListenerOptions,
} from "./operator-runtime/operator-listener.js";
export {
  inspectOperatorRuntimeListener,
  OPERATOR_RUNTIME_APPLICATION_PATH,
  OPERATOR_RUNTIME_BINDING_HEADERS,
  OPERATOR_RUNTIME_CONTROL_TOKEN_HEADER,
  OPERATOR_RUNTIME_HEALTH_PATH,
  OPERATOR_RUNTIME_INSPECTION_MAX_RESPONSE_BYTES,
  OPERATOR_RUNTIME_INSPECTION_MAX_TIMEOUT_MS,
  OPERATOR_RUNTIME_MCP_PATH,
  OPERATOR_RUNTIME_REQUEST_MAX_BYTES,
  OPERATOR_RUNTIME_SESSION_PATH,
  OPERATOR_RUNTIME_SESSION_REQUEST_MAX_BYTES,
  startOperatorRuntimeListener,
} from "./operator-runtime/operator-listener.js";
export type {
  OperatorSessionCredentialErrorCode,
  OperatorSessionExpectedBinding,
  OperatorSessionVerificationOptions,
} from "./operator-runtime/operator-session-auth.js";
export {
  OPERATOR_SESSION_CLOCK_SKEW_SECONDS,
  OPERATOR_SESSION_CREDENTIAL_ERROR_CODES,
  OPERATOR_SESSION_CREDENTIAL_VERSION,
  OPERATOR_SESSION_MAX_LIFETIME_SECONDS,
  OPERATOR_SESSION_MIN_SECRET_BYTES,
  OperatorSessionCredentialError,
  signOperatorSessionCredential,
  verifyOperatorSessionCredential,
} from "./operator-runtime/operator-session-auth.js";
export type {
  OperatorRuntimeBridgeCredentials,
  OperatorRuntimeChildCredentials,
  OperatorRuntimeCredentialMaterial,
  OperatorRuntimeLaunchDescriptor,
  OperatorRuntimeListenerInspector,
  OperatorRuntimeProcessAdapter,
  OperatorRuntimeSpawnDescriptor,
  OperatorRuntimeState,
  OperatorRuntimeSupervisorDoctor,
  OperatorRuntimeSupervisorReason,
  OperatorRuntimeSupervisorStatus,
} from "./operator-runtime/operator-supervisor.js";
export {
  nodeOperatorRuntimeProcessAdapter,
  OperatorRuntimeSupervisor,
  readOperatorRuntimeBridgeCredentials,
  readOperatorRuntimeChildCredentials,
} from "./operator-runtime/operator-supervisor.js";
export type {
  ProjectRuntimeFactory,
  ProjectRuntimeOwner,
  ProjectRuntimeRegistryDescriptor,
  ProjectRuntimeRegistryErrorCode,
} from "./operator-runtime/project-runtime-registry.js";
export { ProjectRuntimeRegistry, ProjectRuntimeRegistryError } from "./operator-runtime/project-runtime-registry.js";
export type {
  ContextUsageRawUsage,
  ContextUsageWindowEvidence,
  NormalizeContextUsageProjectionInput,
} from "./session/context-usage-projection.js";
// Context-usage projection (runtime normalization boundary)
export {
  normalizeContextUsageProjection,
  restoreContextUsageProjection,
} from "./session/context-usage-projection.js";
export type {
  AgentTurnEntry,
  AuthorityAdmissionEvidenceStore,
  DefaultEscalationDetectorConfig,
  EconomicCommitmentReference,
  EffectiveAuthorityAdmissionBundle,
  EffectiveAuthorityAdmissionBundleInput,
  EffectiveTurnAuthorityPolicyInput,
  EffectiveTurnAuthorityPolicyInputSource,
  EffectiveTurnAuthorityPolicyInputStatus,
  EffectiveTurnAuthoritySnapshot,
  EscalationDetector,
  EscalationSignal,
  ExecutionAdmission,
  GovernedTurnOutcomeToolRecord,
  OperatorAdoptionDecisionPersistence,
  OperatorAdoptionRuntimeBinding,
  OrchestrateResult,
  OrchestratorDeps,
  PerCallToolConfig,
  PreparedOperatorAdoptionTurn,
  ProjectRuntimeLifecycleAttributionAllocationsInput,
  RedisLike,
  RuntimeAuthorityAdmissionCandidateConfig,
  RuntimeBuiltinToolExecutionContext,
  RuntimeConfigurationRevisionProvider,
  RuntimeConfigurationRevisionSnapshot,
  RuntimeConvergencePolicyOverrides,
  RuntimeConversationExecutionEnvelope,
  RuntimeExecutionEnvelope,
  RuntimeFeedbackEvidenceCollectorInput,
  RuntimeMonotonicClock,
  RuntimeProviderRequestCompletion,
  RuntimeLifecycleFinalOutputBoundary,
  RuntimeModelRoundActionClaim,
  RuntimeModelRoundActionClaimId,
  RuntimeModelRoundActionClaimPermit,
  RuntimeModelRoundActionClaimStore,
  RuntimeModelRoundAdmissionId,
  RuntimeModelRoundAdmissionReceipt,
  RuntimeModelRoundDigest,
  RuntimeModelRoundDispatchContext,
  RuntimeModelRoundDispatchInput,
  RuntimeModelRoundDispatchState,
  RuntimeSessionAuthorityFacet,
  RuntimeSessionAuthorityFacetInput,
  RuntimeSessionConfig,
  RuntimeSessionTokenUsageReader,
  RuntimeSessionTurnBudgetAuthority,
  RuntimeTurnProgressBatch,
  RuntimeResolvedExecutionEnvelope,
  RuntimeHostToolEnforcement,
  RuntimeToolActionAdmissionReceipt,
  RuntimeToolActionClaim,
  RuntimeToolActionClaimId,
  RuntimeToolActionClaimPermit,
  RuntimeToolActionClaimStore,
  RuntimeToolActionClaimsContext,
  RuntimeToolActionDigest,
  RuntimeToolActionDispatchInput,
  RuntimeToolActionDispatchState,
  SerializedSessionData,
  SessionMode,
  SessionStore,
  SkillCatalogAdmission,
  ToolExecutionSummary,
  ToolPermissionAdmission,
  ToolPermissionAdmissionEntry,
  ToolPermissionAdmissionProjectionInput,
  TurnBudgetAdmission,
  WorkGovernanceAdmission,
} from "./session/index.js";
// Session
export {
  assertPersistableAuthorityAdmissionBundle,
  assertRuntimeToolActionClaim,
  assertRuntimeHostToolEnforcement,
  buildEffectiveTurnAuthorityPolicyInputs,
  captureRuntimeConfigurationRevision,
  collectRuntimeFeedbackEvidence,
  createRedisSessionStore,
  createRuntimeModelRoundPermitId,
  createRuntimeToolActionPermitId,
  createRuntimeHostToolEnforcement,
  DefaultAgentHandoffSummarizer,
  DefaultContextSummarizer,
  DefaultEscalationDetector,
  defineEffectiveAuthorityAdmissionBundle,
  defineRuntimeModelRoundActionClaim,
  defineRuntimeSessionAuthorityFacet,
  defineRuntimeToolActionClaim,
  deriveRuntimeConvergencePolicyInput,
  deriveGovernedTurnOutcome,
  deriveGovernedTurnOutcomeFromToolRecords,
  describeEffectiveTurnAuthorityActionability,
  deserializeSession,
  formatEffectiveTurnAuthorityGuidance,
  getProjectContextArtifactCache,
  hasGovernedGoalTools,
  InMemorySessionStore,
  isGovernedGoalToolName,
  isValidTransition,
  ProjectContextArtifactCache,
  prepareOperatorAdoptionTurn,
  projectRuntimeLifecycleAttributionAllocations,
  projectToolPermissionAdmissionFromPerCallConfig,
  RedisSessionStore,
  RuntimeModelRoundDispatchService,
  RuntimeSession,
  RuntimeSessionOrchestrationSurface,
  RuntimeSessionOrchestrator,
  RuntimeSessionTurnBudgetService,
  RuntimeTurnConvergenceObservationCollector,
  RuntimeTurnProgressClassifier,
  defaultRuntimeMonotonicClock,
  RuntimeToolActionDispatchService,
  readExecutionBinding,
  readExecutionConfigurationRevision,
  readExecutionOperatorAdoptionDecision,
  readExecutionTarget,
  readExecutionToolAllowlist,
  readExecutionToolAuthority,
  readExecutionTurnAuthority,
  readExecutionTurnId,
  readRuntimeModelRoundAdmission,
  requireExecutionAuthorityAdmission,
  requireOperatorAdoptionDecisionPersistence,
  runtimeModelRoundEffectIdentity,
  runtimeToolActionClaimIdFor,
  runtimeToolActionEffectIdentity,
  resolveRuntimeExecutionEnvelope,
  RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY,
  RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_ID,
  RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
  SessionRegistry,
  serializeSession,
  transitionSessionMode,
  wordOverlapSimilarity,
} from "./session/index.js";
export type { AsyncAgentResolverDeps, ResolvedAgentContext } from "./tenant/agent-resolver.js";
export { buildAgentSystemPrompt, resolveAgentContext, resolveAgentContextAsync } from "./tenant/agent-resolver.js";
export type { PingPongCheckResult } from "./tenant/ping-pong-guard.js";
export { checkPingPong } from "./tenant/ping-pong-guard.js";
export type { ParsedResponse } from "./tenant/suggestion-parser.js";
export { extractSuggestions, stripSuggestionTags } from "./tenant/suggestion-parser.js";
export { buildTenantSystemPrompt } from "./tenant/system-prompt-builder.js";
// Tenant
export { TenantNotFoundError, TenantRegistry, TenantValidationFailedError } from "./tenant/tenant-registry.js";
export type { RoutingResult, TenantRouter } from "./tenant/tenant-router.js";
export { DefaultTenantRouter } from "./tenant/tenant-router.js";
export type { EventListenerConfig } from "./trigger/event-listener.js";
export { EventListener, matchesFilter } from "./trigger/event-listener.js";
export type { ScheduleEntry } from "./trigger/scheduler.js";
export { Scheduler } from "./trigger/scheduler.js";
export type { TriggerExecutionContext } from "./trigger/trigger-executor.js";
export { executeTrigger, interpolateTemplate } from "./trigger/trigger-executor.js";
export type { TriggerRegistryConfig } from "./trigger/trigger-registry.js";
// Triggers
export { TriggerRegistry } from "./trigger/trigger-registry.js";
export type { WebhookHandlerConfig } from "./trigger/webhook-handler.js";
export { createWebhookHandler, validateWebhookSignature } from "./trigger/webhook-handler.js";
// Utils
export { verifyHmacSha256 } from "./utils/hmac.js";
export { SpawnCommandProcessRunner } from "./tools/spawn-command-process-runner.js";
export { nodeQualityGateCommandExecutor } from "./tools/quality-gate-command-executor.js";
export { nodeBuiltinFilesystem } from "./tools/node-builtin-filesystem.js";
export {
  NodePhysicalPathResolver,
  nodePhysicalPathResolver,
} from "./tools/node-physical-path-resolver.js";
export {
  detectRuntimeToolEnvironment,
  runNativeCommand,
  runNativeGitCommand,
  runNativeTesseractOcr,
} from "./tools/native-command-execution.js";
export {
  createDefaultBuiltinToolSurface,
  createSessionBuiltinToolOptions,
} from "./tools/default-builtin-tool-surface.js";
export type { NativeFetchImplementation, NativeWebFetchClientOptions } from "./web/native-web-fetch-client.js";
export { createNativeWebFetchClient } from "./web/native-web-fetch-client.js";
export {
  isRuntimeOwnedFormalVerificationFinishInvocation,
  readRuntimeFormalVerificationFinishTransport,
} from "./work-governance/formal-verification-invocation-state.js";
export type {
  BoundedWorkAuthorityErrorCode,
  BoundedWorkAuthorityProjectionState,
  BoundedWorkReservationReceipt,
  BoundedWorkReservationResult,
  BoundedWorkReservationState,
  BoundedWorkRouteIdentity,
  BoundedWorkTerminalOutcome,
  RuntimeFormalVerificationObservation,
  SqliteBoundedWorkAuthorityOptions,
} from "./work-governance/index.js";
// Bounded-work runtime authority
export {
  BoundedWorkAuthorityError,
  captureArtifactCandidate,
  captureExternalStateCandidate,
  captureGitWorktreeCandidate,
  resolveCandidateSubjectDigests,
  SQLITE_BOUNDED_WORK_AUTHORITY_SCHEMA_VERSION,
  SqliteBoundedWorkAuthority,
} from "./work-governance/index.js";
