import { randomUUID } from "node:crypto";
import {
  AnthropicAdapter,
  CodexOAuthAdapter,
  CodexOAuthAuth,
  DeepSeekAdapter,
  EventBus,
  KilnError,
  appendExecutionIdentity,
  type ContentPart,
  OpenAIAdapter,
  OpenRouterAdapter,
  OllamaAdapter,
  createDefaultBuiltinTools,
  getDirectProviderExecutionProfile,
  projectDevToolCapabilities,
  projectDevToolDefinitions,
  resolveExecutionIdentity,
  textPart,
  type AgentMessage,
  type DirectProviderExecutionMode,
  type DirectProviderId,
  type ToolDefinition,
  type ProviderAdapter,
} from "@kilnai/core";
import type { OrchestrateResult } from "@kilnai/runtime";
import type {
  IKilnSession,
  KilnPermissionPolicy,
  SessionCapabilities,
  SessionEvent,
  SessionRunOptions,
} from "./session.js";
import { buildProviderSystemPrompt } from "./preamble-builder.js";
import { PermissionPolicyAuthorizer } from "./permission-policy-authorizer.js";
import { ProviderContextTracker } from "./provider-context.js";

export interface ProviderSessionConfig {
  readonly provider: DirectProviderId;
  readonly model?: string;
  readonly task: string;
  readonly systemPrompt?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly permissionPolicy: KilnPermissionPolicy;
  readonly constraintInstructions?: readonly string[];
  readonly executionMode?: DirectProviderExecutionMode;
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
};

const DEFAULT_BUILTIN_TOOL_NAMES = Object.freeze(
  createDefaultBuiltinTools().map((tool) => tool.name),
);

function getDefaultBillingMode(
  provider: ProviderSessionConfig["provider"],
): "metered" | "free" | "subscription" {
  const profile = getDirectProviderExecutionProfile(provider);
  if (
    profile?.defaultBillingMode === "metered"
    || profile?.defaultBillingMode === "free"
    || profile?.defaultBillingMode === "subscription"
  ) {
    return profile.defaultBillingMode;
  }
  return provider === "ollama" ? "free" : "metered";
}

function buildBuiltinToolExecutors(
  tools: readonly ReturnType<typeof createDefaultBuiltinTools>[number][],
): Map<string, (input: Record<string, unknown>) => Promise<unknown>> {
  const executors = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  for (const tool of tools) {
    executors.set(tool.name, async (input: Record<string, unknown>) => {
      const result = await tool.execute({ name: tool.name, input });
      return { output: result.output, isError: result.isError, metadata: result.metadata };
    });
  }
  return executors;
}

function resolveExecutionMode(config: ProviderSessionConfig): DirectProviderExecutionMode {
  if (config.executionMode) {
    return config.executionMode;
  }
  const profile = getDirectProviderExecutionProfile(config.provider);
  return profile?.defaultExecutionMode ?? "text-only";
}

