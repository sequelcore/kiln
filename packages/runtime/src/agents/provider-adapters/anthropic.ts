import Anthropic from "@anthropic-ai/sdk";
import type {
  ProviderAdapter,
  CreateMessageOptions,
  AgentResponse,
  AgentStreamEvent,
  ToolCall,
  RetryOptions,
} from "@kilnai/core/agents";
import {
  assertValidToolCallIds,
  admitDeliberationForExecution,
  normalizeToolInput,
  withRetry,
} from "@kilnai/core/agents";
import type { ContentPart, ToolResultPayloadPart } from "@kilnai/core/engine";
import { textPart, extractText, KilnError } from "@kilnai/core/engine";

export const CLAUDE_OPUS = "claude-opus-4-6";
export const CLAUDE_SONNET = "claude-sonnet-4-6";
export const CLAUDE_HAIKU = "claude-haiku-4-5-20251001";

const BETA_HEADER = "token-efficient-tools-2025-02-19";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const RETRYABLE_STATUSES = new Set([429, 500, 529]);

interface AnthropicAdapterConfig {
  readonly apiKey: string;
  readonly defaultModel?: string;
  readonly internalRetry?: boolean;
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic";
  readonly deliberationTransport = "native-level" as const;

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly internalRetry: boolean;

