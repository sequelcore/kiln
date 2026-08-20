import { describe, expect, it } from "vitest";
import {
  normalizeFormalProofSubjects,
  type FormalProofSubject,
} from "../../src/work-governance/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64).slice(0, 64)}`;

describe("formal proof subjects", () => {
  it("normalizes and sorts candidate-relative subjects", () => {
    const subjects = normalizeFormalProofSubjects([
      { path: "b/file.dfy", contentDigest: digest("b") },
      { path: "a/file.dfy", contentDigest: digest("a") },
    ]);

    expect(subjects).toEqual([
      { path: "a/file.dfy", contentDigest: digest("a") },
      { path: "b/file.dfy", contentDigest: digest("b") },
    ] satisfies readonly FormalProofSubject[]);
  });

  it("sorts by explicit code-unit order across non-ASCII paths", () => {
    const subjects = normalizeFormalProofSubjects([
      { path: "ä/file.dfy", contentDigest: digest("a") },
      { path: "z/file.dfy", contentDigest: digest("c") },
      { path: "a/file.dfy", contentDigest: digest("b") },
    ]);

    expect(subjects.map(({ path }) => path)).toEqual([
      "a/file.dfy",
      "z/file.dfy",
      "ä/file.dfy",
    ]);
  });

  it.each([
    "../outside.ts",
    "/absolute.ts",
    "C:/absolute.ts",
    "dir\\file.ts",
    "dir//file.ts",
    "dir/../file.ts",
  ])("rejects non-candidate-relative subject path %s", (path) => {
    expect(() => normalizeFormalProofSubjects([{ path, contentDigest: digest("a") }]))
      .toThrow(/subject path/u);
  });

  it("rejects duplicate subjects", () => {
    expect(() => normalizeFormalProofSubjects([
      { path: "file.dfy", contentDigest: digest("a") },
      { path: "file.dfy", contentDigest: digest("b") },
    ])).toThrow(/duplicate subject path/u);
  });
});
