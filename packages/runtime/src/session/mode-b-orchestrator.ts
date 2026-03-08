import type { ProviderAdapter, ContentPart, ToolDefinition, ToolCall } from "@kilnai/core";
import type { McpClient } from "@kilnai/core";
import type {
  EventBus,
  ToolCalledEvent,
  ToolAuthorizedEvent,
  ToolResultEvent,
  ToolCacheHitEvent,
  CostUpdateEvent,
  ErrorEvent,
} from "@kilnai/core";
import { MODEL_PRICING, extractText } from "@kilnai/core";
import type { ModelPricing } from "@kilnai/core";
import type { Capability, ToolAuthorizer, ToolExecutionResult } from "@kilnai/core";
import type { AuditLog } from "@kilnai/core";
import type { ToolResultSanitizer } from "@kilnai/core";
import type { ToolRAG } from "@kilnai/core";
import type { RateLimiter } from "@kilnai/core";
import type { ToolCache } from "@kilnai/core";
import { executeWithRetry } from "@kilnai/core";
import type { ModeBSession } from "./mode-b-session.js";
import type { EscalationDetector, EscalationSignal } from "./escalation-detector.js";
import type { ContextSummarizer } from "./context-summarizer.js";

const DEFAULT_MAX_TOOL_ROUNDS = 10;

export interface OrchestratorDeps {
  readonly provider: ProviderAdapter;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly maxToolRounds?: number;
  readonly tools?: readonly ToolDefinition[];
  readonly mcpClients?: readonly McpClient[];
  readonly builtinTools?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
  readonly eventBus?: EventBus;
  readonly escalationDetector?: EscalationDetector;
  readonly contextSummarizer?: ContextSummarizer;
  readonly capabilityMap?: ReadonlyMap<string, Capability>;
  readonly toolAuthorizer?: ToolAuthorizer;
  readonly toolResultSanitizer?: ToolResultSanitizer;
  readonly budgetChecker?: () => Promise<{ allowed: boolean; message?: string }>;
  readonly auditLog?: AuditLog;
  readonly toolRAG?: ToolRAG;
  readonly toolCache?: ToolCache;
}

export interface ToolExecutionSummary {
  readonly toolName: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly resultSummary: string;
}

export interface OrchestrateResult {
  readonly parts: readonly ContentPart[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly queued: boolean;
  readonly escalation?: EscalationSignal;
  readonly contextSummary?: string;
  readonly toolExecutions?: readonly ToolExecutionSummary[];
}

export interface PerCallToolConfig {
  readonly toolAllowlist?: ReadonlySet<string>;
  readonly rateLimiter?: RateLimiter;
  readonly tenantId?: string;
  readonly additionalTools?: readonly ToolDefinition[];
}

export class ModeBOrchestrator {
  private readonly deps: OrchestratorDeps;
  private readonly maxToolRounds: number;
  private _tools: readonly ToolDefinition[] | undefined;
  private _callBuiltinTools?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
    this.maxToolRounds = deps.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this._tools = deps.tools;
    if (!deps.model) {
      console.warn("[ModeBOrchestrator] No model specified in deps -- cost tracking will be $0. Pass model to OrchestratorDeps for accurate cost reporting.");
    }
  }

  /** The model identifier passed to this orchestrator. Used by callers for usage reporting. */
  get model(): string | undefined {
    return this.deps.model;
  }

  /** Current tool definitions. */
  get tools(): readonly ToolDefinition[] | undefined {
    return this._tools;
  }

  /** Register additional tool definitions at runtime (e.g. builtin tools discovered per-tenant). */
  registerTools(newTools: readonly ToolDefinition[]): void {
    const existing = this._tools ?? [];
    const names = new Set(existing.map((t) => t.name));
    const additions = newTools.filter((t) => !names.has(t.name));
    if (additions.length > 0) {
      this._tools = [...existing, ...additions];
    }
  }

