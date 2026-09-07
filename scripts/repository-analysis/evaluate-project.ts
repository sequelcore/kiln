import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lexicalObservation, locationKeys, scoreLocations } from "./evaluate.js";
import { ProjectCapture } from "./project-capture.js";
import { projectConfig, projectSourceDirectory, projectSourceHashes, projectTasks } from "./project-corpus.js";
import { TypeScriptReferenceAdapter, type ReferenceEvidence } from "./reference-adapter.js";
import { captureSources, digest, isCurrent } from "./snapshot.js";
import { testProjectDirectory, testProjectFiles, testProjectHashes, testProjectTasks } from "./test-project-corpus.js";

export async function evaluateConfiguredProject(root: string, includeTests = false): Promise<unknown> {
  const protocolPath = includeTests
    ? "docs/research/active/repository-analysis-test-project-protocol.md"
    : "docs/research/active/repository-analysis-project-protocol.md";
  const sourceDirectory = includeTests ? testProjectDirectory : projectSourceDirectory;
  const sourceHashes = includeTests ? testProjectHashes : projectSourceHashes;
  const tasks = includeTests ? testProjectTasks : projectTasks;
  const config = includeTests ? `${testProjectDirectory}/tsconfig.test.json` : projectConfig;
  const testFiles = includeTests ? testProjectFiles.map((file) => `${testProjectDirectory}/${file}`) : [];
  const testKeys = (keys: readonly string[]) =>
    keys.filter((key) => testFiles.some((file) => key.startsWith(`${file}:`)));
  const implementationFiles = [
    "corpus.ts",
    "snapshot.ts",
    "reference-adapter.ts",
    "project-capture.ts",
    "project-corpus.ts",
    "test-project-corpus.ts",
    "evaluate.ts",
    "evaluate-project.ts",
  ];
  const implementationDigest = digest(
    JSON.stringify(
      implementationFiles.map((path) => [
        path,
        digest(readFileSync(resolve(root, "scripts/repository-analysis", path), "utf8")),
      ]),
    ),
  );
  const protocolDigest = digest(readFileSync(resolve(root, protocolPath), "utf8"));
  const paths = Object.keys(sourceHashes)
    .map((name) => `${sourceDirectory}/${name}`)
    .sort();
  const baseline = captureSources(root, paths);
  for (const source of baseline.sources) {
    const name = source.path.slice(sourceDirectory.length + 1);
    if (source.hash !== `sha256:${sourceHashes[name]}`) throw new Error("source-corpus-changed");
  }
  for (const task of tasks) {
    for (const [file, line, column] of task.occurrences) {
      const source = baseline.sources.find((source) => source.path === `${sourceDirectory}/${file}`);
      if (source?.text.split("\n")[line - 1]?.slice(column - 1, column - 1 + task.symbol.length) !== task.symbol) {
        throw new Error("source-oracle-mismatch");
      }
    }
  }
  const inputSets: Record<string, readonly { readonly path: string; readonly hash: string }[]> = {};
  function retain(evidence: ReferenceEvidence) {
    const { project, ...rest } = evidence;
    if (!project) return rest;
    const { inputs, ...projectMetadata } = project;
    const inputSet = digest(JSON.stringify(inputs));
    inputSets[inputSet] = inputs;
    return { ...rest, project: { ...projectMetadata, inputSet } };
  }
  const observations = [];
  let allExact = true;
  for (const task of tasks) {
    const expected = task.occurrences
      .map(([file, line, column]) => `${sourceDirectory}/${file}:${line - 1}:${column - 1}:${task.symbol.length}`)
      .sort();
    const first = task.occurrences[0];
    if (!first) throw new Error("missing-query-oracle");
    const request = {
      operation: "references" as const,
      workspaceRoot: root,
      path: `${sourceDirectory}/${first[0]}`,
      position: { line: first[1] - 1, character: first[2] - 1 },
      limit: 1000,
    };
    for (let repetition = 0; repetition < 3; repetition++) {
      const lexical = lexicalObservation(baseline, task.symbol);
      const started = performance.now();
      let adapter: TypeScriptReferenceAdapter | undefined;
      try {
        const capture = new ProjectCapture(root, config);
        adapter = new TypeScriptReferenceAdapter(capture);
        const cold = await adapter.query(request);
        const coldTotalMs = performance.now() - started;
        const warm = await adapter.query(request);
        const coldKeys = locationKeys(cold.entries);
        const warmKeys = locationKeys(warm.entries);
        const coldScore = scoreLocations(coldKeys, expected);
        const warmScore = scoreLocations(warmKeys, expected);
        const sameLocations = JSON.stringify(coldKeys) === JSON.stringify(warmKeys);
        const expectedRootFiles = JSON.stringify(paths);
        const sameRootFiles =
          JSON.stringify(cold.project?.rootFiles) === expectedRootFiles &&
          JSON.stringify(warm.project?.rootFiles) === expectedRootFiles;
        const current = isCurrent(baseline) && capture.current();
        const passed =
          cold.disposition === "complete" &&
          warm.disposition === "complete" &&
          sameLocations &&
          sameRootFiles &&
          current &&
          lexical.disposition === "complete" &&
          coldScore.precision === 1 &&
          coldScore.recall === 1 &&
          warmScore.precision === 1 &&
          warmScore.recall === 1;
        allExact &&= passed;
        observations.push({
          task: task.id,
          repetition,
          passed,
          expected,
          sameLocations,
          sameRootFiles,
          current,
          ...(includeTests
            ? {
                testSourceReferences: {
                  expected: testKeys(expected),
                  cold: { keys: testKeys(coldKeys), ...scoreLocations(testKeys(coldKeys), testKeys(expected)) },
                  warm: { keys: testKeys(warmKeys), ...scoreLocations(testKeys(warmKeys), testKeys(expected)) },
                  lexical: {
                    keys: testKeys(lexical.keys),
                    ...scoreLocations(testKeys(lexical.keys), testKeys(expected)),
                  },
                },
              }
            : {}),
          lexicalCandidates: { ...lexical, ...scoreLocations(lexical.keys, expected) },
          cold: {
            ...retain(cold),
            ...coldScore,
            totalMsIncludingCapture: coldTotalMs,
            locationBytes: Buffer.byteLength(JSON.stringify(cold.entries)),
            evidenceBytes: Buffer.byteLength(JSON.stringify(cold)),
          },
          warm: {
            ...retain(warm),
            ...warmScore,
            locationBytes: Buffer.byteLength(JSON.stringify(warm.entries)),
            evidenceBytes: Buffer.byteLength(JSON.stringify(warm)),
          },
        });
      } catch {
        allExact = false;
        observations.push({
          task: task.id,
          repetition,
          passed: false,
          expected,
          disposition: "failed",
          reason: "project-experiment-failed",
          elapsedMs: performance.now() - started,
          lexicalCandidates: { ...lexical, ...scoreLocations(lexical.keys, expected) },
        });
      } finally {
        await adapter?.close();
      }
    }
  }
  return {
    schema: includeTests
      ? "repository-analysis-test-project-development-v1"
      : "repository-analysis-configured-project-development-v1",
    verdict: "diagnostic-only",
    createdAt: new Date().toISOString(),
    protocolDigest,
    implementationDigest,
    workspaceId: baseline.workspaceId,
    revision: baseline.revision,
    dirtyStateDigest: baseline.dirtyStateDigest,
    sourceDigest: baseline.sourceDigest,
    sourceHashes: baseline.sources.map(({ path, hash }) => ({ path, hash })),
    runtime: process.versions,
    platform: process.platform,
    architecture: process.arch,
    rgVersion: spawnSync("rg", ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true }).stdout?.split(
      "\n",
    )[0],
    projectConfig: config,
    ...(includeTests ? { testFiles } : {}),
    inputSets,
    allReferenceOraclesPassed: allExact,
    observations,
    limitations: [
      "one small real package; development corpus, not held out",
      "configured project only; external consumers excluded",
      "lexical candidates exclude targeted-read reasoning",
      "no agent task or provider token/cost evidence",
      "native crash/hang/cancellation settlement not proven",
      ...(includeTests
        ? ["test-source references are not enclosing test cases or all behaviorally affected tests"]
        : []),
    ],
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--tests")) throw new Error("expected optional --tests");
  console.log(
    JSON.stringify(
      await evaluateConfiguredProject(resolve(import.meta.dirname, "../.."), args[0] === "--tests"),
      null,
      2,
    ),
  );
}
