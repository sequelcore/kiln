import type {
  AgentResponse,
  AgentStreamEvent,
  CreateMessageOptions,
  ProviderAdapter,
  ReasoningEffort,
  ToolCall,
} from "../index.js";
import { textPart, extractText } from "../../engine/domain/content.js";
import type { ContentPart } from "../../engine/domain/content.js";
import { KilnError } from "../../engine/errors.js";
import { CodexOAuthAuth } from "./codex-oauth-auth.js";
import { normalizeToolInput } from "../tool-call-input.js";
import {
  collectCanonicalToolNames,
  createProviderToolNameCodec,
  type ProviderToolNameCodec,
} from "./tool-name-codec.js";
import { toStrictToolSchema } from "./strict-tool-schema.js";
import { withRetry } from "./retry.js";

const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const STREAMED_CONTENT_IDLE_MS = 2000;
const STREAMED_INCOMPLETE_TOOL_CALL_IDLE_MS = 30000;
const CODEX_OAUTH_TOOL_DEBUG =
  /^(1|true|yes)$/i.test(process.env.KILN_OPERATOR_TOOL_DEBUG?.trim() ?? "");

interface AccessTokenProvider {
  getValidAccessToken(): Promise<string>;
}

interface CodexOAuthAdapterConfig {
  readonly auth?: AccessTokenProvider;
  readonly defaultModel: string;
}

interface ResponsesInputItem {
  readonly role?: "user" | "assistant";
  readonly content?: string;
  readonly type?: "function_call" | "function_call_output";
  readonly call_id?: string;
  readonly name?: string;
  readonly arguments?: string;
  readonly output?: string;
}

interface ResponsesTool {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly strict?: boolean;
}

interface ResponsesRequestBody {
  readonly model: string;
  readonly instructions: string;
  readonly input: readonly ResponsesInputItem[];
  readonly store: false;
  readonly stream: true;
  readonly temperature?: number;
  readonly reasoning?: {
    readonly effort: ReasoningEffort;
  };
  readonly tools?: readonly ResponsesTool[];
}

interface ResponsesRequest {
  readonly body: ResponsesRequestBody;
  readonly toolNames: ProviderToolNameCodec;
  readonly toolSchemas: ReadonlyMap<string, Record<string, unknown>>;
}

interface ResponsesOutputItem {
  readonly type?: string;
  readonly id?: string;
  readonly call_id?: string;
  readonly name?: string;
  readonly arguments?: string;
  readonly content?: ReadonlyArray<{
    readonly type?: string;
    readonly text?: string;
  }>;
}

interface ResponsesUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly input_tokens_details?: {
    readonly cached_tokens?: number;
  };
}

interface ResponsesResponse {
  readonly id?: string;
  readonly status?: string;
  readonly output?: readonly ResponsesOutputItem[];
  readonly usage?: ResponsesUsage;
}

interface CompletedSseEnvelope {
  readonly response?: ResponsesResponse;
}

interface OutputItemAddedEnvelope {
  readonly item?: ResponsesOutputItem;
}

interface OutputItemDoneEnvelope {
  readonly item?: ResponsesOutputItem;
}

interface FunctionCallArgumentsDeltaEnvelope {
  readonly item_id?: string;
  readonly delta?: string;
}

interface FunctionCallArgumentsDoneEnvelope {
  readonly item_id?: string;
  readonly call_id?: string;
  readonly name?: string;
  readonly arguments?: string;
}

export class CodexOAuthAdapter implements ProviderAdapter {
  readonly name = "codex-oauth";

  private readonly auth: AccessTokenProvider;
  private readonly model: string;

  constructor(config: CodexOAuthAdapterConfig) {
    this.auth = config.auth ?? new CodexOAuthAuth();
    this.model = config.defaultModel.trim();
    if (this.model.length === 0) {
      throw new KilnError("CONFIG_INVALID", "Codex OAuth adapter requires a selected model");
    }
  }

  async createMessage(options: CreateMessageOptions): Promise<AgentResponse> {
    const request = this.buildRequest(options);
    try {
      return await this.createMessageAttempt(request, options);
    } catch (error) {
      if (!isEmptyTerminalStreamError(error)) {
        throw error;
      }
    }
    return await this.createMessageAttempt(request, options);
  }

  async *streamMessage(options: CreateMessageOptions): AsyncGenerator<AgentStreamEvent> {
    const request = this.buildRequest(options);
    const shouldBufferText = (options.tools?.length ?? 0) > 0;
    try {
      const response = await this.postWithTransientRetry(request.body, options.signal);
      yield* this.streamResponseAttempt(request, response, shouldBufferText);
      return;
    } catch (error) {
      if (!isEmptyTerminalStreamError(error)) {
        throw error;
      }
    }
    const response = await this.postWithTransientRetry(request.body, options.signal);
    yield* this.streamResponseAttempt(request, response, shouldBufferText);
  }

  private async createMessageAttempt(
    request: ResponsesRequest,
    options: CreateMessageOptions,
  ): Promise<AgentResponse> {
    const response = await this.postWithTransientRetry(request.body, options.signal);
    const completed = await this.consumeStreamingResponse(response, (options.tools?.length ?? 0) > 0);
    return this.mapResponse(completed, request.toolNames, request.toolSchemas);
  }

