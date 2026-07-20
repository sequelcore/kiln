import { randomUUID } from "node:crypto";
import {
  AllCredentialsExhaustedError,
  EventBus,
  KilnError,
  appendExecutionIdentity,
  type ContentPart,
  isRetryable as isCredentialOutcomeRetryable,
  resolveProviderDefaultBillingMode,
  resolveExecutionIdentity,
  textPart,
  type AgentMessage,
  type AuthorityDescriptor,
  type Capability,
  type DirectProviderExecutionMode,
  type DirectProviderId,
  type ExecutionSessionEvent,
  type ApprovalRequestedEvent,
  type ToolCalledEvent,
  type ToolOutputEvent,
  type ResolvedDirectProviderExecutionProfile,
  type ToolDefinition,
  type ToolResultEvent,
  type ReasoningEffort,
  type SessionTurnOutcome,
  resolveDirectProviderExecutionProfile,
  type DefaultBuiltinToolRegistryOptions,
  CONSERVATIVE_UNKNOWN_ENVELOPE,
  deriveAuthorityFromEffect,
  getBuiltinEffectEnvelope,
  type KilnMcpClient,
} from "@kilnai/core";
import {
  buildEffectiveTurnAuthorityPolicyInputs,
  createAttachedRuntimeBuiltinToolSurface,
  describeEffectiveTurnAuthorityActionability,
  formatEffectiveTurnAuthorityGuidance,
  type ManagedInvocationToolAttachment,
  type OperatorSurfaceController,
  type OrchestrateResult,
  type PerCallToolConfig,
  type RuntimeBudgetAdmissionPort,
  type RuntimeExecutionEnvelope,
} from "@kilnai/runtime";
import type { OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import type {
  IKilnSession,
  KilnPermissionPolicy,
  SessionCapabilities,
  SessionRunOptions,
} from "./session.js";
import { buildProviderSystemPrompt } from "./preamble-builder.js";
import { PermissionPolicyAuthorizer } from "./permission-policy-authorizer.js";
import { ProviderContextTracker } from "./provider-context.js";
import { createDirectProviderAdapter } from "./direct-provider-adapter-factory.js";
import { createCliOperatorThemeController } from "../application/operator-theme-preferences.js";

export interface ProviderSessionConfig {
  readonly provider: DirectProviderId;
  readonly runtimeSessionId?: string;
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly task: string;
  readonly systemPrompt?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly permissionPolicy: KilnPermissionPolicy;
  readonly constraintInstructions?: readonly string[];
  readonly executionMode?: DirectProviderExecutionMode;
  readonly executionProfile?: ResolvedDirectProviderExecutionProfile;
  readonly operatorSurface?: OperatorSurfaceController;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly managedInvocation?: ManagedInvocationToolAttachment;
  readonly budgetAdmission?: RuntimeBudgetAdmissionPort;
  readonly executionEnvelope?: RuntimeExecutionEnvelope;
  readonly mcpClients?: readonly KilnMcpClient[];
  readonly mcpToolAllowlist?: ReadonlySet<string>;
}

const PROVIDER_PRIORITY: Record<ProviderSessionConfig["provider"], number> = {
  "codex-oauth": 1,
  "opencode-go": 2,
  "opencode-zen": 3,
  anthropic: 4,
  openai: 5,
  openrouter: 6,
  deepseek: 7,
  ollama: 8,
  lmstudio: 9,
};

function filterCapabilityMap(
  capabilities: ReadonlyMap<string, Capability>,
  allowlist: ReadonlySet<string>,
): ReadonlyMap<string, Capability> {
  const filtered = new Map<string, Capability>();
  for (const [name, capability] of capabilities.entries()) {
    if (allowlist.has(name)) {
      filtered.set(name, capability);
    }
  }
  return filtered;
}

function authorityDescriptorFromCapability(
  toolName: string,
  capability: Capability | undefined,
): AuthorityDescriptor | undefined {
  const effect = capability?.effectEnvelope ?? getBuiltinEffectEnvelope(toolName) ?? CONSERVATIVE_UNKNOWN_ENVELOPE;
  return deriveAuthorityFromEffect(effect);
}

function isReadOnlyCapability(toolName: string, capability: Capability | undefined): boolean {
  const effect = capability?.effectEnvelope ?? getBuiltinEffectEnvelope(toolName) ?? CONSERVATIVE_UNKNOWN_ENVELOPE;
  return effect.operation !== "mutate";
}

function resolveExecutionMode(config: ProviderSessionConfig): DirectProviderExecutionMode {
  const profile = resolveProfile(config);
  return profile?.executionMode ?? "text-only";
}

function toSessionToolUseEvent(content: string): Extract<ExecutionSessionEvent, { type: "tool_use" }> {
  try {
    const parsed = JSON.parse(content) as { name?: unknown; input?: unknown };
    return {
      type: "tool_use",
      toolName: typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : "provider_tool_call",
      input: parsed.input ?? {},
    };
  } catch {
    return {
      type: "tool_use",
      toolName: "provider_tool_call",
      input: {},
    };
  }
}

function resolveProfile(
  config: ProviderSessionConfig,
): ResolvedDirectProviderExecutionProfile | undefined {
  return config.executionProfile ?? resolveDirectProviderExecutionProfile({
    provider: config.provider,
    model: config.model,
    requestedExecutionMode: config.executionMode,
  });
}

function toolCalledToSessionEvent(event: ToolCalledEvent): Extract<ExecutionSessionEvent, { type: "tool_use" }> {
  const isMcp = event.toolName.startsWith("mcp:");
  return {
    type: "tool_use",
    toolName: event.toolName,
    input: event.toolInput ?? {},
    toolCallId: event.toolCallId,
    ...(isMcp ? { source: "mcp" as const, mcpSelector: event.toolName } : {}),
  };
}

function toolOutputToSessionEvent(event: ToolOutputEvent): Extract<ExecutionSessionEvent, { type: "tool_output_delta" }> {
  return {
    type: "tool_output_delta",
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    stream: event.stream,
    delta: event.delta,
    chunkIndex: event.chunkIndex,
  };
}

function toolResultToSessionEvent(event: ToolResultEvent): Extract<ExecutionSessionEvent, { type: "tool_result" }> {
  const output = event.output ?? event.resultSummary ?? "";
  return {
    type: "tool_result",
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    output,
    ...(event.resultSummary !== undefined && event.resultSummary !== output ? { outputSummary: event.resultSummary } : {}),
    ...(event.isError ? { isError: true } : {}),
    ...(event.metadata ? { metadata: event.metadata } : {}),
    ...(event.resourceLinks ? { resourceLinks: event.resourceLinks } : {}),
    ...(event.toolUsage ? { toolUsage: event.toolUsage } : {}),
  };
}

function deriveCapabilities(
  config: ProviderSessionConfig,
  toolDefinitions: readonly ToolDefinition[],
  materializableTools: ReadonlyMap<string, ToolDefinition>,
): SessionCapabilities {
  const executionMode = resolveExecutionMode(config);
  const supportedTools = executionMode === "kiln-executable"
    ? (() => {
      const names = new Set(toolDefinitions.map((tool) => tool.name));
      for (const name of materializableTools.keys()) {
        names.add(name);
      }
      return [...names];
    })()
    : [];
  return {
    mcp: true,
    streaming: true,
    resumable: false,
    resume: false,
    costTrackingMode: "computed",
    supportedTools,
    maxContextTokens: null,
    priority: PROVIDER_PRIORITY[config.provider],
    fallbackTo: null,
    permissionPolicy: config.permissionPolicy,
  };
}

export class ProviderSession implements IKilnSession {
  readonly sessionId: string;

  private readonly _capabilities: SessionCapabilities;
  private readonly executionProfile?: ResolvedDirectProviderExecutionProfile;
  private readonly executionMode: DirectProviderExecutionMode;
  private readonly resolvedModel?: string;
  private readonly contextTracker: ProviderContextTracker;
  private readonly builtinTools: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
  private readonly toolDefinitions: readonly ToolDefinition[];
  private readonly materializableTools: ReadonlyMap<string, ToolDefinition>;
  private readonly capabilityMap: ReadonlyMap<string, Capability>;
  private readonly eventBus: EventBus;
  private disposePromise?: Promise<void>;

  constructor(readonly config: ProviderSessionConfig) {
    this.sessionId = config.runtimeSessionId ?? randomUUID();
    this.executionProfile = resolveProfile(config);
    this.executionMode = this.executionProfile?.executionMode ?? "text-only";
    this.resolvedModel = this.executionProfile?.model ?? config.model;
    this.contextTracker = new ProviderContextTracker({
      maxContextTokens: 128000,
      compactionThreshold: 0.85,
    });
    const operatorSurface = config.operatorSurface ?? {
      theme: createCliOperatorThemeController(),
    };
    const builtinToolSurface = createAttachedRuntimeBuiltinToolSurface({
      operatorSurface,
      builtinToolOptions: config.builtinToolOptions,
      managedInvocation: config.managedInvocation,
    });
    this.builtinTools = builtinToolSurface.callBuiltinTools;
    this.toolDefinitions = builtinToolSurface.toolDefinitions;
    this.materializableTools = builtinToolSurface.materializableTools;
    this.capabilityMap = new Map([
      ...builtinToolSurface.materializableCapabilities,
      ...builtinToolSurface.capabilities,
    ]);
    this.eventBus = new EventBus(100);
    this._capabilities = deriveCapabilities(
      config,
      builtinToolSurface.toolDefinitions,
      this.materializableTools,
    );
  }

  get capabilities(): SessionCapabilities {
    return this._capabilities;
  }

  get providerSessionId(): string | undefined {
    return undefined;
  }

  async *run(options: SessionRunOptions): AsyncIterable<ExecutionSessionEvent> {
    const startedAt = Date.now();

    if (options.abortSignal?.aborted) {
      yield {
        type: "error",
        code: "ABORTED",
        message: "Aborted before start",
        isRetryable: false,
      };
      yield {
        type: "completed",
        totalUsd: 0,
        durationMs: Date.now() - startedAt,
        outcome: "cancelled",
        isPreflightCrash: true,
      };
      return;
    }

    try {
      if (this.executionMode === "kiln-executable") {
        yield* this.runKilnExecutable(options, startedAt);
        return;
      }
      const budgetDenial = await this.checkProviderBudget();
      if (budgetDenial) {
        yield {
          type: "error",
          code: "BUDGET_ADMISSION_DENIED",
          message: budgetDenial,
          isRetryable: false,
        };
        yield {
          type: "completed",
          totalUsd: 0,
          durationMs: Date.now() - startedAt,
          outcome: "failed",
          isPreflightCrash: false,
        };
        return;
      }
      yield* this.runTextOnly(options, startedAt);
    } catch (err) {
      const code = this.executionMode === "kiln-executable"
        ? "EXECUTABLE_SESSION_ERROR"
        : "PROVIDER_SESSION_ERROR";
      const message = this.executionMode === "kiln-executable"
        ? formatExecutableSessionError(err)
        : formatProviderSessionError(err);
      yield { type: "error", code, message, isRetryable: isProviderSessionErrorRetryable(err) };
      yield {
        type: "completed",
        totalUsd: 0,
        durationMs: Date.now() - startedAt,
        outcome: options.abortSignal?.aborted ? "cancelled" : "failed",
        isPreflightCrash: false,
      };
    }
  }

  async dispose(): Promise<void> {
    this.disposePromise ??= Promise.all((this.config.mcpClients ?? []).map((client) => client.disconnect())).then(() => undefined);
    await this.disposePromise;
  }

  private async checkProviderBudget(): Promise<string | undefined> {
    const budgetAdmission = this.config.budgetAdmission;
    if (!budgetAdmission) {
      return undefined;
    }
    try {
      const admission = await budgetAdmission.admit({
        subject: "runtime-session-turn",
        sessionId: this.sessionId,
        routeCandidates: [
          {
            providerId: this.config.provider,
            ...(this.resolvedModel ? { model: this.resolvedModel } : {}),
          },
        ],
      });
      if (admission.status === "admitted") {
        return undefined;
      }
      return admission.message ?? `Budget admission denied: ${admission.reason}.`;
    } catch (error) {
      return `Budget admission failed: ${readErrorMessage(error)}`;
    }
  }

  private isStructuredPreamble(prompt: string): boolean {
    return prompt.trimStart().startsWith("<kiln-preamble>");
  }

  private buildSystemAndPrompt(
    options: SessionRunOptions,
    effectiveTurnAuthority?: PerCallToolConfig["effectiveTurnAuthority"],
  ): {
    readonly systemPrompt: string;
    readonly userPrompt: string;
  } {
    const hasStructuredPreamble = this.isStructuredPreamble(options.prompt);
    const baseSystemPrompt = options.system ?? (hasStructuredPreamble ? options.prompt : (this.config.systemPrompt ?? ""));
    const userPrompt = hasStructuredPreamble ? this.config.task : options.prompt;
    const requestedAuthority = options.requestedAuthority ?? this.config.requestedAuthority ?? "auto";
    const systemPrompt = appendExecutionIdentity(
      buildProviderSystemPrompt(
        baseSystemPrompt,
        this.config.constraintInstructions,
        {
          executionMode: this.executionMode,
          authorityGuidance: formatEffectiveTurnAuthorityGuidance(describeEffectiveTurnAuthorityActionability({
            authority: effectiveTurnAuthority,
            executionMode: "execute",
            requestedAuthority,
          })),
        },
      ),
      resolveExecutionIdentity({
        configuredProvider: this.config.provider,
        configuredModel: this.resolvedModel,
        configuredBillingMode: resolveProviderDefaultBillingMode(this.config.provider),
      }),
    );
    return { systemPrompt, userPrompt };
  }

  private buildConversationMessages(
    userPrompt: string,
    messages?: readonly AgentMessage[],
  ): AgentMessage[] {
    const hydrated: AgentMessage[] = [];
    if (messages && messages.length > 0) {
      for (let i = 0; i < messages.length - 1; i++) {
        const message = messages[i];
        if (message) {
          hydrated.push(message);
        }
      }
    }
    hydrated.push({ role: "user", parts: [textPart(userPrompt)] });
    return hydrated;
  }

  private hydrateConversation(
    session: {
      addUserMessage(parts: readonly ContentPart[]): void;
      addAssistantMessage(parts: readonly ContentPart[]): void;
    },
    messages: readonly AgentMessage[],
  ): void {
    for (let i = 0; i < messages.length - 1; i++) {
      const message = messages[i];
      if (!message) continue;
      if (message.role === "user") {
        session.addUserMessage(message.parts);
      } else {
        session.addAssistantMessage(message.parts);
      }
    }
  }

  private async *runTextOnly(options: SessionRunOptions, startedAt: number): AsyncIterable<ExecutionSessionEvent> {
    let outcome: SessionTurnOutcome = "completed";
    const adapter = await createDirectProviderAdapter({
      provider: this.config.provider,
      model: this.resolvedModel,
      configEnv: this.config.env,
      runtimeEnv: options.env,
    });
    const { systemPrompt, userPrompt } = this.buildSystemAndPrompt(options);
    const messages = this.buildConversationMessages(userPrompt, options.messages);

    for await (const event of adapter.streamMessage({
      system: systemPrompt,
      messages,
      reasoningEffort: options.reasoningEffort ?? this.config.reasoningEffort,
      ...(options.abortSignal ? { signal: options.abortSignal } : {}),
    })) {
      if (options.abortSignal?.aborted) {
        outcome = "cancelled";
        yield { type: "error", code: "ABORTED", message: "Aborted during execution", isRetryable: false };
        yield { type: "completed", totalUsd: 0, durationMs: Date.now() - startedAt, outcome, isPreflightCrash: false };
        return;
      }

      if (event.type === "thinking") {
        yield { type: "text_delta", content: event.content, isThinking: true };
        continue;
      }
      if (event.type === "text") {
        yield { type: "text_delta", content: event.content };
        continue;
      }
      if (event.type === "tool_use") {
        yield toSessionToolUseEvent(event.content);
        yield {
          type: "error",
          code: "TOOL_UNSUPPORTED",
          message: "Provider emitted a tool call in text-only execution mode.",
          isRetryable: false,
        };
        outcome = "failed";
        continue;
      }
      if (event.type === "tool_result") {
        yield { type: "tool_result", toolName: "provider_tool_result", output: event.content };
        continue;
      }
      if (event.type === "done") {
        const doneEvent = event as { inputTokens?: number; outputTokens?: number };
        const inputTokens = typeof doneEvent.inputTokens === "number" ? doneEvent.inputTokens : 0;
        const outputTokens = typeof doneEvent.outputTokens === "number" ? doneEvent.outputTokens : 0;
        this.contextTracker.update(inputTokens, outputTokens);
        yield {
          type: "cost_update",
          usd: 0,
          mode: "computed",
          provider: this.config.provider,
          model: this.resolvedModel,
          canonicalModel: this.resolvedModel,
          billingMode: resolveProviderDefaultBillingMode(this.config.provider),
          inputTokens,
          outputTokens,
        };
        yield { type: "completed", totalUsd: 0, durationMs: Date.now() - startedAt, outcome, isPreflightCrash: false };
        return;
      }
    }

    yield {
      type: "cost_update",
      usd: 0,
      mode: "computed",
      provider: this.config.provider,
      model: this.resolvedModel,
      canonicalModel: this.resolvedModel,
      billingMode: resolveProviderDefaultBillingMode(this.config.provider),
    };
    yield { type: "completed", totalUsd: 0, durationMs: Date.now() - startedAt, outcome, isPreflightCrash: false };
  }

  private buildPerCallConfig(
    reasoningEffort: ReasoningEffort | undefined,
    requestedAuthority: OperatorTurnRequestedAuthority | undefined,
    abortSignal: AbortSignal | undefined,
    turnId: string | undefined,
    workingDirectory: string | undefined,
    externalTools: readonly ToolDefinition[] = [],
    externalCapabilities: ReadonlyMap<string, Capability> = new Map(),
  ): PerCallToolConfig {
    const combinedToolDefinitions = [...this.toolDefinitions, ...externalTools];
    const combinedCapabilities = new Map([...this.capabilityMap, ...externalCapabilities]);
    if (!requestedAuthority || requestedAuthority === "auto") {
      const admittedToolNames = new Set(this.materializableTools.keys());
      for (const tool of externalTools) {
        if (!this.config.mcpToolAllowlist || this.config.mcpToolAllowlist.has(tool.name)) {
          admittedToolNames.add(tool.name);
        }
      }
      return {
        ...(turnId ? { turnId } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(abortSignal ? { abortSignal } : {}),
        ...(workingDirectory ? { workingDirectory } : {}),
        toolAllowlist: admittedToolNames,
        additionalTools: combinedToolDefinitions.filter((tool) => admittedToolNames.has(tool.name)),
        perCallCapabilities: filterCapabilityMap(combinedCapabilities, admittedToolNames),
        ...(requestedAuthority ? {
          effectiveTurnAuthority: {
            executionMode: "execute",
            requestedAuthority,
            admittedAuthority: "unknown",
            sourcePolicy: "runtime_surface_projection",
            reason: "cli direct-provider requested turn authority",
            completeness: "partial",
            toolCount: admittedToolNames.size,
            deniedToolCount: 0,
            policyInputs: buildEffectiveTurnAuthorityPolicyInputs({
              executionMode: "execute",
              requestedAuthority,
              admittedAuthority: "unknown",
              routeReason: "cli direct-provider requested turn authority",
            }),
          },
        } : {}),
      };
    }

    const candidateTools = new Map(this.materializableTools);
    for (const tool of combinedToolDefinitions) {
      candidateTools.set(tool.name, tool);
    }
    const admittedToolNames = new Set<string>();
    const toolAuthority = new Map<string, AuthorityDescriptor>();
    for (const tool of candidateTools.values()) {
      if (tool.name.startsWith("mcp:") && this.config.mcpToolAllowlist && !this.config.mcpToolAllowlist.has(tool.name)) {
        continue;
      }
      const capability = combinedCapabilities.get(tool.name);
      const authority = authorityDescriptorFromCapability(tool.name, capability);
      if (!authority) {
        continue;
      }
      if (requestedAuthority === "read_only") {
        if (authority.allowed && !authority.requiresApproval && isReadOnlyCapability(tool.name, capability) && authority.level <= 1) {
          admittedToolNames.add(tool.name);
          toolAuthority.set(tool.name, authority);
        }
        continue;
      }
      if (requestedAuthority === "destructive" && capability) {
        admittedToolNames.add(tool.name);
        toolAuthority.set(tool.name, {
          level: authority.level,
          allowed: true,
          requiresApproval: false,
          reason: "Destructive authority was admitted by the parent runtime turn.",
        });
        continue;
      }
      if (authority.allowed && !authority.requiresApproval && authority.level <= 2) {
        admittedToolNames.add(tool.name);
        toolAuthority.set(tool.name, authority);
      } else if (authority.requiresApproval) {
        admittedToolNames.add(tool.name);
        toolAuthority.set(tool.name, authority);
      }
    }

    const admittedAuthority = admittedToolNames.size === 0 ? "fail_closed" : requestedAuthority;
    return {
      ...(turnId ? { turnId } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(abortSignal ? { abortSignal } : {}),
      ...(workingDirectory ? { workingDirectory } : {}),
      toolAllowlist: admittedToolNames,
      toolAuthority,
      additionalTools: combinedToolDefinitions.filter((tool) => admittedToolNames.has(tool.name)),
      perCallCapabilities: filterCapabilityMap(combinedCapabilities, admittedToolNames),
      effectiveTurnAuthority: {
        executionMode: "execute",
        requestedAuthority,
        admittedAuthority,
        sourcePolicy: "runtime_surface_projection",
        reason: "cli direct-provider requested turn authority",
        completeness: "authoritative",
        toolCount: admittedToolNames.size,
        deniedToolCount: Math.max(0, candidateTools.size - admittedToolNames.size),
        policyInputs: buildEffectiveTurnAuthorityPolicyInputs({
          executionMode: "execute",
          requestedAuthority,
          admittedAuthority,
          routeReason: "cli direct-provider requested turn authority",
        }),
      },
    };
  }

  private async *runKilnExecutable(options: SessionRunOptions, startedAt: number): AsyncIterable<ExecutionSessionEvent> {
    const { RuntimeSessionOrchestrator, RuntimeSession } = await import("@kilnai/runtime");

    const mcpCapabilities = (await Promise.all(
      (this.config.mcpClients ?? []).map((client) => client.discoverProviderCapabilities()),
    )).flat();
    const externalTools: ToolDefinition[] = mcpCapabilities.map((capability) => ({
      name: capability.name,
      description: capability.description,
      inputSchema: capability.schema,
      tags: new Set(capability.tags),
    }));
    const externalCapabilityMap = new Map(mcpCapabilities.map((capability) => [capability.name, capability]));
    const requestedAuthority = options.requestedAuthority ?? this.config.requestedAuthority;
    const perCallConfig = this.buildPerCallConfig(
      options.reasoningEffort ?? this.config.reasoningEffort,
      requestedAuthority,
      options.abortSignal,
      options.turnId,
      options.cwd ?? this.config.cwd,
      externalTools,
      externalCapabilityMap,
    );
    const { systemPrompt, userPrompt } = this.buildSystemAndPrompt(options, perCallConfig.effectiveTurnAuthority);
    const adapter = await createDirectProviderAdapter({
      provider: this.config.provider,
      model: this.resolvedModel,
      configEnv: this.config.env,
      runtimeEnv: options.env,
    });
    const authorizer = new PermissionPolicyAuthorizer(this.config.permissionPolicy);

    const cliSession = new RuntimeSession({
      appName: "kiln-cli",
      tenantId: "cli-session",
      userId: this.sessionId,
      sessionId: this.sessionId,
      systemPrompt,
      idleTimeoutMs: 30 * 60 * 1000,
    });

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: adapter,
      model: this.resolvedModel,
      tools: [...this.toolDefinitions, ...externalTools],
      materializableTools: this.materializableTools,
      builtinTools: this.builtinTools,
      eventBus: this.eventBus,
      toolAuthorizer: authorizer,
      capabilityMap: new Map([...this.capabilityMap, ...externalCapabilityMap]),
      ...(this.config.mcpClients && this.config.mcpClients.length > 0 ? { mcpClients: this.config.mcpClients } : {}),
      dangerousCommandDetector: undefined,
      ...(this.config.budgetAdmission ? { budgetAdmission: this.config.budgetAdmission } : {}),
      ...(this.config.executionEnvelope ? { executionEnvelope: this.config.executionEnvelope } : {}),
    });

    if (options.messages && options.messages.length > 0) {
      this.hydrateConversation(cliSession, options.messages);
    }

    const promptParts: ContentPart[] = [textPart(userPrompt)];
    const liveToolEvents: ExecutionSessionEvent[] = [];
    let hasLiveToolEvents = false;
    let wakeLiveToolDrain: (() => void) | undefined;
    const enqueueLiveToolEvent = (event: ExecutionSessionEvent) => {
      hasLiveToolEvents = true;
      liveToolEvents.push(event);
      wakeLiveToolDrain?.();
      wakeLiveToolDrain = undefined;
    };
    const onToolCalled = (event: ToolCalledEvent) => {
      if (event.sessionId !== cliSession.id) return;
      enqueueLiveToolEvent(toolCalledToSessionEvent(event));
    };
    const onToolResult = (event: ToolResultEvent) => {
      if (event.sessionId !== cliSession.id) return;
      enqueueLiveToolEvent(toolResultToSessionEvent(event));
    };
    const onToolOutput = (event: ToolOutputEvent) => {
      if (event.sessionId !== cliSession.id) return;
      enqueueLiveToolEvent(toolOutputToSessionEvent(event));
    };
    const onApprovalRequested = (event: ApprovalRequestedEvent) => {
      if (event.sessionId !== cliSession.id) return;
      void (async () => {
        let decision: { readonly approved: boolean; readonly reason?: string };
        try {
          decision = options.requestApproval
            ? await options.requestApproval(event.description)
            : {
                approved: false,
                reason: "This operator surface does not provide an approval handler",
              };
        } catch (error) {
          decision = {
            approved: false,
            reason: error instanceof Error ? error.message : "The operator approval handler failed",
          };
        }
        orchestrator.emitApprovalReceived(decision.approved, decision.reason, event.approvalId);
      })();
    };

    this.eventBus.on("tool_called", onToolCalled);
    this.eventBus.on("tool_output", onToolOutput);
    this.eventBus.on("tool_result", onToolResult);
    this.eventBus.on("approval_requested", onApprovalRequested);

    let result: OrchestrateResult | undefined;
    let processError: unknown;
    let processSettled = false;
    const processPromise = orchestrator.processMessage(
      cliSession,
      promptParts,
      undefined,
      undefined,
      perCallConfig,
    ).then((nextResult) => {
      result = nextResult;
    }).catch((err: unknown) => {
      processError = err;
    }).finally(() => {
      processSettled = true;
      wakeLiveToolDrain?.();
      wakeLiveToolDrain = undefined;
    });

    try {
      while (!processSettled || liveToolEvents.length > 0) {
        while (liveToolEvents.length > 0) {
          yield liveToolEvents.shift()!;
        }
        if (!processSettled) {
          await new Promise<void>((resolve) => {
            wakeLiveToolDrain = resolve;
          });
        }
      }
      await processPromise;
    } finally {
      this.eventBus.off("tool_called", onToolCalled);
      this.eventBus.off("tool_output", onToolOutput);
      this.eventBus.off("tool_result", onToolResult);
      this.eventBus.off("approval_requested", onApprovalRequested);
    }

    if (processError) {
      throw processError;
    }
    if (!result) {
      throw new Error("Runtime session orchestrator did not return a result.");
    }

    for (const toolExec of result.toolExecutions ?? []) {
      if (!hasLiveToolEvents) {
        const output = toolExec.output ?? toolExec.resultSummary;
        if (toolExec.toolCallId || toolExec.input) {
          yield {
            type: "tool_use",
            toolName: toolExec.toolName,
            input: toolExec.input ?? {},
            ...(toolExec.toolCallId ? { toolCallId: toolExec.toolCallId } : {}),
          };
        }
        yield {
          type: "tool_result",
          toolName: toolExec.toolName,
          output,
          ...(toolExec.resultSummary !== output ? { outputSummary: toolExec.resultSummary } : {}),
          ...(toolExec.toolCallId ? { toolCallId: toolExec.toolCallId } : {}),
          ...(!toolExec.success ? { isError: true } : {}),
        };
      }
      if (toolExec.fileChanges && toolExec.fileChanges.length > 0) {
        for (const fileChange of toolExec.fileChanges) {
          yield { type: "file_changed", path: fileChange.path, changeType: fileChange.changeType };
        }
      }
    }

    for (const part of result.parts) {
      if (part.type === "text") {
        yield { type: "text_delta", content: part.text };
      }
    }

    if (result.escalation) {
      yield {
        type: "error",
        code: "ESCALATION",
        message: result.escalation.reason,
        isRetryable: false,
      };
    }

    this.contextTracker.update(result.inputTokens ?? 0, result.outputTokens ?? 0);
    const executionIdentity = resolveExecutionIdentity({
      configuredProvider: this.config.provider,
      configuredModel: this.resolvedModel,
      configuredBillingMode: resolveProviderDefaultBillingMode(this.config.provider),
      routedProvider: result.routingDecision?.provider,
      routedModel: result.routingDecision?.model,
      routedCanonicalModel: result.routingDecision?.canonicalModel,
      routedBillingMode: result.routingDecision?.billingMode,
    });

    yield {
      type: "cost_update",
      usd: 0,
      mode: "computed",
      provider: executionIdentity?.provider,
      model: executionIdentity?.model,
      canonicalModel: executionIdentity?.canonicalModel,
      billingMode: executionIdentity?.billingMode,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      providerRequests: result.providerRequests,
    };
    yield {
      type: "completed",
      totalUsd: 0,
      durationMs: Date.now() - startedAt,
      outcome: result.outcome,
      isPreflightCrash: false,
    };
  }
}

function formatExecutableSessionError(error: unknown): string {
  if (error instanceof AllCredentialsExhaustedError) {
    return formatCredentialPoolExhaustion(error);
  }
  if (error instanceof KilnError) {
    const status = typeof error.context.status === "number" ? error.context.status : undefined;
    const responseBody = typeof error.context.responseBody === "string"
      ? error.context.responseBody.trim()
      : "";
    const toolReplaySummary = typeof error.context.toolReplaySummary === "string"
      ? error.context.toolReplaySummary.trim()
      : "";
    const suffixParts: string[] = [];
    if (status !== undefined) {
      suffixParts.push(`status ${status}`);
    }
    if (responseBody.length > 0) {
      const compactBody = responseBody.replace(/\s+/g, " ").slice(0, 240);
      suffixParts.push(compactBody);
    }
    if (toolReplaySummary.length > 0) {
      suffixParts.push(toolReplaySummary);
    }
    if (suffixParts.length === 0) {
      return error.message;
    }
    return `${error.message} (${suffixParts.join(": ")})`;
  }
  return formatProviderSessionError(error);
}

function isProviderSessionErrorRetryable(error: unknown): boolean {
  if (error instanceof AllCredentialsExhaustedError) {
    if (error.lastOutcome) {
      return isCredentialOutcomeRetryable(error.lastOutcome);
    }
    return isProviderSessionErrorRetryable(error.cause);
  }
  return error instanceof KilnError && error.retryable;
}

function formatProviderSessionError(error: unknown): string {
  if (error instanceof AllCredentialsExhaustedError) {
    return formatCredentialPoolExhaustion(error);
  }
  return readErrorMessage(error);
}

function formatCredentialPoolExhaustion(error: AllCredentialsExhaustedError): string {
  const details = [
    formatCredentialOutcome(error.lastOutcome),
    formatCredentialCause(error.cause),
  ].filter((detail): detail is string => Boolean(detail));

  if (details.length === 0) {
    return error.message;
  }
  return `${error.message}: ${details.join("; ")}`;
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
      return outcome.message ? `last outcome unknown-error: ${outcome.message}` : "last outcome unknown-error";
    case "ok":
      return "last outcome ok";
  }
}

function formatCredentialCause(cause: unknown): string | undefined {
  if (cause === null || cause === undefined) {
    return undefined;
  }
  return `last error ${readErrorMessage(cause)}`;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
