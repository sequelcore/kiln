import type { ToolCall } from "./index.js";

const INVALID_TOOL_INPUT_MARKER = "__kilnInvalidToolInput";

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
