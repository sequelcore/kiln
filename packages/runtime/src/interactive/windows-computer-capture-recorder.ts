import {
  createRecorderCaptureManifest,
  type ArtifactResourceMetadata,
  type ArtifactResourceStore,
  type InteractiveActionMetadata,
  type InteractiveToolName,
  type InteractiveToolOperation,
  type RecorderCaptureManifest,
  type RecorderRecordingConsent,
} from "@kilnai/core";
import {
  artifactContentUri,
  assertRecorderArtifactsReadable,
  createRecorderArtifactNamespace,
  normalizeRecorderRetentionMaxArtifacts,
  normalizeRecorderTimestamp,
  parseArtifactContentUri,
  requireRecorderText,
  uniqueRecorderStrings,
  validateArtifactContentUri,
} from "./recorder-artifact-helpers.js";

const RAW_COMPUTER_CAPTURE_EVIDENCE_VERSION = "windows-computer-raw-capture.v1";
const COMPUTER_EVENT_TRACK_VERSION = "windows-computer-event-track.v1";
const RECORDER_ARTIFACT_NAMESPACE_PREFIX = "recorder-computer-capture";
const RAW_COMPUTER_CAPTURE_FORMAT = "application/vnd.kiln.windows-computer.frame-stream+json";
const DEFAULT_RETENTION_MAX_ARTIFACTS = 50;
const MIN_CAPTURE_PROOF_ARTIFACTS = 1;
const RECORDER_LABEL = "Windows computer capture";

export type WindowsComputerCaptureTransport = "desktop-capture" | "window-capture" | "computer-native";
export type WindowsComputerOperationStatus = "succeeded" | "failed";

export interface WindowsComputerCaptureRecorderOptions {
  readonly artifactStore: ArtifactResourceStore;
  readonly now?: () => Date;
  readonly retentionMaxArtifacts?: number;
  readonly recordingConsent?: RecorderRecordingConsent;
}

export interface WindowsComputerOperationInput {
  readonly sessionId: string;
  readonly toolName: InteractiveToolName;
  readonly operation: InteractiveToolOperation;
  readonly startedAt?: Date | string;
  readonly completedAt?: Date | string;
  readonly action?: InteractiveActionMetadata;
  readonly status: WindowsComputerOperationStatus;
  readonly errorMessage?: string;
  readonly provider?: string;
  readonly application?: string;
  readonly windowTitle?: string;
  readonly screenshotDataUrl?: string;
  readonly screenshotUri?: string;
  readonly transport?: WindowsComputerCaptureTransport;
  readonly width?: number;
  readonly height?: number;
  readonly sensitive?: boolean;
  readonly allowedApplications?: readonly string[];
}

export interface WindowsComputerCaptureProof {
  readonly sessionId: string;
  readonly manifestId: string;
  readonly manifestUri: string;
  readonly rawCaptureEvidenceUri: string;
  readonly eventTrackUri: string;
  readonly frameArtifactUris: readonly string[];
  readonly frameCount: number;
  readonly eventCount: number;
}

interface ComputerCaptureFrame {
  readonly sessionId: string;
  readonly artifactUri: string;
  readonly capturedAt: string;
  readonly offsetMs: number;
  readonly operation: InteractiveToolOperation;
  readonly transport: WindowsComputerCaptureTransport;
  readonly provider?: string;
  readonly application?: string;
  readonly windowTitle?: string;
  readonly width?: number;
  readonly height?: number;
}

interface ComputerOperationEvent {
  readonly id: string;
  readonly sessionId: string;
  readonly toolName: InteractiveToolName;
  readonly operation: InteractiveToolOperation;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly offsetMs: number;
  readonly durationMs: number;
  readonly status: WindowsComputerOperationStatus;
  readonly errorMessage?: string;
  readonly provider?: string;
  readonly application?: string;
  readonly windowTitle?: string;
  readonly x?: number;
  readonly y?: number;
  readonly button?: "left" | "middle" | "right";
  readonly keys?: readonly string[];
  readonly direction?: "up" | "down" | "left" | "right";
  readonly deltaX?: number;
  readonly deltaY?: number;
  readonly textLength?: number;
  readonly sensitive?: boolean;
  readonly allowedApplications?: readonly string[];
}

interface ComputerCaptureSessionState {
  readonly sessionId: string;
  readonly frames: ComputerCaptureFrame[];
  readonly operations: ComputerOperationEvent[];
  proof?: WindowsComputerCaptureProof;
}

