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

export function normalizeToolInput(toolName: string, rawInput: unknown): ToolInputRecord {
  if (typeof rawInput === "string") {
    try {
      const parsed = JSON.parse(rawInput) as unknown;
      if (!isPlainObject(parsed)) {
        return buildInvalidToolInput("Tool arguments must decode to an object.", rawInput);
      }
      return normalizeBuiltinToolInput(toolName, parsed);
    } catch {
      return buildInvalidToolInput("Failed to parse tool arguments as JSON.", rawInput);
    }
  }

  if (!isPlainObject(rawInput)) {
    return buildInvalidToolInput("Tool arguments must be an object.", rawInput);
  }

  return normalizeBuiltinToolInput(toolName, rawInput);
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