  async processMessage(
    session: ModeBSession,
    userParts: readonly ContentPart[],
    recalledMemory?: string,
    callBuiltinTools?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>,
    perCallConfig?: PerCallToolConfig,
  ): Promise<OrchestrateResult> {
    // AI guard: skip LLM when session is not ai_active
    if (session.sessionMode !== "ai_active") {
      // Auto-reopen resolved sessions on new user message
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

    // Pre-LLM escalation check
    let escalation: EscalationSignal | undefined;
    if (this.deps.escalationDetector) {
      const userText = extractText(userParts);
      const signal = this.deps.escalationDetector.checkPreLLM(userText);
      if (signal) escalation = signal;
    }

    session.addUserMessage(userParts);

    let system = session.systemPrompt;
    if (recalledMemory) {
      system += "\n\n--- Recalled Memory ---\n" + recalledMemory;
    }

    // Merge dep-level and per-call builtin tools
    this._callBuiltinTools = callBuiltinTools;
    const hasBuiltins = (this.deps.builtinTools?.size ?? 0) + (callBuiltinTools?.size ?? 0) > 0;
    const hasMcp = (this.deps.mcpClients?.length ?? 0) > 0;

    // Merge per-call additional tools (webhook tools, tenant tools)
    let baseTools = this._tools;
    if (perCallConfig?.additionalTools && perCallConfig.additionalTools.length > 0) {
      const existing = baseTools ?? [];
      const existingNames = new Set(existing.map(t => t.name));
      const additions = perCallConfig.additionalTools.filter(t => !existingNames.has(t.name));
      baseTools = additions.length > 0 ? [...existing, ...additions] : existing;
    }

    const hasTools = (baseTools?.length ?? 0) > 0 && (hasBuiltins || hasMcp);

    // ToolRAG: filter tools once per message (fail-open)
    let effectiveTools = baseTools;
    if (this.deps.toolRAG && this.deps.capabilityMap && effectiveTools && effectiveTools.length > 30) {
      try {
        const userText = extractText(userParts);
        const allCapabilities = Array.from(this.deps.capabilityMap.values());
        const selected = await this.deps.toolRAG.selectTools(userText, allCapabilities);
        if (selected.length > 0) {
          const selectedNames = new Set(selected.map((s) => s.name));
          effectiveTools = effectiveTools.filter((t) => selectedNames.has(t.name));
        }
      } catch {
        // Fail-open: use all tools if ToolRAG fails
      }
    }

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;

    const toolExecutions: ToolExecutionSummary[] = [];

    for (let round = 0; round < this.maxToolRounds; round++) {
      // Budget check (skip first round -- let the user's message through)
      if (round > 0 && this.deps.budgetChecker) {
        try {
          const budget = await this.deps.budgetChecker();
          if (!budget.allowed) {
            this.emitError(session.id, budget.message ?? "Budget exhausted");
            break;
          }
        } catch {
          // Fail-open: continue if budget check fails
        }
      }

      const messages = [...session.conversationHistory];

      const response = await this.deps.provider.createMessage({
        system,
        messages,
        tools: hasTools ? effectiveTools : undefined,
        maxTokens: this.deps.maxTokens,
      });

      totalInputTokens += response.inputTokens;
      totalOutputTokens += response.outputTokens;
      totalCacheRead += response.cacheReadTokens;
      totalCacheWrite += response.cacheWriteTokens;

      this.emitCostUpdate(session.id, totalInputTokens, totalOutputTokens, totalCacheRead, totalCacheWrite, session.activeAgentId);

      if (!hasTools || response.toolCalls.length === 0) {
        session.addAssistantMessage(response.parts);

        // Post-LLM escalation check (only if pre-LLM didn't trigger)
        if (!escalation && this.deps.escalationDetector) {
          const postSignal = this.deps.escalationDetector.checkPostLLM(session, response.parts);
          if (postSignal) escalation = postSignal;
        }

        // Generate context summary if escalation detected and summarizer available
        let contextSummary: string | undefined;
        if (escalation && this.deps.contextSummarizer) {
          try {
            contextSummary = await this.deps.contextSummarizer.summarize(session);
          } catch {
            // Non-critical: proceed without summary
          }
        }

        return {
          parts: response.parts,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheReadTokens: totalCacheRead,
          cacheWriteTokens: totalCacheWrite,
          queued: false,
          escalation,
          contextSummary,
          toolExecutions: toolExecutions.length > 0 ? toolExecutions : undefined,
        };
      }

      // Build assistant message with text + tool_use parts
      const assistantParts: ContentPart[] = [...response.parts];
      for (const tc of response.toolCalls) {
        assistantParts.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }
      session.addAssistantMessage(assistantParts);

      // Execute tools and build tool_result parts
      const resultParts: ContentPart[] = [];
      for (const tc of response.toolCalls) {
        // Tool allowlist check
        if (perCallConfig?.toolAllowlist && !perCallConfig.toolAllowlist.has(tc.name)) {
          resultParts.push({
            type: "tool_result",
            toolUseId: tc.id,
            content: `Tool "${tc.name}" is not available for this tenant`,
            isError: true,
          });
          continue;
        }

        // Authorization check
        const capability = this.deps.capabilityMap?.get(tc.name);
        if (this.deps.toolAuthorizer) {
          const authResult = this.deps.toolAuthorizer.authorize(tc.name, capability?.annotations);
          this.emitToolAuthorized(session.id, tc.name, authResult.level, authResult.allowed, authResult.reason);

          if (!authResult.allowed) {
            resultParts.push({
              type: "tool_result",
              toolUseId: tc.id,
              content: `Authorization denied: ${authResult.reason}`,
              isError: true,
            });
            continue;
          }
        }

        // Rate limit check
        if (perCallConfig?.rateLimiter && perCallConfig?.tenantId) {
          const rateResult = perCallConfig.rateLimiter.check(perCallConfig.tenantId, tc.name);
          if (!rateResult.allowed) {
            const retryAfterSec = Math.ceil((rateResult.retryAfterMs ?? 60_000) / 1000);
            resultParts.push({
              type: "tool_result",
              toolUseId: tc.id,
              content: `Rate limit exceeded for tool "${tc.name}". Try again in ${retryAfterSec} seconds.`,
              isError: true,
            });
            continue;
          }
        }

        // Resolve cacheTtl before try block so it's accessible for both check and store
        const cacheTtl = capability?.annotations?.cacheTtl;

        // Cache check (fail-open)
        if (cacheTtl && this.deps.toolCache) {
          try {
            const cached = this.deps.toolCache.get(tc.name, tc.input);
            if (cached !== undefined) {
              const resultString = typeof cached === "string" ? cached : JSON.stringify(cached);
              this.emitToolCacheHit(session.id, tc.name, cacheTtl);
              resultParts.push({
                type: "tool_result",
                toolUseId: tc.id,
                content: resultString,
                isError: false,
              });
              continue;
            }
          } catch {
            // Fail-open: proceed to execute tool if cache throws
          }
        }

        const annotations = capability?.annotations
          ? { readOnly: capability.annotations.readOnly, destructive: capability.annotations.destructive, idempotent: capability.annotations.idempotent }
          : undefined;
        this.emitToolCalled(session.id, tc.name, tc.input, annotations);
        const startMs = Date.now();

        try {
          let resultValue: unknown;
          let retryAttempt: number | undefined;

          // Use executeWithRetry if capability has retry config
          if (capability?.retry) {
            const executor = (name: string, input: Record<string, unknown>) =>
              this.executeTool({ id: tc.id, name, input });
            const fallbackExecutor = capability.retry.fallback
              ? (name: string, input: Record<string, unknown>) => this.executeTool({ id: tc.id, name, input })
              : undefined;

            const execResult: ToolExecutionResult = await executeWithRetry(
              tc.name,
              tc.input,
              executor,
              capability.retry,
              fallbackExecutor,
            );
            resultValue = execResult.result;
            retryAttempt = execResult.attempts > 1 ? execResult.attempts : undefined;
          } else {
            resultValue = await this.executeTool(tc);
          }

          const durationMs = Date.now() - startMs;
          let resultString = typeof resultValue === "string" ? resultValue : JSON.stringify(resultValue);

          // Result sanitization
          let sanitized = false;
          if (this.deps.toolResultSanitizer) {
            const sanitizationResult = await this.deps.toolResultSanitizer.sanitize(resultString);
            if (sanitizationResult.sanitized) {
              resultString = sanitizationResult.content;
              sanitized = true;
            }
          }

          this.emitToolResult(session.id, tc.name, durationMs, true, resultString.slice(0, 200), false, retryAttempt);

          toolExecutions.push({
            toolName: tc.name,
            durationMs,
            success: true,
            resultSummary: resultString.slice(0, 200),
          });

          // Audit log
          this.appendAudit(tc.name, durationMs, sanitized ? "success_sanitized" : "success");

          resultParts.push({
            type: "tool_result",
            toolUseId: tc.id,
            content: resultString,
            isError: false,
          });

          // Cache store (fail-open)
          if (cacheTtl && this.deps.toolCache) {
            try {
              this.deps.toolCache.set(tc.name, tc.input, resultValue, cacheTtl);
            } catch {
              // Fail-open: don't break execution if cache store fails
            }
          }

          // Record rate limit usage after successful execution
          if (perCallConfig?.rateLimiter && perCallConfig?.tenantId) {
            perCallConfig.rateLimiter.record(perCallConfig.tenantId, tc.name);
          }
        } catch (err) {
          const durationMs = Date.now() - startMs;
          const errMsg = err instanceof Error ? err.message : String(err);
          this.emitToolResult(session.id, tc.name, durationMs, false, errMsg.slice(0, 200), true);

          toolExecutions.push({
            toolName: tc.name,
            durationMs,
            success: false,
            resultSummary: errMsg.slice(0, 200),
          });

          this.emitError(session.id, `Tool "${tc.name}" failed: ${err}`);
          this.appendAudit(tc.name, durationMs, "error");

          resultParts.push({
            type: "tool_result",
            toolUseId: tc.id,
            content: `Error: ${errMsg}`,
            isError: true,
          });
        }
      }
      session.addUserMessage(resultParts);
    }

    // Safety: max rounds exceeded, return last available response
    this.emitError(session.id, `Max tool rounds (${this.maxToolRounds}) exceeded`);

    const finalMessages = [...session.conversationHistory];
    const finalResponse = await this.deps.provider.createMessage({
      system,
      messages: finalMessages,
      maxTokens: this.deps.maxTokens,
    });

    totalInputTokens += finalResponse.inputTokens;
    totalOutputTokens += finalResponse.outputTokens;
    totalCacheRead += finalResponse.cacheReadTokens;
    totalCacheWrite += finalResponse.cacheWriteTokens;

    this.emitCostUpdate(session.id, totalInputTokens, totalOutputTokens, totalCacheRead, totalCacheWrite, session.activeAgentId);

    session.addAssistantMessage(finalResponse.parts);

    // Post-LLM escalation check (only if pre-LLM didn't trigger)
    if (!escalation && this.deps.escalationDetector) {
      const postSignal = this.deps.escalationDetector.checkPostLLM(session, finalResponse.parts);
      if (postSignal) escalation = postSignal;
    }

    // Generate context summary if escalation detected and summarizer available
    let contextSummary: string | undefined;
    if (escalation && this.deps.contextSummarizer) {
      try {
        contextSummary = await this.deps.contextSummarizer.summarize(session);
      } catch {
        // Non-critical: proceed without summary
      }
    }

    return {
      parts: finalResponse.parts,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheWrite,
      queued: false,
      escalation,
      contextSummary,
      toolExecutions: toolExecutions.length > 0 ? toolExecutions : undefined,
    };
  }

  private async executeTool(tc: ToolCall): Promise<unknown> {
    // Check per-call builtin tools first, then dep-level builtins
    const callBuiltin = this._callBuiltinTools?.get(tc.name);
    if (callBuiltin) return callBuiltin(tc.input);

    const depBuiltin = this.deps.builtinTools?.get(tc.name);
    if (depBuiltin) return depBuiltin(tc.input);

    // Fall back to MCP clients
    if (this.deps.mcpClients) {
      for (const client of this.deps.mcpClients) {
        try {
          return await client.executeTool(tc.name, tc.input);
        } catch {
          continue;
        }
      }
    }

    throw new Error(`Tool "${tc.name}" not found`);
  }

  private emitToolCalled(
    sessionId: string,
    toolName: string,
    toolInput?: Record<string, unknown>,
    annotations?: Record<string, unknown>,
  ): void {
    const event: ToolCalledEvent = {
      type: "tool_called",
      toolName,
      timestamp: new Date(),
      sessionId,
      ...(toolInput ? { toolInput } : {}),
      ...(annotations ? { annotations } : {}),
    };
    this.deps.eventBus?.emit(event);
  }

  private emitToolAuthorized(
    sessionId: string,
    toolName: string,
    level: number,
    allowed: boolean,
    reason: string,
  ): void {
    const event: ToolAuthorizedEvent = {
      type: "tool_authorized",
      toolName,
      level,
      allowed,
      reason,
      timestamp: new Date(),
      sessionId,
    };
    this.deps.eventBus?.emit(event);
  }

  private emitToolResult(
    sessionId: string,
    toolName: string,
    durationMs: number,
    success: boolean,
    resultSummary?: string,
    isError?: boolean,
    retryAttempt?: number,
  ): void {
    const event: ToolResultEvent = {
      type: "tool_result",
      toolName,
      durationMs,
      success,
      timestamp: new Date(),
      sessionId,
      ...(resultSummary ? { resultSummary } : {}),
      ...(isError !== undefined ? { isError } : {}),
      ...(retryAttempt !== undefined ? { retryAttempt } : {}),
    };
    this.deps.eventBus?.emit(event);
  }

  private emitToolCacheHit(sessionId: string, toolName: string, cacheTtl: number): void {
    const event: ToolCacheHitEvent = {
      type: "tool_cache_hit",
      toolName,
      cacheTtl,
      timestamp: new Date(),
      sessionId,
    };
    this.deps.eventBus?.emit(event);
  }

  private appendAudit(toolName: string, durationMs: number, outcome: "success" | "success_sanitized" | "error"): void {
    if (!this.deps.auditLog) return;
    try {
      this.deps.auditLog.append({
        timestamp: new Date(),
        action: "tool_execution",
        actor: "orchestrator",
        outcome,
        resource: toolName,
        metadata: { durationMs },
      });
    } catch {
      // Non-critical: don't fail tool execution for audit
    }
  }

  private computeTotalCostUsd(
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number,
  ): number {
    const pricing = this.resolvedPricing;
    if (!pricing) return 0;

    const uncachedInput = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);

    return (
      (uncachedInput * pricing.inputRate +
        outputTokens * pricing.outputRate +
        cacheReadTokens * pricing.inputRate * pricing.cacheReadMultiplier +
        cacheWriteTokens * pricing.inputRate * pricing.cacheWriteMultiplier) /
      1_000_000
    );
  }

