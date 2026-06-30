import type {
  AuthorityDescriptor,
  Capability,
  ErrorEvent,
  ManagedAgentAdapterWriteAuthorityDescriptor,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentReplayResource,
  ManagedAgentWriteEvidence,
  ProviderAdapter,
  SandboxConfig,
  ToolDefinition,
  ToolAuthorizedEvent,
  ToolCacheHitEvent,
  ToolCalledEvent,
  ToolResultEvent,
} from "@kilnai/core";
import {
  AllCredentialsExhaustedError,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentAdapterWriteAuthorityDescriptor,
  defineManagedAgentInvocationRecord,
  EventBus,
  extractText,
  SandboxPolicy,
  textParts,
} from "@kilnai/core";
import { RuntimeSession } from "../../session/runtime-session.js";
import { RuntimeSessionOrchestrator } from "../../session/runtime-session-orchestrator.js";
import type {
  OrchestratorDeps,
  PerCallToolConfig,
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
  OrchestrateResult,
  RuntimeExecutionEnvelope,
  ToolExecutionSummary,
} from "../../session/runtime-session-orchestrator.types.js";
import {
  RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON,
  RUNTIME_SESSION_NO_TOOL_FINALIZATION_FAILED_STOP_REASON,
  RUNTIME_SESSION_TOOL_ROUND_BUDGET_EXHAUSTED_STOP_REASON,
} from "../../session/runtime-session-orchestrator.types.js";
import type {
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeInvocationInput,
  ManagedAgentRuntimeInvocationProgressEvent,
} from "./index.js";
import {
  collectManagedAgentLiveWriteEvidence,
  normalizeManagedAgentLiveWriteChanges,
} from "./live-write-event-bridge.js";
import {
  buildManagedInvocationResourceContext,
  createManagedInvocationRuntimeResourceReader,
} from "./resource-context.js";

export interface ManagedDirectProviderRuntimeAdapterConfig {
  readonly providerId: string;
  readonly model?: string;
  readonly provider: ProviderAdapter;
  readonly tools: readonly ToolDefinition[];
  readonly builtinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly builtinToolsProvider?: () => ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly capabilityMap?: ReadonlyMap<string, Capability>;
  readonly toolAuthority?: ReadonlyMap<string, AuthorityDescriptor>;
  readonly writeAuthority?: ManagedAgentAdapterWriteAuthorityDescriptor;
  readonly executionEnvelope?: RuntimeExecutionEnvelope;
}

const TIMEOUT = { type: "managed-direct-runtime-timeout" } as const;
const MANAGED_DIRECT_PROVIDER_EXECUTION_ENVELOPE: RuntimeExecutionEnvelope = { toolRounds: { max: 32 } };
const RESULT_SUMMARY_LIMIT = 2000;
const CHILD_EXECUTION_RESOURCE_LIMIT = 12000;
const TOOL_OUTPUT_LIMIT = 1200;
const RESULT_RESOURCE_NOTICE = "Full child result is available through the managed invocation result resource.";
const NO_DIRECT_HANDOFF_SUMMARY = "Direct provider managed invocation finished without final handoff text.";

export class ManagedDirectProviderRuntimeAdapter implements ManagedAgentRuntimeAdapter {
  readonly descriptor;
  private readonly providerId: string;
  private readonly model?: string;
  private readonly provider: ProviderAdapter;
  private readonly tools: readonly ToolDefinition[];
  private readonly builtinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  private readonly builtinToolsProvider: () => ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  private readonly capabilityMap?: ReadonlyMap<string, Capability>;
  private readonly toolAuthority?: ReadonlyMap<string, AuthorityDescriptor>;
  private readonly executionEnvelope: RuntimeExecutionEnvelope;

