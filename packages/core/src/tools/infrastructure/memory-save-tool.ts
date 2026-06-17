import {
  defineMemoryScope,
  isMemoryLayerKind,
  MEMORY_PROVENANCE_SOURCE_TYPES,
  type MemoryLayerKind,
  type MemoryProvenance,
  type MemoryProvenanceSourceType,
} from "../../memory/domain/index.js";
import { MemoryMutationService } from "../../memory/service.js";
import type { MemoryRepository } from "../../memory/repository.js";
import { memoryToolMetadata } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { optionalNumber, optionalString, requireString, toErrorResult, toSuccessResult } from "./tool-helpers.js";

export interface MemorySaveToolCallerContext {
  readonly sessionId?: string;
  readonly tenantId?: string;
  readonly actorId?: string;
  readonly actorType?: string;
  readonly authority?: unknown;
}

type MemoryMutationServiceResolver = (
  context: MemorySaveToolCallerContext,
) => MemoryMutationService | undefined;

export interface MemorySaveToolOptions {
  readonly service?: MemoryMutationServiceResolver;
  readonly repository?: MemoryRepository;
  readonly callerContext?: MemorySaveToolCallerContext;
}

export class MemorySaveTool implements DevTool {
  readonly name = "memory_save";
  readonly description = TOOL_SCHEMAS.memory_save.description;
  readonly inputSchema = TOOL_SCHEMAS.memory_save.inputSchema;

  constructor(private readonly options: MemorySaveToolOptions = {}) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const callerContext = this.options.callerContext ?? {};
    const service = this.options.service?.(callerContext) ?? (
      this.options.repository ? new MemoryMutationService({ repository: this.options.repository }) : undefined
    );
    if (!service) {
      return toErrorResult("No MemoryMutationService is configured for this tool surface.", memoryToolMetadata("memory_save", {
        operation: "save",
        errorCode: "service_unavailable",
      }));
    }

    const parsed = parseMemorySaveInput(input);
    if (!parsed.ok) {
      return parsed.result;
    }

    try {
      const record = service.saveRecord(parsed.input);
      const output = {
        id: record.id,
        layer: record.layer,
        scope: record.scope,
        resourceUri: `kiln://memory/nodes/${record.id}`,
      };
      return toSuccessResult(JSON.stringify(output, null, 2), memoryToolMetadata("memory_save", {
        operation: "save",
        recordId: record.id,
        scopeKind: record.scope.kind,
        scopeId: record.scope.id,
        layer: record.layer,
        resourceUri: output.resourceUri,
      }));
    } catch (error) {
      const failure = classifyMemorySaveFailure(error);
      return toErrorResult(failure.message, memoryToolMetadata("memory_save", {
        operation: "save",
        errorCode: failure.errorCode,
        scopeKind: parsed.input.scope.kind,
        scopeId: parsed.input.scope.id,
        layer: parsed.input.layer,
      }));
    }
  }
}

function classifyMemorySaveFailure(error: unknown): {
  readonly message: string;
  readonly errorCode: "repository_error";
} {
  if (isMemoryAuthorizationDenied(error)) {
    return {
      message: "Memory save denied by authority policy.",
      errorCode: "repository_error",
    };
  }
  return {
    message: error instanceof Error ? error.message : "Memory save failed",
    errorCode: "repository_error",
  };
}

function isMemoryAuthorizationDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as Record<string, unknown>;
  const code = typeof record["code"] === "string" ? record["code"].toLowerCase() : "";
  const name = typeof record["name"] === "string" ? record["name"].toLowerCase() : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  return code.includes("denied")
    || code.includes("forbidden")
    || code.includes("unauthorized")
    || name.includes("denied")
    || name.includes("forbidden")
    || name.includes("unauthorized")
    || message.includes("denied")
    || message.includes("forbidden")
    || message.includes("unauthorized");
}

