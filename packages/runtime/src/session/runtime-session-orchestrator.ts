import type {
  ContentPart,
  EventBus,
  ProviderRequestToolMaterializationDecisionEvidence,
  ToolCall,
  ToolDefinition,
  ProviderExecutionContext,
  ProviderExecutionRequestedAuthority,
  AgentResponse,
  ProviderAdapter,
  CreateMessageOptions,
  SessionTurnOutcome,
} from "@kilnai/core";
import {
  accountedWorkItemEvidence,
  assertValidToolCallIds,
  estimateTextTokens,
  extractText,
  getInvalidToolInputDetails,
  KilnError,
  normalizeToolCall,
  decideTurnConvergence,
  resolveRequiredProducerObligations,
  resolveExecutionIdentity,
  textParts,
  type ProviderRequestEvidence,
  projectConversationForModel,
} from "@kilnai/core";
import {
  isManagedInvocationRecoveryPauseRequirementId,
  MANAGED_INVOCATION_HANDOFF_RECOVERY_PAUSE_BASE_ID,
} from "../agents/managed-invocation/phase-recovery.js";
import type { RuntimeSession } from "./runtime-session.js";
import {
  projectRuntimeCapabilityDiscoveryTools,
  readRuntimeCapabilityDescribeExecutionMetadata,
  RUNTIME_CAPABILITY_DISCOVERY_TOOLS,
  runtimeCapabilityToolDefinitionDigest,
  type RuntimeCapabilityDescribeExecutionMetadata,
  type RuntimeCapabilityGeneration,
  type RuntimeCapabilityMaterializedTool,
  type RuntimeCapabilityTurnBinding,
} from "../capabilities/runtime-capability-composition.js";
import {
  admitProgressiveTool,
  readProgressiveToolCatalogSearchMetadata,
  type ProgressiveToolAdmissionDecision,
} from "./progressive-tool-admission.js";
import { RuntimeSessionApprovalGate } from "./runtime-session-orchestrator-approvals.js";
import { finalizeRuntimeSessionResponse } from "./runtime-session-orchestrator-response.js";
import {
  resolveRuntimeSessionRouting,
  type RuntimeMultimodalEffectAdmission,
  type RuntimeSessionRoutingResolution,
} from "./runtime-session-orchestrator-routing.js";
import { deriveGovernedTurnOutcome } from "./governed-turn-outcome.js";
import {
  buildProviderRequestToolProjectionEvidence,
  measureProviderRequestRegions,
  type ProviderRequestCachePartitionInput,
  RuntimeSessionExecutionTelemetry,
} from "./runtime-session-orchestrator-telemetry.js";
import {
  assessRuntimeCompletionObligations,
  formatRuntimeCompletionObligationFailure,
} from "./runtime-completion-obligations.js";
import {
  RuntimeSessionToolExecutor,
  type RuntimeSessionToolBlock,
} from "./runtime-session-orchestrator-tool-executor.js";
import {
  buildRuntimeTurnSystemPrompt,
  appendRuntimeCommunicationPromptManifest,
  reconcileRuntimeInvocationPromptManifest,
} from "./support/index.js";
import {
  resolveRuntimeExecutionEnvelope,
  type RuntimeResolvedExecutionEnvelope,
} from "./runtime-execution-envelope.js";
import {
  assessRuntimeTemporalEvidence,
  shouldRequestTemporalEvidenceRecovery,
  temporalEvidenceRefusal,
  temporalEvidenceRecoveryInstruction,
} from "./support/context/runtime-temporal-evidence-guard.js";
import type {
  OrchestratorDeps,
  OrchestrateResult,
  GovernedRuntimeContext,
  PerCallToolConfig,
  RuntimeBuiltinToolExecutor,
  ToolExecutionSummary,
  EffectiveTurnAuthoritySnapshot,
} from "./runtime-session-orchestrator.types.js";
import type { EscalationSignal } from "./support/escalation/escalation-detector.js";
import type {
  CompletionEligibility,
  IneligibleCompletionSettlementEvidence,
  EligibleCompletionSettlementEvidence,
  TurnConvergenceEvidence,
  ResolvedTurnConvergencePolicy,
  TurnProgressEvidence,
  TurnConvergenceDecision,
  TurnConvergencePauseDecision,
  RuntimeTurnTerminalDisposition,
} from "@kilnai/core/agents";
import { RuntimeTurnConvergenceObservationCollector } from "./runtime-turn-convergence-observation.js";
import {
  RuntimeTurnProgressClassifier,
  type RuntimeTurnProgressBatch,
} from "./runtime-turn-progress-classifier.js";
import {
  RuntimeModelRoundDispatchService,
  runtimeModelRoundEffectIdentity,
} from "../execution-kernel/runtime-model-round-action-claim.js";
import {
  readExecutionBinding,
  readExecutionToolAllowlist,
  readExecutionTurnAuthority,
  readExecutionTurnId,
} from "./effective-authority-admission-bundle.js";

const GOVERNED_WORK_ITEM_SETUP_TOOLS = new Set([
  "work_governance.assess",
  "work_profile.list",
  "work_item.list",
  "work_item.update",
]);

class SessionTurnBudgetDenied extends Error {
  constructor(readonly message: string) {
    super(message);
  }
}

interface GovernedWorkMaterializationProgress {
  readonly requiredWorkItemCount: number;
  readonly workItemIds: ReadonlySet<string>;
  readonly goalCreated: boolean;
}

function projectProviderRequestedAuthority(
  authority: EffectiveTurnAuthoritySnapshot,
): ProviderExecutionRequestedAuthority {
  switch (authority.admittedAuthority) {
    case "destructive":
      return "destructive";
    case "audited":
      return "audited";
    default:
      return "read_only";
  }
}

function buildProviderExecutionContext(
  config: PerCallToolConfig | undefined,
): ProviderExecutionContext | undefined {
  const authority = readExecutionTurnAuthority(config);
  const executionBinding = readExecutionBinding(config);
  if (!config?.workingDirectory
    && !authority
    && !config?.executionScope
    && !executionBinding
    && config?.executionCredential === undefined) {
    return undefined;
  }
  return {
    ...(config?.workingDirectory ? { workingDirectory: config.workingDirectory } : {}),
    ...(authority
      ? { requestedAuthority: projectProviderRequestedAuthority(authority) }
      : {}),
    ...(config?.executionScope ? { executionScope: config.executionScope } : {}),
    ...(executionBinding ? { executionBinding } : {}),
    ...(config?.executionCredential !== undefined ? { executionCredential: config.executionCredential } : {}),
  };
}

export type {
  OrchestratorDeps,
  OrchestrateResult,
  GovernedRuntimeContext,
  EffectiveTurnAuthorityPolicyInput,
  EffectiveTurnAuthorityPolicyInputSource,
  EffectiveTurnAuthorityPolicyInputStatus,
  EffectiveTurnAuthoritySnapshot,
  PerCallToolConfig,
  RuntimeAuthorityAdmissionCandidateConfig,
  RuntimeExecutionEnvelope,
  RuntimeConversationExecutionEnvelope,
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
  ToolExecutionSummary,
} from "./runtime-session-orchestrator.types.js";

export class RuntimeSessionOrchestrator {
  private readonly executionEnvelope: RuntimeResolvedExecutionEnvelope;
  private _tools: readonly ToolDefinition[] | undefined;
  private readonly approvalGate: RuntimeSessionApprovalGate;
  private readonly telemetry: RuntimeSessionExecutionTelemetry;

  constructor(
    private readonly deps: OrchestratorDeps,
    approvalGate?: RuntimeSessionApprovalGate,
  ) {
    this.executionEnvelope = resolveRuntimeExecutionEnvelope(deps.executionEnvelope);
    this._tools = deps.tools;
    this.approvalGate = approvalGate ?? new RuntimeSessionApprovalGate(deps.eventBus);
    this.telemetry = new RuntimeSessionExecutionTelemetry(
      resolveExecutionIdentity({
        configuredProvider: deps.provider.name,
        configuredModel: deps.model,
      }),
      deps.eventBus,
    );
  }

  get model(): string | undefined {
    return this.telemetry.currentModel ?? this.deps.model;
  }

  get eventBus(): EventBus | undefined {
    return this.deps.eventBus;
  }

  /** Rebinds the same execution surface to the exact post-fence provider selected by admission. */
  bindProvider(provider: ProviderAdapter, model = this.deps.model): RuntimeSessionOrchestrator {
    return new RuntimeSessionOrchestrator({
      ...this.deps,
      provider,
      ...(model ? { model } : {}),
      tools: this._tools,
    }, this.approvalGate);
  }

  emitApprovalRequested(description: string, sessionId: string, approvalId: string): void {
    this.approvalGate.emitApprovalRequested(description, sessionId, approvalId);
  }

  emitApprovalReceived(approved: boolean, reason: string | undefined, approvalId: string): void {
    this.approvalGate.emitApprovalReceived(approved, reason, approvalId);
  }

  continue(approvalId: string): void {
    this.approvalGate.continue(approvalId);
  }

  get tools(): readonly ToolDefinition[] | undefined {
    return this._tools;
  }

  registerTools(newTools: readonly ToolDefinition[]): void {
    const existing = this._tools ?? [];
    const names = new Set(existing.map((tool) => tool.name));
    const additions = newTools.filter((tool) => !names.has(tool.name));
    if (additions.length > 0) {
      this._tools = [...existing, ...additions];
    }
  }