  private get resolvedPricing(): ModelPricing | undefined {
    if (!this.deps.model) return undefined;
    const pricing = MODEL_PRICING.get(this.deps.model);
    if (!pricing) {
      console.warn(`[ModeBOrchestrator] Model "${this.deps.model}" not found in MODEL_PRICING -- cost will be $0. Add it to the pricing table or use a known model identifier.`);
    }
    return pricing;
  }

  private emitCostUpdate(
    sessionId: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number,
    agentId?: string,
  ): void {
    const totalCostUsd = this.computeTotalCostUsd(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);
    const model = this.deps.model ?? "unknown";

    const event: CostUpdateEvent = {
      type: "cost_update",
      inputTokens,
      outputTokens,
      cacheReadTokens,
      totalCostUsd,
      byRole: {
        assistant: { model, calls: 1, costUsd: totalCostUsd },
      },
      timestamp: new Date(),
      sessionId,
      ...(agentId ? { agentId } : {}),
    };
    this.deps.eventBus?.emit(event);
  }

  private emitError(sessionId: string, message: string): void {
    const event: ErrorEvent = {
      type: "error",
      message,
      code: "MODE_B_ERROR",
      taskId: null,
      timestamp: new Date(),
      sessionId,
    };
    this.deps.eventBus?.emit(event);
  }
}
