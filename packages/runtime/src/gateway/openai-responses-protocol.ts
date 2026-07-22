/** Pure, clean-room boundary for the Codex CLI 0.144.5 Responses wire subset. */
export const OPENAI_RESPONSES_PROTOCOL_LIMITS = {
  maxStringLength: 65_536,
  maxMessageContentLength: 262_144,
  maxImageDataUrlLength: 35_000_000,
  maxAggregateStringBytes: 50 * 1024 * 1024,
  maxPortableNodes: 25_000,
  maxPortableProperties: 50_000,
  maxPortableDepth: 32,
  maxInputItems: 128,
  maxTopLevelTools: 32,
  maxNamespaceTools: 32,
  maxExpandedTools: 128,
  maxMetadataEntries: 16,
  maxMetadataKeyLength: 64,
  maxMetadataValueLength: 4_096,
} as const;

export class OpenAIResponsesProtocolError extends Error {
  override name = "OpenAIResponsesProtocolError";
}

type RecordValue = Record<string, unknown>;
export type OpenAIResponsesRequest = RecordValue & { model: string; input: unknown[]; stream: true; store: false; max_output_tokens?: number };

const TOP_LEVEL_KEYS = new Set([
  "model", "instructions", "input", "tools", "tool_choice", "parallel_tool_calls",
  "reasoning", "text", "stream", "stream_options", "store", "include",
  "prompt_cache_key", "service_tier", "client_metadata",
  "max_output_tokens",
]);
const CALL_TYPES = new Set(["function_call", "custom_tool_call", "local_shell_call", "tool_search_call"]);
const INPUT_TYPES = new Set([
  "message", "reasoning", "item_reference", ...CALL_TYPES,
  "function_call_output", "custom_tool_call_output", "tool_search_output",
]);

function fail(message: string): never { throw new OpenAIResponsesProtocolError(message); }

function dataObject(value: unknown, label: string): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be a plain data object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain data object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(`${label} must use string keys`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail(`${label} must contain only data properties`);
  }
  return value as RecordValue;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  let entries = 0;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(`${label} must use string keys`);
    if (key === "length") continue;
    if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) fail(`${label} must contain only index properties`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail(`${label} must contain only data entries`);
    entries++;
  }
  if (entries !== value.length) fail(`${label} must be a dense array`);
  return value;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else bytes += 3;
  }
  return bytes;
}

function validatePlainDataBudget(value: unknown): void {
  const seen = new WeakSet<object>();
  let nodes = 0; let properties = 0; let aggregateStringBytes = 0;
  const countString = (entry: string) => {
    aggregateStringBytes += utf8ByteLength(entry);
    if (aggregateStringBytes > OPENAI_RESPONSES_PROTOCOL_LIMITS.maxAggregateStringBytes) fail("request exceeds the aggregate request budget");
  };
  const visit = (entry: unknown, label: string, depth: number): void => {
    nodes++;
    if (nodes > OPENAI_RESPONSES_PROTOCOL_LIMITS.maxPortableNodes) fail("request exceeds the portable node count");
    if (depth > OPENAI_RESPONSES_PROTOCOL_LIMITS.maxPortableDepth) fail("request exceeds the portable nesting depth");
    if (typeof entry === "string") { countString(entry); return; }
    if (entry === null || typeof entry === "boolean" || (typeof entry === "number" && Number.isFinite(entry))) return;
    if (typeof entry !== "object") fail(`${label} contains a non-portable value`);
    if (seen.has(entry)) fail(`${label} must be acyclic plain data`); seen.add(entry);
    if (Array.isArray(entry)) {
      const values = array(entry, label); properties += values.length;
      if (properties > OPENAI_RESPONSES_PROTOCOL_LIMITS.maxPortableProperties) fail("request exceeds the portable property count");
      for (let index = 0; index < values.length; index++) visit(values[index], `${label}[${index}]`, depth + 1);
      return;
    }
    const object = dataObject(entry, label); const entries = Object.entries(object); properties += entries.length;
    if (properties > OPENAI_RESPONSES_PROTOCOL_LIMITS.maxPortableProperties) fail("request exceeds the portable property count");
    for (const [key, child] of entries) { countString(key); visit(child, `${label}.${key}`, depth + 1); }
  };
  visit(value, "request", 0);
}