  constructor(config: ManagedDirectProviderRuntimeAdapterConfig) {
    this.providerId = requireText(config.providerId, "Managed direct provider id is required");
    this.model = config.model;
    this.provider = config.provider;
    this.tools = config.tools;
    this.builtinTools = config.builtinTools;
    this.builtinToolsProvider = config.builtinToolsProvider ?? (() => this.builtinTools);
    this.capabilityMap = config.capabilityMap;
    this.toolAuthority = config.toolAuthority;
    this.executionEnvelope = config.executionEnvelope ?? MANAGED_DIRECT_PROVIDER_EXECUTION_ENVELOPE;
    const writeAuthority = config.writeAuthority !== undefined
      ? defineManagedAgentAdapterWriteAuthorityDescriptor(config.writeAuthority)
      : undefined;
    this.descriptor = defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: `adapter:${this.providerId}:direct-provider`,
      providerId: this.providerId,
      adapterKind: "direct",
      supportedProfiles: writeAuthority !== undefined
        ? ["foundation-readonly-plan", "foundation-propose-writes", "foundation-apply-approved-writes", "foundation-memory-write-proposals"]
        : ["foundation-readonly-plan"],
      supportedExecutionModes: ["direct-provider"],
      lifecycle: {
        exposesStart: true,
        exposesTerminal: true,
        exposesCleanup: true,
      },
      cancellation: { supported: true },
      timeout: {
        supported: true,
        diagnosticArtifactOnTimeout: true,
      },
      transcript: {
        supported: true,
        redactionKnown: true,
        truncationKnown: true,
        persistenceKnown: true,
        retentionKnown: true,
      },
      usage: {
        supported: true,
        preservesProviderTokenClasses: true,
        supportsExplicitUnknowns: true,
      },
      resultHandoff: {
        boundedSummary: true,
        resourcePointers: true,
      },
      credentialRoute: { supported: true },
      memoryContext: { governedAdmission: true },
      ...(writeAuthority !== undefined ? { writeAuthority } : {}),
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
    });
  }

  async invoke(input: ManagedAgentRuntimeInvocationInput): Promise<ManagedAgentInvocationRecord> {
    const request = input.request;
    const childSessionId = buildChildSessionId(request);
    const childTurnId = `${childSessionId}:turn:1`;
    const childSession = new RuntimeSession({
      sessionId: childSessionId,
      appName: "managed-agent",
      tenantId: request.authority.memoryScope.scope.id,
      userId: request.requestedBy,
      systemPrompt: request.input.summary,
    });
    const abortController = new AbortController();
    const abortFromRuntime = () => abortController.abort(input.abortSignal.reason);
    if (input.abortSignal.aborted) {
      abortFromRuntime();
    } else {
      input.abortSignal.addEventListener("abort", abortFromRuntime, { once: true });
    }
    const execution = this.runChildRuntime(input, childSession, abortController.signal);
    const timeout = createManagedInvocationTimeout(request.authority.timeoutMs, abortController);
    let raced: ManagedAgentInvocationRecord | typeof TIMEOUT;
    try {
      raced = await Promise.race([execution, timeout.promise]);
    } finally {
      timeout.cancel();
      input.abortSignal.removeEventListener("abort", abortFromRuntime);
    }

    if (raced === TIMEOUT) {
      execution.catch(() => undefined);
      const timeoutSummary = formatTimeoutSummary({
        timeoutMs: request.authority.timeoutMs,
        childSessionId,
        childTurnId,
      });
      return defineManagedAgentInvocationRecord({
        ...this.baseRecord(input),
        lifecycleState: "timed_out",
        childSessionId,
        childTurnId,
        transcript: transcriptPointer(request.invocationId),
        diagnostics: [{
          uri: managedInvocationUri(request.invocationId, "timeout"),
          kind: "timeout",
        }],
        usage: unknownRuntimeUsage(),
        resultHandoff: {
          summary: timeoutSummary,
          resourceUris: [
            managedInvocationUri(request.invocationId, "transcript"),
            managedInvocationUri(request.invocationId, "timeout"),
          ],
          memoryWriteProposalUris: [],
        },
      });
    }

    return raced as ManagedAgentInvocationRecord;
  }

  private async runChildRuntime(
    input: ManagedAgentRuntimeInvocationInput,
    childSession: RuntimeSession,
    abortSignal: AbortSignal,
  ): Promise<ManagedAgentInvocationRecord> {
    const request = input.request;
    const childSessionId = childSession.id;
    const childTurnId = `${childSessionId}:turn:1`;
    try {
      const allowedToolNames = new Set(request.authority.toolAuthority.allowedToolNames);
      const tools = this.tools.filter((tool) => allowedToolNames.has(tool.name));
      const capabilityMap = this.capabilityMap ? filterMap(this.capabilityMap, allowedToolNames) : undefined;
      const toolAuthority = this.toolAuthority ? filterMap(this.toolAuthority, allowedToolNames) : undefined;
      const runtimeBuiltinTools = this.builtinToolsProvider();
      const builtinTools = withManagedToolSandbox(
        runtimeBuiltinTools,
        createManagedToolSandbox(request),
      );
      const eventBus = new EventBus();
      const unsubscribeProgress = attachManagedChildProgressObserver(
        eventBus,
        childSessionId,
        request.invocationId,
        input.progressObserver,
      );
      const deps: OrchestratorDeps = {
        provider: this.provider,
        ...(this.model ? { model: this.model } : {}),
        executionEnvelope: this.executionEnvelope,
        tools,
        builtinTools,
        eventBus,
        ...(capabilityMap ? { capabilityMap } : {}),
      };
      const orchestrator = new RuntimeSessionOrchestrator(deps);
      const perCallConfig: PerCallToolConfig = {
        tenantId: request.authority.memoryScope.scope.id,
        abortSignal,
        toolAllowlist: allowedToolNames,
        additionalTools: tools,
        ...(capabilityMap ? { perCallCapabilities: capabilityMap } : {}),
        ...(toolAuthority ? { toolAuthority } : {}),
        ...(request.providerRoute.reasoningEffort ? { reasoningEffort: request.providerRoute.reasoningEffort as PerCallToolConfig["reasoningEffort"] } : {}),
      };
      const governedResourceContext = await buildManagedInvocationResourceContext({
        resourceUris: request.input.resourceUris,
        invocationId: request.invocationId,
        abortSignal,
        resourceReader: createManagedInvocationRuntimeResourceReader({
          builtinTools: runtimeBuiltinTools,
          session: childSession,
        }),
      });
      const result = await orchestrator.processMessage(
        childSession,
        textParts(request.input.prompt ?? request.input.summary),
        governedResourceContext,
        builtinTools,
        perCallConfig,
      ).finally(unsubscribeProgress);
      const resultText = extractText(result.parts);
      const replayResource = resultReplayResource(request.invocationId, resultText);
      const childExecutionResource = childExecutionReplayResource(request.invocationId, result, resultText);
      const summary = clipSummary(resultText, replayResource?.uri, result.stopReason);
      const writeEvidence = collectDirectRuntimeWriteEvidence(request, result.toolExecutions ?? []);
      const resultResourceUris = [
        managedInvocationUri(request.invocationId, "transcript"),
        ...(replayResource ? [replayResource.uri] : []),
        ...(childExecutionResource ? [childExecutionResource.uri] : []),
        ...writeEvidence.resultResourceUris,
      ];
      const replayResources = [replayResource, childExecutionResource]
        .filter((resource): resource is ManagedAgentReplayResource => resource !== undefined);

      return defineManagedAgentInvocationRecord({
        ...this.baseRecord(input),
        lifecycleState: lifecycleStateForDirectChildStopReason(result.stopReason),
        childSessionId,
        childTurnId,
        transcript: transcriptPointer(request.invocationId),
        usage: {
          source: "runtime",
          tokenClasses: [
            { name: "input", value: result.inputTokens },
            { name: "output", value: result.outputTokens },
            { name: "cache_read", value: result.cacheReadTokens },
            { name: "cache_write", value: result.cacheWriteTokens },
          ],
          cost: {
            currency: "unknown",
            amount: "unknown",
          },
        },
        resultHandoff: {
          summary,
          resourceUris: resultResourceUris,
          memoryWriteProposalUris: [],
        },
        ...(replayResources.length > 0 ? { replayResources } : {}),
        ...(writeEvidence.evidence.length > 0 ? { writeEvidence: writeEvidence.evidence } : {}),
      });
    } catch (err) {
      if (input.abortSignal.aborted) {
        return defineManagedAgentInvocationRecord({
          ...this.baseRecord(input),
          lifecycleState: "cancelled",
          childSessionId,
          childTurnId,
          transcript: transcriptPointer(request.invocationId),
          usage: unknownRuntimeUsage(),
          resultHandoff: {
            summary: String(input.abortSignal.reason ?? "Managed direct provider invocation cancelled."),
            resourceUris: [managedInvocationUri(request.invocationId, "transcript")],
            memoryWriteProposalUris: [],
          },
        });
      }
      return defineManagedAgentInvocationRecord({
        ...this.baseRecord(input),
        lifecycleState: "failed",
        childSessionId,
        childTurnId,
        transcript: transcriptPointer(request.invocationId),
        diagnostics: [{
          uri: managedInvocationUri(request.invocationId, "failure"),
          kind: "failure",
        }],
        usage: unknownRuntimeUsage(),
        resultHandoff: {
          summary: formatDirectProviderFailure(err, request.providerRoute),
          resourceUris: [managedInvocationUri(request.invocationId, "failure")],
          memoryWriteProposalUris: [],
        },
      });
    }
  }

  private baseRecord(input: ManagedAgentRuntimeInvocationInput): Omit<
    ManagedAgentInvocationRecord,
    "lifecycleState" | "childSessionId" | "childTurnId" | "transcript" | "diagnostics" | "usage" | "resultHandoff" | "writeEvidence"
  > {
    const request = input.request;
    return {
      invocationId: request.invocationId,
      agentId: request.agentId,
      parentSessionId: request.parentSessionId,
      parentTurnId: request.parentTurnId,
      profile: request.profile,
      providerRoute: this.providerRoute(request.providerRoute),
      adapterKind: request.adapterKind,
      executionMode: request.executionMode,
      authority: request.authority,
      capabilitySnapshot: input.admission.capabilitySnapshot,
    };
  }

  private providerRoute(route: ManagedAgentInvocationRequest["providerRoute"]): ManagedAgentInvocationRequest["providerRoute"] {
    return {
      providerId: this.providerId,
      surface: "direct-provider",
      ...(route.model ?? this.model ? { model: route.model ?? this.model } : {}),
      ...(route.reasoningEffort !== undefined ? { reasoningEffort: route.reasoningEffort } : {}),
    };
  }
}

