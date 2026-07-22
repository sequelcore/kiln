export const ANTHROPIC_MESSAGES_VERSION = "2023-06-01";
export const ANTHROPIC_MESSAGES_PROTOCOL_LIMITS = Object.freeze({ maxMessages: 4096, maxBlocksPerMessage: 4096, maxSystemBlocks: 256, maxTools: 256, maxJsonDepth: 64, maxJsonNodes: 100_000 });

export class AnthropicMessagesProtocolError extends Error {
  override name = "AnthropicMessagesProtocolError";
  constructor(readonly path: string, message: string) { super(message); }
}

export interface AnthropicMessagesRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly stream: true;
  readonly system?: string | readonly Record<string, unknown>[];
  readonly messages: readonly Record<string, unknown>[];
  readonly tools?: readonly Record<string, unknown>[];
  readonly tool_choice?: Record<string, unknown>;
  readonly output_config?: { readonly effort: "low" | "medium" | "high" | "xhigh" };
}

type WireRecord = Record<string, unknown>;

export function parseAnthropicMessagesRequest(value: unknown): AnthropicMessagesRequest {
  const request = record(value, "$request");
  rejectUnknown(request, ["model", "max_tokens", "stream", "system", "messages", "tools", "tool_choice", "output_config"] as const, "$request");
  identifier(request.model, "model");
  positiveInteger(request.max_tokens, "max_tokens");
  if (request.stream !== true) fail("stream", "Anthropic Messages ingress requires streaming.");
  if (!Array.isArray(request.messages) || request.messages.length === 0 || request.messages.length > ANTHROPIC_MESSAGES_PROTOCOL_LIMITS.maxMessages) fail("messages", "messages must be a bounded non-empty array.");
  request.messages.forEach((message, index) => validateMessage(message, `messages[${index}]`));
  if (request.system !== undefined) validateSystem(request.system);
  if (request.tools !== undefined) {
    if (!Array.isArray(request.tools) || request.tools.length > ANTHROPIC_MESSAGES_PROTOCOL_LIMITS.maxTools) fail("tools", "tools must be a bounded array.");
    request.tools.forEach((tool, index) => validateTool(tool, `tools[${index}]`));
  }
  if (request.tool_choice !== undefined) validateToolChoice(request.tool_choice);
  if (request.output_config !== undefined) validateOutputConfig(request.output_config);
  return structuredClone(request) as unknown as AnthropicMessagesRequest;
}

function validateOutputConfig(value: unknown): void {
  const output = record(value, "output_config");
  rejectUnknown(output, ["effort"] as const, "output_config");
  if (!["low", "medium", "high", "xhigh"].includes(output.effort as string)) {
    fail("output_config.effort", "effort is unsupported by the model-turn boundary.");
  }
}

function validateSystem(value: unknown): void {
  if (typeof value === "string") return;
  if (!Array.isArray(value) || value.length === 0 || value.length > ANTHROPIC_MESSAGES_PROTOCOL_LIMITS.maxSystemBlocks) fail("system", "system must be text or bounded non-empty text blocks.");
  value.forEach((block, index) => {
    const item = record(block, `system[${index}]`);
    rejectUnknown(item, ["type", "text"] as const, `system[${index}]`);
    if (item.type !== "text" || typeof item.text !== "string") fail(`system[${index}]`, "Only text system blocks are supported.");
  });
}

function validateMessage(value: unknown, path: string): void {
  const message = record(value, path);
  rejectUnknown(message, ["role", "content"] as const, path);
  if (message.role !== "user" && message.role !== "assistant") fail(`${path}.role`, "role must be user or assistant.");
  if (typeof message.content === "string") return;
  if (!Array.isArray(message.content) || message.content.length === 0 || message.content.length > ANTHROPIC_MESSAGES_PROTOCOL_LIMITS.maxBlocksPerMessage) fail(`${path}.content`, "content must be text or bounded non-empty blocks.");
  message.content.forEach((block, index) => validateContentBlock(block, `${path}.content[${index}]`, message.role as "user" | "assistant"));
}

function validateContentBlock(value: unknown, path: string, role: "user" | "assistant"): void {
  const block = record(value, path);
  if (block.type === "text") {
    rejectUnknown(block, ["type", "text"] as const, path);
    if (typeof block.text !== "string") fail(`${path}.text`, "text must be a string.");
    return;
  }
  if (block.type === "image") {
    if (role !== "user") fail(path, "image blocks are user-only.");
    rejectUnknown(block, ["type", "source"] as const, path);
    validateImageSource(block.source, `${path}.source`);
    return;
  }
  if (block.type === "tool_use") {
    if (role !== "assistant") fail(path, "tool_use blocks are assistant-only.");
    rejectUnknown(block, ["type", "id", "name", "input"] as const, path);
    identifier(block.id, `${path}.id`); identifier(block.name, `${path}.name`); jsonObject(block.input, `${path}.input`);
    return;
  }
  if (block.type === "tool_result") {
    if (role !== "user") fail(path, "tool_result blocks are user-only.");
    rejectUnknown(block, ["type", "tool_use_id", "content", "is_error"] as const, path);
    identifier(block.tool_use_id, `${path}.tool_use_id`);
    if (block.is_error !== undefined && typeof block.is_error !== "boolean") fail(`${path}.is_error`, "is_error must be boolean.");
    validateToolResultContent(block.content, `${path}.content`);
    return;
  }
  fail(path, "Content block is not losslessly representable by the model-turn boundary.");
}

