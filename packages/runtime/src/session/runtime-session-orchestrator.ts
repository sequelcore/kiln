import type {
  BudgetAdmissionRouteCandidate,
  ContentPart,
  EventBus,
  ProviderRequestToolMaterializationDecisionEvidence,
  ToolCall,
  ToolDefinition,
  ProviderExecutionContext,
  ProviderExecutionRequestedAuthority,
} from "@kilnai/core";
import {
  extractText,
  getInvalidToolInputDetails,
  KilnError,
  normalizeToolCall,
  resolveExecutionIdentity,
  textParts,
  type ProviderRequestEvidence,
} from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import {
  admitProgressiveTool,
  readProgressiveToolCatalogSearchMetadata,
  type ProgressiveToolAdmissionDecision,
} from "./progressive-tool-admission.js";
import { RuntimeSessionApprovalGate } from "./runtime-session-orchestrator-approvals.js";
import { finalizeRuntimeSessionResponse, requestRuntimeSessionFallbackResponse } from "./runtime-session-orchestrator-response.js";
import { resolveRuntimeSessionRouting, type RuntimeSessionRoutingResolution } from "./runtime-session-orchestrator-routing.js";
import {
  buildProviderRequestToolProjectionEvidence,
  measureProviderRequestRegions,
  type ProviderRequestCachePartitionInput,
  RuntimeSessionExecutionTelemetry,
} from "./runtime-session-orchestrator-telemetry.js";
import { RuntimeSessionToolExecutor } from "./runtime-session-orchestrator-tool-executor.js";
import {
  RUNTIME_SESSION_GOVERNED_WORK_MATERIALIZATION_REQUIRED_STOP_REASON,
  RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON,
  RUNTIME_SESSION_NO_TOOL_FINALIZATION_FAILED_STOP_REASON,
  RUNTIME_SESSION_TOOL_ROUND_BUDGET_EXHAUSTED_STOP_REASON,
} from "./runtime-session-orchestrator.types.js";
import { buildRuntimeTurnSystemPrompt } from "./support/index.js";
import type {
  OrchestratorDeps,
  OrchestrateResult,
  GovernedRuntimeContext,
  PerCallToolConfig,
  RuntimeBuiltinToolExecutor,
  RuntimeExecutionEnvelope,
  RuntimeToolRoundBudget,
  ToolExecutionSummary,
  EffectiveTurnAuthoritySnapshot,
} from "./runtime-session-orchestrator.types.js";
import type { EscalationSignal } from "./support/escalation/escalation-detector.js";

const MAX_IDENTICAL_INVALID_TOOL_ATTEMPTS = 2;
const MAX_IDENTICAL_TOOL_EXECUTION_FAILURES = 2;
const GOVERNED_WORK_ITEM_SETUP_TOOLS = new Set([
  "work_governance.assess",
  "work_profile.list",
  "work_item.list",
  "work_item.update",
]);

interface GovernedWorkMaterializationProgress {
  readonly requiredWorkItemCount: number;
  readonly workItemIds: ReadonlySet<string>;
  readonly goalCreated: boolean;
}

function resolveExecutionEnvelope(value: RuntimeExecutionEnvelope | undefined): RuntimeExecutionEnvelope | undefined {
  if (value === undefined) {
    return undefined;
  }
  return {
    ...(value.toolRounds ? { toolRounds: resolveToolRoundBudget(value.toolRounds) } : {}),
  };
}

function resolveToolRoundBudget(value: RuntimeToolRoundBudget): RuntimeToolRoundBudget {
  if (!Number.isSafeInteger(value.max) || value.max <= 0) {
    throw new KilnError("A2A_INVALID_REQUEST", "executionEnvelope.toolRounds.max must be a positive integer");
  }
  return { max: value.max };
}

