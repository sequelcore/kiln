import { describe, expect, it } from "vitest";
import {
  createRecorderCaptureManifest,
  MemoryArtifactResourceStore,
  type RecorderCaptureManifest,
} from "@kilnai/core";
import {
  RecorderExternalEditorExporter,
} from "../../src/index.js";

describe("RecorderExternalEditorExporter", () => {
  it("emits governed SRT, VTT, marker JSON, and neutral editor-project artifacts", () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T23:00:05.000Z" });
    const sourceVideoUri = putBlobArtifact(artifactStore, {
      namespace: "recorder-source-media",
      title: "Rendered WebM",
      mimeType: "video/webm",
      blob: "AQIDBA==",
    });
    const voiceoverUri = putBlobArtifact(artifactStore, {
      namespace: "recorder-source-media",
      title: "Voiceover",
      mimeType: "audio/webm",
      blob: "BAUGBw==",
    });
    const manifest = editorReadyManifest({
      sourceVideoUri,
      voiceoverUri,
    });
    const manifestUri = putJsonArtifact(artifactStore, {
      namespace: "recorder-source-media",
      title: "Rendered manifest",
      value: manifest,
    });
    const exporter = new RecorderExternalEditorExporter({
      artifactStore,
      retentionMaxArtifacts: 1,
      now: () => new Date("2026-05-14T23:00:06.000Z"),
    });

    const result = exporter.exportManifest({
      manifest,
      manifestUri,
      completedAt: "2026-05-14T23:00:06.000Z",
    });

    expect(result).toMatchObject({
      sessionId: "editor-session-1",
      sourceManifestId: "editor-manifest-1",
      captionCount: 2,
      markerCount: 5,
      exportTrackCount: 4,
    });
    expect(result.exportTracks.map((track) => track.format)).toEqual([
      "json",
      "srt",
      "vtt",
      "editor-project",
    ]);
    expect(result.exportTracks[0]?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "artifact",
        id: "editor-markers",
        uri: result.markerJsonUri,
      }),
    ]));

    expect(readTextArtifact(artifactStore, result.captionsSrtUri)).toBe([
      "1",
      "00:00:00,000 --> 00:00:01,200",
      "Open settings",
      "",
      "2",
      "00:00:01,500 --> 00:00:02,500",
      "Save changes",
      "",
    ].join("\n"));
    expect(readTextArtifact(artifactStore, result.captionsVttUri)).toBe([
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:01.200",
      "Open settings",
      "",
      "00:00:01.500 --> 00:00:02.500",
      "Save changes",
      "",
    ].join("\n"));

    const markers = readJsonArtifact(artifactStore, result.markerJsonUri) as {
      readonly version: string;
      readonly sourceManifestId: string;
      readonly markers: readonly {
        readonly id: string;
        readonly kind: string;
        readonly label: string;
        readonly startedAtOffsetMs: number;
        readonly durationMs?: number;
        readonly resourceUri?: string;
      }[];
    };
    expect(markers).toMatchObject({
      version: "recorder-editor-markers.v1",
      sourceManifestId: "editor-manifest-1",
    });
    expect(markers.markers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "caption-open",
        kind: "caption",
        label: "Open settings",
        startedAtOffsetMs: 0,
        durationMs: 1200,
      }),
      expect.objectContaining({
        id: "zoom-click",
        kind: "auto_zoom",
        startedAtOffsetMs: 500,
      }),
      expect.objectContaining({
        id: "voiceover-summary",
        kind: "voiceover",
        label: "Narrate the settings check",
        resourceUri: voiceoverUri,
      }),
    ]));

    const project = readJsonArtifact(artifactStore, result.editorProjectUri) as {
      readonly version: string;
      readonly integrationTarget: string;
      readonly sourceManifest: { readonly uri: string };
      readonly sourceMedia: { readonly video: readonly { readonly uri: string }[]; readonly audio: readonly { readonly uri: string }[] };
      readonly sidecars: {
        readonly captions: { readonly srt: string; readonly vtt: string };
        readonly markers: { readonly json: string };
      };
      readonly captions: readonly unknown[];
      readonly markers: readonly unknown[];
    };
    expect(project).toMatchObject({
      version: "recorder-editor-project.v1",
      integrationTarget: "neutral-editor-handoff",
      sourceManifest: { uri: manifestUri },
      sourceMedia: {
        video: [expect.objectContaining({ uri: sourceVideoUri })],
        audio: [expect.objectContaining({ uri: voiceoverUri })],
      },
      sidecars: {
        captions: {
          srt: result.captionsSrtUri,
          vtt: result.captionsVttUri,
        },
        markers: {
          json: result.markerJsonUri,
        },
      },
    });
    expect(project.captions).toHaveLength(2);
    expect(project.markers).toHaveLength(5);
    expect(JSON.stringify(project)).not.toMatch(/premiere|davinci/iu);

    const projectMetadata = readJsonArtifact(artifactStore, result.projectMetadataUri);
    expect(projectMetadata).toMatchObject({
      version: "recorder-editor-project-metadata.v1",
      sourceManifestId: "editor-manifest-1",
      generatedAt: "2026-05-14T23:00:06.000Z",
    });

    for (const uri of [
      result.markerJsonUri,
      result.captionsSrtUri,
      result.captionsVttUri,
      result.editorProjectUri,
      result.projectMetadataUri,
    ]) {
      expect(readArtifact(artifactStore, uri).retention).toEqual({
        scope: "session",
        maxArtifacts: 5,
      });
    }
  });

  it("fails closed without a manifest, marker evidence, or readable source artifacts", () => {
    const artifactStore = new MemoryArtifactResourceStore();
    const exporter = new RecorderExternalEditorExporter({ artifactStore });

    expect(() => exporter.exportManifest({
      manifest: undefined as never,
    })).toThrow("Recorder external editor export manifest is required.");

    expect(() => exporter.exportManifest({
      manifest: emptyManifest(),
    })).toThrow("Cannot export external editor project without captions or markers.");

    expect(() => exporter.exportManifest({
      manifest: editorReadyManifest({
        sourceVideoUri: "kiln://artifacts/missing-source/artifact_1/content",
        voiceoverUri: putBlobArtifact(artifactStore, {
          namespace: "recorder-source-media",
          title: "Voiceover",
          mimeType: "audio/webm",
          blob: "BAUGBw==",
        }),
      }),
    })).toThrow("Recorder external editor export source artifact is missing");
  });
});

