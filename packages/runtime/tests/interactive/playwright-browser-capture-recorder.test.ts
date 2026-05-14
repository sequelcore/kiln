import { describe, expect, it, vi } from "vitest";
import { MemoryArtifactResourceStore } from "@kilnai/core";
import {
  PlaywrightBrowserCaptureRecorder,
  type PlaywrightBrowserVideoRenderer,
} from "../../src/index.js";

describe("PlaywrightBrowserCaptureRecorder", () => {
  it("creates raw capture, event track, and manifest artifacts from browser frame evidence", () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T10:00:05.000Z" });
    const recorder = new PlaywrightBrowserCaptureRecorder({ artifactStore });
    const firstFrameUri = putFrameArtifact(artifactStore, "frame-1");
    const secondFrameUri = putFrameArtifact(artifactStore, "frame-2");

    recorder.recordBrowserCaptureFrame({
      sessionId: "browser-1",
      capturedAt: "2026-05-14T10:00:01.000Z",
      operation: "session_start",
      transport: "cdp-screencast",
      artifactUri: firstFrameUri,
      url: "https://example.com/start",
      title: "Example",
      width: 1280,
      height: 720,
    });
    recorder.recordBrowserOperation({
      sessionId: "browser-1",
      toolName: "browser_click",
      operation: "click",
      startedAt: "2026-05-14T10:00:01.250Z",
      completedAt: "2026-05-14T10:00:01.400Z",
      action: { type: "click", selector: "#submit" },
      status: "succeeded",
      url: "https://example.com/start",
      title: "Example",
    });
    recorder.recordBrowserCaptureFrame({
      sessionId: "browser-1",
      capturedAt: "2026-05-14T10:00:02.000Z",
      operation: "click",
      transport: "cdp-screencast",
      artifactUri: secondFrameUri,
      url: "https://example.com/complete",
      title: "Complete",
      width: 1280,
      height: 720,
    });

    const proof = recorder.finalizeSession("browser-1", {
      completedAt: "2026-05-14T10:00:03.000Z",
      title: "Browser QA proof",
    });

    const rawEvidence = readJsonArtifact(artifactStore, proof.rawCaptureEvidenceUri);
    expect(rawEvidence).toMatchObject({
      version: "playwright-browser-raw-capture.v1",
      sessionId: "browser-1",
      startedAt: "2026-05-14T10:00:01.000Z",
      completedAt: "2026-05-14T10:00:03.000Z",
      frames: [{
        artifactUri: firstFrameUri,
        capturedAt: "2026-05-14T10:00:01.000Z",
        offsetMs: 0,
        operation: "session_start",
        transport: "cdp-screencast",
        width: 1280,
        height: 720,
      }, {
        artifactUri: secondFrameUri,
        capturedAt: "2026-05-14T10:00:02.000Z",
        offsetMs: 1000,
        operation: "click",
        transport: "cdp-screencast",
      }],
    });

    const eventTrack = readJsonArtifact(artifactStore, proof.eventTrackUri);
    expect(eventTrack).toMatchObject({
      version: "playwright-browser-event-track.v1",
      sessionId: "browser-1",
      events: [{
        toolName: "browser_click",
        operation: "click",
        startedAt: "2026-05-14T10:00:01.250Z",
        completedAt: "2026-05-14T10:00:01.400Z",
        offsetMs: 250,
        durationMs: 150,
        selector: "#submit",
        status: "succeeded",
      }],
    });

    const manifestArtifact = readJsonArtifact(artifactStore, proof.manifestUri);
    expect(manifestArtifact).toMatchObject({
      manifestId: "browser-1-recorder-manifest",
      kilnSessionId: "browser-1",
      status: "captured",
      timeline: {
        startedAt: "2026-05-14T10:00:01.000Z",
        durationMs: 2000,
      },
      tracks: {
        rawCapture: [{
          id: "browser-1-raw-capture",
          source: {
            kind: "browser_session",
            target: "browser",
            sessionId: "browser-1",
            url: "https://example.com/complete",
          },
          capture: {
            transport: "frame-stream",
            format: "application/vnd.kiln.playwright.frame-stream+json",
            resource: {
              uri: proof.rawCaptureEvidenceUri,
              relation: "raw_capture",
              mimeType: "application/json",
            },
          },
        }],
        events: [{
          id: "browser-1-browser-events",
          eventKinds: ["browser_click"],
          resource: {
            uri: proof.eventTrackUri,
            relation: "events",
            mimeType: "application/json",
          },
        }],
        artifacts: [{
          id: "browser-1-browser-frame-artifacts",
          artifactUris: [firstFrameUri, secondFrameUri],
          relation: "source_evidence",
        }],
      },
    });
  });

  it("records snapshot-polling transport distinctly from CDP screencast", () => {
    const artifactStore = new MemoryArtifactResourceStore();
    const recorder = new PlaywrightBrowserCaptureRecorder({ artifactStore });
    const frameUri = putFrameArtifact(artifactStore, "snapshot-frame");

    recorder.recordBrowserCaptureFrame({
      sessionId: "browser-snapshot",
      capturedAt: "2026-05-14T11:00:00.000Z",
      operation: "observe",
      transport: "snapshot-polling",
      artifactUri: frameUri,
      url: "https://example.com",
    });

    const proof = recorder.finalizeSession("browser-snapshot", {
      completedAt: "2026-05-14T11:00:00.500Z",
    });
    const rawEvidence = readJsonArtifact(artifactStore, proof.rawCaptureEvidenceUri);

    expect(rawEvidence.frames).toEqual([
      expect.objectContaining({
        transport: "snapshot-polling",
        offsetMs: 0,
      }),
    ]);
  });

  it("renders a captured browser session into a WebM export artifact and manifest edit tracks", async () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T14:00:05.000Z" });
    const videoBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01]);
    const render = vi.fn<PlaywrightBrowserVideoRenderer["render"]>(async () => ({
      format: "webm",
      mimeType: "video/webm",
      content: videoBytes,
      durationMs: 1500,
      width: 1280,
      height: 720,
      renderedFrameCount: 4,
      captionCount: 1,
      cursorHighlightCount: 1,
      zoomCount: 1,
      editTracks: [{
        id: "browser-render-caption-1",
        kind: "edit",
        status: "ready",
        editKind: "caption",
        startedAtOffsetMs: 0,
        durationMs: 1200,
        text: "browser_click Complete",
      }, {
        id: "browser-render-cursor-1",
        kind: "edit",
        status: "ready",
        editKind: "cursor_emphasis",
        startedAtOffsetMs: 500,
        durationMs: 500,
        target: { x: 640, y: 360, width: 96, height: 96 },
      }, {
        id: "browser-render-zoom-1",
        kind: "edit",
        status: "ready",
        editKind: "auto_zoom",
        startedAtOffsetMs: 500,
        durationMs: 1200,
        target: { x: 640, y: 360, width: 384, height: 216 },
      }],
    }));
    const recorder = new PlaywrightBrowserCaptureRecorder({
      artifactStore,
      videoRenderer: { render },
    });
    const firstFrameUri = putFrameArtifact(artifactStore, "render-frame-1");
    const secondFrameUri = putFrameArtifact(artifactStore, "render-frame-2");

    recorder.recordBrowserCaptureFrame({
      sessionId: "browser-render",
      capturedAt: "2026-05-14T14:00:00.000Z",
      operation: "session_start",
      transport: "snapshot-polling",
      artifactUri: firstFrameUri,
      url: "https://example.com/start",
      title: "Start",
      width: 1280,
      height: 720,
    });
    recorder.recordBrowserOperation({
      sessionId: "browser-render",
      toolName: "browser_click",
      operation: "click",
      startedAt: "2026-05-14T14:00:00.500Z",
      completedAt: "2026-05-14T14:00:00.650Z",
      action: { type: "click", x: 640, y: 360 },
      status: "succeeded",
      url: "https://example.com/complete",
      title: "Complete",
    });
    recorder.recordBrowserCaptureFrame({
      sessionId: "browser-render",
      capturedAt: "2026-05-14T14:00:01.000Z",
      operation: "click",
      transport: "snapshot-polling",
      artifactUri: secondFrameUri,
      url: "https://example.com/complete",
      title: "Complete",
      width: 1280,
      height: 720,
    });

    const captureProof = recorder.finalizeSession("browser-render", {
      completedAt: "2026-05-14T14:00:01.500Z",
      title: "Browser render proof",
    });
    const renderProof = await recorder.renderBasicVideo("browser-render", {
      completedAt: "2026-05-14T14:00:01.500Z",
      title: "Browser render proof",
    });
    const secondRenderProof = await recorder.renderBasicVideo("browser-render", {
      completedAt: "2026-05-14T14:00:01.500Z",
      title: "Browser render proof",
    });

    expect(renderProof).toMatchObject({
      sessionId: "browser-render",
      format: "webm",
      mimeType: "video/webm",
      captionCount: 1,
      cursorHighlightCount: 1,
      zoomCount: 1,
      editTrackCount: 3,
    });
    expect(renderProof.manifestUri).not.toBe(captureProof.manifestUri);
    expect(secondRenderProof).toEqual(renderProof);
    expect(render).toHaveBeenCalledTimes(1);

    const exportArtifact = readArtifact(artifactStore, renderProof.exportUri);
    expect(exportArtifact).toMatchObject({
      title: "Browser video export: browser-render",
      mimeType: "video/webm",
      content: {
        type: "blob",
        blob: Buffer.from(videoBytes).toString("base64"),
      },
    });

    const manifest = readJsonArtifact(artifactStore, renderProof.manifestUri) as {
      readonly status: string;
      readonly tracks: {
        readonly rawCapture: readonly unknown[];
        readonly events: readonly unknown[];
        readonly artifacts: readonly unknown[];
        readonly edits: readonly { readonly editKind: string }[];
        readonly exports: readonly { readonly format: string; readonly resource: { readonly uri: string; readonly mimeType: string } }[];
      };
    };
    expect(manifest.status).toBe("rendered");
    expect(manifest.tracks.rawCapture.length).toBe(1);
    expect(manifest.tracks.events.length).toBe(1);
    expect(manifest.tracks.artifacts.length).toBe(1);
    expect(manifest.tracks.edits.map((track) => track.editKind)).toEqual([
      "caption",
      "cursor_emphasis",
      "auto_zoom",
    ]);
    expect(manifest.tracks.exports).toEqual([
      expect.objectContaining({
        format: "webm",
        resource: expect.objectContaining({
          uri: renderProof.exportUri,
          mimeType: "video/webm",
        }),
      }),
    ]);
  });

  it("keeps rendered proof artifacts readable when recorder retention is below the proof footprint", async () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T15:00:05.000Z" });
    const videoBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    const render = vi.fn<PlaywrightBrowserVideoRenderer["render"]>(async () => ({
      format: "webm",
      mimeType: "video/webm",
      content: videoBytes,
      durationMs: 1000,
      width: 1280,
      height: 720,
      renderedFrameCount: 2,
      captionCount: 1,
      cursorHighlightCount: 1,
      zoomCount: 1,
      editTracks: [{
        id: "browser-low-retention-caption-1",
        kind: "edit",
        status: "ready",
        editKind: "caption",
        startedAtOffsetMs: 0,
        durationMs: 1000,
        text: "browser_click Complete",
      }],
    }));
    const recorder = new PlaywrightBrowserCaptureRecorder({
      artifactStore,
      retentionMaxArtifacts: 1,
      videoRenderer: { render },
    });
    const frameUri = putFrameArtifact(artifactStore, "low-retention-frame");

    recorder.recordBrowserCaptureFrame({
      sessionId: "browser-low-retention",
      capturedAt: "2026-05-14T15:00:00.000Z",
      operation: "session_start",
      transport: "snapshot-polling",
      artifactUri: frameUri,
      url: "https://example.com/start",
      width: 1280,
      height: 720,
    });
    recorder.recordBrowserOperation({
      sessionId: "browser-low-retention",
      toolName: "browser_click",
      operation: "click",
      startedAt: "2026-05-14T15:00:00.500Z",
      completedAt: "2026-05-14T15:00:00.650Z",
      action: { type: "click", x: 640, y: 360 },
      status: "succeeded",
      url: "https://example.com/complete",
      title: "Complete",
    });

    const captureProof = recorder.finalizeSession("browser-low-retention", {
      completedAt: "2026-05-14T15:00:01.000Z",
      title: "Low retention browser proof",
    });
    const renderProof = await recorder.renderBasicVideo("browser-low-retention", {
      completedAt: "2026-05-14T15:00:01.000Z",
      title: "Low retention browser proof",
    });

    const manifest = readJsonArtifact(artifactStore, renderProof.manifestUri) as {
      readonly tracks: {
        readonly rawCapture: readonly [{
          readonly capture: { readonly resource: { readonly uri: string } };
        }];
        readonly events: readonly [{
          readonly resource: { readonly uri: string };
        }];
        readonly exports: readonly [{
          readonly resource: { readonly uri: string };
        }];
      };
    };

    expect(readArtifact(artifactStore, captureProof.manifestUri).mimeType).toBe("application/json");
    expect(readArtifact(artifactStore, captureProof.rawCaptureEvidenceUri).mimeType).toBe("application/json");
    expect(readArtifact(artifactStore, captureProof.eventTrackUri).mimeType).toBe("application/json");
    expect(readArtifact(artifactStore, manifest.tracks.rawCapture[0]!.capture.resource.uri).mimeType)
      .toBe("application/json");
    expect(readArtifact(artifactStore, manifest.tracks.events[0]!.resource.uri).mimeType).toBe("application/json");
    expect(readArtifact(artifactStore, manifest.tracks.exports[0]!.resource.uri).mimeType).toBe("video/webm");
    expect(readArtifact(artifactStore, renderProof.exportUri).content).toEqual({
      type: "blob",
      blob: Buffer.from(videoBytes).toString("base64"),
    });
  });

  it("keeps rendered proof artifacts readable across namespace stress and retention churn", async () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T16:00:05.000Z" });
    const render = vi.fn<PlaywrightBrowserVideoRenderer["render"]>(async ({ sessionId }) => ({
      format: "webm",
      mimeType: "video/webm",
      content: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, sessionId.length % 256]),
      durationMs: 1000,
      width: 1280,
      height: 720,
      renderedFrameCount: 2,
      captionCount: 1,
      cursorHighlightCount: 1,
      zoomCount: 1,
      editTracks: [{
        id: `${sessionId}-caption-1`,
        kind: "edit",
        status: "ready",
        editKind: "caption",
        startedAtOffsetMs: 0,
        durationMs: 1000,
        text: "browser_click Complete",
      }],
    }));
    const recorder = new PlaywrightBrowserCaptureRecorder({
      artifactStore,
      retentionMaxArtifacts: 1,
      videoRenderer: { render },
    });

    const sessionIds = namespaceStressSessionIds();
    expect(new Set(sessionIds).size).toBe(sessionIds.length);

    const proofs = [];
    const firstStartedAt = Date.parse("2026-05-14T16:00:00.000Z");
    for (const [index, sessionId] of sessionIds.entries()) {
      const startedAt = new Date(firstStartedAt + index * 60_000).toISOString();
      const captureProof = recordRenderableSession({
        artifactStore,
        recorder,
        sessionId,
        startedAt,
      });
      const renderProof = await recorder.renderBasicVideo(sessionId, {
        completedAt: new Date(Date.parse(startedAt) + 1000).toISOString(),
        title: `Durable browser proof stress ${index}`,
      });
      const proofNamespaces = proofArtifactUris(captureProof, renderProof).map(artifactNamespace);
      expect(new Set(proofNamespaces).size).toBe(1);
      expectValidRecorderNamespace(proofNamespaces[0]!);
      proofs.push({ captureProof, renderProof });
    }

    const namespaces = proofs.map(({ renderProof }) => artifactNamespace(renderProof.manifestUri));
    expect(new Set(namespaces).size).toBe(sessionIds.length);
    expect(namespaces).toEqual(expect.arrayContaining([
      expect.stringMatching(/^recorder-browser-capture-[a-f0-9]{12}$/u),
      expect.stringMatching(/^recorder-browser-capture-same-hint-[a-f0-9]{12}$/u),
    ]));

    for (const { captureProof, renderProof } of proofs) {
      const renderedManifest = readRenderedManifest(artifactStore, renderProof.manifestUri);
      expect(readArtifact(artifactStore, captureProof.manifestUri).mimeType).toBe("application/json");
      expect(readArtifact(artifactStore, captureProof.rawCaptureEvidenceUri).mimeType).toBe("application/json");
      expect(readArtifact(artifactStore, captureProof.eventTrackUri).mimeType).toBe("application/json");
      expect(readArtifact(artifactStore, renderedManifest.tracks.rawCapture[0]!.capture.resource.uri).mimeType)
        .toBe("application/json");
      expect(readArtifact(artifactStore, renderedManifest.tracks.events[0]!.resource.uri).mimeType)
        .toBe("application/json");
      expect(readArtifact(artifactStore, renderedManifest.tracks.exports[0]!.resource.uri).mimeType)
        .toBe("video/webm");
      expect(readArtifact(artifactStore, renderProof.exportUri).mimeType).toBe("video/webm");
    }
    expect(render).toHaveBeenCalledTimes(sessionIds.length);
  });

  it("exports rendered browser sessions as external editor sidecars and an exported manifest", async () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T20:00:05.000Z" });
    const render = vi.fn<PlaywrightBrowserVideoRenderer["render"]>(async () => ({
      format: "webm",
      mimeType: "video/webm",
      content: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      durationMs: 1800,
      width: 1280,
      height: 720,
      renderedFrameCount: 3,
      captionCount: 1,
      cursorHighlightCount: 1,
      zoomCount: 1,
      editTracks: [{
        id: "browser-editor-caption-1",
        kind: "edit",
        status: "ready",
        editKind: "caption",
        startedAtOffsetMs: 0,
        durationMs: 1200,
        text: "browser_click Complete",
      }, {
        id: "browser-editor-zoom-1",
        kind: "edit",
        status: "ready",
        editKind: "auto_zoom",
        startedAtOffsetMs: 500,
        durationMs: 1200,
        target: { x: 640, y: 360, width: 420, height: 240 },
      }, {
        id: "browser-editor-cut-1",
        kind: "edit",
        status: "ready",
        editKind: "cut",
        startedAtOffsetMs: 1400,
        durationMs: 300,
      }],
    }));
    const recorder = new PlaywrightBrowserCaptureRecorder({
      artifactStore,
      retentionMaxArtifacts: 1,
      videoRenderer: { render },
    });
    const frameUri = putFrameArtifact(artifactStore, "editor-export-frame");

    recorder.recordBrowserCaptureFrame({
      sessionId: "browser-editor",
      capturedAt: "2026-05-14T20:00:00.000Z",
      operation: "session_start",
      transport: "snapshot-polling",
      artifactUri: frameUri,
      url: "https://example.com/start",
      width: 1280,
      height: 720,
    });
    recorder.recordBrowserOperation({
      sessionId: "browser-editor",
      toolName: "browser_click",
      operation: "click",
      startedAt: "2026-05-14T20:00:00.500Z",
      completedAt: "2026-05-14T20:00:00.650Z",
      action: { type: "click", x: 640, y: 360 },
      status: "succeeded",
      url: "https://example.com/complete",
      title: "Complete",
    });

    const renderProof = await recorder.renderBasicVideo("browser-editor", {
      completedAt: "2026-05-14T20:00:02.000Z",
      title: "Browser editor proof",
    });
    const editorProof = recorder.exportExternalEditorProject("browser-editor", {
      completedAt: "2026-05-14T20:00:03.000Z",
      title: "Browser editor export",
    });
    const secondEditorProof = recorder.exportExternalEditorProject("browser-editor", {
      completedAt: "2026-05-14T20:00:03.000Z",
      title: "Browser editor export",
    });

    expect(secondEditorProof).toEqual(editorProof);
    expect(editorProof).toMatchObject({
      sessionId: "browser-editor",
      sourceManifestId: "browser-editor-recorder-manifest",
      captionCount: 1,
      markerCount: 4,
      exportTrackCount: 4,
    });
    expect(editorProof.manifestUri).not.toBe(renderProof.manifestUri);

    const exportedManifest = readJsonArtifact(artifactStore, editorProof.manifestUri) as {
      readonly status: string;
      readonly tracks: {
        readonly rawCapture: readonly unknown[];
        readonly events: readonly unknown[];
        readonly artifacts: readonly unknown[];
        readonly edits: readonly { readonly editKind: string }[];
        readonly exports: readonly {
          readonly id: string;
          readonly format: string;
          readonly resource: { readonly uri: string };
          readonly evidence?: readonly { readonly kind: string; readonly id: string; readonly uri?: string }[];
        }[];
      };
    };
    expect(exportedManifest.status).toBe("exported");
    expect(exportedManifest.tracks.rawCapture.length).toBe(1);
    expect(exportedManifest.tracks.events.length).toBe(1);
    expect(exportedManifest.tracks.artifacts.length).toBe(1);
    expect(exportedManifest.tracks.edits.map((track) => track.editKind)).toEqual([
      "caption",
      "auto_zoom",
      "cut",
    ]);
    expect(exportedManifest.tracks.exports.map((track) => track.format)).toEqual([
      "webm",
      "json",
      "srt",
      "vtt",
      "editor-project",
    ]);
    expect(exportedManifest.tracks.exports.map((track) => track.resource.uri)).toEqual([
      renderProof.exportUri,
      editorProof.projectMetadataUri,
      editorProof.captionsSrtUri,
      editorProof.captionsVttUri,
      editorProof.editorProjectUri,
    ]);
    expect(exportedManifest.tracks.exports.find((track) => track.format === "json")?.evidence)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "artifact",
          id: "editor-markers",
          uri: editorProof.markerJsonUri,
        }),
      ]));

    const editorProject = readJsonArtifact(artifactStore, editorProof.editorProjectUri) as {
      readonly sourceMedia: { readonly video: readonly { readonly uri: string }[] };
      readonly sidecars: { readonly captions: { readonly srt: string; readonly vtt: string } };
    };
    expect(editorProject.sourceMedia.video).toEqual([
      expect.objectContaining({ uri: renderProof.exportUri }),
    ]);
    expect(editorProject.sidecars.captions).toEqual({
      srt: editorProof.captionsSrtUri,
      vtt: editorProof.captionsVttUri,
    });

    expect(readArtifact(artifactStore, renderProof.manifestUri).mimeType).toBe("application/json");
    expect(readArtifact(artifactStore, renderProof.exportUri).mimeType).toBe("video/webm");
    expect(readArtifact(artifactStore, editorProof.markerJsonUri).mimeType).toBe("application/json");
    expect(readArtifact(artifactStore, editorProof.captionsSrtUri).mimeType).toBe("application/x-subrip");
    expect(readArtifact(artifactStore, editorProof.captionsVttUri).mimeType).toBe("text/vtt");
    expect(readArtifact(artifactStore, editorProof.editorProjectUri).mimeType)
      .toBe("application/vnd.kiln.recorder.editor-project+json");
    expect(readArtifact(artifactStore, editorProof.manifestUri).mimeType).toBe("application/json");
  });

  it("fails closed when finalizing without captured frame artifacts", () => {
    const artifactStore = new MemoryArtifactResourceStore();
    const recorder = new PlaywrightBrowserCaptureRecorder({ artifactStore });

    recorder.recordBrowserOperation({
      sessionId: "browser-empty",
      toolName: "browser_navigate",
      operation: "navigate",
      startedAt: "2026-05-14T12:00:00.000Z",
      completedAt: "2026-05-14T12:00:00.100Z",
      status: "succeeded",
    });

    expect(() => recorder.finalizeSession("browser-empty", {
      completedAt: "2026-05-14T12:00:01.000Z",
    })).toThrow("Cannot finalize Playwright browser capture proof without raw capture frames.");
  });
});