function attachManagedChildProgressObserver(
  eventBus: EventBus,
  childSessionId: string,
  invocationId: string,
  observer: ManagedAgentRuntimeInvocationInput["progressObserver"],
): () => void {
  if (!observer) {
    return () => undefined;
  }
  const handler = (
    event: ToolAuthorizedEvent | ToolCalledEvent | ToolResultEvent | ToolCacheHitEvent | ErrorEvent,
  ): void => {
    if (event.sessionId !== childSessionId) {
      return;
    }
    const progress = managedChildProgressEvent(invocationId, event);
    if (progress) {
      void Promise.resolve(observer(progress)).catch(() => undefined);
    }
  };
  eventBus.on("tool_authorized", handler);
  eventBus.on("tool_called", handler);
  eventBus.on("tool_result", handler);
  eventBus.on("tool_cache_hit", handler);
  eventBus.on("error", handler);
  return () => {
    eventBus.off("tool_authorized", handler);
    eventBus.off("tool_called", handler);
    eventBus.off("tool_result", handler);
    eventBus.off("tool_cache_hit", handler);
    eventBus.off("error", handler);
  };
}

function managedChildProgressEvent(
  invocationId: string,
  event: ToolAuthorizedEvent | ToolCalledEvent | ToolResultEvent | ToolCacheHitEvent | ErrorEvent,
): ManagedAgentRuntimeInvocationProgressEvent {
  const recordedAt = event.timestamp instanceof Date ? event.timestamp.toISOString() : new Date().toISOString();
  const base = {
    eventId: `${invocationId}:progress:${event.type}:${recordedAt}:${"toolName" in event ? event.toolName : "runtime"}`,
    kind: event.type,
    recordedAt,
  };
  if (event.type === "tool_authorized") {
    return {
      ...base,
      summary: `${event.toolName} authorization ${event.allowed ? "allowed" : "denied"}`,
      toolName: event.toolName,
      metadata: {
        level: event.level,
        allowed: event.allowed,
        reason: event.reason,
      },
    };
  }
  if (event.type === "tool_called") {
    return {
      ...base,
      summary: `${event.toolName} called`,
      toolName: event.toolName,
      ...(event.metadata ? { metadata: event.metadata } : {}),
    };
  }
  if (event.type === "tool_result") {
    return {
      ...base,
      summary: `${event.toolName} ${event.success ? "succeeded" : "failed"}`,
      toolName: event.toolName,
      success: event.success,
      ...(event.isError !== undefined ? { isError: event.isError } : {}),
      durationMs: event.durationMs,
      ...(event.resultSummary ? { resultSummary: event.resultSummary } : {}),
      ...(event.metadata ? { metadata: event.metadata } : {}),
    };
  }
  if (event.type === "tool_cache_hit") {
    return {
      ...base,
      summary: `${event.toolName} cache hit`,
      toolName: event.toolName,
      metadata: { cacheTtl: event.cacheTtl },
    };
  }
  return {
    ...base,
    summary: event.message,
    isError: true,
    metadata: {
      code: event.code,
      taskId: event.taskId,
    },
  };
}