  async processMessage(
    session: RuntimeSession,
    userParts: readonly ContentPart[],
    governedContext?: GovernedRuntimeContext,
    callBuiltinTools?: ReadonlyMap<string, RuntimeBuiltinToolExecutor>,
    perCallConfig?: PerCallToolConfig,
  ): Promise<OrchestrateResult> {
    if (session.sessionMode !== "ai_active") {
      if (session.sessionMode === "resolved") {
        session.setSessionMode("ai_active");
      } else {
        session.addUserMessage(userParts);
        return {
          parts: [],
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          queued: true,
          outcome: "paused",
          dispositionReason: "session_not_active",
        };
      }
    }

    let escalation = this.detectPreLlmEscalation(userParts);
    const executionEnvelope = perCallConfig?.executionEnvelope !== undefined
      ? resolveRuntimeExecutionEnvelope(perCallConfig.executionEnvelope)
      : this.executionEnvelope;
    const turnObservation = new RuntimeTurnConvergenceObservationCollector(this.deps.monotonicNow);
    const progressClassifier = new RuntimeTurnProgressClassifier();

    const systemManifest = buildRuntimeTurnSystemPrompt(
      session,
      governedContext,
      perCallConfig?.temporalContext,
    );
    const capabilityBindingResolution = bindCapabilityGenerationForAdmission(
      this.deps.capabilityGeneration,
      perCallConfig?.authorityAdmission,
    );
    const capabilityBinding = capabilityBindingResolution.binding;
    const initialTools = projectRuntimeCapabilityToolsForBinding(
      this._tools,
      capabilityBinding,
      capabilityBindingResolution.failure !== undefined,
    );
    let routing: RuntimeSessionRoutingResolution;
    try {
      routing = await resolveRuntimeSessionRouting(
        this.deps,
        session,
        userParts,
        systemManifest.finalPrompt,
        initialTools,
        perCallConfig,
        (sessionId, decision) => this.telemetry.emitModelRouted(sessionId, decision),
        async (sessionId) => this.admitMultimodalEffect(
          sessionId,
          executionEnvelope.convergence,
          turnObservation,
        ),
        (sessionId, route) => this.telemetry.emitMultimodalRouted(sessionId, route),
      );
    } catch (error) {
      if (!(error instanceof SessionTurnBudgetDenied)) {
        throw error;
      }
      session.addUserMessage(userParts);
      return this.finalizeSessionTurnBudgetDenial({
        session,
        denial: error,
        toolExecutions: [],
        convergence: buildConvergenceEvidence(executionEnvelope.convergence, []),
        preLlmEscalation: escalation,
      });
    }

    // Delegated multimodal work can outlive the route-resolution await. Recheck
    // the admitted turn signal before any route result is converted into a
    // terminal Runtime response.
    throwIfRuntimeTurnAborted(perCallConfig?.abortSignal);

    // Routing merges per-call additions after the initial projection. Apply
    // the reservation again to that final surface so a caller cannot
    // reintroduce a discovery shadow through additionalTools.
    const projectedRoutingTools = projectRuntimeCapabilityToolsForBinding(
      routing.effectiveTools,
      capabilityBinding,
      capabilityBindingResolution.failure !== undefined,
    );
    const allowlistedRoutingTools = projectedRoutingTools?.filter((tool) =>
      readExecutionToolAllowlist(perCallConfig).has(tool.name));
    if (allowlistedRoutingTools !== routing.effectiveTools) {
      routing = {
        ...routing,
        effectiveTools: allowlistedRoutingTools,
        hasTools: routing.hasTools && (allowlistedRoutingTools?.length ?? 0) > 0,
      };
    }

    if (routing.convergencePause) {
      session.addUserMessage(userParts);
      return this.finalizeTurnConvergencePause({
        session,
        executionEnvelope,
        decision: routing.convergencePause,
        progressEvidence: progressClassifier.chronologicalEvidence,
        toolExecutions: [],
        routingDecision: toPublicRoutingDecision(routing.routingDecision),
        communicationResolution: routing.communicationResolution,
        preLlmEscalation: escalation,
      });
    }

    const admittedUserParts = routing.transformedUserParts ?? userParts;
    const completionObligations = resolveRequiredProducerObligations(extractText(admittedUserParts));
    // Completion availability must describe the exact surface admitted for
    // this turn. `routing.effectiveTools` is the initial provider surface
    // after the canonical authority allowlist has been applied; materializable
    // tools use the same allowlist projection. Do not consult the raw Runtime
    // registry here, because it also contains authority-denied producers.
    const admittedMaterializableTools = materializableToolsForEvidence(
      this.deps.materializableTools,
      readExecutionToolAllowlist(perCallConfig),
    );
    const availableCanonicalToolIds = new Set([
      ...(routing.effectiveTools ?? []).map((tool) => tool.name),
      ...(admittedMaterializableTools?.keys() ?? []),
    ]);
    session.addUserMessage(admittedUserParts);
    const turnId = resolveRuntimeTurnId(session, perCallConfig);

    const toolExecutions: ToolExecutionSummary[] = [...(routing.preModelToolExecutions ?? [])];
    for (const execution of toolExecutions) {
      turnObservation.recordToolExecutionDuration(execution.durationMs);
    }
    if (toolExecutions.length > 0) {
      recordRuntimeToolBatchProgress(
        progressClassifier,
        turnObservation,
        [],
        toolExecutions,
        [],
      );
    }
    if (routing.delegatedMultimodalResult) {
      turnObservation.recordToolExecutionDuration(routing.delegatedMultimodalResult.toolExecution.durationMs);
      const delegatedToolExecutions = [
        ...toolExecutions,
        routing.delegatedMultimodalResult.toolExecution,
      ];
      recordRuntimeToolBatchProgress(
        progressClassifier,
        turnObservation,
        [],
        [routing.delegatedMultimodalResult.toolExecution],
        [],
      );
      const completionAssessment = assessRuntimeCompletionObligations(
        completionObligations,
        availableCanonicalToolIds,
        delegatedToolExecutions,
      );
      const delegatedConvergence = buildConvergenceEvidence(
        executionEnvelope.convergence,
        progressClassifier.chronologicalEvidence,
      );
      const disposition = completionDisposition(
        completionAssessment.eligibility,
        completionAssessment.evidence,
        completionAssessment.obligations,
        delegatedConvergence,
        deriveGovernedTurnOutcome({ toolExecutions: delegatedToolExecutions }),
      );
      return finalizeRuntimeSessionResponse({
        deps: this.deps,
        session,
        parts: completionAssessment.eligibility.status === "ineligible"
          ? textParts(formatRuntimeCompletionObligationFailure(completionAssessment.eligibility))
          : routing.delegatedMultimodalResult.parts,
        usage: {
          inputTokens: routing.delegatedMultimodalResult.inputTokens,
          outputTokens: routing.delegatedMultimodalResult.outputTokens,
          cacheReadTokens: routing.delegatedMultimodalResult.cacheReadTokens,
          cacheWriteTokens: routing.delegatedMultimodalResult.cacheWriteTokens,
        },
        usageTotals: {
          inputTokens: routing.delegatedMultimodalResult.inputTokens,
          outputTokens: routing.delegatedMultimodalResult.outputTokens,
          cacheReadTokens: routing.delegatedMultimodalResult.cacheReadTokens,
          cacheWriteTokens: routing.delegatedMultimodalResult.cacheWriteTokens,
        },
        toolExecutions: delegatedToolExecutions,
        routingDecision: toPublicRoutingDecision(routing.routingDecision),
        communicationResolution: routing.communicationResolution,
        disposition,
        preLlmEscalation: escalation,
      });
    }
    const runtimeCapabilityExecutors = capabilityBinding?.createDiscoveryToolExecutors();
    const effectiveBuiltinTools = mergeRuntimeBuiltinTools(
      callBuiltinTools,
      runtimeCapabilityExecutors,
    );
    // Keep the merged capability map mutable inside this turn. Discovery
    // executors are installed before the first provider round; a selected
    // capability's exact private materialization closure is installed only
    // after its describe evidence has been validated for the next round.
    const mutableCapabilityExecutors = effectiveBuiltinTools instanceof Map
      ? effectiveBuiltinTools
      : undefined;
    const callerOwnedBuiltinToolNames = new Set<string>([
      ...(callBuiltinTools?.keys() ?? []),
      ...(this.deps.builtinTools?.keys() ?? []),
    ]);
    const capabilityToolBlocks = buildRuntimeCapabilityToolBlocks({
      binding: capabilityBinding,
      bindingFailure: capabilityBindingResolution.failure,
      baseTools: routing.effectiveTools,
      materializableTools: this.deps.materializableTools,
      callerOwnedBuiltinToolNames,
    });
    const projectedRoundCapabilityToolBlocks = materializationBlocksForProjectedRound(capabilityToolBlocks);
    const toolExecutor = new RuntimeSessionToolExecutor(
      this.deps,
      this.deps.eventBus,
      (sessionId, description, hasLiveAuthoritySource = true) =>
        hasLiveAuthoritySource
          ? this.approvalGate.requestApproval(sessionId, description)
          : Promise.resolve(this.approvalGate.requestImmediateDenial(
              sessionId,
              description,
              "No approval authority is configured for this capability",
            )),
      (sessionId, message) => this.telemetry.emitError(sessionId, message),
      effectiveBuiltinTools,
      capabilityToolBlocks,
    );
    const invocationPromptManifest = appendRuntimeCommunicationPromptManifest(
      reconcileRuntimeInvocationPromptManifest(systemManifest, routing.invocationSystem),
      routing.communicationResolution,
    );
    let projectedRoundTools = routing.effectiveTools;
    let pendingMaterializationDecisions: readonly ProviderRequestToolMaterializationDecisionEvidence[] = [];

    let managedInvocationTransitionReserveUsed = false;
    let temporalEvidenceRecoveryRequested = false;
    let round = 0;
    while (true) {
      const governedWorkProgress = readGovernedWorkMaterializationProgress(
        perCallConfig?.governedWorkRequirement,
        toolExecutions,
        turnId,
      );
      const pendingTransitionForRound = pendingManagedInvocationTransition(toolExecutions);
      const transitionOnlyRound = turnObservation.snapshot().toolRounds >= executionEnvelope.convergence.toolRounds;
      throwIfRuntimeTurnAborted(perCallConfig?.abortSignal);
      const sessionTurnBudget = await this.checkBudget(session.id);
      if (!sessionTurnBudget.allowed) {
        return this.finalizeSessionTurnBudgetDenial({
          session,
          denial: new SessionTurnBudgetDenied(
            sessionTurnBudget.message ?? "Session token observation denied.",
          ),
          toolExecutions,
          convergence: buildConvergenceEvidence(
            executionEnvelope.convergence,
            progressClassifier.chronologicalEvidence,
          ),
          routingDecision: toPublicRoutingDecision(routing.routingDecision),
          communicationResolution: routing.communicationResolution,
          preLlmEscalation: escalation,
        });
      }

      const transitionToolsForRound = routing.hasTools
        ? managedInvocationTransitionToolsForRound(
            projectedRoundTools,
            transitionOnlyRound ? pendingTransitionForRound : undefined,
          )
        : undefined;
      const toolsForRound = governedWorkProgress && !governedWorkProgress.goalCreated
        ? governedWorkMaterializationToolsForRound(transitionToolsForRound, governedWorkProgress)
        : transitionToolsForRound;
      if (
        transitionOnlyRound
        && pendingTransitionForRound
        && !managedInvocationTransitionToolIsAdmitted(toolsForRound, pendingTransitionForRound, perCallConfig)
      ) {
        return finalizeManagedInvocationTransitionRequired({
          deps: this.deps,
          session,
          pending: pendingTransitionForRound,
          toolExecutions,
          usageTotals: this.telemetry.snapshot(),
          providerRequests: this.telemetry.requestSnapshot(),
          convergence: buildConvergenceEvidence(
            executionEnvelope.convergence,
            progressClassifier.chronologicalEvidence,
          ),
          routingDecision: toPublicRoutingDecision(routing.routingDecision),
          communicationResolution: routing.communicationResolution,
          preLlmEscalation: escalation,
        });
      }

      const cachePartition = buildRuntimeProviderRequestCachePartition(
        session,
        routing,
        perCallConfig,
        executionEnvelope,
      );
      const providerExecutionContext = buildProviderExecutionContext(perCallConfig);
      const conversationProjection = projectConversationForModel(
        session.conversationHistory,
        executionEnvelope?.conversation?.toolResults,
      );
      if ((routing.deliberationResolution?.status === "exact"
        || routing.deliberationResolution?.status === "clamped")
        && routing.effectiveProvider.deliberationTransport !== "native-level") {
        throw new Error(
          `Provider adapter '${routing.effectiveProvider.name}' cannot transport the resolved deliberation level.`,
        );
      }
      if (routing.communicationResolution
        && (routing.communicationResolution.responseDetail.mechanism === "native"
          || routing.communicationResolution.interactionProfile.mechanism === "native")
        && routing.effectiveProvider.communicationTransport !== "native") {
        throw new Error(
          `Provider adapter '${routing.effectiveProvider.name}' cannot transport the resolved communication control.`,
        );
      }
      const providerRequest: CreateMessageOptions = {
        sessionId: session.id,
        ...(perCallConfig?.providerTransport?.projectId || perCallConfig?.providerTransport?.requestIdPrefix
          ? {
              requestIdentity: {
                ...(perCallConfig.providerTransport.projectId
                  ? { projectId: perCallConfig.providerTransport.projectId }
                  : {}),
                ...(perCallConfig.providerTransport.requestIdPrefix
                  ? { requestId: `${perCallConfig.providerTransport.requestIdPrefix}:response:${round + 1}` }
                  : {}),
              },
            }
          : {}),
        system: invocationPromptManifest.finalPrompt,
        messages: conversationProjection.messages,
        tools: toolsForRound,
        ...(round === 0 && perCallConfig?.initialToolChoice
          ? { toolChoice: perCallConfig.initialToolChoice }
          : {}),
        maxTokens: this.deps.maxTokens,
        ...(routing.deliberationResolution
          ? { deliberationResolution: routing.deliberationResolution }
          : {}),
        ...(routing.communicationResolution
          ? { communicationResolution: routing.communicationResolution }
          : {}),
        signal: perCallConfig?.abortSignal,
        ...(perCallConfig?.providerTransport?.watchdog
          ? { transportWatchdog: perCallConfig.providerTransport.watchdog }
          : {}),
        ...(perCallConfig?.providerTransport?.observer
          ? { transportObserver: perCallConfig.providerTransport.observer }
          : {}),
        ...(providerExecutionContext ? { executionContext: providerExecutionContext } : {}),
      };
      const transitionReserveEligible = transitionOnlyRound
        && pendingTransitionForRound !== undefined
        && !managedInvocationTransitionReserveUsed
        && managedInvocationTransitionToolIsAdmitted(toolsForRound, pendingTransitionForRound, perCallConfig);
      const providerDecision = decideTurnConvergence(
        executionEnvelope.convergence,
        turnObservation.snapshot(),
        {
          kind: "provider_request",
          projectedInputTokens: estimateRuntimeProviderRequestInput(providerRequest),
        },
      );
      if (providerDecision.status === "pause" && !isEligibleTransitionReservePause(providerDecision, transitionReserveEligible)) {
        if (providerDecision.reason === "tool_round_limit") {
          if (governedWorkProgress && !governedWorkProgress.goalCreated) {
            return finalizeGovernedWorkMaterializationRequired({
              deps: this.deps,
              session,
              progress: governedWorkProgress,
              toolExecutions,
              usageTotals: this.telemetry.snapshot(),
              providerRequests: this.telemetry.requestSnapshot(),
              convergence: buildConvergenceEvidence(
                executionEnvelope.convergence,
                progressClassifier.chronologicalEvidence,
              ),
              routingDecision: toPublicRoutingDecision(routing.routingDecision),
              communicationResolution: routing.communicationResolution,
              preLlmEscalation: escalation,
            });
          }
          if (pendingTransitionForRound) {
            return finalizeManagedInvocationTransitionRequired({
              deps: this.deps,
              session,
              pending: pendingTransitionForRound,
              toolExecutions,
              usageTotals: this.telemetry.snapshot(),
              providerRequests: this.telemetry.requestSnapshot(),
              convergence: buildConvergenceEvidence(
                executionEnvelope.convergence,
                progressClassifier.chronologicalEvidence,
              ),
              routingDecision: toPublicRoutingDecision(routing.routingDecision),
              communicationResolution: routing.communicationResolution,
              preLlmEscalation: escalation,
            });
          }
        }
        return this.finalizeTurnConvergencePause({
          session,
          executionEnvelope,
          decision: providerDecision,
          progressEvidence: progressClassifier.chronologicalEvidence,
          toolExecutions,
          routingDecision: toPublicRoutingDecision(routing.routingDecision),
          communicationResolution: routing.communicationResolution,
          preLlmEscalation: escalation,
        });
      }
      if (transitionReserveEligible) {
        turnObservation.recordRecoveryAttempt();
        managedInvocationTransitionReserveUsed = true;
        const correction = formatManagedInvocationTransitionReserveCorrection(pendingTransitionForRound!);
        this.telemetry.emitError(session.id, correction);
        session.addUserMessage(textParts(correction));
      }
      const providerStartedAt = turnObservation.recordProviderRequestStarted();
      let response: AgentResponse;
      try {
        response = await this.dispatchModelRound({
          provider: routing.effectiveProvider,
          request: providerRequest,
          session,
          turnId,
          round,
          perCallConfig,
        });
      } catch (error) {
        turnObservation.recordProviderRequestCompleted(providerStartedAt, undefined);
        throw error;
      }
      const providerCompletion = turnObservation.recordProviderRequestCompleted(
        providerStartedAt,
        response.inputTokens,
      );
      throwIfRuntimeTurnAborted(perCallConfig?.abortSignal);
      // ProviderAdapter is an open boundary -- any implementation, not only the built-in
      // adapters, must have its tool call identity validated before results enter the runtime
      // (added to session history, executed, or projected by the model-gateway bridge).
      assertValidToolCallIds(response.toolCalls, { adapter: routing.effectiveProvider.name });
      const toolCallScopeId = `${turnId}:response:${round + 1}`;

      const usageTotals = this.telemetry.recordResponse(
        session.id,
        {
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          cacheReadTokens: response.cacheReadTokens,
          cacheWriteTokens: response.cacheWriteTokens,
          contextUsage: response.contextUsage,
          durationMs: providerCompletion.durationMs,
        },
        session.activeAgentId ?? undefined,
        measureProviderRequestRegions({
          system: invocationPromptManifest.finalPrompt,
          effectivePrompt: invocationPromptManifest,
          messages: conversationProjection.messages,
          tools: toolsForRound,
          toolCount: toolsForRound?.length ?? 0,
          toolProjection: buildProviderRequestToolProjectionEvidence({
            projectedTools: toolsForRound,
            materializableTools: materializableToolsForEvidence(
              this.deps.materializableTools,
          readExecutionToolAllowlist(perCallConfig),
            ),
            materializationDecisions: pendingMaterializationDecisions,
          }),
          cachePartition,
          conversationProjection: conversationProjection.evidence,
          communicationResolution: routing.communicationResolution,
          ...(response.stopReason ? { stopReason: response.stopReason } : {}),
        }),
      );
      pendingMaterializationDecisions = [];

      if (!routing.hasTools || response.toolCalls.length === 0) {
        if (managedInvocationTransitionReserveUsed) {
          const pendingAfterReserve = pendingManagedInvocationTransition(toolExecutions);
          if (pendingAfterReserve) {
            return finalizeManagedInvocationTransitionRequired({
              deps: this.deps,
              session,
              pending: pendingAfterReserve,
              toolExecutions,
              usageTotals: this.telemetry.snapshot(),
              providerRequests: this.telemetry.requestSnapshot(),
              convergence: buildConvergenceEvidence(
                executionEnvelope.convergence,
                progressClassifier.chronologicalEvidence,
              ),
              routingDecision: toPublicRoutingDecision(routing.routingDecision),
              communicationResolution: routing.communicationResolution,
              preLlmEscalation: escalation,
            });
          }
          return this.finalizeTurnConvergencePause({
            session,
            executionEnvelope,
            decision: transitionReserveConvergencePause(executionEnvelope.convergence, turnObservation),
            progressEvidence: progressClassifier.chronologicalEvidence,
            toolExecutions,
            routingDecision: toPublicRoutingDecision(routing.routingDecision),
            communicationResolution: routing.communicationResolution,
            preLlmEscalation: escalation,
          });
        }
        if (governedWorkProgress && !governedWorkProgress.goalCreated) {
          const correction = formatGovernedWorkMaterializationCorrection(governedWorkProgress);
          this.telemetry.emitError(session.id, correction);
          turnObservation.recordRecoveryAttempt();
          session.addUserMessage(textParts(correction));
          round += 1;
          continue;
        }
        const pendingTransition = pendingManagedInvocationTransition(toolExecutions);
        if (pendingTransition) {
          const correction = formatManagedInvocationTransitionCorrection(pendingTransition);
          this.telemetry.emitError(session.id, correction);
          turnObservation.recordRecoveryAttempt();
          session.addUserMessage(textParts(correction));
          round += 1;
          continue;
        }
        const temporalEvidence = assessRuntimeTemporalEvidence({
          userParts,
          temporalContext: perCallConfig?.temporalContext,
          toolExecutions,
        });
        if (temporalEvidence.required && shouldRequestTemporalEvidenceRecovery(
          temporalEvidence,
          toolExecutions,
          temporalEvidenceRecoveryRequested,
        )) {
          temporalEvidenceRecoveryRequested = true;
          turnObservation.recordRecoveryAttempt();
          session.addUserMessage(temporalEvidenceRecoveryInstruction(temporalEvidence));
          round += 1;
          continue;
        }
        const responseParts = temporalEvidence.required && !temporalEvidence.accepted
          ? temporalEvidenceRefusal(perCallConfig!.temporalContext!, temporalEvidence.exactLocalDate)
          : response.parts;
        const completionAssessment = assessRuntimeCompletionObligations(
          completionObligations,
          availableCanonicalToolIds,
          toolExecutions,
        );
        const completionIneligible = completionAssessment.eligibility.status === "ineligible";
        const finalizedResponse = await finalizeRuntimeSessionResponse({
          deps: this.deps,
          session,
          parts: completionIneligible
            ? textParts(formatRuntimeCompletionObligationFailure(completionAssessment.eligibility))
            : responseParts,
          usage: {
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            cacheReadTokens: response.cacheReadTokens,
            cacheWriteTokens: response.cacheWriteTokens,
          },
          usageTotals,
          providerRequests: this.telemetry.requestSnapshot(),
          toolExecutions,
          disposition: completionDisposition(
            completionAssessment.eligibility,
            completionAssessment.evidence,
            completionAssessment.obligations,
            buildConvergenceEvidence(
              executionEnvelope.convergence,
              progressClassifier.chronologicalEvidence,
            ),
            deriveGovernedTurnOutcome({ toolExecutions }),
          ),
          routingDecision: toPublicRoutingDecision(routing.routingDecision),
          communicationResolution: routing.communicationResolution,
          preLlmEscalation: escalation,
        });
        return finalizedResponse;
      }

      const normalizedToolCalls = response.toolCalls.map((toolCall) => normalizeToolCall(toolCall));
      const toolBatchDecision = decideTurnConvergence(
        executionEnvelope.convergence,
        turnObservation.snapshot(),
        { kind: "tool_batch", toolCallCount: normalizedToolCalls.length },
      );
      const transitionBatchReserveEligible = transitionOnlyRound
        && managedInvocationTransitionReserveUsed
        && pendingTransitionForRound !== undefined
        && managedInvocationTransitionToolIsAdmitted(toolsForRound, pendingTransitionForRound, perCallConfig);
      if (toolBatchDecision.status === "pause"
        && !isEligibleTransitionReservePause(toolBatchDecision, transitionBatchReserveEligible)) {
        return this.finalizeTurnConvergencePause({
          session,
          executionEnvelope,
          decision: toolBatchDecision,
          progressEvidence: progressClassifier.chronologicalEvidence,
          toolExecutions,
          routingDecision: toPublicRoutingDecision(routing.routingDecision),
          communicationResolution: routing.communicationResolution,
          preLlmEscalation: escalation,
        });
      }
      turnObservation.recordToolRound(normalizedToolCalls.length);
      const transitionOnlyToolCalls = transitionOnlyRound && pendingTransitionForRound
        ? partitionManagedInvocationTransitionToolCalls(normalizedToolCalls, pendingTransitionForRound)
        : undefined;
      const assistantParts: ContentPart[] = [...response.parts];
      for (const toolCall of normalizedToolCalls) {
        assistantParts.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        });
      }
      session.addAssistantMessage(assistantParts);

