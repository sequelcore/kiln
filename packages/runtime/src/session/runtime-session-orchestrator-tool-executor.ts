import type {
  AuthorityDescriptor,
  Capability,
  EventBus,
  ExecutionSessionToolResultResourceLink,
  FileToolChangeMetadata,
  FileToolResultMetadata,
  ResolvedInvocationEffect,
  SessionToolUsageSnapshot,
  ToolAuthorizedEvent,
  ToolCacheHitEvent,
  ToolCall,
  ToolCalledEvent,
  ToolExecutionResult,
  ToolOutputEvent,
  ToolResultEvent,
  ToolResultPayloadPart,
  TrustedExecutionLeaseUseEvaluation,
  WorkItemExecutionScopeTransition,
} from "@kilnai/core";
import {
  CONSERVATIVE_UNKNOWN_ENVELOPE,
  deriveAuthorityFromEffect,
  executeWithRetry,
  externalToolFailureMetadata,
  getInvalidToolInputDetails,
  isFileToolResultMetadata,
  normalizeToolCall,
  resolveInvocationEffect,
} from "@kilnai/core";
import type { RuntimeToolActionDispatchState } from "../execution-kernel/runtime-tool-action-claim.js";
import {
  RuntimeToolActionCommittedError,
  RuntimeToolActionDispatchService,
} from "../execution-kernel/runtime-tool-action-claim.js";
import {
  collectRuntimeFormalVerificationObservations,
  type RuntimeFormalVerificationObservation,
  type RuntimeFormalVerificationObservationExecution,
} from "../work-governance/formal-verification-observations.js";
import {
  readExecutionOperatorAdoptionDecision,
  readExecutionToolAllowlist,
  readExecutionToolAuthority,
  readExecutionTurnAuthority,
  readExecutionTurnId,
} from "./effective-authority-admission-bundle.js";
import { buildRuntimeInvocationEffectResolvers } from "./runtime-invocation-effect-resolvers.js";
import type { RuntimeSession } from "./runtime-session.js";
import type {
  CommandShell,
  DangerousCommandDecisionLike,
  DangerousCommandRequestLike,
  OrchestratorDeps,
  PerCallToolConfig,
  RuntimeBuiltinToolExecutor,
  ToolExecutionSummary,
} from "./runtime-session-orchestrator.types.js";

function mergePerCallSandbox(sandbox: unknown, workingDirectory: string | undefined): unknown {
  const base =
    sandbox && typeof sandbox === "object" && !Array.isArray(sandbox) ? (sandbox as Record<string, unknown>) : {};
  return workingDirectory === undefined ? { ...base } : { ...base, cwd: workingDirectory };
}

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
const EXTERNAL_TOOL_FAILURE_DIAGNOSTIC_MAX_CHARS = 500;
const EXTERNAL_TOOL_FAILURE_FALLBACK_DIAGNOSTIC =
  "External tool failed; result withheld because safety verification could not be completed.";

function parseCommandShell(value: unknown): CommandShell | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "bash" ||
    normalized === "sh" ||
    normalized === "zsh" ||
    normalized === "powershell" ||
    normalized === "cmd" ||
    normalized === "any"
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

function sameAuthorityDescriptor(left: AuthorityDescriptor, right: AuthorityDescriptor): boolean {
  return (
    left.level === right.level &&
    left.allowed === right.allowed &&
    left.requiresApproval === right.requiresApproval &&
    left.reason === right.reason
  );
}

function extractToolResultMetadata(resultValue: unknown): Record<string, unknown> | undefined {
  const resultRecord =
    resultValue && typeof resultValue === "object" && !Array.isArray(resultValue)
      ? (resultValue as { metadata?: unknown })
      : undefined;
  return resultRecord?.metadata && typeof resultRecord.metadata === "object" && !Array.isArray(resultRecord.metadata)
    ? (resultRecord.metadata as Record<string, unknown>)
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
  if (scope.kind === "work_item" && (typeof scope.workItemId !== "string" || scope.workItemId.trim().length === 0))
    return undefined;
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
    return [
      {
        uri: record.uri,
        ...(typeof record.title === "string" ? { title: record.title } : {}),
        ...(typeof record.label === "string" ? { label: record.label } : {}),
        ...(typeof record.sequence === "number" ? { sequence: record.sequence } : {}),
        ...(typeof record.mimeType === "string" ? { mimeType: record.mimeType } : {}),
        ...(typeof record.size === "number" ? { size: record.size } : {}),
        ...(typeof record.relation === "string" ? { relation: record.relation } : {}),
      },
    ];
  });
  return parsed.length > 0 ? parsed : undefined;
}

