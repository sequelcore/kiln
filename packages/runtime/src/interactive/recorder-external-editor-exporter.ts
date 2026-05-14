import type {
  ArtifactResourceMetadata,
  ArtifactResourceStore,
  RecorderCaptureManifest,
  RecorderEditTrack,
  RecorderEventTrack,
  RecorderExportFormat,
  RecorderExportTrack,
  RecorderResourceReference,
  RecorderViewportRegion,
} from "@kilnai/core";
import {
  artifactContentUri,
  createRecorderArtifactNamespace,
  normalizeRecorderRetentionMaxArtifacts,
  normalizeRecorderTimestamp,
  parseArtifactContentUri,
  uniqueRecorderStrings,
} from "./recorder-artifact-helpers.js";

const EDITOR_EXPORT_NAMESPACE_PREFIX = "recorder-editor-export";
const DEFAULT_RETENTION_MAX_ARTIFACTS = 50;
const MIN_EDITOR_EXPORT_ARTIFACTS = 5;
const RECORDER_LABEL = "Recorder external editor export";
const MARKERS_VERSION = "recorder-editor-markers.v1";
const PROJECT_VERSION = "recorder-editor-project.v1";
const PROJECT_METADATA_VERSION = "recorder-editor-project-metadata.v1";
const EDITOR_PROJECT_MIME_TYPE = "application/vnd.kiln.recorder.editor-project+json";

export interface RecorderExternalEditorExporterOptions {
  readonly artifactStore: ArtifactResourceStore;
  readonly now?: () => Date;
  readonly retentionMaxArtifacts?: number;
}

export interface RecorderExternalEditorExportInput {
  readonly manifest: RecorderCaptureManifest;
  readonly manifestUri?: string;
  readonly completedAt?: Date | string;
  readonly title?: string;
}

export interface RecorderExternalEditorExportResult {
  readonly sessionId: string;
  readonly sourceManifestId: string;
  readonly sourceManifestUri?: string;
  readonly markerJsonUri: string;
  readonly captionsSrtUri: string;
  readonly captionsVttUri: string;
  readonly editorProjectUri: string;
  readonly projectMetadataUri: string;
  readonly exportTracks: readonly RecorderExportTrack[];
  readonly captionCount: number;
  readonly markerCount: number;
  readonly exportTrackCount: number;
  readonly generatedAt: string;
}

interface EditorCaptionCue {
  readonly id: string;
  readonly index: number;
  readonly text: string;
  readonly startedAtOffsetMs: number;
  readonly durationMs: number;
  readonly startTimecode: string;
  readonly endTimecode: string;
}

interface EditorMarker {
  readonly id: string;
  readonly sourceTrackKind: "edit" | "event";
  readonly kind: string;
  readonly label: string;
  readonly startedAtOffsetMs: number;
  readonly durationMs?: number;
  readonly target?: RecorderViewportRegion;
  readonly text?: string;
  readonly resourceUri?: string;
  readonly evidenceUris?: readonly string[];
}

interface SourceMediaReference {
  readonly id: string;
  readonly format?: string;
  readonly uri: string;
  readonly title?: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
}

export class RecorderExternalEditorExporter {
  private readonly artifactStore: ArtifactResourceStore;
  private readonly now: () => Date;
  private readonly retentionMaxArtifacts: number;

  constructor(options: RecorderExternalEditorExporterOptions) {
    this.artifactStore = options.artifactStore;
    this.now = options.now ?? (() => new Date());
    this.retentionMaxArtifacts = normalizeRecorderRetentionMaxArtifacts({
      value: options.retentionMaxArtifacts,
      defaultValue: DEFAULT_RETENTION_MAX_ARTIFACTS,
      minimumValue: MIN_EDITOR_EXPORT_ARTIFACTS,
      label: RECORDER_LABEL,
    });
  }