export class WindowsComputerCaptureRecorder {
  private readonly artifactStore: ArtifactResourceStore;
  private readonly now: () => Date;
  private readonly retentionMaxArtifacts: number;
  private readonly recordingConsent: RecorderRecordingConsent;
  private readonly sessions = new Map<string, ComputerCaptureSessionState>();

  constructor(options: WindowsComputerCaptureRecorderOptions) {
    this.artifactStore = options.artifactStore;
    this.now = options.now ?? (() => new Date());
    this.retentionMaxArtifacts = normalizeRecorderRetentionMaxArtifacts({
      value: options.retentionMaxArtifacts,
      defaultValue: DEFAULT_RETENTION_MAX_ARTIFACTS,
      minimumValue: MIN_CAPTURE_PROOF_ARTIFACTS,
      label: RECORDER_LABEL,
    });
    this.recordingConsent = options.recordingConsent ?? "operator-approved";
  }

  recordComputerOperation(input: WindowsComputerOperationInput): void {
    requireRecorderText(input.sessionId, "sessionId", RECORDER_LABEL);
    const state = this.stateFor(input.sessionId);
    const completedAt = normalizeRecorderTimestamp(input.completedAt ?? this.now(), RECORDER_LABEL);
    const startedAt = normalizeRecorderTimestamp(input.startedAt ?? completedAt, RECORDER_LABEL);
    const screenshotUri = this.resolveScreenshotArtifactUri(state, input);
    if (screenshotUri) {
      this.recordCaptureFrame({
        state,
        input,
        artifactUri: screenshotUri,
        capturedAt: completedAt,
      });
    }

    const originMs = this.originMs(state) ?? Date.parse(startedAt);
    const action = input.action;
    const sensitive = input.sensitive ?? action?.sensitive;
    const allowedApplications = uniqueRecorderStrings(input.allowedApplications ?? []);
    state.operations.push({
      id: `${input.sessionId}-computer-event-${state.operations.length + 1}`,
      sessionId: input.sessionId,
      toolName: input.toolName,
      operation: input.operation,
      startedAt,
      completedAt,
      offsetMs: Math.max(0, Date.parse(startedAt) - originMs),
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      status: input.status,
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.application ? { application: input.application } : {}),
      ...(input.windowTitle ? { windowTitle: input.windowTitle } : {}),
      ...(action?.x !== undefined ? { x: action.x } : {}),
      ...(action?.y !== undefined ? { y: action.y } : {}),
      ...(action?.button ? { button: action.button } : {}),
      ...(action?.keys ? { keys: action.keys } : {}),
      ...(action?.direction ? { direction: action.direction } : {}),
      ...(action?.deltaX !== undefined ? { deltaX: action.deltaX } : {}),
      ...(action?.deltaY !== undefined ? { deltaY: action.deltaY } : {}),
      ...(action?.textLength !== undefined ? { textLength: action.textLength } : {}),
      ...(sensitive !== undefined ? { sensitive } : {}),
      ...(allowedApplications.length > 0 ? { allowedApplications } : {}),
    });
    state.proof = undefined;
  }

  finalizeSession(
    sessionId: string,
    options: { readonly completedAt?: Date | string; readonly title?: string } = {},
  ): WindowsComputerCaptureProof {
    requireRecorderText(sessionId, "sessionId", RECORDER_LABEL);
    const state = this.sessions.get(sessionId);
    if (!state || state.frames.length === 0) {
      throw new Error("Cannot finalize Windows computer capture proof without raw capture frames.");
    }
    if (state.proof) {
      return state.proof;
    }

    const startedAt = state.frames[0]!.capturedAt;
    const completedAt = normalizeRecorderTimestamp(options.completedAt ?? this.latestTimestamp(state), RECORDER_LABEL);
    const frameArtifactUris = uniqueRecorderStrings(state.frames.map((frame) => frame.artifactUri));
    const rawEvidence = {
      version: RAW_COMPUTER_CAPTURE_EVIDENCE_VERSION,
      sessionId,
      startedAt,
      completedAt,
      frameCount: state.frames.length,
      frames: state.frames,
    };
    const rawCapture = this.putJsonArtifact({
      sessionId,
      state,
      title: `Windows computer raw capture evidence: ${sessionId}`,
      value: rawEvidence,
    });
    const eventTrack = {
      version: COMPUTER_EVENT_TRACK_VERSION,
      sessionId,
      startedAt,
      completedAt,
      eventCount: state.operations.length,
      events: state.operations,
    };
    const eventTrackArtifact = this.putJsonArtifact({
      sessionId,
      state,
      title: `Windows computer event track: ${sessionId}`,
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
      state,
      title: `Windows computer recorder manifest: ${sessionId}`,
      value: manifest,
    });
    const proof: WindowsComputerCaptureProof = {
      sessionId,
      manifestId: manifest.manifestId,
      manifestUri: artifactContentUri(manifestArtifact),
      rawCaptureEvidenceUri,
      eventTrackUri,
      frameArtifactUris,
      frameCount: state.frames.length,
      eventCount: state.operations.length,
    };
    assertRecorderArtifactsReadable(this.artifactStore, [
      ...proof.frameArtifactUris,
      proof.rawCaptureEvidenceUri,
      proof.eventTrackUri,
      proof.manifestUri,
    ], RECORDER_LABEL);
    state.proof = proof;
    return proof;
  }

  getLastProof(sessionId: string): WindowsComputerCaptureProof | undefined {
    return this.sessions.get(sessionId)?.proof;
  }

  private stateFor(sessionId: string): ComputerCaptureSessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    const state: ComputerCaptureSessionState = { sessionId, frames: [], operations: [] };
    this.sessions.set(sessionId, state);
    return state;
  }

  private resolveScreenshotArtifactUri(
    state: ComputerCaptureSessionState,
    input: WindowsComputerOperationInput,
  ): string | undefined {
    if (input.screenshotUri) {
      this.assertScreenshotArtifact(input.screenshotUri);
      return input.screenshotUri;
    }
    if (!input.screenshotDataUrl) {
      return undefined;
    }
    const screenshot = parseScreenshotDataUrl(input.screenshotDataUrl);
    const artifact = this.artifactStore.put({
      namespace: recorderArtifactNamespace(input.sessionId),
      title: `Windows computer frame: ${input.sessionId} #${state.frames.length + 1}`,
      mimeType: screenshot.mimeType,
      content: { type: "blob", blob: screenshot.base64 },
      producer: { kind: "recorder", name: "windows-computer-capture-recorder" },
      retention: { scope: "session", maxArtifacts: this.proofRetentionMaxArtifacts(state, 4) },
    });
    return artifactContentUri(artifact);
  }

  private assertScreenshotArtifact(uri: string): void {
    validateArtifactContentUri(uri, RECORDER_LABEL);
    const reference = parseArtifactContentUri(uri, RECORDER_LABEL);
    const artifact = this.artifactStore.get(reference.namespace, reference.id);
    if (!artifact) {
      throw new Error("Windows computer capture screenshotUri artifact is missing.");
    }
    if (!artifact.mimeType.startsWith("image/")) {
      throw new Error("Windows computer capture screenshotUri must reference an image artifact.");
    }
  }

  private recordCaptureFrame(input: {
    readonly state: ComputerCaptureSessionState;
    readonly input: WindowsComputerOperationInput;
    readonly artifactUri: string;
    readonly capturedAt: string;
  }): void {
    const originMs = input.state.frames.length > 0
      ? Date.parse(input.state.frames[0]!.capturedAt)
      : Date.parse(input.capturedAt);
    input.state.frames.push({
      sessionId: input.input.sessionId,
      artifactUri: input.artifactUri,
      capturedAt: input.capturedAt,
      offsetMs: Math.max(0, Date.parse(input.capturedAt) - originMs),
      operation: input.input.operation,
      transport: input.input.transport ?? "desktop-capture",
      ...(input.input.provider ? { provider: input.input.provider } : {}),
      ...(input.input.application ? { application: input.input.application } : {}),
      ...(input.input.windowTitle ? { windowTitle: input.input.windowTitle } : {}),
      ...(input.input.width !== undefined ? { width: input.input.width } : {}),
      ...(input.input.height !== undefined ? { height: input.input.height } : {}),
    });
    input.state.proof = undefined;
  }

  private originMs(state: ComputerCaptureSessionState): number | undefined {
    return state.frames.length > 0 ? Date.parse(state.frames[0]!.capturedAt) : undefined;
  }

  private latestTimestamp(state: ComputerCaptureSessionState): string {
    const values = [
      ...state.frames.map((frame) => Date.parse(frame.capturedAt)),
      ...state.operations.map((operation) => Date.parse(operation.completedAt)),
    ];
    return new Date(Math.max(...values)).toISOString();
  }

  private putJsonArtifact(input: {
    readonly sessionId: string;
    readonly state: ComputerCaptureSessionState;
    readonly title: string;
    readonly value: unknown;
  }): ArtifactResourceMetadata {
    return this.artifactStore.put({
      namespace: recorderArtifactNamespace(input.sessionId),
      title: input.title,
      mimeType: "application/json",
      content: { type: "json", value: input.value },
      producer: { kind: "recorder", name: "windows-computer-capture-recorder" },
      retention: { scope: "session", maxArtifacts: this.proofRetentionMaxArtifacts(input.state, 3) },
    });
  }

  private proofRetentionMaxArtifacts(state: ComputerCaptureSessionState, proofArtifacts: number): number {
    return Math.max(this.retentionMaxArtifacts, state.frames.length + proofArtifacts);
  }

  private createManifest(input: {
    readonly state: ComputerCaptureSessionState;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly title?: string;
    readonly rawCaptureEvidenceUri: string;
    readonly rawCaptureSize: number;
    readonly eventTrackUri: string;
    readonly eventTrackSize: number;
    readonly frameArtifactUris: readonly string[];
  }): RecorderCaptureManifest {
    const latestFrame = input.state.frames[input.state.frames.length - 1]!;
    const manifestId = `${input.state.sessionId}-recorder-manifest`;
    const durationMs = Math.max(1, Date.parse(input.completedAt) - Date.parse(input.startedAt));
    const sensitive = input.state.operations.some((operation) => operation.sensitive === true);
    return createRecorderCaptureManifest({
      manifestId,
      kilnSessionId: input.state.sessionId,
      title: input.title ?? `Windows computer recorder proof: ${input.state.sessionId}`,
      createdAt: input.startedAt,
      updatedAt: input.completedAt,
      status: "captured",
      policy: {
        recordingConsent: this.recordingConsent,
        retention: { scope: "session", maxArtifacts: this.proofRetentionMaxArtifacts(input.state, 3) },
        redaction: { status: sensitive ? "pending" : "not_required", sensitive },
      },
      timeline: {
        timebase: "relative-ms",
        startedAt: input.startedAt,
        durationMs,
      },
      tracks: {
        rawCapture: [{
          id: `${input.state.sessionId}-raw-capture`,
          kind: "raw_capture",
          status: "captured",
          source: {
            kind: "computer_session",
            target: "computer",
            sessionId: input.state.sessionId,
            ...(latestFrame.application ? { application: latestFrame.application } : {}),
            ...(latestFrame.windowTitle ? { windowTitle: latestFrame.windowTitle } : {}),
          },
          capture: {
            transport: latestFrame.transport,
            format: RAW_COMPUTER_CAPTURE_FORMAT,
            startedAtOffsetMs: 0,
            durationMs,
            resource: {
              uri: input.rawCaptureEvidenceUri,
              relation: "raw_capture",
              title: "Windows computer raw capture evidence",
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
          id: `${input.state.sessionId}-computer-events`,
          kind: "event",
          eventKinds: uniqueRecorderStrings(input.state.operations.map((operation) => operation.toolName)),
          startedAtOffsetMs: 0,
          durationMs,
          resource: {
            uri: input.eventTrackUri,
            relation: "events",
            title: "Windows computer event track",
            mimeType: "application/json",
            sizeBytes: input.eventTrackSize,
          },
          evidence: [{
            kind: "artifact",
            id: "computer-event-track",
            uri: input.eventTrackUri,
          }],
        }],
        artifacts: [{
          id: `${input.state.sessionId}-computer-frame-artifacts`,
          kind: "artifact",
          artifactUris: input.frameArtifactUris,
          relation: "source_evidence",
        }],
        edits: [],
        exports: [],
        replay: [],
      },
    });
  }
}

function recorderArtifactNamespace(sessionId: string): string {
  return createRecorderArtifactNamespace(RECORDER_ARTIFACT_NAMESPACE_PREFIX, sessionId);
}

function parseScreenshotDataUrl(dataUrl: string): {
  readonly mimeType: string;
  readonly base64: string;
} {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/iu.exec(dataUrl);
  if (!match) {
    throw new Error("Windows computer capture screenshotDataUrl must be a base64 data URL.");
  }
  const mimeType = match[1]!.toLowerCase();
  if (!mimeType.startsWith("image/")) {
    throw new Error("Windows computer capture screenshotDataUrl must be an image data URL.");
  }
  return {
    mimeType,
    base64: match[2]!.replace(/\s+/gu, ""),
  };
}
