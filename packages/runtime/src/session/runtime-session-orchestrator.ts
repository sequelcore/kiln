import type { ContentPart, EventBus, ToolDefinition } from "@kilnai/core";
import {
  extractText,
  getInvalidToolInputDetails,
  KilnError,
  normalizeToolCall,
  resolveExecutionIdentity,
} from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import { RuntimeSessionApprovalGate } from "./runtime-session-orchestrator-approvals.js";
import { finalizeRuntimeSessionResponse, requestRuntimeSessionFallbackResponse } from "./runtime-session-orchestrator-response.js";
import { resolveRuntimeSessionRouting } from "./runtime-session-orchestrator-routing.js";
import { RuntimeSessionExecutionTelemetry } from "./runtime-session-orchestrator-telemetry.js";
import { RuntimeSessionToolExecutor } from "./runtime-session-orchestrator-tool-executor.js";
import { buildRuntimeTurnSystemPrompt } from "./support/index.js";
import type {
  OrchestratorDeps,
  OrchestrateResult,
  GovernedRuntimeContext,
  PerCallToolConfig,
  RuntimeBuiltinToolExecutor,
  ToolExecutionSummary,
} from "./runtime-session-orchestrator.types.js";

const DEFAULT_MAX_TOOL_ROUNDS = 10;
const MAX_IDENTICAL_INVALID_TOOL_ATTEMPTS = 2;

export type {
  OrchestratorDeps,
  OrchestrateResult,
  GovernedRuntimeContext,
  EffectiveTurnAuthorityPolicyInput,
  EffectiveTurnAuthorityPolicyInputSource,
  EffectiveTurnAuthorityPolicyInputStatus,
  EffectiveTurnAuthoritySnapshot,
  PerCallToolConfig,
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
  ToolExecutionSummary,
} from "./runtime-session-orchestrator.types.js";

export class RuntimeSessionOrchestrator {
  private readonly maxToolRounds: number;
  private _tools: readonly ToolDefinition[] | undefined;
  private readonly approvalGate: RuntimeSessionApprovalGate;
  private readonly telemetry: RuntimeSessionExecutionTelemetry;

  constructor(private readonly deps: OrchestratorDeps) {
    this.maxToolRounds = deps.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
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
    const invalidToolCallAttempts = new Map<string, number>();
    const toolExecutor = new RuntimeSessionToolExecutor(
      this.deps,
      this.deps.eventBus,
      (sessionId, description) => this.approvalGate.requestApproval(sessionId, description),
      (sessionId, message) => this.telemetry.emitError(sessionId, message),
      callBuiltinTools,
    );

    for (let round = 0; round < this.maxToolRounds; round++) {
      throwIfRuntimeTurnAborted(perCallConfig?.abortSignal);
      if (round > 0 && !(await this.checkBudget(session.id))) {
        break;
      }

      const response = await routing.effectiveProvider.createMessage({
        sessionId: session.id,
        system: routing.invocationSystem,
        messages: [...session.conversationHistory],
        tools: routing.hasTools ? routing.effectiveTools : undefined,
        maxTokens: this.deps.maxTokens,
        reasoningEffort: perCallConfig?.reasoningEffort,
        signal: perCallConfig?.abortSignal,
      });
      throwIfRuntimeTurnAborted(perCallConfig?.abortSignal);

      const usageTotals = this.telemetry.recordResponse(
        session.id,
        {
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          cacheReadTokens: response.cacheReadTokens,
          cacheWriteTokens: response.cacheWriteTokens,
        },
        session.activeAgentId ?? undefined,
      );

      if (!routing.hasTools || response.toolCalls.length === 0) {
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
          toolExecutions,
          routingDecision: toPublicRoutingDecision(routing.routingDecision),
          preLlmEscalation: escalation,
        });
      }

      const normalizedToolCalls = response.toolCalls.map((toolCall) => normalizeToolCall(toolCall));
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

      const repeatedInvalidToolAttempt = this.detectRepeatedInvalidToolAttempt(
        normalizedToolCalls,
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

        const fallback = await requestRuntimeSessionFallbackResponse(
          routing.effectiveProvider,
          routing.invocationSystem,
          session,
          this.deps.maxTokens,
        );
        const fallbackUsageTotals = this.telemetry.recordResponse(
          session.id,
          fallback.usage,
          session.activeAgentId ?? undefined,
        );

        return finalizeRuntimeSessionResponse({
          deps: this.deps,
          session,
          parts: fallback.parts,
          usage: fallback.usage,
          usageTotals: fallbackUsageTotals,
          toolExecutions,
          routingDecision: toPublicRoutingDecision(routing.routingDecision),
          preLlmEscalation: escalation,
        });
      }

      const execution = await toolExecutor.executeToolCalls(session, normalizedToolCalls, perCallConfig);
      toolExecutions.push(...execution.toolExecutions);
      session.addUserMessage(execution.resultParts);
    }

    this.telemetry.emitError(session.id, `Max tool rounds (${this.maxToolRounds}) exceeded`);

    const fallback = await requestRuntimeSessionFallbackResponse(
      routing.effectiveProvider,
      routing.invocationSystem,
      session,
      this.deps.maxTokens,
    );
    const usageTotals = this.telemetry.recordResponse(session.id, fallback.usage, session.activeAgentId ?? undefined);

    return finalizeRuntimeSessionResponse({
      deps: this.deps,
      session,
      parts: fallback.parts,
      usage: fallback.usage,
      usageTotals,
      toolExecutions,
      routingDecision: toPublicRoutingDecision(routing.routingDecision),
      preLlmEscalation: escalation,
    });
  }

  private detectPreLlmEscalation(userParts: readonly ContentPart[]) {
    if (!this.deps.escalationDetector) {
      return undefined;
    }
    const signal = this.deps.escalationDetector.checkPreLLM(extractText(userParts));
    return signal ?? undefined;
  }

  private async checkBudget(sessionId: string): Promise<boolean> {
    if (!this.deps.budgetChecker) {
      return true;
    }
    try {
      const budget = await this.deps.budgetChecker();
      if (!budget.allowed) {
        this.telemetry.emitError(sessionId, budget.message ?? "Budget exhausted");
        return false;
      }
      return true;
    } catch {
      return true;
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
}

function throwIfRuntimeTurnAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) {
    return;
  }
  throw new KilnError("PROVIDER_UNAVAILABLE", "Runtime provider request was aborted before completion");
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
