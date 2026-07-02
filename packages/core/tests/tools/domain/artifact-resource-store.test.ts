import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactResourceProvider,
  FileArtifactResourceStore,
  MemoryArtifactResourceStore,
  projectMultimodalArtifactResource,
} from "../../../src/tools/infrastructure/artifact-resource-store.js";

describe("FileArtifactResourceStore", () => {
  it("reopens persisted artifacts with stable ids and sequence", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "kiln-artifacts-"));
    try {
      const first = new FileArtifactResourceStore({
        rootDir,
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

      const reopened = new FileArtifactResourceStore({ rootDir });
      expect(reopened.get("benchmark-baselines", artifact.id)).toMatchObject({
        id: "artifact_1",
        sequence: 1,
        content: { type: "json", value: { providerRequests: [{ requestIndex: 0 }] } },
      });
      expect(reopened.listNamespaces()).toEqual([{
        namespace: "benchmark-baselines",
        artifactCount: 1,
        updatedAt: "2026-07-02T20:00:00.000Z",
        sequence: 1,
      }]);

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
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe("MemoryArtifactResourceStore", () => {
  it("stores artifacts with explicit retention, provenance, metadata, and sequence", () => {
    const store = new MemoryArtifactResourceStore({
      now: () => "2026-04-29T18:00:00.000Z",
    });

    const artifact = store.put({
      namespace: "plans",
      title: "Slice 21 Plan",
      mimeType: "application/json",
      content: { type: "json", value: { slice: 21, status: "planned" } },
      producer: { kind: "tool", name: "task_update" },
      retention: { scope: "session", maxArtifacts: 10 },
    });

    expect(artifact).toMatchObject({
      id: "artifact_1",
      namespace: "plans",
      title: "Slice 21 Plan",
      mimeType: "application/json",
      createdAt: "2026-04-29T18:00:00.000Z",
      updatedAt: "2026-04-29T18:00:00.000Z",
      sequence: 1,
      producer: { kind: "tool", name: "task_update" },
      retention: { scope: "session", maxArtifacts: 10 },
      size: expect.any(Number),
    });
    expect(store.listNamespaces()).toEqual([{
      namespace: "plans",
      artifactCount: 1,
      updatedAt: "2026-04-29T18:00:00.000Z",
      sequence: 1,
    }]);
    expect(store.list("plans").map((entry) => entry.id)).toEqual(["artifact_1"]);
  });

  it("requires explicit retention policy and bounds retained artifacts per namespace", () => {
    const store = new MemoryArtifactResourceStore({
      now: (() => {
        let tick = 0;
        return () => `2026-04-29T18:00:0${tick++}.000Z`;
      })(),
    });

    expect(() => store.put({
      namespace: "plans",
      title: "Missing retention",
      mimeType: "text/plain",
      content: { type: "text", text: "no retention" },
      producer: { kind: "test", name: "unit" },
    } as never)).toThrow("Artifact retention policy is required");

    store.put({
      namespace: "plans",
      title: "First",
      mimeType: "text/plain",
      content: { type: "text", text: "first" },
      producer: { kind: "test", name: "unit" },
      retention: { scope: "session", maxArtifacts: 1 },
    });
    const retained = store.put({
      namespace: "plans",
      title: "Second",
      mimeType: "text/plain",
      content: { type: "text", text: "second" },
      producer: { kind: "test", name: "unit" },
      retention: { scope: "session", maxArtifacts: 1 },
    });

    expect(store.get("plans", "artifact_1")).toBeUndefined();
    expect(store.list("plans").map((entry) => entry.id)).toEqual([retained.id]);
  });

  it("rejects invalid namespaces and oversized artifact content", () => {
    const store = new MemoryArtifactResourceStore({
      maxContentBytes: 5,
      now: () => "2026-04-29T18:00:00.000Z",
    });

    expect(() => store.put({
      namespace: "../plans",
      title: "Invalid namespace",
      mimeType: "text/plain",
      content: { type: "text", text: "ok" },
      producer: { kind: "test", name: "unit" },
      retention: { scope: "session" },
    })).toThrow("Invalid artifact namespace");
    expect(() => store.put({
      namespace: "plans",
      title: "Too large",
      mimeType: "text/plain",
      content: { type: "text", text: "too large" },
      producer: { kind: "test", name: "unit" },
      retention: { scope: "session" },
    })).toThrow("Artifact content exceeds configured limit");
  });

  it("stores and projects multimodal artifact metadata with checksum and replay URI", () => {
    const store = new MemoryArtifactResourceStore({
      now: () => "2026-05-13T10:00:00.000Z",
    });
    const blob = Buffer.from("png bytes").toString("base64");

    const metadata = store.put({
      namespace: "tool-results",
      title: "Browser screenshot",
      mimeType: "image/png",
      content: { type: "blob", blob },
      producer: { kind: "tool", name: "browser_observe" },
      retention: { scope: "session", maxArtifacts: 10 },
      multimodal: {
        modality: "screenshot",
        source: { kind: "generated-screenshot", id: "browser_observe:call_1" },
        dimensions: { width: 1280, height: 720 },
      },
    });
    const artifact = store.get("tool-results", metadata.id)!;

    expect(metadata).toMatchObject({
      checksum: {
        algorithm: "sha256",
        value: createHash("sha256").update(Buffer.from(blob, "base64")).digest("hex"),
      },
      multimodal: {
        modality: "screenshot",
        source: { kind: "generated-screenshot", id: "browser_observe:call_1" },
        dimensions: { width: 1280, height: 720 },
      },
    });
    expect(projectMultimodalArtifactResource(artifact)).toEqual({
      uri: `kiln://artifacts/tool-results/${metadata.id}/content`,
      modality: "screenshot",
      mimeType: "image/png",
      sizeBytes: Buffer.byteLength(blob, "base64"),
      checksum: metadata.checksum,
      source: { kind: "generated-screenshot", id: "browser_observe:call_1" },
      retention: { scope: "session", maxArtifacts: 10 },
      replay: { uri: `kiln://artifacts/tool-results/${metadata.id}/content` },
      dimensions: { width: 1280, height: 720 },
    });
  });
});

describe("ArtifactResourceProvider", () => {
  it("lists artifact namespace resources and templates", () => {
    const store = new MemoryArtifactResourceStore({ now: () => "2026-04-29T18:00:00.000Z" });
    store.put({
      namespace: "test-results",
      title: "Core Tests",
      mimeType: "text/plain",
      content: { type: "text", text: "passed" },
      producer: { kind: "tool", name: "bash" },
      retention: { scope: "session" },
    });
    const provider = new ArtifactResourceProvider({ store });

    expect(provider.listResources().map((resource) => resource.uri)).toEqual([
      "kiln://artifacts/test-results",
    ]);
    expect(provider.listTemplates().map((template) => template.uriTemplate)).toEqual([
      "kiln://artifacts/{namespace}",
      "kiln://artifacts/{namespace}/{id}",
      "kiln://artifacts/{namespace}/{id}/content",
    ]);
  });

  it("reads namespace indexes, artifact metadata, and text content", async () => {
    const store = new MemoryArtifactResourceStore({ now: () => "2026-04-29T18:00:00.000Z" });
    const artifact = store.put({
      namespace: "plans",
      title: "Slice Plan",
      mimeType: "text/markdown",
      content: { type: "text", text: "# Plan\n" },
      producer: { kind: "tool", name: "task_update" },
      retention: { scope: "session" },
    });
    const provider = new ArtifactResourceProvider({ store });

    const namespace = await provider.read("kiln://artifacts/plans");
    const metadata = await provider.read(`kiln://artifacts/plans/${artifact.id}`);
    const content = await provider.read(`kiln://artifacts/plans/${artifact.id}/content`);

    expect(namespace!.summary).toEqual({
      kind: "artifacts",
      totalCount: 1,
      counts: {
        artifact: 1,
        json: 0,
        text: 1,
        blob: 0,
      },
      facets: {
        namespaces: ["plans"],
        producerKinds: ["tool"],
        modalities: [],
      },
    });
    expect(JSON.parse(namespace!.contents[0]!.text)).toMatchObject({
      namespace: "plans",
      artifactCount: 1,
      artifacts: [{ id: artifact.id, title: "Slice Plan" }],
    });
    expect(JSON.parse(metadata!.contents[0]!.text)).toMatchObject({
      id: artifact.id,
      namespace: "plans",
      title: "Slice Plan",
      producer: { kind: "tool", name: "task_update" },
    });
    expect(content!.contents[0]).toEqual({
      uri: `kiln://artifacts/plans/${artifact.id}/content`,
      mimeType: "text/markdown",
      text: "# Plan\n",
      _meta: expect.objectContaining({
        id: artifact.id,
        namespace: "plans",
        relation: "content",
      }),
    });
  });

  it("reads JSON and blob artifact content through MCP-compatible content shapes", async () => {
    const store = new MemoryArtifactResourceStore({ now: () => "2026-04-29T18:00:00.000Z" });
    const json = store.put({
      namespace: "tool-results",
      title: "Search Result",
      mimeType: "application/json",
      content: { type: "json", value: { ok: true } },
      producer: { kind: "tool", name: "web_search" },
      retention: { scope: "session" },
    });
    const blob = store.put({
      namespace: "summaries",
      title: "Encoded Summary",
      mimeType: "application/octet-stream",
      content: { type: "blob", blob: Buffer.from("summary").toString("base64") },
      producer: { kind: "tool", name: "read_many" },
      retention: { scope: "session" },
    });
    const provider = new ArtifactResourceProvider({ store });

    await expect(provider.read(`kiln://artifacts/tool-results/${json.id}/content`)).resolves.toEqual({
      contents: [{
        uri: `kiln://artifacts/tool-results/${json.id}/content`,
        mimeType: "application/json",
        text: JSON.stringify({ ok: true }, null, 2),
        _meta: expect.objectContaining({ id: json.id, namespace: "tool-results" }),
      }],
    });
    await expect(provider.read(`kiln://artifacts/summaries/${blob.id}/content`)).resolves.toEqual({
      contents: [{
        uri: `kiln://artifacts/summaries/${blob.id}/content`,
        mimeType: "application/octet-stream",
        blob: Buffer.from("summary").toString("base64"),
        _meta: expect.objectContaining({ id: blob.id, namespace: "summaries" }),
      }],
    });
  });
});