function parseMemorySaveInput(input: ToolInput): {
  readonly ok: true;
  readonly input: Parameters<MemoryMutationService["saveRecord"]>[0];
} | {
  readonly ok: false;
  readonly result: ToolResult;
} {
  const layer = requireString(input, "layer");
  if (!layer.ok) return layer;
  if (!isMemoryLayerKind(layer.value)) {
    return invalidInput(`Unsupported memory layer: ${layer.value}`);
  }

  const scopeKind = requireString(input, "scopeKind");
  if (!scopeKind.ok) return scopeKind;
  const scopeId = requireString(input, "scopeId");
  if (!scopeId.ok) return scopeId;
  const content = requireString(input, "content");
  if (!content.ok) return content;
  const scope = safeDefineScope(scopeKind.value, scopeId.value);
  if (!scope.ok) return scope;

  const provenance = parseProvenance(input);
  if (!provenance.ok) return provenance;

  const tags = parseTags(input);
  if (!tags.ok) return tags;

  const confidence = optionalNumber(input, "confidence");
  if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
    return invalidInput("Memory confidence must be between 0 and 1");
  }

  const id = optionalString(input, "id");
  const topicKey = optionalString(input, "topicKey");

  return {
    ok: true,
    input: {
      ...(id ? { id } : {}),
      layer: layer.value as MemoryLayerKind,
      scope: scope.value,
      content: content.value,
      ...(topicKey ? { topicKey } : {}),
      ...(tags.value.length > 0 ? { tags: tags.value } : {}),
      provenance: provenance.value,
      ...(confidence !== undefined ? { confidence } : {}),
    },
  };
}

function safeDefineScope(kind: string, id: string): {
  readonly ok: true;
  readonly value: ReturnType<typeof defineMemoryScope>;
} | {
  readonly ok: false;
  readonly result: ToolResult;
} {
  try {
    return { ok: true, value: defineMemoryScope({ kind, id }) };
  } catch (error) {
    return invalidInput(error instanceof Error ? error.message : "Invalid memory scope");
  }
}

function parseProvenance(input: ToolInput): {
  readonly ok: true;
  readonly value: MemoryProvenance;
} | {
  readonly ok: false;
  readonly result: ToolResult;
} {
  const value = input.input["provenance"];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidInput("Invalid input: \"provenance\" must be an object");
  }

  const provenance = value as Record<string, unknown>;
  const sourceType = provenance["sourceType"];
  if (typeof sourceType !== "string" || !(MEMORY_PROVENANCE_SOURCE_TYPES as readonly string[]).includes(sourceType)) {
    return invalidInput("Invalid input: \"provenance.sourceType\" is unsupported");
  }
  const sourceId = provenance["sourceId"];
  if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
    return invalidInput("Invalid input: \"provenance.sourceId\" must be a non-empty string");
  }

  return {
    ok: true,
    value: {
      sourceType: sourceType as MemoryProvenanceSourceType,
      sourceId,
      ...optionalStringProperty(provenance, "sessionId"),
      ...optionalStringProperty(provenance, "turnId"),
      ...optionalStringProperty(provenance, "toolCallId"),
      ...optionalStringProperty(provenance, "actor"),
      capturedAt: stringProperty(provenance, "capturedAt") ?? new Date().toISOString(),
    },
  };
}

function parseTags(input: ToolInput): {
  readonly ok: true;
  readonly value: readonly string[];
} | {
  readonly ok: false;
  readonly result: ToolResult;
} {
  const value = input.input["tags"];
  if (value === undefined) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    return invalidInput("Invalid input: \"tags\" must be an array of strings");
  }
  return { ok: true, value: value as string[] };
}

function optionalStringProperty(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = stringProperty(record, key);
  return value ? { [key]: value } : {};
}

function stringProperty(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function invalidInput(message: string): {
  readonly ok: false;
  readonly result: ToolResult;
} {
  return {
    ok: false,
    result: toErrorResult(message, memoryToolMetadata("memory_save", {
      operation: "save",
      errorCode: "invalid_input",
    })),
  };
}