function recordRenderableSession(input: {
  readonly artifactStore: MemoryArtifactResourceStore;
  readonly recorder: PlaywrightBrowserCaptureRecorder;
  readonly sessionId: string;
  readonly startedAt: string;
}) {
  const startedAtMs = Date.parse(input.startedAt);
  const frameUri = putFrameArtifact(input.artifactStore, `${input.sessionId}-frame`);

  input.recorder.recordBrowserCaptureFrame({
    sessionId: input.sessionId,
    capturedAt: input.startedAt,
    operation: "session_start",
    transport: "snapshot-polling",
    artifactUri: frameUri,
    url: `https://example.com/${encodeURIComponent(input.sessionId)}`,
    width: 1280,
    height: 720,
  });
  input.recorder.recordBrowserOperation({
    sessionId: input.sessionId,
    toolName: "browser_click",
    operation: "click",
    startedAt: new Date(startedAtMs + 500).toISOString(),
    completedAt: new Date(startedAtMs + 650).toISOString(),
    action: { type: "click", x: 640, y: 360 },
    status: "succeeded",
    url: `https://example.com/${encodeURIComponent(input.sessionId)}/complete`,
    title: "Complete",
  });

  return input.recorder.finalizeSession(input.sessionId, {
    completedAt: new Date(startedAtMs + 1000).toISOString(),
    title: `Durable browser proof ${input.sessionId}`,
  });
}

