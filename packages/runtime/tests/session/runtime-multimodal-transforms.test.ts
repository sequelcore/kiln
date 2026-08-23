import { describe, expect, it, vi } from "vitest";
import { executeDefaultRuntimeMultimodalTransform } from "../../src/session/runtime-multimodal-transforms.js";
import { createMediaActionTestContext } from "../gateway/media-action-test-fixture.js";
import { createTestFetch } from "../fetch-fixture.js";

describe("executeDefaultRuntimeMultimodalTransform cancellation", () => {
  it("does not download an OCR URL source when the active turn is already cancelled", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = createTestFetch(vi.fn(async (..._args: Parameters<typeof fetch>) => new Response()));
    globalThis.fetch = fetchSpy;
    const abort = new AbortController();
    abort.abort();
    const media = createMediaActionTestContext();

    try {
      await expect(executeDefaultRuntimeMultimodalTransform({
        route: {
          transform: "ocr",
          sourceModalities: ["image"],
          outputModality: "text",
          provenance: "tesseract",
          degradation: "visible text only",
          implementation: "runtime-built-in",
        },
        execution: {
          requestedCapability: "vision",
          sourceArtifacts: [{
            uri: "kiln://artifacts/inbound/image-1/content",
            modality: "image",
            mimeType: "image/png",
            sizeBytes: 0,
            checksum: { algorithm: "sha256", value: "0".repeat(64) },
            source: { kind: "webhook-attachment", id: "image-1" },
            retention: { scope: "session" },
            replay: { uri: "kiln://artifacts/inbound/image-1/content" },
          }],
          sourceParts: [{ type: "image", mimeType: "image/png", url: "https://example.com/image.png" }],
          userParts: [{ type: "image", mimeType: "image/png", url: "https://example.com/image.png" }],
          ...media,
          attemptId: "ocr-attempt",
          callerId: "test:ocr",
          idempotencyKey: "ocr-message",
          abortSignal: abort.signal,
        },
      })).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("forwards in-flight OCR URL cancellation to fetch", async () => {
    const originalFetch = globalThis.fetch;
    const abort = new AbortController();
    const fetchSpy = createTestFetch(vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })));
    globalThis.fetch = fetchSpy;
    const media = createMediaActionTestContext();

    try {
      const execution = executeDefaultRuntimeMultimodalTransform({
        route: {
          transform: "ocr",
          sourceModalities: ["image"],
          outputModality: "text",
          provenance: "tesseract",
          degradation: "visible text only",
          implementation: "runtime-built-in",
        },
        execution: {
          requestedCapability: "vision",
          sourceArtifacts: [{
            uri: "kiln://artifacts/inbound/image-2/content",
            modality: "image",
            mimeType: "image/png",
            sizeBytes: 0,
            checksum: { algorithm: "sha256", value: "1".repeat(64) },
            source: { kind: "webhook-attachment", id: "image-2" },
            retention: { scope: "session" },
            replay: { uri: "kiln://artifacts/inbound/image-2/content" },
          }],
          sourceParts: [{ type: "image", mimeType: "image/png", url: "https://example.com/image.png" }],
          userParts: [{ type: "image", mimeType: "image/png", url: "https://example.com/image.png" }],
          ...media,
          attemptId: "ocr-attempt-2",
          callerId: "test:ocr",
          idempotencyKey: "ocr-message-2",
          abortSignal: abort.signal,
        },
      });

      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
      expect(fetchSpy.mock.calls[0]![1]?.signal).toBe(abort.signal);
      abort.abort();
      await expect(execution).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