function extractToolResultIsError(resultValue: unknown): boolean | undefined {
  const resultRecord =
    resultValue && typeof resultValue === "object" && !Array.isArray(resultValue)
      ? (resultValue as { isError?: unknown })
      : undefined;
  return typeof resultRecord?.isError === "boolean" ? resultRecord.isError : undefined;
}

function extractToolResultOutput(resultValue: unknown): string | undefined {
  const resultRecord =
    resultValue && typeof resultValue === "object" && !Array.isArray(resultValue)
      ? (resultValue as { output?: unknown })
      : undefined;
  return typeof resultRecord?.output === "string" ? resultRecord.output : undefined;
}

function extractToolResultContentParts(resultValue: unknown): readonly ToolResultPayloadPart[] | undefined {
  const resultRecord =
    resultValue && typeof resultValue === "object" && !Array.isArray(resultValue)
      ? (resultValue as { content?: unknown })
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
    const durationMs =
      typeof candidate.durationMs === "number" && Number.isFinite(candidate.durationMs)
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
  return (
    typeof candidate.filePath === "string" &&
    (candidate.changeType === "created" || candidate.changeType === "modified" || candidate.changeType === "deleted")
  );
}

function buildWritePreview(content: string): string {
  if (content.length === 0) {
    return "+ (empty file)";
  }
  return content
    .split(/\r?\n/)
    .map((line) => `+ ${line}`)
    .join("\n");
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

function stableRuntimeJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableRuntimeJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableRuntimeJson(record[key])}`)
    .join(",")}}`;
}

function toFormalVerificationExecution(
  summary: ToolExecutionSummary,
  toolCallScopeId: string,
): RuntimeFormalVerificationObservationExecution {
  return {
    toolCallScopeId,
    ...(summary.toolCallId !== undefined ? { toolCallId: summary.toolCallId } : {}),
    toolName: summary.toolName,
    success: summary.success,
    ...(summary.metadata !== undefined ? { metadata: summary.metadata } : {}),
    ...(summary.executionScope !== undefined ? { executionScope: summary.executionScope } : {}),
  };
}

function collectOwnedFormalVerificationObservations(
  toolExecutions: readonly ToolExecutionSummary[],
  toolCallScopeId: string,
): readonly RuntimeFormalVerificationObservation[] {
  const observations: RuntimeFormalVerificationObservation[] = [];
  for (const summary of toolExecutions) {
    if (!summary.executionScope) continue;
    observations.push(
      ...collectRuntimeFormalVerificationObservations({
        currentScope: summary.executionScope,
        currentTurnToolExecutions: [toFormalVerificationExecution(summary, toolCallScopeId)],
      }),
    );
  }
  return Object.freeze(observations);
}