  exportManifest(input: RecorderExternalEditorExportInput): RecorderExternalEditorExportResult {
    if (!input?.manifest) {
      throw new Error("Recorder external editor export manifest is required.");
    }

    const manifest = input.manifest;
    const generatedAt = normalizeRecorderTimestamp(input.completedAt ?? this.now(), RECORDER_LABEL);
    const captions = createCaptionCues(manifest.tracks.edits);
    const markers = createMarkers(manifest);
    if (captions.length === 0 && markers.length === 0) {
      throw new Error("Cannot export external editor project without captions or markers.");
    }

    const sourceMedia = createSourceMedia(manifest);
    if (sourceMedia.video.length === 0) {
      throw new Error("Recorder external editor export source artifact is missing: no rendered video export.");
    }
    this.assertSourceArtifactsReadable(manifest, input.manifestUri);

    const namespace = createRecorderArtifactNamespace(EDITOR_EXPORT_NAMESPACE_PREFIX, manifest.kilnSessionId);
    const markerDocument = {
      version: MARKERS_VERSION,
      sourceManifestId: manifest.manifestId,
      sessionId: manifest.kilnSessionId,
      generatedAt,
      timebase: manifest.timeline.timebase,
      markers,
    };
    const markerArtifact = this.putJsonArtifact({
      namespace,
      title: `External editor markers: ${manifest.kilnSessionId}`,
      value: markerDocument,
    });
    const markerJsonUri = artifactContentUri(markerArtifact);

    const srtArtifact = this.putTextArtifact({
      namespace,
      title: `External editor captions SRT: ${manifest.kilnSessionId}`,
      mimeType: "application/x-subrip",
      text: formatSrt(captions),
    });
    const captionsSrtUri = artifactContentUri(srtArtifact);

    const vttArtifact = this.putTextArtifact({
      namespace,
      title: `External editor captions VTT: ${manifest.kilnSessionId}`,
      mimeType: "text/vtt",
      text: formatVtt(captions),
    });
    const captionsVttUri = artifactContentUri(vttArtifact);

    const editorProject = {
      version: PROJECT_VERSION,
      integrationTarget: "neutral-editor-handoff",
      generatedAt,
      sourceManifest: {
        id: manifest.manifestId,
        sessionId: manifest.kilnSessionId,
        ...(input.manifestUri ? { uri: input.manifestUri } : {}),
        title: input.title ?? manifest.title,
        timeline: manifest.timeline,
      },
      sourceMedia,
      sidecars: {
        captions: {
          srt: captionsSrtUri,
          vtt: captionsVttUri,
        },
        markers: {
          json: markerJsonUri,
        },
      },
      captions,
      markers,
      edits: {
        captions,
        cuts: manifest.tracks.edits.filter((track) => track.editKind === "cut"),
        zooms: manifest.tracks.edits.filter((track) => track.editKind === "auto_zoom"),
        pans: manifest.tracks.edits.filter((track) => track.editKind === "pan"),
        redactions: manifest.tracks.edits.filter((track) => track.editKind === "redaction"),
        voiceovers: manifest.tracks.edits.filter((track) => track.editKind === "voiceover"),
      },
    };
    const projectArtifact = this.putJsonArtifact({
      namespace,
      title: `External editor project: ${manifest.kilnSessionId}`,
      mimeType: EDITOR_PROJECT_MIME_TYPE,
      value: editorProject,
    });
    const editorProjectUri = artifactContentUri(projectArtifact);

    const projectMetadata = {
      version: PROJECT_METADATA_VERSION,
      sourceManifestId: manifest.manifestId,
      sessionId: manifest.kilnSessionId,
      generatedAt,
      ...(input.manifestUri ? { sourceManifestUri: input.manifestUri } : {}),
      captionCount: captions.length,
      markerCount: markers.length,
      exportFormats: ["json", "srt", "vtt", "editor-project"] satisfies readonly RecorderExportFormat[],
      sidecars: {
        markers: { json: markerJsonUri },
        captions: { srt: captionsSrtUri, vtt: captionsVttUri },
        editorProject: { json: editorProjectUri },
      },
    };
    const metadataArtifact = this.putJsonArtifact({
      namespace,
      title: `External editor project metadata: ${manifest.kilnSessionId}`,
      value: projectMetadata,
    });
    const projectMetadataUri = artifactContentUri(metadataArtifact);

    const exportTracks = createExportTracks({
      sessionId: manifest.kilnSessionId,
      metadataArtifact,
      projectMetadataUri,
      markerJsonUri,
      srtArtifact,
      captionsSrtUri,
      vttArtifact,
      captionsVttUri,
      projectArtifact,
      editorProjectUri,
    });

    return {
      sessionId: manifest.kilnSessionId,
      sourceManifestId: manifest.manifestId,
      sourceManifestUri: input.manifestUri,
      markerJsonUri,
      captionsSrtUri,
      captionsVttUri,
      editorProjectUri,
      projectMetadataUri,
      exportTracks,
      captionCount: captions.length,
      markerCount: markers.length,
      exportTrackCount: exportTracks.length,
      generatedAt,
    };
  }

