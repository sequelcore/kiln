import type {
  ProviderAdapter,
  CreateMessageOptions,
  AgentResponse,
  AgentStreamEvent,
  ToolCall,
} from "../index.js";
import type { ContentPart } from "../../engine/domain/content.js";
import { textPart, extractText } from "../../engine/domain/content.js";

export const LLAMA3 = "llama3.1";
export const CODELLAMA = "codellama";
export const DEEPSEEK_CODER = "deepseek-coder-v2";

interface OllamaAdapterConfig {
  readonly baseUrl?: string;
  readonly defaultModel?: string;
}

interface OllamaToolCall {
  readonly function: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
}

interface OllamaMessage {
  readonly content: string;
  readonly tool_calls?: readonly OllamaToolCall[];
}

interface OllamaChatResponse {
  readonly message: OllamaMessage;
  readonly done: boolean;
  readonly eval_count?: number;
  readonly prompt_eval_count?: number;
}

interface OllamaTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export class OllamaAdapter implements ProviderAdapter {
  readonly name = "ollama";

  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: OllamaAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? "http://localhost:11434";
    this.model = config.defaultModel ?? LLAMA3;
  }

  async createMessage(options: CreateMessageOptions): Promise<AgentResponse> {
    const body = this.buildRequest(options, false);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaChatResponse;

    const toolCalls: ToolCall[] = [];
    if (data.message.tool_calls) {
      for (const tc of data.message.tool_calls) {
        toolCalls.push({
          id: crypto.randomUUID(),
          name: tc.function.name,
          input: tc.function.arguments,
        });
      }
    }

    return {
      parts: [textPart(data.message.content)],
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls,
    };
  }

  async *streamMessage(
    options: CreateMessageOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    const body = this.buildRequest(options, true);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama stream failed: ${response.status} ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length === 0) continue;

          const chunk = JSON.parse(trimmed) as OllamaChatResponse;

          if (!chunk.done && chunk.message.content) {
            yield { type: "text", content: chunk.message.content };
          }

          if (chunk.done) {
            yield { type: "done", content: "" };
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim().length > 0) {
        const chunk = JSON.parse(buffer.trim()) as OllamaChatResponse;
        if (!chunk.done && chunk.message.content) {
          yield { type: "text", content: chunk.message.content };
        }
        if (chunk.done) {
          yield { type: "done", content: "" };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private mapPartsToOllama(parts: readonly ContentPart[]): { content: string; images?: string[] } {
    const text = extractText(parts);
    const images: string[] = [];
    for (const part of parts) {
      if (part.type === "image" && part.data) {
        images.push(part.data);
      }
    }
    return images.length > 0 ? { content: text, images } : { content: text };
  }

  private buildRequest(
    options: CreateMessageOptions,
    stream: boolean,
  ): Record<string, unknown> {
    const messages = [
      { role: "system", content: options.system },
      ...options.messages.map((msg) => ({
        role: msg.role,
        ...this.mapPartsToOllama(msg.parts),
      })),
    ];

    const request: Record<string, unknown> = {
      model: this.model,
      messages,
      stream,
    };

    if (options.tools && options.tools.length > 0) {
      request.tools = options.tools.map(
        (tool): OllamaTool => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        }),
      );
    }

    return request;
  }
}