function namespaceStressSessionIds(): readonly string[] {
  return [
    "////",
    "****",
    "影像🚀",
    "   ???   ",
    "same hint",
    "same-hint",
    "same_hint",
    "Same Hint!!!",
    "A".repeat(256),
    `${"a".repeat(23)}!!!${"b".repeat(80)}`,
    `${"z".repeat(24)}!!!`,
    "Leading and Trailing ---",
    ...Array.from({ length: 48 }, (_, index) => (
      `Browser Durable Churn Session ${index} WITH SPACES AND SYMBOLS !!! ${"x".repeat(80)}`
    )),
    ...Array.from({ length: 24 }, (_, index) => (
      `${"/".repeat((index % 5) + 1)} namespace stress ${index} ${"Y".repeat(index + 1)} ${"🚀".repeat(index % 3)}`
    )),
  ];
}

function proofArtifactUris(
  captureProof: ReturnType<PlaywrightBrowserCaptureRecorder["finalizeSession"]>,
  renderProof: Awaited<ReturnType<PlaywrightBrowserCaptureRecorder["renderBasicVideo"]>>,
): readonly string[] {
  return [
    captureProof.rawCaptureEvidenceUri,
    captureProof.eventTrackUri,
    captureProof.manifestUri,
    renderProof.exportUri,
    renderProof.manifestUri,
  ];
}

