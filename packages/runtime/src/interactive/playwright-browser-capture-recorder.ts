import {
  createRecorderCaptureManifest,
  type ArtifactResourceMetadata,
  type ArtifactResourceStore,
  type InteractiveActionMetadata,
  type InteractiveToolName,
  type InteractiveToolOperation,
  type RecorderCaptureManifest,
  type RecorderCaptureManifestStatus,
  type RecorderEditTrack,
  type RecorderExportTrack,
} from "@kilnai/core";
import {
  artifactContentUri,
  assertRecorderArtifactsReadable,
  createRecorderArtifactNamespace,
  normalizeRecorderRetentionMaxArtifacts,
  normalizeRecorderTimestamp,
  parseArtifactContentUri,
  readRecorderArtifactSize,
  requireRecorderText,
  uniqueRecorderStrings,
  validateArtifactContentUri,
} from "./recorder-artifact-helpers.js";
import {
  createPlaywrightBrowserVideoRenderer,
  type BrowserVideoOutputOptions,
  type PlaywrightBrowserVideoRenderer,
} from "./playwright-browser-video-renderer.js";
import {
  RecorderExternalEditorExporter,
  type RecorderExternalEditorExportResult,
} from "./recorder-external-editor-exporter.js";

const RAW_CAPTURE_EVIDENCE_VERSION = "playwright-browser-raw-capture.v1";
const EVENT_TRACK_VERSION = "playwright-browser-event-track.v1";
const RECORDER_ARTIFACT_NAMESPACE_PREFIX = "recorder-browser-capture";
const RAW_CAPTURE_FORMAT = "application/vnd.kiln.playwright.frame-stream+json";
const DEFAULT_RETENTION_MAX_ARTIFACTS = 50;
const MIN_RENDER_PROOF_ARTIFACTS = 6;
const RECORDER_LABEL = "Recorder browser capture";

export type PlaywrightBrowserCaptureTransport = "snapshot-polling" | "cdp-screencast";
export type PlaywrightBrowserOperationStatus = "succeeded" | "failed";

export interface PlaywrightBrowserCaptureRecorderOptions {
  readonly artifactStore: ArtifactResourceStore;
  readonly videoRenderer?: PlaywrightBrowserVideoRenderer;
  readonly now?: () => Date;
  readonly retentionMaxArtifacts?: number;
}

