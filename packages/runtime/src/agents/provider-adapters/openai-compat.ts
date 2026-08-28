import type {
  ProviderAdapter,
  CreateMessageOptions,
  AgentResponse,
  AgentStreamEvent,
  ToolCall,
  ProviderTransportEvent,
  RetryOptions,
} from "@kilnai/core/agents";
import {
  admitDeliberationForExecution,
  assertValidToolCallIds,
  buildSyntheticToolCallId,
  normalizeToolInput,
  safeProviderRequestIdentity,
  withRetry,
} from "@kilnai/core/agents";
import type { ContentPart } from "@kilnai/core/engine";
import { extractText, KilnError, textPart } from "@kilnai/core/engine";
import {
  collectCanonicalToolNames,
  createProviderToolNameCodec,
  type ProviderToolNameCodec,
} from "./openai-tool-protocol/tool-name-codec.js";
import { toStrictToolSchema } from "./openai-tool-protocol/strict-tool-schema.js";

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
  stream_options?: { readonly include_usage: true };
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
  readonly prompt_tokens_details?: { readonly cached_tokens?: number };
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
  readonly delta?: OpenAIStreamDelta;
  readonly finish_reason?: string | null;
}

interface OpenAIStreamChunk {
  readonly id?: string;
  readonly choices: readonly OpenAIStreamChoice[];
  readonly usage?: OpenAIUsage;
  readonly error?: { readonly message?: string } | string;
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

