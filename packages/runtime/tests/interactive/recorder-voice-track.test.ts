import { describe, expect, it, vi } from "vitest";
import type { SttAdapter, TtsAdapter } from "@kilnai/core/engine";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import {
  RecorderVoiceTrackRecorder,
} from "../../src/index.js";

describe("RecorderVoiceTrackRecorder", () => {
  it("creates separate governed tracks for voice input, TTS narration, and microphone capture", async () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T21:00:05.000Z" });
    const sttAdapter: SttAdapter = {
      name: "test-stt",
      transcribe: vi.fn(async () => ({
        text: "Open the billing dashboard",
        confidence: 0.93,
        durationMs: 1200,
      })),
    };
    const ttsAdapter: TtsAdapter = {
      name: "test-tts",
      synthesize: vi.fn(async () => ({
        audio: new Uint8Array([4, 5, 6, 7]),
        mimeType: "audio/webm",
        durationMs: 900,
      })),
    };
    const recorder = new RecorderVoiceTrackRecorder({
      artifactStore,
      sttAdapter,
      ttsAdapter,
      retentionMaxArtifacts: 1,
    });

    const voiceInput = await recorder.recordVoiceInput({
      sessionId: "voice-session-1",
      capturedAt: "2026-05-14T21:00:00.000Z",
      audio: new Uint8Array([1, 2, 3]),
      mimeType: "audio/ogg",
      inputMode: "prompt",
      durationMs: 1200,
    });
    const narration = await recorder.recordTtsNarration({
      sessionId: "voice-session-1",
      startedAt: "2026-05-14T21:00:01.500Z",
      script: "The agent opens billing and checks the invoice status.",
      voice: "alloy",
      speed: 1.05,
      format: "audio/webm",
    });
    const microphone = await recorder.recordMicrophoneCapture({
      sessionId: "voice-session-1",
      capturedAt: "2026-05-14T21:00:02.500Z",
      audio: new Uint8Array([8, 9, 10, 11]),
      mimeType: "audio/wav",
      durationMs: 1600,
      label: "Human narration",
    });

    const proof = recorder.finalizeSession("voice-session-1", {
      completedAt: "2026-05-14T21:00:04.500Z",
      title: "Voice proof",
    });

    expect(sttAdapter.transcribe).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "audio/ogg");
    expect(ttsAdapter.synthesize).toHaveBeenCalledWith(
      "The agent opens billing and checks the invoice status.",
      { voice: "alloy", speed: 1.05, format: "audio/webm" },
    );
    expect(proof).toMatchObject({
      sessionId: "voice-session-1",
      manifestId: "voice-session-1-recorder-voice-manifest",
      voiceInputCount: 1,
      ttsNarrationCount: 1,
      microphoneCaptureCount: 1,
      audioArtifactUris: [
        voiceInput.audioArtifactUri,
        narration.audioArtifactUri,
        microphone.audioArtifactUri,
      ],
    });

    const voiceInputArtifact = readArtifact(artifactStore, voiceInput.audioArtifactUri);
    expect(voiceInputArtifact).toMatchObject({
      title: "Recorder voice input: voice-session-1 #1",
      mimeType: "audio/ogg",
      content: { type: "blob", blob: "AQID" },
      multimodal: {
        modality: "audio",
        durationMs: 1200,
        source: { kind: "uploaded-file", id: "voice-session-1:voice-input:1" },
      },
    });
    expect(readArtifact(artifactStore, narration.audioArtifactUri)).toMatchObject({
      title: "Recorder TTS narration: voice-session-1 #1",
      mimeType: "audio/webm",
      content: { type: "blob", blob: "BAUGBw==" },
      multimodal: {
        modality: "audio",
        durationMs: 900,
        source: { kind: "transform-output", id: "voice-session-1:tts-narration:1" },
      },
    });
    expect(readArtifact(artifactStore, microphone.audioArtifactUri)).toMatchObject({
      title: "Human narration",
      mimeType: "audio/wav",
      content: { type: "blob", blob: "CAkKCw==" },
      multimodal: {
        modality: "audio",
        durationMs: 1600,
        source: { kind: "uploaded-file", id: "voice-session-1:microphone-capture:1" },
      },
    });

    const voiceEvidence = readJsonArtifact(artifactStore, proof.voiceEvidenceUri);
    expect(voiceEvidence).toMatchObject({
      version: "recorder-voice-track.v1",
      sessionId: "voice-session-1",
      startedAt: "2026-05-14T21:00:00.000Z",
      completedAt: "2026-05-14T21:00:04.500Z",
      voiceInputCount: 1,
      ttsNarrationCount: 1,
      microphoneCaptureCount: 1,
      voiceInputs: [{
        audioArtifactUri: voiceInput.audioArtifactUri,
        transcript: "Open the billing dashboard",
        provider: "test-stt",
        inputMode: "prompt",
      }],
      ttsNarrations: [{
        audioArtifactUri: narration.audioArtifactUri,
        script: "The agent opens billing and checks the invoice status.",
        provider: "test-tts",
      }],
      microphoneCaptures: [{
        audioArtifactUri: microphone.audioArtifactUri,
      }],
    });

    const manifest = readJsonArtifact(artifactStore, proof.manifestUri) as {
      readonly status: string;
      readonly tracks: {
        readonly events: readonly [{
          readonly id: string;
          readonly eventKinds: readonly string[];
          readonly resource: { readonly uri: string; readonly relation: string };
        }];
        readonly artifacts: readonly [{
          readonly id: string;
          readonly artifactUris: readonly string[];
          readonly relation: string;
        }];
        readonly edits: readonly [{
          readonly id: string;
          readonly editKind: string;
          readonly text: string;
          readonly startedAtOffsetMs: number;
          readonly durationMs: number;
          readonly resource: { readonly uri: string; readonly relation: string; readonly mimeType: string };
        }];
      };
    };
    expect(manifest.status).toBe("captured");
    expect(manifest.tracks.events).toEqual([
      expect.objectContaining({
        id: "voice-session-1-voice-input-events",
        eventKinds: ["voice_input_transcribed"],
        resource: expect.objectContaining({
          uri: proof.voiceEvidenceUri,
          relation: "events",
        }),
      }),
    ]);
    expect(manifest.tracks.artifacts).toEqual([
      expect.objectContaining({
        id: "voice-session-1-voice-input-audio",
        relation: "source_evidence",
        artifactUris: [voiceInput.audioArtifactUri],
      }),
      expect.objectContaining({
        id: "voice-session-1-tts-narration-audio",
        relation: "source_evidence",
        artifactUris: [narration.audioArtifactUri],
      }),
      expect.objectContaining({
        id: "voice-session-1-microphone-capture-audio",
        relation: "source_evidence",
        artifactUris: [microphone.audioArtifactUri],
      }),
    ]);
    expect(manifest.tracks.edits).toEqual([
      expect.objectContaining({
        id: "voice-session-1-tts-voiceover-1",
        editKind: "voiceover",
        text: "The agent opens billing and checks the invoice status.",
        startedAtOffsetMs: 1500,
        durationMs: 900,
        resource: expect.objectContaining({
          uri: narration.audioArtifactUri,
          relation: "edit",
          mimeType: "audio/webm",
        }),
      }),
    ]);
  });

  it("keeps voice proof artifacts readable when recorder retention is below the proof footprint", async () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T22:00:05.000Z" });
    const recorder = new RecorderVoiceTrackRecorder({
      artifactStore,
      ttsAdapter: {
        name: "test-tts",
        synthesize: async () => ({
          audio: new Uint8Array([1, 1, 1]),
          mimeType: "audio/webm",
          durationMs: 700,
        }),
      },
      retentionMaxArtifacts: 1,
    });

    const microphone = await recorder.recordMicrophoneCapture({
      sessionId: "voice-low-retention",
      capturedAt: "2026-05-14T22:00:00.000Z",
      audio: new Uint8Array([2, 2]),
      mimeType: "audio/ogg",
      durationMs: 500,
    });
    const narration = await recorder.recordTtsNarration({
      sessionId: "voice-low-retention",
      startedAt: "2026-05-14T22:00:01.000Z",
      script: "Short narration",
    });

    const proof = recorder.finalizeSession("voice-low-retention", {
      completedAt: "2026-05-14T22:00:02.000Z",
    });

    expect(readArtifact(artifactStore, microphone.audioArtifactUri).mimeType).toBe("audio/ogg");
    expect(readArtifact(artifactStore, narration.audioArtifactUri).mimeType).toBe("audio/webm");
    expect(readArtifact(artifactStore, proof.voiceEvidenceUri).mimeType).toBe("application/json");
    expect(readArtifact(artifactStore, proof.manifestUri).mimeType).toBe("application/json");
  });

  it("fails closed for missing adapters, non-audio sources, missing artifacts, and empty sessions", async () => {
    const artifactStore = new MemoryArtifactResourceStore();
    const recorder = new RecorderVoiceTrackRecorder({ artifactStore });
    const jsonArtifact = artifactStore.put({
      namespace: "voice-test-artifacts",
      title: "not audio",
      mimeType: "application/json",
      content: { type: "json", value: { ok: true } },
      producer: { kind: "test", name: "recorder-voice-track-test" },
      retention: { scope: "session", maxArtifacts: 10 },
    });
    const jsonArtifactUri = `kiln://artifacts/${jsonArtifact.namespace}/${jsonArtifact.id}/content`;

    await expect(recorder.recordVoiceInput({
      sessionId: "voice-errors",
      audio: new Uint8Array([1]),
      mimeType: "audio/ogg",
      inputMode: "prompt",
    })).rejects.toThrow("Recorder voice input requires a SttAdapter.");

    await expect(recorder.recordTtsNarration({
      sessionId: "voice-errors",
      script: "No adapter",
    })).rejects.toThrow("Recorder TTS narration requires a TtsAdapter.");

    await expect(recorder.recordMicrophoneCapture({
      sessionId: "voice-errors",
      audio: new Uint8Array([1]),
      mimeType: "application/json",
    })).rejects.toThrow("Recorder voice track audio mimeType must start with audio/.");

    expect(() => recorder.recordMicrophoneCaptureArtifact({
      sessionId: "voice-errors",
      artifactUri: "kiln://artifacts/missing-audio/artifact_1/content",
      capturedAt: "2026-05-14T23:00:00.000Z",
    })).toThrow("Recorder voice track artifact is missing.");

    expect(() => recorder.recordMicrophoneCaptureArtifact({
      sessionId: "voice-errors",
      artifactUri: jsonArtifactUri,
      capturedAt: "2026-05-14T23:00:00.000Z",
    })).toThrow("Recorder voice track audio mimeType must start with audio/.");

    expect(() => recorder.finalizeSession("voice-empty")).toThrow(
      "Cannot finalize recorder voice tracks without voice evidence.",
    );

    const sttFailureStore = new MemoryArtifactResourceStore();
    const failingRecorder = new RecorderVoiceTrackRecorder({
      artifactStore: sttFailureStore,
      sttAdapter: {
        name: "failing-stt",
        transcribe: async () => {
          throw new Error("STT unavailable");
        },
      },
    });
    await expect(failingRecorder.recordVoiceInput({
      sessionId: "voice-stt-failure",
      audio: new Uint8Array([7, 7, 7]),
      mimeType: "audio/ogg",
      inputMode: "prompt",
    })).rejects.toThrow("STT unavailable");
    const [namespace] = sttFailureStore.listNamespaces();
    expect(namespace).toMatchObject({
      artifactCount: 1,
    });
    const [sourceArtifact] = sttFailureStore.list(namespace!.namespace);
    expect(sourceArtifact).toMatchObject({
      title: "Recorder voice input: voice-stt-failure #1",
      mimeType: "audio/ogg",
    });
  });
});

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
