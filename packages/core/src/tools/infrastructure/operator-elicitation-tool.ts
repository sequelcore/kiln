import {
  elicitationToolMetadata,
  type ElicitationMode,
  type ElicitationOutcome,
  type ToolOutputVerbosity,
} from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { parseOutputVerbosity } from "./output-verbosity.js";
import { requireString, toErrorResult, toSuccessResult } from "./tool-helpers.js";

const OUTCOMES: readonly ElicitationOutcome[] = ["submitted", "declined", "cancelled", "unsupported"];
const SENSITIVE_KEY_PATTERN = /password|token|secret|api[_-]?key|credential|oauth|authorization|bearer/i;

export interface OperatorElicitationRequest {
  readonly mode: ElicitationMode;
  readonly message: string;
  readonly schema?: Record<string, unknown>;
  readonly url?: string;
  readonly sensitive: boolean;
}

export interface OperatorElicitationResponse {
  readonly outcome: ElicitationOutcome;
  readonly values?: Record<string, unknown>;
  readonly surface?: string;
}

export interface OperatorElicitationResponder {
  elicit(request: OperatorElicitationRequest): Promise<OperatorElicitationResponse>;
}

export interface OperatorElicitationToolOptions {
  readonly responder?: OperatorElicitationResponder;
}

interface OperatorElicitationSandbox {
  readonly operatorElicitation?: {
    readonly elicit?: OperatorElicitationResponder["elicit"];
  };
}

interface ParsedInput extends OperatorElicitationRequest {
  readonly verbosity: ToolOutputVerbosity;
  readonly schemaProvided: boolean;
}

export class OperatorElicitationTool implements DevTool {
  readonly name = "operator_elicit";
  readonly description = TOOL_SCHEMAS.operator_elicit.description;
  readonly inputSchema = TOOL_SCHEMAS.operator_elicit.inputSchema;
  readonly annotations = TOOL_SCHEMAS.operator_elicit.annotations;

  private readonly responder?: OperatorElicitationResponder;

  constructor(options: OperatorElicitationToolOptions = {}) {
    this.responder = options.responder;
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const parsed = parseInput(input);
    if (!parsed.ok) {
      return parsed.result;
    }

    const responder = this.responder ?? responderFromSandbox(sandbox);
    if (!responder) {
      return toErrorResult("Operator elicitation is not available on this surface", elicitationToolMetadata("operator_elicit", {
        operation: "elicit",
        mode: parsed.value.mode,
        outcome: "unsupported",
        schemaProvided: parsed.value.schemaProvided,
        sensitive: parsed.value.sensitive,
        ...(parsed.value.url ? { url: parsed.value.url } : {}),
        errorCode: "responder_not_configured",
        verbosity: parsed.value.verbosity,
      }));
    }

    try {
      const response = normalizeResponse(await responder.elicit(toResponderRequest(parsed.value)));
      const metadata = elicitationToolMetadata("operator_elicit", {
        operation: "elicit",
        mode: parsed.value.mode,
        outcome: response.outcome,
        schemaProvided: parsed.value.schemaProvided,
        sensitive: parsed.value.sensitive,
        ...(parsed.value.url ? { url: parsed.value.url } : {}),
        ...(response.surface ? { surface: response.surface } : {}),
        ...(response.values ? { valueKeys: Object.keys(response.values).sort() } : {}),
        verbosity: parsed.value.verbosity,
      });
      const output = formatResponse(response, parsed.value.verbosity);
      return response.outcome === "submitted"
        ? toSuccessResult(output, metadata)
        : toErrorResult(output, metadata);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toErrorResult(`Operator elicitation failed: ${message}`, elicitationToolMetadata("operator_elicit", {
        operation: "elicit",
        mode: parsed.value.mode,
        outcome: "unsupported",
        schemaProvided: parsed.value.schemaProvided,
        sensitive: parsed.value.sensitive,
        ...(parsed.value.url ? { url: parsed.value.url } : {}),
        errorCode: "responder_error",
        verbosity: parsed.value.verbosity,
      }));
    }
  }
}

function parseInput(input: ToolInput): { ok: true; value: ParsedInput } | { ok: false; result: ToolResult } {
  const modeInput = requireString(input, "mode");
  if (!modeInput.ok) return modeInput;
  const mode = parseMode(modeInput.value);
  if (!mode) {
    return {
      ok: false,
      result: error("Invalid input: \"mode\" must be \"form\" or \"url\"", undefined, undefined, false, "invalid_input"),
    };
  }

  const messageInput = requireString(input, "message");
  if (!messageInput.ok) return messageInput;
  const message = messageInput.value.trim();
  if (message.length === 0) {
    return {
      ok: false,
      result: error("Invalid input: \"message\" must be a non-empty string", mode, undefined, false, "invalid_input"),
    };
  }

  const verbosityInput = parseOutputVerbosity(input);
  if (!verbosityInput.ok) return verbosityInput;
  const sensitiveInput = parseSensitive(input);
  if (!sensitiveInput.ok) {
    return {
      ok: false,
      result: error(sensitiveInput.message, mode, undefined, false, "invalid_input", verbosityInput.value),
    };
  }
  const schemaInput = parseSchema(input);
  if (!schemaInput.ok) {
    return {
      ok: false,
      result: error(schemaInput.message, mode, undefined, sensitiveInput.value, "invalid_input", verbosityInput.value),
    };
  }

  const urlInput = parseUrl(input, mode, verbosityInput.value, sensitiveInput.value, schemaInput.value !== undefined);
  if (!urlInput.ok) return urlInput;

  if (mode === "form" && (sensitiveInput.value || schemaContainsSensitiveKeys(schemaInput.value))) {
    return {
      ok: false,
      result: error(
        "Sensitive operator input must use URL mode so values are never collected by the tool",
        mode,
        undefined,
        true,
        "sensitive_form_denied",
        verbosityInput.value,
        schemaInput.value !== undefined,
      ),
    };
  }

  return {
    ok: true,
    value: {
      mode,
      message,
      ...(schemaInput.value ? { schema: schemaInput.value } : {}),
      ...(urlInput.value ? { url: urlInput.value } : {}),
      sensitive: sensitiveInput.value,
      schemaProvided: schemaInput.value !== undefined,
      verbosity: verbosityInput.value,
    },
  };
}

