import type { ReasoningEffort } from "../phase-aware-route-policy.js";
import type { AccountRef, ModelGatewayRoute } from "./index.js";

export type ModelJsonValue = string | number | boolean | null | ModelJsonObject | readonly ModelJsonValue[];
export interface ModelJsonObject { readonly [key: string]: ModelJsonValue }

export interface FunctionModelTool {
  readonly kind: "function";
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: ModelJsonObject;
  readonly outputSchema?: ModelJsonObject;
  readonly strict?: boolean;
}

export interface CustomModelTool {
  readonly kind: "custom";
  readonly name: string;
  readonly description?: string;
  readonly grammar: { readonly syntax: "lark"; readonly source: string };
}

export type ModelTool = FunctionModelTool | CustomModelTool;

export interface FunctionModelToolCall {
  readonly kind: "function";
  readonly id: string;
  readonly name: string;
  readonly input: { readonly kind: "json-object"; readonly value: ModelJsonObject };
}

export interface CustomModelToolCall {
  readonly kind: "custom";
  readonly id: string;
  readonly name: string;
  readonly input: { readonly kind: "raw-text"; readonly value: string };
}

export type ModelToolCall = FunctionModelToolCall | CustomModelToolCall;

export interface ModelTextPart { readonly type: "text"; readonly text: string }
export interface ModelReasoningSummaryPart { readonly type: "reasoning-summary"; readonly text: string }
export interface ModelImagePart {
  readonly type: "image";
  readonly source:
    | { readonly kind: "url"; readonly url: string }
    | { readonly kind: "base64"; readonly mediaType: string; readonly data: string };
}
export interface ModelToolCallPart { readonly type: "tool-call"; readonly call: ModelToolCall }
export type ModelToolResultContent = ModelTextPart | ModelImagePart;
export interface ModelToolResultPart {
  readonly type: "tool-result";
  readonly callId: string;
  readonly content: readonly ModelToolResultContent[];
  readonly isError?: boolean;
}
export type ModelPart = ModelTextPart | ModelReasoningSummaryPart | ModelImagePart | ModelToolCallPart | ModelToolResultPart;

export interface ModelTurnMessage {
  readonly role: "developer" | "user" | "assistant";
  readonly parts: readonly ModelPart[];
}

export type ModelToolChoice =
  | { readonly kind: "auto" }
  | { readonly kind: "none" }
  | { readonly kind: "required" }
  | { readonly kind: "tool"; readonly name: string };

export interface ModelTurn {
  readonly instructions?: string;
  readonly history: readonly ModelTurnMessage[];
  readonly tools?: readonly ModelTool[];
  readonly toolChoice?: ModelToolChoice;
  readonly parallelToolCalls?: boolean;
  readonly responseFormat?: {
    readonly kind: "json-schema";
    readonly name: string;
    readonly schema: ModelJsonObject;
    readonly strict?: boolean;
  };
  readonly reasoning?: { readonly effort?: ReasoningEffort; readonly summary?: "auto" | "concise" | "detailed" };
  readonly maxOutputTokens?: number;
}

export interface ModelTurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface ModelTurnResult {
  readonly parts: readonly ModelPart[];
  readonly usage: ModelTurnUsage;
  readonly stopReason: string;
}

/** Secret-free, protocol-neutral request for exactly one model-provider round. */
export interface ModelGatewayOneRoundDispatchInput {
  readonly account: AccountRef;
  readonly route: ModelGatewayRoute;
  readonly sessionId: string;
  readonly turn: ModelTurn;
  readonly signal?: AbortSignal;
}

/** Adapter boundary for one provider round. Implementations must not retry. */
export interface ModelGatewayOneRoundDispatcher {
  dispatchOneRound(input: ModelGatewayOneRoundDispatchInput): Promise<ModelTurnResult>;
}