function expectValidRecorderNamespace(namespace: string): void {
  expect(namespace).toMatch(/^recorder-browser-capture-[a-z0-9-]+$/u);
  expect(namespace).toMatch(/[a-f0-9]{12}$/u);
  expect(namespace.length).toBeLessThanOrEqual(64);
  expect(namespace).not.toContain("--");
}

function putFrameArtifact(artifactStore: MemoryArtifactResourceStore, title: string): string {
  const artifact = artifactStore.put({
    namespace: "interactive-screenshots",
    title,
    mimeType: "image/png",
    content: { type: "blob", blob: "AQID" },
    producer: { kind: "tool", name: "browser_observe" },
    retention: { scope: "session", maxArtifacts: 50 },
  });
  return `kiln://artifacts/${artifact.namespace}/${artifact.id}/content`;
}

function artifactNamespace(uri: string): string {
  const match = /^kiln:\/\/artifacts\/([^/]+)\/([^/]+)\/content$/u.exec(uri);
  if (!match) {
    throw new Error(`Unexpected artifact URI: ${uri}`);
  }
  return match[1]!;
}

function readRenderedManifest(artifactStore: MemoryArtifactResourceStore, uri: string) {
  return readJsonArtifact(artifactStore, uri) as {
    readonly tracks: {
      readonly rawCapture: readonly [{
        readonly capture: { readonly resource: { readonly uri: string } };
      }];
      readonly events: readonly [{
        readonly resource: { readonly uri: string };
      }];
      readonly exports: readonly [{
        readonly resource: { readonly uri: string };
      }];
    };
  };
}

function readArtifact(artifactStore: MemoryArtifactResourceStore, uri: string) {
  const match = /^kiln:\/\/artifacts\/([^/]+)\/([^/]+)\/content$/u.exec(uri);
  if (!match) {
    throw new Error(`Unexpected artifact URI: ${uri}`);
  }
  const artifact = artifactStore.get(match[1]!, match[2]!);
  if (!artifact) {
    throw new Error(`Missing artifact: ${uri}`);
  }
  return artifact;
}

function readJsonArtifact(artifactStore: MemoryArtifactResourceStore, uri: string): Record<string, unknown> {
  const match = /^kiln:\/\/artifacts\/([^/]+)\/([^/]+)\/content$/u.exec(uri);
  if (!match) {
    throw new Error(`Unexpected artifact URI: ${uri}`);
  }
  const artifact = artifactStore.get(match[1]!, match[2]!);
  if (!artifact || artifact.content.type !== "json") {
    throw new Error(`Expected JSON artifact: ${uri}`);
  }
  return artifact.content.value as Record<string, unknown>;
}