function boundedString(value: unknown, label: string, maximum: number = OPENAI_RESPONSES_PROTOCOL_LIMITS.maxStringLength): string {
  if (typeof value !== "string") fail(`${label} must be a string`);
  if (value.length > maximum) fail(`${label} exceeds ${maximum} characters`);
  return value;
}
function optionalString(value: unknown, label: string): void { if (value !== undefined) boundedString(value, label); }
function noUnknown(value: RecordValue, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} contains unsupported field '${key}'`);
}
function oneOf(value: unknown, choices: readonly string[], label: string): string {
  const result = boundedString(value, label);
  if (!choices.includes(result)) fail(`${label} is unsupported`);
  return result;
}
function portable(value: unknown, label: string, depth = 0): void {
  if (depth > 32) fail(`${label} exceeds the nesting bound`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const entry of array(value, label)) portable(entry, label, depth + 1); return; }
  const object = dataObject(value, label); for (const entry of Object.values(object)) portable(entry, label, depth + 1);
}
function validJson(value: unknown, label: string): void {
  try { portable(JSON.parse(boundedString(value, label)), label); } catch (error) {
    if (error instanceof OpenAIResponsesProtocolError) throw error;
    fail(`${label} must contain valid JSON`);
  }
}

function validateContent(content: unknown, role: string): void {
  if (typeof content === "string") { boundedString(content, "message content", OPENAI_RESPONSES_PROTOCOL_LIMITS.maxMessageContentLength); return; }
  const parts = array(content, "message content"); if (parts.length === 0) fail("message content must not be empty");
  for (const part of parts) {
    const entry = dataObject(part, "content part");
    if (entry.type === "input_text") { noUnknown(entry, ["type", "text"], "input_text"); boundedString(entry.text, "input_text.text", OPENAI_RESPONSES_PROTOCOL_LIMITS.maxMessageContentLength); continue; }
    if (entry.type === "output_text" && role === "assistant") {
      noUnknown(entry, ["type", "text", "annotations", "logprobs"], "output_text"); boundedString(entry.text, "output_text.text");
      if (entry.annotations !== undefined) portable(array(entry.annotations, "output_text.annotations"), "output_text.annotations");
      if (entry.logprobs !== undefined) portable(array(entry.logprobs, "output_text.logprobs"), "output_text.logprobs");
      continue;
    }
    if (entry.type === "input_image" && role !== "assistant") {
      noUnknown(entry, ["type", "image_url", "file_id", "detail"], "input_image");
      if (entry.image_url === undefined && entry.file_id === undefined) fail("input_image requires image_url or file_id");
      if (entry.image_url !== undefined) {
        const raw = typeof entry.image_url === "string" ? entry.image_url : "";
        boundedString(entry.image_url, "input_image.image_url", raw.startsWith("data:image/") ? OPENAI_RESPONSES_PROTOCOL_LIMITS.maxImageDataUrlLength : OPENAI_RESPONSES_PROTOCOL_LIMITS.maxStringLength);
      }
      optionalString(entry.file_id, "input_image.file_id");
      if (entry.detail !== undefined) oneOf(entry.detail, ["auto", "low", "high"], "input_image.detail");
      continue;
    }
    fail("unsupported message content type");
  }
}

type CallKind = "function" | "custom" | "tool_search";
type CallRecord = { kind: CallKind; outputSeen: boolean };
function registerCall(callIds: Map<string, CallRecord>, id: string, kind: CallKind): void {
  if (callIds.has(id)) fail("duplicate call_id is unsafe");
  callIds.set(id, { kind, outputSeen: false });
}
function requireCall(callIds: Map<string, CallRecord>, id: string, expected: CallKind, label: string): void {
  const record = callIds.get(id);
  if (!record) fail(`${label} requires a matching earlier call`);
  if (record.kind !== expected) fail(`${label} requires a matching ${expected} call`);
  if (record.outputSeen) fail(`${label} is a duplicate tool output`);
  record.outputSeen = true;
}

function validateInputItem(value: unknown, callIds: Map<string, CallRecord>): void {
  const item = dataObject(value, "input item"); const type = boundedString(item.type, "input item.type");
  if (!INPUT_TYPES.has(type)) fail("unsupported input item type");
  if (type === "message") {
    noUnknown(item, ["type", "id", "role", "content", "status", "phase"], "message");
    const role = oneOf(item.role, ["user", "developer", "assistant"], "message.role"); validateContent(item.content, role);
    optionalString(item.id, "message.id"); optionalString(item.status, "message.status"); optionalString(item.phase, "message.phase"); return;
  }
  if (type === "reasoning") {
    noUnknown(item, ["type", "id", "summary", "content", "encrypted_content"], "reasoning"); optionalString(item.id, "reasoning.id"); optionalString(item.encrypted_content, "reasoning.encrypted_content");
    for (const part of array(item.summary, "reasoning.summary")) { const summary = dataObject(part, "reasoning summary part"); noUnknown(summary, ["type", "text"], "reasoning summary part"); if (summary.type !== "summary_text") fail("unsupported reasoning summary part"); boundedString(summary.text, "reasoning summary text"); }
    if (item.content !== undefined) for (const part of array(item.content, "reasoning.content")) { const content = dataObject(part, "reasoning content"); noUnknown(content, ["type", "text"], "reasoning content"); if (content.type !== "reasoning_text") fail("unsupported reasoning content"); boundedString(content.text, "reasoning content text"); }
    return;
  }
  if (type === "item_reference") { noUnknown(item, ["type", "id"], "item_reference"); boundedString(item.id, "item_reference.id"); return; }

  if (CALL_TYPES.has(type)) {
    const callId = boundedString(item.call_id, `${type}.call_id`); optionalString(item.id, `${type}.id`);
    if (type === "function_call") { noUnknown(item, ["type", "id", "call_id", "name", "arguments", "status", "namespace"], type); boundedString(item.name, `${type}.name`); validJson(item.arguments, `${type}.arguments`); optionalString(item.namespace, `${type}.namespace`); registerCall(callIds, callId, "function"); }
    else if (type === "custom_tool_call") { noUnknown(item, ["type", "id", "call_id", "name", "input", "status", "namespace"], type); boundedString(item.name, `${type}.name`); boundedString(item.input, `${type}.input`); optionalString(item.namespace, `${type}.namespace`); registerCall(callIds, callId, "custom"); }
    else if (type === "local_shell_call") { noUnknown(item, ["type", "id", "call_id", "action", "status"], type); portable(dataObject(item.action, `${type}.action`), `${type}.action`); registerCall(callIds, callId, "function"); }
    else { noUnknown(item, ["type", "id", "call_id", "arguments", "execution", "status"], type); portable(dataObject(item.arguments, `${type}.arguments`), `${type}.arguments`); oneOf(item.execution, ["client"], `${type}.execution`); registerCall(callIds, callId, "tool_search"); }
    optionalString(item.status, `${type}.status`); return;
  }

  const callId = boundedString(item.call_id, `${type}.call_id`); optionalString(item.id, `${type}.id`);
  if (type === "function_call_output") { noUnknown(item, ["type", "id", "call_id", "output", "status"], type); requireCall(callIds, callId, "function", type); validateContent(item.output, "user"); }
  else if (type === "custom_tool_call_output") { noUnknown(item, ["type", "id", "call_id", "output", "status", "name"], type); requireCall(callIds, callId, "custom", type); validateContent(item.output, "user"); optionalString(item.name, `${type}.name`); }
  else { noUnknown(item, ["type", "id", "call_id", "status", "execution", "tools"], type); requireCall(callIds, callId, "tool_search", type); oneOf(item.execution, ["client"], `${type}.execution`); optionalString(item.status, `${type}.status`); portable(array(item.tools, `${type}.tools`), `${type}.tools`); }
}

function validateTools(value: unknown): void {
  const tools = array(value, "tools"); if (tools.length > OPENAI_RESPONSES_PROTOCOL_LIMITS.maxTopLevelTools) fail("tools exceeds the supported bound");
  let expandedTools = 0;
  for (const raw of tools) {
    const tool = dataObject(raw, "tool"); const type = boundedString(tool.type, "tool.type");
    if (type === "function") { expandedTools++; noUnknown(tool, ["type", "name", "description", "parameters", "strict", "namespace", "defer_loading"], "function tool"); boundedString(tool.name, "function tool.name"); optionalString(tool.description, "function tool.description"); optionalString(tool.namespace, "function tool.namespace"); if (tool.strict !== undefined && typeof tool.strict !== "boolean") fail("function tool.strict must be boolean"); if (tool.defer_loading !== undefined && typeof tool.defer_loading !== "boolean") fail("function tool.defer_loading must be boolean"); if (tool.parameters !== undefined) portable(dataObject(tool.parameters, "function tool.parameters"), "function tool.parameters"); }
    else if (type === "custom") {
      expandedTools++;
      noUnknown(tool, ["type", "name", "description", "format", "namespace", "defer_loading"], "custom tool"); boundedString(tool.name, "custom tool.name"); optionalString(tool.description, "custom tool.description"); optionalString(tool.namespace, "custom tool.namespace"); if (tool.defer_loading !== undefined && typeof tool.defer_loading !== "boolean") fail("custom tool.defer_loading must be boolean");
      if (tool.format !== undefined) { const format = dataObject(tool.format, "custom tool.format"); noUnknown(format, ["type", "syntax", "definition"], "custom tool.format"); if (format.type !== "grammar") fail("custom tool.format.type is unsupported"); oneOf(format.syntax, ["lark"], "custom tool.format.syntax"); boundedString(format.definition, "custom tool.format.definition"); }
    } else if (type === "tool_search") { expandedTools++; noUnknown(tool, ["type", "description"], "tool_search tool"); optionalString(tool.description, "tool_search.description"); }
    else if (type === "namespace") {
      noUnknown(tool, ["type", "name", "description", "tools"], "namespace tool");
      boundedString(tool.name, "namespace tool.name"); optionalString(tool.description, "namespace tool.description");
      const nested = array(tool.tools, "namespace tool.tools");
      if (nested.length === 0 || nested.length > OPENAI_RESPONSES_PROTOCOL_LIMITS.maxNamespaceTools) fail("namespace tool.tools exceeds the supported bound");
      expandedTools += nested.length;
      for (const rawNested of nested) {
        const nestedTool = dataObject(rawNested, "namespace function tool");
        if (nestedTool.type !== "function") fail("namespace tools must be functions");
        noUnknown(nestedTool, ["type", "name", "description", "parameters", "strict"], "namespace function tool");
        boundedString(nestedTool.name, "namespace function tool.name"); optionalString(nestedTool.description, "namespace function tool.description");
        if (nestedTool.strict !== undefined && typeof nestedTool.strict !== "boolean") fail("namespace function tool.strict must be boolean");
        if (nestedTool.parameters !== undefined) portable(dataObject(nestedTool.parameters, "namespace function tool.parameters"), "namespace function tool.parameters");
      }
    } else if (type === "web_search") {
      expandedTools++;
      noUnknown(tool, ["type", "external_web_access"], "web_search tool");
      if (typeof tool.external_web_access !== "boolean") fail("web_search tool.external_web_access must be boolean");
    }
    else fail("unsupported tool type");
    if (expandedTools > OPENAI_RESPONSES_PROTOCOL_LIMITS.maxExpandedTools) fail("tools exceeds the expanded tool bound");
  }
}

export function parseOpenAIResponsesRequest(value: unknown): OpenAIResponsesRequest {
  validatePlainDataBudget(value);
  const source = dataObject(value, "request"); for (const key of Object.keys(source)) if (!TOP_LEVEL_KEYS.has(key)) fail(`unknown top-level field '${key}'`);
  const request = structuredClone(source);
  if (request.reasoning === null) delete request.reasoning;
  if (Array.isArray(request.input)) for (const raw of request.input) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as RecordValue;
    if (item.type === undefined && item.role !== undefined && item.content !== undefined) item.type = "message";
    if (item.type === "message" && item.role === "system") item.role = "developer";
  }
  boundedString(request.model, "model"); optionalString(request.instructions, "instructions");
  if (request.stream !== true) fail("only stream=true is supported"); if (request.store !== false) fail("only store=false is supported");
  const input = array(request.input, "input"); if (input.length === 0 || input.length > OPENAI_RESPONSES_PROTOCOL_LIMITS.maxInputItems) fail("input must be within the supported item bound");
  const callIds = new Map<string, CallRecord>(); for (const item of input) validateInputItem(item, callIds);
  if (request.tools !== undefined) validateTools(request.tools);
  if (request.parallel_tool_calls !== undefined && typeof request.parallel_tool_calls !== "boolean") fail("parallel_tool_calls must be boolean");
  if (request.tool_choice !== undefined && !["auto", "none", "required"].includes(request.tool_choice as string)) { const choice = dataObject(request.tool_choice, "tool_choice"); noUnknown(choice, ["type", "namespace", "name"], "tool_choice"); const type = oneOf(choice.type, ["function", "custom"], "tool_choice.type"); if (type === "custom" && choice.namespace !== undefined) fail("custom tool_choice does not support namespace"); optionalString(choice.namespace, "tool_choice.namespace"); boundedString(choice.name, "tool_choice.name"); }
  if (request.reasoning !== undefined) { const reasoning = dataObject(request.reasoning, "reasoning"); noUnknown(reasoning, ["effort", "summary", "context"], "reasoning"); if (reasoning.effort !== undefined) oneOf(reasoning.effort, ["low", "medium", "high", "xhigh"], "reasoning.effort"); if (reasoning.summary !== undefined) oneOf(reasoning.summary, ["auto", "concise", "detailed"], "reasoning.summary"); if (reasoning.context !== undefined) oneOf(reasoning.context, ["auto", "current_turn", "all_turns"], "reasoning.context"); }
  if (request.stream_options !== undefined) { const options = dataObject(request.stream_options, "stream_options"); noUnknown(options, ["reasoning_summary_delivery"], "stream_options"); oneOf(options.reasoning_summary_delivery, ["sequential_cutoff"], "stream_options.reasoning_summary_delivery"); }
  if (request.include !== undefined) for (const entry of array(request.include, "include")) oneOf(entry, ["reasoning.encrypted_content"], "include entry");
  if (request.text !== undefined) { const text = dataObject(request.text, "text"); noUnknown(text, ["verbosity", "format"], "text"); if (text.verbosity !== undefined) oneOf(text.verbosity, ["low", "medium", "high"], "text.verbosity"); if (text.format !== undefined) { const format = dataObject(text.format, "text.format"); noUnknown(format, ["type", "name", "schema", "strict"], "text.format"); if (format.type !== "json_schema") fail("unsupported text format"); boundedString(format.name, "text.format.name"); portable(dataObject(format.schema, "text.format.schema"), "text.format.schema"); if (format.strict !== undefined && typeof format.strict !== "boolean") fail("text.format.strict must be boolean"); } }
  optionalString(request.prompt_cache_key, "prompt_cache_key"); optionalString(request.service_tier, "service_tier");
  if (request.max_output_tokens !== undefined && (!Number.isSafeInteger(request.max_output_tokens) || (request.max_output_tokens as number) <= 0)) fail("max_output_tokens must be a positive integer");
  if (request.client_metadata !== undefined) { const metadata = dataObject(request.client_metadata, "client_metadata"); const entries = Object.entries(metadata); if (entries.length > OPENAI_RESPONSES_PROTOCOL_LIMITS.maxMetadataEntries) fail("client_metadata exceeds entry bound"); for (const [key, entry] of entries) if (key.length > OPENAI_RESPONSES_PROTOCOL_LIMITS.maxMetadataKeyLength || typeof entry !== "string" || entry.length > OPENAI_RESPONSES_PROTOCOL_LIMITS.maxMetadataValueLength) fail("client_metadata exceeds documented bounds"); }
  return request as OpenAIResponsesRequest;
}

export type ResponsesSseEvent = RecordValue & { type: string; sequence_number: number };
export type ResponsesFailureCode = "internal_error" | "rate_limit_exceeded" | "service_unavailable" | "timeout";
const FAILURE_MESSAGES: Record<ResponsesFailureCode, string> = {
  internal_error: "The response could not be completed.", rate_limit_exceeded: "The request rate limit was exceeded.",
  service_unavailable: "The service is temporarily unavailable.", timeout: "The response timed out.",
};
export function encodeSseEvent(event: ResponsesSseEvent): string { return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`; }