  private async *streamResponseAttempt(
    request: ResponsesRequest,
    response: Response,
    shouldBufferText: boolean,
  ): AsyncGenerator<AgentStreamEvent> {
    let collectedText = "";
    const collectedFunctionCallsByItemId = new Map<string, ResponsesOutputItem>();
    const collectedFunctionCallsByCallId = new Map<string, ResponsesOutputItem>();
    const collectedFunctionCallArguments = new Map<string, string>();
    const completedFunctionCallArgumentIds = new Set<string>();
    const invalidFunctionCallArgumentIds = new Set<string>();
    const emittedFunctionCallIds = new Set<string>();
    let collectedTextComplete = false;
    const buildMappedToolCallEvent = (toolCall: AgentResponse["toolCalls"][number]): AgentStreamEvent | null => {
      if (emittedFunctionCallIds.has(toolCall.id)) {
        return null;
      }
      emittedFunctionCallIds.add(toolCall.id);
      return {
        type: "tool_use",
        content: JSON.stringify({
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        }),
      };
    };

    if (!response.body) {
      throw this.providerError("Codex OAuth streaming response body was empty", {
        status: response.status,
      });
    }

    for await (const event of this.parseSse(response.body, {
      shouldStopOnIdle: () =>
        hasStreamedFallbackResponse({
          collectedText,
          collectedTextComplete,
          collectedFunctionCalls: [
            ...collectedFunctionCallsByItemId.values(),
            ...collectedFunctionCallsByCallId.values(),
          ],
          completedFunctionCallArgumentIds,
        })
        || hasIncompleteStreamedFunctionCall({
          collectedFunctionCalls: [
            ...collectedFunctionCallsByItemId.values(),
            ...collectedFunctionCallsByCallId.values(),
          ],
          collectedFunctionCallArgumentIds: [...collectedFunctionCallArguments.keys()],
          completedFunctionCallArgumentIds,
        }),
      idleMs: () =>
        shouldBufferText
          ? STREAMED_INCOMPLETE_TOOL_CALL_IDLE_MS
          : [
            ...collectedFunctionCallsByItemId.values(),
            ...collectedFunctionCallsByCallId.values(),
          ].some((item) => item.type === "function_call")
            ? STREAMED_INCOMPLETE_TOOL_CALL_IDLE_MS
            : STREAMED_CONTENT_IDLE_MS,
    })) {
      if (event.event === "response.output_text.delta") {
        const delta = this.parseJsonString<{ delta?: string }>(event.data);
        if (delta.delta) {
          collectedText += delta.delta;
          if (shouldBufferText) {
            continue;
          }
          yield { type: "text", content: delta.delta };
        }
        continue;
      }

      if (event.event === "response.output_text.done") {
        const done = this.parseJsonString<{ text?: string }>(event.data);
        if (typeof done.text === "string" && done.text.length > 0) {
          collectedText = done.text;
        }
        collectedTextComplete = true;
        continue;
      }

      if (event.event === "response.output_item.added") {
        const added = this.parseJsonString<OutputItemAddedEnvelope>(event.data);
        if (added.item?.type === "function_call") {
          if (added.item.id) {
            collectedFunctionCallsByItemId.set(added.item.id, added.item);
          }
          if (added.item.call_id) {
            collectedFunctionCallsByCallId.set(added.item.call_id, added.item);
          }
        }
        continue;
      }

      if (event.event === "response.output_item.done") {
        const done = this.parseJsonString<OutputItemDoneEnvelope>(event.data);
        const item = done.item;
        if (item?.type === "function_call") {
          const existing = item.id ? collectedFunctionCallsByItemId.get(item.id) : undefined;
          const hadPriorArguments = hasKnownFunctionCallArguments({
            item,
            existing,
            collectedFunctionCallArguments,
          });
          const mergedItem: ResponsesOutputItem = {
            ...(existing ?? {}),
            ...item,
            call_id: item.call_id ?? existing?.call_id,
            name: item.name ?? existing?.name,
            arguments: preferCompletedFunctionCallArguments(existing?.arguments, item.arguments),
          };
          const hasFinalArguments = typeof item.arguments === "string" && item.arguments.length > 0;
          if (!hasFinalArguments && hadPriorArguments) {
            addFunctionCallIds(invalidFunctionCallArgumentIds, item.id, item.call_id, mergedItem.id, mergedItem.call_id);
          }
          if (mergedItem.id) {
            collectedFunctionCallsByItemId.set(mergedItem.id, mergedItem);
            if (hasFinalArguments) {
              completedFunctionCallArgumentIds.add(mergedItem.id);
              invalidFunctionCallArgumentIds.delete(mergedItem.id);
            }
          }
          if (mergedItem.call_id) {
            collectedFunctionCallsByCallId.set(mergedItem.call_id, mergedItem);
            if (hasFinalArguments) {
              completedFunctionCallArgumentIds.add(mergedItem.call_id);
              invalidFunctionCallArgumentIds.delete(mergedItem.call_id);
            }
          }
          if (mergedItem.id && typeof mergedItem.arguments === "string") {
            collectedFunctionCallArguments.set(mergedItem.id, mergedItem.arguments);
          }
          if (mergedItem.call_id && typeof mergedItem.arguments === "string") {
            collectedFunctionCallArguments.set(mergedItem.call_id, mergedItem.arguments);
          }
        }
        continue;
      }

      if (event.event === "response.function_call_arguments.delta") {
        const delta = this.parseJsonString<FunctionCallArgumentsDeltaEnvelope>(event.data);
        if (delta.item_id && typeof delta.delta === "string") {
          const current = collectedFunctionCallArguments.get(delta.item_id) ?? "";
          collectedFunctionCallArguments.set(delta.item_id, current + delta.delta);
        }
        continue;
      }

      if (event.event === "response.function_call_arguments.done") {
        const done = this.parseJsonString<FunctionCallArgumentsDoneEnvelope>(event.data);
        if (done.item_id && (typeof done.arguments !== "string" || done.arguments.length === 0)) {
          addFunctionCallIds(invalidFunctionCallArgumentIds, done.item_id, done.call_id);
        }
        if (done.item_id && typeof done.arguments === "string") {
          collectedFunctionCallArguments.set(done.item_id, done.arguments);
          if (done.arguments.length > 0) {
            completedFunctionCallArgumentIds.add(done.item_id);
            invalidFunctionCallArgumentIds.delete(done.item_id);
          }
          if (done.call_id) {
            collectedFunctionCallArguments.set(done.call_id, done.arguments);
            if (done.arguments.length > 0) {
              completedFunctionCallArgumentIds.add(done.call_id);
              invalidFunctionCallArgumentIds.delete(done.call_id);
            }
          }
        }
        if (done.item_id) {
          const existing = collectedFunctionCallsByItemId.get(done.item_id);
          const mergedItem: ResponsesOutputItem = {
            ...(existing ?? {}),
            type: "function_call",
            id: existing?.id ?? done.item_id,
            call_id: existing?.call_id ?? done.call_id,
            name: existing?.name ?? done.name,
            arguments: preferCompletedFunctionCallArguments(existing?.arguments, done.arguments),
          };
          collectedFunctionCallsByItemId.set(done.item_id, mergedItem);
          if (mergedItem.call_id) {
            collectedFunctionCallsByCallId.set(mergedItem.call_id, mergedItem);
            if (typeof done.arguments !== "string" || done.arguments.length === 0) {
              invalidFunctionCallArgumentIds.add(mergedItem.call_id);
            }
            if (typeof done.arguments === "string") {
              collectedFunctionCallArguments.set(mergedItem.call_id, done.arguments);
              if (done.arguments.length > 0) {
                completedFunctionCallArgumentIds.add(mergedItem.call_id);
                invalidFunctionCallArgumentIds.delete(mergedItem.call_id);
              } else {
                invalidFunctionCallArgumentIds.add(mergedItem.call_id);
              }
            }
          }
        }
        continue;
      }

      if (event.event === "response.completed") {
        const completed = this.parseJsonString<CompletedSseEnvelope>(event.data);
        const completedResponse = this.applyStreamingFallbacks(
          completed.response ?? {},
          collectedText,
          [...new Map(
            [
              ...collectedFunctionCallsByItemId.values(),
              ...collectedFunctionCallsByCallId.values(),
            ].map((item) => [(item.call_id ?? item.id ?? ""), item]),
          ).values()],
          collectedFunctionCallsByItemId,
          collectedFunctionCallsByCallId,
          collectedFunctionCallArguments,
          completedFunctionCallArgumentIds,
          invalidFunctionCallArgumentIds,
        );
        const mapped = this.mapResponse(completedResponse, request.toolNames, request.toolSchemas);
        if (shouldBufferText) {
          for (const part of mapped.parts) {
            if (part.type === "text" && part.text.length > 0) {
              yield { type: "text", content: part.text };
            }
          }
        }
        for (const toolCall of mapped.toolCalls) {
          const toolUseEvent = buildMappedToolCallEvent(toolCall);
          if (toolUseEvent) {
            yield toolUseEvent;
          }
        }
        yield {
          type: "done",
          content: "",
          response: mapped,
          inputTokens: mapped.inputTokens,
          outputTokens: mapped.outputTokens,
        } as AgentStreamEvent & {
          readonly response: AgentResponse;
          readonly inputTokens: number;
          readonly outputTokens: number;
        };
        return;
      }
    }

    const fallbackResponse = buildStreamedFallbackResponse({
      collectedText,
      collectedTextComplete,
      collectedFunctionCalls: [
        ...collectedFunctionCallsByItemId.values(),
        ...collectedFunctionCallsByCallId.values(),
      ],
      completedFunctionCallArgumentIds,
    });
    if (fallbackResponse) {
      const mapped = this.mapResponse(fallbackResponse, request.toolNames, request.toolSchemas);
      if (shouldBufferText) {
        for (const part of mapped.parts) {
          if (part.type === "text" && part.text.length > 0) {
            yield { type: "text", content: part.text };
          }
        }
      }
      for (const toolCall of mapped.toolCalls) {
        const toolUseEvent = buildMappedToolCallEvent(toolCall);
        if (toolUseEvent) {
          yield toolUseEvent;
        }
      }
      yield {
        type: "done",
        content: "",
        response: mapped,
        inputTokens: mapped.inputTokens,
        outputTokens: mapped.outputTokens,
      } as AgentStreamEvent & {
        readonly response: AgentResponse;
        readonly inputTokens: number;
        readonly outputTokens: number;
      };
      return;
    }

    throw this.missingResponseCompletedError({
      status: response.status,
      collectedText,
      collectedTextComplete,
      collectedFunctionCalls: [
        ...collectedFunctionCallsByItemId.values(),
        ...collectedFunctionCallsByCallId.values(),
      ],
    });
  }