  protected async createMessageViaStream(options: CreateMessageOptions): Promise<AgentResponse> {
    const request = this.buildRequest(options);
    request.body.stream = true;
    request.body.stream_options = { include_usage: true };
    const response = await withRetry(
      () => this.fetchResponse(request.body, options),
      this.retryOptions(),
      options.signal,
    );
    if (!response.ok) {
      const responseText = response.body ? await this.readResponseText(response.body, options) : await response.text();
      const error = new Error(`${this.name} API error ${response.status}: ${responseText}`);
      (error as unknown as Record<string, unknown>).status = response.status;
      (error as unknown as Record<string, unknown>).transportNoRetry = true;
      this.emitTransport(options, { type: "request_failed", identity: safeProviderRequestIdentity(options.requestIdentity), phase: "headers" });
      throw error;
    }
    if (!response.body) {
      throw new Error(`${this.name} streaming response has no body.`);
    }

    const reader = this.observeReader(response.body.getReader(), options);
    const decoder = new TextDecoder();
    const toolBuffers = new Map<number, StreamedToolCallBuffer>();
    let buffer = "";
    let text = "";
    let usage: OpenAIUsage | undefined;
    let finishReason: string | undefined;
    let terminal = false;
    const consumeLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) return;
      const data = trimmed.slice(6);
      if (data === "[DONE]") {
        terminal = true;
        this.emitTransport(options, { type: "request_completed", identity: safeProviderRequestIdentity(options.requestIdentity) });
        return;
      }
      const chunk = JSON.parse(data) as OpenAIStreamChunk;
      if (chunk.error) {
        const message = typeof chunk.error === "string" ? chunk.error : chunk.error.message;
        throw new Error(`${this.name} streaming API error: ${message ?? "unknown provider error"}`);
      }
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices[0];
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta;
      if (delta?.content) text += delta.content;
      for (const toolCall of delta?.tool_calls ?? []) {
        let toolBuffer = toolBuffers.get(toolCall.index);
        if (!toolBuffer) {
          toolBuffer = { id: "", name: toolCall.function?.name ?? "", arguments: "" };
          toolBuffers.set(toolCall.index, toolBuffer);
        }
        this.reconcileStreamedToolCallId(toolBuffer, toolCall.id, chunk.id, toolCall.index);
        if (toolCall.function?.name && !toolBuffer.name) toolBuffer.name = toolCall.function.name;
        if (toolCall.function?.arguments) toolBuffer.arguments += toolCall.function.arguments;
      }
    };

    try {
      while (!terminal) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          consumeLine(line);
          if (terminal) break;
        }
      }
      if (!terminal && buffer.trim().length > 0) consumeLine(buffer);
    } finally {
      reader.releaseLock();
    }
    if (!terminal && finishReason === undefined) {
      throw new Error(`${this.name} streaming response ended without a terminal signal.`);
    }
    if (!usage) {
      throw new Error(`${this.name} streaming response omitted required usage evidence.`);
    }
    const toolCalls: ToolCall[] = [...toolBuffers.values()].map((toolCall) => ({
      id: toolCall.id,
      name: request.toolNames.toCanonicalName(toolCall.name),
      input: normalizeToolInput(request.toolNames.toCanonicalName(toolCall.name), toolCall.arguments || "{}"),
    }));
    assertValidToolCallIds(toolCalls, { adapter: this.name });
    return {
      parts: text.length > 0 ? [textPart(text)] : [],
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
      toolCalls,
      stopReason: finishReason ?? "stop",
    };
  }

  async *streamMessage(
    options: CreateMessageOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    const request = this.buildRequest(options);
    request.body.stream = true;

    const response = await withRetry(
      () => this.fetchResponse(request.body, options),
      this.retryOptions(),
      options.signal,
    );

    if (!response.ok) {
      const text = response.body ? await this.readResponseText(response.body, options) : await response.text();
      const error = new Error(`${this.name} API error ${response.status}: ${text}`);
      (error as unknown as Record<string, unknown>).status = response.status;
      (error as unknown as Record<string, unknown>).transportNoRetry = true;
      this.emitTransport(options, { type: "request_failed", identity: safeProviderRequestIdentity(options.requestIdentity), phase: "headers" });
      throw error;
    }

    if (!response.body) {
      throw new Error(`${this.name} streaming response has no body.`);
    }

    const toolBuffers = new Map<number, StreamedToolCallBuffer>();

    const reader = this.observeReader(response.body.getReader(), options);
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
            this.emitTransport(options, { type: "request_completed", identity: safeProviderRequestIdentity(options.requestIdentity) });
            yield { type: "done", content: "" };
            return;
          }

          const chunk = JSON.parse(data) as OpenAIStreamChunk;
          if (chunk.error) {
            const message = typeof chunk.error === "string" ? chunk.error : chunk.error.message;
            throw new Error(`${this.name} streaming API error: ${message ?? "unknown provider error"}`);
          }
          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

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
              if (tc.function?.name && !buf.name) buf.name = tc.function.name;
              if (tc.function?.arguments) {
                buf.arguments += tc.function.arguments;
              }
            }
          }
        }
      }
      if (buffer.trim() === "data: [DONE]") {
        yield* this.flushStreamedToolCalls(toolBuffers, request.toolNames);
        toolBuffers.clear();
        this.emitTransport(options, { type: "request_completed", identity: safeProviderRequestIdentity(options.requestIdentity) });
        yield { type: "done", content: "" };
        return;
      }
    } finally {
      reader.releaseLock();
    }

    throw new Error(`${this.name} streaming response ended without a terminal signal.`);
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
      max_tokens: this.resolveMaxTokens(options),
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
          parameters: this.projectToolSchema(tool.strict === true ? toStrictToolSchema(tool.inputSchema) : tool.inputSchema),
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

  /** Provider-specific output ceilings are applied before wire serialization. */
  protected resolveMaxTokens(options: CreateMessageOptions): number {
    return options.maxTokens ?? 4096;
  }

  /** Provider-specific JSON-schema compatibility lowering. */
  protected projectToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
    return schema;
  }

  /** HTTP headers for API requests. Override in subclasses to add provider-specific headers. */
  protected buildHeaders(_options?: Pick<CreateMessageOptions, "sessionId" | "requestIdentity">): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async fetchResponse(body: OpenAIRequestBody, options: CreateMessageOptions): Promise<Response> {
    const timeout = options.transportWatchdog?.headerTimeoutMs;
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
      throw new KilnError("CONFIG_INVALID", "Provider transport watchdog timeout must be a positive finite number.");
    }
    const controller = new AbortController();
    const signal = timeout === undefined
      ? options.signal
      : options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const timer = timeout === undefined
      ? undefined
      : setTimeout(() => controller.abort(new ProviderTransportTimeoutError("headers")), timeout);
    this.emitTransport(options, { type: "request_started", identity: safeProviderRequestIdentity(options.requestIdentity) });
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(options),
        body: JSON.stringify(body),
        signal,
      });
      this.emitTransport(options, { type: "response_headers", identity: safeProviderRequestIdentity(options.requestIdentity), status: response.status });
      return response;
    } catch (error) {
      this.emitTransport(options, {
        type: "request_failed",
        identity: safeProviderRequestIdentity(options.requestIdentity),
        phase: error instanceof ProviderTransportTimeoutError || options.signal?.aborted || isAbortError(error) ? "headers" : "transport",
      });
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private emitTransport(options: CreateMessageOptions, event: ProviderTransportEvent): void {
    try {
      options.transportObserver?.onEvent(event);
    } catch {
      // Observers are diagnostic-only and cannot disrupt a provider request.
    }
  }

  private observeReader(reader: ReadableStreamDefaultReader<Uint8Array>, options: CreateMessageOptions): ObservedReader {
    const firstByteTimeout = options.transportWatchdog?.firstByteTimeoutMs;
    const chunkIdleTimeout = options.transportWatchdog?.chunkIdleTimeoutMs;
    assertWatchdogTimeout(firstByteTimeout);
    assertWatchdogTimeout(chunkIdleTimeout);
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) onCallerAbort();
    else options.signal?.addEventListener("abort", onCallerAbort, { once: true });
    const detachCallerAbort = () => options.signal?.removeEventListener("abort", onCallerAbort);
    let sawFirstByte = false;
    let timer = armReadWatchdog(firstByteTimeout, controller, "first_byte");
    return {
      read: async () => {
        const aborted = abortWhenSignalled(controller.signal);
        try {
          const result = await Promise.race([reader.read(), aborted.promise]);
          aborted.dispose();
          if (result.done) {
            clearReadWatchdog(timer);
            detachCallerAbort();
            this.emitTransport(options, { type: "request_completed", identity: safeProviderRequestIdentity(options.requestIdentity) });
            return result;
          }
          if (result.value.byteLength > 0) {
            if (!sawFirstByte) {
              sawFirstByte = true;
              this.emitTransport(options, { type: "response_first_byte", identity: safeProviderRequestIdentity(options.requestIdentity) });
            }
            clearReadWatchdog(timer);
            timer = armReadWatchdog(chunkIdleTimeout, controller, "chunk_idle");
            this.emitTransport(options, { type: "response_chunk", identity: safeProviderRequestIdentity(options.requestIdentity) });
          }
          return result;
        } catch (error) {
          aborted.dispose();
          clearReadWatchdog(timer);
          detachCallerAbort();
          // A timed-out read remains pending unless the underlying stream is cancelled.
          await reader.cancel(error).catch(() => undefined);
          this.emitTransport(options, {
            type: "request_failed",
            identity: safeProviderRequestIdentity(options.requestIdentity),
            phase: error instanceof ProviderReadTimeoutError
              ? error.phase
              : options.signal?.aborted || isAbortError(error)
                ? sawFirstByte ? "chunk_idle" : "first_byte"
                : "transport",
          });
          throw error;
        }
      },
      releaseLock: () => {
        clearReadWatchdog(timer);
        detachCallerAbort();
        try {
          reader.releaseLock();
        } catch {
          // Cancellation may still be settling after a watchdog timeout.
        }
      },
    };
  }

  private async sendRequest(body: OpenAIRequestBody, options: CreateMessageOptions): Promise<OpenAIChatResponse> {
    const response = await this.fetchResponse(body, options);

    if (!response.ok) {
      const text = response.body ? await this.readResponseText(response.body, options) : await response.text();
      const error = new Error(`${this.name} API error ${response.status}: ${text}`);
      (error as unknown as Record<string, unknown>).status = response.status;
      if (response.body) (error as unknown as Record<string, unknown>).transportNoRetry = true;
      throw error;
    }

    try {
      return response.body
        ? JSON.parse(await this.readResponseText(response.body, options)) as OpenAIChatResponse
        : await response.json() as OpenAIChatResponse;
    } catch (error) {
      if (response.body && typeof error === "object" && error !== null) {
        (error as Record<string, unknown>).transportNoRetry = true;
      }
      throw error;
    }
  }

  private async readResponseText(body: ReadableStream<Uint8Array> | null, options: CreateMessageOptions): Promise<string> {
    if (!body) return "";
    const reader = this.observeReader(body.getReader(), options);
    const decoder = new TextDecoder();
    let text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return text + decoder.decode();
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
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
          if (isTransportNoRetry(error)) return false;
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
        if (isTransportNoRetry(error)) return false;
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

function isTransportNoRetry(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as Record<string, unknown>).transportNoRetry === true;
}