function parseMode(value: string): ElicitationMode | undefined {
  if (value === "form" || value === "url") {
    return value;
  }
  return undefined;
}

function parseSensitive(input: ToolInput): { ok: true; value: boolean } | { ok: false; message: string } {
  const value = input.input["sensitive"];
  if (value === undefined) {
    return { ok: true, value: false };
  }
  if (typeof value !== "boolean") {
    return { ok: false, message: 'Invalid input: "sensitive" must be a boolean when provided' };
  }
  return { ok: true, value };
}

function parseSchema(input: ToolInput): { ok: true; value?: Record<string, unknown> } | { ok: false; message: string } {
  const value = input.input["schema"];
  if (value === undefined) {
    return { ok: true };
  }
  if (!isPlainRecord(value)) {
    return { ok: false, message: 'Invalid input: "schema" must be an object when provided' };
  }
  return { ok: true, value };
}

function parseUrl(
  input: ToolInput,
  mode: ElicitationMode,
  verbosity: ToolOutputVerbosity,
  sensitive: boolean,
  schemaProvided: boolean,
): { ok: true; value?: string } | { ok: false; result: ToolResult } {
  const value = input.input["url"];
  if (value === undefined) {
    if (mode === "url") {
      return {
        ok: false,
        result: error("Invalid input: URL mode requires an HTTPS url", mode, undefined, sensitive, "invalid_input", verbosity, schemaProvided),
      };
    }
    return { ok: true };
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      ok: false,
      result: error('Invalid input: "url" must be a non-empty string when provided', mode, undefined, sensitive, "invalid_input", verbosity, schemaProvided),
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return {
      ok: false,
      result: error("Invalid input: URL mode requires a valid HTTPS url", mode, undefined, sensitive, "invalid_input", verbosity, schemaProvided),
    };
  }
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      result: error("Invalid input: URL mode requires an HTTPS url", mode, parsed.toString(), sensitive, "invalid_input", verbosity, schemaProvided),
    };
  }
  return { ok: true, value: parsed.toString() };
}

function error(
  message: string,
  mode: ElicitationMode | undefined,
  url: string | undefined,
  sensitive: boolean,
  errorCode: "invalid_input" | "responder_not_configured" | "sensitive_form_denied" | "responder_error",
  verbosity?: ToolOutputVerbosity,
  schemaProvided?: boolean,
): ToolResult {
  return toErrorResult(message, elicitationToolMetadata("operator_elicit", {
    operation: "elicit",
    ...(mode ? { mode } : {}),
    outcome: "unsupported",
    ...(schemaProvided !== undefined ? { schemaProvided } : {}),
    sensitive,
    ...(url ? { url } : {}),
    errorCode,
    ...(verbosity ? { verbosity } : {}),
  }));
}

function responderFromSandbox(sandbox: unknown): OperatorElicitationResponder | undefined {
  if (!isPlainRecord(sandbox)) {
    return undefined;
  }
  const context = sandbox as OperatorElicitationSandbox;
  const elicit = context.operatorElicitation?.elicit;
  return typeof elicit === "function" ? { elicit } : undefined;
}

function toResponderRequest(input: ParsedInput): OperatorElicitationRequest {
  return {
    mode: input.mode,
    message: input.message,
    ...(input.schema ? { schema: input.schema } : {}),
    ...(input.url ? { url: input.url } : {}),
    sensitive: input.sensitive,
  };
}

function normalizeResponse(response: OperatorElicitationResponse): OperatorElicitationResponse {
  const outcome = OUTCOMES.includes(response.outcome) ? response.outcome : "unsupported";
  return {
    outcome,
    ...(isPlainRecord(response.values) ? { values: response.values } : {}),
    ...(typeof response.surface === "string" && response.surface.length > 0 ? { surface: response.surface } : {}),
  };
}

function formatResponse(response: OperatorElicitationResponse, verbosity: ToolOutputVerbosity): string {
  if (verbosity === "structured") {
    return JSON.stringify(response, null, 2);
  }
  if (verbosity === "summary") {
    return `operator elicitation ${response.outcome}`;
  }
  if (response.outcome === "submitted" && response.values) {
    return JSON.stringify(response);
  }
  return `operator elicitation ${response.outcome}`;
}

function schemaContainsSensitiveKeys(schema: Record<string, unknown> | undefined): boolean {
  if (!schema) {
    return false;
  }
  return containsSensitiveKey(schema, new Set());
}

function containsSensitiveKey(value: unknown, seen: Set<object>): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveKey(item, seen));
  }
  if (!isPlainRecord(value)) {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) || containsSensitiveKey(nestedValue, seen)) {
      return true;
    }
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