  private buildRequest(
    options: CreateMessageOptions,
  ): ResponsesRequest {
    const input: ResponsesInputItem[] = [];
    const toolNames = createProviderToolNameCodec(collectCanonicalToolNames(options));

    for (const message of options.messages) {
      input.push(...this.mapMessageToInputItems(message.role, message.parts, toolNames));
    }

    const tools = options.tools?.map((tool) => ({
      type: "function" as const,
      name: toolNames.toProviderName(tool.name),
      description: tool.description,
      parameters: toStrictToolSchema(tool.inputSchema),
      strict: true,
    }));
    if (CODEX_OAUTH_TOOL_DEBUG) {
      console.warn("[codex-oauth-tools][debug] request tools", {
        model: this.model,
        toolCount: tools?.length ?? 0,
        toolNames: tools?.map((tool) => tool.name) ?? [],
        hasOperatorSetTheme: tools?.some((tool) => tool.name === "operator_set_theme") ?? false,
      });
    }

    return {
      body: {
        model: this.model,
        instructions: options.system,
        input,
        store: false,
        stream: true,
        ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
        ...(tools ? { tools } : {}),
      },
      toolNames,
      toolSchemas: new Map(options.tools?.map((tool) => [tool.name, tool.inputSchema]) ?? []),
    };
  }

  private mapMessageToInputItems(
    role: "user" | "assistant",
    parts: readonly ContentPart[],
    toolNames: ProviderToolNameCodec,
  ): ResponsesInputItem[] {
    const items: ResponsesInputItem[] = [];
    const textContent = extractText(parts);

    if (textContent.length > 0) {
      items.push({
        role,
        content: textContent,
      });
    }

    for (const part of parts) {
      if (part.type === "tool_use") {
        items.push({
          type: "function_call",
          call_id: part.id,
          name: toolNames.toProviderName(part.name),
          arguments: JSON.stringify(part.input),
        });
        continue;
      }

      if (part.type === "tool_result") {
        items.push({
          type: "function_call_output",
          call_id: part.toolUseId,
          output: part.content,
        });
      }
    }

    return items;
  }

  private async postWith401Retry(body: ResponsesRequestBody, signal?: AbortSignal): Promise<Response> {
    const firstResponse = await this.post(body, signal);
    if (firstResponse.status !== 401) {
      await this.ensureOk(firstResponse, body);
      return firstResponse;
    }

    const retryResponse = await this.post(body, signal);
    if (retryResponse.status === 401) {
      throw this.providerAuthError("Codex OAuth request unauthorized after token refresh", {
        status: retryResponse.status,
      });
    }

    await this.ensureOk(retryResponse, body);
    return retryResponse;
  }

