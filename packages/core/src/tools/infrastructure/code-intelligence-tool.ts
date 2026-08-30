import type {
  CodeIntelligenceAdapter,
  CodeIntelligenceOperation,
  CodeIntelligencePosition,
  CodeIntelligenceRequest,
  CodeIntelligenceResult,
} from "../domain/code-intelligence.js";
import {
  codeToolMetadata,
  type CodeIntelligenceErrorCode,
  type ToolOutputVerbosity,
} from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { parseOutputVerbosity } from "./output-verbosity.js";
import {
  getSandboxContext,
  optionalNumber,
  optionalString,
  requireString,
  resolvePath,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
} from "./tool-helpers.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const POSITION_OPERATIONS = new Set<CodeIntelligenceOperation>([
  "definition",
  "references",
  "hover",
  "implementation",
  "call_hierarchy",
]);
const FILE_OPERATIONS = new Set<CodeIntelligenceOperation>([
  ...POSITION_OPERATIONS,
  "document_symbols",
  "diagnostics",
]);
const OPERATIONS: readonly CodeIntelligenceOperation[] = [
  "definition",
  "references",
  "hover",
  "document_symbols",
  "workspace_symbols",
  "diagnostics",
  "implementation",
  "call_hierarchy",
];

export interface CodeIntelligenceToolOptions {
  readonly adapter?: CodeIntelligenceAdapter;
  readonly defaultCwd?: string;
}

export class CodeIntelligenceTool implements DevTool {
  readonly name = "code_intelligence";
  readonly description = TOOL_SCHEMAS.code_intelligence.description;
  readonly inputSchema = TOOL_SCHEMAS.code_intelligence.inputSchema;

  private readonly adapter?: CodeIntelligenceAdapter;
  private readonly defaultCwd: string;

  constructor(options: CodeIntelligenceToolOptions = {}) {
    this.adapter = options.adapter;
    this.defaultCwd = options.defaultCwd ?? ".";
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const operationInput = requireString(input, "operation");
    if (!operationInput.ok) {
      return operationInput.result;
    }
    const operation = parseOperation(operationInput.value);
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) {
      return verbosityInput.result;
    }
    const workspaceRoot = getSandboxContext(sandbox)?.cwd ?? this.defaultCwd;
    const metadataBase = {
      operation: operation ?? "diagnostics",
      workspaceRoot,
      adapter: this.adapter?.name ?? "unconfigured",
      resultCount: 0,
      verbosity: verbosityInput.value,
    };

    if (!operation) {
      return error("Invalid input: \"operation\" is not supported", "invalid_input", metadataBase);
    }

    const pathInput = optionalString(input, "path");
    const path = pathInput ? resolvePath(pathInput, sandbox) : undefined;
    if (FILE_OPERATIONS.has(operation) && !path) {
      return error('Invalid input: "path" is required for this operation', "invalid_input", {
        ...metadataBase,
        operation,
      });
    }

    if (path) {
      const readError = validateReadPath(path, sandbox);
      if (readError) {
        return error(readError, "read_denied", {
          ...metadataBase,
          operation,
          path,
        });
      }
    }

    const position = parsePosition(input.input.position);
    if (!position.ok) {
      return error(position.message, "invalid_input", {
        ...metadataBase,
        operation,
        ...(path ? { path } : {}),
      });
    }
    if (POSITION_OPERATIONS.has(operation) && !position.value) {
      return error('Invalid input: "position" is required for this operation', "invalid_input", {
        ...metadataBase,
        operation,
        ...(path ? { path } : {}),
      });
    }

    const query = optionalString(input, "query");
    const symbol = optionalString(input, "symbol");
    if (operation === "workspace_symbols" && !query && !symbol) {
      return error('Invalid input: "query" or "symbol" is required for workspace_symbols', "invalid_input", {
        ...metadataBase,
        operation,
      });
    }

    if (!this.adapter) {
      return error("No code intelligence adapter is configured for this workspace.", "adapter_not_configured", {
        ...metadataBase,
        operation,
        ...(path ? { path } : {}),
      });
    }

    const limit = clampLimit(optionalNumber(input, "limit"));
    const request: CodeIntelligenceRequest = {
      operation,
      workspaceRoot,
      limit,
      ...(path ? { path } : {}),
      ...(position.value ? { position: position.value } : {}),
      ...(query ? { query } : {}),
      ...(symbol ? { symbol } : {}),
    };

    try {
      const adapterResult = await this.adapter.query(request);
      const result: CodeIntelligenceResult = {
        operation,
        ...(adapterResult.language ? { language: adapterResult.language } : {}),
        entries: adapterResult.entries.slice(0, limit),
      };
      return toSuccessResult(formatOutput(result, verbosityInput.value), codeToolMetadata("code_intelligence", {
        operation,
        ...(path ? { path } : {}),
        workspaceRoot,
        adapter: this.adapter.name,
        ...(result.language ? { language: result.language } : {}),
        resultCount: result.entries.length,
        verbosity: verbosityInput.value,
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return error(message, "adapter_error", {
        ...metadataBase,
        operation,
        ...(path ? { path } : {}),
      });
    }
  }
}

function parseOperation(value: string): CodeIntelligenceOperation | undefined {
  return OPERATIONS.includes(value as CodeIntelligenceOperation)
    ? value as CodeIntelligenceOperation
    : undefined;
}

function parsePosition(value: unknown): { ok: true; value?: CodeIntelligencePosition } | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: 'Invalid input: "position" must be an object' };
  }
  const candidate = value as { line?: unknown; character?: unknown };
  if (!isNonNegativeFinite(candidate.line) || !isNonNegativeFinite(candidate.character)) {
    return { ok: false, message: 'Invalid input: "position.line" and "position.character" must be non-negative numbers' };
  }
  return {
    ok: true,
    value: {
      line: Math.floor(candidate.line),
      character: Math.floor(candidate.character),
    },
  };
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function formatOutput(result: CodeIntelligenceResult, verbosity: ToolOutputVerbosity): string {
  if (verbosity === "structured") {
    return JSON.stringify(result, null, 2);
  }
  if (verbosity === "summary") {
    return `${result.entries.length} ${result.operation} result${result.entries.length === 1 ? "" : "s"}`;
  }
  return result.entries.map((entry) => {
    const location = entry.path && entry.range
      ? `${entry.path}:${entry.range.start.line}:${entry.range.start.character}`
      : entry.path ?? entry.kind;
    const label = entry.symbol ?? entry.detail ?? entry.kind;
    return `${location} - ${label}`;
  }).join("\n");
}

function error(
  message: string,
  errorCode: CodeIntelligenceErrorCode,
  metadata: Parameters<typeof codeToolMetadata<"code_intelligence">>[1],
): ToolResult {
  return toErrorResult(message, codeToolMetadata("code_intelligence", {
    ...metadata,
    errorCode,
  }));
}
