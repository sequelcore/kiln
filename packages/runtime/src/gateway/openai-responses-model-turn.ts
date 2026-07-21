import {
  validateModelTurn,
  validateModelTurnResult,
  type ModelImagePart,
  type ModelJsonObject,
  type ModelPart,
  type ModelTool,
  type ModelToolChoice,
  type ModelTurn,
  type ModelTurnMessage,
  type ModelTurnResult,
} from "@kilnai/core";
import {
  createResponsesStreamState,
  type OpenAIResponsesRequest,
  type ResponsesSseEvent,
} from "./openai-responses-protocol.js";

export type OpenAIResponsesModelTurnErrorCode =
  | "unsupported-item-reference"
  | "unsupported-reasoning-replay"
  | "unsupported-reasoning-context"
  | "unsupported-local-shell"
  | "unsupported-tool-search"
  | "unsupported-image-file-id"
  | "unsupported-custom-tool-format"
  | "unsupported-route-capability"
  | "invalid-function-arguments"
  | "invalid-image-data-url"
  | "unsupported-result-part";

export class OpenAIResponsesModelTurnError extends Error {
  override name = "OpenAIResponsesModelTurnError";
  constructor(
    readonly code: OpenAIResponsesModelTurnErrorCode,
    message: string,
    readonly path?: string,
    readonly capability?: OpenAIResponsesModelTurnCapability,
  ) { super(message); }
}

export type OpenAIResponsesModelTurnCapability =
  | "text"
  | "input-image-url"
  | "input-image-base64"
  | "function-tools"
  | "custom-tools-lark"
  | "parallel-tool-calls"
  | "json-schema-response"
  | "reasoning-controls"
  | "text-verbosity"
  | "reasoning-encrypted-content";

export interface OpenAIResponsesCapabilityIssue {
  readonly code: Exclude<OpenAIResponsesModelTurnErrorCode, "unsupported-route-capability" | "invalid-function-arguments" | "invalid-image-data-url" | "unsupported-result-part">;
  readonly path: string;
}
export interface OpenAIResponsesModelTurnCapabilitySummary {
  readonly required: readonly OpenAIResponsesModelTurnCapability[];
  /** Best-effort response features requested by the client; absence must be evidenced, not rejected. */
  readonly optionalRequested: readonly OpenAIResponsesModelTurnCapability[];
  /** Optional requests unavailable on the selected route. Empty until route preflight. */
  readonly unavailableOptional: readonly OpenAIResponsesModelTurnCapability[];
  readonly unsupported: readonly OpenAIResponsesCapabilityIssue[];
}

export interface OpenAIResponsesProjectionOmission {
  readonly code: "cache-write-tokens-not-representable";
  readonly field: "usage.cacheWriteTokens";
  readonly value: number;
  readonly protocolVersion: "codex-0.144.5";
}

/** Array-compatible so existing SSE writers keep working while closeout can record omissions. */
export type OpenAIResponsesEventProjection = ResponsesSseEvent[] & {
  readonly omissions: readonly OpenAIResponsesProjectionOmission[];
};

type WireRecord = Record<string, unknown>;
const asRecord = (value: unknown): WireRecord => value as WireRecord;
const cloneJsonObject = (value: unknown): ModelJsonObject => structuredClone(value ?? {}) as ModelJsonObject;

function capabilityError(issue: OpenAIResponsesCapabilityIssue): OpenAIResponsesModelTurnError {
  const messages: Record<OpenAIResponsesCapabilityIssue["code"], string> = {
    "unsupported-item-reference": "Item references cannot be represented by the model-turn boundary.",
    "unsupported-reasoning-replay": "Encrypted or opaque reasoning replay cannot cross the model-turn boundary.",
    "unsupported-reasoning-context": "Reasoning context selection is not supported by the model-turn boundary.",
    "unsupported-local-shell": "Local shell replay requires a capability that the model-turn boundary does not expose.",
    "unsupported-tool-search": "Tool-search replay requires a capability that the model-turn boundary does not expose.",
    "unsupported-image-file-id": "File-backed image references must be resolved before model-turn mapping.",
    "unsupported-custom-tool-format": "Custom tools require an explicit Lark grammar.",
  };
  return new OpenAIResponsesModelTurnError(issue.code, messages[issue.code], issue.path);
}