  private async postWithTransientRetry(body: ResponsesRequestBody, signal?: AbortSignal): Promise<Response> {
    return await withRetry(
      () => this.postWith401Retry(body, signal),
      {
        maxRetries: 3,
        baseDelayMs: 250,
        isRetryable: isTransientCodexRequestError,
      },
      signal,
    );
  }

  private async post(body: ResponsesRequestBody, signal?: AbortSignal): Promise<Response> {
    const token = await this.auth.getValidAccessToken();
    return await fetch(RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  private async ensureOk(response: Response, requestBody?: ResponsesRequestBody): Promise<void> {
    if (response.ok) {
      return;
    }

    let responseBody = "";
    try {
      responseBody = await response.text();
    } catch {
      responseBody = "";
    }

    throw this.providerHttpError("Codex OAuth request failed", {
      status: response.status,
      responseBody,
      toolReplaySummary: requestBody ? this.summarizeToolReplay(requestBody) : undefined,
    });
  }

  private mapResponse(
    response: ResponsesResponse,
    toolNames: ProviderToolNameCodec,
    toolSchemas: ReadonlyMap<string, Record<string, unknown>>,
  ): AgentResponse & {
    readonly cost: {
      readonly inputPer1M: number;
      readonly outputPer1M: number;
    };
  } {
    const parts: ContentPart[] = [];
    const toolCalls: ToolCall[] = [];
    const outputItems = response.output ?? [];
    const functionCallItems = outputItems.filter((item) => item.type === "function_call");

    for (const item of outputItems) {
      if (item.type === "message") {
        const text = (item.content ?? [])
          .filter((content) => content.type === "output_text" && typeof content.text === "string")
          .map((content) => content.text ?? "")
          .join("");
        const visibleText = stripLeakedFunctionCallText(text, functionCallItems);

        if (visibleText.length > 0) {
          parts.push(textPart(visibleText));
        }
      }

      if (item.type === "function_call") {
        const canonicalName = toolNames.toCanonicalName(item.name ?? "");
        toolCalls.push({
          id: item.call_id ?? item.id ?? "",
          name: canonicalName,
          input: normalizeToolInput(canonicalName, item.arguments, toolSchemas.get(canonicalName)),
        });
      }
    }

    return {
      parts,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
      contextUsage: { measurement: "provider_reported", cacheSemantics: "included_in_input" },
      toolCalls,
      stopReason: response.status ?? "completed",
      cost: {
        inputPer1M: 0,
        outputPer1M: 0,
      },
    };
  }

  private async consumeStreamingResponse(response: Response, hasTools: boolean): Promise<ResponsesResponse> {
    if (!response.body) {
      throw this.providerError("Codex OAuth streaming response body was empty", {
        status: response.status,
      });
    }

    let completed: ResponsesResponse | null = null;
    let collectedText = "";
    const collectedFunctionCallsByItemId = new Map<string, ResponsesOutputItem>();
    const collectedFunctionCallsByCallId = new Map<string, ResponsesOutputItem>();
    const collectedFunctionCallArguments = new Map<string, string>();
    const completedFunctionCallArgumentIds = new Set<string>();
    const invalidFunctionCallArgumentIds = new Set<string>();
    let collectedTextComplete = false;

    for await (const event of this.parseSse(response.body, {
      shouldStopOnIdle: () =>
        hasStreamedFallbackResponse({
          collectedText,
          collectedTextComplete,
          collectedFunctionCalls: [
            ...collectedFunctionCallsByItemId.values(),
            ...collectedFunctionCallsByCallId.values(),
          ],
          completedFunctionCallArgumentIds,
        })
        || hasIncompleteStreamedFunctionCall({
          collectedFunctionCalls: [
            ...collectedFunctionCallsByItemId.values(),
            ...collectedFunctionCallsByCallId.values(),
          ],
          collectedFunctionCallArgumentIds: [...collectedFunctionCallArguments.keys()],
          completedFunctionCallArgumentIds,
        }),
      idleMs: () =>
        hasTools
          ? STREAMED_INCOMPLETE_TOOL_CALL_IDLE_MS
          : [
            ...collectedFunctionCallsByItemId.values(),
            ...collectedFunctionCallsByCallId.values(),
          ].some((item) => item.type === "function_call")
            ? STREAMED_INCOMPLETE_TOOL_CALL_IDLE_MS
            : STREAMED_CONTENT_IDLE_MS,
    })) {
      if (event.event === "response.output_text.delta") {
        const delta = this.parseJsonString<{ delta?: string }>(event.data);
        if (typeof delta.delta === "string") {
          collectedText += delta.delta;
        }
        continue;
      }

      if (event.event === "response.output_text.done") {
        const done = this.parseJsonString<{ text?: string }>(event.data);
        if (typeof done.text === "string" && done.text.length > 0) {
          collectedText = done.text;
        }
        collectedTextComplete = true;
        continue;
      }

      if (event.event === "response.output_item.added") {
        const added = this.parseJsonString<OutputItemAddedEnvelope>(event.data);
        const item = added.item;
        if (item?.type === "function_call") {
          if (item.id) {
            collectedFunctionCallsByItemId.set(item.id, item);
          }
          if (item.call_id) {
            collectedFunctionCallsByCallId.set(item.call_id, item);
          }
        }
        continue;
      }

      if (event.event === "response.output_item.done") {
        const done = this.parseJsonString<OutputItemDoneEnvelope>(event.data);
        const item = done.item;
        if (item?.type === "function_call") {
          const existing = item.id ? collectedFunctionCallsByItemId.get(item.id) : undefined;
          const hadPriorArguments = hasKnownFunctionCallArguments({
            item,
            existing,
            collectedFunctionCallArguments,
          });
          const mergedItem: ResponsesOutputItem = {
            ...(existing ?? {}),
            ...item,
            call_id: item.call_id ?? existing?.call_id,
            name: item.name ?? existing?.name,
            arguments: preferCompletedFunctionCallArguments(existing?.arguments, item.arguments),
          };
          const hasFinalArguments = typeof item.arguments === "string" && item.arguments.length > 0;
          if (!hasFinalArguments && hadPriorArguments) {
            addFunctionCallIds(invalidFunctionCallArgumentIds, item.id, item.call_id, mergedItem.id, mergedItem.call_id);
          }
          if (mergedItem.id) {
            collectedFunctionCallsByItemId.set(mergedItem.id, mergedItem);
            if (hasFinalArguments) {
              completedFunctionCallArgumentIds.add(mergedItem.id);
              invalidFunctionCallArgumentIds.delete(mergedItem.id);
            }
          }
          if (mergedItem.call_id) {
            collectedFunctionCallsByCallId.set(mergedItem.call_id, mergedItem);
            if (hasFinalArguments) {
              completedFunctionCallArgumentIds.add(mergedItem.call_id);
              invalidFunctionCallArgumentIds.delete(mergedItem.call_id);
            }
          }
          if (mergedItem.id && typeof mergedItem.arguments === "string") {
            collectedFunctionCallArguments.set(mergedItem.id, mergedItem.arguments);
          }
          if (mergedItem.call_id && typeof mergedItem.arguments === "string") {
            collectedFunctionCallArguments.set(mergedItem.call_id, mergedItem.arguments);
          }
        }
        continue;
      }

      if (event.event === "response.function_call_arguments.delta") {
        const delta = this.parseJsonString<FunctionCallArgumentsDeltaEnvelope>(event.data);
        if (delta.item_id && typeof delta.delta === "string") {
          const current = collectedFunctionCallArguments.get(delta.item_id) ?? "";
          collectedFunctionCallArguments.set(delta.item_id, current + delta.delta);
        }
        continue;
      }

      if (event.event === "response.function_call_arguments.done") {
        const done = this.parseJsonString<FunctionCallArgumentsDoneEnvelope>(event.data);
        if (done.item_id && (typeof done.arguments !== "string" || done.arguments.length === 0)) {
          addFunctionCallIds(invalidFunctionCallArgumentIds, done.item_id, done.call_id);
        }
        if (done.item_id && typeof done.arguments === "string") {
          collectedFunctionCallArguments.set(done.item_id, done.arguments);
          if (done.arguments.length > 0) {
            completedFunctionCallArgumentIds.add(done.item_id);
            invalidFunctionCallArgumentIds.delete(done.item_id);
          }
          if (done.call_id) {
            collectedFunctionCallArguments.set(done.call_id, done.arguments);
            if (done.arguments.length > 0) {
              completedFunctionCallArgumentIds.add(done.call_id);
              invalidFunctionCallArgumentIds.delete(done.call_id);
            }
          }
        }
        if (done.item_id) {
          const existing = collectedFunctionCallsByItemId.get(done.item_id);
          const mergedItem: ResponsesOutputItem = {
            ...(existing ?? {}),
            type: "function_call",
            id: existing?.id ?? done.item_id,
            call_id: existing?.call_id ?? done.call_id,
            name: existing?.name ?? done.name,
            arguments: preferCompletedFunctionCallArguments(existing?.arguments, done.arguments),
          };
          collectedFunctionCallsByItemId.set(done.item_id, mergedItem);
          if (mergedItem.call_id) {
            collectedFunctionCallsByCallId.set(mergedItem.call_id, mergedItem);
            if (typeof done.arguments !== "string" || done.arguments.length === 0) {
              invalidFunctionCallArgumentIds.add(mergedItem.call_id);
            }
            if (typeof done.arguments === "string") {
              collectedFunctionCallArguments.set(mergedItem.call_id, done.arguments);
              if (done.arguments.length > 0) {
                completedFunctionCallArgumentIds.add(mergedItem.call_id);
                invalidFunctionCallArgumentIds.delete(mergedItem.call_id);
              } else {
                invalidFunctionCallArgumentIds.add(mergedItem.call_id);
              }
            }
          }
        }
        continue;
      }

      if (event.event === "response.completed") {
        completed = this.parseJsonString<CompletedSseEnvelope>(event.data).response ?? null;
        if (completed) {
          return this.applyStreamingFallbacks(
            completed,
            collectedText,
            [...new Map(
              [
                ...collectedFunctionCallsByItemId.values(),
                ...collectedFunctionCallsByCallId.values(),
              ].map((item) => [(item.call_id ?? item.id ?? ""), item]),
            ).values()],
            collectedFunctionCallsByItemId,
            collectedFunctionCallsByCallId,
            collectedFunctionCallArguments,
            completedFunctionCallArgumentIds,
            invalidFunctionCallArgumentIds,
          );
        }
      }
    }

    if (completed) {
      return this.applyStreamingFallbacks(
        completed,
        collectedText,
        [...new Map(
          [
            ...collectedFunctionCallsByItemId.values(),
            ...collectedFunctionCallsByCallId.values(),
          ].map((item) => [(item.call_id ?? item.id ?? ""), item]),
        ).values()],
        collectedFunctionCallsByItemId,
        collectedFunctionCallsByCallId,
        collectedFunctionCallArguments,
        completedFunctionCallArgumentIds,
        invalidFunctionCallArgumentIds,
      );
    }

    const fallbackResponse = buildStreamedFallbackResponse({
      collectedText,
      collectedTextComplete,
      collectedFunctionCalls: [
        ...collectedFunctionCallsByItemId.values(),
        ...collectedFunctionCallsByCallId.values(),
      ],
      completedFunctionCallArgumentIds,
    });
    if (fallbackResponse) {
      return fallbackResponse;
    }

    throw this.missingResponseCompletedError({
      status: response.status,
      collectedText,
      collectedTextComplete,
      collectedFunctionCalls: [
        ...collectedFunctionCallsByItemId.values(),
        ...collectedFunctionCallsByCallId.values(),
      ],
    });
  }

  private parseJsonString<T>(value: string): T {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      throw this.providerError("Failed to parse Codex OAuth payload", {}, error);
    }
  }

  private async *parseSse(
    stream: ReadableStream<Uint8Array>,
    options: {
      readonly shouldStopOnIdle?: () => boolean;
      readonly idleMs?: number | (() => number);
    } = {},
  ): AsyncGenerator<{ readonly event: string; readonly data: string }> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const readResult = await readNextSseChunk(reader, options);
      if (readResult === "idle") {
        reader.cancel("complete stream content received without terminal response event").catch(() => undefined);
        break;
      }
      const { value, done } = readResult;
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const separator = this.findSseSeparator(buffer);
        if (!separator) {
          break;
        }

        const rawEvent = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        const parsed = this.parseSseEvent(rawEvent);
        if (parsed) {
          yield parsed;
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const parsed = this.parseSseEvent(buffer);
      if (parsed) {
        yield parsed;
      }
    }
  }

