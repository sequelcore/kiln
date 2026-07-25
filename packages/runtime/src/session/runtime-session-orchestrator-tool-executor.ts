import type {
  ToolCall,
  EventBus,
  ToolCalledEvent,
  ToolOutputEvent,
  ToolAuthorizedEvent,
  ToolResultEvent,
  ToolCacheHitEvent,
  Capability,
  ToolExecutionResult,
  AuthorityDescriptor,
  FileToolChangeMetadata,
  FileToolResultMetadata,
  ToolResultPayloadPart,
  ResolvedInvocationEffect,
  SessionToolUsageSnapshot,
  ExecutionSessionToolResultResourceLink,
  WorkItemExecutionScopeTransition,
} from "@kilnai/core";
import {
  CONSERVATIVE_UNKNOWN_ENVELOPE,
  deriveAuthorityFromEffect,
  executeWithRetry,
  getBuiltinEffectEnvelope,
  getInvalidToolInputDetails,
  isFileToolResultMetadata,
  normalizeToolCall,
  resolveInvocationEffect,
} from "@kilnai/core";
import { buildRuntimeInvocationEffectResolvers } from "./runtime-invocation-effect-resolvers.js";
import type { RuntimeSession } from "./runtime-session.js";
import type {
  DangerousCommandDecisionLike,
  DangerousCommandRequestLike,
  OrchestratorDeps,
  PerCallToolConfig,
  RuntimeBuiltinToolExecutor,
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
const MAX_STREAMED_TOOL_OUTPUT_CHARS = 64 * 1024;
const MAX_TOOL_OUTPUT_CHUNK_CHARS = 8 * 1024;
const RUNTIME_INVOCATION_EFFECT_RESOLVERS = buildRuntimeInvocationEffectResolvers();
const TOOL_OUTPUT_TRUNCATION_MARKER = "\n… live output truncated; full terminal result follows …\n";

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

function isMcpToolName(toolName: string): boolean {
  return toolName.startsWith("mcp:");
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

function formatDangerousCommandBlockMessage(decision: DangerousCommandDecisionLike): string {
  return decision.action === "deny"
    ? `Dangerous command blocked: ${decision.reason} (${decision.reasonCode})`
    : `Command requires approval: ${decision.reason} (${decision.reasonCode})`;
}

function authorityFromResolvedInvocationEffect(
  admittedAuthority: AuthorityDescriptor,
  resolvedEffect: ResolvedInvocationEffect,
  declaredEffect: ResolvedInvocationEffect,
): AuthorityDescriptor | undefined {
  if (admittedAuthority.allowed && !admittedAuthority.requiresApproval) {
    return undefined;
  }
  const declaredAuthority = deriveAuthorityFromEffect(declaredEffect);
  if (!sameAuthorityDescriptor(admittedAuthority, declaredAuthority)) {
    return undefined;
  }
  const invocationAuthority = deriveAuthorityFromEffect(resolvedEffect);
  if (!invocationAuthority.allowed || invocationAuthority.requiresApproval) {
    return undefined;
  }
  return invocationAuthority;
}

function sameAuthorityDescriptor(
  left: AuthorityDescriptor,
  right: AuthorityDescriptor,
): boolean {
  return left.level === right.level
    && left.allowed === right.allowed
    && left.requiresApproval === right.requiresApproval
    && left.reason === right.reason;
}

function extractToolResultMetadata(resultValue: unknown): Record<string, unknown> | undefined {
  const resultRecord = resultValue && typeof resultValue === "object" && !Array.isArray(resultValue)
    ? resultValue as { metadata?: unknown }
    : undefined;
  return resultRecord?.metadata && typeof resultRecord.metadata === "object" && !Array.isArray(resultRecord.metadata)
    ? resultRecord.metadata as Record<string, unknown>
    : undefined;
}

function extractExecutionScopeTransition(
  metadata: Record<string, unknown> | undefined,
): WorkItemExecutionScopeTransition | undefined {
  const value = metadata?.executionScopeTransition;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const transition = value as Record<string, unknown>;
  if (transition.action !== "enter" && transition.action !== "exit") return undefined;
  const scopeValue = transition.scope;
  if (!scopeValue || typeof scopeValue !== "object" || Array.isArray(scopeValue)) return undefined;
  const scope = scopeValue as Record<string, unknown>;
  if (scope.kind !== "goal" && scope.kind !== "work_item") return undefined;
  if (typeof scope.goalRunId !== "string" || scope.goalRunId.trim().length === 0) return undefined;
  if (scope.kind === "work_item" && (
    typeof scope.workItemId !== "string" || scope.workItemId.trim().length === 0
  )) return undefined;
  if (scope.attemptId !== undefined && typeof scope.attemptId !== "string") return undefined;
  if (scope.managedInvocationId !== undefined && typeof scope.managedInvocationId !== "string") return undefined;
  return value as WorkItemExecutionScopeTransition;
}

function extractToolResultResourceLinks(
  metadata: Record<string, unknown> | undefined,
): readonly ExecutionSessionToolResultResourceLink[] | undefined {
  const links = metadata?.resourceLinks;
  if (!Array.isArray(links)) {
    return undefined;
  }
  const parsed = links.flatMap((link): ExecutionSessionToolResultResourceLink[] => {
    if (!link || typeof link !== "object" || Array.isArray(link)) {
      return [];
    }
    const record = link as Record<string, unknown>;
    if (typeof record.uri !== "string" || record.uri.trim().length === 0) {
      return [];
    }
    return [{
      uri: record.uri,
      ...(typeof record.title === "string" ? { title: record.title } : {}),
      ...(typeof record.label === "string" ? { label: record.label } : {}),
      ...(typeof record.sequence === "number" ? { sequence: record.sequence } : {}),
      ...(typeof record.mimeType === "string" ? { mimeType: record.mimeType } : {}),
      ...(typeof record.size === "number" ? { size: record.size } : {}),
      ...(typeof record.relation === "string" ? { relation: record.relation } : {}),
    }];
  });
  return parsed.length > 0 ? parsed : undefined;
}

function extractToolResultIsError(resultValue: unknown): boolean | undefined {
  const resultRecord = resultValue && typeof resultValue === "object" && !Array.isArray(resultValue)
    ? resultValue as { isError?: unknown }
    : undefined;
  return typeof resultRecord?.isError === "boolean" ? resultRecord.isError : undefined;
}

function extractToolResultOutput(resultValue: unknown): string | undefined {
  const resultRecord = resultValue && typeof resultValue === "object" && !Array.isArray(resultValue)
    ? resultValue as { output?: unknown }
    : undefined;
  return typeof resultRecord?.output === "string" ? resultRecord.output : undefined;
}

function extractToolResultContentParts(resultValue: unknown): readonly ToolResultPayloadPart[] | undefined {
  const resultRecord = resultValue && typeof resultValue === "object" && !Array.isArray(resultValue)
    ? resultValue as { content?: unknown }
    : undefined;
  if (!Array.isArray(resultRecord?.content)) {
    return undefined;
  }

  const parts = resultRecord.content
    .map(projectToolResultPayloadPart)
    .filter((part): part is ToolResultPayloadPart => part !== undefined);

  return parts.length > 0 ? parts : undefined;
}

function projectToolResultPayloadPart(value: unknown): ToolResultPayloadPart | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as {
    type?: unknown;
    text?: unknown;
    mimeType?: unknown;
    data?: unknown;
    url?: unknown;
    durationMs?: unknown;
    filename?: unknown;
  };

  if (candidate.type === "text" && typeof candidate.text === "string") {
    return { type: "text", text: candidate.text };
  }

  if (candidate.type !== "image" && candidate.type !== "audio" && candidate.type !== "file") {
    return undefined;
  }
  if (typeof candidate.mimeType !== "string" || candidate.mimeType.length === 0) {
    return undefined;
  }

  const data = typeof candidate.data === "string" ? candidate.data : undefined;
  const url = typeof candidate.url === "string" ? candidate.url : undefined;
  if ((data === undefined && url === undefined) || (data !== undefined && url !== undefined)) {
    return undefined;
  }

  if (candidate.type === "image") {
    return {
      type: "image",
      mimeType: candidate.mimeType,
      ...(data !== undefined ? { data } : {}),
      ...(url !== undefined ? { url } : {}),
    };
  }

  if (candidate.type === "audio") {
    const durationMs = typeof candidate.durationMs === "number" && Number.isFinite(candidate.durationMs)
      ? candidate.durationMs
      : undefined;
    return {
      type: "audio",
      mimeType: candidate.mimeType,
      ...(data !== undefined ? { data } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  }

  return {
    type: "file",
    mimeType: candidate.mimeType,
    ...(data !== undefined ? { data } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(typeof candidate.filename === "string" ? { filename: candidate.filename } : {}),
  };
}

function countLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  return value.split(/\r?\n/).length;
}

function clipDiffPreview(value: string): { readonly preview: string; readonly truncated: boolean } {
  const MAX_LINES = 24;
  const MAX_CHARS = 1200;
  const normalized = value.replace(/\r\n/g, "\n").trimEnd();
  if (normalized.length === 0) {
    return { preview: "", truncated: false };
  }

  const lines = normalized.split("\n");
  const keptLines = lines.slice(0, MAX_LINES);
  let preview = keptLines.join("\n");
  let truncated = lines.length > MAX_LINES;

  if (preview.length > MAX_CHARS) {
    preview = `${preview.slice(0, MAX_CHARS)}\n...`;
    truncated = true;
  }

  return { preview, truncated };
}

function normalizeFileChangeType(value: unknown): "created" | "modified" | "deleted" {
  if (value === "created") {
    return "created";
  }
  if (value === "deleted") {
    return "deleted";
  }
  return "modified";
}

function maybeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function maybeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

function isFileToolChangeMetadata(value: unknown): value is FileToolChangeMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    filePath?: unknown;
    changeType?: unknown;
  };
  return typeof candidate.filePath === "string"
    && (
      candidate.changeType === "created"
      || candidate.changeType === "modified"
      || candidate.changeType === "deleted"
    );
}

function buildWritePreview(content: string): string {
  if (content.length === 0) {
    return "+ (empty file)";
  }
  return content.split(/\r?\n/).map((line) => `+ ${line}`).join("\n");
}

function buildEditPreview(oldString: string, newString: string): string {
  const removed = oldString.length > 0 ? oldString.split(/\r?\n/).map((line) => `- ${line}`) : ["- (empty)"];
  const added = newString.length > 0 ? newString.split(/\r?\n/).map((line) => `+ ${line}`) : ["+ (empty)"];
  return [...removed, ...added].join("\n");
}

type RuntimeSessionToolResultPart = {
  readonly type: "tool_result";
  readonly toolUseId: string;
  readonly content: string;
  readonly contentParts?: readonly ToolResultPayloadPart[];
  readonly isError: boolean;
};

export interface RuntimeSessionToolExecutionResult {
  readonly resultParts: readonly RuntimeSessionToolResultPart[];
  readonly toolExecutions: readonly ToolExecutionSummary[];
}

export class RuntimeSessionToolExecutor {
  private currentSession: RuntimeSession | undefined;
  private currentExecutionScope: PerCallToolConfig["executionScope"];
  private activeExecutionScope: PerCallToolConfig["executionScope"];
  private readonly turnToolCallCounts = new Map<string, number>();

  constructor(
    private readonly deps: OrchestratorDeps,
    private readonly eventBus: EventBus | undefined,
    private readonly requestApproval: (
      sessionId: string,
      description: string,
      hasLiveAuthoritySource?: boolean,
    ) => Promise<{ approved: boolean; reason?: string }>,
    private readonly emitError: (sessionId: string, message: string) => void,
    private readonly callBuiltinTools?: ReadonlyMap<string, RuntimeBuiltinToolExecutor>,
  ) {}

  async executeToolCalls(
    session: RuntimeSession,
    toolCalls: readonly ToolCall[],
    perCallConfig?: PerCallToolConfig,
  ): Promise<RuntimeSessionToolExecutionResult> {
    this.currentSession = session;
    if (perCallConfig?.executionScope) {
      this.activeExecutionScope = perCallConfig.executionScope;
    }
    this.currentExecutionScope = perCallConfig?.executionScope ?? this.activeExecutionScope;
    this.turnToolCallCounts.clear();
    try {
    const resultParts: RuntimeSessionToolResultPart[] = [];
    const toolExecutions: ToolExecutionSummary[] = [];

    for (const toolCall of toolCalls) {
      const normalizedToolCall = normalizeToolCall(toolCall);
      let toolCallStarted = false;
      const emitStarted = (
        metadata?: Record<string, unknown>,
        resolvedEffect?: ResolvedInvocationEffect,
        authority?: AuthorityDescriptor,
      ) => {
        if (toolCallStarted) {
          return;
        }
        toolCallStarted = true;
        this.emitToolCalled(
          session.id,
          normalizedToolCall.id,
          normalizedToolCall.name,
          normalizedToolCall.input,
          metadata,
          resolvedEffect,
          authority,
        );
      };
      const invalidInput = getInvalidToolInputDetails(normalizedToolCall.input);
      if (invalidInput) {
        const content = this.formatInvalidToolInputMessage(normalizedToolCall.name, invalidInput);
        emitStarted();
        this.emitToolResult(
          session.id,
          normalizedToolCall.id,
          normalizedToolCall.name,
          0,
          false,
          content.slice(0, 200),
          true,
          undefined,
          content,
          undefined,
          undefined,
          this.recordToolUsage(normalizedToolCall.name),
        );
        resultParts.push({
          type: "tool_result",
          toolUseId: normalizedToolCall.id,
          content,
          isError: true,
        });
        toolExecutions.push({
          toolCallId: normalizedToolCall.id,
          toolName: normalizedToolCall.name,
          input: normalizedToolCall.input,
          durationMs: 0,
          success: false,
          output: content,
          resultSummary: content.slice(0, 200),
        });
        this.emitError(session.id, content);
        continue;
      }

      if (perCallConfig?.toolAllowlist && !perCallConfig.toolAllowlist.has(normalizedToolCall.name)) {
        const content = `Tool "${normalizedToolCall.name}" is not available for this tenant`;
        emitStarted();
        this.emitToolResult(
          session.id,
          normalizedToolCall.id,
          normalizedToolCall.name,
          0,
          false,
          content.slice(0, 200),
          true,
          undefined,
          content,
          undefined,
          undefined,
          this.recordToolUsage(normalizedToolCall.name),
        );
        resultParts.push({
          type: "tool_result",
          toolUseId: normalizedToolCall.id,
          content,
          isError: true,
        });
        toolExecutions.push({
          toolCallId: normalizedToolCall.id,
          toolName: normalizedToolCall.name,
          input: normalizedToolCall.input,
          durationMs: 0,
          success: false,
          output: content,
          resultSummary: content.slice(0, 200),
        });
        this.appendAudit(normalizedToolCall.name, 0, "error", {
          level: 4,
          allowed: false,
          requiresApproval: false,
          reason: "Tool is outside the tenant/session allowlist",
        });
        continue;
      }

      const metadata = this.resolveToolCallMetadata(session.id, normalizedToolCall.name, normalizedToolCall.input, perCallConfig);
      const capability = this.resolveCapability(normalizedToolCall.name, perCallConfig);
      const resolvedEffect = this.resolveInvocationEffect(
        normalizedToolCall.name,
        normalizedToolCall.input,
        capability,
      );
      const authResult = this.resolveAuthorization(
        normalizedToolCall.name,
        resolvedEffect,
        capability,
        perCallConfig,
      );
      let executionAuthority = authResult;
      if (authResult) {
        this.emitToolAuthorized(
          session.id,
          normalizedToolCall.name,
          authResult.level,
          authResult.allowed,
          authResult.reason,
          resolvedEffect,
          authResult,
        );
        if (!authResult.allowed) {
          if (authResult.requiresApproval) {
            const approval = await this.requestApproval(
              session.id,
              `Tool "${normalizedToolCall.name}" requires approval: ${authResult.reason}`,
              this.hasConfiguredAuthoritySource(normalizedToolCall.name, perCallConfig),
            );
            if (!approval.approved) {
              const content = `Approval denied: ${approval.reason ?? authResult.reason}`;
              emitStarted(metadata, resolvedEffect, authResult);
              this.emitToolResult(
                session.id,
                normalizedToolCall.id,
                normalizedToolCall.name,
                0,
                false,
                content.slice(0, 200),
                true,
                undefined,
                content,
                metadata,
                undefined,
                this.recordToolUsage(normalizedToolCall.name),
                resolvedEffect,
                authResult,
              );
              resultParts.push({
                type: "tool_result",
                toolUseId: normalizedToolCall.id,
                content,
                isError: true,
              });
              toolExecutions.push({
                toolCallId: normalizedToolCall.id,
                toolName: normalizedToolCall.name,
                input: normalizedToolCall.input,
                resolvedEffect,
                authority: authResult,
                durationMs: 0,
                success: false,
                output: content,
                resultSummary: content.slice(0, 200),
              });
              this.appendAudit(normalizedToolCall.name, 0, "error", authResult);
              continue;
            }
            executionAuthority = {
              level: authResult.level,
              allowed: true,
              requiresApproval: false,
              reason: "Approved for this invocation",
            };
          } else {
            const content = `Authorization denied: ${authResult.reason}`;
            emitStarted(metadata, resolvedEffect, authResult);
            this.emitToolResult(
              session.id,
              normalizedToolCall.id,
              normalizedToolCall.name,
              0,
              false,
              content.slice(0, 200),
              true,
              undefined,
              content,
              metadata,
              undefined,
              this.recordToolUsage(normalizedToolCall.name),
              resolvedEffect,
              authResult,
            );
            resultParts.push({
              type: "tool_result",
              toolUseId: normalizedToolCall.id,
              content,
              isError: true,
            });
            toolExecutions.push({
              toolCallId: normalizedToolCall.id,
              toolName: normalizedToolCall.name,
              input: normalizedToolCall.input,
              resolvedEffect,
              authority: authResult,
              durationMs: 0,
              success: false,
              output: content,
              resultSummary: content.slice(0, 200),
            });
            this.appendAudit(normalizedToolCall.name, 0, "error", authResult);
            continue;
          }
        }
      }

      emitStarted(metadata, resolvedEffect, executionAuthority);

      if (await this.handleDangerousCommandBlock(
        session.id,
        normalizedToolCall,
        executionAuthority,
        resolvedEffect,
        resultParts,
        toolExecutions,
        metadata,
      )) {
        continue;
      }

      if (this.handleRateLimitBlock(
        session.id,
        normalizedToolCall,
        perCallConfig,
        resultParts,
        toolExecutions,
        metadata,
        resolvedEffect,
        authResult,
      )) {
        continue;
      }

      const cacheTtl = capability?.cacheTtl;
      const cachedResult = await this.tryCachedToolResult(
        session.id,
        normalizedToolCall,
        cacheTtl,
        resultParts,
        toolExecutions,
        metadata,
        resolvedEffect,
        authResult,
      );
      if (cachedResult.hit) {
        continue;
      }

      const startMs = Date.now();

      try {
        const execution = await this.executeToolWithPolicy(
          normalizedToolCall,
          capability,
          perCallConfig,
          executionAuthority,
        );
        const durationMs = Date.now() - startMs;
        const sanitized = await this.sanitizeToolResult(execution.resultValue);
        const metadata = extractToolResultMetadata(execution.resultValueRaw);
        const resourceLinks = extractToolResultResourceLinks(metadata);
        const resultOutput = extractToolResultOutput(execution.resultValueRaw);
        const contentParts = sanitized.sanitized ? undefined : extractToolResultContentParts(execution.resultValueRaw);
        const envelopeIsError = extractToolResultIsError(execution.resultValueRaw);
        const isError = envelopeIsError === true;
        const success = !isError;
        const resultSummary = (resultOutput ?? sanitized.resultValue).slice(0, 200);
        const executionScopeTransition = success
          ? extractExecutionScopeTransition(metadata)
          : undefined;
        if (executionScopeTransition) {
          this.currentExecutionScope = executionScopeTransition.scope;
          if (executionScopeTransition.action === "enter") {
            this.activeExecutionScope = executionScopeTransition.scope;
          }
        }

        const executionScopeForResult = this.currentExecutionScope;
        this.emitToolResult(
          session.id,
          normalizedToolCall.id,
          normalizedToolCall.name,
          durationMs,
          success,
          resultSummary,
          isError,
          execution.retryAttempt,
          sanitized.resultValue,
          metadata,
          resourceLinks,
          this.recordToolUsage(normalizedToolCall.name),
          resolvedEffect,
          executionAuthority,
        );
        if (executionScopeTransition?.action === "exit") {
          this.activeExecutionScope = undefined;
          this.currentExecutionScope = undefined;
        }

        const fileChanges = this.extractFileChangesFromToolResult(
          normalizedToolCall.input,
          execution.resultValueRaw,
        );
        toolExecutions.push({
          toolCallId: normalizedToolCall.id,
          toolName: normalizedToolCall.name,
          input: normalizedToolCall.input,
          ...(metadata ? { metadata } : {}),
          resolvedEffect,
          authority: executionAuthority,
          durationMs,
          success,
          output: sanitized.resultValue,
          resultSummary,
          ...(executionScopeForResult ? { executionScope: executionScopeForResult } : {}),
          fileChanges,
        });

        this.appendAudit(
          normalizedToolCall.name,
          durationMs,
          isError
            ? "error"
            : (sanitized.sanitized ? "success_sanitized" : "success"),
          authResult,
        );
        resultParts.push({
          type: "tool_result",
          toolUseId: normalizedToolCall.id,
          content: resultOutput ?? sanitized.resultValue,
          ...(contentParts ? { contentParts } : {}),
          isError,
        });

        if (cacheTtl && this.deps.toolCache) {
          try {
            this.deps.toolCache.set(normalizedToolCall.name, normalizedToolCall.input, execution.resultValueRaw, cacheTtl);
          } catch {
            // Fail-open: do not break execution if cache store fails.
          }
        }

        if (perCallConfig?.rateLimiter && perCallConfig.tenantId) {
          perCallConfig.rateLimiter.record(perCallConfig.tenantId, normalizedToolCall.name);
        }
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const errMsg = err instanceof Error ? err.message : String(err);
        this.emitToolResult(
          session.id,
          normalizedToolCall.id,
          normalizedToolCall.name,
          durationMs,
          false,
          errMsg.slice(0, 200),
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          this.recordToolUsage(normalizedToolCall.name),
          resolvedEffect,
          authResult,
        );
        toolExecutions.push({
          toolCallId: normalizedToolCall.id,
          toolName: normalizedToolCall.name,
          input: normalizedToolCall.input,
          resolvedEffect,
          authority: authResult,
          durationMs,
          success: false,
          output: errMsg,
          resultSummary: errMsg.slice(0, 200),
        });
        this.emitError(session.id, `Tool "${normalizedToolCall.name}" failed: ${err}`);
        this.appendAudit(normalizedToolCall.name, durationMs, "error", authResult);
        resultParts.push({
          type: "tool_result",
          toolUseId: normalizedToolCall.id,
          content: `Error: ${errMsg}`,
          isError: true,
        });
      }
    }

    return { resultParts, toolExecutions };
    } finally {
      this.currentSession = undefined;
      this.currentExecutionScope = undefined;
    }
  }

  private formatInvalidToolInputMessage(
    toolName: string,
    invalidInput: {
      readonly reason: string;
      readonly raw: unknown;
    },
  ): string {
    const rawValue = typeof invalidInput.raw === "string"
      ? invalidInput.raw
      : JSON.stringify(invalidInput.raw);
    const compactRaw = rawValue.length > 160 ? `${rawValue.slice(0, 157)}...` : rawValue;
    return `Invalid input for tool "${toolName}": ${invalidInput.reason} Raw: ${compactRaw}`;
  }

  private resolveCapability(name: string, perCallConfig?: PerCallToolConfig): Capability | undefined {
    return this.deps.capabilityMap?.get(name) ?? perCallConfig?.perCallCapabilities?.get(name);
  }

  private resolveStaticAuthority(toolName: string, perCallConfig?: PerCallToolConfig): unknown {
    return perCallConfig?.toolAuthority?.get(toolName);
  }

  /**
   * Whether a tool name resolves through an operator-configured authority source
   * (a static per-call authority entry or a toolAuthorizer) as opposed to the
   * conservative deriveAuthorityFromEffect() fallback applied to unclassified
   * `mcp:` capabilities. Only a configured source implies a live approval channel
   * capable of eventually resolving an interactive approval request.
   */
  private hasConfiguredAuthoritySource(toolName: string, perCallConfig?: PerCallToolConfig): boolean {
    return this.resolveStaticAuthority(toolName, perCallConfig) !== undefined
      || Boolean(this.deps.toolAuthorizer);
  }

  private resolveAuthorization(
    toolName: string,
    resolvedEffect: ResolvedInvocationEffect,
    capability: Capability | undefined,
    perCallConfig?: PerCallToolConfig,
  ): AuthorityDescriptor | undefined {
    const authority = this.resolveStaticAuthority(toolName, perCallConfig);
    if (authority !== undefined) {
      if (!this.isAuthorityDescriptor(authority)) {
        return {
          level: 4,
          allowed: false,
          requiresApproval: false,
          reason: "Invalid authority descriptor; execution denied",
        };
      }
      const declaredEffect = capability?.effectEnvelope
        ?? getBuiltinEffectEnvelope(toolName)
        ?? CONSERVATIVE_UNKNOWN_ENVELOPE;
      const narrowedAuthority = authorityFromResolvedInvocationEffect(
        authority,
        resolvedEffect,
        declaredEffect,
      );
      if (narrowedAuthority) {
        return narrowedAuthority;
      }
      return {
        level: authority.level,
        allowed: authority.allowed,
        requiresApproval: authority.requiresApproval,
        reason: authority.reason,
      };
    }
    if (this.deps.toolAuthorizer) {
      return this.deps.toolAuthorizer.authorize(toolName, resolvedEffect);
    }
    if (isMcpToolName(toolName)) {
      // A dynamically-discovered MCP capability with no static authority entry
      // and no configured authorizer must still resolve through the canonical
      // effect-based policy instead of executing unchecked (fail closed).
      // Scoped to `mcp:` names rather than applied universally: governance and
      // work-item tools (work_governance.assess, goal.*, work_item.*,
      // managed_agent.invoke) have no declared effect envelope in the builtin
      // catalog, so a universal fallback would resolve every one of them to
      // CONSERVATIVE_UNKNOWN_ENVELOPE -> approval-required, deadlocking
      // governance itself. This is a workaround for that missing envelope
      // coverage, not a claim that builtin/dev tools are inherently safe to
      // run unchecked - once governance tools have declared envelopes, this
      // fallback should apply universally and the `mcp:` namespace check
      // should be deleted.
      return deriveAuthorityFromEffect(resolvedEffect);
    }
    return undefined;
  }

  private resolveInvocationEffect(
    toolName: string,
    input: Record<string, unknown>,
    capability: Capability | undefined,
  ): ResolvedInvocationEffect {
    const envelope = capability?.effectEnvelope ?? getBuiltinEffectEnvelope(toolName) ?? CONSERVATIVE_UNKNOWN_ENVELOPE;
    try {
      return resolveInvocationEffect(
        toolName,
        input,
        envelope,
        RUNTIME_INVOCATION_EFFECT_RESOLVERS,
      );
    } catch {
      return CONSERVATIVE_UNKNOWN_ENVELOPE;
    }
  }

  private resolveToolCallMetadata(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    perCallConfig?: PerCallToolConfig,
  ): Record<string, unknown> | undefined {
    const resolver = perCallConfig?.toolCallMetadata?.get(toolName);
    if (!resolver) {
      return undefined;
    }
    try {
      return resolver(toolInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emitError(sessionId, `Tool "${toolName}" metadata projection failed: ${message}`);
      return undefined;
    }
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
    authResult: AuthorityDescriptor | undefined,
    resolvedEffect: ResolvedInvocationEffect,
    resultParts: RuntimeSessionToolResultPart[],
    toolExecutions: ToolExecutionSummary[],
    metadata: Record<string, unknown> | undefined,
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

    const blockMessage = formatDangerousCommandBlockMessage(decision);
    const blockedMetadata = metadata ?? {
      toolName: toolCall.name,
      operation: "dangerous_command_blocked",
      reasonCode: decision.reasonCode,
    };

    this.emitToolResult(
      sessionId,
      toolCall.id,
      toolCall.name,
      0,
      false,
      blockMessage.slice(0, 200),
      true,
      undefined,
      blockMessage,
      blockedMetadata,
      undefined,
      this.recordToolUsage(toolCall.name),
      resolvedEffect,
      authResult,
    );
    this.emitError(sessionId, `Tool "${toolCall.name}" blocked by dangerous command detector: ${decision.reasonCode}`);
    this.appendAudit(toolCall.name, 0, "error", authResult);
    toolExecutions.push({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.input,
      resolvedEffect,
      authority: authResult,
      metadata: blockedMetadata,
      durationMs: 0,
      success: false,
      output: blockMessage,
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
    sessionId: string,
    toolCall: ToolCall,
    perCallConfig: PerCallToolConfig | undefined,
    resultParts: RuntimeSessionToolResultPart[],
    toolExecutions: ToolExecutionSummary[],
    metadata: Record<string, unknown> | undefined,
    resolvedEffect: ResolvedInvocationEffect,
    authResult: AuthorityDescriptor | undefined,
  ): boolean {
    if (!perCallConfig?.rateLimiter || !perCallConfig.tenantId) {
      return false;
    }
    const rateResult = perCallConfig.rateLimiter.check(perCallConfig.tenantId, toolCall.name);
    if (rateResult.allowed) {
      return false;
    }
    const retryAfterSec = Math.ceil((rateResult.retryAfterMs ?? 60_000) / 1000);
    const content = `Rate limit exceeded for tool "${toolCall.name}". Try again in ${retryAfterSec} seconds.`;
    this.emitToolResult(
      sessionId,
      toolCall.id,
      toolCall.name,
      0,
      false,
      content.slice(0, 200),
      true,
      undefined,
      content,
      metadata,
      undefined,
      this.recordToolUsage(toolCall.name),
      resolvedEffect,
      authResult,
    );
    resultParts.push({
      type: "tool_result",
      toolUseId: toolCall.id,
      content,
      isError: true,
    });
    toolExecutions.push({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.input,
      ...(metadata ? { metadata } : {}),
      resolvedEffect,
      authority: authResult,
      durationMs: 0,
      success: false,
      output: content,
      resultSummary: content.slice(0, 200),
    });
    return true;
  }

  private async tryCachedToolResult(
    sessionId: string,
    toolCall: ToolCall,
    cacheTtl: number | undefined,
    resultParts: RuntimeSessionToolResultPart[],
    toolExecutions: ToolExecutionSummary[],
    metadata: Record<string, unknown> | undefined,
    resolvedEffect: ResolvedInvocationEffect,
    authResult: AuthorityDescriptor | undefined,
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
      this.emitToolResult(
        sessionId,
        toolCall.id,
        toolCall.name,
        0,
        true,
        resultString.slice(0, 200),
        false,
        undefined,
        resultString,
        metadata,
        undefined,
        this.recordToolUsage(toolCall.name),
        resolvedEffect,
        authResult,
      );
      resultParts.push({
        type: "tool_result",
        toolUseId: toolCall.id,
        content: resultString,
        isError: false,
      });
      toolExecutions.push({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.input,
        ...(metadata ? { metadata } : {}),
        resolvedEffect,
        authority: authResult,
        durationMs: 0,
        success: true,
        output: resultString,
        resultSummary: resultString.slice(0, 200),
      });
      return { hit: true };
    } catch {
      return { hit: false };
    }
  }

  private async executeToolWithPolicy(
    toolCall: ToolCall,
    capability: Capability | undefined,
    perCallConfig: PerCallToolConfig | undefined,
    authority: AuthorityDescriptor | undefined,
  ): Promise<{
    readonly resultValueRaw: unknown;
    readonly resultValue: string;
    readonly retryAttempt?: number;
  }> {
    let resultValueRaw: unknown;
    let retryAttempt: number | undefined;

    if (capability?.retry) {
      const executor = (name: string, input: Record<string, unknown>) =>
        this.executeTool({ id: toolCall.id, name, input }, perCallConfig, authority);
      const fallbackExecutor = capability.retry.fallback
        ? (name: string, input: Record<string, unknown>) => this.executeTool(
            { id: toolCall.id, name, input },
            perCallConfig,
            perCallConfig?.toolAuthority?.get(name),
          )
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
      resultValueRaw = await this.executeTool(toolCall, perCallConfig, authority);
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
    toolInput: Record<string, unknown>,
    resultValue: unknown,
  ): readonly {
    readonly path: string;
    readonly changeType: "created" | "modified" | "deleted";
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    readonly diffPreview?: string;
    readonly diffTruncated?: boolean;
  }[] | undefined {
    const resultRecord = resultValue && typeof resultValue === "object"
      ? resultValue as { metadata?: Record<string, unknown> }
      : undefined;
    const metadata = resultRecord?.metadata && typeof resultRecord.metadata === "object"
      ? resultRecord.metadata
      : undefined;
    const sharedFileMetadata: FileToolResultMetadata | undefined = isFileToolResultMetadata(metadata)
      ? metadata
      : undefined;

    if (sharedFileMetadata?.operation === "patch") {
      const files = Array.isArray(sharedFileMetadata.files)
        ? sharedFileMetadata.files.filter(isFileToolChangeMetadata)
        : [];
      if (files.length === 0) {
        return undefined;
      }
      return files.map((file) => {
        const clipped = file.diffPreview ? clipDiffPreview(file.diffPreview) : undefined;
        const linesAdded = maybeNumber(file.linesAdded);
        const linesRemoved = maybeNumber(file.linesRemoved);
        return {
          path: file.filePath,
          changeType: normalizeFileChangeType(file.changeType),
          ...(linesAdded !== undefined ? { linesAdded } : {}),
          ...(linesRemoved !== undefined ? { linesRemoved } : {}),
          ...(clipped && clipped.preview.length > 0 ? { diffPreview: clipped.preview } : {}),
          ...(clipped ? { diffTruncated: clipped.truncated || (file.diffTruncated ?? false) } : {}),
        };
      });
    }

    const operation = sharedFileMetadata?.operation;

    if (operation !== "write" && operation !== "edit") {
      return undefined;
    }

    const filePath = maybeString(sharedFileMetadata?.filePath)
      ?? maybeString(metadata?.filePath)
      ?? maybeString(metadata?.path)
      ?? maybeString(toolInput.filePath)
      ?? maybeString(toolInput.path);
    if (!filePath || filePath.trim() === "") {
      return undefined;
    }

    const changeType = normalizeFileChangeType(metadata?.changeType);

    const metadataLinesAdded = maybeNumber(metadata?.linesAdded);
    const metadataLinesRemoved = maybeNumber(metadata?.linesRemoved);
    const metadataPreview = maybeString(metadata?.diffPreview);
    const metadataTruncated = typeof metadata?.diffTruncated === "boolean" ? metadata.diffTruncated : undefined;

    let linesAdded = metadataLinesAdded;
    let linesRemoved = metadataLinesRemoved;
    let diffPreview = metadataPreview;
    let diffTruncated = metadataTruncated;

    if (!diffPreview) {
      if (operation === "write") {
        const content = maybeString(toolInput.content) ?? maybeString(toolInput.text);
        if (content !== undefined) {
          linesAdded = linesAdded ?? countLines(content);
          const preview = clipDiffPreview(buildWritePreview(content));
          diffPreview = preview.preview;
          diffTruncated = preview.truncated;
        }
      } else if (operation === "edit") {
        const oldString = maybeString(toolInput.oldString) ?? maybeString(toolInput.old_string);
        const newString = maybeString(toolInput.newString) ?? maybeString(toolInput.new_string);
        if (oldString !== undefined && newString !== undefined) {
          const replacements = Math.max(1, Math.trunc(maybeNumber(metadata?.replacements) ?? 1));
          linesAdded = linesAdded ?? (countLines(newString) * replacements);
          linesRemoved = linesRemoved ?? (countLines(oldString) * replacements);
          const preview = clipDiffPreview(buildEditPreview(oldString, newString));
          diffPreview = preview.preview;
          diffTruncated = preview.truncated;
        } else {
          const content = maybeString(toolInput.content) ?? maybeString(toolInput.text);
          if (content !== undefined) {
            linesAdded = linesAdded ?? countLines(content);
            const preview = clipDiffPreview(buildWritePreview(content));
            diffPreview = preview.preview;
            diffTruncated = preview.truncated;
          }
        }
      }
    } else {
      const clipped = clipDiffPreview(diffPreview);
      diffPreview = clipped.preview;
      diffTruncated = clipped.truncated || (diffTruncated ?? false);
    }

    return [{
      path: filePath,
      changeType,
      ...(linesAdded !== undefined ? { linesAdded } : {}),
      ...(linesRemoved !== undefined ? { linesRemoved } : {}),
      ...(diffPreview !== undefined && diffPreview.length > 0 ? { diffPreview } : {}),
      ...(diffTruncated !== undefined ? { diffTruncated } : {}),
    }];
  }

  private async executeTool(
    toolCall: ToolCall,
    perCallConfig?: PerCallToolConfig,
    authority?: AuthorityDescriptor,
  ): Promise<unknown> {
    const session = this.currentSession;
    const turnId = session
      ? perCallConfig?.turnId ?? `${session.id}:turn:${Math.max(session.userTurnCount, 1)}`
      : undefined;
    let chunkIndex = 0;
    let streamedOutputChars = 0;
    let outputTruncated = false;
    const context = session
      ? {
          session,
          ...(turnId ? { turnId } : {}),
          toolCall,
          ...(perCallConfig?.abortSignal ? { abortSignal: perCallConfig.abortSignal } : {}),
          emitOutput: (output: { readonly stream: "stdout" | "stderr"; readonly delta: string }) => {
            if (outputTruncated || output.delta.length === 0) return;
            const remaining = MAX_STREAMED_TOOL_OUTPUT_CHARS - streamedOutputChars;
            const retained = output.delta.slice(0, Math.max(0, remaining));
            for (let offset = 0; offset < retained.length; offset += MAX_TOOL_OUTPUT_CHUNK_CHARS) {
              const delta = retained.slice(offset, offset + MAX_TOOL_OUTPUT_CHUNK_CHARS);
              this.emitToolOutput(session.id, toolCall.id, toolCall.name, output.stream, delta, chunkIndex++);
              streamedOutputChars += delta.length;
            }
            if (retained.length < output.delta.length || streamedOutputChars >= MAX_STREAMED_TOOL_OUTPUT_CHARS) {
              outputTruncated = true;
              this.emitToolOutput(
                session.id,
                toolCall.id,
                toolCall.name,
                output.stream,
                TOOL_OUTPUT_TRUNCATION_MARKER,
                chunkIndex++,
              );
            }
          },
          ...(perCallConfig?.workingDirectory
            ? { sandbox: { cwd: perCallConfig.workingDirectory } }
            : {}),
          ...(perCallConfig?.toolAllowlist ? { allowedToolNames: [...perCallConfig.toolAllowlist] } : {}),
          ...(authority ? { authority } : {}),
          requestApproval: (description: string) => this.requestApproval(session.id, description),
          ...(perCallConfig?.effectiveTurnAuthority
            ? { effectiveTurnAuthority: perCallConfig.effectiveTurnAuthority }
            : {}),
        }
      : undefined;
    const callBuiltin = this.callBuiltinTools?.get(toolCall.name);
    if (callBuiltin) {
      return callBuiltin(toolCall.input, context);
    }

    const depBuiltin = this.deps.builtinTools?.get(toolCall.name);
    if (depBuiltin) {
      return depBuiltin(toolCall.input, context);
    }

    if (this.deps.mcpClients) {
      const client = this.deps.mcpClients.find((candidate) =>
        toolCall.name.startsWith(`mcp:${candidate.serverName}:`));
      if (client) {
        return client.executeCapability(toolCall.name, toolCall.input);
      }
    }

    throw new Error(`Tool "${toolCall.name}" not found`);
  }

  private emitToolCalled(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    toolInput?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
    resolvedEffect?: ResolvedInvocationEffect,
    authority?: AuthorityDescriptor,
  ): void {
    const event: ToolCalledEvent = {
      type: "tool_called",
      toolCallId,
      toolName,
      timestamp: new Date(),
      sessionId,
      ...(toolInput ? { toolInput } : {}),
      ...(metadata ? { metadata } : {}),
      ...(resolvedEffect ? { resolvedEffect } : {}),
      ...(authority ? { authority, authorizationLevel: authority.level } : {}),
      ...(this.currentExecutionScope ? { executionScope: this.currentExecutionScope } : {}),
    };
    this.eventBus?.emit(event);
  }

  private emitToolAuthorized(
    sessionId: string,
    toolName: string,
    level: number,
    allowed: boolean,
    reason: string,
    resolvedEffect?: ResolvedInvocationEffect,
    authority?: AuthorityDescriptor,
  ): void {
    const event: ToolAuthorizedEvent = {
      type: "tool_authorized",
      toolName,
      level,
      allowed,
      reason,
      ...(resolvedEffect ? { resolvedEffect } : {}),
      ...(authority ? { authority } : {}),
      timestamp: new Date(),
      sessionId,
    };
    this.eventBus?.emit(event);
  }

  private emitToolResult(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    durationMs: number,
    success: boolean,
    resultSummary?: string,
    isError?: boolean,
    retryAttempt?: number,
    output?: string,
    metadata?: Record<string, unknown>,
    resourceLinks?: readonly ExecutionSessionToolResultResourceLink[],
    toolUsage?: SessionToolUsageSnapshot,
    resolvedEffect?: ResolvedInvocationEffect,
    authority?: AuthorityDescriptor,
  ): void {
    const event: ToolResultEvent = {
      type: "tool_result",
      toolCallId,
      toolName,
      durationMs,
      success,
      timestamp: new Date(),
      sessionId,
      ...(output ? { output } : {}),
      ...(resultSummary ? { resultSummary } : {}),
      ...(isError !== undefined ? { isError } : {}),
      ...(retryAttempt !== undefined ? { retryAttempt } : {}),
      ...(metadata ? { metadata } : {}),
      ...(resourceLinks ? { resourceLinks } : {}),
      ...(toolUsage ? { toolUsage } : {}),
      ...(resolvedEffect ? { resolvedEffect } : {}),
      ...(authority ? { authority } : {}),
      ...(this.currentExecutionScope ? { executionScope: this.currentExecutionScope } : {}),
    };
    this.eventBus?.emit(event);
  }

  private emitToolOutput(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    stream: "stdout" | "stderr",
    delta: string,
    chunkIndex: number,
  ): void {
    if (delta.length === 0) return;
    const event: ToolOutputEvent = {
      type: "tool_output",
      toolCallId,
      toolName,
      stream,
      delta,
      chunkIndex,
      timestamp: new Date(),
      sessionId,
      ...(this.currentExecutionScope ? { executionScope: this.currentExecutionScope } : {}),
    };
    this.eventBus?.emit(event);
  }

  private recordToolUsage(toolName: string): SessionToolUsageSnapshot {
    const calls = (this.turnToolCallCounts.get(toolName) ?? 0) + 1;
    this.turnToolCallCounts.set(toolName, calls);
    return {
      scope: "turn",
      toolName,
      calls,
    };
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
    authResult?: AuthorityDescriptor,
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
