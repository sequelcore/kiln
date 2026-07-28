import { KilnError } from "../engine/errors.js";
import type { ToolCall } from "./index.js";

const INVALID_TOOL_INPUT_MARKER = "__kilnInvalidToolInput";

/**
 * Prefix marking a tool call id as adapter-synthesized rather than provider-supplied.
 * Versioned so future synthesis strategies can be distinguished from this one.
 */
export const SYNTHETIC_TOOL_CALL_ID_PREFIX = "synth1:";

/** Builds a versioned synthetic tool call id from immutable, replay-stable coordinates. */
export function buildSyntheticToolCallId(...coordinates: readonly string[]): string {
  return `${SYNTHETIC_TOOL_CALL_ID_PREFIX}${coordinates.join(":")}`;
}

export interface InvalidToolInputDetails {
  readonly reason: string;
  readonly raw: unknown;
}

type ToolInputRecord = Record<string, unknown>;

const TOOL_INPUT_ALIASES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  read: {
    filePath: ["path", "filepath"],
  },
  write: {
    filePath: ["path", "filepath"],
    content: ["text", "contents", "value"],
  },
  edit: {
    filePath: ["path", "filepath"],
    oldString: ["oldText", "old_text", "old"],
    newString: ["newText", "new_text", "new"],
    replaceAll: ["replace_all"],
  },
};

function isPlainObject(value: unknown): value is ToolInputRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildInvalidToolInput(reason: string, raw: unknown): ToolInputRecord {
  return {
    [INVALID_TOOL_INPUT_MARKER]: {
      reason,
      raw,
    } satisfies InvalidToolInputDetails,
  };
}

function normalizeBuiltinToolInput(toolName: string, input: ToolInputRecord): ToolInputRecord {
  const aliasMap = TOOL_INPUT_ALIASES[toolName];
  if (!aliasMap) {
    return input;
  }

  const normalized: ToolInputRecord = { ...input };
  for (const [canonicalKey, aliases] of Object.entries(aliasMap)) {
    if (normalized[canonicalKey] !== undefined) {
      continue;
    }
    for (const alias of aliases) {
      if (normalized[alias] !== undefined) {
        normalized[canonicalKey] = normalized[alias];
        delete normalized[alias];
        break;
      }
    }
  }
  return normalized;
}

export function normalizeToolInput(
  toolName: string,
  rawInput: unknown,
  inputSchema?: Record<string, unknown>,
): ToolInputRecord {
  if (typeof rawInput === "string") {
    try {
      const parsed = JSON.parse(rawInput) as unknown;
      if (!isPlainObject(parsed)) {
        return buildInvalidToolInput("Tool arguments must decode to an object.", rawInput);
      }
      return normalizeBuiltinToolInput(toolName, restoreOptionalStrictFields(parsed, inputSchema));
    } catch {
      return buildInvalidToolInput("Failed to parse tool arguments as JSON.", rawInput);
    }
  }

  if (!isPlainObject(rawInput)) {
    return buildInvalidToolInput("Tool arguments must be an object.", rawInput);
  }

  return normalizeBuiltinToolInput(toolName, restoreOptionalStrictFields(rawInput, inputSchema));
}

function restoreOptionalStrictFields(
  input: ToolInputRecord,
  schema: Record<string, unknown> | undefined,
): ToolInputRecord {
  if (schema?.type !== "object") return input;
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : [],
  );
  const restored: ToolInputRecord = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null && !required.has(key)) continue;
    const propertySchema = isPlainObject(properties[key]) ? properties[key] : undefined;
    restored[key] = restoreNestedOptionalStrictFields(value, propertySchema);
  }
  return restored;
}

function restoreNestedOptionalStrictFields(
  value: unknown,
  schema: Record<string, unknown> | undefined,
): unknown {
  if (isPlainObject(value)) {
    return restoreOptionalStrictFields(value, selectSchemaBranch(schema, value));
  }
  if (Array.isArray(value)) {
    const itemSchema = isPlainObject(schema?.items) ? schema.items : undefined;
    return value.map((entry) => restoreNestedOptionalStrictFields(entry, itemSchema));
  }
  return value;
}

function selectSchemaBranch(
  schema: Record<string, unknown> | undefined,
  value: unknown,
): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  if (schema.type === "object" || schema.type === "array") return schema;
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    const matching = branches.find((branch) => (
      isPlainObject(branch)
      && ((isPlainObject(value) && branch.type === "object") || (Array.isArray(value) && branch.type === "array"))
    ));
    if (isPlainObject(matching)) return matching;
  }
  return schema;
}

export function getInvalidToolInputDetails(
  input: Record<string, unknown>,
): InvalidToolInputDetails | undefined {
  const marker = input[INVALID_TOOL_INPUT_MARKER];
  if (!isPlainObject(marker)) {
    return undefined;
  }

  const reason = marker.reason;
  if (typeof reason !== "string" || reason.length === 0) {
    return undefined;
  }

  return {
    reason,
    raw: marker.raw,
  };
}

/**
 * Enforces the core tool-call identity invariant: every id in `toolCalls` is trimmed,
 * non-empty, and unique within this collection (a single normalized response/stream flush).
 *
 * This is the single point where the invariant is enforced -- adapters own deriving a
 * candidate id from stable provider coordinates; this function owns validating the result.
 * Throws a KilnError (fail-closed) rather than silently repairing blank or duplicate ids.
 */
export function assertValidToolCallIds(
  toolCalls: readonly ToolCall[],
  context: { readonly adapter: string },
): void {
  const seenAtIndex = new Map<string, number>();
  for (const [index, toolCall] of toolCalls.entries()) {
    const trimmedId = toolCall.id.trim();
    if (trimmedId.length === 0) {
      throw new KilnError(
        "TOOL_CALL_IDENTITY_INVALID",
        `${context.adapter} produced a blank tool call id at index ${index}.`,
        {
          context: { adapter: context.adapter, index, id: toolCall.id },
        },
      );
    }
    if (trimmedId !== toolCall.id) {
      throw new KilnError(
        "TOOL_CALL_IDENTITY_INVALID",
        `${context.adapter} produced an untrimmed tool call id at index ${index}.`,
        {
          context: { adapter: context.adapter, index, id: toolCall.id },
        },
      );
    }

    const priorIndex = seenAtIndex.get(trimmedId);
    if (priorIndex !== undefined) {
      throw new KilnError(
        "TOOL_CALL_IDENTITY_INVALID",
        `${context.adapter} produced duplicate tool call id "${trimmedId}" at indexes ${priorIndex} and ${index}.`,
        {
          context: { adapter: context.adapter, index, priorIndex, id: trimmedId },
        },
      );
    }
    seenAtIndex.set(trimmedId, index);
  }
}

export function normalizeToolCall(toolCall: ToolCall): ToolCall {
  const normalizedInput = normalizeToolInput(toolCall.name, toolCall.input);
  if (normalizedInput === toolCall.input) {
    return toolCall;
  }

  return {
    ...toolCall,
    input: normalizedInput,
  };
}