  private parseSseEvent(rawEvent: string): { readonly event: string; readonly data: string } | null {
    const eventLines = rawEvent.replace(/\r/g, "").split("\n");
    let eventName = "";
    const dataLines: string[] = [];

    for (const line of eventLines) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    if (!eventName || dataLines.length === 0) {
      return null;
    }

    return {
      event: eventName,
      data: dataLines.join("\n"),
    };
  }

  private applyStreamingFallbacks(
    response: ResponsesResponse,
    collectedText: string,
    collectedFunctionCalls: readonly ResponsesOutputItem[],
    collectedFunctionCallsByItemId: ReadonlyMap<string, ResponsesOutputItem>,
    collectedFunctionCallsByCallId: ReadonlyMap<string, ResponsesOutputItem>,
    collectedFunctionCallArguments: ReadonlyMap<string, string>,
    completedFunctionCallArgumentIds: ReadonlySet<string>,
    invalidFunctionCallArgumentIds: ReadonlySet<string>,
  ): ResponsesResponse {
    let nextOutput = [...(response.output ?? [])];

    const hasMessageText = nextOutput.some((item) =>
      item.type === "message"
      && (item.content ?? []).some((content) => content.type === "output_text" && typeof content.text === "string" && content.text.length > 0),
    );

    if (!hasMessageText && collectedText.length > 0) {
      nextOutput = [
        ...nextOutput,
        {
          type: "message",
          content: [{ type: "output_text", text: collectedText }],
        },
      ];
    }

    const seenFunctionCallIds = new Set(
      nextOutput
        .filter((item) => item.type === "function_call")
        .map((item) => item.call_id
          ?? (item.id ? collectedFunctionCallsByItemId.get(item.id)?.call_id : undefined)
          ?? item.id)
        .filter((functionCallId): functionCallId is string => typeof functionCallId === "string" && functionCallId.length > 0),
    );
    const missingFunctionCalls = collectedFunctionCalls.filter((item) => {
      const functionCallId = item.call_id ?? item.id;
      return functionCallId && !seenFunctionCallIds.has(functionCallId);
    });
    const incompleteMissingFunctionCalls = missingFunctionCalls.filter((item) =>
      !isCompleteFunctionCallItem(item, completedFunctionCallArgumentIds),
    );
    if (incompleteMissingFunctionCalls.length > 0) {
      throw this.providerError("Codex OAuth response.completed omitted incomplete streamed function-call arguments", {
        missingFunctionCallIds: incompleteMissingFunctionCalls
          .map((item) => item.call_id ?? item.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      });
    }
    if (missingFunctionCalls.length > 0) {
      nextOutput = [...nextOutput, ...missingFunctionCalls];
    }

    nextOutput = nextOutput.map((item) => {
      if (item.type !== "function_call") {
        return item;
      }
      const collectedCall = (item.id ? collectedFunctionCallsByItemId.get(item.id) : undefined)
        ?? (item.call_id ? collectedFunctionCallsByCallId.get(item.call_id) : undefined);
      const functionCallId = item.call_id ?? collectedCall?.call_id ?? item.id;
      if (!functionCallId && !collectedCall) {
        return item;
      }
      const argumentsText = findCompletedFunctionCallArguments({
        item,
        collectedCall,
        collectedFunctionCallArguments,
        completedFunctionCallArgumentIds,
      });
      return {
        ...item,
        ...(!item.call_id && collectedCall?.call_id ? { call_id: collectedCall.call_id } : {}),
        ...(!item.name && collectedCall?.name ? { name: collectedCall.name } : {}),
        ...(argumentsText ? { arguments: argumentsText } : {}),
      };
    });

    const incompleteOutputFunctionCalls = nextOutput.filter((item) => {
      if (item.type !== "function_call") {
        return false;
      }
      const collectedCall = (item.id ? collectedFunctionCallsByItemId.get(item.id) : undefined)
        ?? (item.call_id ? collectedFunctionCallsByCallId.get(item.call_id) : undefined);
      const hasInvalidatedArguments = functionCallIdentityIds(item, collectedCall)
        .some((id) => invalidFunctionCallArgumentIds.has(id));
      return collectedCall !== undefined
        && !isCompleteFunctionCallItem(item, completedFunctionCallArgumentIds)
        && (hasInvalidatedArguments || !hasParseableFunctionCallArguments(item.arguments));
    });
    if (incompleteOutputFunctionCalls.length > 0) {
      throw this.providerError("Codex OAuth response.completed included incomplete streamed function-call arguments", {
        functionCallIds: incompleteOutputFunctionCalls
          .map((item) => item.call_id ?? item.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      });
    }

    return {
      ...response,
      output: nextOutput,
    };
  }

  private findSseSeparator(
    buffer: string,
  ): { readonly index: number; readonly length: number } | null {
    const crlfIndex = buffer.indexOf("\r\n\r\n");
    if (crlfIndex !== -1) {
      return { index: crlfIndex, length: 4 };
    }

    const lfIndex = buffer.indexOf("\n\n");
    if (lfIndex !== -1) {
      return { index: lfIndex, length: 2 };
    }

    return null;
  }

  private providerError(message: string, context: Record<string, unknown>, cause?: unknown): KilnError {
    return new KilnError("PROVIDER_UNAVAILABLE", message, { context, cause, retryable: true });
  }

  private missingResponseCompletedError(input: {
    readonly status: number;
    readonly collectedText: string;
    readonly collectedTextComplete: boolean;
    readonly collectedFunctionCalls: readonly ResponsesOutputItem[];
  }): KilnError {
    const streamedFunctionCallCount = input.collectedFunctionCalls
      .filter((item) => item.type === "function_call")
      .length;
    return this.providerError("Codex OAuth stream completed without response.completed event", {
      status: input.status,
      collectedText: input.collectedText,
      collectedTextComplete: input.collectedTextComplete,
      streamedFunctionCallCount,
      hasStreamedOutput: input.collectedText.length > 0
        || input.collectedTextComplete
        || streamedFunctionCallCount > 0,
    });
  }

  private providerAuthError(message: string, context: Record<string, unknown>, cause?: unknown): KilnError {
    return new KilnError("PROVIDER_AUTH_FAILED", message, { context, cause });
  }

  private providerHttpError(message: string, context: Record<string, unknown>, cause?: unknown): KilnError {
    const status = typeof context.status === "number" ? context.status : undefined;
    if (status === 401 || status === 403) {
      return this.providerAuthError(message, context, cause);
    }
    if (status === 429) {
      return new KilnError("PROVIDER_RATE_LIMITED", message, {
        context,
        cause,
        retryable: true,
      });
    }
    if (status === 402) {
      return new KilnError("PROVIDER_QUOTA_EXCEEDED", message, {
        context,
        cause,
        retryable: false,
      });
    }
    return this.providerError(message, context, cause);
  }

  private summarizeToolReplay(requestBody: ResponsesRequestBody): string | undefined {
    const functionCallIds: string[] = [];
    const functionCallOutputIds: string[] = [];

    for (const item of requestBody.input) {
      if (item.type === "function_call" && item.call_id) {
        functionCallIds.push(item.call_id);
      } else if (item.type === "function_call_output" && item.call_id) {
        functionCallOutputIds.push(item.call_id);
      }
    }

    if (functionCallIds.length === 0 && functionCallOutputIds.length === 0) {
      return undefined;
    }

    return `function_calls=[${functionCallIds.join(", ")}]; function_call_outputs=[${functionCallOutputIds.join(", ")}]`;
  }
}

function isTransientCodexRequestError(error: unknown): boolean {
  return error instanceof KilnError
    && error.code === "PROVIDER_UNAVAILABLE"
    && error.retryable;
}

function stripLeakedFunctionCallText(
  text: string,
  functionCalls: readonly ResponsesOutputItem[],
): string {
  if (text.length === 0 || functionCalls.length === 0) {
    return text;
  }

  let remaining = text;
  let stripped = false;
  const maxPasses = Math.max(4, functionCalls.length * 4);

  for (let pass = 0; pass < maxPasses; pass++) {
    const next = stripOneLeakedFunctionCallPrefix(remaining, functionCalls);
    if (next === remaining) {
      break;
    }
    remaining = next;
    stripped = true;
  }

  return stripped ? remaining.trimStart() : text;
}

type SseReadResult =
  | { readonly done: false; readonly value: Uint8Array }
  | { readonly done: true; readonly value?: Uint8Array };

async function readNextSseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: {
    readonly shouldStopOnIdle?: () => boolean;
    readonly idleMs?: number | (() => number);
  },
): Promise<SseReadResult | "idle"> {
  if (options.shouldStopOnIdle?.() !== true) {
    return await reader.read();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<"idle">((resolve) => {
        const idleMs = typeof options.idleMs === "function" ? options.idleMs() : options.idleMs;
        timer = setTimeout(() => resolve("idle"), idleMs ?? STREAMED_CONTENT_IDLE_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function buildStreamedFunctionCallResponse(input: {
  readonly collectedFunctionCalls: readonly ResponsesOutputItem[];
  readonly completedFunctionCallArgumentIds: ReadonlySet<string>;
}): ResponsesResponse | null {
  const functionCalls = [...new Map(
    input.collectedFunctionCalls
      .filter((item) => item.type === "function_call")
      .map((item) => [item.call_id ?? item.id ?? "", item]),
  ).values()];
  if (functionCalls.length === 0) {
    return null;
  }
  if (functionCalls.some((item) => !isCompleteFunctionCallItem(item, input.completedFunctionCallArgumentIds))) {
    return null;
  }

  return {
    status: "tool_calls_streamed",
    output: functionCalls,
  };
}

function buildStreamedTextResponse(input: {
  readonly collectedText: string;
  readonly collectedTextComplete: boolean;
}): ResponsesResponse | null {
  if (!input.collectedTextComplete || input.collectedText.length === 0) {
    return null;
  }

  return {
    status: "text_streamed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: input.collectedText }],
      },
    ],
  };
}

function buildStreamedFallbackResponse(input: {
  readonly collectedText: string;
  readonly collectedTextComplete: boolean;
  readonly collectedFunctionCalls: readonly ResponsesOutputItem[];
  readonly completedFunctionCallArgumentIds: ReadonlySet<string>;
}): ResponsesResponse | null {
  const functionCallResponse = buildStreamedFunctionCallResponse({
    collectedFunctionCalls: input.collectedFunctionCalls,
    completedFunctionCallArgumentIds: input.completedFunctionCallArgumentIds,
  });
  if (functionCallResponse) {
    return functionCallResponse;
  }
  if (input.collectedFunctionCalls.some((item) => item.type === "function_call")) {
    return null;
  }
  return buildStreamedTextResponse({
    collectedText: input.collectedText,
    collectedTextComplete: input.collectedTextComplete,
  });
}

function hasStreamedFallbackResponse(input: {
  readonly collectedText: string;
  readonly collectedTextComplete: boolean;
  readonly collectedFunctionCalls: readonly ResponsesOutputItem[];
  readonly completedFunctionCallArgumentIds: ReadonlySet<string>;
}): boolean {
  return buildStreamedFallbackResponse(input) !== null;
}

function hasIncompleteStreamedFunctionCall(input: {
  readonly collectedFunctionCalls: readonly ResponsesOutputItem[];
  readonly collectedFunctionCallArgumentIds: readonly string[];
  readonly completedFunctionCallArgumentIds: ReadonlySet<string>;
}): boolean {
  return input.collectedFunctionCallArgumentIds.some((id) => !input.completedFunctionCallArgumentIds.has(id))
    || input.collectedFunctionCalls.some((item) =>
      item.type === "function_call" && !isCompleteFunctionCallItem(item, input.completedFunctionCallArgumentIds),
    );
}

function addFunctionCallIds(target: Set<string>, ...ids: ReadonlyArray<string | undefined>): void {
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0) {
      target.add(id);
    }
  }
}

function isEmptyTerminalStreamError(error: unknown): boolean {
  return error instanceof KilnError
    && error.code === "PROVIDER_UNAVAILABLE"
    && error.message === "Codex OAuth stream completed without response.completed event"
    && error.context.hasStreamedOutput === false;
}

function functionCallIdentityIds(
  item: ResponsesOutputItem,
  collectedCall: ResponsesOutputItem | undefined,
): readonly string[] {
  return [
    item.call_id,
    item.id,
    collectedCall?.call_id,
    collectedCall?.id,
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
}

function hasKnownFunctionCallArguments(input: {
  readonly item: ResponsesOutputItem;
  readonly existing: ResponsesOutputItem | undefined;
  readonly collectedFunctionCallArguments: ReadonlyMap<string, string>;
}): boolean {
  return [
    input.item.id,
    input.item.call_id,
    input.existing?.id,
    input.existing?.call_id,
  ].some((id) => typeof id === "string" && input.collectedFunctionCallArguments.has(id))
    || (typeof input.existing?.arguments === "string" && input.existing.arguments.length > 0);
}

function preferCompletedFunctionCallArguments(
  current: string | undefined,
  completed: string | undefined,
): string | undefined {
  return completed && completed.length > 0 ? completed : current;
}

function findCompletedFunctionCallArguments(input: {
  readonly item: ResponsesOutputItem;
  readonly collectedCall: ResponsesOutputItem | undefined;
  readonly collectedFunctionCallArguments: ReadonlyMap<string, string>;
  readonly completedFunctionCallArgumentIds: ReadonlySet<string>;
}): string | undefined {
  const ids = [
    input.item.call_id,
    input.item.id,
    input.collectedCall?.call_id,
    input.collectedCall?.id,
  ];
  for (const id of ids) {
    if (id && input.completedFunctionCallArgumentIds.has(id)) {
      const argumentsText = input.collectedFunctionCallArguments.get(id);
      if (typeof argumentsText === "string" && argumentsText.length > 0) {
        return argumentsText;
      }
    }
  }
  return undefined;
}

function isCompleteFunctionCallItem(
  item: ResponsesOutputItem,
  completedFunctionCallArgumentIds: ReadonlySet<string>,
): boolean {
  return item.type === "function_call"
    && typeof item.name === "string"
    && item.name.length > 0
    && typeof item.arguments === "string"
    && item.arguments.length > 0
    && (
      typeof item.call_id === "string" && completedFunctionCallArgumentIds.has(item.call_id)
      || typeof item.id === "string" && completedFunctionCallArgumentIds.has(item.id)
    );
}

function hasParseableFunctionCallArguments(argumentsText: string | undefined): boolean {
  if (typeof argumentsText !== "string" || argumentsText.length === 0) {
    return false;
  }
  try {
    JSON.parse(argumentsText);
    return true;
  } catch {
    return false;
  }
}

function stripOneLeakedFunctionCallPrefix(
  text: string,
  functionCalls: readonly ResponsesOutputItem[],
): string {
  const rawArgumentPrefix = matchingRawArgumentPrefix(text, functionCalls);
  if (rawArgumentPrefix) {
    return text.slice(rawArgumentPrefix.length);
  }

  const marker = matchingFunctionDestinationMarker(text, functionCalls);
  if (marker) {
    return text.slice(marker.length);
  }

  const jsonPrefix = readLeadingJsonObjectPrefix(text);
  if (jsonPrefix && isLeakedFunctionArgumentObject(jsonPrefix.value, jsonPrefix.followingText, functionCalls)) {
    return text.slice(jsonPrefix.end);
  }

  return text;
}

function matchingRawArgumentPrefix(
  text: string,
  functionCalls: readonly ResponsesOutputItem[],
): string | null {
  const start = firstNonWhitespaceIndex(text);
  if (start === -1) {
    return null;
  }
  const candidate = text.slice(start);
  for (const item of functionCalls) {
    const args = typeof item.arguments === "string" ? item.arguments.trim() : "";
    if (args.length > 0 && candidate.startsWith(args)) {
      return text.slice(0, start) + args;
    }
  }
  return null;
}

function matchingFunctionDestinationMarker(
  text: string,
  functionCalls: readonly ResponsesOutputItem[],
): string | null {
  const start = firstNonWhitespaceIndex(text);
  if (start === -1) {
    return null;
  }
  const candidate = text.slice(start);
  for (const item of functionCalls) {
    if (!item.name) {
      continue;
    }
    const functionsMarker = `to=functions.${item.name}`;
    if (candidate.startsWith(functionsMarker)) {
      return text.slice(0, start) + functionsMarker;
    }
    const mcpMarkerMatch = /^to=mcp__[A-Za-z0-9_-]+__\./u.exec(candidate);
    if (mcpMarkerMatch) {
      const marker = `${mcpMarkerMatch[0]}${item.name}`;
      if (candidate.startsWith(marker)) {
        return text.slice(0, start) + marker;
      }
    }
  }
  return null;
}

function isLeakedFunctionArgumentObject(
  value: unknown,
  followingText: string,
  functionCalls: readonly ResponsesOutputItem[],
): boolean {
  if (!isPlainRecord(value)) {
    return false;
  }

  for (const item of functionCalls) {
    const args = typeof item.arguments === "string" ? item.arguments.trim() : "";
    if (!args) {
      continue;
    }
    try {
      if (jsonValuesEqual(value, JSON.parse(args))) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return matchingFunctionDestinationMarker(followingText, functionCalls) !== null;
}

function readLeadingJsonObjectPrefix(
  text: string,
): { readonly end: number; readonly followingText: string; readonly value: unknown } | null {
  const start = firstNonWhitespaceIndex(text);
  if (start === -1 || text[start] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth++;
      continue;
    }
    if (char !== "}") {
      continue;
    }

    depth--;
    if (depth !== 0) {
      continue;
    }

    const end = index + 1;
    try {
      return {
        end,
        followingText: text.slice(end),
        value: JSON.parse(text.slice(start, end)) as unknown,
      };
    } catch {
      return null;
    }
  }

  return null;
}

function firstNonWhitespaceIndex(text: string): number {
  const match = /\S/u.exec(text);
  return match ? match.index : -1;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  if (isPlainRecord(left) || isPlainRecord(right)) {
    if (!isPlainRecord(left) || !isPlainRecord(right)) {
      return false;
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (!jsonValuesEqual(leftKeys, rightKeys)) {
      return false;
    }
    return leftKeys.every((key) => jsonValuesEqual(left[key], right[key]));
  }
  return false;
}