export function inspectOpenAIResponsesModelTurnCapabilities(request: OpenAIResponsesRequest): OpenAIResponsesModelTurnCapabilitySummary {
  const required = new Set<OpenAIResponsesModelTurnCapability>(["text"]);
  const optionalRequested = new Set<OpenAIResponsesModelTurnCapability>();
  const unsupported: OpenAIResponsesCapabilityIssue[] = [];
  const reasoning = request.reasoning === undefined ? undefined : asRecord(request.reasoning);
  if (reasoning && (reasoning.effort !== undefined || reasoning.summary !== undefined)) required.add("reasoning-controls");
  if (reasoning?.context !== undefined) unsupported.push({ code: "unsupported-reasoning-context", path: "reasoning.context" });
  if (request.parallel_tool_calls === true) required.add("parallel-tool-calls");
  const text = request.text === undefined ? undefined : asRecord(request.text);
  if (text?.format !== undefined) required.add("json-schema-response");
  if (text?.verbosity !== undefined) required.add("text-verbosity");
  if (Array.isArray(request.include) && request.include.includes("reasoning.encrypted_content")) optionalRequested.add("reasoning-encrypted-content");

  for (const [index, raw] of request.input.entries()) {
    const item = asRecord(raw); const path = `input[${index}]`;
    if (item.type === "item_reference") unsupported.push({ code: "unsupported-item-reference", path });
    else if (item.type === "reasoning" && (item.encrypted_content !== undefined || item.content !== undefined)) unsupported.push({ code: "unsupported-reasoning-replay", path });
    else if (item.type === "local_shell_call") unsupported.push({ code: "unsupported-local-shell", path });
    else if (item.type === "tool_search_call" || item.type === "tool_search_output") unsupported.push({ code: "unsupported-tool-search", path });
    else if (item.type === "function_call") required.add("function-tools");
    else if (item.type === "custom_tool_call") required.add("custom-tools-lark");
    else if ((item.type === "function_call_output" || item.type === "custom_tool_call_output") && Array.isArray(item.output)) {
      for (const [partIndex, rawPart] of item.output.entries()) {
        const part = asRecord(rawPart);
        if (part.type !== "input_image") continue;
        if (part.file_id !== undefined) unsupported.push({ code: "unsupported-image-file-id", path: `${path}.output[${partIndex}]` });
        else if (typeof part.image_url === "string" && part.image_url.startsWith("data:")) required.add("input-image-base64");
        else required.add("input-image-url");
      }
    } else if (item.type === "message" && Array.isArray(item.content)) {
      for (const [partIndex, rawPart] of item.content.entries()) {
        const part = asRecord(rawPart);
        if (part.type !== "input_image") continue;
        if (part.file_id !== undefined) unsupported.push({ code: "unsupported-image-file-id", path: `${path}.content[${partIndex}]` });
        else if (typeof part.image_url === "string" && part.image_url.startsWith("data:")) required.add("input-image-base64");
        else required.add("input-image-url");
      }
    }
  }
  if (Array.isArray(request.tools)) for (const [index, raw] of request.tools.entries()) {
    const tool = asRecord(raw);
    if (tool.type === "function") required.add("function-tools");
    else if (tool.type === "tool_search") unsupported.push({ code: "unsupported-tool-search", path: `tools[${index}]` });
    else if (tool.type === "custom") {
      required.add("custom-tools-lark");
      const format = tool.format === undefined ? undefined : asRecord(tool.format);
      if (!format || format.type !== "grammar" || format.syntax !== "lark" || typeof format.definition !== "string" || format.definition.length === 0) unsupported.push({ code: "unsupported-custom-tool-format", path: `tools[${index}].format` });
    }
  }
  return { required: [...required], optionalRequested: [...optionalRequested], unavailableOptional: [], unsupported };
}

export function preflightOpenAIResponsesModelTurn(
  request: OpenAIResponsesRequest,
  available: ReadonlySet<OpenAIResponsesModelTurnCapability>,
): OpenAIResponsesModelTurnCapabilitySummary {
  const summary = inspectOpenAIResponsesModelTurnCapabilities(request);
  if (summary.unsupported[0]) throw capabilityError(summary.unsupported[0]);
  const missing = summary.required.find((capability) => !available.has(capability));
  if (missing) throw new OpenAIResponsesModelTurnError("unsupported-route-capability", `The selected route does not support required capability '${missing}'.`, undefined, missing);
  return { ...summary, unavailableOptional: summary.optionalRequested.filter((capability) => !available.has(capability)) };
}

function mapImage(part: WireRecord, path: string): ModelImagePart {
  if (part.file_id !== undefined) throw capabilityError({ code: "unsupported-image-file-id", path });
  const imageUrl = part.image_url as string;
  if (!imageUrl.startsWith("data:")) return { type: "image", source: { kind: "url", url: imageUrl } };
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(imageUrl);
  if (!match || !match[1]?.startsWith("image/") || !match[2]) throw new OpenAIResponsesModelTurnError("invalid-image-data-url", "Inline images must use a non-empty image/* base64 data URL.", path);
  return { type: "image", source: { kind: "base64", mediaType: match[1], data: match[2] } };
}

