import { describe, expect, it, vi } from "vitest";
import type { ContentPart } from "@kilnai/core/engine";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import type { MediaDownloader } from "../../src/gateway/audio-preprocessor.js";
import { captureMultimodalArtifacts } from "../../src/gateway/multimodal-artifact-ingestion.js";

function makeDownloader(): MediaDownloader {
  return {
    download: vi.fn().mockResolvedValue({
      data: new Uint8Array([1, 2, 3, 4]),
      mimeType: "application/pdf",
    }),
  };
}

describe("captureMultimodalArtifacts", () => {
  it("persists base64 image parts and attaches replay artifact URIs without changing provider transport", async () => {
    const store = new MemoryArtifactResourceStore({ now: () => "2026-05-13T12:00:00.000Z" });
    const parts: readonly ContentPart[] = [
      { type: "text", text: "Describe this image." },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ];

    const normalized = await captureMultimodalArtifacts(parts, {
      artifactStore: store,
      sourceKind: "uploaded-file",
      sourceIdPrefix: "api:test:user-1",
      producerName: "gateway-api-ingress",
    });

    expect(normalized).toEqual([
      { type: "text", text: "Describe this image." },
      {
        type: "image",
        mimeType: "image/png",
        data: "iVBORw0KGgo=",
        artifactUri: "kiln://artifacts/inbound-multimodal/artifact_1/content",
      },
    ]);
    expect(store.get("inbound-multimodal", "artifact_1")).toMatchObject({
      title: "Inbound image 1",
      mimeType: "image/png",
      content: { type: "blob", blob: "iVBORw0KGgo=" },
      producer: { kind: "gateway", name: "gateway-api-ingress" },
      multimodal: {
        modality: "image",
        source: { kind: "uploaded-file", id: "api:test:user-1:part:1" },
      },
    });
  });

  it("persists URL-backed file parts through the configured downloader and preserves the original URL", async () => {
    const store = new MemoryArtifactResourceStore({ now: () => "2026-05-13T12:00:00.000Z" });
    const downloader = makeDownloader();

    const normalized = await captureMultimodalArtifacts([
      { type: "file", mimeType: "application/pdf", url: "https://cdn.example.com/report.pdf", filename: "report.pdf" },
    ], {
      artifactStore: store,
      downloader,
      sourceKind: "webhook-attachment",
      sourceIdPrefix: "whatsapp:tenant:user-1",
      producerName: "gateway-webhook-ingress",
    });

    expect(normalized).toEqual([{
      type: "file",
      mimeType: "application/pdf",
      url: "https://cdn.example.com/report.pdf",
      filename: "report.pdf",
      artifactUri: "kiln://artifacts/inbound-multimodal/artifact_1/content",
    }]);
    expect(downloader.download).toHaveBeenCalledWith("https://cdn.example.com/report.pdf");
    expect(store.get("inbound-multimodal", "artifact_1")).toMatchObject({
      mimeType: "application/pdf",
      content: { type: "blob", blob: Buffer.from(new Uint8Array([1, 2, 3, 4])).toString("base64") },
      multimodal: {
        modality: "document",
        source: { kind: "webhook-attachment", id: "whatsapp:tenant:user-1:part:0" },
      },
    });
  });

  it("normalizes multimodal tool-result payloads while preserving existing artifact URIs", async () => {
    const store = new MemoryArtifactResourceStore({ now: () => "2026-05-13T12:00:00.000Z" });
    const existingUri = "kiln://artifacts/existing/artifact_9/content";

    const normalized = await captureMultimodalArtifacts([
      {
        type: "tool_result",
        toolUseId: "tool-1",
        content: "Tool produced image evidence.",
        contentParts: [
          { type: "image", mimeType: "image/png", data: "AQID", artifactUri: existingUri },
          { type: "audio", mimeType: "audio/ogg", data: "BAUG" },
        ],
      },
    ], {
      artifactStore: store,
      sourceKind: "tool-output",
      sourceIdPrefix: "tool:result",
      producerName: "runtime-tool-result-ingress",
    });

    expect(normalized).toEqual([{
      type: "tool_result",
      toolUseId: "tool-1",
      content: "Tool produced image evidence.",
      contentParts: [
        { type: "image", mimeType: "image/png", data: "AQID", artifactUri: existingUri },
        {
          type: "audio",
          mimeType: "audio/ogg",
          data: "BAUG",
          artifactUri: "kiln://artifacts/inbound-multimodal/artifact_1/content",
        },
      ],
    }]);
    expect(store.list("inbound-multimodal")).toHaveLength(1);
  });
});