interface ObservedReader {
  read(): Promise<ReadableStreamDefaultReadDoneResult | ReadableStreamDefaultReadValueResult<Uint8Array>>;
  releaseLock(): void;
}

class ProviderTransportTimeoutError extends Error {
  constructor(readonly phase: "headers") {
    super("Provider transport headers timeout.");
  }
}

class ProviderReadTimeoutError extends Error {
  constructor(readonly phase: "first_byte" | "chunk_idle") {
    super(`Provider transport ${phase} timeout.`);
  }
}

function assertWatchdogTimeout(timeout: number | undefined): void {
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
    throw new KilnError("CONFIG_INVALID", "Provider transport watchdog timeout must be a positive finite number.");
  }
}

function armReadWatchdog(
  timeout: number | undefined,
  controller: AbortController,
  phase: "first_byte" | "chunk_idle",
): ReturnType<typeof setTimeout> | undefined {
  return timeout === undefined
    ? undefined
    : setTimeout(() => controller.abort(new ProviderReadTimeoutError(phase)), timeout);
}

function clearReadWatchdog(timer: ReturnType<typeof setTimeout> | undefined): void {
  if (timer !== undefined) clearTimeout(timer);
}

function abortWhenSignalled(signal: AbortSignal): { readonly promise: Promise<never>; readonly dispose: () => void } {
  let dispose = () => undefined;
  const promise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    dispose = () => { signal.removeEventListener("abort", onAbort); };
  });
  return { promise, dispose };
}

function unsupportedModality(provider: string, modality: string, reason: string): KilnError {
  return new KilnError("UNSUPPORTED_MODALITY", `unsupported_modality: ${reason}`, {
    context: { provider, modality },
  });
}