function mapMessage(item: WireRecord, path: string): ModelTurnMessage {
  const role = item.role as ModelTurnMessage["role"];
  const parts: ModelPart[] = [];
  if (typeof item.content === "string") parts.push({ type: "text", text: item.content });
  else for (const [index, raw] of (item.content as unknown[]).entries()) {
    const part = asRecord(raw);
    if (part.type === "input_image") parts.push(mapImage(part, `${path}.content[${index}]`));
    else parts.push({ type: "text", text: part.text as string });
  }
  return { role, parts };
}

function mapToolResultContent(output: unknown, path: string): Array<{ type: "text"; text: string } | ModelImagePart> {
  if (typeof output === "string") return [{ type: "text", text: output }];
  return (output as unknown[]).map((raw, index) => {
    const part = asRecord(raw);
    return part.type === "input_image"
      ? mapImage(part, `${path}[${index}]`)
      : { type: "text" as const, text: part.text as string };
  });
}

function mapTools(request: OpenAIResponsesRequest): ModelTool[] | undefined {
  if (!Array.isArray(request.tools)) return undefined;
  return request.tools.map((raw, index) => {
    const tool = asRecord(raw);
    if (tool.type === "function") return {
      kind: "function", name: tool.name as string,
      ...(tool.description === undefined ? {} : { description: tool.description as string }),
      inputSchema: cloneJsonObject(tool.parameters),
      ...(tool.strict === undefined ? {} : { strict: tool.strict as boolean }),
    };
    const format = tool.format === undefined ? undefined : asRecord(tool.format);
    if (!format || format.type !== "grammar" || format.syntax !== "lark" || typeof format.definition !== "string" || format.definition.length === 0) throw capabilityError({ code: "unsupported-custom-tool-format", path: `tools[${index}].format` });
    return {
      kind: "custom", name: tool.name as string,
      ...(tool.description === undefined ? {} : { description: tool.description as string }),
      grammar: { syntax: "lark", source: format.definition },
    };
  });
}

export function mapOpenAIResponsesRequestToModelTurn(request: OpenAIResponsesRequest): ModelTurn {
  const summary = inspectOpenAIResponsesModelTurnCapabilities(request);
  if (summary.unsupported[0]) throw capabilityError(summary.unsupported[0]);
  const history: ModelTurnMessage[] = [];
  for (const [index, raw] of request.input.entries()) {
    const item = asRecord(raw); const path = `input[${index}]`;
    if (item.type === "message") history.push(mapMessage(item, path));
    else if (item.type === "reasoning") {
      const summaryParts = item.summary as WireRecord[];
      if (summaryParts.length > 0) history.push({ role: "assistant", parts: summaryParts.map((part) => ({ type: "reasoning-summary", text: part.text as string })) });
    } else if (item.type === "function_call") {
      let value: unknown; try { value = JSON.parse(item.arguments as string); } catch { throw new OpenAIResponsesModelTurnError("invalid-function-arguments", "Function arguments must contain a JSON object.", `${path}.arguments`); }
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new OpenAIResponsesModelTurnError("invalid-function-arguments", "Function arguments must contain a JSON object.", `${path}.arguments`);
      history.push({ role: "assistant", parts: [{ type: "tool-call", call: { kind: "function", id: item.call_id as string, name: item.name as string, input: { kind: "json-object", value: value as ModelJsonObject } } }] });
    } else if (item.type === "custom_tool_call") history.push({ role: "assistant", parts: [{ type: "tool-call", call: { kind: "custom", id: item.call_id as string, name: item.name as string, input: { kind: "raw-text", value: item.input as string } } }] });
    else if (item.type === "function_call_output" || item.type === "custom_tool_call_output") history.push({ role: "user", parts: [{ type: "tool-result", callId: item.call_id as string, content: mapToolResultContent(item.output, `${path}.output`) }] });
  }
  const tools = mapTools(request);
  const choice = request.tool_choice;
  let toolChoice: ModelToolChoice | undefined;
  if (choice === "auto" || choice === "none" || choice === "required") toolChoice = { kind: choice };
  else if (choice !== undefined) toolChoice = { kind: "tool", name: asRecord(choice).name as string };
  const text = request.text === undefined ? undefined : asRecord(request.text); const format = text?.format === undefined ? undefined : asRecord(text.format);
  const reasoningWire = request.reasoning === undefined ? undefined : asRecord(request.reasoning);
  const turn: ModelTurn = {
    ...(request.instructions === undefined ? {} : { instructions: request.instructions as string }), history,
    ...(tools === undefined ? {} : { tools }), ...(toolChoice === undefined ? {} : { toolChoice }),
    ...(request.parallel_tool_calls === undefined ? {} : { parallelToolCalls: request.parallel_tool_calls as boolean }),
    ...(format === undefined ? {} : { responseFormat: { kind: "json-schema", name: format.name as string, schema: cloneJsonObject(format.schema), ...(format.strict === undefined ? {} : { strict: format.strict as boolean }) } as const }),
    ...(reasoningWire === undefined ? {} : { reasoning: { ...(reasoningWire.effort === undefined ? {} : { effort: reasoningWire.effort as "low" | "medium" | "high" | "xhigh" }), ...(reasoningWire.summary === undefined ? {} : { summary: reasoningWire.summary as "auto" | "concise" | "detailed" }) } }),
    ...(text?.verbosity === undefined ? {} : { textVerbosity: text.verbosity as "low" | "medium" | "high" }),
  };
  validateModelTurn(turn); return structuredClone(turn);
}