      const transitionAdmittedToolCalls = transitionOnlyToolCalls?.allowed ?? normalizedToolCalls;
      const governedWorkToolCalls = governedWorkProgress && !governedWorkProgress.goalCreated
        ? partitionGovernedWorkMaterializationToolCalls(transitionAdmittedToolCalls, governedWorkProgress)
        : undefined;
      const projectedRoundToolCalls = partitionProjectedRoundToolCalls(
        governedWorkToolCalls?.allowed ?? transitionAdmittedToolCalls,
        toolsForRound,
        projectedRoundCapabilityToolBlocks,
      );
      const executableToolCalls = projectedRoundToolCalls.allowed;
      const blockedTransitionOnlyCalls = transitionOnlyToolCalls && transitionOnlyToolCalls.blocked.length > 0
        ? buildManagedInvocationTransitionOnlyBlockedResults(transitionOnlyToolCalls.blocked, pendingTransitionForRound!)
        : undefined;
      const blockedProjectedRoundCalls = projectedRoundToolCalls.blocked.length > 0
        ? buildProjectedRoundBlockedResults(projectedRoundToolCalls.blocked, projectedRoundCapabilityToolBlocks)
        : undefined;
      const blockedGovernedWorkCalls = governedWorkToolCalls && governedWorkToolCalls.blocked.length > 0
        ? buildGovernedWorkMaterializationBlockedResults(governedWorkToolCalls.blocked, governedWorkProgress!)
        : undefined;
      const blockedToolExecutions = [
        ...(blockedTransitionOnlyCalls?.toolExecutions ?? []),
        ...(blockedProjectedRoundCalls?.toolExecutions ?? []),
        ...(blockedGovernedWorkCalls?.toolExecutions ?? []),
      ];
      const blockedToolCallIds = [
        ...(transitionOnlyToolCalls?.blocked ?? []),
        ...projectedRoundToolCalls.blocked,
        ...(governedWorkToolCalls?.blocked ?? []),
      ].map((toolCall) => toolCall.id);
      if (executableToolCalls.length === 0) {
        toolExecutions.push(...blockedToolExecutions);
        session.addUserMessage([
          ...(blockedTransitionOnlyCalls?.resultParts ?? []),
          ...(blockedProjectedRoundCalls?.resultParts ?? []),
          ...(blockedGovernedWorkCalls?.resultParts ?? []),
        ]);
        recordRuntimeToolBatchProgress(
          progressClassifier,
          turnObservation,
          normalizedToolCalls,
          blockedToolExecutions,
          blockedToolCallIds,
        );
        round += 1;
        continue;
      }

