import type {
  ToolCall,
  EventBus,
  ToolCalledEvent,
  ToolAuthorizedEvent,
  ToolResultEvent,
  ToolCacheHitEvent,
  Capability,
  ToolExecutionResult,
  AuthorityDescriptor,
  ToolAuthorizationResult,
} from "@kilnai/core";
import { executeWithRetry } from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import type {
  DangerousCommandDecisionLike,
  DangerousCommandRequestLike,
  OrchestratorDeps,
  PerCallToolConfig,
  ToolExecutionSummary,
  CommandShell,
} from "./runtime-session-orchestrator.types.js";

const COMMAND_TOOL_SHELL_BY_NAME = new Map<string, CommandShell>([
  ["bash", "bash"],
  ["sh", "sh"],
  ["zsh", "zsh"],
  ["powershell", "powershell"],
  ["pwsh", "powershell"],
  ["cmd", "cmd"],
  ["command_execution", "any"],
  ["command", "any"],
  ["shell", "any"],
]);

function parseCommandShell(value: unknown): CommandShell | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "bash"
    || normalized === "sh"
    || normalized === "zsh"
    || normalized === "powershell"
    || normalized === "cmd"
    || normalized === "any"
  ) {
    return normalized;
  }
  if (normalized === "pwsh") return "powershell";
  return undefined;
}

function toDangerousCommandRequest(
  toolName: string,
  input: Record<string, unknown>,
): DangerousCommandRequestLike | undefined {
  const inferredShell = COMMAND_TOOL_SHELL_BY_NAME.get(toolName.toLowerCase());
  if (!inferredShell) return undefined;
  const command = input.command;
  if (typeof command !== "string") return undefined;
  const explicitShell = parseCommandShell(input.shell);
  return {
    command,
    shell: explicitShell ?? inferredShell,
  };
}

export interface RuntimeSessionToolExecutionResult {
  readonly resultParts: readonly {
    readonly type: "tool_result";
    readonly toolUseId: string;
    readonly content: string;
    readonly isError: boolean;
  }[];
  readonly toolExecutions: readonly ToolExecutionSummary[];
}

export class RuntimeSessionToolExecutor {
  constructor(
    private readonly deps: OrchestratorDeps,
    private readonly eventBus: EventBus | undefined,
    private readonly requestApproval: (
      sessionId: string,
      description: string,
    ) => Promise<{ approved: boolean; reason?: string }>,
    private readonly emitError: (sessionId: string, message: string) => void,
    private readonly callBuiltinTools?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>,
  ) {}

