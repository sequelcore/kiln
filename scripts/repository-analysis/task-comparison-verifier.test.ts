import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { comparisonTasks, occurrenceKeys, publicTaskPacket } from "./task-comparison-corpus.js";
import { expectedEdit, verifyTaskAnswer } from "./task-comparison-verifier.js";
import { testProjectDirectory, testProjectHashes } from "./test-project-corpus.js";
const root = resolve(import.meta.dirname, "../..");
const sources = Object.fromEntries(
  Object.keys(testProjectHashes).map((file) => [
    `${testProjectDirectory}/${file}`,
    readFileSync(resolve(root, testProjectDirectory, file), "utf8"),
  ]),
);
const common = { status: "complete", scope: "configured-project-only" };

test.each(comparisonTasks)("task $id rejects unsupported and incomplete answers", (task) => {
  expect(verifyTaskAnswer(task, { status: "unsupported", scope: "configured-project-only" }, sources).passed).toBe(
    false,
  );
  expect(verifyTaskAnswer(task, common, sources).passed).toBe(false);
});
test("edit verifier rejects omitted recursive use and unrelated changes", () => {
  const task = comparisonTasks.find((task) => task.id === "rename-recursive-test-helper");
  if (!task || task.kind !== "edit") throw new Error("missing-edit-task");
  const changes = expectedEdit(task, sources);
  const file = `${testProjectDirectory}/tests/operator-appearance.test.ts`;
  const text = changes[file];
  if (!text) throw new Error("missing-edit-output");
  expect(text).toContain("flatMap(collectPaletteColors)");
  expect(text).not.toContain("collectColors");
  expect(verifyTaskAnswer(task, { ...common, changedFiles: changes }, sources).passed).toBe(true);
  expect(
    verifyTaskAnswer(
      task,
      {
        ...common,
        changedFiles: { ...changes, [file]: text.replace("flatMap(collectPaletteColors)", "flatMap(collectColors)") },
      },
      sources,
    ).passed,
  ).toBe(false);
  expect(
    verifyTaskAnswer(task, { ...common, changedFiles: { ...changes, "unrelated.ts": "changed" } }, sources).passed,
  ).toBe(false);
});
test("test-call scorer rejects imports, omissions and repository-wide scope claims", () => {
  const task = comparisonTasks.find((task) => task.kind === "locations");
  if (!task) throw new Error("missing-discovery-task");
  const locations = occurrenceKeys(task.occurrences);
  expect(locations).toHaveLength(6);
  expect(verifyTaskAnswer(task, { ...common, locations }, sources).passed).toBe(true);
  expect(verifyTaskAnswer(task, { ...common, locations: locations.slice(1) }, sources).passed).toBe(false);
  expect(
    verifyTaskAnswer(
      task,
      { ...common, locations: [...locations, `${testProjectDirectory}/tests/operator-appearance.test.ts:18:2:25`] },
      sources,
    ).passed,
  ).toBe(false);
  expect(verifyTaskAnswer(task, { ...common, scope: "repository-wide", locations }, sources).passed).toBe(false);
});
test("zero direct references cannot substitute for indirect-impact witnesses", () => {
  const task = comparisonTasks.find((task) => task.kind === "impact-boundary");
  if (!task || task.kind !== "impact-boundary") throw new Error("missing-impact-task");
  const answer = {
    ...common,
    locations: [],
    indirectImpactPossible: true,
    witnessLocations: occurrenceKeys(task.witnesses),
  };
  expect(verifyTaskAnswer(task, answer, sources).passed).toBe(true);
  expect(verifyTaskAnswer(task, { ...answer, indirectImpactPossible: false }, sources).passed).toBe(false);
  expect(verifyTaskAnswer(task, { ...answer, witnessLocations: [] }, sources).passed).toBe(false);
});
test("public task packet excludes evaluator oracles", () => {
  for (const task of publicTaskPacket().tasks) expect(Object.keys(task).sort()).toEqual(["id", "kind", "prompt"]);
});