      const execution = await toolExecutor.executeToolCalls(
        session,
        executableToolCalls,
        toolCallScopeId,
        transitionOnlyRound && pendingTransitionForRound
          ? withManagedInvocationTransitionToolAllowlist(perCallConfig, pendingTransitionForRound)
          : perCallConfig,
      );
      for (const summary of execution.toolExecutions) {
        if (summary.durationMs > 0) {
          turnObservation.recordToolExecutionDuration(summary.durationMs);
        }
      }
      const batchToolExecutions = [
        ...(blockedTransitionOnlyCalls?.toolExecutions ?? []),
        ...execution.toolExecutions,
        ...(blockedProjectedRoundCalls?.toolExecutions ?? []),
        ...(blockedGovernedWorkCalls?.toolExecutions ?? []),
      ];
      toolExecutions.push(...batchToolExecutions);
      session.addUserMessage([
        ...(blockedTransitionOnlyCalls?.resultParts ?? []),
        ...execution.resultParts,
        ...(blockedProjectedRoundCalls?.resultParts ?? []),
        ...(blockedGovernedWorkCalls?.resultParts ?? []),
      ]);
      recordRuntimeToolBatchProgress(
        progressClassifier,
        turnObservation,
        normalizedToolCalls,
        batchToolExecutions,
        blockedToolCallIds,
      );
      if (managedInvocationTransitionReserveUsed) {
        const pendingAfterReserve = pendingManagedInvocationTransition(toolExecutions);
        if (pendingAfterReserve) {
          return finalizeManagedInvocationTransitionRequired({
            deps: this.deps,
            session,
          pending: pendingAfterReserve,
          toolExecutions,
          usageTotals: this.telemetry.snapshot(),
          providerRequests: this.telemetry.requestSnapshot(),
          convergence: buildConvergenceEvidence(
            executionEnvelope.convergence,
            progressClassifier.chronologicalEvidence,
          ),
          routingDecision: toPublicRoutingDecision(routing.routingDecision),
            communicationResolution: routing.communicationResolution,
            preLlmEscalation: escalation,
          });
        }
        return this.finalizeTurnConvergencePause({
          session,
          executionEnvelope,
          decision: transitionReserveConvergencePause(executionEnvelope.convergence, turnObservation),
          progressEvidence: progressClassifier.chronologicalEvidence,
          toolExecutions,
          routingDecision: toPublicRoutingDecision(routing.routingDecision),
          communicationResolution: routing.communicationResolution,
          preLlmEscalation: escalation,
        });
      }
      const progressiveAdmission = admitProgressivelyMaterializedTools(
        projectedRoundTools,
        execution.toolExecutions,
        this.deps.materializableTools,
        readExecutionToolAllowlist(perCallConfig),
        capabilityBinding,
        perCallConfig?.authorityAdmission,
        callerOwnedBuiltinToolNames,
      );
      projectedRoundTools = progressiveAdmission.tools;
      pendingMaterializationDecisions = progressiveAdmission.decisions;
      if (mutableCapabilityExecutors) {
        for (const [toolName, executor] of progressiveAdmission.capabilityExecutors) {
          mutableCapabilityExecutors.set(toolName, executor);
        }
      }
      round += 1;
    }

  }

  private finalizeTurnConvergencePause(input: {
    readonly session: RuntimeSession;
    readonly executionEnvelope: RuntimeResolvedExecutionEnvelope;
    readonly decision: TurnConvergencePauseDecision;
    readonly progressEvidence: readonly TurnProgressEvidence[];
    readonly toolExecutions: readonly ToolExecutionSummary[];
    readonly routingDecision?: OrchestrateResult["routingDecision"];
    readonly communicationResolution?: OrchestrateResult["communicationResolution"];
    readonly preLlmEscalation?: EscalationSignal;
  }): Promise<OrchestrateResult> {
    const message = formatRuntimeTurnConvergencePause(input.decision);
    this.telemetry.emitError(input.session.id, message);
    return finalizeRuntimeSessionResponse({
      deps: this.deps,
      session: input.session,
      parts: textParts(message),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      usageTotals: this.telemetry.snapshot(),
      providerRequests: this.telemetry.requestSnapshot(),
      toolExecutions: input.toolExecutions,
      disposition: {
        ...buildConvergenceDisposition(
          input.executionEnvelope.convergence,
          input.decision,
          input.progressEvidence,
        ),
      },
      routingDecision: input.routingDecision,
      communicationResolution: input.communicationResolution,
      preLlmEscalation: input.preLlmEscalation,
    });
  }

  private dispatchModelRound(input: {
    readonly provider: ProviderAdapter;
    readonly request: CreateMessageOptions;
    readonly session: RuntimeSession;
    readonly turnId: string;
    readonly round: number;
    readonly perCallConfig?: PerCallToolConfig;
  }): Promise<AgentResponse> {
    const dispatch = input.perCallConfig?.runtimeModelRoundDispatch;
    const providerRequestId = dispatch
      ? (input.request.requestIdentity?.requestId
        ?? `kiln:runtime-model-round:${dispatch.admission.admissionId}:${dispatch.attemptId}:${input.round}`)
      : undefined;
    const request = providerRequestId && !input.request.requestIdentity?.requestId
      ? {
          ...input.request,
          requestIdentity: {
            ...(input.request.requestIdentity ?? {}),
            requestId: providerRequestId,
          },
        }
      : input.request;
    if (!dispatch) {
      throw new Error("Runtime model-round claim context is required before provider dispatch.");
    }
    return new RuntimeModelRoundDispatchService(dispatch.store).dispatch({
      admission: dispatch.admission,
      sessionId: input.session.id,
      turnId: input.turnId,
      attemptId: dispatch.attemptId,
      round: input.round,
      intentFingerprint: dispatch.intentFingerprint,
      effectIdentity: runtimeModelRoundEffectIdentity({
        provider: input.provider.name,
        request: projectRuntimeModelRoundRequest(request),
      }),
      providerRequestId: providerRequestId!,
      routeId: dispatch.routeId,
      accountId: dispatch.accountId,
      credentialRevision: dispatch.credentialRevision,
      ...(dispatch.admissionReadbackSessionId
        ? { admissionReadbackSessionId: dispatch.admissionReadbackSessionId }
        : {}),
      ...(dispatch.admissionReadbackTurnId
        ? { admissionReadbackTurnId: dispatch.admissionReadbackTurnId }
        : {}),
      readAdmission: dispatch.readAdmission,
      provider: input.provider,
      request,
      ...(dispatch.state ? { state: dispatch.state } : {}),
      ...(input.perCallConfig?.abortSignal ? { abortSignal: input.perCallConfig.abortSignal } : {}),
    });
  }

  private detectPreLlmEscalation(userParts: readonly ContentPart[]) {
    if (!this.deps.escalationDetector) {
      return undefined;
    }
    const signal = this.deps.escalationDetector.checkPreLLM(extractText(userParts));
    return signal ?? undefined;
  }

  private async checkBudget(
    sessionId: string,
  ): Promise<{ readonly allowed: boolean; readonly message?: string }> {
    if (!this.deps.sessionTurnBudget) {
      return { allowed: true };
    }
    try {
      const decision = await this.deps.sessionTurnBudget.admit(sessionId);
      if (decision.status === "denied") {
        const message = decision.message ?? decision.reason;
        return { allowed: false, message };
      }
      return { allowed: true };
    } catch (error) {
      const message = `Session token budget observation failed: ${errorToMessage(error)}`;
      return { allowed: false, message };
    }
  }

  private async assertSessionTurnBudget(sessionId: string): Promise<void> {
    const admission = await this.checkBudget(sessionId);
    if (!admission.allowed) {
      throw new SessionTurnBudgetDenied(admission.message ?? "Session token observation denied.");
    }
  }

  private async admitMultimodalEffect(
    sessionId: string,
    policy: ResolvedTurnConvergencePolicy,
    observation: RuntimeTurnConvergenceObservationCollector,
  ): Promise<RuntimeMultimodalEffectAdmission> {
    await this.assertSessionTurnBudget(sessionId);
    const decision = decideTurnConvergence(
      policy,
      observation.snapshot(),
      { kind: "tool_batch", toolCallCount: 1 },
    );
    if (decision.status === "pause") {
      return { status: "paused", decision };
    }
    observation.recordToolRound(1);
    return { status: "admitted" };
  }

  private finalizeSessionTurnBudgetDenial(input: {
    readonly session: RuntimeSession;
    readonly denial: SessionTurnBudgetDenied;
    readonly toolExecutions: readonly ToolExecutionSummary[];
    readonly convergence: TurnConvergenceEvidence;
    readonly routingDecision?: OrchestrateResult["routingDecision"];
    readonly communicationResolution?: OrchestrateResult["communicationResolution"];
    readonly preLlmEscalation?: EscalationSignal;
  }): Promise<OrchestrateResult> {
    this.telemetry.emitError(input.session.id, input.denial.message);
    return finalizeRuntimeSessionResponse({
      deps: this.deps,
      session: input.session,
      parts: textParts(input.denial.message),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      usageTotals: this.telemetry.snapshot(),
      providerRequests: this.telemetry.requestSnapshot(),
      toolExecutions: input.toolExecutions,
      routingDecision: input.routingDecision,
      communicationResolution: input.communicationResolution,
      preLlmEscalation: input.preLlmEscalation,
      disposition: {
        outcome: "failed",
        dispositionReason: "outer_authority_denied",
        convergence: input.convergence,
      },
    });
  }

}

function recordRuntimeToolBatchProgress(
  classifier: RuntimeTurnProgressClassifier,
  observation: RuntimeTurnConvergenceObservationCollector,
  toolCalls: readonly ToolCall[],
  executions: readonly ToolExecutionSummary[],
  blockedToolCallIds: readonly string[],
): TurnProgressEvidence {
  const batch: RuntimeTurnProgressBatch = {
    executions,
    invalidToolCallIds: toolCalls.flatMap((toolCall) => (
      getInvalidToolInputDetails(toolCall.input) ? [toolCall.id] : []
    )),
    blockedToolCallIds,
  };
  const evidence = classifier.classify(batch);
  if (evidence.kind === "progress") {
    observation.recordProgress();
  } else {
    observation.recordNoProgressStep();
  }
  return evidence;
}

function buildConvergenceEvidence(
  policy: ResolvedTurnConvergencePolicy,
  progressEvidence: readonly TurnProgressEvidence[],
): TurnConvergenceEvidence {
  return {
    policy,
    progressEvidence: Object.freeze([...progressEvidence]),
  };
}

function buildConvergenceDisposition(
  policy: ResolvedTurnConvergencePolicy,
  decision: TurnConvergencePauseDecision,
  progressEvidence: readonly TurnProgressEvidence[],
): RuntimeTurnTerminalDisposition {
  switch (decision.reason) {
    case "observation_unavailable":
      return {
        outcome: "paused",
        dispositionReason: decision.reason,
        convergence: { policy, pause: decision, progressEvidence },
      };
    case "provider_request_limit":
      return {
        outcome: "paused",
        dispositionReason: decision.reason,
        convergence: { policy, pause: decision, progressEvidence },
      };
    case "tool_round_limit":
      return {
        outcome: "paused",
        dispositionReason: decision.reason,
        convergence: { policy, pause: decision, progressEvidence },
      };
    case "tool_call_limit":
      return {
        outcome: "paused",
        dispositionReason: decision.reason,
        convergence: { policy, pause: decision, progressEvidence },
      };
    case "cumulative_input_limit":
      return {
        outcome: "paused",
        dispositionReason: decision.reason,
        convergence: { policy, pause: decision, progressEvidence },
      };
    case "elapsed_time_limit":
      return {
        outcome: "paused",
        dispositionReason: decision.reason,
        convergence: { policy, pause: decision, progressEvidence },
      };
    case "active_time_limit":
      return {
        outcome: "paused",
        dispositionReason: decision.reason,
        convergence: { policy, pause: decision, progressEvidence },
      };
    case "recovery_limit":
      return {
        outcome: "paused",
        dispositionReason: decision.reason,
        convergence: { policy, pause: decision, progressEvidence },
      };
    case "no_progress":
      return {
        outcome: "paused",
        dispositionReason: decision.reason,
        convergence: { policy, pause: decision, progressEvidence },
      };
  }
}

function completionDisposition(
  eligibility: CompletionEligibility,
  evidence: readonly import("@kilnai/core/agents").RequiredProducerEvidence[],
  obligations: readonly import("@kilnai/core/agents").CompletionObligation[] = [],
  convergence: TurnConvergenceEvidence,
  governedOutcome: SessionTurnOutcome | undefined,
): RuntimeTurnTerminalDisposition {
  if (eligibility.status === "ineligible") {
    const completion: IneligibleCompletionSettlementEvidence = {
      obligations,
      producerEvidence: evidence,
      eligibility,
    };
    if (eligibility.unmet.some(({ status }) => status === "unavailable")) {
      return {
        outcome: "failed",
        dispositionReason: "required_producer_unavailable",
        completion,
        convergence,
      };
    }
    if (eligibility.unmet.some(({ status }) => status === "execution_failed")) {
      return {
        outcome: "failed",
        dispositionReason: "required_producer_execution_failed",
        completion,
        convergence,
      };
    }
    if (eligibility.unmet.some(({ status }) => status === "invalid_evidence")) {
      return {
        outcome: "failed",
        dispositionReason: "required_producer_invalid_evidence",
        completion,
        convergence,
      };
    }
    return {
      outcome: "paused",
      dispositionReason: "required_producer_not_run",
      completion,
      convergence,
    };
  }
  if (governedOutcome !== undefined) {
    return {
      outcome: "failed",
      dispositionReason: "governed_work_incomplete",
      convergence,
    };
  }
  const completion: EligibleCompletionSettlementEvidence = {
    obligations,
    producerEvidence: evidence,
    eligibility,
  };
  return {
    outcome: "completed",
    dispositionReason: "completion_eligible",
    completion,
    convergence,
  };
}

