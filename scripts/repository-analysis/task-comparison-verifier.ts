import { isDeepStrictEqual } from "node:util";
import { scoreLocations } from "./evaluate.js";
import { occurrenceKeys, type ComparisonTask, type Occurrence } from "./task-comparison-corpus.js";

export function expectedEdit(
  task: Extract<ComparisonTask, { kind: "edit" }>,
  sources: Readonly<Record<string, string>>,
): Record<string, string> {
  const changes: Record<string, string> = {};
  for (const file of new Set(task.occurrences.map(([file]) => file))) {
    const original = sources[file];
    if (original === undefined) throw new Error("missing-oracle-source");
    const lines = original.split("\n");
    const spans = task.occurrences.filter(([path]) => path === file).sort((a, b) => b[1] - a[1] || b[2] - a[2]);
    for (const [, line, column, symbol] of spans) {
      const text = lines[line - 1];
      if (text?.slice(column - 1, column - 1 + symbol.length) !== symbol) throw new Error("source-oracle-mismatch");
      lines[line - 1] = text.slice(0, column - 1) + task.replacement + text.slice(column - 1 + symbol.length);
    }
    changes[file] = lines.join("\n");
  }
  return changes;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function locations(actual: unknown, expected: readonly Occurrence[]) {
  if (!Array.isArray(actual) || !actual.every((item): item is string => typeof item === "string"))
    return { passed: false, reason: "invalid-locations" };
  const score = scoreLocations(actual, occurrenceKeys(expected));
  return { passed: score.precision === 1 && score.recall === 1, ...score };
}

/** Evaluator-owned final-state oracle; no analyzer outputs participate in expected answers. */
export function verifyTaskAnswer(task: ComparisonTask, answer: unknown, sources: Readonly<Record<string, string>>) {
  if (!object(answer) || answer["status"] !== "complete" || answer["scope"] !== "configured-project-only")
    return { passed: false, reason: "incomplete-or-invalid-scope" };
  const allowed =
    task.kind === "edit"
      ? ["status", "scope", "changedFiles"]
      : task.kind === "locations"
        ? ["status", "scope", "locations"]
        : ["status", "scope", "locations", "indirectImpactPossible", "witnessLocations"];
  if (Object.keys(answer).some((key) => !allowed.includes(key)))
    return { passed: false, reason: "unexpected-answer-field" };
  if (task.kind === "edit")
    return {
      passed: isDeepStrictEqual(answer["changedFiles"], expectedEdit(task, sources)),
      reason: "exact-scoped-edit",
    };
  const direct = locations(answer["locations"], task.occurrences);
  if (task.kind === "locations") return direct;
  const witnesses = locations(answer["witnessLocations"], task.witnesses);
  return { passed: direct.passed && witnesses.passed && answer["indirectImpactPossible"] === true, direct, witnesses };
}