type OutputKind = "message" | "reasoning" | "function_call" | "custom_tool_call";
type ActiveOutput = { kind: OutputKind; itemId: string; outputIndex: number; stage: string };
export function createResponsesStreamState(response: { responseId: string; model: string }) {
  let sequence = 0; let phase: "initial" | "created" | "in_progress" | "terminal" = "initial"; let active: ActiveOutput | undefined;
  const completedItems: RecordValue[] = [];
  const event = (type: string, body: RecordValue): ResponsesSseEvent => ({ type, sequence_number: ++sequence, ...body });
  const responseObject = (status: string, extra: RecordValue = {}) => ({ id: response.responseId, object: "response", model: response.model, status, output: [], ...extra });
  const requirePhase = (expected: "initial" | "created" | "in_progress") => {
    if (phase === expected) return;
    if (phase === "initial") fail("response.created must be emitted first");
    fail(expected === "initial" ? "response.created was already emitted" : "response.in_progress must be emitted first");
  };
  const requireActive = (kind: OutputKind, itemId: string, outputIndex: number, stages: string[]) => { requirePhase("in_progress"); if (!active || active.kind !== kind || active.itemId !== itemId || active.outputIndex !== outputIndex || !stages.includes(active.stage)) fail("output event violates item lifecycle ordering"); return active; };
  const add = (kind: OutputKind, itemId: string, outputIndex: number, item: RecordValue) => { requirePhase("in_progress"); if (active) fail("previous output item must be done first"); active = { kind, itemId, outputIndex, stage: "added" }; return event("response.output_item.added", { output_index: outputIndex, item }); };
  return {
    created: () => { requirePhase("initial"); phase = "created"; return event("response.created", { response: responseObject("in_progress") }); },
    inProgress: () => { requirePhase("created"); phase = "in_progress"; return event("response.in_progress", { response: responseObject("in_progress") }); },
    messageAdded: (itemId: string, outputIndex: number) => add("message", itemId, outputIndex, { id: itemId, type: "message", role: "assistant", status: "in_progress", content: [] }),
    outputTextPartAdded: (itemId: string, outputIndex: number) => { const item = requireActive("message", itemId, outputIndex, ["added"]); item.stage = "content_added"; return event("response.content_part.added", { item_id: itemId, output_index: outputIndex, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }); },
    outputTextDelta: (itemId: string, outputIndex: number, delta: string) => { const item = requireActive("message", itemId, outputIndex, ["content_added", "delta"]); item.stage = "delta"; return event("response.output_text.delta", { item_id: itemId, output_index: outputIndex, content_index: 0, delta }); },
    outputTextDone: (itemId: string, outputIndex: number, text: string) => { const item = requireActive("message", itemId, outputIndex, ["content_added", "delta"]); item.stage = "text_done"; return event("response.output_text.done", { item_id: itemId, output_index: outputIndex, content_index: 0, text }); },
    outputTextPartDone: (itemId: string, outputIndex: number, text: string) => { const item = requireActive("message", itemId, outputIndex, ["text_done"]); item.stage = "content_done"; return event("response.content_part.done", { item_id: itemId, output_index: outputIndex, content_index: 0, part: { type: "output_text", text, annotations: [] } }); },
    reasoningAdded: (itemId: string, outputIndex: number) => add("reasoning", itemId, outputIndex, { id: itemId, type: "reasoning", summary: [] }),
    reasoningSummaryPartAdded: (itemId: string, outputIndex: number, summaryIndex: number) => { const item = requireActive("reasoning", itemId, outputIndex, ["added"]); item.stage = "summary_part_added"; return event("response.reasoning_summary_part.added", { item_id: itemId, output_index: outputIndex, summary_index: summaryIndex, part: { type: "summary_text", text: "" } }); },
    reasoningSummaryTextDelta: (itemId: string, outputIndex: number, summaryIndex: number, delta: string) => { const item = requireActive("reasoning", itemId, outputIndex, ["summary_part_added", "summary_delta"]); item.stage = "summary_delta"; return event("response.reasoning_summary_text.delta", { item_id: itemId, output_index: outputIndex, summary_index: summaryIndex, delta }); },
    reasoningSummaryTextDone: (itemId: string, outputIndex: number, summaryIndex: number, text: string) => { const item = requireActive("reasoning", itemId, outputIndex, ["summary_part_added", "summary_delta"]); item.stage = "summary_done"; return event("response.reasoning_summary_text.done", { item_id: itemId, output_index: outputIndex, summary_index: summaryIndex, text }); },
    functionCallAdded: (input: { itemId: string; callId: string; namespace?: string; name: string; outputIndex: number }) => add("function_call", input.itemId, input.outputIndex, { id: input.itemId, type: "function_call", call_id: input.callId, ...(input.namespace === undefined ? {} : { namespace: input.namespace }), name: input.name, arguments: "", status: "in_progress" }),
    functionCallArgumentsDelta: (itemId: string, outputIndex: number, delta: string) => { const item = requireActive("function_call", itemId, outputIndex, ["added", "delta"]); item.stage = "delta"; return event("response.function_call_arguments.delta", { item_id: itemId, output_index: outputIndex, delta }); },
    functionCallArgumentsDone: (itemId: string, outputIndex: number, argumentsValue: string) => { validJson(argumentsValue, "function call arguments"); const item = requireActive("function_call", itemId, outputIndex, ["added", "delta"]); item.stage = "arguments_done"; return event("response.function_call_arguments.done", { item_id: itemId, output_index: outputIndex, arguments: argumentsValue }); },
    customToolCallAdded: (input: { itemId: string; callId: string; name: string; outputIndex: number }) => add("custom_tool_call", input.itemId, input.outputIndex, { id: input.itemId, type: "custom_tool_call", call_id: input.callId, name: input.name, input: "", status: "in_progress" }),
    customToolCallInputDelta: (itemId: string, outputIndex: number, delta: string) => { const item = requireActive("custom_tool_call", itemId, outputIndex, ["added", "delta"]); item.stage = "delta"; return event("response.custom_tool_call_input.delta", { item_id: itemId, output_index: outputIndex, delta }); },
    customToolCallInputDone: (itemId: string, outputIndex: number, input: string) => { const item = requireActive("custom_tool_call", itemId, outputIndex, ["added", "delta"]); item.stage = "input_done"; return event("response.custom_tool_call_input.done", { item_id: itemId, output_index: outputIndex, input }); },
    outputItemDone: (input: { itemId: string; outputIndex: number; item: RecordValue }) => {
      const completedItem = dataObject(input.item, "completed output item"); portable(completedItem, "completed output item");
      const kind = completedItem.type; if (kind !== "message" && kind !== "reasoning" && kind !== "function_call" && kind !== "custom_tool_call") fail("unsupported completed output item type");
      const expectedStage = kind === "message" ? "content_done" : kind === "reasoning" ? "summary_done" : kind === "function_call" ? "arguments_done" : "input_done";
      requireActive(kind, input.itemId, input.outputIndex, [expectedStage]);
      if (completedItem.id !== input.itemId || (kind !== "reasoning" && completedItem.status !== "completed")) fail("completed output item identity or status is invalid");
      if (kind === "message") { noUnknown(completedItem, ["id", "type", "role", "status", "content"], "completed message"); if (completedItem.role !== "assistant") fail("completed message role is invalid"); validateContent(completedItem.content, "assistant"); }
      else if (kind === "reasoning") { noUnknown(completedItem, ["id", "type", "summary"], "completed reasoning"); const summaries = array(completedItem.summary, "completed reasoning.summary"); if (summaries.length === 0) fail("completed reasoning.summary must not be empty"); for (const raw of summaries) { const summary = dataObject(raw, "completed reasoning summary"); noUnknown(summary, ["type", "text"], "completed reasoning summary"); if (summary.type !== "summary_text") fail("completed reasoning summary type is invalid"); boundedString(summary.text, "completed reasoning summary text"); } }
      else if (kind === "function_call") { noUnknown(completedItem, ["id", "type", "call_id", "name", "arguments", "status", "namespace"], "completed function call"); boundedString(completedItem.call_id, "completed function call.call_id"); boundedString(completedItem.name, "completed function call.name"); validJson(completedItem.arguments, "completed function call.arguments"); }
      else { noUnknown(completedItem, ["id", "type", "call_id", "name", "input", "status", "namespace"], "completed custom tool call"); boundedString(completedItem.call_id, "completed custom tool call.call_id"); boundedString(completedItem.name, "completed custom tool call.name"); boundedString(completedItem.input, "completed custom tool call.input"); }
      const snapshot = structuredClone(completedItem) as RecordValue; completedItems.push(snapshot); active = undefined;
      return event("response.output_item.done", { item_id: input.itemId, output_index: input.outputIndex, item: structuredClone(snapshot) });
    },
    completed: (usage: { input_tokens: number; output_tokens: number; total_tokens: number; input_tokens_details?: { cached_tokens: number } }) => { requirePhase("in_progress"); if (active) fail("active output item must be done before terminal event"); if (!Number.isSafeInteger(usage.input_tokens) || !Number.isSafeInteger(usage.output_tokens) || usage.input_tokens < 0 || usage.output_tokens < 0 || usage.total_tokens !== usage.input_tokens + usage.output_tokens) fail("usage.total_tokens must equal input_tokens + output_tokens"); const details = usage.input_tokens_details; if (details && (!Number.isSafeInteger(details.cached_tokens) || details.cached_tokens < 0 || details.cached_tokens > usage.input_tokens)) fail("usage.input_tokens_details.cached_tokens must be a non-negative subset of input_tokens"); phase = "terminal"; return event("response.completed", { response: responseObject("completed", { output: structuredClone(completedItems), usage: structuredClone(usage) }) }); },
    failed: (code: ResponsesFailureCode) => { if (phase !== "created" && phase !== "in_progress") fail("response must be created before a terminal event"); const error = { code, message: FAILURE_MESSAGES[code] }; if (!error.message) fail("unsupported failure code"); active = undefined; phase = "terminal"; return event("response.failed", { error, response: responseObject("failed", { error }) }); },
  };
}
