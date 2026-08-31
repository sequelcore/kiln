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
  type DeliberationResolution,
  type RuntimeTurnTerminalDisposition,
  resolveDirectProviderExecutionProfile,
  type DefaultBuiltinToolRegistryOptions,
  CONSERVATIVE_UNKNOWN_ENVELOPE,
  knownModelCommunicationCapabilities,
  deriveAuthorityFromEffect,
  getBuiltinEffectEnvelope,
  type KilnMcpClient,
  type ResolvedCommunicationIntent,
  type EffectivePromptObservation,
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
  type RuntimeAuthorityAdmissionCandidateConfig,
  type RuntimeSessionTurnBudgetAuthority,
  type RuntimeExecutionEnvelope,
  readExecutionTurnAuthority,
  type OperatorAdoptionRuntimeBinding,
  type EffectiveAuthorityAdmissionBundle,
  assertRuntimeHostToolEnforcement,
  OperatorSessionPreProviderLaunchRejectionError,
  type RuntimeSession,
} from "@kilnai/runtime";
import type { OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import type {
  IKilnSession,
  KilnPermissionPolicy,
  SessionCapabilities,
  SessionRunOptions,
} from "./session.js";
import { buildProviderSystemPrompt, resolveTurnPrompt } from "./preamble-builder.js";
import { PermissionPolicyAuthorizer } from "./permission-policy-authorizer.js";
import { ProviderContextTracker } from "./provider-context.js";
import {
  createDirectProviderAdapter,
  DirectProviderBindingError,
  directProviderExecutionBinding,
} from "./direct-provider-adapter-factory.js";
import type { DirectProviderCredentialBinding } from "./direct-provider-adapter-factory.js";
import type { ConfiguredExecutionCredential } from "@kilnai/runtime";
import type { AttachedRuntimeBuiltinToolSurfaceOptions } from "@kilnai/runtime";
import {
  createRuntimeCapabilityCompositionFactory,
  createTrustedRuntimeBuiltinPortableInvocationPort,
  type RuntimeCapabilityGeneration,
  type RuntimeCapabilityMaterializationRecord,
} from "@kilnai/runtime";
import {
  buildAggregateCapabilityCatalog,
  VERIFICATION_CAPABILITY_IDS,
  type CapabilityCatalogContribution,
  type VerificationCapabilityToolSchema,
} from "@kilnai/core/capabilities";
import { createCliOperatorThemeController } from "../application/operator-theme-preferences.js";
import { assertConfiguredInvocationAdmission } from "../config/builtin-tool-surface-config.js";
import { deriveProjectRuntimeId } from "../application/project-state-root.js";

export interface ProviderSessionConfig {
  readonly provider: DirectProviderId;
  /** Canonical operator Kiln home supplied by CLI composition. */
  readonly kilnHome?: string;
  readonly runtimeSessionId?: string;
  readonly model?: string;
  readonly credentialBinding?: DirectProviderCredentialBinding;
  readonly executionCredential?: ConfiguredExecutionCredential;
  readonly deliberationResolution?: DeliberationResolution;
  readonly communicationIntent?: ResolvedCommunicationIntent;
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
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions & {
    readonly capabilityEvaluatedAt?: string;
    readonly capabilityContributions?: readonly CapabilityCatalogContribution[];
    readonly capabilityToolSchemas?: readonly VerificationCapabilityToolSchema[];
  };
  /** Explicit surface ownership required before this wrapper may prepare a capability generation. */
  readonly capabilityComposition?: {
    readonly appId: string;
    readonly surfaceId: string;
  };
  readonly managedInvocation?: ManagedInvocationToolAttachment;
  readonly boundedWork?: AttachedRuntimeBuiltinToolSurfaceOptions["boundedWork"];
  readonly runtimeExecutionMode?: "execute" | "plan";
  readonly sessionTurnBudget?: RuntimeSessionTurnBudgetAuthority;
  readonly executionEnvelope?: RuntimeExecutionEnvelope;
  readonly mcpClients?: readonly KilnMcpClient[];
  readonly mcpToolAllowlist?: ReadonlySet<string>;
  /** Durable transcript sink and canonical replay binding for this surface. */
  readonly operatorAdoption?: OperatorAdoptionRuntimeBinding;
  /** Runtime-composed authority and its exact prepared execution resources. */
  readonly authorityAdmissionContext?: {
    readonly bundle: EffectiveAuthorityAdmissionBundle;
    readonly runtimeSession: RuntimeSession;
    readonly builtinToolSurface: ReturnType<typeof createAttachedRuntimeBuiltinToolSurface>;
    readonly mcpClients: readonly KilnMcpClient[];
    readonly mcpCapabilities: readonly Capability[];
    readonly capabilityGeneration?: RuntimeCapabilityGeneration;
    readonly perCallConfig: PerCallToolConfig;
  };
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

/**
 * Managed invocation delegation tools whose destructiveness is in the child,
 * not the parent. These are admitted under read_only authority because the
 * child's authority is bounded by the caller-capability policy and the
 * executor's resolveManagedInvocationRequestedAuthority.
 *
 * managed_agent.cancel is NOT in this set — cancel modifies local state
 * directly (stops a running agent) and is not a delegation tool.
 */
const MANAGED_DELEGATION_TOOL_NAMES = new Set([
  "managed_agent.invoke",
  "managed_agent.start",
  "managed_agent.orchestrate",
]);

function communicationPerCallProjection(
  provider: string,
  model: string | undefined,
  communicationIntent: ResolvedCommunicationIntent | undefined,
): Partial<Pick<PerCallToolConfig, "communicationIntent" | "modelRoutingPolicy">> {
  if (!communicationIntent) return {};
  if (!model) throw new Error("Communication intent requires an admitted model identity.");
  const communication = knownModelCommunicationCapabilities(provider, model);
  return {
    communicationIntent,
    ...(communication
      ? { modelRoutingPolicy: { routeCapabilities: new Map([[`${provider}/${model}`, { communication }]]) } }
      : {}),
  };
}

function isDelegatableManagedInvocationTool(toolName: string): boolean {
  return MANAGED_DELEGATION_TOOL_NAMES.has(toolName);
}

function resolveExecutionMode(config: ProviderSessionConfig): DirectProviderExecutionMode {
  const profile = resolveProfile(config);
  return profile?.executionMode ?? "text-only";
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
    toolCallScopeId: event.toolCallScopeId,
    ...(isMcp ? { source: "mcp" as const, mcpSelector: event.toolName } : {}),
  };
}

function toolOutputToSessionEvent(event: ToolOutputEvent): Extract<ExecutionSessionEvent, { type: "tool_output_delta" }> {
  return {
    type: "tool_output_delta",
    toolCallId: event.toolCallId,
    toolCallScopeId: event.toolCallScopeId,
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
    toolCallScopeId: event.toolCallScopeId,
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
  readonly config: ProviderSessionConfig;
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
  private _communicationResolution: import("@kilnai/core").CommunicationResolution | undefined;
  private _effectivePromptObservation: EffectivePromptObservation | undefined;
  private _runtimeModelRoundClaimed = false;
  private _runtimeModelRoundOutcome: "unknown" | undefined;
  private readonly builtinToolSurface: ReturnType<typeof createAttachedRuntimeBuiltinToolSurface>;
  private readonly capabilityGeneration?: RuntimeCapabilityGeneration;
  private disposePromise?: Promise<void>;

  constructor(config: ProviderSessionConfig) {
    // Canonical authority admission owns the one pre-fence budget decision.
    // Keep the source out of this wrapper for both text-only and executable
    // sessions so the provider cannot admit the same turn a second time.
    if (config.authorityAdmissionContext && config.sessionTurnBudget) {
      const { sessionTurnBudget: _sessionTurnBudget, ...withoutSessionTurnBudget } = config;
      this.config = withoutSessionTurnBudget;
      config = this.config;
    } else {
      this.config = config;
    }
    this.sessionId = config.runtimeSessionId ?? randomUUID();
    this.executionProfile = resolveProfile(config);
    this.executionMode = this.executionProfile?.executionMode ?? "text-only";
    this.resolvedModel = this.executionProfile?.model ?? config.model;
    this.contextTracker = new ProviderContextTracker({
      maxContextTokens: 128000,
      compactionThreshold: 0.85,
    });
    const operatorSurface = config.operatorSurface ?? {
      theme: createCliOperatorThemeController(config.cwd ?? process.cwd()),
    };
    const builtinToolSurface = config.authorityAdmissionContext?.builtinToolSurface ?? createAttachedRuntimeBuiltinToolSurface({
      operatorSurface,
      builtinToolOptions: config.builtinToolOptions,
      managedInvocation: config.managedInvocation,
      boundedWork: config.boundedWork,
      executionMode: config.runtimeExecutionMode ?? "execute",
    });
    this.builtinToolSurface = builtinToolSurface;
    this.builtinTools = builtinToolSurface.callBuiltinTools;
    this.toolDefinitions = builtinToolSurface.toolDefinitions;
    this.materializableTools = builtinToolSurface.materializableTools;
    this.capabilityMap = new Map([
      ...builtinToolSurface.materializableCapabilities,
      ...builtinToolSurface.capabilities,
    ]);
    this.capabilityGeneration = config.authorityAdmissionContext?.capabilityGeneration
      ?? createConfiguredCapabilityGeneration(config, builtinToolSurface);
    this.eventBus = new EventBus(100);
    this._capabilities = deriveCapabilities(
      config,
      builtinToolSurface.toolDefinitions,
      this.materializableTools,
    );
  }

  get authorityCapabilityGeneration(): RuntimeCapabilityGeneration | undefined {
    return this.capabilityGeneration;
  }

  /** Exposes the canonical per-call projection for the admission composition owner. */
  buildAuthorityPerCallConfig(input: {
    readonly deliberationResolution?: DeliberationResolution;
    readonly communicationIntent?: ResolvedCommunicationIntent;
    readonly requestedAuthority?: OperatorTurnRequestedAuthority;
    readonly abortSignal?: AbortSignal;
    readonly turnId?: string;
    readonly workingDirectory?: string;
    readonly toolSandbox?: unknown;
    readonly externalTools?: readonly ToolDefinition[];
    readonly externalCapabilities?: ReadonlyMap<string, Capability>;
  }): RuntimeAuthorityAdmissionCandidateConfig {
    return this.buildPerCallConfig(
      input.deliberationResolution,
      input.communicationIntent,
      input.requestedAuthority,
      input.abortSignal,
      input.turnId,
      input.workingDirectory,
      input.toolSandbox,
      input.externalTools ?? [],
      input.externalCapabilities ?? new Map(),
    );
  }

  get capabilities(): SessionCapabilities {
    return this._capabilities;
  }

  get authorityBuiltinToolSurface(): ReturnType<typeof createAttachedRuntimeBuiltinToolSurface> {
    return this.builtinToolSurface;
  }

  get providerSessionId(): string | undefined {
    return undefined;
  }

  get communicationResolution(): import("@kilnai/core").CommunicationResolution | undefined {
    return this._communicationResolution;
  }

  get effectivePromptObservation(): EffectivePromptObservation | undefined {
    return this._effectivePromptObservation;
  }

  get runtimeModelRoundClaimed(): boolean {
    return this._runtimeModelRoundClaimed;
  }

  get runtimeModelRoundOutcome(): "unknown" | undefined {
    return this._runtimeModelRoundOutcome;
  }

  async *run(options: SessionRunOptions): AsyncIterable<ExecutionSessionEvent> {
    const startedAt = Date.now();
    this._runtimeModelRoundClaimed = false;
    this._runtimeModelRoundOutcome = undefined;

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
        disposition: cancelledDisposition("operator_cancelled"),
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
          disposition: runtimeFailureDisposition(),
          isPreflightCrash: false,
        };
        return;
      }
      yield* this.runTextOnly(options, startedAt);
    } catch (err) {
      if (isRuntimeModelRoundCommittedError(err)) {
        this._runtimeModelRoundOutcome = "unknown";
      }
      const modelRoundState = this.config.authorityAdmissionContext?.perCallConfig?.runtimeModelRoundDispatch?.state;
      this._runtimeModelRoundClaimed = modelRoundState?.claimed === true;
      if (modelRoundState?.outcome === "unknown") {
        this._runtimeModelRoundOutcome = "unknown";
      }
      const code = this.executionMode === "kiln-executable"
        ? "EXECUTABLE_SESSION_ERROR"
        : "PROVIDER_SESSION_ERROR";
      const message = this.executionMode === "kiln-executable"
        ? formatExecutableSessionError(err)
        : formatProviderSessionError(err);
      yield {
        type: "error",
        code,
        message,
        isRetryable: isProviderSessionErrorRetryable(err),
        ...(err instanceof DirectProviderBindingError ? { executionBinding: err.evidence } : {}),
      };
      yield {
        type: "completed",
        totalUsd: 0,
        durationMs: Date.now() - startedAt,
        disposition: options.abortSignal?.aborted
          ? cancelledDisposition("operator_cancelled")
          : runtimeFailureDisposition(),
        isPreflightCrash: false,
      };
    } finally {
      // `runSession` can intentionally abandon this iterator after a denied
      // live tool event. Async delegation closes the inner Runtime iterator
      // first; publish its durable claim outcome before fallback is decided.
      const modelRoundState = this.config.authorityAdmissionContext?.perCallConfig?.runtimeModelRoundDispatch?.state;
      if (modelRoundState !== undefined) {
        this.syncRuntimeModelRoundState(modelRoundState);
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposePromise ??= this.builtinToolSurface.dispose()
      .then(() => Promise.all((this.config.mcpClients ?? []).map((client) => client.disconnect())))
      .then(() => undefined);
    await this.disposePromise;
  }

  private async checkProviderBudget(): Promise<string | undefined> {
    const sessionTurnBudget = this.config.sessionTurnBudget;
    if (!sessionTurnBudget) {
      return undefined;
    }
    try {
      const admission = await sessionTurnBudget.admit(this.sessionId);
      if (admission.status === "admitted") {
        return undefined;
      }
      return admission.message ?? `Session token budget denied: ${admission.reason}.`;
    } catch (error) {
      return `Session token budget observation failed: ${readErrorMessage(error)}`;
    }
  }

  private buildSystemAndPrompt(
    options: SessionRunOptions,
    effectiveTurnAuthority?: RuntimeAuthorityAdmissionCandidateConfig["effectiveTurnAuthority"],
  ): {
    readonly systemPrompt: string;
    readonly userPrompt: string;
  } {
    const { systemPrompt: baseSystemPrompt, userPrompt } = resolveTurnPrompt({
      prompt: options.prompt,
      promptKind: options.promptKind,
      task: this.config.task,
      fallbackSystemPrompt: this.config.systemPrompt ?? "",
      explicitSystem: options.system,
    });
    const requestedAuthority = options.requestedAuthority ?? this.config.requestedAuthority ?? "auto";
    const runtimeExecutionMode = this.config.runtimeExecutionMode ?? "execute";
    const systemPrompt = appendExecutionIdentity(
      buildProviderSystemPrompt(
        baseSystemPrompt,
        this.config.constraintInstructions,
        {
          executionMode: this.executionMode,
          authorityGuidance: formatEffectiveTurnAuthorityGuidance(describeEffectiveTurnAuthorityActionability({
            authority: effectiveTurnAuthority,
            executionMode: runtimeExecutionMode,
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
    // Text-only direct providers still execute inside the Runtime boundary.
    // Give Runtime an empty admitted tool surface so it owns completion
    // obligations and convergence even when the selected adapter cannot run
    // tools. This also keeps the provider result and terminal evidence in one
    // canonical path.
    yield* this.runKilnExecutable(options, startedAt, "text-only");
  }

  private syncRuntimeModelRoundState(
    state: NonNullable<PerCallToolConfig["runtimeModelRoundDispatch"]>["state"],
  ): void {
    // Projection is monotonic within one run. A committed-error catch may
    // conservatively derive unknown when durable settlement itself failed;
    // an incomplete shared-state write must never erase that evidence.
    if (state?.claimed === true) this._runtimeModelRoundClaimed = true;
    if (state?.outcome === "unknown") this._runtimeModelRoundOutcome = "unknown";
  }

  private buildPerCallConfig(
    deliberationResolution: DeliberationResolution | undefined,
    communicationIntent: ResolvedCommunicationIntent | undefined,
    requestedAuthority: OperatorTurnRequestedAuthority | undefined,
    abortSignal: AbortSignal | undefined,
    turnId: string | undefined,
    workingDirectory: string | undefined,
    toolSandbox: unknown,
    externalTools: readonly ToolDefinition[] = [],
    externalCapabilities: ReadonlyMap<string, Capability> = new Map(),
  ): RuntimeAuthorityAdmissionCandidateConfig {
    const runtimeExecutionMode = this.config.runtimeExecutionMode ?? "execute";
    const effectiveRequestedAuthority = runtimeExecutionMode === "plan" ? "read_only" : requestedAuthority;
    const combinedToolDefinitions = [...this.toolDefinitions, ...externalTools];
    const combinedCapabilities = new Map([...this.capabilityMap, ...externalCapabilities]);
    if (!effectiveRequestedAuthority || effectiveRequestedAuthority === "auto") {
      const admittedToolNames = new Set(this.materializableTools.keys());
      for (const tool of externalTools) {
        if (!this.config.mcpToolAllowlist || this.config.mcpToolAllowlist.has(tool.name)) {
          admittedToolNames.add(tool.name);
        }
      }
      return {
        ...(turnId ? { turnId } : {}),
        ...(deliberationResolution ? { deliberationResolution } : {}),
        ...communicationPerCallProjection(this.config.provider, this.resolvedModel, communicationIntent),
        ...(abortSignal ? { abortSignal } : {}),
        ...(workingDirectory ? { workingDirectory } : {}),
        ...(toolSandbox !== undefined ? { sandbox: toolSandbox } : {}),
        ...(this.builtinToolSurface.toolInvocationAdmission
          ? { toolInvocationAdmission: this.builtinToolSurface.toolInvocationAdmission }
          : {}),
        toolAllowlist: admittedToolNames,
        additionalTools: combinedToolDefinitions.filter((tool) => admittedToolNames.has(tool.name)),
        perCallCapabilities: filterCapabilityMap(combinedCapabilities, admittedToolNames),
        ...(effectiveRequestedAuthority ? {
          effectiveTurnAuthority: {
            executionMode: runtimeExecutionMode,
            requestedAuthority: effectiveRequestedAuthority,
            admittedAuthority: "unknown",
            sourcePolicy: "runtime_surface_projection",
            reason: "cli direct-provider requested turn authority",
            completeness: "partial",
            toolCount: admittedToolNames.size,
            deniedToolCount: 0,
            policyInputs: buildEffectiveTurnAuthorityPolicyInputs({
              executionMode: runtimeExecutionMode,
              requestedAuthority: effectiveRequestedAuthority,
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
      if (effectiveRequestedAuthority === "read_only") {
        // Managed delegation tools (invoke/start/orchestrate) are admitted
        // under read_only even though their effect envelope is destructive,
        // because the actual mutating work is delegated to the child agent.
        // The child's authority is bounded against the parent's by the
        // caller-capability policy at execution time.
        // managed_agent.cancel is NOT a delegation tool — it modifies local
        // state directly (stops a running agent) and is denied under read_only.
        if ((authority.allowed && !authority.requiresApproval && isReadOnlyCapability(tool.name, capability) && authority.level <= 1)
          || isDelegatableManagedInvocationTool(tool.name)) {
          admittedToolNames.add(tool.name);
          toolAuthority.set(tool.name, authority);
        }
        continue;
      }
      if (effectiveRequestedAuthority === "destructive" && capability) {
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

    const admittedAuthority = admittedToolNames.size === 0 ? "fail_closed" : effectiveRequestedAuthority;
    return {
      ...(turnId ? { turnId } : {}),
      ...(deliberationResolution ? { deliberationResolution } : {}),
      ...communicationPerCallProjection(this.config.provider, this.resolvedModel, communicationIntent),
      ...(abortSignal ? { abortSignal } : {}),
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(toolSandbox !== undefined ? { sandbox: toolSandbox } : {}),
      ...(this.builtinToolSurface.toolInvocationAdmission
        ? { toolInvocationAdmission: this.builtinToolSurface.toolInvocationAdmission }
        : {}),
      toolAllowlist: admittedToolNames,
      toolAuthority,
      additionalTools: combinedToolDefinitions.filter((tool) => admittedToolNames.has(tool.name)),
      perCallCapabilities: filterCapabilityMap(combinedCapabilities, admittedToolNames),
      effectiveTurnAuthority: {
        executionMode: runtimeExecutionMode,
        requestedAuthority: effectiveRequestedAuthority,
        admittedAuthority,
        sourcePolicy: "runtime_surface_projection",
        reason: "cli direct-provider requested turn authority",
        completeness: "authoritative",
        toolCount: admittedToolNames.size,
        deniedToolCount: Math.max(0, candidateTools.size - admittedToolNames.size),
        policyInputs: buildEffectiveTurnAuthorityPolicyInputs({
          executionMode: runtimeExecutionMode,
          requestedAuthority: effectiveRequestedAuthority,
          admittedAuthority,
          routeReason: "cli direct-provider requested turn authority",
        }),
      },
    };
  }

  private async *runKilnExecutable(
    options: SessionRunOptions,
    startedAt: number,
    executionSurface: "kiln-executable" | "text-only" = "kiln-executable",
  ): AsyncIterable<ExecutionSessionEvent> {
    const { RuntimeSessionOrchestrator } = await import("@kilnai/runtime");
    const isTextOnly = executionSurface === "text-only";

    const authorityAdmissionContext = this.config.authorityAdmissionContext;
    if (!authorityAdmissionContext) {
      throw new Error("Direct provider execution requires a canonical Runtime authority admission context.");
    }
    const perCallConfig = authorityAdmissionContext.perCallConfig;
    if (!perCallConfig
      || !perCallConfig.authorityAdmission
      || perCallConfig.authorityAdmission !== authorityAdmissionContext.bundle) {
      throw new Error("Direct provider execution requires the exact persisted Runtime authority admission bundle.");
    }
    if (!perCallConfig.runtimeModelRoundDispatch) {
      throw new Error("Authority-admitted provider sessions require a durable Runtime model-round claim.");
    }
    if (!isTextOnly && perCallConfig.authorityAdmission.turn.tools.hostEnforcement) {
      if (options.toolSandbox !== perCallConfig.sandbox) {
        throw new OperatorSessionPreProviderLaunchRejectionError(
          "Direct provider execution received a tool sandbox different from its admitted host capability.",
        );
      }
      try {
        assertConfiguredInvocationAdmission(perCallConfig.toolInvocationAdmission, this.config.permissionPolicy);
        assertRuntimeHostToolEnforcement(perCallConfig.runtimeHostToolEnforcement, {
          bundle: perCallConfig.authorityAdmission,
          sandbox: perCallConfig.sandbox,
          invocationAdmission: perCallConfig.toolInvocationAdmission,
        });
      } catch (error) {
        throw new OperatorSessionPreProviderLaunchRejectionError(
          `Direct provider host enforcement rejected before launch: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const mcpCapabilities = isTextOnly ? [] : authorityAdmissionContext.mcpCapabilities;
    const externalTools: ToolDefinition[] = mcpCapabilities.map((capability) => ({
      name: capability.name,
      description: capability.description,
      inputSchema: capability.schema,
      tags: new Set(capability.tags),
      ...(capability.effectEnvelope ? { effectEnvelope: capability.effectEnvelope } : {}),
    }));
    const externalCapabilityMap = new Map(mcpCapabilities.map((capability) => [capability.name, capability]));
    const { userPrompt } = this.buildSystemAndPrompt(
      options,
      readExecutionTurnAuthority(perCallConfig),
    );
    const adapter = await createDirectProviderAdapter({
      provider: this.config.provider,
      model: this.resolvedModel,
      kilnHome: this.config.kilnHome,
      credentialBinding: this.config.credentialBinding,
      executionCredential: this.config.executionCredential,
      configEnv: this.config.env,
      runtimeEnv: options.env,
    });
    const executionBinding = directProviderExecutionBinding(adapter);
    if (executionBinding) {
      yield {
        type: "cost_update",
        usd: 0,
        mode: "computed",
        provider: this.config.provider,
        model: this.resolvedModel,
        canonicalModel: this.resolvedModel,
        billingMode: resolveProviderDefaultBillingMode(this.config.provider),
        executionBinding,
      };
    }
    const authorizer = new PermissionPolicyAuthorizer(this.config.permissionPolicy);

    const cliSession = authorityAdmissionContext.runtimeSession;

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: adapter,
      model: this.resolvedModel,
      tools: isTextOnly ? [] : [...this.toolDefinitions, ...externalTools],
      materializableTools: isTextOnly ? new Map() : this.materializableTools,
      builtinTools: isTextOnly ? new Map() : this.builtinTools,
      eventBus: this.eventBus,
      toolAuthorizer: authorizer,
      capabilityMap: isTextOnly ? new Map() : new Map([...this.capabilityMap, ...externalCapabilityMap]),
      ...(!isTextOnly && this.capabilityGeneration ? { capabilityGeneration: this.capabilityGeneration } : {}),
      ...(!isTextOnly && this.config.mcpClients && this.config.mcpClients.length > 0
        ? { mcpClients: this.config.mcpClients }
        : {}),
      dangerousCommandDetector: undefined,
      // Canonical direct dispatch admits the session budget in Runtime before
      // credential resolution; forwarding the authority's source here would
      // perform a second, post-fence budget admission.
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

    const executionAbortController = new AbortController();
    const abortExecutableTurn = (): void => {
      if (!executionAbortController.signal.aborted) {
        executionAbortController.abort(options.abortSignal?.reason ?? new Error("Executable provider session was cancelled."));
      }
    };
    if (options.abortSignal?.aborted) abortExecutableTurn();
    else options.abortSignal?.addEventListener("abort", abortExecutableTurn, { once: true });
    const communicationIntent = options.communicationIntent ?? this.config.communicationIntent;
    const deliberationResolution = options.deliberationResolution ?? this.config.deliberationResolution;
    const executablePerCallConfig = {
      ...perCallConfig,
      ...(deliberationResolution ? { deliberationResolution } : {}),
      ...(communicationIntent ? { communicationIntent } : {}),
      ...(isTextOnly
        ? {
            // The text-only surface is intentionally empty. Keep the
            // admission projection supplied to Runtime from reintroducing
            // provider tools through additionalTools or capability maps.
            additionalTools: [],
            perCallCapabilities: new Map(),
            toolAuthority: new Map(),
          }
        : {}),
      abortSignal: executionAbortController.signal,
    };
    let result: OrchestrateResult | undefined;
    let processError: unknown;
    let processSettled = false;
    const processPromise = orchestrator.processMessage(
      cliSession,
      promptParts,
      undefined,
      undefined,
      executablePerCallConfig,
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
      if (!processSettled) {
        executionAbortController.abort(new Error("Executable provider session consumer stopped before terminal settlement."));
      }
      // Do not let caller teardown race a still-running Runtime turn. The
      // composed abort signal closes provider/tool work, then this join makes
      // the shared claim outcome authoritative before outer projection.
      await processPromise;
      options.abortSignal?.removeEventListener("abort", abortExecutableTurn);
      this.eventBus.off("tool_called", onToolCalled);
      this.eventBus.off("tool_output", onToolOutput);
      this.eventBus.off("tool_result", onToolResult);
      this.eventBus.off("approval_requested", onApprovalRequested);
    }

    if (processError) {
      const state = perCallConfig.runtimeModelRoundDispatch?.state;
      this.syncRuntimeModelRoundState(state);
      throw processError;
    }
    if (!result) {
      throw new Error("Runtime session orchestrator did not return a result.");
    }
    const state = perCallConfig.runtimeModelRoundDispatch?.state;
    this.syncRuntimeModelRoundState(state);
    this._communicationResolution = result.communicationResolution;

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
      disposition: projectRuntimeTerminalDisposition(result),
      isPreflightCrash: false,
    };
  }
}

function createConfiguredCapabilityGeneration(
  config: ProviderSessionConfig,
  surface: ReturnType<typeof createAttachedRuntimeBuiltinToolSurface>,
): RuntimeCapabilityGeneration | undefined {
  const contributions = config.builtinToolOptions?.capabilityContributions;
  const evaluatedAt = config.builtinToolOptions?.capabilityEvaluatedAt;
  const composition = config.capabilityComposition;
  const toolSchemas = config.builtinToolOptions?.capabilityToolSchemas;
  if (!contributions || contributions.length === 0 || !evaluatedAt || !composition || !toolSchemas) return undefined;
  const tools = new Map<string, ToolDefinition>([
    ...surface.toolDefinitions.map((tool) => [tool.name, tool] as const),
    ...surface.materializableTools,
  ]);
  const materializations: RuntimeCapabilityMaterializationRecord[] = [];
  const verificationNames = Object.entries(VERIFICATION_CAPABILITY_IDS) as readonly (readonly [string, string])[];
  const catalog = buildAggregateCapabilityCatalog(contributions, evaluatedAt);
  for (const descriptor of catalog.descriptors) {
    const capabilityId = descriptor.capabilityId;
    const toolName = verificationNames.find(([, id]) => id === capabilityId)?.[0];
    if (!toolName) continue;
    const tool = tools.get(toolName);
    const schemas = toolSchemas.find((candidate) =>
      candidate.capabilityId === capabilityId
      && candidate.revision === descriptor.revision
      && candidate.toolName === toolName);
    const executor = surface.callBuiltinTools.get(toolName);
    const implementationReference = descriptor.implementationReferences.find(
      (candidate) => candidate.identityDigest === schemas?.implementationIdentityDigest,
    );
    if (!tool || !schemas || !executor || !implementationReference) continue;
    const materializedTool: ToolDefinition = {
      ...tool,
      inputSchema: { ...schemas.inputSchema },
      outputSchema: { ...schemas.outputSchema },
    };
    materializations.push({
      capabilityId,
      revision: descriptor.revision,
      descriptorDigest: descriptor.descriptorDigest,
      inputSchemaDigest: descriptor.inputSchemaDigest,
      outputSchemaDigest: descriptor.outputSchemaDigest,
      implementationIdentityDigest: implementationReference.identityDigest,
      implementationReference,
      toolName,
      tool: materializedTool,
      port: createTrustedRuntimeBuiltinPortableInvocationPort({
        executor: async (input, context) => normalizeCapabilityToolResult(await executor(input, context)),
        kind: toolName === "quality_analyze" ? "local-function" : "cli",
        implementationIdentityDigest: implementationReference.identityDigest,
      }),
      requirements: { data: descriptor.data, network: descriptor.network, artifacts: descriptor.artifacts },
      freshness: descriptor.freshness,
    });
  }
  if (materializations.length === 0) return undefined;
  return createRuntimeCapabilityCompositionFactory({
    contributions,
    evaluatedAt,
    projectId: deriveProjectRuntimeId(config.cwd ?? process.cwd()),
    appId: composition.appId,
    surfaceId: composition.surfaceId,
    caller: "kiln-runtime",
    materializations,
  }).prepare();
}

function normalizeCapabilityToolResult(value: unknown): {
  readonly output: string;
  readonly isError: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
} {
  if (value && typeof value === "object" && "output" in value && typeof value.output === "string") {
    const metadata = "metadata" in value && value.metadata && typeof value.metadata === "object"
      ? value.metadata as Readonly<Record<string, unknown>>
      : undefined;
    return {
      output: value.output,
      isError: "isError" in value && value.isError === true,
      ...(metadata === undefined ? {} : { metadata }),
    };
  }
  return { output: typeof value === "string" ? value : JSON.stringify(value), isError: false };
}

function projectRuntimeTerminalDisposition(result: OrchestrateResult): RuntimeTurnTerminalDisposition {
  return {
    outcome: result.outcome,
    dispositionReason: result.dispositionReason,
    ...("completion" in result ? { completion: result.completion } : {}),
    ...("convergence" in result ? { convergence: result.convergence } : {}),
  } as RuntimeTurnTerminalDisposition;
}

function runtimeFailureDisposition(): Extract<
  RuntimeTurnTerminalDisposition,
  { readonly dispositionReason: "runtime_failure" }
> {
  return { outcome: "failed", dispositionReason: "runtime_failure" };
}

function cancelledDisposition(
  reason: "operator_cancelled" | "runtime_cancelled",
): Extract<RuntimeTurnTerminalDisposition, { readonly dispositionReason: "operator_cancelled" | "runtime_cancelled" }> {
  return { outcome: "cancelled", dispositionReason: reason };
}

function isRuntimeModelRoundCommittedError(error: unknown): error is Error {
  return error instanceof Error && error.name === "RuntimeModelRoundCommittedError";
}

function formatExecutableSessionError(error: unknown): string {
  if (isRuntimeModelRoundCommittedError(error) && error.cause !== undefined) {
    return `${error.message} Cause: ${formatExecutableSessionError(error.cause)}`;
  }
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