function filterMap<T>(source: ReadonlyMap<string, T>, allowedNames: ReadonlySet<string>): ReadonlyMap<string, T> {
  const filtered = new Map<string, T>();
  for (const [name, value] of source) {
    if (allowedNames.has(name)) {
      filtered.set(name, value);
    }
  }
  return filtered;
}

function withManagedToolSandbox(
  source: ReadonlyMap<string, RuntimeBuiltinToolExecutor>,
  sandbox: unknown,
): ReadonlyMap<string, RuntimeBuiltinToolExecutor> {
  const wrapped = new Map<string, RuntimeBuiltinToolExecutor>();
  for (const [name, executor] of source) {
    wrapped.set(name, async (input, context) =>
      executor(input, withSandboxContext(context, sandbox)));
  }
  return wrapped;
}

function withSandboxContext(
  context: RuntimeBuiltinToolExecutionContext | undefined,
  sandbox: unknown,
): RuntimeBuiltinToolExecutionContext | undefined {
  if (!context) {
    return undefined;
  }
  return {
    ...context,
    sandbox,
  };
}

function createManagedToolSandbox(request: ManagedAgentInvocationRequest): {
  readonly cwd: string;
  readonly policy: SandboxPolicy;
} {
  const workingDirectory = request.authority.workingDirectory.path;
  const config: SandboxConfig = {
    fsPolicy: request.authority.toolAuthority.writeAllowed === true
      && request.authority.workingDirectory.mode !== "read-only"
      ? "read-write"
      : "read-only",
    netPolicy: request.authority.toolAuthority.networkAllowed === true ? "full" : "none",
    allowedPaths: resolveAllowedPaths(request),
    deniedPaths: resolveDeniedPaths(request),
    allowedDomains: request.authority.toolAuthority.networkAllowed === true ? ["*"] : [],
  };
  return {
    cwd: workingDirectory,
    policy: new SandboxPolicy({
      config,
      projectPath: workingDirectory,
    }),
  };
}

