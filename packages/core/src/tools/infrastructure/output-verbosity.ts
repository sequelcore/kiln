import type { ToolOutputVerbosity } from "../domain/tool-result-metadata.js";
import type { ToolInput, ToolResult } from "../domain/tool.js";
import { optionalString, toErrorResult } from "./tool-helpers.js";

export function parseOutputVerbosity(input: ToolInput): { ok: true; value: ToolOutputVerbosity } | { ok: false; result: ToolResult } {
  const value = optionalString(input, "verbosity");
  if (value === undefined) {
    return { ok: true, value: "raw" };
  }
  if (value === "raw" || value === "structured" || value === "summary") {
    return { ok: true, value };
  }
  return {
    ok: false,
    result: toErrorResult('Invalid input: "verbosity" must be "raw", "structured", or "summary"'),
  };
}

export function splitNonEmptyLines(output: string): string[] {
  if (output.trim().length === 0) {
    return [];
  }
  return output.split(/\r?\n/).filter((line) => line.length > 0);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}