function isToolRoundBudgetExhausted(
  round: number,
  executionEnvelope: RuntimeExecutionEnvelope | undefined,
): boolean {
  const max = executionEnvelope?.toolRounds?.max;
  return max !== undefined && round >= max;
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
  if (!config?.workingDirectory && !config?.effectiveTurnAuthority && !config?.executionScope) {
    return undefined;
  }
  return {
    ...(config.workingDirectory ? { workingDirectory: config.workingDirectory } : {}),
    ...(config.effectiveTurnAuthority
      ? { requestedAuthority: projectProviderRequestedAuthority(config.effectiveTurnAuthority) }
      : {}),
    ...(config.executionScope ? { executionScope: config.executionScope } : {}),
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
  RuntimeExecutionEnvelope,
  RuntimeToolRoundBudget,
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
  ToolExecutionSummary,
} from "./runtime-session-orchestrator.types.js";

export class RuntimeSessionOrchestrator {
  private readonly executionEnvelope?: RuntimeExecutionEnvelope;
  private _tools: readonly ToolDefinition[] | undefined;
  private readonly approvalGate: RuntimeSessionApprovalGate;
  private readonly telemetry: RuntimeSessionExecutionTelemetry;

  constructor(private readonly deps: OrchestratorDeps) {
    this.executionEnvelope = resolveExecutionEnvelope(deps.executionEnvelope);
    this._tools = deps.tools;
    this.approvalGate = new RuntimeSessionApprovalGate(deps.eventBus);
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
        };
      }
    }

    let escalation = this.detectPreLlmEscalation(userParts);

    const system = buildRuntimeTurnSystemPrompt(session, governedContext);
    const routing = await resolveRuntimeSessionRouting(
      this.deps,
      session,
      userParts,
      system,
      this._tools,
      perCallConfig,
      (sessionId, decision) => this.telemetry.emitModelRouted(sessionId, decision),
      (sessionId, route) => this.telemetry.emitMultimodalRouted(sessionId, route),
    );

    const admittedUserParts = routing.transformedUserParts ?? userParts;
    session.addUserMessage(admittedUserParts);

    const toolExecutions: ToolExecutionSummary[] = [...(routing.preModelToolExecutions ?? [])];
    if (routing.delegatedMultimodalResult) {
      return finalizeRuntimeSessionResponse({
        deps: this.deps,
        session,
        parts: routing.delegatedMultimodalResult.parts,
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
        toolExecutions: [routing.delegatedMultimodalResult.toolExecution],
        routingDecision: toPublicRoutingDecision(routing.routingDecision),
        preLlmEscalation: escalation,
      });
    }
    const executionEnvelope = resolveExecutionEnvelope(perCallConfig?.executionEnvelope ?? this.executionEnvelope);
    const invalidToolCallAttempts = new Map<string, number>();
    const toolExecutionFailureAttempts = new Map<string, number>();
    const toolExecutor = new RuntimeSessionToolExecutor(
      this.deps,
      this.deps.eventBus,
      (sessionId, description) => this.approvalGate.requestApproval(sessionId, description),
      (sessionId, message) => this.telemetry.emitError(sessionId, message),
      callBuiltinTools,
    );
    const budgetRouteModel = routing.routingDecision?.model ?? this.model;
    let projectedRoundTools = routing.effectiveTools;
    let pendingMaterializationDecisions: readonly ProviderRequestToolMaterializationDecisionEvidence[] = [];

    let managedInvocationTransitionReserveUsed = false;
    for (let round = 0; this.canStartToolRound(round, managedInvocationTransitionReserveUsed, toolExecutions, executionEnvelope); round++) {
      const governedWorkProgress = readGovernedWorkMaterializationProgress(
        perCallConfig?.governedWorkRequirement,
        toolExecutions,
        resolveRuntimeTurnId(session, perCallConfig),
      );
      const pendingTransitionForRound = pendingManagedInvocationTransition(toolExecutions);
      const transitionOnlyRound = isToolRoundBudgetExhausted(round, executionEnvelope);
      if (transitionOnlyRound) {
        if (!pendingTransitionForRound) {
          break;
        }
        managedInvocationTransitionReserveUsed = true;
        const correction = formatManagedInvocationTransitionReserveCorrection(pendingTransitionForRound);
        this.telemetry.emitError(session.id, correction);
        session.addUserMessage(textParts(correction));
      }
      throwIfRuntimeTurnAborted(perCallConfig?.abortSignal);
      const budgetAdmission = await this.checkBudget(session.id, {
        providerId: routing.routingDecision?.provider ?? routing.effectiveProvider.name,
        ...(budgetRouteModel ? { model: budgetRouteModel } : {}),
      });
      if (!budgetAdmission.allowed) {
        const parts = textParts(budgetAdmission.message ?? "Budget admission denied.");
        return finalizeRuntimeSessionResponse({
          deps: this.deps,
          session,
          parts,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
          usageTotals: this.telemetry.snapshot(),
          providerRequests: this.telemetry.requestSnapshot(),
          toolExecutions,
          routingDecision: toPublicRoutingDecision(routing.routingDecision),
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
          routingDecision: toPublicRoutingDecision(routing.routingDecision),
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
      const response = await routing.effectiveProvider.createMessage({
        sessionId: session.id,
        system: routing.invocationSystem,
        messages: [...session.conversationHistory],
        tools: toolsForRound,
        maxTokens: this.deps.maxTokens,
        reasoningEffort: perCallConfig?.reasoningEffort,
        signal: perCallConfig?.abortSignal,
        ...(providerExecutionContext ? { executionContext: providerExecutionContext } : {}),
      });
      throwIfRuntimeTurnAborted(perCallConfig?.abortSignal);

      const usageTotals = this.telemetry.recordResponse(
        session.id,
        {
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          cacheReadTokens: response.cacheReadTokens,
          cacheWriteTokens: response.cacheWriteTokens,
          contextUsage: response.contextUsage,
        },
        session.activeAgentId ?? undefined,
        measureProviderRequestRegions({
          system: routing.invocationSystem,
          messages: session.conversationHistory,
          tools: toolsForRound,
          toolCount: toolsForRound?.length ?? 0,
          toolProjection: buildProviderRequestToolProjectionEvidence({
            projectedTools: toolsForRound,
            materializableTools: materializableToolsForEvidence(
              this.deps.materializableTools,
              perCallConfig?.toolAllowlist,
            ),
            materializationDecisions: pendingMaterializationDecisions,
          }),
          cachePartition,
          ...(response.stopReason ? { stopReason: response.stopReason } : {}),
        }),
      );
      pendingMaterializationDecisions = [];

      if (!routing.hasTools || response.toolCalls.length === 0) {
        if (governedWorkProgress && !governedWorkProgress.goalCreated) {
          const correction = formatGovernedWorkMaterializationCorrection(governedWorkProgress);
          this.telemetry.emitError(session.id, correction);
          session.addUserMessage(textParts(correction));
          continue;
        }
        const pendingTransition = pendingManagedInvocationTransition(toolExecutions);
        if (pendingTransition) {
          const correction = formatManagedInvocationTransitionCorrection(pendingTransition);
          this.telemetry.emitError(session.id, correction);
          session.addUserMessage(textParts(correction));
          continue;
        }
        return finalizeRuntimeSessionResponse({
          deps: this.deps,
          session,
          parts: response.parts,
          usage: {
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            cacheReadTokens: response.cacheReadTokens,
            cacheWriteTokens: response.cacheWriteTokens,
          },
          usageTotals,
          providerRequests: this.telemetry.requestSnapshot(),
          toolExecutions,
          stopReason: response.stopReason,
          routingDecision: toPublicRoutingDecision(routing.routingDecision),
          preLlmEscalation: escalation,
        });
      }

      const normalizedToolCalls = response.toolCalls.map((toolCall) => normalizeToolCall(toolCall));
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
      );
      const executableToolCalls = projectedRoundToolCalls.allowed;
      const repeatedInvalidToolAttempt = this.detectRepeatedInvalidToolAttempt(
        executableToolCalls,
        invalidToolCallAttempts,
      );
      if (repeatedInvalidToolAttempt) {
        this.telemetry.emitError(session.id, repeatedInvalidToolAttempt.content);
        session.addAssistantMessage(assistantParts);
        const repeatedInvalidResultParts = normalizedToolCalls.map((toolCall) => {
          const content = toolCall.id === repeatedInvalidToolAttempt.toolUseId
            ? repeatedInvalidToolAttempt.content
            : `Tool "${toolCall.name}" was not executed because this tool round was aborted after a repeated malformed tool call. Correct the arguments and retry only the necessary tool calls.`;
          toolExecutions.push({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            input: toolCall.input,
            durationMs: 0,
            success: false,
            output: content,
            resultSummary: content.slice(0, 200),
          });
          return {
            type: "tool_result" as const,
            toolUseId: toolCall.id,
            content,
            isError: true,
          };
        });
        session.addUserMessage(repeatedInvalidResultParts);

        return this.finalizeAfterRepeatedToolFailure({
          session,
          routing,
          cachePartition,
          toolExecutions,
          preLlmEscalation: escalation,
        });
      }

      const blockedTransitionOnlyCalls = transitionOnlyToolCalls && transitionOnlyToolCalls.blocked.length > 0
        ? buildManagedInvocationTransitionOnlyBlockedResults(transitionOnlyToolCalls.blocked, pendingTransitionForRound!)
        : undefined;
      const blockedProjectedRoundCalls = projectedRoundToolCalls.blocked.length > 0
        ? buildProjectedRoundBlockedResults(projectedRoundToolCalls.blocked)
        : undefined;
      const blockedGovernedWorkCalls = governedWorkToolCalls && governedWorkToolCalls.blocked.length > 0
        ? buildGovernedWorkMaterializationBlockedResults(governedWorkToolCalls.blocked, governedWorkProgress!)
        : undefined;
      if (executableToolCalls.length === 0) {
        if (blockedTransitionOnlyCalls) {
          toolExecutions.push(...blockedTransitionOnlyCalls.toolExecutions);
        }
        if (blockedProjectedRoundCalls) {
          toolExecutions.push(...blockedProjectedRoundCalls.toolExecutions);
        }
        if (blockedGovernedWorkCalls) {
          toolExecutions.push(...blockedGovernedWorkCalls.toolExecutions);
        }
        session.addUserMessage([
          ...(blockedTransitionOnlyCalls?.resultParts ?? []),
          ...(blockedProjectedRoundCalls?.resultParts ?? []),
          ...(blockedGovernedWorkCalls?.resultParts ?? []),
        ]);
        continue;
      }

      const execution = await toolExecutor.executeToolCalls(
        session,
        executableToolCalls,
        transitionOnlyRound && pendingTransitionForRound
          ? withManagedInvocationTransitionToolAllowlist(perCallConfig, pendingTransitionForRound)
          : perCallConfig,
      );
      toolExecutions.push(
        ...(blockedTransitionOnlyCalls?.toolExecutions ?? []),
        ...execution.toolExecutions,
        ...(blockedProjectedRoundCalls?.toolExecutions ?? []),
        ...(blockedGovernedWorkCalls?.toolExecutions ?? []),
      );
      const repeatedExecutionFailure = this.detectRepeatedToolExecutionFailure(
        execution.toolExecutions,
        toolExecutionFailureAttempts,
      );
      const executionResultParts = repeatedExecutionFailure
        ? execution.resultParts.map((part) => part.toolUseId === repeatedExecutionFailure.toolUseId
          ? { ...part, content: `${part.content}\n\n${repeatedExecutionFailure.content}` }
          : part)
        : execution.resultParts;
      session.addUserMessage([
        ...(blockedTransitionOnlyCalls?.resultParts ?? []),
        ...executionResultParts,
        ...(blockedProjectedRoundCalls?.resultParts ?? []),
        ...(blockedGovernedWorkCalls?.resultParts ?? []),
      ]);
      if (repeatedExecutionFailure) {
        this.telemetry.emitError(session.id, repeatedExecutionFailure.content);
        return this.finalizeAfterRepeatedToolFailure({
          session,
          routing,
          cachePartition,
          toolExecutions,
          preLlmEscalation: escalation,
        });
      }
      const progressiveAdmission = admitProgressivelyMaterializedTools(
        projectedRoundTools,
        execution.toolExecutions,
        this.deps.materializableTools,
        perCallConfig?.toolAllowlist,
      );
      projectedRoundTools = progressiveAdmission.tools;
      pendingMaterializationDecisions = progressiveAdmission.decisions;
    }

    const pendingTransition = pendingManagedInvocationTransition(toolExecutions);
    if (pendingTransition) {
      this.telemetry.emitError(session.id, "Tool-round execution envelope exhausted");
      return finalizeManagedInvocationTransitionRequired({
        deps: this.deps,
        session,
        pending: pendingTransition,
        toolExecutions,
        usageTotals: this.telemetry.snapshot(),
        providerRequests: this.telemetry.requestSnapshot(),
        routingDecision: toPublicRoutingDecision(routing.routingDecision),
        preLlmEscalation: escalation,
      });
    }

    const governedWorkProgress = readGovernedWorkMaterializationProgress(
      perCallConfig?.governedWorkRequirement,
      toolExecutions,
      resolveRuntimeTurnId(session, perCallConfig),
    );
    if (governedWorkProgress && !governedWorkProgress.goalCreated) {
      this.telemetry.emitError(session.id, "Governed work materialization requirement was not satisfied");
      return finalizeGovernedWorkMaterializationRequired({
        deps: this.deps,
        session,
        progress: governedWorkProgress,
        toolExecutions,
        usageTotals: this.telemetry.snapshot(),
        providerRequests: this.telemetry.requestSnapshot(),
        routingDecision: toPublicRoutingDecision(routing.routingDecision),
        preLlmEscalation: escalation,
      });
    }

    if (!managedInvocationTransitionReserveUsed) {
      this.telemetry.emitError(session.id, "Tool-round execution envelope exhausted");
    }

    const toolRoundBudget = executionEnvelope?.toolRounds;
    if (!toolRoundBudget) {
      throw new KilnError("A2A_INVALID_REQUEST", "Runtime tool loop ended without an explicit tool-round budget");
    }
    session.addUserMessage(toolRoundBudgetFinalizationPrompt(toolRoundBudget.max));
    const fallback = await requestRuntimeSessionFallbackResponse(
      routing.effectiveProvider,
      routing.invocationSystem,
      session,
      this.deps.maxTokens,
      buildRuntimeProviderRequestCachePartition(session, routing, perCallConfig, executionEnvelope),
    );
    const usageTotals = this.telemetry.recordResponse(
      session.id,
      fallback.usage,
      session.activeAgentId ?? undefined,
      fallback.request,
    );
    const finalizedFallback = this.finalizeNoToolFallback({
      session,
      fallback,
      failureMessage: formatToolRoundBudgetExhaustedFinalization(toolRoundBudget.max),
      failureStopReason: RUNTIME_SESSION_TOOL_ROUND_BUDGET_EXHAUSTED_STOP_REASON,
    });

    return finalizeRuntimeSessionResponse({
      deps: this.deps,
      session,
      parts: finalizedFallback.parts,
      usage: fallback.usage,
      usageTotals,
      providerRequests: this.telemetry.requestSnapshot(),
      toolExecutions,
      stopReason: finalizedFallback.stopReason,
      routingDecision: toPublicRoutingDecision(routing.routingDecision),
      preLlmEscalation: escalation,
    });
  }

  private canStartToolRound(
    round: number,
    managedInvocationTransitionReserveUsed: boolean,
    toolExecutions: readonly ToolExecutionSummary[],
    executionEnvelope: RuntimeExecutionEnvelope | undefined,
  ): boolean {
    if (!isToolRoundBudgetExhausted(round, executionEnvelope)) {
      return true;
    }
    return !managedInvocationTransitionReserveUsed && pendingManagedInvocationTransition(toolExecutions) !== undefined;
  }

  private finalizeNoToolFallback(input: {
    readonly session: RuntimeSession;
    readonly fallback: {
      readonly parts: readonly ContentPart[];
      readonly toolCalls: readonly ToolCall[];
      readonly stopReason?: string;
    };
    readonly failureMessage: string;
    readonly failureStopReason: string;
  }): {
    readonly parts: readonly ContentPart[];
    readonly stopReason?: string;
  } {
    const fallbackRequiresToolContinuation = input.fallback.toolCalls.length > 0
      || isToolContinuationStopReason(input.fallback.stopReason);
    const fallbackText = extractText(input.fallback.parts).trim();
    if (fallbackRequiresToolContinuation || fallbackText.length === 0) {
      this.telemetry.emitError(
        input.session.id,
        "Tool finalization did not produce a final answer without tools",
      );
      return {
        parts: textParts(input.failureMessage),
        stopReason: input.failureStopReason,
      };
    }
    return {
      parts: input.fallback.parts,
      ...(input.fallback.stopReason !== undefined ? { stopReason: input.fallback.stopReason } : {}),
    };
  }

  private async finalizeAfterRepeatedToolFailure(input: {
    readonly session: RuntimeSession;
    readonly routing: RuntimeSessionRoutingResolution;
    readonly cachePartition?: ProviderRequestCachePartitionInput;
    readonly toolExecutions: readonly ToolExecutionSummary[];
    readonly preLlmEscalation?: EscalationSignal;
  }): Promise<OrchestrateResult> {
    const fallback = await requestRuntimeSessionFallbackResponse(
      input.routing.effectiveProvider,
      input.routing.invocationSystem,
      input.session,
      this.deps.maxTokens,
      input.cachePartition,
    );
    const fallbackUsageTotals = this.telemetry.recordResponse(
      input.session.id,
      fallback.usage,
      input.session.activeAgentId ?? undefined,
      fallback.request,
    );
    const finalizedFallback = this.finalizeNoToolFallback({
      session: input.session,
      fallback,
      failureMessage: formatNoToolFinalizationFailed(),
      failureStopReason: RUNTIME_SESSION_NO_TOOL_FINALIZATION_FAILED_STOP_REASON,
    });
    return finalizeRuntimeSessionResponse({
      deps: this.deps,
      session: input.session,
      parts: finalizedFallback.parts,
      usage: fallback.usage,
      usageTotals: fallbackUsageTotals,
      providerRequests: this.telemetry.requestSnapshot(),
      toolExecutions: input.toolExecutions,
      stopReason: finalizedFallback.stopReason,
      routingDecision: toPublicRoutingDecision(input.routing.routingDecision),
      preLlmEscalation: input.preLlmEscalation,
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
    routeCandidate: BudgetAdmissionRouteCandidate,
  ): Promise<{ readonly allowed: boolean; readonly message?: string }> {
    if (!this.deps.budgetAdmission) {
      return { allowed: true };
    }
    try {
      const decision = await this.deps.budgetAdmission.admit({
        subject: "runtime-session-turn",
        sessionId,
        routeCandidates: [routeCandidate],
      });
      if (decision.status === "denied") {
        const message = decision.message ?? decision.reason;
        this.telemetry.emitError(sessionId, message);
        return { allowed: false, message };
      }
      return { allowed: true };
    } catch (error) {
      const message = `Budget admission failed: ${errorToMessage(error)}`;
      this.telemetry.emitError(sessionId, message);
      return { allowed: false, message };
    }
  }

  private detectRepeatedInvalidToolAttempt(
    toolCalls: readonly {
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
    }[],
    attempts: Map<string, number>,
  ): {
    readonly toolUseId: string;
    readonly toolName: string;
    readonly content: string;
  } | undefined {
    for (const toolCall of toolCalls) {
      const invalidInput = getInvalidToolInputDetails(toolCall.input);
      if (!invalidInput) {
        continue;
      }

      const fingerprint = JSON.stringify({
        toolName: toolCall.name,
        reason: invalidInput.reason,
        raw: invalidInput.raw,
      });
      const nextAttemptCount = (attempts.get(fingerprint) ?? 0) + 1;
      attempts.set(fingerprint, nextAttemptCount);

      if (nextAttemptCount < MAX_IDENTICAL_INVALID_TOOL_ATTEMPTS) {
        continue;
      }

      return {
        toolUseId: toolCall.id,
        toolName: toolCall.name,
        content: `Repeated invalid input for tool "${toolCall.name}". The same malformed call was already rejected. Correct the arguments instead of retrying the unchanged tool call.`,
      };
    }

    return undefined;
  }

  private detectRepeatedToolExecutionFailure(
    executions: readonly ToolExecutionSummary[],
    attempts: Map<string, number>,
  ): {
    readonly toolUseId: string;
    readonly content: string;
  } | undefined {
    for (const execution of executions) {
      if (execution.success || !execution.toolCallId) continue;
      const fingerprint = JSON.stringify({
        toolName: execution.toolName,
        input: execution.input,
        resultSummary: execution.resultSummary,
      });
      const nextAttemptCount = (attempts.get(fingerprint) ?? 0) + 1;
      attempts.set(fingerprint, nextAttemptCount);
      if (nextAttemptCount < MAX_IDENTICAL_TOOL_EXECUTION_FAILURES) continue;
      return {
        toolUseId: execution.toolCallId,
        content: `Repeated deterministic failure for tool "${execution.toolName}". Stop retrying this unchanged operation and report the blocking error.`,
      };
    }
    return undefined;
  }
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
    && (!perCallConfig?.toolAllowlist || perCallConfig.toolAllowlist.has(pending.nextTool));
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
  return config?.turnId ?? `${session.id}:turn:${Math.max(session.userTurnCount, 1)}`;
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
    if (projectedToolNames.has(toolCall.name)) {
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
): {
  readonly resultParts: readonly ContentPart[];
  readonly toolExecutions: readonly ToolExecutionSummary[];
} {
  return {
    resultParts: toolCalls.map((toolCall) => {
      const content = formatProjectedRoundBlockedToolMessage(toolCall.name);
      return {
        type: "tool_result" as const,
        toolUseId: toolCall.id,
        content,
        isError: true,
      };
    }),
    toolExecutions: toolCalls.map((toolCall) => {
      const content = formatProjectedRoundBlockedToolMessage(toolCall.name);
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.input,
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
  readonly routingDecision: OrchestrateResult["routingDecision"];
  readonly preLlmEscalation: OrchestrateResult["escalation"];
}): Promise<OrchestrateResult> {
  const parts = textParts(formatManagedInvocationTransitionExhaustedMessage(input.pending));
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
    stopReason: RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON,
    routingDecision: input.routingDecision,
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
  readonly routingDecision: OrchestrateResult["routingDecision"];
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
    stopReason: RUNTIME_SESSION_GOVERNED_WORK_MATERIALIZATION_REQUIRED_STOP_REASON,
    routingDecision: input.routingDecision,
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

function admitProgressivelyMaterializedTools(
  tools: readonly ToolDefinition[] | undefined,
  executions: readonly ToolExecutionSummary[],
  materializableTools: ReadonlyMap<string, ToolDefinition> | undefined,
  turnToolAllowlist: ReadonlySet<string> | undefined,
): {
  readonly tools: readonly ToolDefinition[] | undefined;
  readonly decisions: readonly ProviderRequestToolMaterializationDecisionEvidence[];
} {
  if (!tools || !materializableTools || materializableTools.size === 0 || !turnToolAllowlist) {
    return { tools, decisions: [] };
  }

  let nextTools = tools;
  const decisions: ProviderRequestToolMaterializationDecisionEvidence[] = [];
  for (const execution of executions) {
    const catalogMetadata = readProgressiveToolCatalogSearchMetadata(execution.metadata);
    const admission = admitProgressiveTool(
      nextTools,
      materializableTools,
      turnToolAllowlist,
      execution.metadata,
    );
    nextTools = admission.tools;
    if (catalogMetadata) {
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
    }
  }
  return { tools: nextTools, decisions };
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
  if (readText(execution.input?.status) === "blocked" || readText(snapshot.item.status) === "blocked") {
    return resolvesBlockedManagedInvocationTransition(snapshot.item, pending);
  }
  if (pending.evidenceToRecord.length === 0) {
    return false;
  }
  const providedEvidence = readTextArray(snapshot.item.providedEvidence);
  return pending.evidenceToRecord.every((evidence) => providedEvidence.includes(evidence));
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
  return readRecordArray(item.pauseRequirements).some((pauseRequirement) =>
    readText(pauseRequirement.id) === "managed-invocation-handoff-recovery"
    && readText(pauseRequirement.status) === "pending"
  );
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

function formatManagedInvocationTransitionExhaustedMessage(pending: PendingManagedInvocationTransition): string {
  return [
    "Managed invocation state transition is still pending after the tool-round budget was exhausted.",
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

function toolRoundBudgetFinalizationPrompt(maxToolRoundCount: number): readonly ContentPart[] {
  return textParts([
    `Tool round budget exhausted after ${formatToolRoundCount(maxToolRoundCount)}.`,
    "Do not call tools.",
    "Return the final answer now using only the completed tool results already in this transcript.",
    "If the requested evidence is incomplete, say exactly what is missing and why.",
  ].join(" "));
}

function formatToolRoundBudgetExhaustedFinalization(maxToolRoundCount: number): string {
  return [
    `Tool round budget exhausted after ${formatToolRoundCount(maxToolRoundCount)}.`,
    "The bounded finalization pass did not produce a final answer without tools.",
    "Inspect the transcript and child execution evidence before recording governed evidence.",
  ].join(" ");
}

function formatNoToolFinalizationFailed(): string {
  return [
    "Tool finalization did not produce a final answer without tools.",
    "Inspect the transcript and tool execution evidence before treating this turn as complete.",
  ].join(" ");
}

function formatToolRoundCount(maxToolRoundCount: number): string {
  return maxToolRoundCount === 1 ? "1 tool round" : `${maxToolRoundCount} tool rounds`;
}

function isToolContinuationStopReason(stopReason: string | undefined): boolean {
  return stopReason === "tool_use"
    || stopReason === "tool_calls"
    || stopReason === "tool_calls_streamed";
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildRuntimeProviderRequestCachePartition(
  session: RuntimeSession,
  routing: RuntimeSessionRoutingResolution,
  perCallConfig: PerCallToolConfig | undefined,
  executionEnvelope: RuntimeExecutionEnvelope | undefined,
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
    reasoningEffort: perCallConfig?.reasoningEffort,
    policyIdentity: {
      executionEnvelope,
      modelRoutingPolicy: projectModelRoutingPolicy(perCallConfig?.modelRoutingPolicy),
      toolAllowlist: perCallConfig?.toolAllowlist ? [...perCallConfig.toolAllowlist].sort() : undefined,
      contextPolicy: perCallConfig?.contextPolicy,
    },
    authority: {
      effectiveTurnAuthority: perCallConfig?.effectiveTurnAuthority,
      authorityContext: perCallConfig?.authorityContext,
    },
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
          supportedReasoningEfforts: capabilities.supportedReasoningEfforts,
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
    readonly selectionMode?: "auto" | "manual_override";
    readonly reasoningEffort?: import("@kilnai/core").ReasoningEffort;
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
    reasoningEffort: routingDecision.reasoningEffort,
    rationale: routingDecision.rationale,
  };
}
