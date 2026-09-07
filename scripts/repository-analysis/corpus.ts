import type { CodeIntelligenceRequest } from "../../packages/core/src/tools/domain/code-intelligence.js";

export const fixtureDirectory = "docs/research/fixtures/repository-analysis/v1";
export const fixtureNames = ["origin", "direct", "alias", "barrel", "consumer", "shadow", "unrelated"] as const;

export interface ExpectedOccurrence {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly symbol: string;
}

export interface ReferenceTask {
  readonly id: string;
  readonly query: ExpectedOccurrence;
  readonly expected: readonly ExpectedOccurrence[];
}

// Independent, hand-authored source-coordinate oracle from the preregistered protocol.
export const referenceTasks: readonly ReferenceTask[] = [
  {
    id: "exported-score",
    query: { file: "origin", line: 1, column: 17, symbol: "score" },
    expected: [
      { file: "origin", line: 1, column: 17, symbol: "score" },
      { file: "direct", line: 1, column: 10, symbol: "score" },
      { file: "direct", line: 2, column: 23, symbol: "score" },
      { file: "alias", line: 1, column: 10, symbol: "score" },
      { file: "alias", line: 1, column: 19, symbol: "evaluate" },
      { file: "alias", line: 2, column: 24, symbol: "evaluate" },
      { file: "barrel", line: 1, column: 10, symbol: "score" },
      { file: "barrel", line: 1, column: 19, symbol: "rank" },
      { file: "consumer", line: 1, column: 10, symbol: "rank" },
      { file: "consumer", line: 2, column: 23, symbol: "rank" },
    ],
  },
  {
    id: "shadowed-score",
    query: { file: "shadow", line: 1, column: 26, symbol: "score" },
    expected: [
      { file: "shadow", line: 1, column: 26, symbol: "score" },
      { file: "shadow", line: 2, column: 10, symbol: "score" },
    ],
  },
  {
    id: "unrelated-score",
    query: { file: "unrelated", line: 1, column: 17, symbol: "score" },
    expected: [
      { file: "unrelated", line: 1, column: 17, symbol: "score" },
      { file: "unrelated", line: 4, column: 26, symbol: "score" },
    ],
  },
];

export function taskRequest(root: string, task: ReferenceTask): CodeIntelligenceRequest {
  return {
    operation: "references",
    workspaceRoot: root,
    path: `${fixtureDirectory}/${task.query.file}.ts`,
    position: { line: task.query.line - 1, character: task.query.column - 1 },
    limit: 1000,
  };
}

export function expectedKeys(task: ReferenceTask): string[] {
  return task.expected
    .map((e) => `${fixtureDirectory}/${e.file}.ts:${e.line - 1}:${e.column - 1}:${e.symbol.length}`)
    .sort();
}