export function mapModelTurnResultToOpenAIResponsesEvents(input: {
  readonly responseId: string; readonly model: string; readonly result: ModelTurnResult;
}): OpenAIResponsesEventProjection {
  validateModelTurnResult(input.result);
  const stream = createResponsesStreamState({ responseId: input.responseId, model: input.model });
  const events: ResponsesSseEvent[] = [stream.created(), stream.inProgress()];
  let outputIndex = 0;
  for (const part of input.result.parts) {
    if (part.type === "reasoning-summary") {
      const itemId = `rs_${input.responseId}_${outputIndex}`;
      events.push(stream.reasoningAdded(itemId, outputIndex), stream.reasoningSummaryPartAdded(itemId, outputIndex, 0), stream.reasoningSummaryTextDelta(itemId, outputIndex, 0, part.text), stream.reasoningSummaryTextDone(itemId, outputIndex, 0, part.text));
      events.push(stream.outputItemDone({ itemId, outputIndex, item: { id: itemId, type: "reasoning", summary: [{ type: "summary_text", text: part.text }] } }));
    } else if (part.type === "text") {
      const itemId = `msg_${input.responseId}_${outputIndex}`;
      events.push(stream.messageAdded(itemId, outputIndex), stream.outputTextPartAdded(itemId, outputIndex), stream.outputTextDelta(itemId, outputIndex, part.text), stream.outputTextDone(itemId, outputIndex, part.text), stream.outputTextPartDone(itemId, outputIndex, part.text));
      events.push(stream.outputItemDone({ itemId, outputIndex, item: { id: itemId, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: part.text, annotations: [] }] } }));
    } else if (part.type === "tool-call" && part.call.kind === "function") {
      const itemId = `fc_${part.call.id}`; const argumentsValue = JSON.stringify(part.call.input.value);
      events.push(stream.functionCallAdded({ itemId, callId: part.call.id, name: part.call.name, outputIndex }), stream.functionCallArgumentsDelta(itemId, outputIndex, argumentsValue), stream.functionCallArgumentsDone(itemId, outputIndex, argumentsValue));
      events.push(stream.outputItemDone({ itemId, outputIndex, item: { id: itemId, type: "function_call", call_id: part.call.id, name: part.call.name, arguments: argumentsValue, status: "completed" } }));
    } else if (part.type === "tool-call" && part.call.kind === "custom") {
      const itemId = `ctc_${part.call.id}`; const raw = part.call.input.value;
      events.push(stream.customToolCallAdded({ itemId, callId: part.call.id, name: part.call.name, outputIndex }), stream.customToolCallInputDelta(itemId, outputIndex, raw), stream.customToolCallInputDone(itemId, outputIndex, raw));
      events.push(stream.outputItemDone({ itemId, outputIndex, item: { id: itemId, type: "custom_tool_call", call_id: part.call.id, name: part.call.name, input: raw, status: "completed" } }));
    } else throw new OpenAIResponsesModelTurnError("unsupported-result-part", `Model result part '${part.type}' cannot be represented by the Responses stream.`, `parts[${outputIndex}]`);
    outputIndex++;
  }
  const usage = input.result.usage;
  events.push(stream.completed({ input_tokens: usage.inputTokens, input_tokens_details: { cached_tokens: usage.cacheReadTokens }, output_tokens: usage.outputTokens, total_tokens: usage.inputTokens + usage.outputTokens }));
  const omissions: readonly OpenAIResponsesProjectionOmission[] = Object.freeze(usage.cacheWriteTokens > 0
    ? [Object.freeze({ code: "cache-write-tokens-not-representable", field: "usage.cacheWriteTokens", value: usage.cacheWriteTokens, protocolVersion: "codex-0.144.5" })]
    : []);
  return Object.assign(events, { omissions }) as OpenAIResponsesEventProjection;
}
