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

const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
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
  readonly max_output_tokens?: number;
  readonly temperature?: number;
  readonly reasoning?: {
    readonly effort: ReasoningEffort;
  };
  readonly tools?: readonly ResponsesTool[];
}

interface ResponsesRequest {
  readonly body: ResponsesRequestBody;
  readonly toolNames: ToolNameMapping;
}

interface ToolNameMapping {
  toProviderName(canonicalName: string): string;
  toCanonicalName(providerName: string): string;
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
    const { body } = request;
    const response = await this.postWith401Retry(body);
    const completed = await this.consumeStreamingResponse(response);
    return this.mapResponse(completed, request.toolNames);
  }

  async *streamMessage(options: CreateMessageOptions): AsyncGenerator<AgentStreamEvent> {
    const request = this.buildRequest(options);
    const { body } = request;
    const response = await this.postWith401Retry(body);
    const shouldBufferText = (options.tools?.length ?? 0) > 0;
    let collectedText = "";
    const collectedFunctionCallsByItemId = new Map<string, ResponsesOutputItem>();
    const collectedFunctionCallsByCallId = new Map<string, ResponsesOutputItem>();
    const collectedFunctionCallArguments = new Map<string, string>();

    if (!response.body) {
      throw this.providerError("Codex OAuth streaming response body was empty", {
        status: response.status,
      });
    }

    for await (const event of this.parseSse(response.body)) {
      if (event.event === "response.output_text.delta") {
        const delta = this.parseJsonString<{ delta?: string }>(event.data);
        if (delta.delta) {
          if (shouldBufferText) {
            collectedText += delta.delta;
            continue;
          }
          yield { type: "text", content: delta.delta };
        }
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
          yield {
            type: "tool_use",
            content: JSON.stringify({
              id: added.item.call_id ?? added.item.id ?? "",
              name: request.toolNames.toCanonicalName(added.item.name ?? ""),
              input: normalizeToolInput(
                request.toolNames.toCanonicalName(added.item.name ?? ""),
                added.item.arguments,
              ),
            }),
          };
        }
        continue;
      }

      if (event.event === "response.output_item.done") {
        const done = this.parseJsonString<OutputItemDoneEnvelope>(event.data);
        const item = done.item;
        if (item?.type === "function_call") {
          if (item.id) {
            collectedFunctionCallsByItemId.set(item.id, item);
          }
          if (item.call_id) {
            collectedFunctionCallsByCallId.set(item.call_id, item);
          }
          if (item.id && typeof item.arguments === "string") {
            collectedFunctionCallArguments.set(item.id, item.arguments);
          }
          if (item.call_id && typeof item.arguments === "string") {
            collectedFunctionCallArguments.set(item.call_id, item.arguments);
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
        if (done.item_id && typeof done.arguments === "string") {
          collectedFunctionCallArguments.set(done.item_id, done.arguments);
          if (done.call_id) {
            collectedFunctionCallArguments.set(done.call_id, done.arguments);
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
            arguments: existing?.arguments ?? done.arguments,
          };
          collectedFunctionCallsByItemId.set(done.item_id, mergedItem);
          if (done.call_id) {
            collectedFunctionCallsByCallId.set(done.call_id, mergedItem);
          }
        }
        continue;
      }

      if (event.event === "response.completed") {
        const completed = this.parseJsonString<CompletedSseEnvelope>(event.data);
        const completedResponse = shouldBufferText
          ? this.applyStreamingFallbacks(
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
          )
          : completed.response ?? {};
        const mapped = this.mapResponse(completedResponse, request.toolNames);
        if (shouldBufferText) {
          for (const part of mapped.parts) {
            if (part.type === "text" && part.text.length > 0) {
              yield { type: "text", content: part.text };
            }
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
      }
    }
  }

  private buildRequest(
    options: CreateMessageOptions,
  ): ResponsesRequest {
    const input: ResponsesInputItem[] = [];
    const toolNames = createToolNameMapping(collectCanonicalToolNames(options));

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
        max_output_tokens: options.maxTokens,
        ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
        ...(tools ? { tools } : {}),
      },
      toolNames,
    };
  }

  private mapMessageToInputItems(
    role: "user" | "assistant",
    parts: readonly ContentPart[],
    toolNames: ToolNameMapping,
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

  private async postWith401Retry(body: ResponsesRequestBody): Promise<Response> {
    const firstResponse = await this.post(body);
    if (firstResponse.status !== 401) {
      await this.ensureOk(firstResponse, body);
      return firstResponse;
    }

    const retryResponse = await this.post(body);
    if (retryResponse.status === 401) {
      throw this.providerError("Codex OAuth request unauthorized after token refresh", {
        status: retryResponse.status,
      });
    }

    await this.ensureOk(retryResponse, body);
    return retryResponse;
  }

  private async post(body: ResponsesRequestBody): Promise<Response> {
    const token = await this.auth.getValidAccessToken();
    return await fetch(RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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

    throw this.providerError("Codex OAuth request failed", {
      status: response.status,
      responseBody,
      toolReplaySummary: requestBody ? this.summarizeToolReplay(requestBody) : undefined,
    });
  }

  private mapResponse(response: ResponsesResponse, toolNames: ToolNameMapping): AgentResponse & {
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
          input: normalizeToolInput(canonicalName, item.arguments),
        });
      }
    }

    return {
      parts,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
      toolCalls,
      stopReason: response.status ?? "completed",
      cost: {
        inputPer1M: 0,
        outputPer1M: 0,
      },
    };
  }

  private async consumeStreamingResponse(response: Response): Promise<ResponsesResponse> {
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

    for await (const event of this.parseSse(response.body)) {
      if (event.event === "response.output_text.delta") {
        const delta = this.parseJsonString<{ delta?: string }>(event.data);
        if (typeof delta.delta === "string") {
          collectedText += delta.delta;
        }
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
          if (item.id) {
            collectedFunctionCallsByItemId.set(item.id, item);
          }
          if (item.call_id) {
            collectedFunctionCallsByCallId.set(item.call_id, item);
          }
          if (item.id && typeof item.arguments === "string") {
            collectedFunctionCallArguments.set(item.id, item.arguments);
          }
          if (item.call_id && typeof item.arguments === "string") {
            collectedFunctionCallArguments.set(item.call_id, item.arguments);
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
        if (done.item_id && typeof done.arguments === "string") {
          collectedFunctionCallArguments.set(done.item_id, done.arguments);
          if (done.call_id) {
            collectedFunctionCallArguments.set(done.call_id, done.arguments);
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
            arguments: existing?.arguments ?? done.arguments,
          };
          collectedFunctionCallsByItemId.set(done.item_id, mergedItem);
          if (done.call_id) {
            collectedFunctionCallsByCallId.set(done.call_id, mergedItem);
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
      );
    }

    throw this.providerError("Codex OAuth stream completed without response.completed event", {
      status: response.status,
      collectedText,
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
  ): AsyncGenerator<{ readonly event: string; readonly data: string }> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
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
      const argumentsText = functionCallId
        ? collectedFunctionCallArguments.get(functionCallId)
        : undefined;
      return {
        ...item,
        ...(!item.call_id && collectedCall?.call_id ? { call_id: collectedCall.call_id } : {}),
        ...(!item.name && collectedCall?.name ? { name: collectedCall.name } : {}),
        ...(!item.arguments && argumentsText ? { arguments: argumentsText } : {}),
        ...(!item.arguments && !argumentsText && collectedCall?.arguments
          ? { arguments: collectedCall.arguments }
          : {}),
      };
    });

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
    return new KilnError("PROVIDER_AUTH_FAILED", message, { context, cause });
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

function collectCanonicalToolNames(options: CreateMessageOptions): string[] {
  const names = new Set(options.tools?.map((tool) => tool.name) ?? []);
  for (const message of options.messages) {
    for (const part of message.parts) {
      if (part.type === "tool_use") {
        names.add(part.name);
      }
    }
  }
  return [...names];
}

function createToolNameMapping(canonicalNames: readonly string[]): ToolNameMapping {
  const canonicalToProvider = new Map<string, string>();
  const providerToCanonical = new Map<string, string>();
  const usedProviderNames = new Set<string>();

  for (const canonicalName of canonicalNames) {
    if (canonicalToProvider.has(canonicalName)) {
      continue;
    }
    const baseName = toResponsesToolName(canonicalName);
    let providerName = baseName;
    let suffix = 2;
    while (usedProviderNames.has(providerName)) {
      providerName = `${baseName}_${suffix}`;
      suffix += 1;
    }
    usedProviderNames.add(providerName);
    canonicalToProvider.set(canonicalName, providerName);
    providerToCanonical.set(providerName, canonicalName);
  }

  return {
    toProviderName: (canonicalName) =>
      canonicalToProvider.get(canonicalName) ?? toResponsesToolName(canonicalName),
    toCanonicalName: (providerName) => providerToCanonical.get(providerName) ?? providerName,
  };
}

function toResponsesToolName(name: string): string {
  if (/^[a-zA-Z0-9_-]+$/.test(name)) {
    return name;
  }
  const normalized = name
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "tool";
}

function toStrictToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return transformSchemaForStrictMode(schema);
}

function transformSchemaForStrictMode(schema: Record<string, unknown>): Record<string, unknown> {
  const typeValue = schema.type;

  if (typeValue === "object") {
    const propertyEntries = Object.entries(asSchemaMap(schema.properties));
    const required = new Set(asStringArray(schema.required));
    const properties = Object.fromEntries(
      propertyEntries.map(([key, value]) => ([
        key,
        required.has(key)
          ? transformSchemaForStrictMode(value)
          : makeSchemaNullable(transformSchemaForStrictMode(value)),
      ])),
    );

    return {
      ...schema,
      properties,
      required: propertyEntries.map(([key]) => key),
      additionalProperties: false,
    };
  }

  if (typeValue === "array") {
    const items = schema.items;
    return {
      ...schema,
      ...(isSchemaRecord(items) ? { items: transformSchemaForStrictMode(items) } : {}),
    };
  }

  return { ...schema };
}

function makeSchemaNullable(schema: Record<string, unknown>): Record<string, unknown> {
  const typeValue = schema.type;
  if (typeof typeValue === "string") {
    return {
      ...schema,
      type: [typeValue, "null"],
    };
  }

  if (Array.isArray(typeValue)) {
    return {
      ...schema,
      type: typeValue.includes("null") ? typeValue : [...typeValue, "null"],
    };
  }

  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (enumValues) {
    return {
      ...schema,
      type: [inferEnumType(enumValues), "null"],
      enum: enumValues.includes(null) ? enumValues : [...enumValues, null],
    };
  }

  return {
    anyOf: [
      schema,
      { type: "null" },
    ],
  };
}

function inferEnumType(values: readonly unknown[]): string {
  if (values.every((value) => typeof value === "string")) {
    return "string";
  }
  if (values.every((value) => typeof value === "number")) {
    return "number";
  }
  if (values.every((value) => typeof value === "boolean")) {
    return "boolean";
  }
  return "string";
}

function asSchemaMap(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isSchemaRecord(entry)) {
      out[key] = entry;
    }
  }
  return out;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
