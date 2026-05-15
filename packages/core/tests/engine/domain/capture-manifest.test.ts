import { describe, expect, it } from "vitest";
import {
  RECORDER_CAPTURE_MANIFEST_VERSION,
  RECORDER_CAPTURE_TRACK_KINDS,
  createRecorderCaptureManifest,
  type RecorderCaptureManifestInput,
} from "../../../src/engine/domain/capture-manifest.js";
import {
  RECORDER_CAPTURE_MANIFEST_VERSION as ROOT_RECORDER_CAPTURE_MANIFEST_VERSION,
  createRecorderCaptureManifest as createRootRecorderCaptureManifest,
  engine as rootEngine,
} from "../../../src/index.js";

function completeManifestInput(): RecorderCaptureManifestInput {
  return {
    manifestId: "recorder-manifest-1",
    kilnSessionId: "session-1",
    title: "Checkout QA run",
    createdAt: "2026-05-14T10:00:00.000Z",
    updatedAt: "2026-05-14T10:03:00.000Z",
    status: "captured",
    policy: {
      recordingConsent: "operator-approved",
      retention: { scope: "session", maxArtifacts: 12 },
      redaction: {
        status: "pending",
        sensitive: true,
        evidenceUris: ["kiln://artifacts/recorder-artifacts/redaction-report/content"],
      },
    },
    timeline: {
      timebase: "relative-ms",
      startedAt: "2026-05-14T10:00:00.000Z",
      durationMs: 180000,
    },
    tracks: {
      rawCapture: [{
        id: "raw-browser",
        kind: "raw_capture",
        source: {
          kind: "browser_session",
          sessionId: "browser-session-1",
          target: "browser",
        },
        capture: {
          transport: "browser-native",
          format: "video/webm",
          startedAtOffsetMs: 0,
          durationMs: 180000,
          resource: {
            uri: "kiln://artifacts/recorder-raw/browser-video/content",
            relation: "raw_capture",
            mimeType: "video/webm",
          },
        },
        evidence: [{
          kind: "tool_call",
          id: "browser_session_start:call-1",
        }],
      }],
      events: [{
        id: "agent-events",
        kind: "event",
        eventKinds: ["tool_call_started", "tool_call_completed"],
        startedAtOffsetMs: 0,
        durationMs: 180000,
        resource: {
          uri: "kiln://artifacts/recorder-events/session-events/content",
          relation: "events",
          mimeType: "application/json",
        },
      }],
      artifacts: [{
        id: "browser-screenshots",
        kind: "artifact",
        artifactUris: [
          "kiln://artifacts/tool-results/browser-screenshot-1/content",
        ],
        relation: "source_evidence",
      }],
      edits: [{
        id: "first-pass-edit",
        kind: "edit",
        editKind: "auto_zoom",
        startedAtOffsetMs: 1200,
        durationMs: 1600,
        target: {
          x: 640,
          y: 360,
          width: 240,
          height: 120,
        },
        evidence: [{
          kind: "session_event",
          id: "event-12",
        }],
      }],
      exports: [{
        id: "showcase-webm",
        kind: "export",
        format: "webm",
        aspectRatio: "16:9",
        status: "planned",
        resource: {
          uri: "kiln://artifacts/recorder-exports/showcase-webm/content",
          relation: "export",
          mimeType: "video/webm",
        },
      }],
      replay: [{
        id: "replay-manifest",
        kind: "replay",
        replayKind: "manifest",
        resource: {
          uri: "kiln://artifacts/recorder-replay/replay-manifest/content",
          relation: "replay",
          mimeType: "application/json",
        },
        sourceTrackIds: [
          "raw-browser",
          "agent-events",
          "browser-screenshots",
          "first-pass-edit",
        ],
      }],
    },
  };
}

