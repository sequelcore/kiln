import { describe, expect, it } from "vitest";
import { buildArguments } from "./run-native-continuity-codex-eval.js";

function argumentsFor(cohort: "none" | "native-baseline" | "native-baseline-plus-skill") {
  return buildArguments({
    cohort,
    model: "gpt-test",
    reasoning: "high",
    schemaPath: "C:\\fixture\\schema.json",
    lastMessagePath: "C:\\fixture\\response.json",
    workspace: "C:\\fixture\\workspace",
    prompt: "fixture",
  });
}

describe("native continuity Codex runner", () => {
  it("isolates the no-guidance cohort from native rules", () => {
    expect(argumentsFor("none")).toContain("--ignore-rules");
  });

  it("allows the projected rules only in native baseline cohorts", () => {
    for (const cohort of ["native-baseline", "native-baseline-plus-skill"] as const) {
      const args = argumentsFor(cohort);
      expect(args).not.toContain("--ignore-rules");
      expect(args).toEqual(expect.arrayContaining([
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--ephemeral",
      ]));
      expect(args).not.toContain("danger-full-access");
      expect(args).not.toContain("--yolo");
    }
  });
});
