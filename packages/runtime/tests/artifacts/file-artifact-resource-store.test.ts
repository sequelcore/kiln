import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileArtifactResourceStore } from "../../src/artifacts/file-artifact-resource-store.js";

describe("createFileArtifactResourceStore", () => {
  it("reopens persisted artifacts with stable ids, bytes, and sequence", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "kiln-artifacts-"));
    try {
      const first = createFileArtifactResourceStore({
        rootDir: rootDirectory,
        now: () => "2026-07-02T20:00:00.000Z",
      });
      const artifact = first.put({
        namespace: "benchmark-baselines",
        title: "Usage evidence",
        mimeType: "application/json",
        content: { type: "json", value: { providerRequests: [{ requestIndex: 0 }] } },
        producer: { kind: "eval", name: "benchmark-baseline-runner" },
        retention: { scope: "session" },
      });

      const reopened = createFileArtifactResourceStore({ rootDir: rootDirectory });
      expect(reopened.get("benchmark-baselines", artifact.id)).toMatchObject({
        id: "artifact_1",
        sequence: 1,
        content: { type: "json", value: { providerRequests: [{ requestIndex: 0 }] } },
      });
      expect(reopened.listNamespaces()).toEqual([
        {
          namespace: "benchmark-baselines",
          artifactCount: 1,
          updatedAt: "2026-07-02T20:00:00.000Z",
          sequence: 1,
        },
      ]);

      const next = reopened.put({
        namespace: "benchmark-baselines",
        title: "Route evidence",
        mimeType: "application/json",
        content: { type: "json", value: { provider: "codex-oauth" } },
        producer: { kind: "eval", name: "benchmark-baseline-runner" },
        retention: { scope: "session" },
      });
      expect(next.id).toBe("artifact_2");
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("persists verification retention and protects evidence from later churn", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "kiln-artifacts-verification-"));
    try {
      const first = createFileArtifactResourceStore({ rootDir: rootDirectory, maxArtifactsPerNamespace: 2 });
      const evidence = first.put({
        namespace: "context-evidence",
        title: "Protected evidence",
        mimeType: "application/json",
        content: { type: "json", value: { exact: "evidence" } },
        producer: { kind: "context", name: "reversible-context-projection" },
        retention: { scope: "verification" },
      });

      const reopened = createFileArtifactResourceStore({ rootDir: rootDirectory, maxArtifactsPerNamespace: 2 });
      reopened.put({
        namespace: "context-evidence",
        title: "Transient one",
        mimeType: "text/plain",
        content: { type: "text", text: "one" },
        producer: { kind: "test", name: "unit" },
        retention: { scope: "session", maxArtifacts: 1 },
      });
      reopened.put({
        namespace: "context-evidence",
        title: "Transient two",
        mimeType: "text/plain",
        content: { type: "text", text: "two" },
        producer: { kind: "test", name: "unit" },
        retention: { scope: "session", maxArtifacts: 1 },
      });

      expect(reopened.get("context-evidence", evidence.id)).toMatchObject({
        retention: { scope: "verification" },
        content: { type: "json", value: { exact: "evidence" } },
      });
    } finally {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});