function validateToolResultContent(value: unknown, path: string): void {
  if (typeof value === "string") return;
  if (!Array.isArray(value) || value.length > ANTHROPIC_MESSAGES_PROTOCOL_LIMITS.maxBlocksPerMessage) fail(path, "tool_result content must be text or a bounded array.");
  value.forEach((block, index) => {
    const item = record(block, `${path}[${index}]`);
    if (item.type === "text") {
      rejectUnknown(item, ["type", "text"] as const, `${path}[${index}]`);
      if (typeof item.text !== "string") fail(`${path}[${index}].text`, "text must be a string.");
    } else if (item.type === "image") {
      rejectUnknown(item, ["type", "source"] as const, `${path}[${index}]`);
      validateImageSource(item.source, `${path}[${index}].source`);
    } else fail(`${path}[${index}]`, "tool_result contains an unsupported block.");
  });
}

function validateImageSource(value: unknown, path: string): void {
  const source = record(value, path);
  if (source.type === "url") {
    rejectUnknown(source, ["type", "url"] as const, path);
    if (typeof source.url !== "string" || source.url.length === 0) fail(`${path}.url`, "url must be non-empty.");
    try { if (!["https:", "http:"].includes(new URL(source.url).protocol)) fail(`${path}.url`, "url must use HTTP or HTTPS."); } catch (error) { if (error instanceof AnthropicMessagesProtocolError) throw error; fail(`${path}.url`, "url must be valid."); }
  } else if (source.type === "base64") {
    rejectUnknown(source, ["type", "media_type", "data"] as const, path);
    if (typeof source.media_type !== "string" || !["image/jpeg", "image/png", "image/gif", "image/webp"].includes(source.media_type)) fail(`${path}.media_type`, "media_type is unsupported.");
    if (typeof source.data !== "string" || source.data.length === 0 || source.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(source.data) || Buffer.from(source.data, "base64").toString("base64") !== source.data) fail(`${path}.data`, "data must be canonical non-empty base64.");
  } else fail(`${path}.type`, "image source must be url or base64.");
}

function validateTool(value: unknown, path: string): void {
  const tool = record(value, path);
  rejectUnknown(tool, ["name", "description", "input_schema"] as const, path);
  identifier(tool.name, `${path}.name`);
  if (tool.description !== undefined && typeof tool.description !== "string") fail(`${path}.description`, "description must be a string.");
  jsonObject(tool.input_schema, `${path}.input_schema`);
}

function validateToolChoice(value: unknown): void {
  const choice = record(value, "tool_choice");
  rejectUnknown(choice, ["type", "name", "disable_parallel_tool_use"] as const, "tool_choice");
  if (!["auto", "any", "tool", "none"].includes(choice.type as string)) fail("tool_choice.type", "tool choice is unsupported.");
  if (choice.type === "tool") identifier(choice.name, "tool_choice.name");
  else if (choice.name !== undefined) fail("tool_choice.name", "name requires tool choice type tool.");
  if (choice.disable_parallel_tool_use !== undefined && typeof choice.disable_parallel_tool_use !== "boolean") fail("tool_choice.disable_parallel_tool_use", "must be boolean.");
}

function record(value: unknown, path: string): WireRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "must be an object.");
  return value as WireRecord;
}
function rejectUnknown(value: WireRecord, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) fail(`${path}.${unknown}`, "field is not losslessly representable.");
}
function identifier(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value !== value.trim()) fail(path, "must be a canonical non-empty identifier.");
}
function positiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail(path, "must be a positive integer.");
}
function jsonObject(value: unknown, path: string): asserts value is WireRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "must be a JSON object.");
  let nodes = 0;
  const visit = (entry: unknown, depth: number): void => {
    nodes++;
    if (depth > ANTHROPIC_MESSAGES_PROTOCOL_LIMITS.maxJsonDepth || nodes > ANTHROPIC_MESSAGES_PROTOCOL_LIMITS.maxJsonNodes) fail(path, "JSON value exceeds structural limits.");
    if (entry === null || typeof entry === "string" || typeof entry === "boolean" || (typeof entry === "number" && Number.isFinite(entry))) return;
    if (Array.isArray(entry)) { entry.forEach((item) => visit(item, depth + 1)); return; }
    if (typeof entry !== "object") fail(path, "must contain JSON values.");
    Object.values(entry as WireRecord).forEach((item) => visit(item, depth + 1));
  };
  visit(value, 0);
}
function fail(path: string, message: string): never { throw new AnthropicMessagesProtocolError(path, message); }

export interface AnthropicMessagesSseEvent { readonly event: string; readonly data: Record<string, unknown> }
export function encodeAnthropicMessagesSseEvent(value: AnthropicMessagesSseEvent): string {
  return `event: ${value.event}\ndata: ${JSON.stringify(value.data)}\n\n`;
}