  private putJsonArtifact(input: {
    readonly namespace: string;
    readonly title: string;
    readonly value: unknown;
    readonly mimeType?: string;
  }): ArtifactResourceMetadata {
    return this.artifactStore.put({
      namespace: input.namespace,
      title: input.title,
      mimeType: input.mimeType ?? "application/json",
      content: { type: "json", value: input.value },
      producer: { kind: "recorder", name: "recorder-external-editor-exporter" },
      retention: { scope: "session", maxArtifacts: this.retentionMaxArtifacts },
    });
  }

  private putTextArtifact(input: {
    readonly namespace: string;
    readonly title: string;
    readonly mimeType: string;
    readonly text: string;
  }): ArtifactResourceMetadata {
    return this.artifactStore.put({
      namespace: input.namespace,
      title: input.title,
      mimeType: input.mimeType,
      content: { type: "text", text: input.text },
      producer: { kind: "recorder", name: "recorder-external-editor-exporter" },
      retention: { scope: "session", maxArtifacts: this.retentionMaxArtifacts },
    });
  }

  private assertSourceArtifactsReadable(
    manifest: RecorderCaptureManifest,
    manifestUri: string | undefined,
  ): void {
    for (const uri of sourceArtifactUris(manifest, manifestUri)) {
      const reference = parseArtifactContentUri(uri, RECORDER_LABEL);
      if (!this.artifactStore.get(reference.namespace, reference.id)) {
        throw new Error(`Recorder external editor export source artifact is missing: ${uri}`);
      }
    }
  }
}

function createCaptionCues(edits: readonly RecorderEditTrack[]): readonly EditorCaptionCue[] {
  return edits
    .filter((track) => track.editKind === "caption" && textValue(track.text).length > 0)
    .map((track, index) => {
      const startedAtOffsetMs = normalizeOffset(track.startedAtOffsetMs);
      const durationMs = normalizeDuration(track.durationMs);
      const endOffsetMs = startedAtOffsetMs + durationMs;
      return {
        id: track.id,
        index: index + 1,
        text: textValue(track.text),
        startedAtOffsetMs,
        durationMs,
        startTimecode: formatTimecode(startedAtOffsetMs, "."),
        endTimecode: formatTimecode(endOffsetMs, "."),
      };
    });
}

function createMarkers(manifest: RecorderCaptureManifest): readonly EditorMarker[] {
  const eventMarkers = manifest.tracks.events.map(createEventMarker);
  const editMarkers = manifest.tracks.edits.map(createEditMarker);
  return [...eventMarkers, ...editMarkers];
}

