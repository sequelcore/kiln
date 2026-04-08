import { randomUUID } from "node:crypto";
import {
  AnthropicAdapter,
  OpenAIAdapter,
  DeepSeekAdapter,
  OpenRouterAdapter,
  OllamaAdapter,
  textPart,
  type AgentMessage,
  type ProviderAdapter,
} from "@kilnai/core";
import type {
  IKilnSession,
  KilnPermissionPolicy,
  SessionCapabilities,
  SessionEvent,
  SessionRunOptions,
} from "./session.js";
import { buildProviderSystemPrompt } from "./preamble-builder.js";
import { ProviderContextTracker } from "./provider-context.js";

export interface ProviderSessionConfig {
  readonly provider: "anthropic" | "openai" | "deepseek" | "openrouter" | "ollama";
  readonly model?: string;
  readonly task: string;
  readonly systemPrompt?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly permissionPolicy: KilnPermissionPolicy;
  readonly constraintInstructions?: readonly string[];
}

const PROVIDER_PRIORITY: Record<ProviderSessionConfig["provider"], number> = {
  anthropic: 4,
  openai: 5,
  openrouter: 6,
  deepseek: 7,
  ollama: 8,
};

export class ProviderSession implements IKilnSession {
  readonly sessionId: string;

  private readonly _capabilities: SessionCapabilities;
  private readonly contextTracker: ProviderContextTracker;

  constructor(private readonly config: ProviderSessionConfig) {
    this.sessionId = randomUUID();
    this.contextTracker = new ProviderContextTracker({
      maxContextTokens: 128000,
      compactionThreshold: 0.85,
    });
    this._capabilities = {
      mcp: false,
      streaming: true,
      resumable: false,
      resume: false,
      costTrackingMode: "computed",
      supportedTools: [],
      maxContextTokens: null,
      priority: PROVIDER_PRIORITY[config.provider],
      fallbackTo: null,
      permissionPolicy: config.permissionPolicy,
    };
  }

  get capabilities(): SessionCapabilities {
    return this._capabilities;
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
      const adapter = this.createAdapter(options.env);
      const hasStructuredPreamble = this.isStructuredPreamble(options.prompt);
      const baseSystemPrompt = hasStructuredPreamble
        ? options.prompt
        : (this.config.systemPrompt ?? "");
      const userPrompt = hasStructuredPreamble
        ? this.config.task
        : options.prompt;
      const systemPrompt = buildProviderSystemPrompt(
        baseSystemPrompt,
        this.config.constraintInstructions,
      );
      const messages: AgentMessage[] = [{
        role: "user",
        parts: [textPart(userPrompt)],
      }];

      for await (const event of adapter.streamMessage({
        system: systemPrompt,
        messages,
      })) {
        if (options.abortSignal?.aborted) {
          isError = true;
          yield {
            type: "error",
            code: "ABORTED",
            message: "Aborted during execution",
            isRetryable: false,
          };
          yield {
            type: "completed",
            totalUsd: 0,
            durationMs: Date.now() - startedAt,
            isError,
            isPreflightCrash: false,
          };
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
          try {
            const parsed = JSON.parse(event.content) as { name?: string; input?: unknown };
            if (typeof parsed !== "object" || parsed === null || typeof parsed.name !== "string") {
              throw new Error("tool_use payload must include a tool name");
            }
            yield {
              type: "tool_use",
              toolName: parsed.name,
              input: parsed.input ?? {},
            };
          } catch (err) {
            isError = true;
            yield {
              type: "error",
              code: "PROVIDER_TOOL_USE_PARSE_ERROR",
              message: err instanceof Error ? err.message : String(err),
              isRetryable: false,
            };
          }
          continue;
        }

        if (event.type === "tool_result") {
          yield {
            type: "tool_result",
            toolName: "",
            output: event.content,
          };
          continue;
        }

        if (event.type === "done") {
          const doneEvent = event as { inputTokens?: number; outputTokens?: number };
          const inputTokens = typeof doneEvent.inputTokens === "number" ? doneEvent.inputTokens : 0;
          const outputTokens = typeof doneEvent.outputTokens === "number" ? doneEvent.outputTokens : 0;
          this.contextTracker.update(inputTokens, outputTokens);
          yield { type: "cost_update", usd: 0, mode: "computed" };
          yield {
            type: "completed",
            totalUsd: 0,
            durationMs: Date.now() - startedAt,
            isError,
            isPreflightCrash: false,
          };
          return;
        }
      }

      yield { type: "cost_update", usd: 0, mode: "computed" };
      yield {
        type: "completed",
        totalUsd: 0,
        durationMs: Date.now() - startedAt,
        isError,
        isPreflightCrash: false,
      };
    } catch (err) {
      yield {
        type: "error",
        code: "PROVIDER_SESSION_ERROR",
        message: err instanceof Error ? err.message : String(err),
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
    // Stateless direct-provider session; no process/socket lifecycle to tear down.
  }

  private resolveEnv(name: string, runtimeEnv?: Record<string, string>): string | undefined {
    return runtimeEnv?.[name] ?? this.config.env?.[name] ?? process.env[name];
  }

  private createAdapter(runtimeEnv?: Record<string, string>): ProviderAdapter {
    const provider = this.config.provider;
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
}
