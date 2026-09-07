import { projectTasks } from "./project-corpus.js";
import { testProjectDirectory, testProjectTasks } from "./test-project-corpus.js";

interface TaskBase {
  readonly id: string;
  readonly prompt: string;
}
export type ComparisonTask = TaskBase &
  (
    | { readonly kind: "edit"; readonly occurrences: readonly Occurrence[]; readonly replacement: string }
    | { readonly kind: "locations"; readonly occurrences: readonly Occurrence[] }
    | {
        readonly kind: "impact-boundary";
        readonly occurrences: readonly Occurrence[];
        readonly witnesses: readonly Occurrence[];
      }
  );
export type Occurrence = readonly [file: string, line: number, column: number, symbol: string];

function priorTask(id: string): readonly Occurrence[] {
  const task = testProjectTasks.find((task) => task.id === id);
  if (!task) throw new Error("missing-prior-task");
  return task.occurrences.map(([file, line, column]) => [`${testProjectDirectory}/${file}`, line, column, task.symbol]);
}
const channel = projectTasks.find((task) => task.id === "channel-parameter");
if (!channel) throw new Error("missing-channel-oracle");

/** Evaluator-only development oracles. Never include this module in a solver packet. */
export const comparisonTasks: readonly ComparisonTask[] = [
  {
    id: "rename-private-parameter",
    kind: "edit",
    replacement: "linearChannel",
    prompt:
      "Rename only the channel parameter of linearSrgbChannel in packages/operator-appearance/src/colors.ts to linearChannel, including its uses. Preserve other parameters named channel and all behavior. Return only the complete contents of changed files.",
    occurrences: channel.occurrences.map(([file, line, column]) => [
      `${testProjectDirectory}/src/${file}`,
      line,
      column,
      "channel",
    ]),
  },
  {
    id: "rename-recursive-test-helper",
    kind: "edit",
    replacement: "collectPaletteColors",
    prompt:
      "Rename the collectColors helper in packages/operator-appearance/tests/operator-appearance.test.ts to collectPaletteColors, including recursive and external uses within this configured project. Preserve behavior. Return only the complete contents of changed files.",
    occurrences: priorTask("recursive-test-helper"),
  },
  {
    id: "find-direct-resolver-test-calls",
    kind: "locations",
    prompt:
      "Within packages/operator-appearance/tsconfig.test.json, list every call to resolveOperatorAppearance in test source. Exclude imports, exports and declarations. Report direct call sites, not all behaviorally affected tests.",
    occurrences: priorTask("resolver-from-test-import").filter(
      ([file, line]) => file.includes("/tests/") && line !== 19,
    ),
  },
  {
    id: "contrast-indirect-test-impact",
    kind: "impact-boundary",
    prompt:
      "Within packages/operator-appearance/tsconfig.test.json, list direct test references to operatorContrastRatio. Determine whether tests can still be affected indirectly. As witnesses, list its call inside validateSemanticAdjacencyContrast and all test calls to that intermediate function. Do not infer no test impact from zero direct references.",
    occurrences: [],
    witnesses: [
      [`${testProjectDirectory}/src/contrast.ts`, 152, 19, "operatorContrastRatio"],
      [`${testProjectDirectory}/tests/operator-appearance.test.ts`, 98, 26, "validateSemanticAdjacencyContrast"],
      [`${testProjectDirectory}/tests/operator-appearance.test.ts`, 110, 29, "validateSemanticAdjacencyContrast"],
      [`${testProjectDirectory}/tests/operator-appearance.test.ts`, 124, 33, "validateSemanticAdjacencyContrast"],
    ],
  },
  {
    id: "rename-exported-resolver",
    kind: "edit",
    replacement: "resolveConfiguredOperatorAppearance",
    prompt:
      "Within the nine source files admitted by packages/operator-appearance/tsconfig.test.json only, rename resolveOperatorAppearance to resolveConfiguredOperatorAppearance, including declarations, calls and re-exports. Do not claim repository-wide completeness. Return only the complete contents of changed files.",
    occurrences: priorTask("resolver-from-test-import"),
  },
];

export function occurrenceKeys(occurrences: readonly Occurrence[]): string[] {
  return occurrences.map(([file, line, column, symbol]) => `${file}:${line - 1}:${column - 1}:${symbol.length}`).sort();
}

export function publicTaskPacket() {
  return {
    scope: "configured-project-only",
    config: `${testProjectDirectory}/tsconfig.test.json`,
    tasks: comparisonTasks.map(({ id, kind, prompt }) => ({ id, kind, prompt })),
    answerContract: {
      common: "status: complete|unsupported|failed; scope: configured-project-only",
      edit: "changedFiles: object mapping each changed workspace-relative path to its entire final text; omit unchanged files",
      locations: "locations: array of path:zeroBasedLine:zeroBasedUTF16Column:identifierLength strings",
      impactBoundary:
        "locations as above, indirectImpactPossible: boolean, witnessLocations: array in the same coordinate format",
    },
  };
}