/** Validates before and after the sole dispatcher call. */
export async function dispatchModelGatewayOneRound(
  dispatcher: ModelGatewayOneRoundDispatcher,
  input: ModelGatewayOneRoundDispatchInput,
): Promise<ModelTurnResult> {
  requireIdentifier(input.sessionId, "sessionId");
  validateModelTurn(input.turn);
  const result = await dispatcher.dispatchOneRound(input);
  validateModelTurnResultAgainstTools(result, input.turn.tools ?? []);
  return result;
}

export function validateModelTurn(turn: ModelTurn): void {
  if (!isObject(turn)) throw new TypeError("Model turn must be an object.");
  if (!Array.isArray(turn.history)) throw new TypeError("Model turn history must be an array.");
  const tools = turn.tools ?? [];
  if (!Array.isArray(tools)) throw new TypeError("Model turn tools must be an array.");
  const toolNames = new Set<string>();
  const toolKinds = new Map<string, ModelTool["kind"]>();
  for (const [index, tool] of tools.entries()) {
    validateTool(tool, `tools[${index}]`);
    if (toolNames.has(tool.name)) throw new TypeError("Model tool names must be unique.");
    toolNames.add(tool.name);
    toolKinds.set(tool.name, tool.kind);
  }
  if (turn.toolChoice !== undefined) {
    if (!isObject(turn.toolChoice) || !["auto", "none", "required", "tool"].includes(turn.toolChoice.kind as string)) {
      throw new TypeError("toolChoice is invalid.");
    }
    if (turn.toolChoice.kind === "tool") {
      requireIdentifier(turn.toolChoice.name, "toolChoice.name");
      if (!toolNames.has(turn.toolChoice.name)) throw new TypeError("Selected model tool must exist in tools.");
    }
  }
  if (turn.instructions !== undefined && typeof turn.instructions !== "string") throw new TypeError("instructions must be a string.");
  if (turn.parallelToolCalls !== undefined && typeof turn.parallelToolCalls !== "boolean") {
    throw new TypeError("parallelToolCalls must be a boolean.");
  }
  if (turn.responseFormat !== undefined) {
    if (!isObject(turn.responseFormat) || turn.responseFormat.kind !== "json-schema") throw new TypeError("responseFormat is invalid.");
    requireIdentifier(turn.responseFormat.name, "responseFormat.name");
    validateJsonObject(turn.responseFormat.schema, "responseFormat.schema");
    if (turn.responseFormat.strict !== undefined && typeof turn.responseFormat.strict !== "boolean") {
      throw new TypeError("responseFormat.strict must be a boolean.");
    }
  }
  validateReasoning(turn.reasoning);
  if (turn.maxOutputTokens !== undefined && (!Number.isSafeInteger(turn.maxOutputTokens) || turn.maxOutputTokens <= 0)) {
    throw new TypeError("maxOutputTokens must be a positive integer.");
  }

  const calls = new Map<string, ModelToolCall["kind"]>();
  const results = new Set<string>();
  for (const [messageIndex, message] of turn.history.entries()) {
    if (!isObject(message) || !["developer", "user", "assistant"].includes(message.role as string)) {
      throw new TypeError(`history[${messageIndex}].role is invalid.`);
    }
    if (!Array.isArray(message.parts)) throw new TypeError(`history[${messageIndex}].parts must be an array.`);
    for (const [partIndex, part] of message.parts.entries()) {
      const path = `history[${messageIndex}].parts[${partIndex}]`;
      if (isToolResultPart(part)) {
        if (message.role !== "user") throw new TypeError(`${path} tool-result is user-only.`);
        validateToolResult(part, path, calls, results);
      } else {
        validateOutputPart(part, path, calls, toolKinds, message.role as ModelTurnMessage["role"], false);
      }
    }
  }
}

export function validateModelTurnResult(result: ModelTurnResult): void {
  validateModelTurnResultWithToolKinds(result, new Map(), false);
}

function validateModelTurnResultAgainstTools(result: ModelTurnResult, tools: readonly ModelTool[]): void {
  validateModelTurnResultWithToolKinds(result, new Map(tools.map((tool) => [tool.name, tool.kind])), true);
}