  async executeToolCalls(
    session: RuntimeSession,
    toolCalls: readonly ToolCall[],
    perCallConfig?: PerCallToolConfig,
  ): Promise<RuntimeSessionToolExecutionResult> {
    const resultParts: Array<{
      readonly type: "tool_result";
      readonly toolUseId: string;
      readonly content: string;
      readonly isError: boolean;
    }> = [];
    const toolExecutions: ToolExecutionSummary[] = [];

    for (const toolCall of toolCalls) {
      if (perCallConfig?.toolAllowlist && !perCallConfig.toolAllowlist.has(toolCall.name)) {
        resultParts.push({
          type: "tool_result",
          toolUseId: toolCall.id,
          content: `Tool "${toolCall.name}" is not available for this tenant`,
          isError: true,
        });
        continue;
      }

      const capability = this.resolveCapability(toolCall.name, perCallConfig);
      const authResult = this.resolveAuthorization(toolCall.name, capability, perCallConfig);
      if (authResult) {
        this.emitToolAuthorized(session.id, toolCall.name, authResult.level, authResult.allowed, authResult.reason);
        if (!authResult.allowed) {
          if (authResult.requiresApproval) {
            const approval = await this.requestApproval(
              session.id,
              `Tool "${toolCall.name}" requires approval: ${authResult.reason}`,
            );
            if (!approval.approved) {
              resultParts.push({
                type: "tool_result",
                toolUseId: toolCall.id,
                content: `Approval denied: ${approval.reason ?? authResult.reason}`,
                isError: true,
              });
              continue;
            }
          } else {
            resultParts.push({
              type: "tool_result",
              toolUseId: toolCall.id,
              content: `Authorization denied: ${authResult.reason}`,
              isError: true,
            });
            continue;
          }
        }
      }

      if (await this.handleDangerousCommandBlock(session.id, toolCall, authResult, resultParts, toolExecutions)) {
        continue;
      }

      if (this.handleRateLimitBlock(toolCall, perCallConfig, resultParts)) {
        continue;
      }

      const cacheTtl = capability?.annotations?.cacheTtl;
      const cachedResult = await this.tryCachedToolResult(session.id, toolCall, cacheTtl, resultParts);
      if (cachedResult.hit) {
        continue;
      }

      const annotations = capability?.annotations
        ? {
            readOnly: capability.annotations.readOnly,
            destructive: capability.annotations.destructive,
            idempotent: capability.annotations.idempotent,
          }
        : undefined;
      this.emitToolCalled(session.id, toolCall.name, toolCall.input, annotations);
      const startMs = Date.now();

      try {
        const execution = await this.executeToolWithPolicy(toolCall, capability);
        const durationMs = Date.now() - startMs;
        const sanitized = await this.sanitizeToolResult(execution.resultValue);

        this.emitToolResult(
          session.id,
          toolCall.name,
          durationMs,
          true,
          sanitized.resultSummary,
          false,
          execution.retryAttempt,
        );

        const fileChanges = this.extractFileChangesFromToolResult(toolCall.name, execution.resultValue);
        toolExecutions.push({
          toolName: toolCall.name,
          durationMs,
          success: true,
          resultSummary: sanitized.resultSummary,
          fileChanges,
        });

        this.appendAudit(toolCall.name, durationMs, sanitized.sanitized ? "success_sanitized" : "success", authResult);
        resultParts.push({
          type: "tool_result",
          toolUseId: toolCall.id,
          content: sanitized.resultValue,
          isError: false,
        });

        if (cacheTtl && this.deps.toolCache) {
          try {
            this.deps.toolCache.set(toolCall.name, toolCall.input, execution.resultValueRaw, cacheTtl);
          } catch {
            // Fail-open: do not break execution if cache store fails.
          }
        }

        if (perCallConfig?.rateLimiter && perCallConfig.tenantId) {
          perCallConfig.rateLimiter.record(perCallConfig.tenantId, toolCall.name);
        }
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const errMsg = err instanceof Error ? err.message : String(err);
        this.emitToolResult(session.id, toolCall.name, durationMs, false, errMsg.slice(0, 200), true);
        toolExecutions.push({
          toolName: toolCall.name,
          durationMs,
          success: false,
          resultSummary: errMsg.slice(0, 200),
        });
        this.emitError(session.id, `Tool "${toolCall.name}" failed: ${err}`);
        this.appendAudit(toolCall.name, durationMs, "error", authResult);
        resultParts.push({
          type: "tool_result",
          toolUseId: toolCall.id,
          content: `Error: ${errMsg}`,
          isError: true,
        });
      }
    }

    return { resultParts, toolExecutions };
  }

  private resolveCapability(name: string, perCallConfig?: PerCallToolConfig): Capability | undefined {
    return this.deps.capabilityMap?.get(name) ?? perCallConfig?.perCallCapabilities?.get(name);
  }

  private resolveAuthorization(
    toolName: string,
    capability: Capability | undefined,
    perCallConfig?: PerCallToolConfig,
  ): ToolAuthorizationResult | undefined {
    const authority = perCallConfig?.toolAuthority?.get(toolName);
    if (authority !== undefined) {
      if (!this.isAuthorityDescriptor(authority)) {
        return {
          level: 4,
          allowed: false,
          requiresApproval: false,
          reason: "Invalid authority descriptor; execution denied",
        };
      }
      return {
        level: authority.level,
        allowed: authority.allowed,
        requiresApproval: authority.requiresApproval,
        reason: authority.reason,
      };
    }
    if (!this.deps.toolAuthorizer) {
      return undefined;
    }
    return this.deps.toolAuthorizer.authorize(toolName, capability?.annotations);
  }

  private isAuthorityDescriptor(value: unknown): value is AuthorityDescriptor {
    if (!value || typeof value !== "object") {
      return false;
    }

    const candidate = value as {
      level?: unknown;
      allowed?: unknown;
      requiresApproval?: unknown;
      reason?: unknown;
    };

    const validLevel = candidate.level === 1
      || candidate.level === 2
      || candidate.level === 3
      || candidate.level === 4;

    return validLevel
      && typeof candidate.allowed === "boolean"
      && typeof candidate.requiresApproval === "boolean"
      && typeof candidate.reason === "string"
      && candidate.reason.length > 0;
  }

