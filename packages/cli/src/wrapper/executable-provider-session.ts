import { randomUUID } from "node:crypto";
import {
  type AgentMessage,
  CodexOAuthAdapter,
  CodexOAuthAuth,
  DevToolRegistry,
  TOOL_SCHEMAS,
  BashTool,
  ReadTool,
  WriteTool,
  EditTool,
  GrepTool,
  GlobTool,
  GitTool,
  textPart,
  appendExecutionIdentity,
  resolveExecutionIdentity,
  EventBus,
  KilnError,
  type Capability,
  type ContentPart,
  type ToolDefinition,
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

export interface ExecutableProviderSessionConfig {
  readonly provider: "codex-oauth";
  readonly model?: string;
  readonly task: string;
  readonly systemPrompt?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly permissionPolicy: KilnPermissionPolicy;
  readonly constraintInstructions?: readonly string[];
}

function buildBuiltinTools(): Map<string, (input: Record<string, unknown>) => Promise<unknown>> {
  const registry = new DevToolRegistry();
  registry.register(new BashTool());
  registry.register(new ReadTool());
  registry.register(new WriteTool());
  registry.register(new EditTool());
  registry.register(new GrepTool());
  registry.register(new GlobTool());
  registry.register(new GitTool());

  const tools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  for (const tool of registry.list()) {
    tools.set(tool.name, async (input: Record<string, unknown>) => {
      const result = await tool.execute({ name: tool.name, input });
      return { output: result.output, isError: result.isError, metadata: result.metadata };
    });
  }
  return tools;
}

function buildToolDefinitions(): readonly ToolDefinition[] {
  return Object.values(TOOL_SCHEMAS).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    tags: new Set<string>(),
  }));
}

function buildCapabilityMap(): ReadonlyMap<string, Capability> {
  const map = new Map<string, Capability>();
  for (const tool of Object.values(TOOL_SCHEMAS)) {
    map.set(tool.name, {
      name: tool.name,
      description: tool.description,
      schema: tool.inputSchema,
      tags: [],
      annotations: tool.annotations,
    });
  }
  return map;
}

function deriveCapability(policy: KilnPermissionPolicy): SessionCapabilities {
  const supportedTools = ["bash", "read", "write", "edit", "grep", "glob", "git"];
  return {
    mcp: false,
    streaming: true,
    resumable: false,
    resume: false,
    costTrackingMode: "computed",
    supportedTools,
    maxContextTokens: null,
    priority: 1,
    fallbackTo: null,
    permissionPolicy: policy,
  };
}


export class ExecutableProviderSession implements IKilnSession {
  readonly sessionId: string;
  readonly capabilities: SessionCapabilities;

  private readonly config: ExecutableProviderSessionConfig;
  private readonly builtinTools: Map<string, (input: Record<string, unknown>) => Promise<unknown>>;
  private readonly toolDefinitions: readonly ToolDefinition[];
  private readonly eventBus: EventBus;

  constructor(config: ExecutableProviderSessionConfig) {
    this.sessionId = randomUUID();
    this.config = config;
    this.builtinTools = buildBuiltinTools();
    this.toolDefinitions = buildToolDefinitions();
    this.eventBus = new EventBus(100);
    this.capabilities = deriveCapability(config.permissionPolicy);
  }

  get providerSessionId(): string | undefined {
    return undefined;
  }

  async *run(options: SessionRunOptions): AsyncIterable<SessionEvent> {
    const startedAt = Date.now();
    let isError = false;

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
      const { RuntimeSessionOrchestrator } = await import("@kilnai/runtime");
      const { RuntimeSession } = await import("@kilnai/runtime");

      const hasStructuredPreamble = this.isStructuredPreamble(options.prompt);
      const baseSystemPrompt = options.system ?? (hasStructuredPreamble ? options.prompt : (this.config.systemPrompt ?? ""));
      const structuredMessages = options.messages;
      const userPrompt = hasStructuredPreamble
        ? this.config.task
        : options.prompt;
      const systemPrompt = appendExecutionIdentity(
        buildProviderSystemPrompt(baseSystemPrompt, this.config.constraintInstructions),
        resolveExecutionIdentity({
          configuredProvider: "codex-oauth",
          configuredModel: this.config.model,
        }),
      );

      void (options.cwd ?? this.config.cwd ?? process.cwd());

      const auth = new CodexOAuthAuth();

      const adapter = new CodexOAuthAdapter({
        auth,
        defaultModel: this.config.model,
      });

      const authorizer = new PermissionPolicyAuthorizer(this.config.permissionPolicy);
      const capabilityMap = buildCapabilityMap();

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
        capabilityMap,
        dangerousCommandDetector: undefined,
      });

      const promptParts: ContentPart[] = [textPart(userPrompt)];

      if (structuredMessages && structuredMessages.length > 0) {
        this.hydrateConversation(cliSession, structuredMessages);
      }

      const result: OrchestrateResult = await orchestrator.processMessage(
        cliSession,
        promptParts,
      );

      for (const part of result.parts) {
        if (part.type === "text") {
          yield { type: "text_delta", content: part.text };
        }
      }

      for (const toolExec of result.toolExecutions ?? []) {
        yield {
          type: "tool_result",
          toolName: toolExec.toolName,
          output: toolExec.resultSummary,
        };
        if (toolExec.fileChanges && toolExec.fileChanges.length > 0) {
          for (const fc of toolExec.fileChanges) {
            yield {
              type: "file_changed",
              path: fc.path,
              changeType: fc.changeType,
            };
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

      const executionIdentity = resolveExecutionIdentity({
        configuredProvider: "codex-oauth",
        configuredModel: this.config.model,
        configuredBillingMode: "subscription",
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
      yield {
        type: "completed",
        totalUsd: 0,
        durationMs: Date.now() - startedAt,
        isError,
        isPreflightCrash: false,
      };
    } catch (err) {
      const message = formatExecutableSessionError(err);
      yield {
        type: "error",
        code: "EXECUTABLE_SESSION_ERROR",
        message,
        isRetryable: false,
      };
      yield {
        type: "completed",
        totalUsd: 0,
        durationMs: Date.now() - startedAt,
        isError: true,
        isPreflightCrash: false,
      };
    }
  }

  async dispose(): Promise<void> {
    // Stateless session; no process/socket lifecycle to tear down.
  }

  private isStructuredPreamble(prompt: string): boolean {
    return prompt.trimStart().startsWith("<kiln-preamble>");
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
}

function formatExecutableSessionError(error: unknown): string {
  if (error instanceof KilnError) {
    const status = typeof error.context.status === "number" ? error.context.status : undefined;
    const responseBody = typeof error.context.responseBody === "string"
      ? error.context.responseBody.trim()
      : "";
    const suffixParts: string[] = [];
    if (status !== undefined) {
      suffixParts.push(`status ${status}`);
    }
    if (responseBody.length > 0) {
      const compactBody = responseBody.replace(/\s+/g, " ").slice(0, 240);
      suffixParts.push(compactBody);
    }
    if (suffixParts.length === 0) {
      return error.message;
    }
    return `${error.message} (${suffixParts.join(": ")})`;
  }

  return error instanceof Error ? error.message : String(error);
}