export class RuntimeSessionToolExecutor {
  private readonly toolActionDispatch = new RuntimeToolActionDispatchService();
  private currentSession: RuntimeSession | undefined;
  private currentExecutionScope: PerCallToolConfig["executionScope"];
  private activeExecutionScope: PerCallToolConfig["executionScope"];
  private currentToolCallScopeId: string | undefined;
  private readonly turnToolCallCounts = new Map<string, number>();
  /**
   * Runtime-owned normalized observations for this executor's current turn.
   * The orchestrator creates one executor per processMessage; direct reuse
   * with a different turn identity resets this history and the active scope.
   * No returned ToolExecutionSummary reference is retained.
   */
  private currentTurnFormalVerificationObservations: readonly RuntimeFormalVerificationObservation[] = Object.freeze(
    [],
  );
  private currentTurnSessionId: string | undefined;
  private currentTurnIdentity: string | undefined;

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
    toolCallScopeId: string,
    perCallConfig?: PerCallToolConfig,
  ): Promise<RuntimeSessionToolExecutionResult> {
    const turnIdentity = readExecutionTurnId(perCallConfig);
    if (this.currentTurnSessionId !== session.id || this.currentTurnIdentity !== turnIdentity) {
      this.currentTurnSessionId = session.id;
      this.currentTurnIdentity = turnIdentity;
      this.currentTurnFormalVerificationObservations = Object.freeze([]);
      this.activeExecutionScope = undefined;
    }
    this.currentSession = session;
    this.currentToolCallScopeId = toolCallScopeId;
    if (perCallConfig?.executionScope) {
      this.activeExecutionScope = perCallConfig.executionScope;
    }
    this.currentExecutionScope = perCallConfig?.executionScope ?? this.activeExecutionScope;
    this.turnToolCallCounts.clear();
    try {
      const resultParts: RuntimeSessionToolResultPart[] = [];
      const toolExecutions: ToolExecutionSummary[] = [];
      let formalVerificationObservations = collectRuntimeFormalVerificationObservations({
        currentScope: this.currentExecutionScope,
        sessionEvents: session.sessionEvents,
        currentTurnObservations: this.currentTurnFormalVerificationObservations,
      });

      for (const toolCall of toolCalls) {
        // Reconstruct immediately before every builtin so same-batch ordering
        // also covers cached, blocked, or otherwise non-standard tool paths.
        formalVerificationObservations = collectRuntimeFormalVerificationObservations({
          currentScope: this.currentExecutionScope,
          sessionEvents: session.sessionEvents,
          currentTurnToolExecutions: toolExecutions.map((summary) =>
            toFormalVerificationExecution(summary, toolCallScopeId),
          ),
          currentTurnObservations: this.currentTurnFormalVerificationObservations,
        });
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

        const admittedToolAllowlist = readExecutionToolAllowlist(perCallConfig);
        if (!admittedToolAllowlist.has(normalizedToolCall.name)) {
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

        const metadata = this.resolveToolCallMetadata(
          session.id,
          normalizedToolCall.name,
          normalizedToolCall.input,
          perCallConfig,
        );
        const capability = this.resolveCapability(normalizedToolCall.name, perCallConfig);
        const effectResolution = this.resolveInvocationEffectWithTrust(
          normalizedToolCall.name,
          normalizedToolCall.input,
          perCallConfig,
        );
        const resolvedEffect = effectResolution.effect;
        const consequential =
          isMcpToolName(normalizedToolCall.name) || !effectResolution.trusted || resolvedEffect.operation !== "observe";
        const authResult = this.resolveAuthorization(normalizedToolCall.name, resolvedEffect, perCallConfig);
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

        const attendedTrustedExecutionEvaluation = this.evaluateAttendedTrustedExecutionUse(
          perCallConfig,
          normalizedToolCall,
          resolvedEffect,
        );
        if (attendedTrustedExecutionEvaluation && !attendedTrustedExecutionEvaluation.matches) {
          const trustedExecutionAuthority: AuthorityDescriptor = {
            level: 4,
            allowed: false,
            requiresApproval: false,
            reason: `Attended trusted execution denied: ${attendedTrustedExecutionEvaluation.reason}`,
          };
          this.emitToolAuthorized(
            session.id,
            normalizedToolCall.name,
            trustedExecutionAuthority.level,
            trustedExecutionAuthority.allowed,
            trustedExecutionAuthority.reason,
            resolvedEffect,
            trustedExecutionAuthority,
          );
          const content = `Authorization denied: ${trustedExecutionAuthority.reason}`;
          emitStarted(metadata, resolvedEffect, trustedExecutionAuthority);
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
            trustedExecutionAuthority,
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
            authority: trustedExecutionAuthority,
            durationMs: 0,
            success: false,
            output: content,
            resultSummary: content.slice(0, 200),
          });
          this.appendAudit(normalizedToolCall.name, 0, "error", trustedExecutionAuthority);
          continue;
        }

        emitStarted(metadata, resolvedEffect, executionAuthority);

        if (
          await this.handleDangerousCommandBlock(
            session.id,
            normalizedToolCall,
            executionAuthority,
            resolvedEffect,
            resultParts,
            toolExecutions,
            metadata,
          )
        ) {
          continue;
        }

        if (
          this.handleRateLimitBlock(
            session.id,
            normalizedToolCall,
            perCallConfig,
            resultParts,
            toolExecutions,
            metadata,
            resolvedEffect,
            authResult,
          )
        ) {
          continue;
        }

        const cacheTtl = capability?.cacheTtl;
        if (!consequential) {
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
        }

        const startMs = Date.now();
        const toolActionState: RuntimeToolActionDispatchState = { claimed: false };

        try {
          const execution = await this.executeToolWithPolicy(
            normalizedToolCall,
            capability,
            perCallConfig,
            executionAuthority,
            formalVerificationObservations,
            resolvedEffect,
            consequential,
            toolCallScopeId,
            toolActionState,
          );
          const durationMs = Date.now() - startMs;
          const envelopeIsError = extractToolResultIsError(execution.resultValueRaw);
          const isError = envelopeIsError === true;
          const success = !isError;
          const isExternalFailure = isMcpToolName(normalizedToolCall.name) && isError;

          let sanitized: { readonly resultValue: string; readonly resultSummary: string; readonly sanitized: boolean };
          let metadata: Record<string, unknown> | undefined;
          let resourceLinks: readonly ExecutionSessionToolResultResourceLink[] | undefined;
          let resultOutput: string | undefined;
          let contentParts: readonly ToolResultPayloadPart[] | undefined;

          if (isExternalFailure) {
            // Canonical external-tool-failure path: every field the model,
            // events, and audit trail see is derived from the redacted
            // diagnostic, never from the raw external envelope.
            const rawContent = extractToolResultOutput(execution.resultValueRaw) ?? execution.resultValue;
            const evidence = await this.buildExternalToolFailureEvidence(rawContent);
            sanitized = {
              resultValue: evidence.diagnostic,
              resultSummary: evidence.diagnostic.slice(0, 200),
              sanitized: true,
            };
            metadata = {
              ...externalToolFailureMetadata({
                selector: normalizedToolCall.name,
                category: "failed",
                diagnostic: evidence.diagnostic,
                redacted: evidence.redacted,
                blocked: evidence.blocked,
              }),
            };
            resourceLinks = undefined;
            resultOutput = undefined;
            contentParts = undefined;
          } else {
            sanitized = await this.sanitizeToolResult(execution.resultValue);
            metadata = extractToolResultMetadata(execution.resultValueRaw);
            resourceLinks = extractToolResultResourceLinks(metadata);
            resultOutput = extractToolResultOutput(execution.resultValueRaw);
            contentParts = sanitized.sanitized ? undefined : extractToolResultContentParts(execution.resultValueRaw);
          }

          const resultSummary = (resultOutput ?? sanitized.resultValue).slice(0, 200);
          const executionScopeTransition = success ? extractExecutionScopeTransition(metadata) : undefined;
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

          const fileChanges = this.extractFileChangesFromToolResult(normalizedToolCall.input, execution.resultValueRaw);
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
            isError ? "error" : sanitized.sanitized ? "success_sanitized" : "success",
            authResult,
          );
          resultParts.push({
            type: "tool_result",
            toolUseId: normalizedToolCall.id,
            content: resultOutput ?? sanitized.resultValue,
            ...(contentParts ? { contentParts } : {}),
            isError,
          });

          if (!consequential && cacheTtl && this.deps.toolCache) {
            try {
              this.deps.toolCache.set(
                normalizedToolCall.name,
                normalizedToolCall.input,
                execution.resultValueRaw,
                cacheTtl,
              );
            } catch {
              // Fail-open: do not break execution if cache store fails.
            }
          }

          if (perCallConfig?.rateLimiter && perCallConfig.tenantId) {
            perCallConfig.rateLimiter.record(perCallConfig.tenantId, normalizedToolCall.name);
          }
        } catch (err) {
          if (err instanceof RuntimeToolActionCommittedError) {
            // A claimed effect is never converted into a model-visible error
            // result: doing so would permit the model/orchestrator to retry it.
            throw err;
          }
          if (consequential && toolActionState.claimed && toolActionState.claimId) {
            // Adapter success is already durable. A later projection, event,
            // sanitizer, cache, or rate-limit failure cannot become a retryable
            // model-visible tool error.
            throw new RuntimeToolActionCommittedError(err, toolActionState.claimId);
          }
          const durationMs = Date.now() - startMs;
          const errMsg = err instanceof Error ? err.message : String(err);
          const isExternalFailure = isMcpToolName(normalizedToolCall.name);
          // An mcp: tool throwing must never surface err.message directly: it
          // can echo raw, attacker-controlled, or secret-bearing content from
          // the external server. Route it through the same fail-closed
          // redaction as the isError:true envelope path instead.
          const evidence = isExternalFailure ? await this.buildExternalToolFailureEvidence(errMsg) : undefined;
          const outputContent = evidence ? evidence.diagnostic : errMsg;
          const metadata = evidence
            ? {
                ...externalToolFailureMetadata({
                  selector: normalizedToolCall.name,
                  category: "failed",
                  diagnostic: evidence.diagnostic,
                  redacted: evidence.redacted,
                  blocked: evidence.blocked,
                }),
              }
            : undefined;
          this.emitToolResult(
            session.id,
            normalizedToolCall.id,
            normalizedToolCall.name,
            durationMs,
            false,
            outputContent.slice(0, 200),
            true,
            undefined,
            outputContent,
            metadata,
            undefined,
            this.recordToolUsage(normalizedToolCall.name),
            resolvedEffect,
            authResult,
          );
          toolExecutions.push({
            toolCallId: normalizedToolCall.id,
            toolName: normalizedToolCall.name,
            input: normalizedToolCall.input,
            ...(metadata ? { metadata } : {}),
            resolvedEffect,
            authority: authResult,
            durationMs,
            success: false,
            output: outputContent,
            resultSummary: outputContent.slice(0, 200),
          });
          this.emitError(
            session.id,
            `Tool "${normalizedToolCall.name}" failed: ${isExternalFailure ? outputContent : err}`,
          );
          this.appendAudit(normalizedToolCall.name, durationMs, "error", authResult);
          resultParts.push({
            type: "tool_result",
            toolUseId: normalizedToolCall.id,
            content: isExternalFailure ? outputContent : `Error: ${errMsg}`,
            isError: true,
          });
        }
      }

      const newObservations = collectOwnedFormalVerificationObservations(toolExecutions, toolCallScopeId);
      if (newObservations.length > 0) {
        this.currentTurnFormalVerificationObservations = Object.freeze([
          ...this.currentTurnFormalVerificationObservations,
          ...newObservations,
        ]);
      }
      return { resultParts, toolExecutions };
    } finally {
      this.currentSession = undefined;
      this.currentExecutionScope = undefined;
      this.currentToolCallScopeId = undefined;
    }
  }

  private formatInvalidToolInputMessage(
    toolName: string,
    invalidInput: {
      readonly reason: string;
      readonly raw: unknown;
    },
  ): string {
    const rawValue = typeof invalidInput.raw === "string" ? invalidInput.raw : JSON.stringify(invalidInput.raw);
    const compactRaw = rawValue.length > 160 ? `${rawValue.slice(0, 157)}...` : rawValue;
    return `Invalid input for tool "${toolName}": ${invalidInput.reason} Raw: ${compactRaw}`;
  }

  private resolveCapability(name: string, perCallConfig?: PerCallToolConfig): Capability | undefined {
    return this.deps.capabilityMap?.get(name) ?? perCallConfig?.perCallCapabilities?.get(name);
  }

  private resolveAdmittedToolPermission(toolName: string, perCallConfig?: PerCallToolConfig) {
    return perCallConfig?.authorityAdmission?.turn.tools.allowedToolPermissions.find(
      (entry) => entry.toolName === toolName,
    );
  }

  private resolveStaticAuthority(toolName: string, perCallConfig?: PerCallToolConfig): unknown {
    return readExecutionToolAuthority(perCallConfig, toolName);
  }

  /** Whether the persisted bundle admits this exact tool. */
  private hasConfiguredAuthoritySource(toolName: string, perCallConfig?: PerCallToolConfig): boolean {
    return this.resolveStaticAuthority(toolName, perCallConfig) !== undefined;
  }

  private resolveAuthorization(
    toolName: string,
    resolvedEffect: ResolvedInvocationEffect,
    perCallConfig?: PerCallToolConfig,
  ): AuthorityDescriptor | undefined {
    const admittedPermission = this.resolveAdmittedToolPermission(toolName, perCallConfig);
    if (!admittedPermission) {
      return {
        level: 4,
        allowed: false,
        requiresApproval: false,
        reason: "Tool is absent from the persisted authority admission bundle",
      };
    }
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
      const declaredEffect = admittedPermission.effectEnvelope;
      const narrowedAuthority = authorityFromResolvedInvocationEffect(authority, resolvedEffect, declaredEffect);
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
    return undefined;
  }

  private resolveInvocationEffectWithTrust(
    toolName: string,
    input: Record<string, unknown>,
    perCallConfig?: PerCallToolConfig,
  ): { readonly effect: ResolvedInvocationEffect; readonly trusted: boolean } {
    const admittedPermission = this.resolveAdmittedToolPermission(toolName, perCallConfig);
    if (!admittedPermission) {
      return { effect: CONSERVATIVE_UNKNOWN_ENVELOPE, trusted: false };
    }
    const declaredEnvelope = admittedPermission.effectEnvelope;
    try {
      return {
        effect: resolveInvocationEffect(toolName, input, declaredEnvelope, RUNTIME_INVOCATION_EFFECT_RESOLVERS),
        trusted: true,
      };
    } catch {
      return { effect: CONSERVATIVE_UNKNOWN_ENVELOPE, trusted: false };
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

    const validLevel = candidate.level === 1 || candidate.level === 2 || candidate.level === 3 || candidate.level === 4;

    return (
      validLevel &&
      typeof candidate.allowed === "boolean" &&
      typeof candidate.requiresApproval === "boolean" &&
      typeof candidate.reason === "string" &&
      candidate.reason.length > 0
    );
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
      const isExternalCacheEntry = isMcpToolName(toolCall.name);
      if (this.deps.toolResultSanitizer) {
        try {
          const sanitizationResult = isExternalCacheEntry
            ? await this.deps.toolResultSanitizer.sanitizeForPersistedEvidence(resultString)
            : await this.deps.toolResultSanitizer.sanitize(resultString);
          if (sanitizationResult.sanitized) {
            resultString = sanitizationResult.content;
          }
        } catch (err) {
          const sanitizerError = err instanceof Error ? err.message : String(err);
          this.emitError(
            sessionId,
            `Tool result sanitizer failed for cached tool "${toolCall.name}": ${sanitizerError}`,
          );
          // Non-mcp cached results keep their existing fail-open behavior
          // (unchanged regression contract); a cached mcp: result must never
          // surface raw content, so it falls back to a fixed diagnostic.
          if (isExternalCacheEntry) {
            resultString = EXTERNAL_TOOL_FAILURE_FALLBACK_DIAGNOSTIC;
          }
        }
      } else if (isExternalCacheEntry) {
        resultString = EXTERNAL_TOOL_FAILURE_FALLBACK_DIAGNOSTIC;
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
    formalVerificationObservations: readonly RuntimeFormalVerificationObservation[],
    resolvedEffect: ResolvedInvocationEffect,
    consequential: boolean,
    toolCallScopeId: string,
    toolActionState: RuntimeToolActionDispatchState,
  ): Promise<{
    readonly resultValueRaw: unknown;
    readonly resultValue: string;
    readonly retryAttempt?: number;
  }> {
    let resultValueRaw: unknown;
    let retryAttempt: number | undefined;

    if (consequential) {
      const claims = perCallConfig?.runtimeToolActionClaims;
      if (!claims) {
        throw new Error("Consequential tool execution requires a workload-owned Runtime tool-action claim context.");
      }
      const prepared = this.prepareToolInvocation(
        toolCall,
        perCallConfig,
        authority,
        formalVerificationObservations,
        true,
      );
      const session = this.currentSession;
      if (!session) throw new Error("Consequential tool execution requires an active Runtime session.");
      const turnId = readExecutionTurnId(perCallConfig);
      const adapterIdentity = prepared.adapterIdentity;
      try {
        resultValueRaw = await this.toolActionDispatch.dispatch({
          admission: claims.admission,
          sessionId: session.id,
          turnId,
          attemptId: claims.attemptId,
          toolCallScopeId,
          toolCallId: toolCall.id,
          selector: toolCall.name,
          normalizedInput: stableRuntimeJson(toolCall.input),
          resolvedEffect,
          adapterIdentity,
          ...(claims.admissionReadbackSessionId
            ? { admissionReadbackSessionId: claims.admissionReadbackSessionId }
            : {}),
          ...(claims.admissionReadbackTurnId ? { admissionReadbackTurnId: claims.admissionReadbackTurnId } : {}),
          readAdmission: claims.readAdmission,
          store: claims.store,
          beforeClaim: () => this.assertAttendedTrustedExecutionUse(perCallConfig, toolCall, resolvedEffect),
          invoke: prepared.invoke,
          abortSignal: perCallConfig?.abortSignal,
          state: toolActionState,
        });
      } finally {
        if (claims.state && toolActionState.claimed) {
          claims.state.claimed = true;
          claims.state.claimId = toolActionState.claimId;
          claims.state.outcome = toolActionState.outcome;
        }
      }
      return {
        resultValueRaw,
        resultValue: typeof resultValueRaw === "string" ? resultValueRaw : JSON.stringify(resultValueRaw),
      };
    }

    if (capability?.retry) {
      const executor = (name: string, input: Record<string, unknown>) => {
        const attempt = { id: toolCall.id, name, input };
        this.assertAttendedTrustedExecutionUse(perCallConfig, attempt, resolvedEffect);
        return this.executeTool(attempt, perCallConfig, authority, formalVerificationObservations);
      };
      const fallbackExecutor = capability.retry.fallback
        ? (name: string, input: Record<string, unknown>) => {
            const attempt = { id: toolCall.id, name, input };
            this.assertAttendedTrustedExecutionUse(perCallConfig, attempt, resolvedEffect);
            return this.executeTool(
              attempt,
              perCallConfig,
              readExecutionToolAuthority(perCallConfig, name),
              formalVerificationObservations,
            );
          }
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
      this.assertAttendedTrustedExecutionUse(perCallConfig, toolCall, resolvedEffect);
      resultValueRaw = await this.executeTool(toolCall, perCallConfig, authority, formalVerificationObservations);
    }

    return {
      resultValueRaw,
      resultValue: typeof resultValueRaw === "string" ? resultValueRaw : JSON.stringify(resultValueRaw),
      retryAttempt,
    };
  }

  private evaluateAttendedTrustedExecutionUse(
    perCallConfig: PerCallToolConfig | undefined,
    toolCall: ToolCall,
    resolvedEffect: ResolvedInvocationEffect,
  ): TrustedExecutionLeaseUseEvaluation | undefined {
    const attendedTrustedExecution = perCallConfig?.attendedTrustedExecution;
    if (!attendedTrustedExecution) return undefined;
    const binding = attendedTrustedExecution.authority.binding;
    const admittedCompositionRevision = perCallConfig?.authorityAdmission?.configuration.turnRevision.revisionSetId;
    if (
      binding.projectRuntimeId !== attendedTrustedExecution.projectRuntimeId ||
      binding.compositionRevision !== attendedTrustedExecution.compositionRevision ||
      admittedCompositionRevision !== attendedTrustedExecution.compositionRevision
    ) {
      return {
        matches: false,
        status: attendedTrustedExecution.authority.currentLease?.status.kind ?? "absent",
        reason: "policy-revision-mismatch",
      };
    }
    return attendedTrustedExecution.authority.evaluateUse({
      now: new Date().toISOString(),
      harness: attendedTrustedExecution.harness,
      routeId: attendedTrustedExecution.routeId,
      policyDigest: attendedTrustedExecution.policyDigest,
      enforcementRevision: attendedTrustedExecution.enforcementRevision,
      requestedProfile: attendedTrustedExecution.requestedProfile,
      toolName: toolCall.name,
      effect: resolvedEffect,
    });
  }

  private assertAttendedTrustedExecutionUse(
    perCallConfig: PerCallToolConfig | undefined,
    toolCall: ToolCall,
    resolvedEffect: ResolvedInvocationEffect,
  ): void {
    const evaluation = this.evaluateAttendedTrustedExecutionUse(perCallConfig, toolCall, resolvedEffect);
    if (evaluation && !evaluation.matches) {
      throw new Error(`Attended trusted execution denied immediately before tool invocation: ${evaluation.reason}.`);
    }
  }

  /**
   * Canonical redaction path for evidence persisted from a failed external
   * (`mcp:`) tool: unlike `sanitizeToolResult()`, this never returns raw
   * content. With no sanitizer configured, or if the sanitizer path itself
   * throws unexpectedly, a fixed safe diagnostic is used instead of the raw
   * external payload.
   */
  private async buildExternalToolFailureEvidence(rawContent: string): Promise<{
    readonly diagnostic: string;
    readonly redacted: boolean;
    readonly blocked: boolean;
  }> {
    if (!this.deps.toolResultSanitizer) {
      return {
        diagnostic: EXTERNAL_TOOL_FAILURE_FALLBACK_DIAGNOSTIC,
        redacted: true,
        blocked: true,
      };
    }
    try {
      const sanitized = await this.deps.toolResultSanitizer.sanitizeForPersistedEvidence(rawContent);
      return {
        diagnostic: sanitized.content.slice(0, EXTERNAL_TOOL_FAILURE_DIAGNOSTIC_MAX_CHARS),
        redacted: sanitized.sanitized,
        blocked: sanitized.blocked,
      };
    } catch {
      return {
        diagnostic: EXTERNAL_TOOL_FAILURE_FALLBACK_DIAGNOSTIC,
        redacted: true,
        blocked: true,
      };
    }
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
  ):
    | readonly {
        readonly path: string;
        readonly changeType: "created" | "modified" | "deleted";
        readonly linesAdded?: number;
        readonly linesRemoved?: number;
        readonly diffPreview?: string;
        readonly diffTruncated?: boolean;
      }[]
    | undefined {
    const resultRecord =
      resultValue && typeof resultValue === "object"
        ? (resultValue as { metadata?: Record<string, unknown> })
        : undefined;
    const metadata =
      resultRecord?.metadata && typeof resultRecord.metadata === "object" ? resultRecord.metadata : undefined;
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

    const filePath =
      maybeString(sharedFileMetadata?.filePath) ??
      maybeString(metadata?.filePath) ??
      maybeString(metadata?.path) ??
      maybeString(toolInput.filePath) ??
      maybeString(toolInput.path);
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
          linesAdded = linesAdded ?? countLines(newString) * replacements;
          linesRemoved = linesRemoved ?? countLines(oldString) * replacements;
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

    return [
      {
        path: filePath,
        changeType,
        ...(linesAdded !== undefined ? { linesAdded } : {}),
        ...(linesRemoved !== undefined ? { linesRemoved } : {}),
        ...(diffPreview !== undefined && diffPreview.length > 0 ? { diffPreview } : {}),
        ...(diffTruncated !== undefined ? { diffTruncated } : {}),
      },
    ];
  }

  private async executeTool(
    toolCall: ToolCall,
    perCallConfig?: PerCallToolConfig,
    authority?: AuthorityDescriptor,
    formalVerificationObservations: readonly RuntimeFormalVerificationObservation[] = [],
  ): Promise<unknown> {
    return this.prepareToolInvocation(toolCall, perCallConfig, authority, formalVerificationObservations).invoke();
  }

  private prepareToolInvocation(
    toolCall: ToolCall,
    perCallConfig?: PerCallToolConfig,
    authority?: AuthorityDescriptor,
    formalVerificationObservations: readonly RuntimeFormalVerificationObservation[] = [],
    consequential = false,
  ): { readonly invoke: () => Promise<unknown>; readonly adapterIdentity: string } {
    const session = this.currentSession;
    const turnId = session ? readExecutionTurnId(perCallConfig) : undefined;
    let chunkIndex = 0;
    let streamedOutputChars = 0;
    let outputTruncated = false;
    const context = session
      ? {
          session,
          ...(turnId ? { turnId } : {}),
          toolCall,
          ...(this.currentExecutionScope ? { executionScope: this.currentExecutionScope } : {}),
          ...(formalVerificationObservations.length > 0 ? { formalVerificationObservations } : {}),
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
          ...(perCallConfig?.workingDirectory || perCallConfig?.sandbox !== undefined
            ? { sandbox: mergePerCallSandbox(perCallConfig.sandbox, perCallConfig.workingDirectory) }
            : {}),
          ...(readExecutionToolAllowlist(perCallConfig)
            ? { allowedToolNames: [...readExecutionToolAllowlist(perCallConfig)!] }
            : {}),
          ...(authority ? { authority } : {}),
          ...(perCallConfig?.attendedTrustedExecution !== undefined
            ? { attendedTrustedExecution: perCallConfig.attendedTrustedExecution }
            : {}),
          ...(perCallConfig?.attendedTrustedExecutionSessionAuthority !== undefined
            ? { attendedTrustedExecutionSessionAuthority: perCallConfig.attendedTrustedExecutionSessionAuthority }
            : {}),
          requestApproval: consequential
            ? async () => {
                throw new Error(
                  "A consequential builtin requested approval after its action claim; execution is unknown.",
                );
              }
            : (description: string) => this.requestApproval(session.id, description),
          ...(readExecutionTurnAuthority(perCallConfig)
            ? { effectiveTurnAuthority: readExecutionTurnAuthority(perCallConfig) }
            : {}),
          ...(readExecutionOperatorAdoptionDecision(perCallConfig)
            ? { operatorAdoptionDecision: readExecutionOperatorAdoptionDecision(perCallConfig) }
            : {}),
        }
      : undefined;
    const callBuiltin = this.callBuiltinTools?.get(toolCall.name);
    if (callBuiltin) {
      return {
        adapterIdentity: `${perCallConfig?.runtimeToolActionClaims?.adapterIdentity ?? "runtime"}:call-builtin:${toolCall.name}`,
        invoke: () => callBuiltin(toolCall.input, context),
      };
    }

    const depBuiltin = this.deps.builtinTools?.get(toolCall.name);
    if (depBuiltin) {
      return {
        adapterIdentity: `${perCallConfig?.runtimeToolActionClaims?.adapterIdentity ?? "runtime"}:builtin:${toolCall.name}`,
        invoke: () => depBuiltin(toolCall.input, context),
      };
    }

    if (this.deps.mcpClients) {
      const client = this.deps.mcpClients.find((candidate) => toolCall.name.startsWith(`mcp:${candidate.serverName}:`));
      if (client) {
        return {
          adapterIdentity: `${perCallConfig?.runtimeToolActionClaims?.adapterIdentity ?? "runtime"}:mcp:${client.serverName}:${toolCall.name}`,
          invoke: () => client.executeCapability(toolCall.name, toolCall.input),
        };
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
    const toolCallScopeId = this.requireCurrentToolCallScopeId();
    const event: ToolCalledEvent = {
      type: "tool_called",
      toolCallId,
      toolCallScopeId,
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
    const toolCallScopeId = this.requireCurrentToolCallScopeId();
    const event: ToolResultEvent = {
      type: "tool_result",
      toolCallId,
      toolCallScopeId,
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
    const toolCallScopeId = this.requireCurrentToolCallScopeId();
    const event: ToolOutputEvent = {
      type: "tool_output",
      toolCallId,
      toolCallScopeId,
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

  private requireCurrentToolCallScopeId(): string {
    if (!this.currentToolCallScopeId) {
      throw new Error("Tool-call scope identity is required while executing tool calls");
    }
    return this.currentToolCallScopeId;
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