function resolveAllowedPaths(request: ManagedAgentInvocationRequest): readonly string[] {
  if (
    request.authority.toolAuthority.writeAllowed !== true
    || request.authority.workingDirectory.mode === "read-only"
  ) {
    return uniquePaths([
      request.authority.workingDirectory.path,
      ...(request.authority.readAuthority?.workspace.allowedPaths ?? []),
    ]);
  }
  const workspaceScope = request.authority.writeAuthority?.scope.workspace;
  if (workspaceScope && workspaceScope.allowedPaths.length > 0) {
    return workspaceScope.allowedPaths;
  }
  return [request.authority.workingDirectory.path];
}

function resolveDeniedPaths(request: ManagedAgentInvocationRequest): readonly string[] {
  return uniquePaths([
    ...(request.authority.readAuthority?.workspace.deniedPaths ?? []),
    ...(request.authority.writeAuthority?.scope.workspace.deniedPaths ?? []),
  ]);
}

function uniquePaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)];
}

function buildChildSessionId(request: ManagedAgentInvocationRequest): string {
  return `${request.parentSessionId}:managed:${request.invocationId}`;
}

function collectDirectRuntimeWriteEvidence(
  request: ManagedAgentInvocationRequest,
  toolExecutions: readonly ToolExecutionSummary[],
): {
  readonly evidence: readonly ManagedAgentWriteEvidence[];
  readonly resultResourceUris: readonly string[];
} {
  const fileChanges = toolExecutions.flatMap((execution) =>
    (execution.fileChanges ?? []).map((change) => ({
      source: "tool-result" as const,
      path: change.path,
      changeType: change.changeType,
      ...(change.linesAdded !== undefined ? { linesAdded: change.linesAdded } : {}),
      ...(change.linesRemoved !== undefined ? { linesRemoved: change.linesRemoved } : {}),
      ...(change.diffPreview !== undefined ? { diffPreview: change.diffPreview } : {}),
      ...(change.diffTruncated !== undefined ? { diffTruncated: change.diffTruncated } : {}),
    }))
  );
  if (fileChanges.length === 0) {
    return {
      evidence: [],
      resultResourceUris: [],
    };
  }

  const collected = collectManagedAgentLiveWriteEvidence({
    request,
    fileChanges: normalizeManagedAgentLiveWriteChanges(fileChanges),
  });
  return {
    evidence: collected.evidence,
    resultResourceUris: collected.attemptResourceUris,
  };
}