function createEventMarker(track: RecorderEventTrack): EditorMarker {
  const evidenceUris = evidenceUrisFrom(track.evidence);
  return omitUndefined({
    id: track.id,
    sourceTrackKind: "event" as const,
    kind: "event",
    label: uniqueRecorderStrings(track.eventKinds).join(", ") || track.id,
    startedAtOffsetMs: normalizeOffset(track.startedAtOffsetMs ?? 0),
    durationMs: track.durationMs,
    resourceUri: track.resource.uri,
    evidenceUris,
  });
}

function createEditMarker(track: RecorderEditTrack): EditorMarker {
  const evidenceUris = evidenceUrisFrom(track.evidence);
  const text = textValue(track.text);
  return omitUndefined({
    id: track.id,
    sourceTrackKind: "edit" as const,
    kind: track.editKind,
    label: text || track.editKind,
    startedAtOffsetMs: normalizeOffset(track.startedAtOffsetMs),
    durationMs: track.durationMs,
    target: track.target,
    text: text || undefined,
    resourceUri: track.resource?.uri,
    evidenceUris,
  });
}

function createSourceMedia(manifest: RecorderCaptureManifest): {
  readonly video: readonly SourceMediaReference[];
  readonly audio: readonly SourceMediaReference[];
} {
  return {
    video: uniqueSourceMedia(manifest.tracks.exports
      .filter((track) => track.format === "mp4" || track.format === "webm" || isMime(track.resource, "video/"))
      .map((track) => sourceMediaReference(track.id, track.format, track.resource))),
    audio: uniqueSourceMedia(manifest.tracks.edits
      .filter((track) => track.resource && (track.editKind === "voiceover" || isMime(track.resource, "audio/")))
      .map((track) => sourceMediaReference(track.id, track.editKind, track.resource!))),
  };
}

function sourceMediaReference(
  id: string,
  format: string,
  resource: RecorderResourceReference,
): SourceMediaReference {
  return {
    id,
    format,
    uri: resource.uri,
    title: resource.title,
    mimeType: resource.mimeType,
    sizeBytes: resource.sizeBytes,
  };
}

function uniqueSourceMedia(values: readonly SourceMediaReference[]): readonly SourceMediaReference[] {
  const seen = new Set<string>();
  const result: SourceMediaReference[] = [];
  for (const value of values) {
    if (seen.has(value.uri)) continue;
    seen.add(value.uri);
    result.push(value);
  }
  return result;
}

function sourceArtifactUris(
  manifest: RecorderCaptureManifest,
  manifestUri: string | undefined,
): readonly string[] {
  const uris = [
    ...(manifestUri ? [manifestUri] : []),
    ...manifest.tracks.rawCapture.map((track) => track.capture.resource.uri),
    ...manifest.tracks.events.map((track) => track.resource.uri),
    ...manifest.tracks.artifacts.flatMap((track) => track.artifactUris),
    ...manifest.tracks.edits.flatMap((track) => track.resource ? [track.resource.uri] : []),
    ...manifest.tracks.exports.map((track) => track.resource.uri),
    ...manifest.tracks.replay.map((track) => track.resource.uri),
    ...manifest.tracks.rawCapture.flatMap((track) => evidenceUrisFrom(track.evidence)),
    ...manifest.tracks.events.flatMap((track) => evidenceUrisFrom(track.evidence)),
    ...manifest.tracks.edits.flatMap((track) => evidenceUrisFrom(track.evidence)),
    ...manifest.tracks.exports.flatMap((track) => evidenceUrisFrom(track.evidence)),
    ...manifest.tracks.replay.flatMap((track) => evidenceUrisFrom(track.evidence)),
  ];
  return uniqueRecorderStrings(uris);
}

