import type {
  ProviderAdapter,
  CreateMessageOptions,
  AgentResponse,
  AgentStreamEvent,
  ToolCall,
} from "../index.js";
import type { ContentPart } from "../../engine/domain/content.js";
import { textPart, extractText } from "../../engine/domain/content.js";
import { KilnError } from "../../engine/errors.js";
import { withRetry } from "./retry.js";
import type { RetryOptions } from "./retry.js";
import { assertValidToolCallIds, buildSyntheticToolCallId, normalizeToolInput } from "../tool-call-input.js";
import {
  collectCanonicalToolNames,
  createProviderToolNameCodec,
  type ProviderToolNameCodec,
} from "./tool-name-codec.js";
import { toStrictToolSchema } from "./strict-tool-schema.js";
import { admitDeliberationForExecution } from "../deliberation-policy.js";

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
    readonly strict?: true;
  };
}

interface OpenAIToolCallRequest {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

type OpenAIMessage =
  | { readonly role: "system" | "user"; readonly content: OpenAIContent }
  | { readonly role: "assistant"; readonly content: OpenAIContent | null; readonly tool_calls?: readonly OpenAIToolCallRequest[] }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

interface OpenAIRequestBody {
  model: string;
  messages: OpenAIMessage[];
  max_tokens: number;
  tools?: OpenAIToolFunction[];
  tool_choice?: string | { type: string; function?: { name: string } };
  stream?: boolean;
  reasoning_effort?: string;
}

interface OpenAIRequest {
  readonly body: OpenAIRequestBody;
  readonly toolNames: ProviderToolNameCodec;
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
  readonly id?: string;
  readonly choices: readonly OpenAIStreamChoice[];
}

/**
 * Accumulator for one streamed tool call. `providerId`/`chunkId` track which sources have
 * already contributed to `id` so a later, conflicting delta can be detected instead of
 * silently discarded or silently overwriting a previously reconciled identity.
 */
interface StreamedToolCallBuffer {
  id: string;
  name: string;
  arguments: string;
  providerId?: string;
  chunkId?: string;
}

export abstract class OpenAICompatAdapter implements ProviderAdapter {
  readonly name: string;
  readonly deliberationTransport: "native-level" | "none" = "none";

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
    const request = this.buildRequest(options);
    const response = await withRetry(
      () => this.sendRequest(request.body, options),
      this.retryOptions(),
      options.signal,
    );
    return this.mapResponse(response, request.toolNames);
  }

  async *streamMessage(
    options: CreateMessageOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    const request = this.buildRequest(options);
    request.body.stream = true;

    const response = await withRetry(
      () => fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(options),
        body: JSON.stringify(request.body),
        signal: options.signal,
      }),
      this.retryOptions(),
      options.signal,
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

