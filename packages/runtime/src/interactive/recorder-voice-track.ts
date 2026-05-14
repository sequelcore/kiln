import {
  createRecorderCaptureManifest,
  type ArtifactResource,
  type ArtifactResourceMetadata,
  type ArtifactResourceStore,
  type RecorderArtifactTrack,
  type RecorderCaptureManifest,
  type RecorderEditTrack,
  type RecorderEventTrack,
  type SttAdapter,
  type TtsAdapter,
  type TtsOptions,
  type TtsResult,
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

const RECORDER_VOICE_TRACK_EVIDENCE_VERSION = "recorder-voice-track.v1";
const RECORDER_ARTIFACT_NAMESPACE_PREFIX = "recorder-voice-track";
const DEFAULT_RETENTION_MAX_ARTIFACTS = 50;
const MIN_VOICE_PROOF_ARTIFACTS = 2;
const RECORDER_LABEL = "Recorder voice track";

export type RecorderVoiceInputMode = "prompt" | "correction";

export interface RecorderVoiceTrackRecorderOptions {
  readonly artifactStore: ArtifactResourceStore;
  readonly sttAdapter?: SttAdapter;
  readonly ttsAdapter?: TtsAdapter;
  readonly now?: () => Date;
  readonly retentionMaxArtifacts?: number;
}

export interface RecorderVoiceInputOptions {
  readonly sessionId: string;
  readonly capturedAt?: Date | string;
  readonly audio: Uint8Array;
  readonly mimeType: string;
  readonly inputMode: RecorderVoiceInputMode;
  readonly durationMs?: number;
}

export interface RecorderTtsNarrationOptions {
  readonly sessionId: string;
  readonly startedAt?: Date | string;
  readonly script: string;
  readonly voice?: string;
  readonly speed?: number;
  readonly format?: string;
  readonly durationMs?: number;
}

export interface RecorderMicrophoneCaptureOptions {
  readonly sessionId: string;
  readonly capturedAt?: Date | string;
  readonly audio: Uint8Array;
  readonly mimeType: string;
  readonly durationMs?: number;
  readonly label?: string;
}

export interface RecorderMicrophoneCaptureArtifactOptions {
  readonly sessionId: string;
  readonly capturedAt?: Date | string;
  readonly artifactUri: string;
  readonly durationMs?: number;
  readonly label?: string;
}

export interface RecorderVoiceInputRecord {
  readonly audioArtifactUri: string;
  readonly transcript: string;
  readonly provider: string;
  readonly confidence?: number;
  readonly durationMs?: number;
}

export interface RecorderTtsNarrationRecord {
  readonly audioArtifactUri: string;
  readonly script: string;
  readonly provider: string;
  readonly durationMs?: number;
}

export interface RecorderMicrophoneCaptureRecord {
  readonly audioArtifactUri: string;
  readonly durationMs?: number;
}

export interface RecorderVoiceTrackProof {
  readonly sessionId: string;
  readonly manifestId: string;
  readonly manifestUri: string;
  readonly voiceEvidenceUri: string;
  readonly audioArtifactUris: readonly string[];
  readonly voiceInputCount: number;
  readonly ttsNarrationCount: number;
  readonly microphoneCaptureCount: number;
}

interface VoiceInputState {
  readonly id: string;
  readonly audioArtifactUri: string;
  readonly capturedAt: string;
  readonly offsetMs: number;
  readonly inputMode: RecorderVoiceInputMode;
  readonly transcript: string;
  readonly provider: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly confidence?: number;
  readonly durationMs?: number;
}

interface TtsNarrationState {
  readonly id: string;
  readonly audioArtifactUri: string;
  readonly startedAt: string;
  readonly offsetMs: number;
  readonly script: string;
  readonly provider: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly voice?: string;
  readonly speed?: number;
  readonly format?: string;
  readonly durationMs?: number;
}

interface MicrophoneCaptureState {
  readonly id: string;
  readonly audioArtifactUri: string;
  readonly capturedAt: string;
  readonly offsetMs: number;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly label?: string;
  readonly durationMs?: number;
}

interface VoiceSessionState {
  readonly sessionId: string;
  readonly voiceInputs: VoiceInputState[];
  readonly ttsNarrations: TtsNarrationState[];
  readonly microphoneCaptures: MicrophoneCaptureState[];
  proof?: RecorderVoiceTrackProof;
}

export class RecorderVoiceTrackRecorder {
  private readonly artifactStore: ArtifactResourceStore;
  private readonly sttAdapter?: SttAdapter;
  private readonly ttsAdapter?: TtsAdapter;
  private readonly now: () => Date;
  private readonly retentionMaxArtifacts: number;
  private readonly sessions = new Map<string, VoiceSessionState>();

  constructor(options: RecorderVoiceTrackRecorderOptions) {
    this.artifactStore = options.artifactStore;
    this.sttAdapter = options.sttAdapter;
    this.ttsAdapter = options.ttsAdapter;
    this.now = options.now ?? (() => new Date());
    this.retentionMaxArtifacts = normalizeRecorderRetentionMaxArtifacts({
      value: options.retentionMaxArtifacts,
      defaultValue: DEFAULT_RETENTION_MAX_ARTIFACTS,
      minimumValue: MIN_VOICE_PROOF_ARTIFACTS,
      label: RECORDER_LABEL,
    });
  }

  async recordVoiceInput(input: RecorderVoiceInputOptions): Promise<RecorderVoiceInputRecord> {
    requireRecorderText(input.sessionId, "sessionId", RECORDER_LABEL);
    validateInputMode(input.inputMode);
    validateAudioSource(input.audio, input.mimeType);
    if (!this.sttAdapter) {
      throw new Error("Recorder voice input requires a SttAdapter.");
    }
    const state = this.stateFor(input.sessionId);
    const capturedAt = normalizeRecorderTimestamp(input.capturedAt ?? this.now(), RECORDER_LABEL);
    const sequence = state.voiceInputs.length + 1;
    const audioArtifact = this.putAudioArtifact({
      state,
      title: `Recorder voice input: ${input.sessionId} #${sequence}`,
      data: input.audio,
      mimeType: input.mimeType,
      durationMs: input.durationMs,
      sourceKind: "uploaded-file",
      sourceId: `${input.sessionId}:voice-input:${sequence}`,
    });
    const audioArtifactUri = artifactContentUri(audioArtifact);
    const transcription = await this.sttAdapter.transcribe(input.audio, input.mimeType);
    const durationMs = input.durationMs ?? transcription.durationMs;
    state.voiceInputs.push({
      id: `${input.sessionId}-voice-input-${sequence}`,
      audioArtifactUri,
      capturedAt,
      offsetMs: this.offsetMs(state, capturedAt),
      inputMode: input.inputMode,
      transcript: transcription.text,
      provider: this.sttAdapter.name,
      mimeType: input.mimeType,
      sizeBytes: audioArtifact.size,
      ...(transcription.confidence !== undefined ? { confidence: transcription.confidence } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
    state.proof = undefined;
    return {
      audioArtifactUri,
      transcript: transcription.text,
      provider: this.sttAdapter.name,
      ...(transcription.confidence !== undefined ? { confidence: transcription.confidence } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  }

  async recordTtsNarration(input: RecorderTtsNarrationOptions): Promise<RecorderTtsNarrationRecord> {
    requireRecorderText(input.sessionId, "sessionId", RECORDER_LABEL);
    requireRecorderText(input.script, "script", RECORDER_LABEL);
    if (!this.ttsAdapter) {
      throw new Error("Recorder TTS narration requires a TtsAdapter.");
    }
    const state = this.stateFor(input.sessionId);
    const startedAt = normalizeRecorderTimestamp(input.startedAt ?? this.now(), RECORDER_LABEL);
    const ttsOptions = ttsOptionsFor(input);
    const result = await this.ttsAdapter.synthesize(input.script, ttsOptions);
    validateTtsResult(result);
    const durationMs = input.durationMs ?? result.durationMs;
    const sequence = state.ttsNarrations.length + 1;
    const audioArtifact = this.putAudioArtifact({
      state,
      title: `Recorder TTS narration: ${input.sessionId} #${sequence}`,
      data: result.audio,
      mimeType: result.mimeType,
      durationMs,
      sourceKind: "transform-output",
      sourceId: `${input.sessionId}:tts-narration:${sequence}`,
    });
    const audioArtifactUri = artifactContentUri(audioArtifact);
    state.ttsNarrations.push({
      id: `${input.sessionId}-tts-narration-${sequence}`,
      audioArtifactUri,
      startedAt,
      offsetMs: this.offsetMs(state, startedAt),
      script: input.script,
      provider: this.ttsAdapter.name,
      mimeType: result.mimeType,
      sizeBytes: audioArtifact.size,
      ...(input.voice !== undefined ? { voice: input.voice } : {}),
      ...(input.speed !== undefined ? { speed: input.speed } : {}),
      ...(input.format !== undefined ? { format: input.format } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
    state.proof = undefined;
    return {
      audioArtifactUri,
      script: input.script,
      provider: this.ttsAdapter.name,
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  }

  async recordMicrophoneCapture(
    input: RecorderMicrophoneCaptureOptions,
  ): Promise<RecorderMicrophoneCaptureRecord> {
    requireRecorderText(input.sessionId, "sessionId", RECORDER_LABEL);
    validateAudioSource(input.audio, input.mimeType);
    const state = this.stateFor(input.sessionId);
    const capturedAt = normalizeRecorderTimestamp(input.capturedAt ?? this.now(), RECORDER_LABEL);
    const sequence = state.microphoneCaptures.length + 1;
    const audioArtifact = this.putAudioArtifact({
      state,
      title: input.label ?? `Recorder microphone capture: ${input.sessionId} #${sequence}`,
      data: input.audio,
      mimeType: input.mimeType,
      durationMs: input.durationMs,
      sourceKind: "uploaded-file",
      sourceId: `${input.sessionId}:microphone-capture:${sequence}`,
    });
    const audioArtifactUri = artifactContentUri(audioArtifact);
    state.microphoneCaptures.push({
      id: `${input.sessionId}-microphone-capture-${sequence}`,
      audioArtifactUri,
      capturedAt,
      offsetMs: this.offsetMs(state, capturedAt),
      mimeType: input.mimeType,
      sizeBytes: audioArtifact.size,
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    });
    state.proof = undefined;
    return {
      audioArtifactUri,
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    };
  }

  recordMicrophoneCaptureArtifact(
    input: RecorderMicrophoneCaptureArtifactOptions,
  ): RecorderMicrophoneCaptureRecord {
    requireRecorderText(input.sessionId, "sessionId", RECORDER_LABEL);
    validateArtifactContentUri(input.artifactUri, RECORDER_LABEL);
    const artifact = this.readAudioArtifact(input.artifactUri);
    const state = this.stateFor(input.sessionId);
    const capturedAt = normalizeRecorderTimestamp(input.capturedAt ?? this.now(), RECORDER_LABEL);
    const sequence = state.microphoneCaptures.length + 1;
    state.microphoneCaptures.push({
      id: `${input.sessionId}-microphone-capture-${sequence}`,
      audioArtifactUri: input.artifactUri,
      capturedAt,
      offsetMs: this.offsetMs(state, capturedAt),
      mimeType: artifact.mimeType,
      sizeBytes: artifact.size,
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    });
    state.proof = undefined;
    return {
      audioArtifactUri: input.artifactUri,
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    };
  }

  finalizeSession(
    sessionId: string,
    options: { readonly completedAt?: Date | string; readonly title?: string } = {},
  ): RecorderVoiceTrackProof {
    requireRecorderText(sessionId, "sessionId", RECORDER_LABEL);
    const state = this.sessions.get(sessionId);
    if (!state || voiceTrackCount(state) === 0) {
      throw new Error("Cannot finalize recorder voice tracks without voice evidence.");
    }
    if (state.proof) {
      return state.proof;
    }

    const startedAt = this.startedAt(state);
    const completedAt = normalizeRecorderTimestamp(options.completedAt ?? this.latestTimestamp(state), RECORDER_LABEL);
    const voiceEvidence = {
      version: RECORDER_VOICE_TRACK_EVIDENCE_VERSION,
      sessionId,
      startedAt,
      completedAt,
      voiceInputCount: state.voiceInputs.length,
      ttsNarrationCount: state.ttsNarrations.length,
      microphoneCaptureCount: state.microphoneCaptures.length,
      voiceInputs: state.voiceInputs,
      ttsNarrations: state.ttsNarrations,
      microphoneCaptures: state.microphoneCaptures,
    };
    const evidenceArtifact = this.putJsonArtifact({
      state,
      title: `Recorder voice evidence: ${sessionId}`,
      value: voiceEvidence,
    });
    const voiceEvidenceUri = artifactContentUri(evidenceArtifact);
    const audioArtifactUris = audioArtifactUrisFor(state);
    const manifest = this.createManifest({
      state,
      title: options.title,
      startedAt,
      completedAt,
      voiceEvidenceUri,
      voiceEvidenceSize: evidenceArtifact.size,
      audioArtifactUris,
    });
    const manifestArtifact = this.putJsonArtifact({
      state,
      title: `Recorder voice manifest: ${sessionId}`,
      value: manifest,
    });
    const proof: RecorderVoiceTrackProof = {
      sessionId,
      manifestId: manifest.manifestId,
      manifestUri: artifactContentUri(manifestArtifact),
      voiceEvidenceUri,
      audioArtifactUris,
      voiceInputCount: state.voiceInputs.length,
      ttsNarrationCount: state.ttsNarrations.length,
      microphoneCaptureCount: state.microphoneCaptures.length,
    };
    assertRecorderArtifactsReadable(this.artifactStore, [
      ...proof.audioArtifactUris,
      proof.voiceEvidenceUri,
      proof.manifestUri,
    ], RECORDER_LABEL);
    state.proof = proof;
    return proof;
  }

  private stateFor(sessionId: string): VoiceSessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    const state: VoiceSessionState = {
      sessionId,
      voiceInputs: [],
      ttsNarrations: [],
      microphoneCaptures: [],
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  private putAudioArtifact(input: {
    readonly state: VoiceSessionState;
    readonly title: string;
    readonly data: Uint8Array;
    readonly mimeType: string;
    readonly durationMs?: number;
    readonly sourceKind: "uploaded-file" | "transform-output";
    readonly sourceId: string;
  }): ArtifactResourceMetadata {
    return this.artifactStore.put({
      namespace: recorderArtifactNamespace(input.state.sessionId),
      title: input.title,
      mimeType: input.mimeType,
      content: { type: "blob", blob: Buffer.from(input.data).toString("base64") },
      producer: { kind: "recorder", name: "recorder-voice-track" },
      retention: { scope: "session", maxArtifacts: this.proofRetentionMaxArtifacts(input.state, 3) },
      multimodal: {
        modality: "audio",
        source: { kind: input.sourceKind, id: input.sourceId },
        ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      },
    });
  }

  private putJsonArtifact(input: {
    readonly state: VoiceSessionState;
    readonly title: string;
    readonly value: unknown;
  }): ArtifactResourceMetadata {
    return this.artifactStore.put({
      namespace: recorderArtifactNamespace(input.state.sessionId),
      title: input.title,
      mimeType: "application/json",
      content: { type: "json", value: input.value },
      producer: { kind: "recorder", name: "recorder-voice-track" },
      retention: { scope: "session", maxArtifacts: this.proofRetentionMaxArtifacts(input.state, 2) },
    });
  }

  private readAudioArtifact(uri: string): ArtifactResource {
    const reference = parseArtifactContentUri(uri, RECORDER_LABEL);
    const artifact = this.artifactStore.get(reference.namespace, reference.id);
    if (!artifact) {
      throw new Error("Recorder voice track artifact is missing.");
    }
    validateAudioMimeType(artifact.mimeType);
    return artifact;
  }

  private createManifest(input: {
    readonly state: VoiceSessionState;
    readonly title?: string;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly voiceEvidenceUri: string;
    readonly voiceEvidenceSize: number;
    readonly audioArtifactUris: readonly string[];
  }): RecorderCaptureManifest {
    const durationMs = Math.max(1, Date.parse(input.completedAt) - Date.parse(input.startedAt));
    return createRecorderCaptureManifest({
      manifestId: `${input.state.sessionId}-recorder-voice-manifest`,
      kilnSessionId: input.state.sessionId,
      title: input.title ?? `Recorder voice proof: ${input.state.sessionId}`,
      createdAt: input.startedAt,
      updatedAt: input.completedAt,
      status: "captured",
      policy: {
        recordingConsent: "operator-approved",
        retention: { scope: "session", maxArtifacts: this.proofRetentionMaxArtifacts(input.state, 2) },
        redaction: { status: "pending", sensitive: true },
      },
      timeline: {
        timebase: "relative-ms",
        startedAt: input.startedAt,
        durationMs,
      },
      tracks: {
        rawCapture: [],
        events: this.eventTracks(input.state, input.voiceEvidenceUri, input.voiceEvidenceSize),
        artifacts: this.artifactTracks(input.state),
        edits: this.voiceoverEdits(input.state),
        exports: [],
        replay: [],
      },
    });
  }

  private eventTracks(
    state: VoiceSessionState,
    voiceEvidenceUri: string,
    voiceEvidenceSize: number,
  ): readonly RecorderEventTrack[] {
    if (state.voiceInputs.length === 0) {
      return [];
    }
    const startedAtOffsetMs = Math.min(...state.voiceInputs.map((entry) => entry.offsetMs));
    const durationMs = Math.max(
      1,
      ...state.voiceInputs.map((entry) => entry.offsetMs + (entry.durationMs ?? 1) - startedAtOffsetMs),
    );
    return [{
      id: `${state.sessionId}-voice-input-events`,
      kind: "event",
      status: "ready",
      eventKinds: ["voice_input_transcribed"],
      startedAtOffsetMs,
      durationMs,
      resource: {
        uri: voiceEvidenceUri,
        relation: "events",
        title: "Recorder voice input transcription evidence",
        mimeType: "application/json",
        sizeBytes: voiceEvidenceSize,
      },
      evidence: state.voiceInputs.map((entry) => ({
        kind: "artifact",
        id: entry.id,
        uri: entry.audioArtifactUri,
      })),
    }];
  }

  private artifactTracks(state: VoiceSessionState): readonly RecorderArtifactTrack[] {
    const tracks: RecorderArtifactTrack[] = [];
    if (state.voiceInputs.length > 0) {
      tracks.push({
        id: `${state.sessionId}-voice-input-audio`,
        kind: "artifact",
        status: "ready",
        artifactUris: uniqueRecorderStrings(state.voiceInputs.map((entry) => entry.audioArtifactUri)),
        relation: "source_evidence",
      });
    }
    if (state.ttsNarrations.length > 0) {
      tracks.push({
        id: `${state.sessionId}-tts-narration-audio`,
        kind: "artifact",
        status: "ready",
        artifactUris: uniqueRecorderStrings(state.ttsNarrations.map((entry) => entry.audioArtifactUri)),
        relation: "source_evidence",
      });
    }
    if (state.microphoneCaptures.length > 0) {
      tracks.push({
        id: `${state.sessionId}-microphone-capture-audio`,
        kind: "artifact",
        status: "ready",
        artifactUris: uniqueRecorderStrings(state.microphoneCaptures.map((entry) => entry.audioArtifactUri)),
        relation: "source_evidence",
      });
    }
    return tracks;
  }

  private voiceoverEdits(state: VoiceSessionState): readonly RecorderEditTrack[] {
    return state.ttsNarrations.map((entry, index) => ({
      id: `${state.sessionId}-tts-voiceover-${index + 1}`,
      kind: "edit",
      status: "ready",
      editKind: "voiceover",
      startedAtOffsetMs: entry.offsetMs,
      ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
      text: entry.script,
      resource: {
        uri: entry.audioArtifactUri,
        relation: "edit",
        title: "TTS narration audio",
        mimeType: entry.mimeType,
        sizeBytes: entry.sizeBytes,
      },
      evidence: [{
        kind: "artifact",
        id: entry.id,
        uri: entry.audioArtifactUri,
      }],
    }));
  }

  private offsetMs(state: VoiceSessionState, timestamp: string): number {
    const originMs = this.originMs(state) ?? Date.parse(timestamp);
    return Math.max(0, Date.parse(timestamp) - originMs);
  }

  private originMs(state: VoiceSessionState): number | undefined {
    const timestamps = trackTimestamps(state);
    if (timestamps.length === 0) {
      return undefined;
    }
    return Math.min(...timestamps.map((timestamp) => Date.parse(timestamp)));
  }

  private startedAt(state: VoiceSessionState): string {
    const timestamps = trackTimestamps(state);
    return new Date(Math.min(...timestamps.map((timestamp) => Date.parse(timestamp)))).toISOString();
  }

  private latestTimestamp(state: VoiceSessionState): string {
    const values = [
      ...state.voiceInputs.map((entry) => Date.parse(entry.capturedAt) + (entry.durationMs ?? 1)),
      ...state.ttsNarrations.map((entry) => Date.parse(entry.startedAt) + (entry.durationMs ?? 1)),
      ...state.microphoneCaptures.map((entry) => Date.parse(entry.capturedAt) + (entry.durationMs ?? 1)),
    ];
    return new Date(Math.max(...values)).toISOString();
  }

  private proofRetentionMaxArtifacts(state: VoiceSessionState, proofArtifacts: number): number {
    return Math.max(this.retentionMaxArtifacts, audioArtifactUrisFor(state).length + proofArtifacts);
  }
}

function recorderArtifactNamespace(sessionId: string): string {
  return createRecorderArtifactNamespace(RECORDER_ARTIFACT_NAMESPACE_PREFIX, sessionId);
}

function validateInputMode(inputMode: RecorderVoiceInputMode): void {
  if (inputMode !== "prompt" && inputMode !== "correction") {
    throw new Error("Recorder voice track inputMode must be prompt or correction.");
  }
}

function validateAudioSource(audio: Uint8Array, mimeType: string): void {
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
    throw new Error("Recorder voice track audio is required.");
  }
  validateAudioMimeType(mimeType);
}

function validateAudioMimeType(mimeType: string): void {
  if (typeof mimeType !== "string" || !mimeType.startsWith("audio/")) {
    throw new Error("Recorder voice track audio mimeType must start with audio/.");
  }
}

function validateTtsResult(result: TtsResult): void {
  validateAudioSource(result.audio, result.mimeType);
}

function ttsOptionsFor(input: RecorderTtsNarrationOptions): TtsOptions | undefined {
  const options: TtsOptions = {
    ...(input.voice !== undefined ? { voice: input.voice } : {}),
    ...(input.speed !== undefined ? { speed: input.speed } : {}),
    ...(input.format !== undefined ? { format: input.format } : {}),
  };
  return Object.keys(options).length > 0 ? options : undefined;
}

function trackTimestamps(state: VoiceSessionState): readonly string[] {
  return [
    ...state.voiceInputs.map((entry) => entry.capturedAt),
    ...state.ttsNarrations.map((entry) => entry.startedAt),
    ...state.microphoneCaptures.map((entry) => entry.capturedAt),
  ];
}

function voiceTrackCount(state: VoiceSessionState): number {
  return state.voiceInputs.length + state.ttsNarrations.length + state.microphoneCaptures.length;
}

function audioArtifactUrisFor(state: VoiceSessionState): readonly string[] {
  return uniqueRecorderStrings([
    ...state.voiceInputs.map((entry) => entry.audioArtifactUri),
    ...state.ttsNarrations.map((entry) => entry.audioArtifactUri),
    ...state.microphoneCaptures.map((entry) => entry.audioArtifactUri),
  ]);
}
