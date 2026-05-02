import type {
  ProviderAdapter,
  CreateMessageOptions,
  AgentResponse,
  AgentStreamEvent,
  ToolCall,
} from "../index.js";
import type { ContentPart } from "../../engine/domain/content.js";
import { textPart, extractText } from "../../engine/domain/content.js";
import { withRetry } from "./retry.js";
import type { RetryOptions } from "./retry.js";
import { normalizeToolInput } from "../tool-call-input.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const RETRYABLE_STATUSES = new Set([429, 500, 503]);

interface OpenAICompatConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly providerName: string;
  readonly internalRetry?: boolean;
}

type OpenAIContent = string | readonly OpenAIContentBlock[];

interface OpenAIContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly image_url?: { readonly url: string };
}


interface OpenAIToolFunction {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

interface OpenAIRequestBody {
  model: string;
  messages: { role: string; content: OpenAIContent }[];
  max_tokens: number;
  tools?: OpenAIToolFunction[];
  tool_choice?: string | { type: string; function?: { name: string } };
  stream?: boolean;
}

interface OpenAIToolCallResponse {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

interface OpenAIChoice {
  readonly message: {
    readonly content: string | null;
    readonly tool_calls?: readonly OpenAIToolCallResponse[];
  };
  readonly finish_reason?: string;
}

interface OpenAIUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
}

interface OpenAIChatResponse {
  readonly choices: readonly OpenAIChoice[];
  readonly usage: OpenAIUsage;
}

interface OpenAIStreamDelta {
  readonly content?: string | null;
  readonly tool_calls?: readonly {
    readonly index: number;
    readonly id?: string;
    readonly function?: {
      readonly name?: string;
      readonly arguments?: string;
    };
  }[];
}

interface OpenAIStreamChoice {
  readonly delta: OpenAIStreamDelta;
}

interface OpenAIStreamChunk {
  readonly choices: readonly OpenAIStreamChoice[];
}

export abstract class OpenAICompatAdapter implements ProviderAdapter {
  readonly name: string;

  protected readonly apiKey: string;
  protected readonly baseUrl: string;
  protected readonly model: string;
  private readonly internalRetry: boolean;

  constructor(config: OpenAICompatConfig) {
    this.name = config.providerName;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.defaultModel;
    this.internalRetry = config.internalRetry ?? true;
  }

  async createMessage(options: CreateMessageOptions): Promise<AgentResponse> {
    const body = this.buildRequestBody(options);
    const response = await withRetry(() => this.sendRequest(body), this.retryOptions());
    return this.mapResponse(response);
  }

  async *streamMessage(
    options: CreateMessageOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    const body = this.buildRequestBody(options);
    body.stream = true;

    const response = await withRetry(
      () => fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      }),
      this.retryOptions(),
    );

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`${this.name} API error ${response.status}: ${text}`);
      (error as unknown as Record<string, unknown>).status = response.status;
      throw error;
    }

    if (!response.body) {
      yield { type: "done", content: "" };
      return;
    }

    const toolBuffers = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            // Flush any remaining tool calls
            for (const [, buf] of toolBuffers) {
              yield {
                type: "tool_use",
                content: JSON.stringify({
                  id: buf.id,
                  name: buf.name,
                  input: normalizeToolInput(buf.name, buf.arguments || "{}"),
                }),
              };
            }
            toolBuffers.clear();
            yield { type: "done", content: "" };
            return;
          }

          const chunk = JSON.parse(data) as OpenAIStreamChunk;
          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;

          if (delta.content) {
            yield { type: "text", content: delta.content };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              let buf = toolBuffers.get(tc.index);
              if (!buf) {
                buf = { id: tc.id ?? "", name: tc.function?.name ?? "", arguments: "" };
                toolBuffers.set(tc.index, buf);
              }
              if (tc.function?.arguments) {
                buf.arguments += tc.function.arguments;
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Flush remaining tool calls if stream ended without [DONE]
    for (const [, buf] of toolBuffers) {
      yield {
        type: "tool_use",
        content: JSON.stringify({
          id: buf.id,
          name: buf.name,
          input: normalizeToolInput(buf.name, buf.arguments || "{}"),
        }),
      };
    }
    yield { type: "done", content: "" };
  }

  private mapPartsToOpenAI(parts: readonly ContentPart[]): OpenAIContent {
    // Optimization: all-text messages use plain string
    if (parts.every((p) => p.type === "text")) {
      return extractText(parts);
    }

    const blocks: OpenAIContentBlock[] = [];
    for (const part of parts) {
      switch (part.type) {
        case "text":
          blocks.push({ type: "text", text: part.text });
          break;
        case "image": {
          const url = part.url ?? `data:${part.mimeType};base64,${part.data}`;
          blocks.push({ type: "image_url", image_url: { url } });
          break;
        }
        case "audio":
        case "file":
          // Degrade to text placeholder for unsupported types
          blocks.push({ type: "text", text: `[${part.type}: unsupported]` });
          break;
      }
    }
    return blocks;
  }

  private buildRequestBody(options: CreateMessageOptions): OpenAIRequestBody {
    const messages: { role: string; content: OpenAIContent }[] = [
      { role: "system", content: options.system },
      ...options.messages.map((msg) => ({
        role: msg.role,
        content: this.mapPartsToOpenAI(msg.parts),
      })),
    ];

    const body: OpenAIRequestBody = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));

      if (options.toolChoice) {
        switch (options.toolChoice.type) {
          case "auto":
            body.tool_choice = "auto";
            break;
          case "any":
            body.tool_choice = "required";
            break;
          case "none":
            body.tool_choice = "none";
            break;
          case "tool":
            body.tool_choice = { type: "function", function: { name: options.toolChoice.name } };
            break;
        }
      }
    }

    return body;
  }

  /** HTTP headers for API requests. Override in subclasses to add provider-specific headers. */
  protected buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async sendRequest(body: OpenAIRequestBody): Promise<OpenAIChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`${this.name} API error ${response.status}: ${text}`);
      (error as unknown as Record<string, unknown>).status = response.status;
      throw error;
    }

    return (await response.json()) as OpenAIChatResponse;
  }

  private mapResponse(response: OpenAIChatResponse): AgentResponse {
    const choice = response.choices[0];
    const content = choice?.message.content ?? "";
    const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map(
      (tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: normalizeToolInput(tc.function.name, tc.function.arguments),
      }),
    );

    return {
      parts: [textPart(content)],
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls,
      stopReason: choice?.finish_reason ?? "stop",
    };
  }

  /** @internal Retry options exposed for test overriding */
  retryOptions(): RetryOptions {
    if (!this.internalRetry) {
      return {
        maxRetries: 1,
        baseDelayMs: BASE_DELAY_MS,
        isRetryable: (error: unknown): boolean => {
          const status = (error as Record<string, unknown>).status;
          return typeof status !== "number" || RETRYABLE_STATUSES.has(status);
        },
      };
    }
    return {
      maxRetries: MAX_RETRIES,
      baseDelayMs: BASE_DELAY_MS,
      isRetryable: (error: unknown): boolean => {
        const status = (error as Record<string, unknown>).status;
        return typeof status !== "number" || RETRYABLE_STATUSES.has(status);
      },
    };
  }
}