function validateModelTurnResultWithToolKinds(
  result: ModelTurnResult,
  toolKinds: ReadonlyMap<string, ModelTool["kind"]>,
  requireDeclaredTools: boolean,
): void {
  if (!isObject(result)) throw new TypeError("Model turn result must be an object.");
  if (!Array.isArray(result.parts)) throw new TypeError("Model turn result parts must be an array.");
  const partCalls = new Map<string, ModelToolCall["kind"]>();
  for (const [index, part] of result.parts.entries()) {
    if (isToolResultPart(part)) throw new TypeError("Model turn result cannot contain tool-result parts.");
    validateOutputPart(part, `parts[${index}]`, partCalls, toolKinds, "assistant", requireDeclaredTools);
  }
  if (!isObject(result.usage)) throw new TypeError("Model turn result usage must be an object.");
  const usageKeys = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const;
  for (const name of usageKeys) {
    const value = result.usage[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`usage.${name} must be a non-negative finite number.`);
    }
  }
  if (Object.keys(result.usage).some((key) => !usageKeys.includes(key as typeof usageKeys[number]))) {
    throw new TypeError("Model turn result usage contains unsupported keys.");
  }
  requireIdentifier(result.stopReason, "stopReason");
}

function validateTool(tool: ModelTool, path: string): void {
  if (!isObject(tool) || (tool.kind !== "function" && tool.kind !== "custom")) throw new TypeError(`${path}.kind is invalid.`);
  requireIdentifier(tool.name, `${path}.name`);
  if (tool.description !== undefined && typeof tool.description !== "string") throw new TypeError(`${path}.description must be a string.`);
  if (tool.kind === "function") {
    validateJsonObject(tool.inputSchema, `${path}.inputSchema`);
    if (tool.outputSchema !== undefined) validateJsonObject(tool.outputSchema, `${path}.outputSchema`);
    if (tool.strict !== undefined && typeof tool.strict !== "boolean") throw new TypeError(`${path}.strict must be a boolean.`);
  } else {
    if (!isObject(tool.grammar) || tool.grammar.syntax !== "lark" || typeof tool.grammar.source !== "string" || tool.grammar.source.length === 0) {
      throw new TypeError(`${path}.grammar must contain non-empty lark source.`);
    }
  }
}

function validateOutputPart(
  part: ModelPart,
  path: string,
  calls: Map<string, ModelToolCall["kind"]>,
  toolKinds: ReadonlyMap<string, ModelTool["kind"]>,
  role: ModelTurnMessage["role"],
  requireDeclaredTool: boolean,
): void {
  if (!isObject(part)) throw new TypeError(`${path} must be an object.`);
  if (part.type === "text") {
    if (typeof part.text !== "string") throw new TypeError(`${path}.text must be a string.`);
  } else if (part.type === "reasoning-summary") {
    if (role !== "assistant") throw new TypeError(`${path} reasoning-summary is assistant-only.`);
    if (typeof part.text !== "string" || part.text.trim().length === 0) throw new TypeError(`${path}.text must be non-empty.`);
  } else if (part.type === "image") {
    validateImage(part, path);
  } else if (part.type === "tool-call") {
    if (role !== "assistant") throw new TypeError(`${path} tool-call is assistant-only.`);
    validateToolCall(part.call, `${path}.call`);
    if (calls.has(part.call.id)) throw new TypeError("Model tool call ids must be unique.");
    const declaredKind = toolKinds.get(part.call.name);
    if (requireDeclaredTool && declaredKind === undefined) throw new TypeError(`${path}.call must name a declared model tool.`);
    if (declaredKind !== undefined && declaredKind !== part.call.kind) throw new TypeError(`${path}.call kind does not match its tool.`);
    calls.set(part.call.id, part.call.kind);
  } else {
    throw new TypeError(`${path}.type is invalid.`);
  }
}