/**
 * Owns the operator-facing approval lifecycle before an exact provider can be
 * materialized from a dispatch-fenced credential.
 */
export class RuntimeSessionOrchestrationSurface {
  private readonly approvalGate: RuntimeSessionApprovalGate;

  constructor(private readonly deps: Omit<OrchestratorDeps, "provider" | "model">) {
    this.approvalGate = new RuntimeSessionApprovalGate(deps.eventBus);
  }

  bindProvider(provider: ProviderAdapter, model?: string): RuntimeSessionOrchestrator {
    return new RuntimeSessionOrchestrator({
      ...this.deps,
      provider,
      ...(model ? { model } : {}),
    }, this.approvalGate);
  }

  continue(approvalId: string): void {
    this.approvalGate.continue(approvalId);
  }

  emitApprovalReceived(approved: boolean, reason: string | undefined, approvalId: string): void {
    this.approvalGate.emitApprovalReceived(approved, reason, approvalId);
  }
}

function projectRuntimeModelRoundRequest(request: CreateMessageOptions): unknown {
  return {
    sessionId: request.sessionId,
    requestIdentity: request.requestIdentity,
    system: request.system,
    messages: request.messages,
    tools: request.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      tags: [...tool.tags].sort(),
      effectEnvelope: (tool as { readonly effectEnvelope?: unknown }).effectEnvelope,
    })),
    toolChoice: request.toolChoice,
    maxTokens: request.maxTokens,
    deliberationResolution: request.deliberationResolution,
    communicationResolution: request.communicationResolution,
    executionContext: request.executionContext
      ? {
          workingDirectory: request.executionContext.workingDirectory,
          requestedAuthority: request.executionContext.requestedAuthority,
          executionScope: request.executionContext.executionScope,
          executionBinding: request.executionContext.executionBinding,
        }
      : undefined,
  };
}

interface PendingManagedInvocationTransition {
  readonly kind: "recovery" | "phase-completion";
  readonly workItemId: string;
  readonly nextTool: string;
  readonly attemptId?: string;
  readonly reason?: string;
  readonly evidenceToRecord: readonly string[];
  readonly requiredToolNames: readonly string[];
  readonly sourceResourceUris: readonly string[];
  readonly workItemUpdateInputTemplate?: Record<string, unknown>;
  readonly blockedWorkItemUpdateInputTemplate?: Record<string, unknown>;
  readonly workItemExecutionFinishInputTemplate?: Record<string, unknown>;
  readonly workItemExecutionFailInputTemplate?: Record<string, unknown>;
  readonly blockedWhen?: string;
  readonly instruction?: string;
}

function managedInvocationTransitionToolsForRound(
  tools: readonly ToolDefinition[] | undefined,
  pending: PendingManagedInvocationTransition | undefined,
): readonly ToolDefinition[] | undefined {
  if (!pending) {
    return tools;
  }
  return (tools ?? []).filter((tool) => tool.name === pending.nextTool);
}

function managedInvocationTransitionToolIsAdmitted(
  tools: readonly ToolDefinition[] | undefined,
  pending: PendingManagedInvocationTransition,
  perCallConfig: PerCallToolConfig | undefined,
): boolean {
  return (tools ?? []).some((tool) => tool.name === pending.nextTool)
    && (!readExecutionToolAllowlist(perCallConfig) || readExecutionToolAllowlist(perCallConfig)!.has(pending.nextTool));
}

function withManagedInvocationTransitionToolAllowlist(
  perCallConfig: PerCallToolConfig | undefined,
  pending: PendingManagedInvocationTransition,
): PerCallToolConfig {
  return {
    ...perCallConfig,
    toolAllowlist: new Set([pending.nextTool]),
  };
}

function partitionManagedInvocationTransitionToolCalls(
  toolCalls: readonly ToolCall[],
  pending: PendingManagedInvocationTransition,
): {
  readonly allowed: readonly ToolCall[];
  readonly blocked: readonly ToolCall[];
} {
  const allowed: ToolCall[] = [];
  const blocked: ToolCall[] = [];
  for (const toolCall of toolCalls) {
    if (toolCall.name === pending.nextTool) {
      allowed.push(toolCall);
    } else {
      blocked.push(toolCall);
    }
  }
  return { allowed, blocked };
}

function resolveRuntimeTurnId(session: RuntimeSession, config: PerCallToolConfig | undefined): string {
  return readExecutionTurnId(config) ?? `${session.id}:turn:${Math.max(session.userTurnCount, 1)}`;
}

function readGovernedWorkMaterializationProgress(
  requirement: PerCallToolConfig["governedWorkRequirement"],
  executions: readonly ToolExecutionSummary[],
  turnId: string,
): GovernedWorkMaterializationProgress | undefined {
  if (!requirement) {
    return undefined;
  }
  const workItemIds = new Set<string>();
  for (const execution of executions) {
    if (!execution.success || execution.toolName !== "work_item.update") {
      continue;
    }
    const item = recordValue(execution.metadata?.item);
    const id = stringValue(item?.id);
    if (id) {
      workItemIds.add(id);
    }
  }

  const goalCreated = executions.some((execution) => {
    if (!execution.success || execution.toolName !== "goal.create") {
      return false;
    }
    const goal = recordValue(execution.metadata?.goal);
    const source = recordValue(goal?.source);
    const linkedIds = stringArrayValue(goal?.workItemIds);
    return source?.kind === "operator_direct"
      && stringValue(source.turnId) === turnId
      && linkedIds.length === requirement.requiredWorkItemCount
      && sameStringSet(linkedIds, workItemIds);
  });

  return {
    requiredWorkItemCount: requirement.requiredWorkItemCount,
    workItemIds,
    goalCreated,
  };
}

function governedWorkMaterializationToolsForRound(
  tools: readonly ToolDefinition[] | undefined,
  progress: GovernedWorkMaterializationProgress,
): readonly ToolDefinition[] | undefined {
  if (!tools) {
    return undefined;
  }
  return tools.filter((tool) => governedWorkToolAllowed(tool.name, progress));
}

function partitionGovernedWorkMaterializationToolCalls(
  toolCalls: readonly ToolCall[],
  progress: GovernedWorkMaterializationProgress,
): {
  readonly allowed: readonly ToolCall[];
  readonly blocked: readonly ToolCall[];
} {
  const allowed: ToolCall[] = [];
  const blocked: ToolCall[] = [];
  for (const toolCall of toolCalls) {
    (governedWorkToolAllowed(toolCall.name, progress) ? allowed : blocked).push(toolCall);
  }
  return { allowed, blocked };
}

function governedWorkToolAllowed(
  toolName: string,
  progress: GovernedWorkMaterializationProgress,
): boolean {
  if (progress.workItemIds.size < progress.requiredWorkItemCount) {
    return GOVERNED_WORK_ITEM_SETUP_TOOLS.has(toolName);
  }
  return toolName === "goal.create"
    || toolName === "work_governance.assess"
    || toolName === "work_profile.list"
    || toolName === "work_item.list";
}

function formatGovernedWorkMaterializationCorrection(
  progress: GovernedWorkMaterializationProgress,
): string {
  const remaining = Math.max(0, progress.requiredWorkItemCount - progress.workItemIds.size);
  return remaining > 0
    ? [
        "The operator required governed work materialization before repository inspection or execution.",
        `Create ${remaining} more distinct work item${remaining === 1 ? "" : "s"} with work_item.update.`,
        "Do not call repository, shell, web, managed-agent, or execution tools until the requirement is satisfied.",
      ].join("\n")
    : [
        "The required work items now exist, but the governed goal has not been created.",
        "Call goal.create and link exactly the materialized work-item ids; operator provenance comes from runtime turn context.",
        "The runtime will supply the current operatorTurnId.",
      ].join("\n");
}

function buildGovernedWorkMaterializationBlockedResults(
  toolCalls: readonly ToolCall[],
  progress: GovernedWorkMaterializationProgress,
): {
  readonly resultParts: readonly ContentPart[];
  readonly toolExecutions: readonly ToolExecutionSummary[];
} {
  const content = formatGovernedWorkMaterializationCorrection(progress);
  return {
    resultParts: toolCalls.map((toolCall) => ({
      type: "tool_result" as const,
      toolUseId: toolCall.id,
      content: `Tool "${toolCall.name}" was blocked.\n${content}`,
      isError: true,
    })),
    toolExecutions: toolCalls.map((toolCall) => ({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.input,
      durationMs: 0,
      success: false,
      output: `Tool "${toolCall.name}" was blocked.\n${content}`,
      resultSummary: `Tool "${toolCall.name}" was blocked pending governed work materialization.`,
    })),
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.flatMap((entry) => stringValue(entry) ? [stringValue(entry)!] : []) : [];
}

function sameStringSet(left: readonly string[], right: ReadonlySet<string>): boolean {
  return left.length === right.size && left.every((value) => right.has(value));
}

function partitionProjectedRoundToolCalls(
  toolCalls: readonly ToolCall[],
  toolsForRound: readonly ToolDefinition[] | undefined,
  capabilityToolBlocks: ReadonlyMap<string, RuntimeSessionToolBlock> | undefined,
): {
  readonly allowed: readonly ToolCall[];
  readonly blocked: readonly ToolCall[];
} {
  if (!toolsForRound) {
    return { allowed: toolCalls, blocked: [] };
  }

  const projectedToolNames = new Set(toolsForRound.map((tool) => tool.name));
  const allowed: ToolCall[] = [];
  const blocked: ToolCall[] = [];
  for (const toolCall of toolCalls) {
    if (capabilityToolBlocks?.has(toolCall.name)) {
      blocked.push(toolCall);
    } else if (projectedToolNames.has(toolCall.name)) {
      allowed.push(toolCall);
    } else {
      blocked.push(toolCall);
    }
  }
  return { allowed, blocked };
}

function buildManagedInvocationTransitionOnlyBlockedResults(
  toolCalls: readonly ToolCall[],
  pending: PendingManagedInvocationTransition,
): {
  readonly resultParts: readonly ContentPart[];
  readonly toolExecutions: readonly ToolExecutionSummary[];
} {
  const content = [
    "Tool execution blocked: managed invocation state transition is pending and this reserved round only permits the required work-item transition.",
    `Required next tool: ${pending.nextTool}.`,
    `Work item: ${pending.workItemId}.`,
  ].join("\n");
  return {
    resultParts: toolCalls.map((toolCall) => ({
      type: "tool_result" as const,
      toolUseId: toolCall.id,
      content,
      isError: true,
    })),
    toolExecutions: toolCalls.map((toolCall) => ({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.input,
      durationMs: 0,
      success: false,
      output: content,
      resultSummary: content.slice(0, 200),
    })),
  };
}

function buildProjectedRoundBlockedResults(
  toolCalls: readonly ToolCall[],
  capabilityToolBlocks: ReadonlyMap<string, RuntimeSessionToolBlock> | undefined,
): {
  readonly resultParts: readonly ContentPart[];
  readonly toolExecutions: readonly ToolExecutionSummary[];
} {
  return {
    resultParts: toolCalls.map((toolCall) => {
      const capabilityBlock = capabilityToolBlocks?.get(toolCall.name);
      const content = capabilityBlock
        ? `Authorization denied: ${capabilityBlock.reason}`
        : formatProjectedRoundBlockedToolMessage(toolCall.name);
      return {
        type: "tool_result" as const,
        toolUseId: toolCall.id,
        content,
        isError: true,
      };
    }),
    toolExecutions: toolCalls.map((toolCall) => {
      const capabilityBlock = capabilityToolBlocks?.get(toolCall.name);
      const content = capabilityBlock
        ? `Authorization denied: ${capabilityBlock.reason}`
        : formatProjectedRoundBlockedToolMessage(toolCall.name);
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.input,
        ...(capabilityBlock?.metadata === undefined ? {} : { metadata: { ...capabilityBlock.metadata } }),
        durationMs: 0,
        success: false,
        output: content,
        resultSummary: content.slice(0, 200),
      };
    }),
  };
}

function formatProjectedRoundBlockedToolMessage(toolName: string): string {
  return [
    `Tool "${toolName}" is not available in the current provider round's projected tool schema.`,
    "If this tool was just discovered through tool_catalog_search, retry it in the next provider round after the schema is materialized.",
  ].join("\n");
}