  private async handleDangerousCommandBlock(
    sessionId: string,
    toolCall: ToolCall,
    authResult: ToolAuthorizationResult | undefined,
    resultParts: Array<{
      readonly type: "tool_result";
      readonly toolUseId: string;
      readonly content: string;
      readonly isError: boolean;
    }>,
    toolExecutions: ToolExecutionSummary[],
  ): Promise<boolean> {
    if (!this.deps.dangerousCommandDetector) {
      return false;
    }

    const dangerousRequest = toDangerousCommandRequest(toolCall.name, toolCall.input);
    if (!dangerousRequest) {
      return false;
    }

    let decision: DangerousCommandDecisionLike;
    if (dangerousRequest.command.trim().length === 0) {
      decision = {
        action: "deny",
        reasonCode: "empty_command",
        reason: "Command input cannot be empty.",
      };
    } else {
      try {
        decision = this.deps.dangerousCommandDetector.evaluate(dangerousRequest);
      } catch (err) {
        const detectorError = err instanceof Error ? err.message : String(err);
        this.emitError(sessionId, `Dangerous command detector failed for tool "${toolCall.name}": ${detectorError}`);
        decision = {
          action: "deny",
          reasonCode: "detector_error",
          reason: "Dangerous command detector failed; execution blocked by policy.",
        };
      }
    }

    if (decision.action === "allow") {
      return false;
    }

    const blockMessage = decision.action === "deny"
      ? `Dangerous command blocked: ${decision.reason} (${decision.reasonCode})`
      : `Command requires approval: ${decision.reason} (${decision.reasonCode})`;

    this.emitToolResult(sessionId, toolCall.name, 0, false, blockMessage.slice(0, 200), true);
    this.emitError(sessionId, `Tool "${toolCall.name}" blocked by dangerous command detector: ${decision.reasonCode}`);
    this.appendAudit(toolCall.name, 0, "error", authResult);
    toolExecutions.push({
      toolName: toolCall.name,
      durationMs: 0,
      success: false,
      resultSummary: blockMessage.slice(0, 200),
    });
    resultParts.push({
      type: "tool_result",
      toolUseId: toolCall.id,
      content: blockMessage,
      isError: true,
    });
    return true;
  }

  private handleRateLimitBlock(
    toolCall: ToolCall,
    perCallConfig: PerCallToolConfig | undefined,
    resultParts: Array<{
      readonly type: "tool_result";
      readonly toolUseId: string;
      readonly content: string;
      readonly isError: boolean;
    }>,
  ): boolean {
    if (!perCallConfig?.rateLimiter || !perCallConfig.tenantId) {
      return false;
    }
    const rateResult = perCallConfig.rateLimiter.check(perCallConfig.tenantId, toolCall.name);
    if (rateResult.allowed) {
      return false;
    }
    const retryAfterSec = Math.ceil((rateResult.retryAfterMs ?? 60_000) / 1000);
    resultParts.push({
      type: "tool_result",
      toolUseId: toolCall.id,
      content: `Rate limit exceeded for tool "${toolCall.name}". Try again in ${retryAfterSec} seconds.`,
      isError: true,
    });
    return true;
  }

  private async tryCachedToolResult(
    sessionId: string,
    toolCall: ToolCall,
    cacheTtl: number | undefined,
    resultParts: Array<{
      readonly type: "tool_result";
      readonly toolUseId: string;
      readonly content: string;
      readonly isError: boolean;
    }>,
  ): Promise<{ readonly hit: boolean }> {
    if (!cacheTtl || !this.deps.toolCache) {
      return { hit: false };
    }

    try {
      const cached = this.deps.toolCache.get(toolCall.name, toolCall.input);
      if (cached === undefined) {
        return { hit: false };
      }
      let resultString = typeof cached === "string" ? cached : JSON.stringify(cached);
      if (this.deps.toolResultSanitizer) {
        try {
          const sanitizationResult = await this.deps.toolResultSanitizer.sanitize(resultString);
          if (sanitizationResult.sanitized) {
            resultString = sanitizationResult.content;
          }
        } catch (err) {
          const sanitizerError = err instanceof Error ? err.message : String(err);
          this.emitError(sessionId, `Tool result sanitizer failed for cached tool "${toolCall.name}": ${sanitizerError}`);
        }
      }
      this.emitToolCacheHit(sessionId, toolCall.name, cacheTtl);
      resultParts.push({
        type: "tool_result",
        toolUseId: toolCall.id,
        content: resultString,
        isError: false,
      });
      return { hit: true };
    } catch {
      return { hit: false };
    }
  }