export interface PlaywrightBrowserCaptureFrameInput {
  readonly sessionId: string;
  readonly capturedAt?: Date | string;
  readonly operation?: string;
  readonly transport: PlaywrightBrowserCaptureTransport;
  readonly artifactUri: string;
  readonly url?: string;
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface PlaywrightBrowserOperationInput {
  readonly sessionId: string;
  readonly toolName: InteractiveToolName;
  readonly operation: InteractiveToolOperation;
  readonly startedAt?: Date | string;
  readonly completedAt?: Date | string;
  readonly action?: InteractiveActionMetadata;
  readonly status: PlaywrightBrowserOperationStatus;
  readonly errorMessage?: string;
  readonly url?: string;
  readonly title?: string;
}

export interface PlaywrightBrowserCaptureProof {
  readonly sessionId: string;
  readonly manifestId: string;
  readonly manifestUri: string;
  readonly rawCaptureEvidenceUri: string;
  readonly eventTrackUri: string;
  readonly frameArtifactUris: readonly string[];
  readonly frameCount: number;
  readonly eventCount: number;
}

export interface PlaywrightBrowserRenderProof {
  readonly sessionId: string;
  readonly manifestId: string;
  readonly manifestUri: string;
  readonly exportUri: string;
  readonly format: "webm";
  readonly mimeType: "video/webm";
  readonly exportSize: number;
  readonly durationMs: number;
  readonly renderedFrameCount: number;
  readonly editTrackCount: number;
  readonly captionCount: number;
  readonly cursorHighlightCount: number;
  readonly zoomCount: number;
}

export interface PlaywrightBrowserRenderVideoOptions {
  readonly completedAt?: Date | string;
  readonly title?: string;
  readonly output?: BrowserVideoOutputOptions;
}

export interface PlaywrightBrowserExternalEditorExportOptions {
  readonly completedAt?: Date | string;
  readonly title?: string;
}

export interface PlaywrightBrowserExternalEditorExportProof extends RecorderExternalEditorExportResult {
  readonly manifestUri: string;
}

interface BrowserCaptureFrame {
  readonly sessionId: string;
  readonly artifactUri: string;
  readonly capturedAt: string;
  readonly offsetMs: number;
  readonly operation?: string;
  readonly transport: PlaywrightBrowserCaptureTransport;
  readonly url?: string;
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
}

interface BrowserOperationEvent {
  readonly id: string;
  readonly sessionId: string;
  readonly toolName: InteractiveToolName;
  readonly operation: InteractiveToolOperation;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly offsetMs: number;
  readonly durationMs: number;
  readonly status: PlaywrightBrowserOperationStatus;
  readonly errorMessage?: string;
  readonly url?: string;
  readonly title?: string;
  readonly selector?: string;
  readonly x?: number;
  readonly y?: number;
  readonly button?: "left" | "middle" | "right";
  readonly keys?: readonly string[];
  readonly direction?: "up" | "down" | "left" | "right";
  readonly deltaX?: number;
  readonly deltaY?: number;
  readonly textLength?: number;
  readonly sensitive?: boolean;
}

interface BrowserCaptureSessionState {
  readonly sessionId: string;
  readonly frames: BrowserCaptureFrame[];
  readonly operations: BrowserOperationEvent[];
  proof?: PlaywrightBrowserCaptureProof;
  renderProof?: PlaywrightBrowserRenderProof;
  editorExportProof?: PlaywrightBrowserExternalEditorExportProof;
}

export class PlaywrightBrowserCaptureRecorder {
  private readonly artifactStore: ArtifactResourceStore;
  private readonly videoRenderer: PlaywrightBrowserVideoRenderer;
  private readonly now: () => Date;
  private readonly retentionMaxArtifacts: number;
  private readonly sessions = new Map<string, BrowserCaptureSessionState>();

  constructor(options: PlaywrightBrowserCaptureRecorderOptions) {
    this.artifactStore = options.artifactStore;
    this.videoRenderer = options.videoRenderer ?? createPlaywrightBrowserVideoRenderer();
    this.now = options.now ?? (() => new Date());
    this.retentionMaxArtifacts = normalizeRetentionMaxArtifacts(options.retentionMaxArtifacts);
  }

