import { createHash } from "node:crypto";
import type {
  ProviderAdapter,
  CreateMessageOptions,
  AgentResponse,
  AgentStreamEvent,
  ToolCall,
  ProviderTransportEvent,
} from "@kilnai/core/agents";
import {
  admitDeliberationForExecution,
  assertValidToolCallIds,
  buildSyntheticToolCallId,
} from "@kilnai/core/agents";
import type { ContentPart } from "@kilnai/core/engine";
import { extractText, KilnError, textPart } from "@kilnai/core/engine";

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
  readonly deliberationTransport = "none" as const;

  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: OllamaAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? "http://localhost:11434";
    this.model = config.defaultModel ?? LLAMA3;
  }

  async createMessage(options: CreateMessageOptions): Promise<AgentResponse> {
    rejectExecutableDeliberation(options);
    const body = this.buildRequest(options, false);

    const response = await this.fetchObserved(options, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    this.emitTransport(options, { type: "request_completed", identity: options.requestIdentity });

    const toolCalls: ToolCall[] = [];
    if (data.message.tool_calls) {
      const requestHash = hashOllamaRequestBody(body);
      for (const [ordinal, tc] of data.message.tool_calls.entries()) {
        toolCalls.push({
          id: buildSyntheticToolCallId(requestHash, String(ordinal), hashOllamaToolCall(tc)),
          name: tc.function.name,
          input: tc.function.arguments,
        });
      }
    }
    assertValidToolCallIds(toolCalls, { adapter: this.name });

    return {
      parts: [textPart(data.message.content)],
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextUsage: { measurement: "provider_reported", cacheSemantics: "included_in_input" },
      toolCalls,
      stopReason: data.done ? "stop" : "length",
    };
  }

  async *streamMessage(
    options: CreateMessageOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    rejectExecutableDeliberation(options);
    const body = this.buildRequest(options, true);

    const response = await this.fetchObserved(options, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
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
    this.emitTransport(options, { type: "request_completed", identity: options.requestIdentity });
  }

  private async fetchObserved(options: CreateMessageOptions, init: RequestInit): Promise<Response> {
    options.transportAdmission?.admit(options.requestIdentity);
    this.emitTransport(options, { type: "request_started", identity: options.requestIdentity });
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, init);
      this.emitTransport(options, {
        type: "response_headers",
        identity: options.requestIdentity,
        status: response.status,
      });
      return response;
    } catch (error) {
      this.emitTransport(options, {
        type: "request_failed",
        identity: options.requestIdentity,
        phase: "transport",
      });
      throw error;
    }
  }

  private emitTransport(options: CreateMessageOptions, event: ProviderTransportEvent): void {
    try {
      options.transportObserver?.onEvent(event);
    } catch {
      // Diagnostic observers cannot affect provider execution.
    }
  }

  private mapPartsToOllama(parts: readonly ContentPart[]): { content: string; images?: string[] } {
    const text = extractText(parts);
    const images: string[] = [];
    for (const part of parts) {
      switch (part.type) {
        case "text":
        case "tool_use":
          break;
        case "tool_result":
          if (part.contentParts?.some((contentPart) => contentPart.type !== "text")) {
            throw unsupportedModality(
              "tool_result",
              "Ollama chat serialization does not support multimodal tool-result content parts.",
            );
          }
          break;
        case "image":
          if (!part.data) {
            throw unsupportedModality(
              "image",
              "Ollama chat serialization requires base64 image data; image URL parts need governed artifact transport or transform.",
            );
          }
          images.push(part.data);
          break;
        case "audio":
          throw unsupportedModality("audio", "Ollama chat serialization does not support audio parts.");
        case "file":
          throw unsupportedModality("document", "Ollama chat serialization does not support file parts.");
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

function rejectExecutableDeliberation(options: CreateMessageOptions): void {
  const level = admitDeliberationForExecution(options.deliberationResolution);
  if (level) throw new Error(`ollama does not declare native deliberation transport for level '${level}'.`);
}

function unsupportedModality(modality: string, reason: string): KilnError {
  return new KilnError("UNSUPPORTED_MODALITY", `unsupported_modality: ${reason}`, {
    retryable: false,
    context: { provider: "ollama", modality },
  });
}

/**
 * Ollama's wire protocol carries no tool call id at all, so identity must be synthesized.
 * Hashes the exact request body sent to Ollama (deterministic key order, no timestamps or
 * randomness) -- re-normalizing the same logical request yields the identical hash, and the
 * caller combines it with the tool call's ordinal within the response to distinguish sibling
 * calls in one turn.
 */
function hashOllamaRequestBody(body: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

/**
 * Ollama's generation is nondeterministic: a fixed request can return a different tool call
 * at the same ordinal on different attempts. The request hash + ordinal alone would collide
 * two distinct generated calls onto the same synthetic id, so the derivation also folds in a
 * hash of the tool call's own content (name + arguments). Re-normalizing the same *persisted*
 * response still yields the same hash -- this only distinguishes genuinely different outputs.
 */
function hashOllamaToolCall(toolCall: OllamaToolCall): string {
  return createHash("sha256")
    .update(stableStringify({ name: toolCall.function.name, arguments: toolCall.function.arguments }))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
