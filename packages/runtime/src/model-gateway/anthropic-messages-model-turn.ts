import {
  validateModelTurn,
  validateModelTurnResult,
  type ModelImagePart,
  type ModelJsonObject,
  type ModelPart,
  type ModelTurn,
  type ModelTurnMessage,
  type ModelTurnResult,
} from "@kilnai/core";
import type { AnthropicMessagesRequest, AnthropicMessagesSseEvent } from "./anthropic-messages-protocol.js";

type WireRecord = Record<string, unknown>;
const asRecord = (value: unknown): WireRecord => value as WireRecord;

export class AnthropicMessagesModelTurnError extends Error {
  override name = "AnthropicMessagesModelTurnError";
  constructor(readonly code: "unsupported-result-part", message: string) { super(message); }
}

export type AnthropicMessagesModelTurnCapability = "text" | "input-image-url" | "input-image-base64" | "function-tools" | "parallel-tool-calls" | "reasoning-controls";

export function inspectAnthropicMessagesCapabilities(request: AnthropicMessagesRequest): readonly AnthropicMessagesModelTurnCapability[] {
  const required = new Set<AnthropicMessagesModelTurnCapability>(["text"]);
  if (request.output_config !== undefined) required.add("reasoning-controls");
  if (request.tools !== undefined) required.add("function-tools");
  if (request.tools !== undefined && request.tools.length > 0
    && request.tool_choice?.type !== "none"
    && request.tool_choice?.disable_parallel_tool_use !== true) {
    required.add("parallel-tool-calls");
  }
  for (const message of request.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const blockValue of message.content) {
      const block = asRecord(blockValue);
      if (block.type === "tool_use" || block.type === "tool_result") required.add("function-tools");
      const imageSources: WireRecord[] = [];
      if (block.type === "image") imageSources.push(asRecord(block.source));
      if (block.type === "tool_result" && Array.isArray(block.content)) for (const content of block.content) if (asRecord(content).type === "image") imageSources.push(asRecord(asRecord(content).source));
      for (const source of imageSources) required.add(source.type === "url" ? "input-image-url" : "input-image-base64");
    }
  }
  return [...required];
}

function mapImage(value: unknown): ModelImagePart {
  const source = asRecord(asRecord(value).source);
  return source.type === "url"
    ? { type: "image", source: { kind: "url", url: source.url as string } }
    : { type: "image", source: { kind: "base64", mediaType: source.media_type as string, data: source.data as string } };
}

function mapToolResultContent(value: unknown): ModelPart[] {
  if (typeof value === "string") return [{ type: "text", text: value }];
  return (value as unknown[]).map((block) => asRecord(block).type === "image" ? mapImage(block) : { type: "text", text: asRecord(block).text as string });
}

function mapMessage(value: WireRecord): ModelTurnMessage {
  if (typeof value.content === "string") return { role: value.role as "user" | "assistant", parts: [{ type: "text", text: value.content }] };
  const parts = (value.content as unknown[]).map((raw): ModelPart => {
    const block = asRecord(raw);
    if (block.type === "text") return { type: "text", text: block.text as string };
    if (block.type === "image") return mapImage(block);
    if (block.type === "tool_use") return { type: "tool-call", call: { kind: "function", id: block.id as string, name: block.name as string, input: { kind: "json-object", value: structuredClone(block.input) as ModelJsonObject } } };
    return { type: "tool-result", callId: block.tool_use_id as string, content: mapToolResultContent(block.content) as import("@kilnai/core").ModelToolResultContent[], ...(block.is_error === undefined ? {} : { isError: block.is_error as boolean }) };
  });
  return { role: value.role as "user" | "assistant", parts };
}

export function mapAnthropicMessagesRequestToModelTurn(request: AnthropicMessagesRequest): ModelTurn {
  const system = request.system;
  const instructions = typeof system === "string" ? system : system?.map((block) => block.text as string).join("");
  const tools = request.tools?.map((raw) => ({
    kind: "function" as const,
    name: raw.name as string,
    ...(raw.description === undefined ? {} : { description: raw.description as string }),
    inputSchema: structuredClone(raw.input_schema) as ModelJsonObject,
  }));
  const choice = request.tool_choice;
  const toolChoice = choice === undefined ? undefined
    : choice.type === "any" ? { kind: "required" as const }
    : choice.type === "tool" ? { kind: "tool" as const, name: choice.name as string }
    : { kind: choice.type as "auto" | "none" };
  const turn: ModelTurn = {
    ...(instructions === undefined ? {} : { instructions }),
    history: request.messages.map(mapMessage),
    ...(tools === undefined ? {} : { tools }),
    ...(toolChoice === undefined ? {} : { toolChoice }),
    ...(tools === undefined || tools.length === 0 || choice?.type === "none"
      ? {}
      : { parallelToolCalls: choice?.disable_parallel_tool_use !== true }),
    maxOutputTokens: request.max_tokens,
    ...(request.output_config === undefined ? {} : { reasoning: { effort: request.output_config.effort } }),
  };
  validateModelTurn(turn);
  return structuredClone(turn);
}

export function mapModelTurnResultToAnthropicMessagesEvents(input: { readonly messageId: string; readonly model: string; readonly result: ModelTurnResult }): AnthropicMessagesSseEvent[] {
  validateModelTurnResult(input.result);
  const usage = input.result.usage;
  const events: AnthropicMessagesSseEvent[] = [{
    event: "message_start",
    data: { type: "message_start", message: { id: input.messageId, type: "message", role: "assistant", model: input.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.inputTokens, output_tokens: 0, cache_creation_input_tokens: usage.cacheWriteTokens, cache_read_input_tokens: usage.cacheReadTokens } } },
  }];
  input.result.parts.forEach((part, index) => {
    if (part.type === "text") {
      events.push(
        { event: "content_block_start", data: { type: "content_block_start", index, content_block: { type: "text", text: "" } } },
        { event: "content_block_delta", data: { type: "content_block_delta", index, delta: { type: "text_delta", text: part.text } } },
        { event: "content_block_stop", data: { type: "content_block_stop", index } },
      );
    } else if (part.type === "tool-call" && part.call.kind === "function") {
      events.push(
        { event: "content_block_start", data: { type: "content_block_start", index, content_block: { type: "tool_use", id: part.call.id, name: part.call.name, input: {} } } },
        { event: "content_block_delta", data: { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(part.call.input.value) } } },
        { event: "content_block_stop", data: { type: "content_block_stop", index } },
      );
    } else throw new AnthropicMessagesModelTurnError("unsupported-result-part", `Result part '${part.type}' cannot be represented by Anthropic Messages.`);
  });
  events.push(
    { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: mapStopReason(input.result.stopReason), stop_sequence: null }, usage: { output_tokens: usage.outputTokens } } },
    { event: "message_stop", data: { type: "message_stop" } },
  );
  return events;
}

function mapStopReason(value: string): string {
  if (value === "tool_use") return "tool_use";
  if (value === "max_tokens" || value === "length") return "max_tokens";
  if (value === "stop_sequence") return "stop_sequence";
  return "end_turn";
}