function finalizeManagedInvocationTransitionRequired(input: {
  readonly deps: OrchestratorDeps;
  readonly session: RuntimeSession;
  readonly pending: PendingManagedInvocationTransition;
  readonly toolExecutions: readonly ToolExecutionSummary[];
  readonly usageTotals: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
  };
  readonly providerRequests: readonly ProviderRequestEvidence[];
  readonly convergence: TurnConvergenceEvidence;
  readonly routingDecision: OrchestrateResult["routingDecision"];
  readonly communicationResolution: OrchestrateResult["communicationResolution"];
  readonly preLlmEscalation: OrchestrateResult["escalation"];
}): Promise<OrchestrateResult> {
  const parts = textParts(formatManagedInvocationTransitionRequiredMessage(input.pending));
  return finalizeRuntimeSessionResponse({
    deps: input.deps,
    session: input.session,
    parts,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    usageTotals: input.usageTotals,
    providerRequests: input.providerRequests,
    toolExecutions: input.toolExecutions,
    disposition: {
      outcome: "failed",
      dispositionReason: "managed_invocation_state_transition_required",
      convergence: input.convergence,
    },
    routingDecision: input.routingDecision,
    communicationResolution: input.communicationResolution,
    preLlmEscalation: input.preLlmEscalation,
  });
}

function finalizeGovernedWorkMaterializationRequired(input: {
  readonly deps: OrchestratorDeps;
  readonly session: RuntimeSession;
  readonly progress: GovernedWorkMaterializationProgress;
  readonly toolExecutions: readonly ToolExecutionSummary[];
  readonly usageTotals: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
  };
  readonly providerRequests: readonly ProviderRequestEvidence[];
  readonly convergence: TurnConvergenceEvidence;
  readonly routingDecision: OrchestrateResult["routingDecision"];
  readonly communicationResolution: OrchestrateResult["communicationResolution"];
  readonly preLlmEscalation: OrchestrateResult["escalation"];
}): Promise<OrchestrateResult> {
  return finalizeRuntimeSessionResponse({
    deps: input.deps,
    session: input.session,
    parts: textParts([
      "Governed work materialization is still required before task execution can continue.",
      formatGovernedWorkMaterializationCorrection(input.progress),
    ].join("\n")),
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    usageTotals: input.usageTotals,
    providerRequests: input.providerRequests,
    toolExecutions: input.toolExecutions,
    disposition: {
      outcome: "failed",
      dispositionReason: "governed_work_materialization_required",
      convergence: input.convergence,
    },
    routingDecision: input.routingDecision,
    communicationResolution: input.communicationResolution,
    preLlmEscalation: input.preLlmEscalation,
  });
}

function materializableToolsForEvidence(
  materializableTools: ReadonlyMap<string, ToolDefinition> | undefined,
  toolAllowlist: ReadonlySet<string> | undefined,
): ReadonlyMap<string, ToolDefinition> | undefined {
  if (!materializableTools || !toolAllowlist) {
    return undefined;
  }
  const scoped = new Map<string, ToolDefinition>();
  for (const [name, tool] of materializableTools.entries()) {
    if (toolAllowlist.has(name)) {
      scoped.set(name, tool);
    }
  }
  return scoped;
}

function mergeRuntimeBuiltinTools(
  callBuiltinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor> | undefined,
  capabilityExecutors: ReadonlyMap<string, RuntimeBuiltinToolExecutor> | undefined,
): ReadonlyMap<string, RuntimeBuiltinToolExecutor> | undefined {
  if (!capabilityExecutors || capabilityExecutors.size === 0) return callBuiltinTools;
  const merged = new Map(callBuiltinTools ?? []);
  // The Runtime capability bridge is canonical for its two names. A caller
  // cannot replace the bound catalog resolver through a per-call map.
  for (const [name, executor] of capabilityExecutors) merged.set(name, executor);
  return merged;
}

interface RuntimeCapabilityBindingFailure {
  readonly code: "missing-authority-admission" | "generation-invalidated" | "linkage-invalid";
  readonly reason: string;
  readonly generationId?: string;
  readonly authorityAdmissionId?: string;
}

interface RuntimeCapabilityBindingResolution {
  readonly binding?: RuntimeCapabilityTurnBinding;
  readonly failure?: RuntimeCapabilityBindingFailure;
}

function bindCapabilityGenerationForAdmission(
  capabilityGeneration: RuntimeCapabilityGeneration | undefined,
  authorityAdmission: PerCallToolConfig["authorityAdmission"],
): RuntimeCapabilityBindingResolution {
  if (!capabilityGeneration) {
    return {};
  }
  if (!authorityAdmission) {
    return {
      failure: {
        code: "missing-authority-admission",
        reason: "Capability generation requires an authority admission before discovery execution.",
        generationId: capabilityGeneration.generationId,
      },
    };
  }
  try {
    if (capabilityGeneration.isInvalidated()) {
      return {
        failure: {
          code: "generation-invalidated",
          reason: "Capability generation is invalidated; discovery execution is denied.",
          generationId: capabilityGeneration.generationId,
          authorityAdmissionId: authorityAdmission.admissionId,
        },
      };
    }
  } catch {
    return {
      failure: {
        code: "generation-invalidated",
        reason: "Capability generation validity could not be verified; discovery execution is denied.",
        generationId: capabilityGeneration.generationId,
        authorityAdmissionId: authorityAdmission.admissionId,
      },
    };
  }
  try {
    if (authorityAdmission.turn.capabilityParticipation.status !== "generation-linked") {
      throw new TypeError("Capability generation requires generation-linked capability participation in the authority admission.");
    }
    return {
      binding: capabilityGeneration.bindToExistingEffectiveAuthorityAdmissionBundle({
        authorityAdmission,
      }),
    };
  } catch {
    return {
      failure: {
        code: "linkage-invalid",
        reason: "Capability generation could not be bound to the current authority admission; discovery execution is denied.",
        generationId: capabilityGeneration.generationId,
        authorityAdmissionId: authorityAdmission.admissionId,
      },
    };
  }
}

function withoutRuntimeCapabilityDiscoveryTools(
  tools: readonly ToolDefinition[] | undefined,
): readonly ToolDefinition[] | undefined {
  if (tools === undefined) return undefined;
  return Object.freeze(tools.filter((tool) =>
    tool.name !== "capability.search" && tool.name !== "capability.describe"));
}

function projectRuntimeCapabilityToolsForBinding(
  tools: readonly ToolDefinition[] | undefined,
  binding: RuntimeCapabilityTurnBinding | undefined,
  bindingFailed: boolean,
): readonly ToolDefinition[] | undefined {
  if (binding !== undefined) return projectRuntimeCapabilityDiscoveryTools(tools, binding);
  if (!bindingFailed) return tools;
  const callerTools = withoutRuntimeCapabilityDiscoveryTools(tools) ?? [];
  return Object.freeze([...callerTools, ...RUNTIME_CAPABILITY_DISCOVERY_TOOLS]);
}

function buildRuntimeCapabilityToolBlocks(input: {
  readonly binding: RuntimeCapabilityTurnBinding | undefined;
  readonly bindingFailure: RuntimeCapabilityBindingFailure | undefined;
  readonly baseTools: readonly ToolDefinition[] | undefined;
  readonly materializableTools: ReadonlyMap<string, ToolDefinition> | undefined;
  readonly callerOwnedBuiltinToolNames: ReadonlySet<string>;
}): ReadonlyMap<string, RuntimeSessionToolBlock> | undefined {
  const blocks = new Map<string, RuntimeSessionToolBlock>();
  if (input.bindingFailure !== undefined) {
    const metadata: Readonly<Record<string, unknown>> = {
      kind: "capability",
      operation: "binding",
      decision: "denied",
      reasonCode: input.bindingFailure.code,
      ...(input.bindingFailure.generationId === undefined ? {} : { generationId: input.bindingFailure.generationId }),
      ...(input.bindingFailure.authorityAdmissionId === undefined
        ? {}
        : { authorityAdmissionId: input.bindingFailure.authorityAdmissionId }),
    };
    const blocked: RuntimeSessionToolBlock = {
      reason: input.bindingFailure.reason,
      metadata,
    };
    blocks.set("capability.search", blocked);
    blocks.set("capability.describe", blocked);
  }
  if (input.binding === undefined) {
    return blocks.size > 0 ? blocks : undefined;
  }
  for (const candidate of input.binding.authorityCandidates) {
    const toolName = candidate.toolName;
    if (toolName === undefined) continue;
    const baseTool = input.baseTools?.find((tool) => tool.name === toolName);
    const materializableTool = input.materializableTools?.get(toolName);
    let selectedTool: ToolDefinition | undefined;
    try {
      const described = input.binding.describe({
        capabilityId: candidate.capabilityId,
        revision: candidate.revision,
        descriptorDigest: candidate.descriptorDigest,
      });
      selectedTool = described.decision === "selected" ? described.tool : undefined;
    } catch {
      selectedTool = undefined;
    }
    if (baseTool === undefined && materializableTool === undefined
      && !input.callerOwnedBuiltinToolNames.has(toolName)) {
      continue;
    }
    const collisionReason = capabilityToolCollisionReason({
      toolName,
      selectedTool,
      baseTool,
      materializableTool,
      callerOwnedBuiltinToolNames: input.callerOwnedBuiltinToolNames,
    });
    if (collisionReason === undefined) continue;
    blocks.set(toolName, {
      reason: collisionReason,
      metadata: {
        kind: "capability",
        operation: "materialize",
        decision: "denied",
        reasonCode: "tool-name-collision",
        capabilityId: candidate.capabilityId,
        revision: candidate.revision,
        descriptorDigest: candidate.descriptorDigest,
        materializedToolName: toolName,
      },
    });
  }
  return blocks.size > 0 ? blocks : undefined;
}

function capabilityToolCollisionReason(input: {
  readonly toolName: string;
  readonly selectedTool: ToolDefinition | undefined;
  readonly baseTool: ToolDefinition | undefined;
  readonly materializableTool: ToolDefinition | undefined;
  readonly callerOwnedBuiltinToolNames: ReadonlySet<string>;
}): string | undefined {
  if (input.callerOwnedBuiltinToolNames.has(input.toolName)) {
    return `Capability materialization denied: selected tool name "${input.toolName}" collides with a caller-owned builtin executor.`;
  }
  if (input.selectedTool === undefined) {
    return "Capability materialization denied: exact selected ToolDefinition identity could not be established.";
  }
  try {
    const selectedDigest = runtimeCapabilityToolDefinitionDigest(input.selectedTool);
    if (input.baseTool !== undefined
      && runtimeCapabilityToolDefinitionDigest(input.baseTool) !== selectedDigest) {
      return `Capability materialization denied: selected tool name "${input.toolName}" collides with a different base ToolDefinition.`;
    }
    if (input.materializableTool !== undefined
      && runtimeCapabilityToolDefinitionDigest(input.materializableTool) !== selectedDigest) {
      return `Capability materialization denied: selected tool name "${input.toolName}" collides with a different materializable ToolDefinition.`;
    }
  } catch {
    return "Capability materialization denied: colliding ToolDefinition identity could not be canonicalized.";
  }
  return undefined;
}

function materializationBlocksForProjectedRound(
  blocks: ReadonlyMap<string, RuntimeSessionToolBlock> | undefined,
): ReadonlyMap<string, RuntimeSessionToolBlock> | undefined {
  if (blocks === undefined) return undefined;
  const materializationBlocks = new Map<string, RuntimeSessionToolBlock>();
  for (const [toolName, block] of blocks) {
    if (block.metadata?.operation === "materialize") {
      materializationBlocks.set(toolName, block);
    }
  }
  return materializationBlocks.size > 0 ? materializationBlocks : undefined;
}

