import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { ReversibleContextProjectionService, type JsonArtifact } from "../../packages/core/src/efficiency/index.js";
import { ArtifactResourceProvider } from "../../packages/core/src/tools/index.js";
import { createFileArtifactResourceStore } from "../../packages/runtime/src/artifacts/file-artifact-resource-store.js";
import { readDurableReference } from "./durable-retrieval.js";

const artifact: JsonArtifact = {
  kind: "json",
  exitStatus: 0,
  warnings: [],
  value: { marker: "ORIGINAL", lines: ["first", "second", "third"] },
};
function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "kiln-durable-reference-test-")));
  const store = createFileArtifactResourceStore({ rootDir: directory, maxArtifactsPerNamespace: 2 });
  const service = new ReversibleContextProjectionService({ store });
  const candidate = service.createContextCandidate({ artifact, source: "test:references" });
  const option = candidate.projectionOptions?.find((option) => option.mode === "reversible");
  if (!option?.retrievalHandle) throw new Error("missing-handle");
  return {
    directory,
    store,
    handle: option.retrievalHandle,
    hash: option.sourceHash,
    file: join(directory, "context-evidence", "artifact_1.json"),
    cleanup() {
      if (
        realpathSync(directory) !== directory ||
        !directory.startsWith(join(realpathSync(tmpdir()), "kiln-durable-reference-test-"))
      )
        throw new Error("invalid-cleanup-root");
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("a fresh process reopens protected evidence and retrieves every page exactly", () => {
  const f = fixture();
  try {
    for (const text of ["one", "two"])
      f.store.put({
        namespace: "context-evidence",
        title: "Transient",
        mimeType: "text/plain",
        content: { type: "text", text },
        producer: { kind: "test", name: "churn" },
        retention: { scope: "session", maxArtifacts: 1 },
      });
    const child = spawnSync(
      "bun",
      ["run", resolve(import.meta.dirname, "durable-retrieval.ts"), f.directory, f.handle, f.hash],
      { encoding: "utf8", timeout: 30000, windowsHide: true },
    );
    expect(child.status, child.stderr).toBe(0);
    const result: unknown = JSON.parse(child.stdout);
    expect(result).toMatchObject({
      status: "verified",
      text: JSON.stringify(artifact, null, 2),
      retainedArtifacts: expect.arrayContaining([{ id: "artifact_1", retention: { scope: "verification" } }]),
    });
  } finally {
    f.cleanup();
  }
});

test("missing and malformed persisted evidence cannot verify", async () => {
  const f = fixture();
  try {
    const original = readFileSync(f.file, "utf8");
    writeFileSync(f.file, "{invalid");
    await expect(readDurableReference(f.directory, f.handle, f.hash)).rejects.toThrow();
    writeFileSync(f.file, original);
    rmSync(f.file);
    expect(await readDurableReference(f.directory, f.handle, f.hash)).toMatchObject({
      status: "unverified",
      verification: { reason: "canonical-evidence-unavailable" },
    });
  } finally {
    f.cleanup();
  }
});

test("same-size valid tampering requires the retained hash to detect", async () => {
  const f = fixture();
  try {
    const original = readFileSync(f.file, "utf8");
    expect(original).toContain("ORIGINAL");
    writeFileSync(f.file, original.replace("ORIGINAL", "TAMPERED"));
    expect(await readDurableReference(f.directory, f.handle, f.hash)).toMatchObject({
      status: "unverified",
      verification: { reason: "source-hash-mismatch" },
    });
  } finally {
    f.cleanup();
  }
});

test("wrong expected hashes and cursors from changed content fail closed", async () => {
  const f = fixture();
  try {
    expect(await readDurableReference(f.directory, f.handle, "wrong")).toMatchObject({
      status: "unverified",
      verification: { reason: "source-hash-mismatch" },
    });
    const first = await new ArtifactResourceProvider({ store: f.store }).read(f.handle, { limit: 2 });
    if (!first?.nextCursor) throw new Error("expected-pagination");
    writeFileSync(f.file, readFileSync(f.file, "utf8").replace("ORIGINAL", "TAMPERED"));
    const reopened = new ArtifactResourceProvider({ store: createFileArtifactResourceStore({ rootDir: f.directory }) });
    await expect(reopened.read(f.handle, { cursor: first.nextCursor, limit: 2 })).rejects.toThrow(/stale/i);
  } finally {
    f.cleanup();
  }
});
