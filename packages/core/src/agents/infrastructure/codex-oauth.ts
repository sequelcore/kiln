import type {
  AgentResponse,
  AgentStreamEvent,
  CreateMessageOptions,
  ProviderAdapter,
  ToolCall,
} from "../index.js";
import { textPart, extractText } from "../../engine/domain/content.js";
import type { ContentPart } from "../../engine/domain/content.js";
import { KilnError } from "../../engine/errors.js";
import { CodexOAuthAuth } from "./codex-oauth-auth.js";
import { CODEX_DEFAULT_MODEL } from "../model-pricing.js";

const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

interface AccessTokenProvider {
  getValidAccessToken(): Promise<string>;
}

interface CodexOAuthAdapterConfig {
  readonly auth?: AccessTokenProvider;
  readonly defaultModel?: string;
}

interface ResponsesInputItem {
  readonly role?: "user" | "assistant";
  readonly content?: string;
  readonly type?: "function_call_output";
  readonly call_id?: string;
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
  readonly tools?: readonly ResponsesTool[];
}

interface ResponsesOutputItem {
  readonly type?: string;
  readonly id?: string;
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

export class CodexOAuthAdapter implements ProviderAdapter {
  readonly name = "codex-oauth";

  private readonly auth: AccessTokenProvider;
  private readonly model: string;

  constructor(config: CodexOAuthAdapterConfig = {}) {
    this.auth = config.auth ?? new CodexOAuthAuth();
    this.model = config.defaultModel ?? CODEX_DEFAULT_MODEL;
  }

  async createMessage(options: CreateMessageOptions): Promise<AgentResponse> {
    const body = this.buildRequestBody(options);
    const response = await this.postWith401Retry(body);
    const completed = await this.consumeStreamingResponse(response);
    return this.mapResponse(completed);
  }

  async *streamMessage(options: CreateMessageOptions): AsyncGenerator<AgentStreamEvent> {
    const body = this.buildRequestBody(options);
    const response = await this.postWith401Retry(body);

    if (!response.body) {
      throw this.providerError("Codex OAuth streaming response body was empty", {
        status: response.status,
      });
    }

    for await (const event of this.parseSse(response.body)) {
      if (event.event === "response.output_text.delta") {
        const delta = this.parseJsonString<{ delta?: string }>(event.data);
        if (delta.delta) {
          yield { type: "text", content: delta.delta };
        }
        continue;
      }

      if (event.event === "response.output_item.added") {
        const added = this.parseJsonString<OutputItemAddedEnvelope>(event.data);
        if (added.item?.type === "function_call") {
          yield {
            type: "tool_use",
            content: JSON.stringify({
              id: added.item.id ?? "",
              name: added.item.name ?? "",
              input: this.parseToolInput(added.item.arguments),
            }),
          };
        }
        continue;
      }

      if (event.event === "response.completed") {
        const completed = this.parseJsonString<CompletedSseEnvelope>(event.data);
        const mapped = this.mapResponse(completed.response ?? {});
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

  private buildRequestBody(
    options: CreateMessageOptions,
  ): ResponsesRequestBody {
    const input: ResponsesInputItem[] = [];

    for (const message of options.messages) {
      input.push({
        role: message.role,
        content: this.mapPartsToInputContent(message.parts),
      });
    }

    return {
      model: this.model,
      instructions: options.system,
      input,
      store: false,
      stream: true,
      max_output_tokens: options.maxTokens,
      tools: options.tools?.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    };
  }

  private mapPartsToInputContent(parts: readonly ContentPart[]): string {
    return extractText(parts);
  }

  private async postWith401Retry(body: ResponsesRequestBody): Promise<Response> {
    const firstResponse = await this.post(body);
    if (firstResponse.status !== 401) {
      this.ensureOk(firstResponse);
      return firstResponse;
    }

    const retryResponse = await this.post(body);
    if (retryResponse.status === 401) {
      throw this.providerError("Codex OAuth request unauthorized after token refresh", {
        status: retryResponse.status,
      });
    }

    this.ensureOk(retryResponse);
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

  private ensureOk(response: Response): void {
    if (response.ok) {
      return;
    }

    throw this.providerError("Codex OAuth request failed", {
      status: response.status,
    });
  }

  private mapResponse(response: ResponsesResponse): AgentResponse & {
    readonly cost: {
      readonly inputPer1M: number;
      readonly outputPer1M: number;
    };
  } {
    const parts: ContentPart[] = [];
    const toolCalls: ToolCall[] = [];

    for (const item of response.output ?? []) {
      if (item.type === "message") {
        const text = (item.content ?? [])
          .filter((content) => content.type === "output_text" && typeof content.text === "string")
          .map((content) => content.text ?? "")
          .join("");

        if (text.length > 0) {
          parts.push(textPart(text));
        }
      }

      if (item.type === "function_call") {
        toolCalls.push({
          id: item.id ?? "",
          name: item.name ?? "",
          input: this.parseToolInput(item.arguments),
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

  private parseToolInput(argumentsText?: string): Record<string, unknown> {
    if (!argumentsText) {
      return {};
    }

    return this.parseJsonString<Record<string, unknown>>(argumentsText);
  }

  private async consumeStreamingResponse(response: Response): Promise<ResponsesResponse> {
    if (!response.body) {
      throw this.providerError("Codex OAuth streaming response body was empty", {
        status: response.status,
      });
    }

    let completed: ResponsesResponse | null = null;
    let collectedText = "";

    for await (const event of this.parseSse(response.body)) {
      if (event.event === "response.output_text.delta") {
        const delta = this.parseJsonString<{ delta?: string }>(event.data);
        if (typeof delta.delta === "string") {
          collectedText += delta.delta;
        }
        continue;
      }

      if (event.event === "response.completed") {
        completed = this.parseJsonString<CompletedSseEnvelope>(event.data).response ?? null;
      }
    }

    if (completed) {
      return completed;
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
        const separatorIndex = buffer.indexOf("\n\n");
        if (separatorIndex === -1) {
          break;
        }

        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
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

  private providerError(message: string, context: Record<string, unknown>, cause?: unknown): KilnError {
    return new KilnError("PROVIDER_AUTH_FAILED", message, { context, cause });
  }
}
