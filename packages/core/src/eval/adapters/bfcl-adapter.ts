import { KilnError } from "../../engine/errors.js";
import type { Dataset, DatasetItem } from "../types.js";

export interface BfclFunctionCall {
  readonly name: string;
  readonly args?: Record<string, unknown>;
}

export interface BfclAdapterOptions {
  readonly datasetName: string;
  readonly content: string;
  readonly profileId?: string;
}

export interface BfclProjectionResult {
  readonly dataset: Dataset;
  readonly unsupportedRows: readonly BfclUnsupportedRow[];
}

export interface BfclUnsupportedRow {
  readonly index: number;
  readonly id?: string;
  readonly reason: string;
}

export function projectBfclDataset(options: BfclAdapterOptions): BfclProjectionResult {
  const rows = parseRows(options.content, options.datasetName);
  const items: DatasetItem[] = [];
  const unsupportedRows: BfclUnsupportedRow[] = [];

  rows.forEach((row, index) => {
    const id = readString(row, "id") ?? `${options.datasetName}-${index + 1}`;
    const question = readString(row, "question") ?? readString(row, "questions") ?? readString(row, "prompt");
    if (!question) {
      unsupportedRows.push({ index, id, reason: "missing question/questions/prompt" });
      return;
    }
    const tools = readToolDocuments(row);
    const expectedToolCalls = readExpectedToolCalls(row);
    if (expectedToolCalls.length === 0) {
      unsupportedRows.push({ index, id, reason: "missing supported ground_truth/answer tool calls" });
      return;
    }

    items.push({
      id,
      input: renderBfclInput(question, tools),
      expected: JSON.stringify(expectedToolCalls),
      metadata: {
        benchmark: "bfcl",
        sourceRowId: id,
        expectedAgentId: options.profileId ?? "kiln-tool-agent",
        expectedToolCalls,
        bfcl: {
          toolDocumentCount: tools.length,
        },
      },
    });
  });

  return {
    dataset: {
      name: options.datasetName,
      items,
    },
    unsupportedRows,
  };
}

function parseRows(content: string, datasetName: string): readonly Record<string, unknown>[] {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new KilnError("EVAL_DATASET_NOT_FOUND", `BFCL dataset "${datasetName}" is empty`, {
      context: { datasetName },
    });
  }
  const parsed = tryParseJson(trimmed);
  if (Array.isArray(parsed)) {
    return parsed.map((entry, index) => requireRecord(entry, datasetName, index));
  }
  if (parsed && typeof parsed === "object") {
    const records = (parsed as Record<string, unknown>).data ?? (parsed as Record<string, unknown>).rows;
    if (Array.isArray(records)) {
      return records.map((entry, index) => requireRecord(entry, datasetName, index));
    }
  }

  return trimmed
    .split("\n")
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith("#"))
    .map((line, index) => requireRecord(parseJson(line, datasetName, index), datasetName, index));
}

function readToolDocuments(row: Record<string, unknown>): readonly unknown[] {
  const raw = row.function ?? row.functions ?? row.tools;
  const parsed = typeof raw === "string" ? tryParseJson(raw) : raw;
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return [parsed];
  return [];
}

function readExpectedToolCalls(row: Record<string, unknown>): readonly BfclFunctionCall[] {
  const raw = row.ground_truth ?? row.answer ?? row.expectedToolCalls;
  const parsed = typeof raw === "string" ? tryParseJson(raw) : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap(readExpectedToolCall);
}

function readExpectedToolCall(value: unknown): readonly BfclFunctionCall[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const functionRecord = record.function && typeof record.function === "object"
    ? record.function as Record<string, unknown>
    : undefined;
  const name = readString(record, "name")
    ?? readString(record, "tool_name")
    ?? readString(functionRecord, "name");
  if (!name) return [];
  const args = record.arguments ?? record.args ?? functionRecord?.arguments;
  return [{
    name,
    ...(args && typeof args === "object" && !Array.isArray(args) ? { args: args as Record<string, unknown> } : {}),
  }];
}

function renderBfclInput(question: string, tools: readonly unknown[]): string {
  return [
    "Answer by using the available tools when a tool call is required.",
    "",
    "User question:",
    question,
    "",
    "Available tools:",
    JSON.stringify(tools, null, 2),
  ].join("\n");
}

function readString(record: Record<string, unknown> | undefined, field: string): string | undefined {
  const value = record?.[field];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJson(value: string, datasetName: string, index: number): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new KilnError("EVAL_DATASET_INVALID", `Invalid BFCL JSON row at ${index + 1} in "${datasetName}"`, {
      context: { datasetName, index },
    });
  }
}

function requireRecord(value: unknown, datasetName: string, index: number): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KilnError("EVAL_DATASET_INVALID", `BFCL row ${index + 1} in "${datasetName}" must be an object`, {
      context: { datasetName, index },
    });
  }
  return value as Record<string, unknown>;
}