function managedInvocationUri(invocationId: string, kind: string): string {
  return `kiln://managed-invocations/${invocationId}/${kind}`;
}

function transcriptPointer(invocationId: string) {
  return {
    uri: managedInvocationUri(invocationId, "transcript"),
    redacted: "unknown" as const,
    truncated: false,
    persisted: true,
    retention: "session" as const,
  };
}

function unknownRuntimeUsage() {
  return {
    source: "runtime" as const,
    tokenClasses: [
      { name: "input", value: "unknown" as const },
      { name: "output", value: "unknown" as const },
      { name: "cache_read", value: "unknown" as const },
      { name: "cache_write", value: "unknown" as const },
    ],
    cost: {
      currency: "unknown" as const,
      amount: "unknown" as const,
    },
  };
}

function clipSummary(summary: string, resultResourceUri?: string, stopReason?: string): string {
  const trimmed = summary.trim();
  if (trimmed.length === 0) {
    return `${NO_DIRECT_HANDOFF_SUMMARY} Inspect the transcript resource before recording governed evidence.`;
  }
  if (isNoHandoffStopReason(stopReason)) {
    return `${NO_DIRECT_HANDOFF_SUMMARY} ${trimmed}`;
  }
  if (trimmed.length <= RESULT_SUMMARY_LIMIT) {
    return trimmed;
  }
  const suffix = resultResourceUri ? `... ${RESULT_RESOURCE_NOTICE}` : "...";
  const prefixLength = Math.max(0, RESULT_SUMMARY_LIMIT - suffix.length);
  return `${trimmed.slice(0, prefixLength)}${suffix}`;
}

function isNoHandoffStopReason(stopReason: string | undefined): boolean {
  return stopReason === RUNTIME_SESSION_NO_TOOL_FINALIZATION_FAILED_STOP_REASON
    || stopReason === RUNTIME_SESSION_TOOL_ROUND_BUDGET_EXHAUSTED_STOP_REASON;
}

function lifecycleStateForDirectChildStopReason(stopReason: string | undefined): "completed" | "failed" {
  return isFailedDirectChildStopReason(stopReason) ? "failed" : "completed";
}

function isFailedDirectChildStopReason(stopReason: string | undefined): boolean {
  return isNoHandoffStopReason(stopReason)
    || stopReason === RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON;
}

function resultReplayResource(invocationId: string, text: string): ManagedAgentReplayResource | undefined {
  if (text.length <= RESULT_SUMMARY_LIMIT) {
    return undefined;
  }
  return {
    uri: managedInvocationUri(invocationId, "result/final"),
    title: "Managed invocation final result",
    mimeType: "text/markdown",
    text,
  };
}

function childExecutionReplayResource(
  invocationId: string,
  result: OrchestrateResult,
  resultText: string,
): ManagedAgentReplayResource | undefined {
  const toolExecutions = result.toolExecutions ?? [];
  if (
    resultText.trim().length > 0
    && toolExecutions.length === 0
    && !isFailedDirectChildStopReason(result.stopReason)
  ) {
    return undefined;
  }
  return {
    uri: managedInvocationUri(invocationId, "child-execution"),
    title: "Managed invocation child execution evidence",
    mimeType: "text/markdown",
    text: clipResourceText(formatChildExecutionEvidence(result, resultText), CHILD_EXECUTION_RESOURCE_LIMIT),
  };
}