describe("createRecorderCaptureManifest", () => {
  it("creates a backend-agnostic manifest with all recorder track families", () => {
    const manifest = createRecorderCaptureManifest(completeManifestInput());

    expect(RECORDER_CAPTURE_TRACK_KINDS).toEqual([
      "raw_capture",
      "event",
      "artifact",
      "edit",
      "export",
      "replay",
    ]);
    expect(manifest.version).toBe(RECORDER_CAPTURE_MANIFEST_VERSION);
    expect(manifest.manifestId).toBe("recorder-manifest-1");
    expect(manifest.kilnSessionId).toBe("session-1");
    expect(manifest.status).toBe("captured");
    expect(manifest.tracks.rawCapture.map((track) => track.kind)).toEqual(["raw_capture"]);
    expect(manifest.tracks.events.map((track) => track.kind)).toEqual(["event"]);
    expect(manifest.tracks.artifacts.map((track) => track.kind)).toEqual(["artifact"]);
    expect(manifest.tracks.edits.map((track) => track.kind)).toEqual(["edit"]);
    expect(manifest.tracks.exports.map((track) => track.kind)).toEqual(["export"]);
    expect(manifest.tracks.replay.map((track) => track.kind)).toEqual(["replay"]);
    expect(manifest.tracks.rawCapture[0]!.capture.transport).toBe("browser-native");
    expect(manifest.tracks.rawCapture[0]!.source.kind).toBe("browser_session");
  });

  it("rejects non-resource-plane URIs so local paths do not become replay authority", () => {
    const input = completeManifestInput();

    expect(() => createRecorderCaptureManifest({
      ...input,
      tracks: {
        ...input.tracks,
        rawCapture: [{
          ...input.tracks.rawCapture[0]!,
          capture: {
            ...input.tracks.rawCapture[0]!.capture,
            resource: {
              ...input.tracks.rawCapture[0]!.capture.resource,
              uri: "C:/tmp/raw-browser.webm",
            },
          },
        }],
      },
    })).toThrow("Recorder resource URI must use kiln://");
  });

  it("rejects present but invalid evidence URIs", () => {
    const input = completeManifestInput();

    expect(() => createRecorderCaptureManifest({
      ...input,
      tracks: {
        ...input.tracks,
        rawCapture: [{
          ...input.tracks.rawCapture[0]!,
          evidence: [{
            kind: "tool_call",
            id: "browser_session_start:call-1",
            uri: "",
          }],
        }],
      },
    })).toThrow("Recorder resource URI must use kiln://");
  });

  it("fails closed when a canonical track family is missing", () => {
    const input = completeManifestInput();

    expect(() => createRecorderCaptureManifest({
      ...input,
      tracks: {
        rawCapture: input.tracks.rawCapture,
        events: input.tracks.events,
        artifacts: input.tracks.artifacts,
        edits: input.tracks.edits,
        exports: input.tracks.exports,
      },
    } as never)).toThrow("Recorder manifest tracks.replay is required");
  });

  it("rejects malformed timestamps and duplicate track ids", () => {
    const input = completeManifestInput();

    expect(() => createRecorderCaptureManifest({
      ...input,
      createdAt: "not-a-date",
    })).toThrow("Recorder manifest createdAt must be an ISO timestamp");
    expect(() => createRecorderCaptureManifest({
      ...input,
      tracks: {
        ...input.tracks,
        events: [{
          ...input.tracks.events[0]!,
          id: "raw-browser",
        }],
      },
    })).toThrow("Duplicate recorder track id: raw-browser");
  });

  it("rejects loose timestamps and backend-specific manifest fields", () => {
    const input = completeManifestInput();

    expect(() => createRecorderCaptureManifest({
      ...input,
      createdAt: "2026-05-14",
    })).toThrow("Recorder manifest createdAt must be an ISO timestamp");
    expect(() => createRecorderCaptureManifest({
      ...input,
      nativeBrowserBackend: "playwright",
    } as RecorderCaptureManifestInput)).toThrow(
      "Recorder manifest input contains unknown field: nativeBrowserBackend",
    );
  });

  it("rejects replay source self-references and duplicate source ids", () => {
    const input = completeManifestInput();

    expect(() => createRecorderCaptureManifest({
      ...input,
      tracks: {
        ...input.tracks,
        replay: [{
          ...input.tracks.replay[0]!,
          sourceTrackIds: ["raw-browser", "raw-browser"],
        }],
      },
    })).toThrow("Duplicate recorder replay source track id: raw-browser");
    expect(() => createRecorderCaptureManifest({
      ...input,
      tracks: {
        ...input.tracks,
        replay: [{
          ...input.tracks.replay[0]!,
          sourceTrackIds: ["replay-manifest"],
        }],
      },
    })).toThrow("Recorder replay source track id cannot reference its own replay track: replay-manifest");
  });

  it("validates replay source references independently of replay track order", () => {
    const input = completeManifestInput();
    const manifest = createRecorderCaptureManifest({
      ...input,
      tracks: {
        ...input.tracks,
        replay: [{
          id: "early-replay",
          kind: "replay",
          replayKind: "timeline",
          resource: {
            uri: "kiln://artifacts/recorder-replay/early-replay/content",
            relation: "replay",
            mimeType: "application/json",
          },
          sourceTrackIds: ["late-replay"],
        }, {
          id: "late-replay",
          kind: "replay",
          replayKind: "manifest",
          resource: {
            uri: "kiln://artifacts/recorder-replay/late-replay/content",
            relation: "replay",
            mimeType: "application/json",
          },
          sourceTrackIds: ["raw-browser"],
        }],
      },
    });

    expect(manifest.tracks.replay.map((track) => track.id)).toEqual(["early-replay", "late-replay"]);
  });

  it("is exported from the package root for runtime and surface consumers", () => {
    expect(ROOT_RECORDER_CAPTURE_MANIFEST_VERSION).toBe(RECORDER_CAPTURE_MANIFEST_VERSION);
    expect(createRootRecorderCaptureManifest(completeManifestInput()).version).toBe(
      RECORDER_CAPTURE_MANIFEST_VERSION,
    );
    expect(rootEngine.RECORDER_CAPTURE_MANIFEST_VERSION).toBe(RECORDER_CAPTURE_MANIFEST_VERSION);
    expect(rootEngine.createRecorderCaptureManifest(completeManifestInput()).version).toBe(
      RECORDER_CAPTURE_MANIFEST_VERSION,
    );
  });
});