function admitProgressivelyMaterializedTools(
  tools: readonly ToolDefinition[] | undefined,
  executions: readonly ToolExecutionSummary[],
  materializableTools: ReadonlyMap<string, ToolDefinition> | undefined,
  turnToolAllowlist: ReadonlySet<string> | undefined,
  capabilityBinding: RuntimeCapabilityTurnBinding | undefined,
  authorityAdmission: PerCallToolConfig["authorityAdmission"],
  callerOwnedBuiltinToolNames: ReadonlySet<string>,
): {
  readonly tools: readonly ToolDefinition[] | undefined;
  readonly decisions: readonly ProviderRequestToolMaterializationDecisionEvidence[];
  readonly capabilityExecutors: readonly (readonly [string, RuntimeBuiltinToolExecutor])[];
} {
  const hasCatalogMaterializations = materializableTools !== undefined && materializableTools.size > 0;
  const hasCapabilityMaterializations = capabilityBinding !== undefined
    && capabilityBinding.authorityCandidates.some((candidate) => candidate.toolName !== undefined);
  if (!tools || !turnToolAllowlist || (!hasCatalogMaterializations && !hasCapabilityMaterializations)) {
    return { tools, decisions: [], capabilityExecutors: [] };
  }

  let nextTools = tools;
  const decisions: ProviderRequestToolMaterializationDecisionEvidence[] = [];
  const capabilityExecutors: Array<readonly [string, RuntimeBuiltinToolExecutor]> = [];
  for (const execution of executions) {
    const catalogMetadata = readProgressiveToolCatalogSearchMetadata(execution.metadata);
    if (catalogMetadata) {
      if (!materializableTools) continue;
      const admission = admitProgressiveTool(
        nextTools,
        materializableTools,
        turnToolAllowlist,
        execution.metadata,
      );
      nextTools = admission.tools;
      const decision = materializationDecision(admission.decision);
      const canExposeToolName = decision !== "outside_authority";
      decisions.push({
        decision,
        toolName: canExposeToolName ? catalogMetadata.materializableToolName : "<redacted>",
        ...(execution.toolCallId ? { sourceToolCallId: execution.toolCallId } : {}),
        sourceToolName: execution.toolName,
        catalog: {
          ...(canExposeToolName && catalogMetadata.exact ? { exact: catalogMetadata.exact } : {}),
          ...(canExposeToolName && catalogMetadata.resultCount !== undefined ? { resultCount: catalogMetadata.resultCount } : {}),
          ...(canExposeToolName && catalogMetadata.totalIndexed !== undefined ? { totalIndexed: catalogMetadata.totalIndexed } : {}),
          ...(canExposeToolName && catalogMetadata.includedSchemas !== undefined ? { includedSchemas: catalogMetadata.includedSchemas } : {}),
          ...(canExposeToolName ? { stale: catalogMetadata.stale } : {}),
        },
      });
      continue;
    }

    const capabilityMetadata = readRuntimeCapabilityDescribeExecutionMetadata(execution.metadata);
    if (!capabilityMetadata || !capabilityBinding) continue;
    const admission = admitProgressivelyCapabilityTool(
      nextTools,
      capabilityMetadata,
      capabilityBinding,
      authorityAdmission,
      turnToolAllowlist,
      materializableTools,
      callerOwnedBuiltinToolNames,
    );
    nextTools = admission.tools;
    const materialized = admission.materialized;
    if (materialized) {
      capabilityExecutors.push([
        materialized.tool.name,
        async (input, context) => materialized.invoke(input, context),
      ]);
    }
    const decision = materializationDecision(admission.decision);
    const canExposeToolName = decision === "materialized" || decision === "already_materialized";
    decisions.push({
      decision,
      toolName: canExposeToolName
        ? capabilityMetadata.evidence.materializedToolName ?? "<redacted>"
        : "<redacted>",
      ...(execution.toolCallId ? { sourceToolCallId: execution.toolCallId } : {}),
      sourceToolName: execution.toolName,
      catalog: canExposeToolName
        ? {
            exact: capabilityMetadata.capabilityId,
            resultCount: 1,
            totalIndexed: capabilityBinding.authorityCandidates.length,
            includedSchemas: false,
            stale: false,
          }
        : {},
    });
  }
  return {
    tools: nextTools,
    decisions,
    capabilityExecutors: Object.freeze(capabilityExecutors),
  };
}

function admitProgressivelyCapabilityTool(
  tools: readonly ToolDefinition[],
  metadata: RuntimeCapabilityDescribeExecutionMetadata,
  capabilityBinding: RuntimeCapabilityTurnBinding,
  authorityAdmission: PerCallToolConfig["authorityAdmission"],
  turnToolAllowlist: ReadonlySet<string>,
  materializableTools: ReadonlyMap<string, ToolDefinition> | undefined,
  callerOwnedBuiltinToolNames: ReadonlySet<string>,
): {
  readonly tools: readonly ToolDefinition[];
  readonly decision: ProgressiveToolAdmissionDecision;
  readonly materialized?: RuntimeCapabilityMaterializedTool;
} {
  if (metadata.decision !== "selected" || !authorityAdmission
    || authorityAdmission.admissionId !== capabilityBinding.authorityAdmissionId) {
    return { tools, decision: progressiveCapabilityDecision(metadata.decision) };
  }
  const descriptorDigest = metadata.evidence.descriptorDigests.length === 1
    ? metadata.evidence.descriptorDigests[0]
    : undefined;
  if (!descriptorDigest || metadata.evaluatedAt !== capabilityBinding.evaluatedAt
    || metadata.generationId !== capabilityBinding.generationId
    || metadata.caller !== capabilityBinding.caller
    || metadata.evidence.runtimeScope.generationId !== capabilityBinding.generationId
    || metadata.evidence.runtimeScope.surfaceDigest !== capabilityBinding.surfaceDigest
    || metadata.evidence.runtimeScope.routeDigest !== capabilityBinding.routeDigest
    || metadata.evidence.runtimeScope.authorityAdmissionId !== capabilityBinding.authorityAdmissionId
    || (metadata.descriptorDigest !== undefined && metadata.descriptorDigest !== descriptorDigest)) {
    return { tools, decision: "not_materializable" };
  }

  let current;
  try {
    current = capabilityBinding.describe({
      capabilityId: metadata.capabilityId,
      revision: metadata.revision,
      descriptorDigest,
    });
  } catch {
    return { tools, decision: "not_materializable" };
  }
  if (current.decision !== "selected" || !current.tool
    || !sameCapabilitySelectionEvidence(metadata, current)) {
    return { tools, decision: progressiveCapabilityDecision(current.decision) };
  }
  const toolName = current.tool.name;
  const collisionReason = capabilityToolCollisionReason({
    toolName,
    selectedTool: current.tool,
    baseTool: tools.find((tool) => tool.name === toolName),
    materializableTool: materializableTools?.get(toolName),
    callerOwnedBuiltinToolNames,
  });
  if (collisionReason !== undefined) {
    return { tools, decision: "not_materializable" };
  }
  const materialized = capabilityBinding.materialize({
    capabilityId: metadata.capabilityId,
    revision: metadata.revision,
    descriptorDigest,
  });
  if (!materialized) {
    return { tools, decision: "not_materializable" };
  }
  if (!turnToolAllowlist.has(toolName)) {
    return { tools, decision: "outside_authority" };
  }
  if (tools.some((tool) => tool.name === toolName)) {
    return { tools, decision: "already_materialized", materialized };
  }
  return { tools: [...tools, current.tool], decision: "admitted", materialized };
}

function sameCapabilitySelectionEvidence(
  metadata: RuntimeCapabilityDescribeExecutionMetadata,
  current: ReturnType<RuntimeCapabilityTurnBinding["describe"]>,
): boolean {
  const expected = metadata.evidence;
  const actual = current.evidence;
  if (expected.contract !== actual.contract
    || expected.catalogDigest !== actual.catalogDigest
    || expected.requestScopeDigest !== actual.requestScopeDigest
    || expected.materializedToolName !== actual.materializedToolName
    || expected.descriptorDigests.length !== actual.descriptorDigests.length
    || expected.descriptorDigests.some((digest, index) => digest !== actual.descriptorDigests[index])) {
    return false;
  }
  if (!expected.runtimeScope || !actual.runtimeScope) return false;
  return expected.runtimeScope.routeDigest === actual.runtimeScope.routeDigest
    && expected.runtimeScope.surfaceDigest === actual.runtimeScope.surfaceDigest
    && expected.runtimeScope.authorityAdmissionId === actual.runtimeScope.authorityAdmissionId;
}

function progressiveCapabilityDecision(
  decision: RuntimeCapabilityDescribeExecutionMetadata["decision"] | undefined,
): ProgressiveToolAdmissionDecision {
  switch (decision) {
    case "outside-authority":
      return "outside_authority";
    case "not-found":
      return "not_found";
    default:
      return "not_materializable";
  }
}

function materializationDecision(
  decision: ProgressiveToolAdmissionDecision,
): ProviderRequestToolMaterializationDecisionEvidence["decision"] {
  return decision === "admitted" ? "materialized" : decision;
}

function pendingManagedInvocationTransition(
  toolExecutions: readonly ToolExecutionSummary[],
): PendingManagedInvocationTransition | undefined {
  let pending: PendingManagedInvocationTransition[] = [];
  for (const execution of toolExecutions) {
    if (pending.length > 0) {
      pending = pending.filter((transition) => !resolvesManagedInvocationTransition(execution, transition));
    }
    const recovery = readManagedInvocationRecovery(execution);
    if (readText(recovery?.status) === "phase_evidence_required") {
      const transition = readPendingManagedInvocationTransition(recovery, "recovery");
      if (transition) {
        pending.push(transition);
      }
      continue;
    }
    const phaseCompletion = readManagedInvocationPhaseCompletion(execution);
    if (readText(phaseCompletion?.status) === "phase_completed_by_child") {
      const transition = readPendingManagedInvocationTransition(phaseCompletion, "phase-completion");
      if (transition) {
        pending.push(transition);
      }
    }
  }
  return pending[0];
}

function readPendingManagedInvocationTransition(
  transition: Record<string, unknown> | undefined,
  kind: PendingManagedInvocationTransition["kind"],
): PendingManagedInvocationTransition | undefined {
  if (!transition) {
    return undefined;
  }
  const workItemId = readText(transition.workItemId);
  const nextTool = readText(transition.nextTool);
  if (!workItemId || !nextTool) {
    return undefined;
  }
  const attemptId = readRecoveryAttemptId(transition);
  const reason = readText(transition.reason);
  const blockedWhen = readText(transition.blockedWhen);
  const instruction = readText(transition.instruction);
  const workItemUpdateInputTemplate = readRecord(transition.workItemUpdateInputTemplate);
  const blockedWorkItemUpdateInputTemplate = readRecord(transition.blockedWorkItemUpdateInputTemplate);
  const workItemExecutionFinishInputTemplate = readRecord(transition.workItemExecutionFinishInputTemplate);
  const workItemExecutionFailInputTemplate = readRecord(transition.workItemExecutionFailInputTemplate);
  return {
    kind,
    workItemId,
    nextTool,
    ...(attemptId ? { attemptId } : {}),
    ...(reason ? { reason } : {}),
    evidenceToRecord: readTextArray(transition.evidenceToRecord),
    requiredToolNames: readTextArray(transition.requiredToolNames),
    sourceResourceUris: readTextArray(transition.sourceResourceUris),
    ...(workItemUpdateInputTemplate ? { workItemUpdateInputTemplate } : {}),
    ...(blockedWorkItemUpdateInputTemplate ? { blockedWorkItemUpdateInputTemplate } : {}),
    ...(workItemExecutionFinishInputTemplate ? { workItemExecutionFinishInputTemplate } : {}),
    ...(workItemExecutionFailInputTemplate ? { workItemExecutionFailInputTemplate } : {}),
    ...(blockedWhen ? { blockedWhen } : {}),
    ...(instruction ? { instruction } : {}),
  };
}

function resolvesManagedInvocationTransition(
  execution: ToolExecutionSummary,
  pending: PendingManagedInvocationTransition,
): boolean {
  if (!execution.success) {
    return false;
  }
  if (pending.nextTool === "work_item.execution.fail") {
    return resolvesManagedInvocationExecutionTransition(execution, pending, "work_item.execution.fail");
  }
  if (pending.nextTool === "work_item.execution.finish") {
    return resolvesManagedInvocationExecutionTransition(execution, pending, "work_item.execution.finish");
  }
  if (pending.nextTool !== "work_item.update" || execution.toolName !== "work_item.update") {
    return false;
  }
  const snapshot = readWorkItemSnapshot(execution);
  if (!snapshot || snapshot.id !== pending.workItemId) {
    return false;
  }
  const itemStatus = readText(snapshot.item.status);
  if (itemStatus === "completed" || itemStatus === "cancelled") {
    return true;
  }
  if (readText(execution.input?.status) === "blocked" || readText(snapshot.item.status) === "blocked") {
    return resolvesBlockedManagedInvocationTransition(snapshot.item, pending);
  }
  if (pending.evidenceToRecord.length === 0) {
    return false;
  }
  const accountedEvidence = new Set(accountedWorkItemEvidence({
    providedEvidence: readTextArray(snapshot.item.providedEvidence),
    skippedVerificationGates: readTextArray(snapshot.item.skippedVerificationGates),
    verificationGateResults: readRecordArray(snapshot.item.verificationGateResults).flatMap((result) => {
      const gate = readText(result.gate);
      const status = readText(result.status);
      return gate && status ? [{ gate, status }] : [];
    }),
  }));
  return pending.evidenceToRecord.every((evidence) => accountedEvidence.has(evidence));
}

