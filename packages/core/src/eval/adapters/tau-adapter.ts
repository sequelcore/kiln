import { KilnError } from "../../engine/errors.js";
import type { Dataset, DatasetItem } from "../types.js";
import type { BfclFunctionCall } from "./bfcl-adapter.js";

export interface TauAdapterOptions {
  readonly datasetName: string;
  readonly content: string;
  readonly profileId?: string;
}

export interface TauProjectionResult {
  readonly dataset: Dataset;
  readonly unsupportedRows: readonly TauUnsupportedRow[];
}

export interface TauUnsupportedRow {
  readonly index: number;
  readonly id?: string;
  readonly reason: string;
}

export function projectTauDataset(options: TauAdapterOptions): TauProjectionResult {
  const rows = parseRows(options.content, options.datasetName);
  const items: DatasetItem[] = [];
  const unsupportedRows: TauUnsupportedRow[] = [];

  rows.forEach((row, index) => {
    const id = readString(row, "id") ?? `${options.datasetName}-${index + 1}`;
    const userTask = readString(row, "user_task")
      ?? readString(row, "userTask")
      ?? readString(row, "instruction")
      ?? readString(row, "prompt");
    if (!userTask) {
      unsupportedRows.push({ index, id, reason: "missing user task/instruction/prompt" });
      return;
    }
    const expectedToolCalls = readCalls(row, ["expectedToolCalls", "expected_actions", "ground_truth"]);
    if (expectedToolCalls.length === 0) {
      unsupportedRows.push({ index, id, reason: "missing supported expected tool-call trajectory" });
      return;
    }

    items.push({
      id,
      input: renderTauInput({
        userTask,
        policy: readString(row, "policy") ?? readString(row, "policy_document"),
        userTurns: readStringArray(row.user_turns ?? row.userTurns),
        tools: readTools(row),
      }),
      expected: readString(row, "expected") ?? readString(row, "expected_outcome") ?? JSON.stringify(expectedToolCalls),
      metadata: {
        benchmark: "tau",
        sourceRowId: id,
        domain: readString(row, "domain"),
        expectedAgentId: options.profileId ?? "kiln-tool-agent",
        expectedToolCalls,
        milestones: expectedToolCalls.map((call) => ({
          name: `tool:${call.name}`,
          completed: true,
        })),
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

function renderTauInput(input: {
  readonly userTask: string;
  readonly policy?: string;
  readonly userTurns: readonly string[];
  readonly tools: readonly unknown[];
}): string {
  return [
    "Complete the workflow by conversing with the user when needed and using tools only when policy allows.",
    "",
    "User task:",
    input.userTask,
    ...(input.policy ? ["", "Policy:", input.policy] : []),
    ...(input.userTurns.length > 0 ? ["", "User turns:", ...input.userTurns.map((turn, index) => `${index + 1}. ${turn}`)] : []),
    "",
    "Available tools:",
    JSON.stringify(input.tools, null, 2),
  ].join("\n");
}

function readCalls(row: Record<string, unknown>, fields: readonly string[]): readonly BfclFunctionCall[] {
  for (const field of fields) {
    const raw = row[field];
    const parsed = typeof raw === "string" ? tryParseJson(raw) : raw;
    if (!Array.isArray(parsed)) continue;
    const calls = parsed.flatMap(readCall);
    if (calls.length > 0) return calls;
  }
  return [];
}

function readCall(value: unknown): readonly BfclFunctionCall[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const name = readString(record, "name")
    ?? readString(record, "function")
    ?? readString(record, "tool_name")
    ?? readString(record, "action");
  if (!name) return [];
  const args = record.args ?? record.arguments ?? record.parameters;
  return [{
    name,
    ...(args && typeof args === "object" && !Array.isArray(args) ? { args: args as Record<string, unknown> } : {}),
  }];
}

function readTools(row: Record<string, unknown>): readonly unknown[] {
  const raw = row.tools ?? row.functions ?? row.apis;
  const parsed = typeof raw === "string" ? tryParseJson(raw) : raw;
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return [parsed];
  return [];
}

function parseRows(content: string, datasetName: string): readonly Record<string, unknown>[] {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new KilnError("EVAL_DATASET_NOT_FOUND", `tau dataset "${datasetName}" is empty`, {
      context: { datasetName },
    });
  }
  const parsed = tryParseJson(trimmed);
  if (Array.isArray(parsed)) return parsed.map((entry, index) => requireRecord(entry, datasetName, index));
  if (parsed && typeof parsed === "object") {
    const records = (parsed as Record<string, unknown>).data
      ?? (parsed as Record<string, unknown>).rows
      ?? (parsed as Record<string, unknown>).tasks;
    if (Array.isArray(records)) return records.map((entry, index) => requireRecord(entry, datasetName, index));
  }
  return trimmed
    .split("\n")
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith("#"))
    .map((line, index) => requireRecord(parseJson(line, datasetName, index), datasetName, index));
}

function readString(record: Record<string, unknown> | undefined, field: string): string | undefined {
  const value = record?.[field];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
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
    throw new KilnError("EVAL_DATASET_INVALID", `Invalid tau JSON row at ${index + 1} in "${datasetName}"`, {
      context: { datasetName, index },
    });
  }
}

function requireRecord(value: unknown, datasetName: string, index: number): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KilnError("EVAL_DATASET_INVALID", `tau row ${index + 1} in "${datasetName}" must be an object`, {
      context: { datasetName, index },
    });
  }
  return value as Record<string, unknown>;
}
