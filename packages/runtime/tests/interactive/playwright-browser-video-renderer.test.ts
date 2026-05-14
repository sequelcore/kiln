import { describe, expect, it, vi } from "vitest";
import { MemoryArtifactResourceStore } from "@kilnai/core";
import {
  renderPlaywrightBrowserVideo,
  type BrowserVideoEncoder,
} from "../../src/index.js";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGOQqLjzHx9mGBkKAG2JmsH6QH1FAAAAAElFTkSuQmCC";
const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01]);

describe("renderPlaywrightBrowserVideo", () => {
  it("composes captured browser frames with caption, cursor highlight, and click zoom edits", async () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T13:00:00.000Z" });
    const firstFrameUri = putPngFrame(artifactStore, "first-frame");
    const secondFrameUri = putPngFrame(artifactStore, "second-frame");
    const encode = vi.fn<BrowserVideoEncoder["encode"]>(async (input) => ({
      mimeType: "video/webm",
      content: WEBM_BYTES,
      durationMs: input.durationMs,
    }));
    const encoder: BrowserVideoEncoder = { encode };

    const result = await renderPlaywrightBrowserVideo({
      artifactStore,
      sessionId: "browser-render",
      frames: [{
        sessionId: "browser-render",
        artifactUri: firstFrameUri,
        capturedAt: "2026-05-14T13:00:00.000Z",
        offsetMs: 0,
        operation: "session_start",
        transport: "snapshot-polling",
        width: 1280,
        height: 720,
        url: "https://example.com/start",
        title: "Start",
      }, {
        sessionId: "browser-render",
        artifactUri: secondFrameUri,
        capturedAt: "2026-05-14T13:00:01.000Z",
        offsetMs: 1000,
        operation: "click",
        transport: "snapshot-polling",
        width: 1280,
        height: 720,
        url: "https://example.com/complete",
        title: "Complete",
      }],
      operations: [{
        sessionId: "browser-render",
        toolName: "browser_click",
        operation: "click",
        startedAt: "2026-05-14T13:00:00.500Z",
        completedAt: "2026-05-14T13:00:00.650Z",
        offsetMs: 500,
        durationMs: 150,
        status: "succeeded",
        x: 640,
        y: 360,
        url: "https://example.com/complete",
        title: "Complete",
      }],
      encoder,
      output: {
        width: 640,
        height: 360,
        fps: 4,
      },
    });

    expect(result.mimeType).toBe("video/webm");
    expect(result.content).toEqual(WEBM_BYTES);
    expect(result.captionCount).toBeGreaterThan(0);
    expect(result.cursorHighlightCount).toBe(1);
    expect(result.zoomCount).toBe(1);
    expect(result.editTracks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        editKind: "caption",
        text: expect.stringContaining("browser_click"),
      }),
      expect.objectContaining({
        editKind: "cursor_emphasis",
        target: expect.objectContaining({ x: 640, y: 360 }),
      }),
      expect.objectContaining({
        editKind: "auto_zoom",
        target: expect.objectContaining({ x: 640, y: 360 }),
      }),
    ]));

    expect(encode).toHaveBeenCalledTimes(1);
    const encoderInput = encode.mock.calls[0]![0];
    expect(encoderInput.mimeType).toBe("video/webm");
    expect(encoderInput.width).toBe(640);
    expect(encoderInput.height).toBe(360);
    expect(encoderInput.frames.length).toBeGreaterThan(0);
    expect(encoderInput.frames[0]!.dataUrl).toMatch(/^data:image\/png;base64,/u);
  });

  it("fails closed when a referenced frame artifact is missing", async () => {
    const artifactStore = new MemoryArtifactResourceStore();

    await expect(renderPlaywrightBrowserVideo({
      artifactStore,
      sessionId: "missing-frame",
      frames: [{
        sessionId: "missing-frame",
        artifactUri: "kiln://artifacts/interactive-screenshots/artifact_404/content",
        capturedAt: "2026-05-14T13:00:00.000Z",
        offsetMs: 0,
        transport: "snapshot-polling",
      }],
      operations: [],
      encoder: {
        encode: async () => ({
          mimeType: "video/webm",
          content: WEBM_BYTES,
          durationMs: 1,
        }),
      },
    })).rejects.toThrow("Cannot render browser video because frame artifact is missing");
  });
});

function putPngFrame(artifactStore: MemoryArtifactResourceStore, title: string): string {
  const artifact = artifactStore.put({
    namespace: "interactive-screenshots",
    title,
    mimeType: "image/png",
    content: { type: "blob", blob: PNG_BASE64 },
    producer: { kind: "tool", name: "browser_observe" },
    retention: { scope: "session", maxArtifacts: 50 },
  });
  return `kiln://artifacts/${artifact.namespace}/${artifact.id}/content`;
}
