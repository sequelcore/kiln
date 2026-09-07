import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { DefaultContextGovernor } from "../../packages/core/src/context/index.js";
import {
  ReversibleContextProjectionService,
  reduceTypedArtifact,
  restoreTypedArtifact,
} from "../../packages/core/src/efficiency/index.js";
import { MemoryArtifactResourceStore } from "../../packages/core/src/tools/index.js";
import { locationKeys, scoreLocations } from "./evaluate.js";
import { ProjectCapture } from "./project-capture.js";
import { TypeScriptReferenceAdapter } from "./reference-adapter.js";
import { createReferenceProjection, verifyCurrentReferenceEvidence } from "./reference-projection.js";
import { captureSources, digest, isCurrent } from "./snapshot.js";
import { testProjectDirectory, testProjectHashes, testProjectTasks } from "./test-project-corpus.js";

const root = resolve(import.meta.dirname, "../..");
const protocolPath = "docs/research/active/repository-analysis-projection-protocol.md";
const implementationFiles = [
  ...[
    "reference-projection.ts",
    "evaluate-projection.ts",
    "reference-adapter.ts",
    "project-capture.ts",
    "snapshot.ts",
    "test-project-corpus.ts",
    "project-corpus.ts",
    "evaluate.ts",
    "corpus.ts",
  ].map((file) => `scripts/repository-analysis/${file}`),
  "packages/core/src/efficiency/reversible-context-projection.ts",
  "packages/core/src/efficiency/typed-artifact-reducer.ts",
  "packages/core/src/tools/infrastructure/artifact-resource-store.ts",
  "packages/core/src/context/governor.ts",
  "packages/core/src/context/projected-context.ts",
];
const baseline = captureSources(
  root,
  Object.keys(testProjectHashes).map((file) => `${testProjectDirectory}/${file}`),
);
for (const source of baseline.sources) {
  if (source.hash !== `sha256:${testProjectHashes[source.path.slice(testProjectDirectory.length + 1)]}`)
    throw new Error("source-corpus-changed");
}
for (const task of testProjectTasks)
  for (const [file, line, column] of task.occurrences) {
    const source = baseline.sources.find((source) => source.path === `${testProjectDirectory}/${file}`);
    if (source?.text.split("\n")[line - 1]?.slice(column - 1, column - 1 + task.symbol.length) !== task.symbol)
      throw new Error("source-oracle-mismatch");
  }
