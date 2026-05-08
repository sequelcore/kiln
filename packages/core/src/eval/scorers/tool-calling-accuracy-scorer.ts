// ToolCallingAccuracyScorer: rule-based BFCL-style tool calling accuracy (name + params)

import type { EvalInput, EvalScore, Scorer } from "../types.js";

interface ExpectedToolCall {
  readonly name: string;
  readonly args?: Record<string, unknown>;
}

function extractExpectedCalls(metadata: Record<string, unknown> | undefined): ExpectedToolCall[] | undefined {
  if (!metadata) return undefined;
  const raw = metadata["expectedToolCalls"];
  if (!Array.isArray(raw)) return undefined;
  const calls: ExpectedToolCall[] = [];
  for (const entry of raw) {
    if (typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>)["name"] === "string") {
      calls.push(entry as ExpectedToolCall);
    }
  }
  return calls.length > 0 ? calls : undefined;
}

function extractActualCalls(metadata: Record<string, unknown> | undefined): ExpectedToolCall[] | undefined {
  if (!metadata) return undefined;
  const raw = metadata["toolCalls"];
  if (!Array.isArray(raw)) return undefined;
  const calls: ExpectedToolCall[] = [];
  for (const entry of raw) {
    if (typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>)["name"] === "string") {
      const e = entry as Record<string, unknown>;
      calls.push({ name: e["name"] as string, args: e["args"] as Record<string, unknown> | undefined });
    }
  }
  return calls.length > 0 ? calls : undefined;
}

function extractAllowedExtraCallNames(metadata: Record<string, unknown> | undefined): ReadonlySet<string> {
  const raw = metadata?.allowedExtraToolCalls;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0));
}

function argsMatch(expected: Record<string, unknown> | undefined, actual: Record<string, unknown> | undefined): boolean {
  if (!expected) return true; // no expected args = don't check
  if (!actual) return false;
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(value)) return false;
  }
  return true;
}

export class ToolCallingAccuracyScorer implements Scorer {
  readonly name = "tool-calling-accuracy";

  async score(input: EvalInput): Promise<EvalScore> {
    const expected = extractExpectedCalls(input.metadata);
    if (!expected) {
      return { name: this.name, score: 0, reasoning: "No expectedToolCalls in metadata" };
    }

    const allowedExtraCallNames = extractAllowedExtraCallNames(input.metadata);
    const actual = extractActualCalls(input.metadata);
    if (!actual) {
      return { name: this.name, score: 0, reasoning: `0/${expected.length} expected calls made (no tool calls recorded)` };
    }

    // Precision: fraction of actual calls that match an expected call
    // Recall: fraction of expected calls that were made
    const expectedMatched = new Set<number>();
    const actualMatched = new Set<number>();

    for (let ei = 0; ei < expected.length; ei++) {
      for (let ai = 0; ai < actual.length; ai++) {
        if (actualMatched.has(ai)) continue;
        if (expected[ei]!.name === actual[ai]!.name && argsMatch(expected[ei]!.args, actual[ai]!.args)) {
          expectedMatched.add(ei);
          actualMatched.add(ai);
          break;
        }
      }
    }

    const relevantActualCount = actual.filter((call, index) =>
      actualMatched.has(index) || !allowedExtraCallNames.has(call.name)
    ).length;
    const precision = relevantActualCount > 0 ? actualMatched.size / relevantActualCount : 0;
    const recall = expectedMatched.size / expected.length;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    const missed = expected.filter((_, i) => !expectedMatched.has(i)).map((c) => c.name);
    const extra = actual
      .filter((call, index) => !actualMatched.has(index) && !allowedExtraCallNames.has(call.name))
      .map((c) => c.name);

    const parts: string[] = [`F1=${f1.toFixed(2)} (precision=${precision.toFixed(2)}, recall=${recall.toFixed(2)})`];
    if (missed.length > 0) parts.push(`missed: ${missed.join(", ")}`);
    if (extra.length > 0) parts.push(`extra: ${extra.join(", ")}`);

    return { name: this.name, score: Math.round(f1 * 100) / 100, reasoning: parts.join("; ") };
  }
}