    const toolBuffers = new Map<number, StreamedToolCallBuffer>();

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
            yield* this.flushStreamedToolCalls(toolBuffers, request.toolNames);
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
                buf = { id: "", name: tc.function?.name ?? "", arguments: "" };
                toolBuffers.set(tc.index, buf);
              }
              this.reconcileStreamedToolCallId(buf, tc.id, chunk.id, tc.index);
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
    yield* this.flushStreamedToolCalls(toolBuffers, request.toolNames);
    yield { type: "done", content: "" };
  }

  /**
   * Reconciles a streamed OpenAI-compatible delta into the buffered call's identity. A native
   * `tc.id` always wins over a synthesized one -- this lets a buffer that started without an id
   * (no `tc.id`, no chunk id on the first delta) adopt a native id supplied on a later delta,
   * instead of failing at flush even though a stable id eventually arrived. Once a native id or
   * a chunk id has been observed for this buffer, any later delta contradicting it (a different
   * native id, or a different chunk id backing the synthesized id) is a malformed stream and
   * fails closed rather than being silently absorbed or overwritten.
   */
  private reconcileStreamedToolCallId(
    buf: StreamedToolCallBuffer,
    providerId: string | undefined,
    chunkId: string | undefined,
    index: number,
  ): void {
    const trimmedProviderId = providerId?.trim();
    if (trimmedProviderId) {
      if (buf.providerId !== undefined && buf.providerId !== trimmedProviderId) {
        throw new KilnError(
          "TOOL_CALL_IDENTITY_INVALID",
          `${this.name} sent conflicting native tool call ids ("${buf.providerId}" and "${trimmedProviderId}") at stream index ${index}.`,
          { context: { adapter: this.name, index, id: buf.providerId, conflictingId: trimmedProviderId } },
        );
      }
      buf.providerId = trimmedProviderId;
      buf.id = trimmedProviderId;
      return;
    }

    if (buf.providerId !== undefined) {
      // A native id already anchors this buffer; deltas without one carry no new identity.
      return;
    }

    if (chunkId) {
      if (buf.chunkId !== undefined && buf.chunkId !== chunkId) {
        throw new KilnError(
          "TOOL_CALL_IDENTITY_INVALID",
          `${this.name} sent conflicting chunk ids ("${buf.chunkId}" and "${chunkId}") for the same buffered tool call at stream index ${index}.`,
          { context: { adapter: this.name, index, id: buf.chunkId, conflictingId: chunkId } },
        );
      }
      buf.chunkId = chunkId;
      buf.id = buildSyntheticToolCallId(chunkId, String(index));
    }
  }

  /**
   * Validates every buffered tool call's identity as a single collection (once per flush,
   * matching the adapter's buffering model) before yielding `tool_use` events for it.
   */
  private *flushStreamedToolCalls(
    toolBuffers: ReadonlyMap<number, StreamedToolCallBuffer>,
    toolNames: ProviderToolNameCodec,
  ): Generator<AgentStreamEvent> {
    if (toolBuffers.size === 0) {
      return;
    }
    const toolCalls: ToolCall[] = [...toolBuffers.values()].map((buf) => ({
      id: buf.id,
      name: toolNames.toCanonicalName(buf.name),
      input: normalizeToolInput(toolNames.toCanonicalName(buf.name), buf.arguments || "{}"),
    }));
    assertValidToolCallIds(toolCalls, { adapter: this.name });
    for (const toolCall of toolCalls) {
      yield { type: "tool_use", content: JSON.stringify(toolCall) };
    }
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
        case "file":
          throw unsupportedModality(this.name, "document", "OpenAI-compatible chat serialization does not support file parts.");
        case "audio":
          throw unsupportedModality(this.name, "audio", "OpenAI-compatible chat serialization does not support audio parts.");
        case "tool_use":
        case "tool_result":
          blocks.push({ type: "text", text: `[${part.type}: represented separately]` });
          break;
      }
    }
    return blocks;
  }

  private mapMessageToOpenAI(
    message: CreateMessageOptions["messages"][number],
    toolNames: ProviderToolNameCodec,
  ): readonly OpenAIMessage[] {
    const toolResults = message.parts.filter((part) => part.type === "tool_result");
    const nonToolResultParts = message.parts.filter((part) => part.type !== "tool_result");
    const messages: OpenAIMessage[] = [];

    if (nonToolResultParts.length > 0) {
      const toolUses = nonToolResultParts.filter((part) => part.type === "tool_use");
      const visibleParts = nonToolResultParts.filter((part) => part.type !== "tool_use");

      if (message.role === "assistant" && toolUses.length > 0) {
        const content = visibleParts.length > 0 ? this.mapPartsToOpenAI(visibleParts) : null;
        messages.push({
          role: "assistant",
          content,
          tool_calls: toolUses.map((part): OpenAIToolCallRequest => ({
            id: part.id,
            type: "function",
            function: {
              name: toolNames.toProviderName(part.name),
              arguments: JSON.stringify(part.input),
            },
          })),
        });
      } else {
        messages.push({
          role: message.role,
          content: this.mapPartsToOpenAI(nonToolResultParts),
        });
      }
    }

    for (const part of toolResults) {
      if (part.contentParts && part.contentParts.some((contentPart) => contentPart.type !== "text")) {
        throw unsupportedModality(
          this.name,
          part.contentParts.map((contentPart) => contentPart.type).join(","),
          "OpenAI-compatible tool messages cannot serialize multimodal tool-result content parts.",
        );
      }
      messages.push({
        role: "tool",
        tool_call_id: part.toolUseId,
        content: part.content,
      });
    }

    return messages;
  }

  private buildRequest(options: CreateMessageOptions): OpenAIRequest {
    const toolNames = createProviderToolNameCodec(collectCanonicalToolNames(options));
    const messages: OpenAIMessage[] = [
      { role: "system", content: options.system },
      ...options.messages.flatMap((message) => this.mapMessageToOpenAI(message, toolNames)),
    ];

    const body: OpenAIRequestBody = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
    };
    const deliberationLevel = admitDeliberationForExecution(options.deliberationResolution);
    if (deliberationLevel) {
      this.projectDeliberationLevel(body, deliberationLevel);
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((tool) => ({
        type: "function" as const,
        function: {
          name: toolNames.toProviderName(tool.name),
          description: tool.description,
          parameters: tool.strict === true ? toStrictToolSchema(tool.inputSchema) : tool.inputSchema,
          ...(tool.strict === true ? { strict: true as const } : {}),
        },
      }));
    }

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
          body.tool_choice = {
            type: "function",
            function: { name: toolNames.toProviderName(options.toolChoice.name) },
          };
          break;
      }
    }

    return { body, toolNames };
  }

  protected projectDeliberationLevel(_body: OpenAIRequestBody, level: string): void {
    throw new Error(`${this.name} does not declare native deliberation transport for level '${level}'.`);
  }

  /** HTTP headers for API requests. Override in subclasses to add provider-specific headers. */
  protected buildHeaders(_options?: Pick<CreateMessageOptions, "sessionId">): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async sendRequest(body: OpenAIRequestBody, options: CreateMessageOptions): Promise<OpenAIChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`${this.name} API error ${response.status}: ${text}`);
      (error as unknown as Record<string, unknown>).status = response.status;
      throw error;
    }

    return (await response.json()) as OpenAIChatResponse;
  }

  private mapResponse(response: OpenAIChatResponse, toolNames: ProviderToolNameCodec): AgentResponse {
    const choice = response.choices[0];
    const content = choice?.message.content ?? "";
    const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map(
      (tc) => ({
        id: tc.id,
        name: toolNames.toCanonicalName(tc.function.name),
        input: normalizeToolInput(
          toolNames.toCanonicalName(tc.function.name),
          tc.function.arguments,
        ),
      }),
    );
    assertValidToolCallIds(toolCalls, { adapter: this.name });

    return {
      parts: [textPart(content)],
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextUsage: { measurement: "provider_reported", cacheSemantics: "included_in_input" },
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
          if (isAbortError(error)) {
            return false;
          }
          const status = (error as Record<string, unknown>).status;
          return typeof status !== "number" || RETRYABLE_STATUSES.has(status);
        },
      };
    }
    return {
      maxRetries: MAX_RETRIES,
      baseDelayMs: BASE_DELAY_MS,
      isRetryable: (error: unknown): boolean => {
        if (isAbortError(error)) {
          return false;
        }
        const status = (error as Record<string, unknown>).status;
        return typeof status !== "number" || RETRYABLE_STATUSES.has(status);
      },
    };
  }
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as Record<string, unknown>;
  return record.name === "AbortError" || record.code === "ABORT_ERR";
}

function unsupportedModality(provider: string, modality: string, reason: string): KilnError {
  return new KilnError("UNSUPPORTED_MODALITY", `unsupported_modality: ${reason}`, {
    context: { provider, modality },
  });
}