const implementationHashes = implementationFiles.map((path) => ({
  path,
  hash: digest(readFileSync(resolve(root, path))),
}));
const observations = [];
for (const task of testProjectTasks) {
  let adapter: TypeScriptReferenceAdapter | undefined;
  try {
    const first = task.occurrences[0];
    if (!first) throw new Error("missing-query-oracle");
    const request = {
      operation: "references" as const,
      workspaceRoot: root,
      path: `${testProjectDirectory}/${first[0]}`,
      position: { line: first[1] - 1, character: first[2] - 1 },
      limit: 1000,
    };
    const capture = new ProjectCapture(root, `${testProjectDirectory}/tsconfig.test.json`);
    adapter = new TypeScriptReferenceAdapter(capture);
    const evidence = await adapter.query(request);
    const current = () => isCurrent(baseline) && capture.current();
    const service = new ReversibleContextProjectionService({ store: new MemoryArtifactResourceStore() });
    const projection = createReferenceProjection(service, request, evidence, current);
    const selected = new DefaultContextGovernor().project({
      artifacts: [projection.candidate],
      artifactProjectionPreference: "reversible",
      tokenBudget: 100000,
    });
    const block = selected.blocks[0];
    const handle = block?.projectionEvidence?.retrievalHandle;
    const hash = block?.projectionEvidence?.sourceHash;
    if (!block || !handle || !hash) throw new Error("missing-projection-evidence");
    const retrieved = service.retrieve(handle);
    const exactRetrieval =
      retrieved.status === "available" && JSON.stringify(retrieved.artifact) === JSON.stringify(projection.artifact);
    const verification = verifyCurrentReferenceEvidence(service, handle, hash, current);
    const reduction = reduceTypedArtifact({ artifact: projection.artifact, canonicalArtifactUri: handle });
    const losslessRoundTrip =
      reduction.mode === "canonical" ||
      JSON.stringify(restoreTypedArtifact(reduction)) === JSON.stringify(projection.artifact);
    const expected = task.occurrences
      .map(([file, line, column]) => `${testProjectDirectory}/${file}:${line - 1}:${column - 1}:${task.symbol.length}`)
      .sort();
    const score = scoreLocations(locationKeys(evidence.entries), expected);
    const { project, ...fields } = evidence;
    const {
      currentAtProjection: _current,
      freshnessNotice: _notice,
      project: summaryProject,
      ...summaryFields
    } = projection.summary;
    const { deferredInputCount: _deferred, ...retainedProject } = summaryProject ?? {};
    const preservedFields =
      isDeepStrictEqual(fields, summaryFields) &&
      (!project || isDeepStrictEqual({ ...retainedProject, inputs: project.inputs }, project));
    const adapterBytes = Buffer.byteLength(JSON.stringify(evidence));
    const reversibleBytes = Buffer.byteLength(block.content);
    const canonicalArtifactBytes = Buffer.byteLength(JSON.stringify(projection.artifact));
    const passed =
      evidence.disposition === "complete" &&
      score.precision === 1 &&
      score.recall === 1 &&
      verification.verified &&
      exactRetrieval &&
      losslessRoundTrip &&
      preservedFields === true &&
      block.projectionEvidence?.mode === "reversible" &&
      reversibleBytes < adapterBytes;
    observations.push({
      task: task.id,
      passed,
      expected,
      score,
      preservedFields,
      exactRetrieval,
      verification,
      adapterBytes,
      reversibleBytes,
      canonicalArtifactBytes,
      fullGovernorBytes: Buffer.byteLength(projection.candidate.content),
      reversiblePlusRetrievalBytes: reversibleBytes + canonicalArtifactBytes,
      reduction:
        reduction.mode === "lossless"
          ? {
              mode: reduction.mode,
              sourceBytes: reduction.sourceBytes,
              projectedBytes: reduction.projectedBytes,
              losslessRoundTrip,
            }
          : { mode: reduction.mode, reason: reduction.reason },
      canonicalArtifact: projection.artifact,
      projectedContent: block.content,
      projectionEvidence: block.projectionEvidence,
      audit: service.audit(),
    });
  } catch (error) {
    observations.push({
      task: task.id,
      passed: false,
      failure: error instanceof Error ? error.message : "projection-experiment-failed",
    });
  } finally {
    await adapter?.close();
  }
}
console.log(
  JSON.stringify(
    {
      schema: "repository-analysis-projection-development-v1",
      verdict: "diagnostic-only",
      createdAt: new Date().toISOString(),
      protocolDigest: digest(readFileSync(resolve(root, protocolPath))),
      implementationHashes,
      implementationDigest: digest(JSON.stringify(implementationHashes)),
      predecessorReportDigest: digest(
        readFileSync(resolve(root, "docs/research/fixtures/repository-analysis/test-project-v1/first-run.json")),
      ),
      revision: baseline.revision,
      dirtyStateDigest: baseline.dirtyStateDigest,
      sourceDigest: baseline.sourceDigest,
      runtime: process.versions,
      platform: process.platform,
      sourceHashes: baseline.sources.map(({ path, hash }) => ({ path, hash })),
      allProjectionOraclesPassed: observations.every((row) => row.passed),
      observations,
      limitations: [
        "development corpus; not held out",
        "in-memory handles expired when process exited; canonical artifacts retained in this report",
        "bytes only; no provider tokens, cost, or agent task outcomes",
        "retrieval adds canonical artifact bytes; initial byte reduction is not total task savings",
        "no production registration or durable retrieval-route evaluation",
      ],
    },
    null,
    2,
  ),
);