  private async executeToolWithPolicy(
    toolCall: ToolCall,
    capability: Capability | undefined,
  ): Promise<{
    readonly resultValueRaw: unknown;
    readonly resultValue: string;
    readonly retryAttempt?: number;
  }> {
    let resultValueRaw: unknown;
    let retryAttempt: number | undefined;

    if (capability?.retry) {
      const executor = (name: string, input: Record<string, unknown>) =>
        this.executeTool({ id: toolCall.id, name, input });
      const fallbackExecutor = capability.retry.fallback
        ? (name: string, input: Record<string, unknown>) => this.executeTool({ id: toolCall.id, name, input })
        : undefined;

      const execResult: ToolExecutionResult = await executeWithRetry(
        toolCall.name,
        toolCall.input,
        executor,
        capability.retry,
        fallbackExecutor,
      );
      resultValueRaw = execResult.result;
      retryAttempt = execResult.attempts > 1 ? execResult.attempts : undefined;
    } else {
      resultValueRaw = await this.executeTool(toolCall);
    }

    return {
      resultValueRaw,
      resultValue: typeof resultValueRaw === "string" ? resultValueRaw : JSON.stringify(resultValueRaw),
      retryAttempt,
    };
  }

  private async sanitizeToolResult(resultValue: unknown): Promise<{
    readonly resultValue: string;
    readonly resultSummary: string;
    readonly sanitized: boolean;
  }> {
    let resultString = typeof resultValue === "string" ? resultValue : JSON.stringify(resultValue);
    let sanitized = false;
    if (this.deps.toolResultSanitizer) {
      const sanitizationResult = await this.deps.toolResultSanitizer.sanitize(resultString);
      if (sanitizationResult.sanitized) {
        resultString = sanitizationResult.content;
        sanitized = true;
      }
    }
    return {
      resultValue: resultString,
      resultSummary: resultString.slice(0, 200),
      sanitized,
    };
  }

  private extractFileChangesFromToolResult(
    toolName: string,
    resultValue: unknown,
  ): readonly { readonly path: string; readonly changeType: "modified" }[] | undefined {
    if (toolName !== "write" && toolName !== "edit") {
      return undefined;
    }
    if (!resultValue || typeof resultValue !== "object") {
      return undefined;
    }
    const resultRecord = resultValue as { metadata?: Record<string, unknown> };
    const filePath = typeof resultRecord.metadata?.filePath === "string"
      ? resultRecord.metadata.filePath
      : undefined;
    if (!filePath || filePath.trim() === "") {
      return undefined;
    }
    return [{ path: filePath, changeType: "modified" }];
  }

  private async executeTool(toolCall: ToolCall): Promise<unknown> {
    const callBuiltin = this.callBuiltinTools?.get(toolCall.name);
    if (callBuiltin) return callBuiltin(toolCall.input);

    const depBuiltin = this.deps.builtinTools?.get(toolCall.name);
    if (depBuiltin) return depBuiltin(toolCall.input);

    if (this.deps.mcpClients) {
      for (const client of this.deps.mcpClients) {
        try {
          return await client.executeTool(toolCall.name, toolCall.input);
        } catch {
          continue;
        }
      }
    }

    throw new Error(`Tool "${toolCall.name}" not found`);
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
    this.eventBus?.emit(event);
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
    this.eventBus?.emit(event);
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
    this.eventBus?.emit(event);
  }

  private emitToolCacheHit(sessionId: string, toolName: string, cacheTtl: number): void {
    const event: ToolCacheHitEvent = {
      type: "tool_cache_hit",
      toolName,
      cacheTtl,
      timestamp: new Date(),
      sessionId,
    };
    this.eventBus?.emit(event);
  }

  private appendAudit(
    toolName: string,
    durationMs: number,
    outcome: "success" | "success_sanitized" | "error",
    authResult?: ToolAuthorizationResult,
  ): void {
    if (!this.deps.auditLog) return;
    try {
      const metadata: Record<string, string | number | boolean> = { durationMs };
      if (authResult) {
        metadata.authorityLevel = authResult.level;
        metadata.authorityAllowed = authResult.allowed;
        metadata.authorityRequiresApproval = authResult.requiresApproval;
        metadata.authorityReason = authResult.reason;
      }
      this.deps.auditLog.append({
        timestamp: new Date(),
        action: "tool_execution",
        actor: "orchestrator",
        outcome,
        resource: toolName,
        metadata,
      });
    } catch {
      // Non-critical: do not fail tool execution for audit.
    }
  }
}