  constructor(config: AnthropicAdapterConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey, ...(config.internalRetry === false ? { maxRetries: 0 } : {}) });
    this.model = config.defaultModel ?? CLAUDE_SONNET;
    this.internalRetry = config.internalRetry ?? true;
  }

  async createMessage(options: CreateMessageOptions): Promise<AgentResponse> {
    const params = this.buildParams(options);
    const response = await withRetry(
      () => this.client.messages.create(params, {
        headers: { "anthropic-beta": BETA_HEADER },
        signal: options.signal,
      }),
      this.retryOptions(),
      options.signal,
    );

    return this.mapResponse(response as Anthropic.Messages.Message);
  }

  async *streamMessage(
    options: CreateMessageOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    const params = this.buildParams(options);
    const stream = await withRetry(
      () => this.client.messages.create(
        { ...params, stream: true },
        { headers: { "anthropic-beta": BETA_HEADER }, signal: options.signal },
      ),
      this.retryOptions(),
      options.signal,
    );

    const toolInputBuffers = new Map<number, { id: string; name: string; json: string }>();
    const emittedToolCalls: ToolCall[] = [];

    for await (const event of stream as AsyncIterable<Anthropic.Messages.RawMessageStreamEvent>) {
      switch (event.type) {
        case "content_block_start": {
          const block = event.content_block;
          if (block.type === "thinking") {
            yield { type: "thinking", content: block.thinking };
          } else if (block.type === "tool_use") {
            toolInputBuffers.set(event.index, {
              id: block.id,
              name: block.name,
              json: "",
            });
          }
          break;
        }
        case "content_block_delta": {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            yield { type: "text", content: delta.text };
          } else if (delta.type === "thinking_delta") {
            yield { type: "thinking", content: delta.thinking };
          } else if (delta.type === "input_json_delta") {
            const buffer = toolInputBuffers.get(event.index);
            if (buffer) {
              buffer.json += delta.partial_json;
            }
          }
          break;
        }
        case "content_block_stop": {
          const buffer = toolInputBuffers.get(event.index);
          if (buffer) {
            const toolCall: ToolCall = {
              id: buffer.id,
              name: buffer.name,
              input: normalizeToolInput(buffer.name, buffer.json || "{}"),
            };
            emittedToolCalls.push(toolCall);
            assertValidToolCallIds(emittedToolCalls, { adapter: this.name });
            yield { type: "tool_use", content: JSON.stringify(toolCall) };
            toolInputBuffers.delete(event.index);
          }
          break;
        }
        case "message_stop":
          yield { type: "done", content: "" };
          break;
      }
    }
  }

  private buildParams(
    options: CreateMessageOptions,
  ): Anthropic.Messages.MessageCreateParamsNonStreaming {
    const system: Anthropic.Messages.TextBlockParam[] = [
      {
        type: "text",
        text: options.system,
        cache_control: { type: "ephemeral" },
      },
    ];

    const messages: Anthropic.Messages.MessageParam[] = options.messages.map(
      (msg) => ({
        role: msg.role,
        content: this.mapPartsToAnthropic(msg.parts),
      }),
    );

    const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: options.maxTokens ?? 4096,
      system,
      messages,
    };

    if (options.tools && options.tools.length > 0) {
      params.tools = options.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
        ...(tool.strict === true ? { strict: true } : {}),
      }));
    }

    if (options.toolChoice) {
      if (options.toolChoice.type === "tool") {
        params.tool_choice = { type: "tool", name: options.toolChoice.name };
      } else {
        params.tool_choice = { type: options.toolChoice.type };
      }
    }

    const deliberationLevel = admitDeliberationForExecution(options.deliberationResolution);
    if (options.outputSchema || deliberationLevel) {
      if (options.outputSchema) assertAdditionalPropertiesFalse(options.outputSchema);
      params.output_config = {
        ...(options.outputSchema
          ? { format: { type: "json_schema" as const, schema: options.outputSchema } }
          : {}),
        ...(deliberationLevel ? { effort: deliberationLevel } : {}),
      } as Anthropic.Messages.MessageCreateParamsNonStreaming["output_config"];
    }

    // Tool caching: mark last tool for prompt cache reuse across turns
    if (params.tools && params.tools.length > 0) {
      const lastTool = params.tools[params.tools.length - 1];
      (lastTool as unknown as { cache_control: { type: string } }).cache_control = { type: "ephemeral" };
    }

    // Conversation prefix caching: mark penultimate user message for reuse
    if (messages.length >= 3) {
      for (let i = messages.length - 2; i >= 0; i--) {
        const msg = messages[i];
        if (msg && msg.role === "user") {
          const content = msg.content;
          if (Array.isArray(content) && content.length > 0) {
            const lastBlock = content[content.length - 1];
            if (lastBlock) {
              (lastBlock as unknown as { cache_control: { type: string } }).cache_control = { type: "ephemeral" };
            }
          }
          break;
        }
      }
    }

    return params;
  }

  private mapPartsToAnthropic(
    parts: readonly ContentPart[],
  ): string | Anthropic.Messages.ContentBlockParam[] {
    // Optimization: all-text messages use plain string
    if (parts.every((p) => p.type === "text")) {
      return extractText(parts);
    }

    const blocks: Anthropic.Messages.ContentBlockParam[] = [];
    for (const part of parts) {
      switch (part.type) {
        case "text":
          blocks.push({ type: "text", text: part.text });
          break;
        case "image":
          blocks.push({
            type: "image",
            source: part.data
              ? { type: "base64", media_type: part.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: part.data }
              : { type: "url", url: part.url! },
          });
          break;
        case "file":
          blocks.push({
            type: "document",
            source: part.data
              ? { type: "base64", media_type: part.mimeType as "application/pdf", data: part.data }
              : { type: "url", url: part.url! },
          });
          break;
        case "tool_use":
          blocks.push({
            type: "tool_use",
            id: part.id,
            name: part.name,
            input: part.input,
          });
          break;
        case "tool_result":
          blocks.push({
            type: "tool_result",
            tool_use_id: part.toolUseId,
            content: part.contentParts
              ? this.mapToolResultPayloadPartsToAnthropic(part.content, part.contentParts)
              : part.content,
            is_error: part.isError,
          });
          break;
        case "audio":
          throw new KilnError("UNSUPPORTED_MODALITY", "Anthropic does not support audio content blocks", {
            context: { modality: "audio", provider: "anthropic" },
          });
      }
    }
    return blocks;
  }

  private mapToolResultPayloadPartsToAnthropic(
    content: string,
    parts: readonly ToolResultPayloadPart[],
  ): Anthropic.Messages.ToolResultBlockParam["content"] {
    const blocks: unknown[] = content.length > 0
      ? [{ type: "text", text: content }]
      : [];
    for (const part of parts) {
      switch (part.type) {
        case "text":
          blocks.push({ type: "text", text: part.text });
          break;
        case "image":
          blocks.push({
            type: "image",
            source: part.data
              ? { type: "base64", media_type: part.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: part.data }
              : { type: "url", url: part.url! },
          });
          break;
        case "file":
          blocks.push({
            type: "document",
            source: part.data
              ? { type: "base64", media_type: part.mimeType as "application/pdf", data: part.data }
              : { type: "url", url: part.url! },
          });
          break;
        case "audio":
          throw new KilnError("UNSUPPORTED_MODALITY", "Anthropic does not support audio tool result content blocks", {
            context: { modality: "audio", provider: "anthropic" },
          });
      }
    }
    return blocks as Anthropic.Messages.ToolResultBlockParam["content"];
  }

  private mapResponse(response: Anthropic.Messages.Message): AgentResponse {
    const responseParts: ContentPart[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        responseParts.push(textPart(block.text));
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: normalizeToolInput(block.name, block.input),
        });
      }
    }

    assertValidToolCallIds(toolCalls, { adapter: this.name });

    // Only add fallback empty text if there are no tool calls and no text
    const parts = responseParts.length > 0
      ? responseParts
      : toolCalls.length > 0 ? [] : [textPart("")];

    return {
      parts,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      contextUsage: { measurement: "provider_reported", cacheSemantics: "additive_to_input" },
      toolCalls,
      stopReason: response.stop_reason ?? "end_turn",
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
          return !(error instanceof Anthropic.APIError) ||
            RETRYABLE_STATUSES.has(error.status ?? 0);
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
        return !(error instanceof Anthropic.APIError) ||
          RETRYABLE_STATUSES.has(error.status ?? 0);
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

/**
 * Recursively validates that all object-type schemas have additionalProperties: false.
 * Required by Anthropic's constrained decoding.
 */
function assertAdditionalPropertiesFalse(
  schema: Record<string, unknown>,
  path = "$",
): void {
  if (schema.type === "object" && schema.additionalProperties !== false) {
    throw new KilnError(
      "STRUCTURED_OUTPUT_INVALID",
      `output_config requires additionalProperties: false on all objects (at ${path})`,
    );
  }

  if (typeof schema.properties === "object" && schema.properties !== null) {
    for (const [key, sub] of Object.entries(
      schema.properties as Record<string, Record<string, unknown>>,
    )) {
      assertAdditionalPropertiesFalse(sub, `${path}.${key}`);
    }
  }

  if (typeof schema.items === "object" && schema.items !== null) {
    assertAdditionalPropertiesFalse(
      schema.items as Record<string, unknown>,
      `${path}[]`,
    );
  }
}
