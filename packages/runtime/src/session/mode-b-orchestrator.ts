import type { ProviderAdapter, ContentPart, ToolDefinition, ToolCall } from "@kilnai/core";
import type { McpClient } from "@kilnai/core";
import type {
  EventBus,
  ToolCalledEvent,
  ToolResultEvent,
  CostUpdateEvent,
  ErrorEvent,
} from "@kilnai/core";
import { MODEL_PRICING } from "@kilnai/core";
import type { ModelPricing } from "@kilnai/core";
import type { ModeBSession } from "./mode-b-session.js";

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
}

export interface OrchestrateResult {
  readonly parts: readonly ContentPart[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
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
  ): Promise<OrchestrateResult> {
    session.addUserMessage(userParts);

    let system = session.systemPrompt;
    if (recalledMemory) {
      system += "\n\n--- Recalled Memory ---\n" + recalledMemory;
    }

    // Merge dep-level and per-call builtin tools
    this._callBuiltinTools = callBuiltinTools;
    const hasBuiltins = (this.deps.builtinTools?.size ?? 0) + (callBuiltinTools?.size ?? 0) > 0;
    const hasMcp = (this.deps.mcpClients?.length ?? 0) > 0;
    const hasTools = (this._tools?.length ?? 0) > 0 && (hasBuiltins || hasMcp);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;

    for (let round = 0; round < this.maxToolRounds; round++) {
      const messages = [...session.conversationHistory];

      const response = await this.deps.provider.createMessage({
        system,
        messages,
        tools: hasTools ? this._tools : undefined,
        maxTokens: this.deps.maxTokens,
      });

      totalInputTokens += response.inputTokens;
      totalOutputTokens += response.outputTokens;
      totalCacheRead += response.cacheReadTokens;
      totalCacheWrite += response.cacheWriteTokens;

      this.emitCostUpdate(session.id, totalInputTokens, totalOutputTokens, totalCacheRead, totalCacheWrite);

      if (!hasTools || response.toolCalls.length === 0) {
        session.addAssistantMessage(response.parts);
        return {
          parts: response.parts,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheReadTokens: totalCacheRead,
          cacheWriteTokens: totalCacheWrite,
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
        this.emitToolCalled(session.id, tc.name);
        const startMs = Date.now();

        try {
          const result = await this.executeTool(tc);
          const durationMs = Date.now() - startMs;
          this.emitToolResult(session.id, tc.name, durationMs, true);

          resultParts.push({
            type: "tool_result",
            toolUseId: tc.id,
            content: typeof result === "string" ? result : JSON.stringify(result),
            isError: false,
          });
        } catch (err) {
          const durationMs = Date.now() - startMs;
          this.emitToolResult(session.id, tc.name, durationMs, false);
          this.emitError(session.id, `Tool "${tc.name}" failed: ${err}`);

          resultParts.push({
            type: "tool_result",
            toolUseId: tc.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
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

    this.emitCostUpdate(session.id, totalInputTokens, totalOutputTokens, totalCacheRead, totalCacheWrite);

    session.addAssistantMessage(finalResponse.parts);
    return {
      parts: finalResponse.parts,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheWrite,
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

  private emitToolCalled(sessionId: string, toolName: string): void {
    const event: ToolCalledEvent = {
      type: "tool_called",
      toolName,
      timestamp: new Date(),
      sessionId,
    };
    this.deps.eventBus?.emit(event);
  }

  private emitToolResult(sessionId: string, toolName: string, durationMs: number, success: boolean): void {
    const event: ToolResultEvent = {
      type: "tool_result",
      toolName,
      durationMs,
      success,
      timestamp: new Date(),
      sessionId,
    };
    this.deps.eventBus?.emit(event);
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
