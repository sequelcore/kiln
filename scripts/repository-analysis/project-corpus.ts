import type { CodeIntelligenceRequest } from "../../packages/core/src/tools/domain/code-intelligence.js";

export const projectConfig = "packages/operator-appearance/tsconfig.json";
export const projectSourceDirectory = "packages/operator-appearance/src";
export const projectSourceHashes: Readonly<Record<string, string>> = {
  "catalog.ts": "75cd30e9d72854c74806df02d2cfa54b11d7eee9154e60830465e35c5535a7ed",
  "colors.ts": "b3cc279230a8804e89007dbf33661355b91d261e516ec4d01f0ff65d9cd8f899",
  "contrast.ts": "a91a6c255ba8da624cf5c8f8ed626a46cf238604ae4da51526e2746893152234",
  "index.ts": "297ea1c74c7548ddb6cc1818a3ed8a8d64997885763c2d28eb1c9c6412b5a1cd",
  "palettes.ts": "6c758569751b3b3d8a2ad21fdd14043918ac5dc2ffa0c8bf3e4150331593d382",
  "resolve.ts": "fb9d99b155d5497f68e4fe6c6ad9bfb617c6aadcfe778ff9bdea9bd745224b47",
  "types.ts": "066921a0952267d3b7478e3d0d1ee160e5eac3cd126db0f2a118ebc44e55b6f0",
  "validation.ts": "50926a41153636e922b121213798d7cdbf985e9ea04efb92b051a279e06cc03a",
};

export interface ProjectTask {
  readonly id: string;
  readonly symbol: string;
  readonly occurrences: readonly (readonly [file: string, line: number, column: number])[];
}

export const projectTasks: readonly ProjectTask[] = [
  {
    id: "contrast-function",
    symbol: "operatorContrastRatio",
    occurrences: [
      ["colors.ts", 86, 17],
      ["contrast.ts", 1, 30],
      ["contrast.ts", 152, 19],
      ["contrast.ts", 197, 30],
      ["index.ts", 22, 3],
    ],
  },
  {
    id: "channel-parameter",
    symbol: "channel",
    occurrences: [
      ["colors.ts", 42, 28],
      ["colors.ts", 43, 10],
      ["colors.ts", 43, 41],
      ["colors.ts", 43, 59],
    ],
  },
  {
    id: "appearance-resolver",
    symbol: "resolveOperatorAppearance",
    occurrences: [
      ["resolve.ts", 85, 17],
      ["resolve.ts", 129, 10],
      ["index.ts", 32, 3],
    ],
  },
];

export function projectRequest(root: string, task: ProjectTask): CodeIntelligenceRequest {
  const first = task.occurrences[0];
  if (!first) throw new Error("missing-query-oracle");
  return {
    operation: "references",
    workspaceRoot: root,
    path: `${projectSourceDirectory}/${first[0]}`,
    position: { line: first[1] - 1, character: first[2] - 1 },
    limit: 1000,
  };
}

export function projectExpectedKeys(task: ProjectTask): string[] {
  return task.occurrences
    .map(([file, line, column]) => `${projectSourceDirectory}/${file}:${line - 1}:${column - 1}:${task.symbol.length}`)
    .sort();
}