function createExportTracks(input: {
  readonly sessionId: string;
  readonly metadataArtifact: ArtifactResourceMetadata;
  readonly projectMetadataUri: string;
  readonly markerJsonUri: string;
  readonly srtArtifact: ArtifactResourceMetadata;
  readonly captionsSrtUri: string;
  readonly vttArtifact: ArtifactResourceMetadata;
  readonly captionsVttUri: string;
  readonly projectArtifact: ArtifactResourceMetadata;
  readonly editorProjectUri: string;
}): readonly RecorderExportTrack[] {
  return [
    createExportTrack({
      sessionId: input.sessionId,
      idSuffix: "editor-metadata",
      artifact: input.metadataArtifact,
      uri: input.projectMetadataUri,
      format: "json",
      title: "External editor project metadata",
      additionalEvidence: [{
        kind: "artifact",
        id: "editor-markers",
        uri: input.markerJsonUri,
      }],
    }),
    createExportTrack({
      sessionId: input.sessionId,
      idSuffix: "editor-captions-srt",
      artifact: input.srtArtifact,
      uri: input.captionsSrtUri,
      format: "srt",
      title: "External editor captions SRT",
    }),
    createExportTrack({
      sessionId: input.sessionId,
      idSuffix: "editor-captions-vtt",
      artifact: input.vttArtifact,
      uri: input.captionsVttUri,
      format: "vtt",
      title: "External editor captions VTT",
    }),
    createExportTrack({
      sessionId: input.sessionId,
      idSuffix: "editor-project",
      artifact: input.projectArtifact,
      uri: input.editorProjectUri,
      format: "editor-project",
      title: "External editor project handoff",
    }),
  ];
}

function createExportTrack(input: {
  readonly sessionId: string;
  readonly idSuffix: string;
  readonly artifact: ArtifactResourceMetadata;
  readonly uri: string;
  readonly format: RecorderExportFormat;
  readonly title: string;
  readonly additionalEvidence?: RecorderExportTrack["evidence"];
}): RecorderExportTrack {
  return {
    id: `${input.sessionId}-${input.idSuffix}-export`,
    kind: "export",
    status: "ready",
    format: input.format,
    resource: {
      uri: input.uri,
      relation: "export",
      title: input.title,
      mimeType: input.artifact.mimeType,
      sizeBytes: input.artifact.size,
    },
    evidence: [
      {
        kind: "artifact",
        id: input.idSuffix,
        uri: input.uri,
      },
      ...(input.additionalEvidence ?? []),
    ],
  };
}

function formatSrt(captions: readonly EditorCaptionCue[]): string {
  return captions
    .map((caption) => [
      String(caption.index),
      `${formatTimecode(caption.startedAtOffsetMs, ",")} --> ${formatTimecode(caption.startedAtOffsetMs + caption.durationMs, ",")}`,
      caption.text,
      "",
    ].join("\n"))
    .join("\n");
}

function formatVtt(captions: readonly EditorCaptionCue[]): string {
  return [
    "WEBVTT",
    "",
    ...captions.flatMap((caption) => [
      `${caption.startTimecode} --> ${caption.endTimecode}`,
      caption.text,
      "",
    ]),
  ].join("\n");
}

function formatTimecode(offsetMs: number, millisecondSeparator: "." | ","): string {
  const milliseconds = Math.max(0, Math.trunc(offsetMs));
  const hours = Math.trunc(milliseconds / 3_600_000);
  const minutes = Math.trunc((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.trunc((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}${millisecondSeparator}${pad3(millis)}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function pad3(value: number): string {
  return value.toString().padStart(3, "0");
}

function normalizeOffset(value: number): number {
  return Math.max(0, Math.trunc(value));
}

function normalizeDuration(value: number | undefined): number {
  if (value === undefined) return 1;
  return Math.max(1, Math.trunc(value));
}

function textValue(value: string | undefined): string {
  return value?.trim() ?? "";
}

function isMime(resource: RecorderResourceReference, prefix: string): boolean {
  return resource.mimeType?.toLowerCase().startsWith(prefix) ?? false;
}

function evidenceUrisFrom(evidence: readonly { readonly uri?: string }[] | undefined): readonly string[] {
  return uniqueRecorderStrings((evidence ?? []).flatMap((item) => item.uri ? [item.uri] : []));
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
