import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ReversibleContextProjectionService,
  reduceTypedArtifact,
  restoreTypedArtifact,
} from "../../packages/core/src/efficiency/index.js";
import { createFileArtifactResourceStore } from "../../packages/runtime/src/artifacts/file-artifact-resource-store.js";
import { digest, captureWorkspaceIdentity } from "./snapshot.js";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected-report-object");
  return value as Record<string, unknown>;
}
const root = resolve(import.meta.dirname, "../..");
const sourcePath = "docs/research/fixtures/repository-analysis/projection-v1/first-run.json";
const source = readFileSync(resolve(root, sourcePath));
const sourceReportDigest = digest(source);
if (sourceReportDigest !== "sha256:c31e21ff06900e94cc6823b2a954c0c0115c2be77b83b008fe556fafa0484490")
  throw new Error("frozen-report-changed");
const report = record(JSON.parse(source.toString("utf8")));
const rows = report["observations"];
if (report["allProjectionOraclesPassed"] !== true || !Array.isArray(rows) || rows.length !== 3)
  throw new Error("invalid-source-cohort");
const identity = captureWorkspaceIdentity(root);
const protocolPath = "docs/research/active/repository-analysis-durable-protocol.md";
const implementationFiles = [
  "scripts/repository-analysis/evaluate-durable.ts",
  "scripts/repository-analysis/durable-retrieval.ts",
  "scripts/repository-analysis/snapshot.ts",
  "packages/runtime/src/artifacts/file-artifact-resource-store.ts",
  "packages/core/src/tools/infrastructure/artifact-resource-store.ts",
  "packages/core/src/tools/domain/tool-resource-registry.ts",
  "packages/core/src/efficiency/reversible-context-projection.ts",
  "packages/core/src/efficiency/typed-artifact-reducer.ts",
];
const implementationHashes = implementationFiles.map((path) => ({
  path,
  hash: digest(readFileSync(resolve(root, path))),
}));
const observations = [];
for (const raw of rows) {
  const row = record(raw);
  const task = row["task"];
  if (typeof task !== "string") throw new Error("missing-task-identity");
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "kiln-durable-reference-eval-")));
  try {
    const retainedHash = record(row["projectionEvidence"])["sourceHash"];
    if (typeof retainedHash !== "string") throw new Error("missing-source-hash");
    // Core validates and restores the artifact; the report parser does not own a second artifact schema.
    const reduction = reduceTypedArtifact({
      artifact: row["canonicalArtifact"],
      canonicalArtifactUri: "kiln://artifacts/context-evidence/artifact_1/content",
    });
    if (reduction.mode !== "lossless") throw new Error("expected-frozen-lossless-artifact");
    const artifact = restoreTypedArtifact(reduction);
    if (digest(JSON.stringify(artifact)) !== retainedHash) throw new Error("source-artifact-hash-mismatch");
    const store = createFileArtifactResourceStore({ rootDir: directory, maxArtifactsPerNamespace: 2 });
    const candidate = new ReversibleContextProjectionService({ store }).createContextCandidate({
      artifact,
      source: "research:durable-reference-replay",
    });
    const option = candidate.projectionOptions?.find((option) => option.mode === "reversible");
    if (!option?.retrievalHandle || option.sourceHash !== retainedHash)
      throw new Error("persisted-projection-identity-mismatch");
    for (const text of ["one", "two"])
      store.put({
        namespace: "context-evidence",
        title: "Transient replay artifact",
        mimeType: "text/plain",
        content: { type: "text", text },
        producer: { kind: "research", name: "retention-churn" },
        retention: { scope: "session", maxArtifacts: 1 },
      });
    const child = spawnSync(
      process.execPath,
      ["run", resolve(import.meta.dirname, "durable-retrieval.ts"), directory, option.retrievalHandle, retainedHash],
      { encoding: "utf8", timeout: 30000, maxBuffer: 2097152, windowsHide: true },
    );
    if (child.error || child.status !== 0)
      throw child.error ?? new Error(`reader-exit-${child.status}: ${child.stderr.slice(0, 500)}`);
    const result = record(JSON.parse(child.stdout));
    const exactText = result["text"] === JSON.stringify(artifact, null, 2);
    const retained = result["retainedArtifacts"];
    const verificationRetained =
      Array.isArray(retained) &&
      retained.some((item) => {
        const metadata = record(item);
        return metadata["id"] === "artifact_1" && record(metadata["retention"])["scope"] === "verification";
      });
    const passed =
      result["status"] === "verified" &&
      exactText &&
      verificationRetained &&
      typeof result["pageCount"] === "number" &&
      result["pageCount"] > 1;
    observations.push({
      task,
      passed,
      exactText,
      verificationRetained,
      retainedHash,
      expectedTextDigest: digest(JSON.stringify(artifact, null, 2)),
      childExitCode: child.status,
      childResult: result,
    });
  } catch (error) {
    observations.push({
      task,
      passed: false,
      failure: error instanceof Error ? error.message : "durable-experiment-failed",
    });
  } finally {
    if (
      realpathSync(directory) !== directory ||
      !directory.startsWith(join(realpathSync(tmpdir()), "kiln-durable-reference-eval-"))
    )
      throw new Error("invalid-cleanup-root");
    rmSync(directory, { recursive: true, force: true });
  }
}
console.log(
  JSON.stringify(
    {
      schema: "repository-analysis-durable-development-v1",
      verdict: "diagnostic-only",
      createdAt: new Date().toISOString(),
      sourcePath,
      sourceReportDigest,
      protocolDigest: digest(readFileSync(resolve(root, protocolPath))),
      implementationHashes,
      implementationDigest: digest(JSON.stringify(implementationHashes)),
      revision: identity.revision,
      dirtyStateDigest: identity.dirtyStateDigest,
      runtime: process.versions,
      platform: process.platform,
      allDurableOraclesPassed: observations.every((row) => row.passed),
      observations,
      limitations: [
        "historical replay; current workspace freshness not claimed",
        "fresh reader process; not crash/power-loss or concurrent-writer testing",
        "ordinary Core provider; live Gateway routing not exercised",
        "temporary storage removed after collection; retained source report and child output are durable evidence",
        "resource bytes only; no provider tokens or task-efficiency evidence",
      ],
    },
    null,
    2,
  ),
);