  recordBrowserCaptureFrame(input: PlaywrightBrowserCaptureFrameInput): void {
    requireRecorderText(input.sessionId, "sessionId", RECORDER_LABEL);
    validateArtifactContentUri(input.artifactUri, RECORDER_LABEL);
    const state = this.stateFor(input.sessionId);
    const capturedAt = normalizeRecorderTimestamp(input.capturedAt ?? this.now(), RECORDER_LABEL);
    const originMs = state.frames.length > 0 ? Date.parse(state.frames[0]!.capturedAt) : Date.parse(capturedAt);
    state.frames.push({
      sessionId: input.sessionId,
      artifactUri: input.artifactUri,
      capturedAt,
      offsetMs: Math.max(0, Date.parse(capturedAt) - originMs),
      ...(input.operation ? { operation: input.operation } : {}),
      transport: input.transport,
      ...(input.url ? { url: input.url } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
    });
    state.proof = undefined;
    state.renderProof = undefined;
    state.editorExportProof = undefined;
  }

  recordBrowserOperation(input: PlaywrightBrowserOperationInput): void {
    requireRecorderText(input.sessionId, "sessionId", RECORDER_LABEL);
    const state = this.stateFor(input.sessionId);
    const completedAt = normalizeRecorderTimestamp(input.completedAt ?? this.now(), RECORDER_LABEL);
    const startedAt = normalizeRecorderTimestamp(input.startedAt ?? completedAt, RECORDER_LABEL);
    const originMs = this.originMs(state) ?? Date.parse(startedAt);
    const action = input.action;
    state.operations.push({
      id: `${input.sessionId}-browser-event-${state.operations.length + 1}`,
      sessionId: input.sessionId,
      toolName: input.toolName,
      operation: input.operation,
      startedAt,
      completedAt,
      offsetMs: Math.max(0, Date.parse(startedAt) - originMs),
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      status: input.status,
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
      ...(input.url ? { url: input.url } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(action?.selector ? { selector: action.selector } : {}),
      ...(action?.x !== undefined ? { x: action.x } : {}),
      ...(action?.y !== undefined ? { y: action.y } : {}),
      ...(action?.button ? { button: action.button } : {}),
      ...(action?.keys ? { keys: action.keys } : {}),
      ...(action?.direction ? { direction: action.direction } : {}),
      ...(action?.deltaX !== undefined ? { deltaX: action.deltaX } : {}),
      ...(action?.deltaY !== undefined ? { deltaY: action.deltaY } : {}),
      ...(action?.textLength !== undefined ? { textLength: action.textLength } : {}),
      ...(action?.sensitive !== undefined ? { sensitive: action.sensitive } : {}),
    });
    state.proof = undefined;
    state.renderProof = undefined;
    state.editorExportProof = undefined;
  }

  finalizeSession(
    sessionId: string,
    options: { readonly completedAt?: Date | string; readonly title?: string } = {},
  ): PlaywrightBrowserCaptureProof {
    requireRecorderText(sessionId, "sessionId", RECORDER_LABEL);
    const state = this.sessions.get(sessionId);
    if (!state || state.frames.length === 0) {
      throw new Error("Cannot finalize Playwright browser capture proof without raw capture frames.");
    }
    if (state.proof) {
      return state.proof;
    }

    const startedAt = state.frames[0]!.capturedAt;
    const completedAt = normalizeRecorderTimestamp(options.completedAt ?? this.latestTimestamp(state), RECORDER_LABEL);
    const frameArtifactUris = uniqueRecorderStrings(state.frames.map((frame) => frame.artifactUri));
    const rawEvidence = {
      version: RAW_CAPTURE_EVIDENCE_VERSION,
      sessionId,
      startedAt,
      completedAt,
      frameCount: state.frames.length,
      frames: state.frames,
    };
    const rawCapture = this.putJsonArtifact({
      sessionId,
      title: `Browser raw capture evidence: ${sessionId}`,
      value: rawEvidence,
    });
    const eventTrack = {
      version: EVENT_TRACK_VERSION,
      sessionId,
      startedAt,
      completedAt,
      eventCount: state.operations.length,
      events: state.operations,
    };
    const eventTrackArtifact = this.putJsonArtifact({
      sessionId,
      title: `Browser event track: ${sessionId}`,
      value: eventTrack,
    });
    const rawCaptureEvidenceUri = artifactContentUri(rawCapture);
    const eventTrackUri = artifactContentUri(eventTrackArtifact);
    const manifest = this.createManifest({
      state,
      startedAt,
      completedAt,
      title: options.title,
      rawCaptureEvidenceUri,
      rawCaptureSize: rawCapture.size,
      eventTrackUri,
      eventTrackSize: eventTrackArtifact.size,
      frameArtifactUris,
    });
    const manifestArtifact = this.putJsonArtifact({
      sessionId,
      title: `Recorder manifest: ${sessionId}`,
      value: manifest,
    });
    const proof: PlaywrightBrowserCaptureProof = {
      sessionId,
      manifestId: manifest.manifestId,
      manifestUri: artifactContentUri(manifestArtifact),
      rawCaptureEvidenceUri,
      eventTrackUri,
      frameArtifactUris,
      frameCount: state.frames.length,
      eventCount: state.operations.length,
    };
    this.assertArtifactsReadable([
      proof.rawCaptureEvidenceUri,
      proof.eventTrackUri,
      proof.manifestUri,
    ]);
    state.proof = proof;
    return proof;
  }

  async renderBasicVideo(
    sessionId: string,
    options: PlaywrightBrowserRenderVideoOptions = {},
  ): Promise<PlaywrightBrowserRenderProof> {
    requireRecorderText(sessionId, "sessionId", RECORDER_LABEL);
    const state = this.sessions.get(sessionId);
    if (!state || state.frames.length === 0) {
      throw new Error("Cannot render Playwright browser video without raw capture frames.");
    }
    if (state.renderProof) {
      return state.renderProof;
    }
    const captureProof = this.finalizeSession(sessionId, options);
    this.assertArtifactsReadable([
      captureProof.rawCaptureEvidenceUri,
      captureProof.eventTrackUri,
      captureProof.manifestUri,
    ]);
    const rendered = await this.videoRenderer.render({
      artifactStore: this.artifactStore,
      sessionId,
      frames: state.frames,
      operations: state.operations,
      ...(options.output ? { output: options.output } : {}),
    });
    const exportArtifact = this.artifactStore.put({
      namespace: recorderArtifactNamespace(sessionId),
      title: `Browser video export: ${sessionId}`,
      mimeType: rendered.mimeType,
      content: { type: "blob", blob: Buffer.from(rendered.content).toString("base64") },
      producer: { kind: "recorder", name: "playwright-browser-video-renderer" },
      retention: { scope: "session", maxArtifacts: this.retentionMaxArtifacts },
    });
    const exportUri = artifactContentUri(exportArtifact);
    const startedAt = state.frames[0]!.capturedAt;
    const completedAt = normalizeRecorderTimestamp(options.completedAt ?? this.latestTimestamp(state), RECORDER_LABEL);
    const manifest = this.createManifest({
      state,
      startedAt,
      completedAt,
      title: options.title,
      status: "rendered",
      rawCaptureEvidenceUri: captureProof.rawCaptureEvidenceUri,
      rawCaptureSize: this.artifactSize(captureProof.rawCaptureEvidenceUri),
      eventTrackUri: captureProof.eventTrackUri,
      eventTrackSize: this.artifactSize(captureProof.eventTrackUri),
      frameArtifactUris: captureProof.frameArtifactUris,
      edits: rendered.editTracks,
      exports: [{
        id: `${sessionId}-webm-export`,
        kind: "export",
        status: "ready",
        format: rendered.format,
        aspectRatio: "16:9",
        resource: {
          uri: exportUri,
          relation: "export",
          title: "Browser WebM export",
          mimeType: rendered.mimeType,
          sizeBytes: exportArtifact.size,
        },
        evidence: [{
          kind: "artifact",
          id: "browser-video-export",
          uri: exportUri,
        }],
      }],
    });
    const manifestArtifact = this.putJsonArtifact({
      sessionId,
      title: `Rendered recorder manifest: ${sessionId}`,
      value: manifest,
    });
    const manifestUri = artifactContentUri(manifestArtifact);
    const renderProof: PlaywrightBrowserRenderProof = {
      sessionId,
      manifestId: manifest.manifestId,
      manifestUri,
      exportUri,
      format: rendered.format,
      mimeType: rendered.mimeType,
      exportSize: exportArtifact.size,
      durationMs: rendered.durationMs,
      renderedFrameCount: rendered.renderedFrameCount,
      editTrackCount: rendered.editTracks.length,
      captionCount: rendered.captionCount,
      cursorHighlightCount: rendered.cursorHighlightCount,
      zoomCount: rendered.zoomCount,
    };
    this.assertArtifactsReadable([
      captureProof.rawCaptureEvidenceUri,
      captureProof.eventTrackUri,
      captureProof.manifestUri,
      renderProof.exportUri,
      renderProof.manifestUri,
    ]);
    state.renderProof = renderProof;
    return renderProof;
  }

  exportExternalEditorProject(
    sessionId: string,
    options: PlaywrightBrowserExternalEditorExportOptions = {},
  ): PlaywrightBrowserExternalEditorExportProof {
    requireRecorderText(sessionId, "sessionId", RECORDER_LABEL);
    const state = this.sessions.get(sessionId);
    if (!state?.renderProof) {
      throw new Error("Cannot export Playwright browser editor project without a rendered video proof.");
    }
    if (state.editorExportProof) {
      return state.editorExportProof;
    }

    const renderedManifest = this.readManifestArtifact(state.renderProof.manifestUri);
    const completedAt = normalizeRecorderTimestamp(options.completedAt ?? this.now(), RECORDER_LABEL);
    const exporter = new RecorderExternalEditorExporter({
      artifactStore: this.artifactStore,
      now: this.now,
      retentionMaxArtifacts: this.retentionMaxArtifacts,
    });
    const editorExport = exporter.exportManifest({
      manifest: renderedManifest,
      manifestUri: state.renderProof.manifestUri,
      completedAt,
      title: options.title,
    });
    const exportedManifest = createRecorderCaptureManifest({
      ...renderedManifest,
      updatedAt: completedAt,
      status: "exported",
      title: options.title ?? renderedManifest.title,
      tracks: {
        ...renderedManifest.tracks,
        exports: [
          ...renderedManifest.tracks.exports,
          ...editorExport.exportTracks,
        ],
      },
    });
    const manifestArtifact = this.putJsonArtifact({
      sessionId,
      title: `External editor recorder manifest: ${sessionId}`,
      value: exportedManifest,
    });
    const manifestUri = artifactContentUri(manifestArtifact);
    const proof: PlaywrightBrowserExternalEditorExportProof = {
      ...editorExport,
      manifestUri,
    };
    this.assertArtifactsReadable([
      state.renderProof.exportUri,
      state.renderProof.manifestUri,
      proof.markerJsonUri,
      proof.captionsSrtUri,
      proof.captionsVttUri,
      proof.editorProjectUri,
      proof.projectMetadataUri,
      proof.manifestUri,
    ]);
    state.editorExportProof = proof;
    return proof;
  }

  getLastProof(sessionId: string): PlaywrightBrowserCaptureProof | undefined {
    return this.sessions.get(sessionId)?.proof;
  }

  private stateFor(sessionId: string): BrowserCaptureSessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    const state: BrowserCaptureSessionState = { sessionId, frames: [], operations: [] };
    this.sessions.set(sessionId, state);
    return state;
  }

  private originMs(state: BrowserCaptureSessionState): number | undefined {
    return state.frames.length > 0 ? Date.parse(state.frames[0]!.capturedAt) : undefined;
  }

  private latestTimestamp(state: BrowserCaptureSessionState): string {
    const values = [
      ...state.frames.map((frame) => Date.parse(frame.capturedAt)),
      ...state.operations.map((operation) => Date.parse(operation.completedAt)),
    ];
    return new Date(Math.max(...values)).toISOString();
  }

  private putJsonArtifact(input: {
    readonly sessionId: string;
    readonly title: string;
    readonly value: unknown;
  }): ArtifactResourceMetadata {
    return this.artifactStore.put({
      namespace: recorderArtifactNamespace(input.sessionId),
      title: input.title,
      mimeType: "application/json",
      content: { type: "json", value: input.value },
      producer: { kind: "recorder", name: "playwright-browser-capture-recorder" },
      retention: { scope: "session", maxArtifacts: this.retentionMaxArtifacts },
    });
  }

  private artifactSize(uri: string): number {
    return readRecorderArtifactSize(this.artifactStore, uri, RECORDER_LABEL);
  }

  private readManifestArtifact(uri: string): RecorderCaptureManifest {
    const reference = parseArtifactContentUri(uri, RECORDER_LABEL);
    const artifact = this.artifactStore.get(reference.namespace, reference.id);
    if (!artifact) {
      throw new Error(`${RECORDER_LABEL} artifact is missing: ${uri}`);
    }
    if (artifact.content.type !== "json") {
      throw new Error(`${RECORDER_LABEL} manifest artifact must be JSON: ${uri}`);
    }
    return createRecorderCaptureManifest(artifact.content.value as RecorderCaptureManifest);
  }

  private assertArtifactsReadable(uris: readonly string[]): void {
    assertRecorderArtifactsReadable(this.artifactStore, uris, RECORDER_LABEL);
  }

  private createManifest(input: {
    readonly state: BrowserCaptureSessionState;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly title?: string;
    readonly status?: RecorderCaptureManifestStatus;
    readonly rawCaptureEvidenceUri: string;
    readonly rawCaptureSize: number;
    readonly eventTrackUri: string;
    readonly eventTrackSize: number;
    readonly frameArtifactUris: readonly string[];
    readonly edits?: readonly RecorderEditTrack[];
    readonly exports?: readonly RecorderExportTrack[];
  }): RecorderCaptureManifest {
    const latestFrame = input.state.frames[input.state.frames.length - 1]!;
    const manifestId = `${input.state.sessionId}-recorder-manifest`;
    return createRecorderCaptureManifest({
      manifestId,
      kilnSessionId: input.state.sessionId,
      title: input.title ?? `Browser recorder proof: ${input.state.sessionId}`,
      createdAt: input.startedAt,
      updatedAt: input.completedAt,
      status: input.status ?? "captured",
      policy: {
        recordingConsent: "operator-approved",
        retention: { scope: "session", maxArtifacts: this.retentionMaxArtifacts },
        redaction: { status: "pending", sensitive: false },
      },
      timeline: {
        timebase: "relative-ms",
        startedAt: input.startedAt,
        durationMs: Math.max(1, Date.parse(input.completedAt) - Date.parse(input.startedAt)),
      },
      tracks: {
        rawCapture: [{
          id: `${input.state.sessionId}-raw-capture`,
          kind: "raw_capture",
          status: "captured",
          source: {
            kind: "browser_session",
            target: "browser",
            sessionId: input.state.sessionId,
            ...(latestFrame.url ? { url: latestFrame.url } : {}),
            ...(latestFrame.title ? { windowTitle: latestFrame.title } : {}),
          },
          capture: {
            transport: "frame-stream",
            format: RAW_CAPTURE_FORMAT,
            startedAtOffsetMs: 0,
            durationMs: Math.max(1, Date.parse(input.completedAt) - Date.parse(input.startedAt)),
            resource: {
              uri: input.rawCaptureEvidenceUri,
              relation: "raw_capture",
              title: "Browser raw capture evidence",
              mimeType: "application/json",
              sizeBytes: input.rawCaptureSize,
            },
          },
          evidence: [{
            kind: "artifact",
            id: "raw-capture-evidence",
            uri: input.rawCaptureEvidenceUri,
          }],
        }],
        events: [{
          id: `${input.state.sessionId}-browser-events`,
          kind: "event",
          eventKinds: uniqueRecorderStrings(input.state.operations.map((operation) => operation.toolName)),
          startedAtOffsetMs: 0,
          durationMs: Math.max(1, Date.parse(input.completedAt) - Date.parse(input.startedAt)),
          resource: {
            uri: input.eventTrackUri,
            relation: "events",
            title: "Browser event track",
            mimeType: "application/json",
            sizeBytes: input.eventTrackSize,
          },
          evidence: [{
            kind: "artifact",
            id: "browser-event-track",
            uri: input.eventTrackUri,
          }],
        }],
        artifacts: input.frameArtifactUris.length > 0
          ? [{
              id: `${input.state.sessionId}-browser-frame-artifacts`,
              kind: "artifact",
              artifactUris: input.frameArtifactUris,
              relation: "source_evidence",
            }]
          : [],
        edits: input.edits ?? [],
        exports: input.exports ?? [],
        replay: [],
      },
    });
  }
}

function recorderArtifactNamespace(sessionId: string): string {
  return createRecorderArtifactNamespace(RECORDER_ARTIFACT_NAMESPACE_PREFIX, sessionId);
}

function normalizeRetentionMaxArtifacts(value: number | undefined): number {
  return normalizeRecorderRetentionMaxArtifacts({
    value,
    defaultValue: DEFAULT_RETENTION_MAX_ARTIFACTS,
    // The browser proof footprint includes raw/events, two manifests, WebM export, and the exported manifest.
    minimumValue: MIN_RENDER_PROOF_ARTIFACTS,
    label: "Playwright browser capture",
  });
}
