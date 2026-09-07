import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { captureSources, digest, isCurrent } from "./snapshot.js";
import { comparisonTasks, occurrenceKeys, publicTaskPacket } from "./task-comparison-corpus.js";
import { expectedEdit, verifyTaskAnswer } from "./task-comparison-verifier.js";
import { testProjectDirectory, testProjectHashes } from "./test-project-corpus.js";

const root = resolve(import.meta.dirname, "../..");
const snapshot = captureSources(
  root,
  Object.keys(testProjectHashes).map((file) => `${testProjectDirectory}/${file}`),
);
for (const source of snapshot.sources)
  if (source.hash !== `sha256:${testProjectHashes[source.path.slice(testProjectDirectory.length + 1)]}`)
    throw new Error("source-corpus-changed");
const sources = Object.fromEntries(snapshot.sources.map(({ path, text }) => [path, text]));
const supportPaths = [
  "package.json",
  "tsconfig.json",
  `${testProjectDirectory}/package.json`,
  `${testProjectDirectory}/tsconfig.json`,
  `${testProjectDirectory}/tsconfig.test.json`,
  `${testProjectDirectory}/vitest.config.ts`,
];
const support = Object.fromEntries(supportPaths.map((path) => [path, readFileSync(resolve(root, path), "utf8")]));
const sourceHashes = [
  ...snapshot.sources.map(({ path, hash }) => ({ path, hash })),
  ...supportPaths.map((path) => ({ path, hash: digest(support[path] ?? "") })),
];
const implementationPaths = [
  "task-comparison-corpus.ts",
  "task-comparison-verifier.ts",
  "prepare-task-comparison.ts",
  "test-project-corpus.ts",
  "project-corpus.ts",
  "snapshot.ts",
  "evaluate.ts",
  "corpus.ts",
];
const implementationHashes = implementationPaths.map((file) => ({
  path: `scripts/repository-analysis/${file}`,
  hash: digest(readFileSync(resolve(import.meta.dirname, file))),
}));
for (const task of comparisonTasks)
  for (const [path, line, column, symbol] of [
    ...task.occurrences,
    ...(task.kind === "impact-boundary" ? task.witnesses : []),
  ]) {
    if (sources[path]?.split("\n")[line - 1]?.slice(column - 1, column - 1 + symbol.length) !== symbol)
      throw new Error("source-oracle-mismatch");
  }
const observations = [];
for (const task of comparisonTasks) {
  const answer = {
    status: "complete",
    scope: "configured-project-only",
    ...(task.kind === "edit"
      ? { changedFiles: expectedEdit(task, sources) }
      : {
          locations: occurrenceKeys(task.occurrences),
          ...(task.kind === "impact-boundary"
            ? { indirectImpactPossible: true, witnessLocations: occurrenceKeys(task.witnesses) }
            : {}),
        }),
  };
  const oracle = verifyTaskAnswer(task, answer, sources);
  if (task.kind !== "edit") {
    observations.push({
      task: task.id,
      passed: oracle.passed,
      oracle,
      referenceAnswerDigest: digest(JSON.stringify(answer)),
    });
    continue;
  }
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "kiln-task-comparison-")));
  const dependencyLink = join(directory, "node_modules");
  let linked = false;
  try {
    for (const [path, text] of Object.entries({ ...sources, ...support, ...expectedEdit(task, sources) })) {
      const destination = resolve(directory, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, text);
    }
    symlinkSync(resolve(root, "node_modules"), dependencyLink, "junction");
    linked = true;
    const check = spawnSync(
      process.execPath,
      [
        resolve(root, "node_modules/typescript/bin/tsc"),
        "-p",
        resolve(directory, testProjectDirectory, "tsconfig.test.json"),
        "--noEmit",
      ],
      { encoding: "utf8", timeout: 60000, maxBuffer: 1048576, windowsHide: true },
    );
    const tests = spawnSync(
      process.execPath,
      [
        resolve(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        resolve(directory, testProjectDirectory, "vitest.config.ts"),
      ],
      {
        cwd: resolve(directory, testProjectDirectory),
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 1048576,
        windowsHide: true,
      },
    );
    observations.push({
      task: task.id,
      passed: oracle.passed && check.status === 0 && tests.status === 0,
      oracle,
      referenceAnswerDigest: digest(JSON.stringify(answer)),
      typecheck: { exitCode: check.status, stdout: check.stdout, stderr: check.stderr, error: check.error?.message },
      tests: { exitCode: tests.status, stdout: tests.stdout, stderr: tests.stderr, error: tests.error?.message },
    });
  } catch (error) {
    observations.push({
      task: task.id,
      passed: false,
      failure: error instanceof Error ? error.message : "preparation-failed",
    });
  } finally {
    if (
      realpathSync(directory) !== directory ||
      !directory.startsWith(join(realpathSync(tmpdir()), "kiln-task-comparison-"))
    )
      throw new Error("invalid-cleanup-root");
    if (linked) unlinkSync(dependencyLink);
    rmSync(directory, { recursive: true, force: true });
  }
}
const current =
  isCurrent(snapshot) &&
  supportPaths.every((path) => digest(readFileSync(resolve(root, path))) === digest(support[path] ?? ""));
console.log(
  JSON.stringify(
    {
      schema: "repository-analysis-task-preparation-v1",
      verdict: "diagnostic-only",
      createdAt: new Date().toISOString(),
      liveCollectionAdmitted: false,
      physicalProviderRequests: 0,
      protocolDigest: digest(
        readFileSync(resolve(root, "docs/research/active/repository-analysis-task-comparison-protocol.md")),
      ),
      implementationHashes,
      implementationDigest: digest(JSON.stringify(implementationHashes)),
      sourceHashes,
      lockfileDigest: digest(readFileSync(resolve(root, "bun.lock"))),
      revision: snapshot.revision,
      dirtyStateDigest: snapshot.dirtyStateDigest,
      runtime: process.versions,
      platform: process.platform,
      publicPacket: { ...publicTaskPacket(), sourceHashes },
      current,
      allPreparationChecksPassed: current && observations.every((row) => row.passed),
      observations,
      limitations: [
        "instrument and reference-solution checks only; no model arms executed",
        "single-package developmental pilot; tasks reuse exposed source",
        "public packet must be isolated from evaluator artifacts before live use",
        "valid live control and executable comparison authority remain unresolved",
        "exact rename oracle intentionally rejects unrelated formatting changes",
      ],
    },
    null,
    2,
  ),
);