function resolvesManagedInvocationExecutionTransition(
  execution: ToolExecutionSummary,
  pending: PendingManagedInvocationTransition,
  toolName: "work_item.execution.fail" | "work_item.execution.finish",
): boolean {
  if (execution.toolName !== toolName) {
    return false;
  }
  const snapshot = readWorkItemSnapshot(execution);
  if (!snapshot || snapshot.id !== pending.workItemId) {
    return false;
  }
  return !pending.attemptId || readExecutionAttemptId(execution) === pending.attemptId;
}

function readManagedInvocationRecovery(execution: ToolExecutionSummary): Record<string, unknown> | undefined {
  return readRecord(execution.metadata?.managedInvocationRecovery)
    ?? readRecord(parseJsonRecord(execution.output)?.recovery);
}

function readManagedInvocationPhaseCompletion(execution: ToolExecutionSummary): Record<string, unknown> | undefined {
  return readRecord(execution.metadata?.managedInvocationPhaseCompletion)
    ?? readRecord(parseJsonRecord(execution.output)?.phaseCompletion);
}

function readRecoveryAttemptId(transition: Record<string, unknown>): string | undefined {
  return readText(transition.attemptId)
    ?? readText(readRecord(transition.workItemExecutionFailInputTemplate)?.attemptId)
    ?? readText(readRecord(transition.workItemExecutionFinishInputTemplate)?.attemptId);
}

function readExecutionAttemptId(execution: ToolExecutionSummary): string | undefined {
  return readText(execution.input?.attemptId)
    ?? readText(execution.metadata?.attemptId)
    ?? readText(readRecord(execution.metadata?.executionAttempt)?.id);
}

function hasManagedInvocationHandoffRecoveryPause(item: Record<string, unknown>): boolean {
  return readRecordArray(item.pauseRequirements).some((pauseRequirement) => {
    const id = readText(pauseRequirement.id);
    return id !== undefined
      && isManagedInvocationRecoveryPauseRequirementId(id, MANAGED_INVOCATION_HANDOFF_RECOVERY_PAUSE_BASE_ID)
      && readText(pauseRequirement.status) === "pending";
  });
}

function resolvesBlockedManagedInvocationTransition(
  item: Record<string, unknown>,
  pending: PendingManagedInvocationTransition,
): boolean {
  if (hasManagedInvocationHandoffRecoveryPause(item)) {
    return true;
  }
  return hasPendingOperatorPause(item) && hasFailedRequiredEvidenceGate(item, pending.evidenceToRecord);
}

function hasPendingOperatorPause(item: Record<string, unknown>): boolean {
  return readRecordArray(item.pauseRequirements).some((pauseRequirement) =>
    readText(pauseRequirement.kind) === "operator_input"
    && readText(pauseRequirement.status) === "pending"
  );
}

function hasFailedRequiredEvidenceGate(
  item: Record<string, unknown>,
  evidenceToRecord: readonly string[],
): boolean {
  if (evidenceToRecord.length === 0) {
    return false;
  }
  const requiredEvidence = evidenceToRecord.map((evidence) => evidence.toLowerCase());
  return readRecordArray(item.verificationGateResults).some((gateResult) => {
    if (readText(gateResult.status) !== "failed") {
      return false;
    }
    const gate = readText(gateResult.gate)?.toLowerCase() ?? "";
    return requiredEvidence.some((evidence) => gate.includes(evidence));
  });
}

function readWorkItemSnapshot(
  execution: ToolExecutionSummary,
): { readonly id: string; readonly item: Record<string, unknown> } | undefined {
  if (!isWorkItemToolName(execution.toolName)) {
    return undefined;
  }
  const item = readRecord(execution.metadata?.item) ?? readWorkItemSnapshotFromOutput(execution.output);
  if (!item) {
    return undefined;
  }
  const id = readText(item.id) ?? readText(execution.metadata?.id);
  return id ? { id, item } : undefined;
}

function readWorkItemSnapshotFromOutput(output: string | undefined): Record<string, unknown> | undefined {
  const parsed = parseJsonRecord(output);
  const item = readRecord(parsed?.item);
  return item;
}

function isWorkItemToolName(toolName: string): boolean {
  return toolName === "work_item.update"
    || toolName === "work_item.execution.fail"
    || toolName === "work_item.execution.finish"
    || toolName === "work_item.complete";
}

function formatManagedInvocationTransitionCorrection(pending: PendingManagedInvocationTransition): string {
  const transitionLabel = pending.kind === "recovery"
    ? "Managed invocation recovery state transition"
    : "Managed invocation phase completion state transition";
  const lines = [
    `${transitionLabel} required before any final assistant response.`,
    `Work item: ${pending.workItemId}.`,
    `Required next tool: ${pending.nextTool}.`,
  ];
  if (pending.reason) {
    lines.push(`Reason: ${pending.reason}`);
  }
  if (pending.requiredToolNames.length > 0) {
    lines.push(`Continue recovery with admitted tools when collecting evidence: ${pending.requiredToolNames.join(", ")}.`);
  }
  if (pending.sourceResourceUris.length > 0) {
    lines.push(`Inspect source resources before recording evidence when needed: ${pending.sourceResourceUris.join(", ")}.`);
  }
  if (pending.workItemUpdateInputTemplate) {
    lines.push(`Evidence transition template: ${JSON.stringify(pending.workItemUpdateInputTemplate)}`);
  }
  if (pending.blockedWorkItemUpdateInputTemplate) {
    lines.push(`Blocked transition template: ${JSON.stringify(pending.blockedWorkItemUpdateInputTemplate)}`);
  }
  if (pending.workItemExecutionFinishInputTemplate) {
    lines.push(`Execution finish template: ${JSON.stringify(pending.workItemExecutionFinishInputTemplate)}`);
  }
  if (pending.workItemExecutionFailInputTemplate) {
    lines.push(`Execution fail template: ${JSON.stringify(pending.workItemExecutionFailInputTemplate)}`);
  }
  if (pending.blockedWhen) {
    lines.push(pending.blockedWhen);
  }
  if (pending.instruction) {
    lines.push(`Instruction: ${pending.instruction}`);
  }
  lines.push("Do not summarize, apologize, or stop until the required work item state transition succeeds.");
  return lines.join("\n");
}

function formatManagedInvocationTransitionReserveCorrection(pending: PendingManagedInvocationTransition): string {
  const transitionLabel = pending.kind === "recovery"
    ? "Managed invocation recovery state transition"
    : "Managed invocation phase completion state transition";
  const lines = [
    `${transitionLabel} required now. This is a transition-only reserved tool round.`,
    `Work item: ${pending.workItemId}.`,
    `Only permitted next tool: ${pending.nextTool}.`,
  ];
  if (pending.reason) {
    lines.push(`Reason: ${pending.reason}`);
  }
  if (pending.workItemUpdateInputTemplate) {
    lines.push(`Evidence transition template: ${JSON.stringify(pending.workItemUpdateInputTemplate)}`);
  }
  if (pending.blockedWorkItemUpdateInputTemplate) {
    lines.push(`Blocked transition template: ${JSON.stringify(pending.blockedWorkItemUpdateInputTemplate)}`);
  }
  if (pending.workItemExecutionFinishInputTemplate) {
    lines.push(`Execution finish template: ${JSON.stringify(pending.workItemExecutionFinishInputTemplate)}`);
  }
  if (pending.workItemExecutionFailInputTemplate) {
    lines.push(`Execution fail template: ${JSON.stringify(pending.workItemExecutionFailInputTemplate)}`);
  }
  if (pending.blockedWhen) {
    lines.push(pending.blockedWhen);
  }
  if (pending.instruction) {
    lines.push(`Instruction: ${pending.instruction}`);
  }
  lines.push("Do not call evidence-gathering tools in this reserved round. Record the evidence transition or the blocked transition.");
  return lines.join("\n");
}

function formatManagedInvocationTransitionRequiredMessage(pending: PendingManagedInvocationTransition): string {
  return [
    "Managed invocation state transition is required before the governed workflow can continue.",
    `Work item ${pending.workItemId} must be transitioned with ${pending.nextTool} before the governed workflow can continue.`,
    "No implementation, verification, or closeout should be treated as complete from this turn.",
  ].join("\n");
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readRecordArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => readRecord(item) !== undefined)
    : [];
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return readRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readTextArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.map(readText).filter((item): item is string => item !== undefined)
    : [];
}

function throwIfRuntimeTurnAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) {
    return;
  }
  throw new KilnError("PROVIDER_UNAVAILABLE", "Runtime provider request was aborted before completion");
}

function estimateRuntimeProviderRequestInput(
  request: CreateMessageOptions,
): import("@kilnai/core/agents").ObservedTurnQuantity {
  try {
    const serialized = JSON.stringify({
      system: request.system,
      messages: request.messages,
      tools: request.tools ?? [],
    });
    if (serialized === undefined) {
      return { status: "unknown", reason: "provider request input could not be serialized" };
    }
    return { status: "observed", value: estimateTextTokens(serialized) };
  } catch {
    return { status: "unknown", reason: "provider request input could not be serialized" };
  }
}

function isEligibleTransitionReservePause(
  decision: TurnConvergenceDecision,
  eligible: boolean,
): boolean {
  return eligible && decision.status === "pause" && decision.reason === "tool_round_limit";
}

function transitionReserveConvergencePause(
  policy: ResolvedTurnConvergencePolicy,
  collector: RuntimeTurnConvergenceObservationCollector,
): TurnConvergencePauseDecision {
  const decision = decideTurnConvergence(
    policy,
    collector.snapshot(),
    { kind: "provider_request", projectedInputTokens: { status: "observed", value: 0 } },
  );
  if (decision.status === "pause") return decision;
  return {
    status: "pause",
    reason: "tool_round_limit",
    metric: "toolRounds",
    observed: policy.toolRounds,
    limit: policy.toolRounds,
  };
}

function formatRuntimeTurnConvergencePause(decision: TurnConvergencePauseDecision): string {
  return decision.reason === "observation_unavailable"
    ? `Turn paused: ${decision.metric} observation unavailable.`
    : `Turn paused: ${decision.metric} limit reached (${decision.observed}/${decision.limit}).`;
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildRuntimeProviderRequestCachePartition(
  session: RuntimeSession,
  routing: RuntimeSessionRoutingResolution,
  perCallConfig: PerCallToolConfig | undefined,
  executionEnvelope: RuntimeResolvedExecutionEnvelope,
): ProviderRequestCachePartitionInput {
  return {
    tenantId: perCallConfig?.tenantId ?? session.tenantId,
    provider: routing.routingDecision?.provider
      ?? routing.executionIdentity?.provider
      ?? routing.effectiveProvider.name,
    model: routing.routingDecision?.model
      ?? routing.executionIdentity?.model,
    canonicalModel: routing.routingDecision?.canonicalModel
      ?? routing.executionIdentity?.canonicalModel,
    deliberationResolution: routing.deliberationResolution,
    communicationResolution: routing.communicationResolution,
    policyIdentity: {
      executionEnvelope,
      modelRoutingPolicy: projectModelRoutingPolicy(perCallConfig?.modelRoutingPolicy),
      toolAllowlist: [...readExecutionToolAllowlist(perCallConfig)].sort(),
      contextPolicy: perCallConfig?.contextPolicy,
    },
    authority: { admissionId: perCallConfig!.authorityAdmission!.admissionId },
  };
}

function projectModelRoutingPolicy(
  policy: PerCallToolConfig["modelRoutingPolicy"] | undefined,
): Record<string, unknown> | undefined {
  if (!policy) {
    return undefined;
  }
  return {
    task: policy.task,
    rankingEvidence: policy.rankingEvidence,
    routeCapabilities: policy.routeCapabilities
      ? [...policy.routeCapabilities.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([route, capabilities]) => ({
          route,
          deliberation: capabilities.deliberation,
        }))
      : undefined,
  };
}

function toPublicRoutingDecision(
  routingDecision: {
    readonly provider: string;
    readonly model: string;
    readonly canonicalModel?: string;
    readonly billingMode?: import("@kilnai/core").ExecutionBillingMode;
    readonly routingTier: string;
    readonly reasoning: string;
    readonly selectionMode?: "automatic" | "explicit-operator-only";
    readonly deliberationResolution?: import("@kilnai/core").DeliberationResolution;
    readonly rationale?: import("@kilnai/core").ModelRoutingRationale;
  } | undefined,
): OrchestrateResult["routingDecision"] {
  if (!routingDecision) {
    return undefined;
  }
  return {
    provider: routingDecision.provider,
    model: routingDecision.model,
    canonicalModel: routingDecision.canonicalModel,
    billingMode: routingDecision.billingMode,
    routingTier: routingDecision.routingTier,
    reasoning: routingDecision.reasoning,
    selectionMode: routingDecision.selectionMode,
    deliberationResolution: routingDecision.deliberationResolution,
    rationale: routingDecision.rationale,
  };
}
