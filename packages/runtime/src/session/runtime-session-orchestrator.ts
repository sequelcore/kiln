import type { ContentPart, ToolDefinition } from "@kilnai/core";
import type { EventBus } from "@kilnai/core";
import { extractText } from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import { RuntimeSessionApprovalGate } from "./runtime-session-orchestrator-approvals.js";
import { finalizeRuntimeSessionResponse, requestRuntimeSessionFallbackResponse } from "./runtime-session-orchestrator-response.js";
import { resolveRuntimeSessionRouting } from "./runtime-session-orchestrator-routing.js";
import { RuntimeSessionExecutionTelemetry } from "./runtime-session-orchestrator-telemetry.js";
import { RuntimeSessionToolExecutor } from "./runtime-session-orchestrator-tool-executor.js";
import type {
  OrchestratorDeps,
  OrchestrateResult,
  PerCallToolConfig,
  ToolExecutionSummary,
} from "./runtime-session-orchestrator.types.js";

const DEFAULT_MAX_TOOL_ROUNDS = 10;

export type {
  OrchestratorDeps,
  OrchestrateResult,
  PerCallToolConfig,
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
    this.telemetry = new RuntimeSessionExecutionTelemetry(deps.model, deps.eventBus);
  }

  get model(): string | undefined {
    return this.deps.model;
  }

  get eventBus(): EventBus | undefined {
    return this.deps.eventBus;
  }

  emitApprovalRequested(description: string, sessionId: string): void {
    this.approvalGate.emitApprovalRequested(description, sessionId);
  }

  emitApprovalReceived(approved: boolean, reason?: string, sessionId?: string): void {
    this.approvalGate.emitApprovalReceived(approved, reason, sessionId);
  }

  continue(sessionId: string): void {
    this.approvalGate.continue(sessionId);
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
    recalledMemory?: string,
    callBuiltinTools?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>,
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

    session.addUserMessage(userParts);

    const system = this.buildSystemPrompt(session, recalledMemory, perCallConfig);
    const routing = await resolveRuntimeSessionRouting(
      this.deps,
      session,
      userParts,
      system,
      this._tools,
      perCallConfig,
      (sessionId, decision) => this.telemetry.emitModelRouted(sessionId, decision),
    );

    const toolExecutions: ToolExecutionSummary[] = [];
    const toolExecutor = new RuntimeSessionToolExecutor(
      this.deps,
      this.deps.eventBus,
      (sessionId, description) => this.approvalGate.requestApproval(sessionId, description),
      (sessionId, message) => this.telemetry.emitError(sessionId, message),
      callBuiltinTools,
    );

    for (let round = 0; round < this.maxToolRounds; round++) {
      if (round > 0 && !(await this.checkBudget(session.id))) {
        break;
      }

      const response = await routing.effectiveProvider.createMessage({
        system: routing.invocationSystem,
        messages: [...session.conversationHistory],
        tools: routing.hasTools ? routing.effectiveTools : undefined,
        maxTokens: this.deps.maxTokens,
      });

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

      const assistantParts: ContentPart[] = [...response.parts];
      for (const toolCall of response.toolCalls) {
        assistantParts.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        });
      }
      session.addAssistantMessage(assistantParts);

      const execution = await toolExecutor.executeToolCalls(session, response.toolCalls, perCallConfig);
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

  private buildSystemPrompt(
    session: RuntimeSession,
    recalledMemory: string | undefined,
    perCallConfig: PerCallToolConfig | undefined,
  ): string {
    let system = session.systemPrompt;
    if (recalledMemory) {
      system += "\n\n--- Recalled Memory ---\n" + recalledMemory;
    }
    if (perCallConfig?.skillInstructions) {
      system += "\n\n--- Active Skills ---\n" + perCallConfig.skillInstructions;
    }
    return system;
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
}

function toPublicRoutingDecision(
  routingDecision: {
    readonly provider: string;
    readonly model: string;
    readonly routingTier: string;
    readonly reasoning: string;
  } | undefined,
): OrchestrateResult["routingDecision"] {
  if (!routingDecision) {
    return undefined;
  }
  return {
    provider: routingDecision.provider,
    model: routingDecision.model,
    routingTier: routingDecision.routingTier,
    reasoning: routingDecision.reasoning,
  };
}