function deriveCapabilities(config: ProviderSessionConfig): SessionCapabilities {
  const executionMode = resolveExecutionMode(config);
  const supportedTools = executionMode === "kiln-executable"
    ? [...DEFAULT_BUILTIN_TOOL_NAMES]
    : [];
  return {
    mcp: false,
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
  private readonly executionMode: DirectProviderExecutionMode;
  private readonly contextTracker: ProviderContextTracker;
  private readonly builtinTools: Map<string, (input: Record<string, unknown>) => Promise<unknown>>;
  private readonly toolDefinitions: readonly ToolDefinition[];
  private readonly capabilityMap: ReturnType<typeof projectDevToolCapabilities>;
  private readonly eventBus: EventBus;

  constructor(readonly config: ProviderSessionConfig) {
    this.sessionId = randomUUID();
    this.executionMode = resolveExecutionMode(config);
    this.contextTracker = new ProviderContextTracker({
      maxContextTokens: 128000,
      compactionThreshold: 0.85,
    });
    const builtinTools = createDefaultBuiltinTools();
    this.builtinTools = buildBuiltinToolExecutors(builtinTools);
    this.toolDefinitions = projectDevToolDefinitions(builtinTools);
    this.capabilityMap = projectDevToolCapabilities(builtinTools);
    this.eventBus = new EventBus(100);
    this._capabilities = deriveCapabilities(config);
  }

  get capabilities(): SessionCapabilities {
    return this._capabilities;
  }

  get providerSessionId(): string | undefined {
    return undefined;
  }

  async *run(options: SessionRunOptions): AsyncIterable<SessionEvent> {
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
        isError: true,
        isPreflightCrash: true,
      };
      return;
    }

    try {
      if (this.executionMode === "kiln-executable") {
        yield* this.runKilnExecutable(options, startedAt);
        return;
      }
      yield* this.runTextOnly(options, startedAt);
    } catch (err) {
      const code = this.executionMode === "kiln-executable"
        ? "EXECUTABLE_SESSION_ERROR"
        : "PROVIDER_SESSION_ERROR";
      const message = this.executionMode === "kiln-executable"
        ? formatExecutableSessionError(err)
        : (err instanceof Error ? err.message : String(err));
      yield { type: "error", code, message, isRetryable: false };
      yield { type: "completed", totalUsd: 0, durationMs: Date.now() - startedAt, isError: true, isPreflightCrash: false };
    }
  }

  async dispose(): Promise<void> {
    // Stateless direct-provider session; no process/socket lifecycle to tear down.
  }

  private resolveEnv(name: string, runtimeEnv?: Record<string, string>): string | undefined {
    return runtimeEnv?.[name] ?? this.config.env?.[name] ?? process.env[name];
  }

  private createAdapter(runtimeEnv?: Record<string, string>): ProviderAdapter {
    const provider = this.config.provider;
    if (provider === "codex-oauth") {
      const auth = new CodexOAuthAuth();
      return new CodexOAuthAdapter({ auth, defaultModel: this.config.model });
    }
    if (provider === "anthropic") {
      const apiKey = this.resolveRequiredApiKey("ANTHROPIC_API_KEY", runtimeEnv);
      return new AnthropicAdapter({ apiKey, defaultModel: this.config.model });
    }
    if (provider === "openai") {
      const apiKey = this.resolveRequiredApiKey("OPENAI_API_KEY", runtimeEnv);
      return new OpenAIAdapter({ apiKey, defaultModel: this.config.model });
    }
    if (provider === "deepseek") {
      const apiKey = this.resolveRequiredApiKey("DEEPSEEK_API_KEY", runtimeEnv);
      return new DeepSeekAdapter({ apiKey, defaultModel: this.config.model });
    }
    if (provider === "openrouter") {
      const apiKey = this.resolveRequiredApiKey("OPENROUTER_API_KEY", runtimeEnv);
      const appUrl = this.resolveEnv("OPENROUTER_APP_URL", runtimeEnv);
      const appName = this.resolveEnv("OPENROUTER_APP_NAME", runtimeEnv);
      return new OpenRouterAdapter({
        apiKey,
        defaultModel: this.config.model,
        appUrl,
        appName,
      });
    }

    const baseUrl = this.resolveEnv("OLLAMA_BASE_URL", runtimeEnv);
    return new OllamaAdapter({
      baseUrl,
      defaultModel: this.config.model,
    });
  }

  private resolveRequiredApiKey(name: string, runtimeEnv?: Record<string, string>): string {
    const apiKey = this.resolveEnv(name, runtimeEnv);
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(`Missing required API key: ${name}`);
    }
    return apiKey;
  }

  private isStructuredPreamble(prompt: string): boolean {
    return prompt.trimStart().startsWith("<kiln-preamble>");
  }

  private buildSystemAndPrompt(options: SessionRunOptions): {
    readonly systemPrompt: string;
    readonly userPrompt: string;
  } {
    const hasStructuredPreamble = this.isStructuredPreamble(options.prompt);
    const baseSystemPrompt = options.system ?? (hasStructuredPreamble ? options.prompt : (this.config.systemPrompt ?? ""));
    const userPrompt = hasStructuredPreamble ? this.config.task : options.prompt;
    const systemPrompt = appendExecutionIdentity(
      buildProviderSystemPrompt(
        baseSystemPrompt,
        this.config.constraintInstructions,
        { executionMode: this.executionMode },
      ),
      resolveExecutionIdentity({
        configuredProvider: this.config.provider,
        configuredModel: this.config.model,
        configuredBillingMode: getDefaultBillingMode(this.config.provider),
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

  private async *runTextOnly(options: SessionRunOptions, startedAt: number): AsyncIterable<SessionEvent> {
    let isError = false;
    const adapter = this.createAdapter(options.env);
    const { systemPrompt, userPrompt } = this.buildSystemAndPrompt(options);
    const messages = this.buildConversationMessages(userPrompt, options.messages);

    for await (const event of adapter.streamMessage({ system: systemPrompt, messages })) {
      if (options.abortSignal?.aborted) {
        isError = true;
        yield { type: "error", code: "ABORTED", message: "Aborted during execution", isRetryable: false };
        yield { type: "completed", totalUsd: 0, durationMs: Date.now() - startedAt, isError, isPreflightCrash: false };
        return;
      }

      if (event.type === "thinking") {
        yield { type: "text_delta", content: event.content, isThinking: true };
        continue;
      }
      if (event.type === "text" || event.type === "tool_use" || event.type === "tool_result") {
        yield { type: "text_delta", content: event.content };
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
          model: this.config.model,
          canonicalModel: this.config.model,
          billingMode: getDefaultBillingMode(this.config.provider),
          inputTokens,
          outputTokens,
        };
        yield { type: "completed", totalUsd: 0, durationMs: Date.now() - startedAt, isError, isPreflightCrash: false };
        return;
      }
    }

    yield {
      type: "cost_update",
      usd: 0,
      mode: "computed",
      provider: this.config.provider,
      model: this.config.model,
      canonicalModel: this.config.model,
      billingMode: getDefaultBillingMode(this.config.provider),
    };
    yield { type: "completed", totalUsd: 0, durationMs: Date.now() - startedAt, isError, isPreflightCrash: false };
  }

  private async *runKilnExecutable(options: SessionRunOptions, startedAt: number): AsyncIterable<SessionEvent> {
    const { RuntimeSessionOrchestrator, RuntimeSession } = await import("@kilnai/runtime");

    const { systemPrompt, userPrompt } = this.buildSystemAndPrompt(options);
    const adapter = this.createAdapter(options.env);
    const authorizer = new PermissionPolicyAuthorizer(this.config.permissionPolicy);

    const cliSession = new RuntimeSession({
      appName: "kiln-cli",
      tenantId: "cli-session",
      userId: this.sessionId,
      systemPrompt,
      idleTimeoutMs: 30 * 60 * 1000,
    });

    const orchestrator = new RuntimeSessionOrchestrator({
      provider: adapter,
      model: this.config.model,
      tools: this.toolDefinitions,
      builtinTools: this.builtinTools,
      eventBus: this.eventBus,
      toolAuthorizer: authorizer,
      capabilityMap: this.capabilityMap,
      dangerousCommandDetector: undefined,
    });

    if (options.messages && options.messages.length > 0) {
      this.hydrateConversation(cliSession, options.messages);
    }

    const promptParts: ContentPart[] = [textPart(userPrompt)];
    const result: OrchestrateResult = await orchestrator.processMessage(cliSession, promptParts);

    let isError = false;
    for (const part of result.parts) {
      if (part.type === "text") {
        yield { type: "text_delta", content: part.text };
      }
    }

    for (const toolExec of result.toolExecutions ?? []) {
      yield { type: "tool_result", toolName: toolExec.toolName, output: toolExec.resultSummary };
      if (toolExec.fileChanges && toolExec.fileChanges.length > 0) {
        for (const fileChange of toolExec.fileChanges) {
          yield { type: "file_changed", path: fileChange.path, changeType: fileChange.changeType };
        }
      }
    }

    if (result.escalation) {
      yield {
        type: "error",
        code: "ESCALATION",
        message: result.escalation.reason,
        isRetryable: false,
      };
      isError = true;
    }

    this.contextTracker.update(result.inputTokens ?? 0, result.outputTokens ?? 0);
    const executionIdentity = resolveExecutionIdentity({
      configuredProvider: this.config.provider,
      configuredModel: this.config.model,
      configuredBillingMode: getDefaultBillingMode(this.config.provider),
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
    };
    yield { type: "completed", totalUsd: 0, durationMs: Date.now() - startedAt, isError, isPreflightCrash: false };
  }
}

function formatExecutableSessionError(error: unknown): string {
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
  return error instanceof Error ? error.message : String(error);
}