function formatChildExecutionEvidence(result: OrchestrateResult, resultText: string): string {
  return [
    "# Direct Child Execution Evidence",
    "",
    resultText.trim().length > 0 ? "## Final Output" : "Final output: <empty>",
    resultText.trim().length > 0 ? clipResourceText(resultText.trim(), TOOL_OUTPUT_LIMIT) : undefined,
    "",
    `Stop reason: ${result.stopReason ?? "unknown"}`,
    `Input tokens: ${result.inputTokens}`,
    `Output tokens: ${result.outputTokens}`,
    `Cache read tokens: ${result.cacheReadTokens}`,
    `Cache write tokens: ${result.cacheWriteTokens}`,
    `Tool executions: ${result.toolExecutions?.length ?? 0}`,
    "",
    ...formatToolExecutionEvidence(result.toolExecutions ?? []),
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatToolExecutionEvidence(toolExecutions: readonly ToolExecutionSummary[]): readonly string[] {
  if (toolExecutions.length === 0) {
    return [];
  }
  return toolExecutions.flatMap((execution, index) => [
    `## Tool ${index + 1}: ${execution.toolName}`,
    "",
    execution.toolCallId ? `Tool call: ${execution.toolCallId}` : undefined,
    `Success: ${execution.success ? "true" : "false"}`,
    `Duration ms: ${execution.durationMs}`,
    execution.input ? `Input: ${clipResourceText(JSON.stringify(execution.input), TOOL_OUTPUT_LIMIT)}` : undefined,
    `Result summary: ${execution.resultSummary}`,
    execution.output ? `Output: ${clipResourceText(execution.output, TOOL_OUTPUT_LIMIT)}` : undefined,
    "",
  ].filter((line): line is string => line !== undefined));
}

function clipResourceText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 14))}... [truncated]`;
}

function formatTimeoutSummary(input: {
  readonly timeoutMs: number;
  readonly childSessionId: string;
  readonly childTurnId: string;
}): string {
  return [
    `Direct provider managed invocation timed out after ${input.timeoutMs}ms.`,
    `Child session: ${input.childSessionId}.`,
    `Child turn: ${input.childTurnId}.`,
    "No completed child handoff was produced before timeout.",
    "Inspect the transcript and timeout diagnostic resources for replayable route, authority, context, and terminal-state evidence.",
  ].join(" ");
}

function formatDirectProviderFailure(
  error: unknown,
  providerRoute: ManagedAgentInvocationRequest["providerRoute"],
): string {
  const route = [
    `provider ${providerRoute.providerId}`,
    providerRoute.model ? `model ${providerRoute.model}` : undefined,
    providerRoute.reasoningEffort ? `reasoning ${providerRoute.reasoningEffort}` : undefined,
  ].filter((part): part is string => part !== undefined).join(", ");
  return `Direct provider managed invocation failed for ${route}. ${formatManagedProviderError(error)}`;
}

function formatManagedProviderError(error: unknown): string {
  if (error instanceof AllCredentialsExhaustedError) {
    const details = [
      formatCredentialOutcome(error.lastOutcome),
      formatCredentialCause(error.cause),
    ].filter((detail): detail is string => detail !== undefined);
    return details.length > 0
      ? `${error.message}: ${details.join("; ")}`
      : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function formatCredentialOutcome(outcome: AllCredentialsExhaustedError["lastOutcome"]): string | undefined {
  if (!outcome) {
    return undefined;
  }
  switch (outcome.type) {
    case "rate-limited":
      return outcome.resetAt
        ? `last outcome rate-limited until ${new Date(outcome.resetAt).toISOString()}`
        : "last outcome rate-limited";
    case "quota-exceeded":
      return "last outcome quota-exceeded";
    case "auth-failed":
      return "last outcome auth-failed";
    case "connection-failed":
      return "last outcome connection-failed";
    case "unknown-error":
      return outcome.message ? `last outcome unknown-error ${outcome.message}` : "last outcome unknown-error";
    case "ok":
      return "last outcome ok";
  }
}

function formatCredentialCause(cause: unknown): string | undefined {
  if (!cause) {
    return undefined;
  }
  if (cause instanceof Error) {
    return `last error ${cause.message}`;
  }
  return `last error ${String(cause)}`;
}

function createManagedInvocationTimeout(
  timeoutMs: number,
  abortController: AbortController,
): { readonly promise: Promise<typeof TIMEOUT>; readonly cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      abortController.abort();
      resolve(TIMEOUT);
    }, Math.max(timeoutMs, 0));
  });
  return {
    promise,
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

function requireText(value: string | undefined, message: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(message);
  }
  return value.trim();
}