function validateToolCall(call: ModelToolCall, path: string): void {
  if (!isObject(call) || (call.kind !== "function" && call.kind !== "custom")) throw new TypeError(`${path}.kind is invalid.`);
  requireIdentifier(call.id, `${path}.id`);
  requireIdentifier(call.name, `${path}.name`);
  if (!isObject(call.input)) throw new TypeError(`${path}.input is invalid.`);
  if (call.kind === "function") {
    if (call.input.kind !== "json-object") throw new TypeError(`${path}.input kind must be json-object.`);
    validateJsonObject(call.input.value, `${path}.input.value`);
  } else {
    if (call.input.kind !== "raw-text" || typeof call.input.value !== "string") {
      throw new TypeError(`${path}.input must be raw text.`);
    }
  }
}

function validateToolResult(
  part: ModelToolResultPart,
  path: string,
  calls: ReadonlyMap<string, ModelToolCall["kind"]>,
  results: Set<string>,
): void {
  requireIdentifier(part.callId, `${path}.callId`);
  const callKind = calls.get(part.callId);
  if (callKind === undefined) throw new TypeError(`${path} must reference a prior tool call.`);
  if (results.has(part.callId)) throw new TypeError(`${path} duplicates a prior tool result.`);
  if (!Array.isArray(part.content)) throw new TypeError(`${path}.content must be an array.`);
  if (part.isError !== undefined && typeof part.isError !== "boolean") throw new TypeError(`${path}.isError must be a boolean.`);
  for (const [index, content] of part.content.entries()) {
    if (!isObject(content) || (content.type !== "text" && content.type !== "image")) {
      throw new TypeError(`${path}.content[${index}] contains a nested or unsupported tool result.`);
    }
    if (content.type === "text") {
      if (typeof content.text !== "string") throw new TypeError(`${path}.content[${index}].text must be a string.`);
    } else {
      validateImage(content as unknown as ModelImagePart, `${path}.content[${index}]`);
    }
  }
  results.add(part.callId);
}

function validateImage(part: ModelImagePart, path: string): void {
  if (!isObject(part.source)) throw new TypeError(`${path}.source is invalid.`);
  if (part.source.kind === "url") {
    if (typeof part.source.url !== "string" || part.source.url.length === 0) throw new TypeError(`${path}.source.url must be non-empty.`);
  } else if (part.source.kind === "base64") {
    requireIdentifier(part.source.mediaType, `${path}.source.mediaType`);
    if (typeof part.source.data !== "string" || part.source.data.length === 0) throw new TypeError(`${path}.source.data must be non-empty.`);
  } else {
    throw new TypeError(`${path}.source.kind is invalid.`);
  }
}

function validateJsonObject(value: unknown, path: string): asserts value is ModelJsonObject {
  if (!isObject(value) || Array.isArray(value)) throw new TypeError(`${path} must be a JSON object.`);
  validateJson(value, path, new Set<object>());
}

function validateReasoning(reasoning: ModelTurn["reasoning"]): void {
  if (reasoning === undefined) return;
  if (!isObject(reasoning)) throw new TypeError("reasoning must be an object.");
  if (reasoning.effort !== undefined && !["minimal", "low", "medium", "high", "xhigh"].includes(reasoning.effort as string)) {
    throw new TypeError("reasoning.effort is invalid.");
  }
  if (reasoning.summary !== undefined && !["auto", "concise", "detailed"].includes(reasoning.summary as string)) {
    throw new TypeError("reasoning.summary is invalid.");
  }
}

function validateJson(value: unknown, path: string, ancestors: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} numbers must be finite.`);
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${path} must contain JSON values only.`);
  if (ancestors.has(value)) throw new TypeError(`${path} must not contain circular values.`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJson(entry, `${path}[${index}]`, ancestors));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must contain plain JSON objects.`);
    Object.entries(value).forEach(([key, entry]) => validateJson(entry, `${path}.${key}`, ancestors));
  }
  ancestors.delete(value);
}

function requireIdentifier(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value !== value.trim()) {
    throw new TypeError(`${path} must be a non-empty canonical identifier of at most 256 characters.`);
  }
}

function isToolResultPart(value: unknown): value is ModelToolResultPart {
  return isObject(value) && value.type === "tool-result";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