function editorReadyManifest(input: {
  readonly sourceVideoUri: string;
  readonly voiceoverUri: string;
}): RecorderCaptureManifest {
  return createRecorderCaptureManifest({
    manifestId: "editor-manifest-1",
    kilnSessionId: "editor-session-1",
    title: "Editor handoff",
    createdAt: "2026-05-14T23:00:00.000Z",
    updatedAt: "2026-05-14T23:00:04.000Z",
    status: "rendered",
    policy: {
      recordingConsent: "operator-approved",
      retention: { scope: "session", maxArtifacts: 10 },
      redaction: { status: "pending", sensitive: true },
    },
    timeline: {
      timebase: "relative-ms",
      startedAt: "2026-05-14T23:00:00.000Z",
      durationMs: 4000,
    },
    tracks: {
      rawCapture: [],
      events: [],
      artifacts: [],
      edits: [{
        id: "caption-open",
        kind: "edit",
        status: "ready",
        editKind: "caption",
        startedAtOffsetMs: 0,
        durationMs: 1200,
        text: "Open settings",
      }, {
        id: "caption-save",
        kind: "edit",
        status: "ready",
        editKind: "caption",
        startedAtOffsetMs: 1500,
        durationMs: 1000,
        text: "Save changes",
      }, {
        id: "zoom-click",
        kind: "edit",
        status: "ready",
        editKind: "auto_zoom",
        startedAtOffsetMs: 500,
        durationMs: 1200,
        target: { x: 640, y: 360, width: 420, height: 240 },
      }, {
        id: "cut-idle",
        kind: "edit",
        status: "ready",
        editKind: "cut",
        startedAtOffsetMs: 2600,
        durationMs: 400,
      }, {
        id: "voiceover-summary",
        kind: "edit",
        status: "ready",
        editKind: "voiceover",
        startedAtOffsetMs: 0,
        durationMs: 900,
        text: "Narrate the settings check",
        resource: {
          uri: input.voiceoverUri,
          relation: "edit",
          mimeType: "audio/webm",
        },
      }],
      exports: [{
        id: "editor-session-1-webm-export",
        kind: "export",
        status: "ready",
        format: "webm",
        aspectRatio: "16:9",
        resource: {
          uri: input.sourceVideoUri,
          relation: "export",
          title: "Rendered WebM",
          mimeType: "video/webm",
        },
      }],
      replay: [],
    },
  });
}

function emptyManifest(): RecorderCaptureManifest {
  return createRecorderCaptureManifest({
    manifestId: "empty-manifest",
    kilnSessionId: "empty-session",
    createdAt: "2026-05-14T23:00:00.000Z",
    updatedAt: "2026-05-14T23:00:00.000Z",
    status: "captured",
    policy: {
      recordingConsent: "operator-approved",
      retention: { scope: "session", maxArtifacts: 10 },
      redaction: { status: "not_required", sensitive: false },
    },
    timeline: {
      timebase: "relative-ms",
      startedAt: "2026-05-14T23:00:00.000Z",
      durationMs: 1,
    },
    tracks: {
      rawCapture: [],
      events: [],
      artifacts: [],
      edits: [],
      exports: [],
      replay: [],
    },
  });
}

function putBlobArtifact(
  artifactStore: MemoryArtifactResourceStore,
  input: {
    readonly namespace: string;
    readonly title: string;
    readonly mimeType: string;
    readonly blob: string;
  },
): string {
  const artifact = artifactStore.put({
    namespace: input.namespace,
    title: input.title,
    mimeType: input.mimeType,
    content: { type: "blob", blob: input.blob },
    producer: { kind: "test", name: "recorder-external-editor-exporter-test" },
    retention: { scope: "session", maxArtifacts: 20 },
  });
  return `kiln://artifacts/${artifact.namespace}/${artifact.id}/content`;
}

function putJsonArtifact(
  artifactStore: MemoryArtifactResourceStore,
  input: {
    readonly namespace: string;
    readonly title: string;
    readonly value: unknown;
  },
): string {
  const artifact = artifactStore.put({
    namespace: input.namespace,
    title: input.title,
    mimeType: "application/json",
    content: { type: "json", value: input.value },
    producer: { kind: "test", name: "recorder-external-editor-exporter-test" },
    retention: { scope: "session", maxArtifacts: 20 },
  });
  return `kiln://artifacts/${artifact.namespace}/${artifact.id}/content`;
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
  const artifact = readArtifact(artifactStore, uri);
  if (artifact.content.type !== "json") {
    throw new Error(`Expected JSON artifact: ${uri}`);
  }
  return artifact.content.value as Record<string, unknown>;
}

function readTextArtifact(artifactStore: MemoryArtifactResourceStore, uri: string): string {
  const artifact = readArtifact(artifactStore, uri);
  if (artifact.content.type !== "text") {
    throw new Error(`Expected text artifact: ${uri}`);
  }
  return artifact.content.text;
}
