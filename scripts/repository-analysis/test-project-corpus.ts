import { projectSourceHashes, type ProjectTask } from "./project-corpus.js";

export const testProjectDirectory = "packages/operator-appearance";
export const testProjectFiles = ["tests/operator-appearance.test.ts"] as const;
export const testProjectHashes: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(projectSourceHashes).map(([file, hash]) => [`src/${file}`, hash])),
  "tests/operator-appearance.test.ts": "0e586c4f9025ae7fc5671d996687358ca05618f8bccb14a3f45e4b4b52ade07d",
};

/** Literal locations inspected before collection; the first occurrence is the query. */
export const testProjectTasks: readonly ProjectTask[] = [
  {
    id: "resolver-from-test-import",
    symbol: "resolveOperatorAppearance",
    occurrences: [
      ["tests/operator-appearance.test.ts", 19, 3],
      ["src/resolve.ts", 85, 17],
      ["src/resolve.ts", 129, 10],
      ["src/index.ts", 32, 3],
      ["tests/operator-appearance.test.ts", 131, 19],
      ["tests/operator-appearance.test.ts", 138, 18],
      ["tests/operator-appearance.test.ts", 145, 22],
      ["tests/operator-appearance.test.ts", 154, 20],
      ["tests/operator-appearance.test.ts", 165, 23],
      ["tests/operator-appearance.test.ts", 178, 28],
    ],
  },
  {
    id: "recursive-test-helper",
    symbol: "collectColors",
    occurrences: [
      ["tests/operator-appearance.test.ts", 26, 10],
      ["tests/operator-appearance.test.ts", 36, 40],
      ["tests/operator-appearance.test.ts", 89, 27],
    ],
  },
  {
    id: "contrast-without-direct-test-reference",
    symbol: "operatorContrastRatio",
    occurrences: [
      ["src/colors.ts", 86, 17],
      ["src/contrast.ts", 1, 30],
      ["src/contrast.ts", 152, 19],
      ["src/contrast.ts", 197, 30],
      ["src/index.ts", 22, 3],
    ],
  },
];
