// Governed text-to-speech transform route for gateway assistant output.

import type {
  ArtifactResourceStore,
  ContentPart,
  MultimodalRoutedEvent,
  TtsAdapter,
  TtsOptions,
  VoiceConfig,
  VoiceFailureMode,
  VoiceOutputMode,
  VoiceSurface,
} from "@kilnai/core";
import {
  extractText,
  KilnError,
  projectMultimodalArtifactResource,
  VALID_VOICE_SURFACES,
} from "@kilnai/core";
import { selectVoiceOutputIntent } from "./voice-output-intent-selector.js";
import type { EffectiveAuthorityAdmissionBundle } from "../session/effective-authority-admission-bundle.js";
import {
  dispatchRuntimeMediaAction,
  RuntimeMediaActionClaimedError,
  runtimeMediaActionDigest,
  type RuntimeMediaActionClaimContext,
} from "../execution-kernel/runtime-media-action-claim.js";

export interface VoiceOutputSynthesisEvidence {
  readonly transform: "speech-synthesis";
  readonly status: "succeeded" | "failed";
  readonly requestedCapability: "speech-synthesis";
  readonly sourceModality: "text";
  readonly outputModality: "audio";
  readonly provider: string;
  readonly provenance: string;
  readonly degradation: string;
  readonly outputArtifactUri?: string;
  readonly outputMimeType?: string;
  readonly outputBytes?: number;
  readonly durationMs?: number;
  readonly errorMessage?: string;
}

export interface VoiceOutputSynthesisResult {
  readonly parts: readonly ContentPart[];
  readonly transforms: readonly VoiceOutputSynthesisEvidence[];
  readonly events: readonly MultimodalRoutedEvent[];
  readonly voiceOutput?: {
    readonly artifactUris: readonly string[];
    readonly provider: string;
    readonly model?: string;
    readonly surface: VoiceSurface;
    readonly mode: Exclude<VoiceOutputMode, "transcript-only">;
  };
}

export interface VoiceOutputSynthesisOptions {
  readonly artifactStore?: ArtifactResourceStore;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly channel: string;
  readonly sessionId: string;
  readonly model: string;
  readonly voiceProfile?: string;
  readonly voiceOutputIntent?: string;
  readonly escalationReason?: string;
  readonly retentionMaxArtifacts?: number;
  /** Consequential TTS requires a workload-owned durable action-claim owner. */
  readonly mediaActionClaims?: RuntimeMediaActionClaimContext;
  readonly authorityAdmission?: EffectiveAuthorityAdmissionBundle;
  readonly attemptId?: string;
  readonly callerId?: string;
  readonly idempotencyKey?: string;
  readonly logicalSendSlot?: string;
  readonly abortSignal?: AbortSignal;
}

const VOICE_SYNTHESIS_NAMESPACE = "voice-synthesis";
const SYNTHESIS_DEGRADATION =
  "Assistant text is transformed to audio after egress policy; the text response remains the canonical source.";

export async function synthesizeVoiceOutput(
  parts: readonly ContentPart[],
  voiceConfig: VoiceConfig | undefined,
  tts: TtsAdapter | undefined,
  options: VoiceOutputSynthesisOptions,
): Promise<VoiceOutputSynthesisResult> {
  return synthesizeVoiceOutputInternal(parts, voiceConfig, tts, options, "automatic");
}

export async function synthesizeVoiceOutputOnDemand(
  parts: readonly ContentPart[],
  voiceConfig: VoiceConfig | undefined,
  tts: TtsAdapter | undefined,
  options: VoiceOutputSynthesisOptions,
): Promise<VoiceOutputSynthesisResult> {
  return synthesizeVoiceOutputInternal(parts, voiceConfig, tts, options, "on-demand");
}

async function synthesizeVoiceOutputInternal(
  parts: readonly ContentPart[],
  voiceConfig: VoiceConfig | undefined,
  tts: TtsAdapter | undefined,
  options: VoiceOutputSynthesisOptions,
  trigger: "automatic" | "on-demand",
): Promise<VoiceOutputSynthesisResult> {
  const surface = toVoiceSurface(options.channel);
  if (!voiceConfig || !surface || resultIsQueuedOrEmpty(parts)) {
    return { parts, transforms: [], events: [] };
  }

  const surfacePolicy = voiceConfig.policy?.surfaces?.[surface];
  if (surfacePolicy?.enabled === false) {
    return { parts, transforms: [], events: [] };
  }

  const outputModes = surfacePolicy?.output?.modes ?? ["transcript-only"];
  const mode = trigger === "on-demand"
    ? onDemandAudioOutputMode(outputModes)
    : automaticAudioOutputMode(outputModes);
  if (!mode) {
    return { parts, transforms: [], events: [] };
  }

  const failureMode = surfacePolicy?.output?.failureMode
    ?? voiceConfig.policy?.defaultOutputFailureMode
    ?? "fail-closed";

  if (!tts) {
    return handleSynthesisFailure({
      parts,
      provider: voiceConfig.tts.provider,
      failureMode,
      errorMessage: "Voice output requested but no TTS adapter is configured.",
      options,
    });
  }

  const text = extractText(parts).trim();
  if (!text) {
    return { parts, transforms: [], events: [] };
  }

  try {
    const ttsOptions = resolveTtsOptions(voiceConfig, {
      parts,
      voiceProfile: options.voiceProfile,
      voiceOutputIntent: options.voiceOutputIntent,
      escalationReason: options.escalationReason,
    });
    const textFingerprint = runtimeMediaActionDigest(text);
    const shouldStore = voiceConfig.policy?.artifacts?.storeSynthesizedAudio !== false;
    const dispatched = await dispatchRuntimeMediaAction({
      context: requireMediaActionContext(options),
      authorityAdmission: options.authorityAdmission,
      attemptId: options.attemptId!,
      callerId: options.callerId!,
      idempotencyKey: options.idempotencyKey!,
      actionKind: "tts-synthesize",
      sourceIdentity: `text:${textFingerprint}`,
      adapterIdentity: `tts:${tts.name}`,
      logicalSendSlot: options.logicalSendSlot ?? "assistant-tts",
      payload: { textFingerprint, ttsOptions },
      abortSignal: options.abortSignal,
      call: async () => {
        const result = await tts.synthesize(text, { ...ttsOptions, signal: options.abortSignal });
        if (result.audio.byteLength === 0 || !result.mimeType.startsWith("audio/")) {
          throw new KilnError("TTS_FAILED", "TTS provider returned invalid audio output", {
            context: { provider: tts.name, mimeType: result.mimeType, size: result.audio.byteLength },
          });
        }
        const artifactUri = shouldStore && options.artifactStore
          ? persistSynthesizedAudio({
              artifactStore: options.artifactStore,
              audio: result.audio,
              mimeType: result.mimeType,
              durationMs: result.durationMs,
              sourceId: `${options.appName}:${options.tenantId}:${options.userId}:${surface}:assistant-output`,
              retentionMaxArtifacts: options.retentionMaxArtifacts ?? voiceConfig.policy?.artifacts?.retentionMaxArtifacts,
            })
          : undefined;
        return { result, artifactUri };
      },
    });
    const { result, artifactUri } = dispatched;

    const evidence: VoiceOutputSynthesisEvidence = {
      transform: "speech-synthesis",
      status: "succeeded",
      requestedCapability: "speech-synthesis",
      sourceModality: "text",
      outputModality: "audio",
      provider: tts.name,
      provenance: `tts:${tts.name}`,
      degradation: SYNTHESIS_DEGRADATION,
      ...(artifactUri ? { outputArtifactUri: artifactUri } : {}),
      outputMimeType: result.mimeType,
      outputBytes: result.audio.byteLength,
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    };
    const audioPart: ContentPart = {
      type: "audio",
      mimeType: result.mimeType,
      data: Buffer.from(result.audio).toString("base64"),
      ...(artifactUri ? { artifactUri } : {}),
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    };
    const nextParts = mode === "audio-response" || mode === "audio-on-demand"
      ? [...parts, audioPart]
      : parts;
    const events = [toRoutingEvent(evidence, {
      sessionId: options.sessionId,
      tenantId: options.tenantId,
      provider: tts.name,
      model: voiceConfig.tts.model ?? options.model,
    })];

    return {
      parts: nextParts,
      transforms: [evidence],
      events,
      voiceOutput: {
        artifactUris: artifactUri ? [artifactUri] : [],
        provider: tts.name,
        ...(voiceConfig.tts.model ? { model: voiceConfig.tts.model } : {}),
        surface,
        mode,
      },
    };
  } catch (error) {
    if (error instanceof RuntimeMediaActionClaimedError) {
      throw error;
    }
    return handleSynthesisFailure({
      parts,
      provider: tts.name,
      failureMode,
      errorMessage: error instanceof Error ? error.message : String(error),
      options,
    });
  }
}

function requireMediaActionContext(options: VoiceOutputSynthesisOptions): RuntimeMediaActionClaimContext {
  if (!options.mediaActionClaims || !options.authorityAdmission || !options.attemptId
    || !options.callerId || !options.idempotencyKey) {
    throw new Error(
      "Consequential TTS requires a workload-owned media action claim bound to the complete authority admission.",
    );
  }
  return options.mediaActionClaims;
}

function resolveTtsOptions(
  voiceConfig: VoiceConfig,
  input: {
    readonly parts: readonly ContentPart[];
    readonly voiceProfile?: string;
    readonly voiceOutputIntent?: string;
    readonly escalationReason?: string;
  },
): TtsOptions {
  const profileId = input.voiceProfile ?? voiceConfig.defaults?.ttsProfile;
  const profile = profileId ? voiceConfig.ttsProfiles?.[profileId] : undefined;
  const intentId = selectVoiceOutputIntent({
    parts: input.parts,
    voiceConfig,
    voiceProfile: input.voiceProfile,
    explicitIntent: input.voiceOutputIntent,
    escalationReason: input.escalationReason,
  });
  const intent = intentId ? profile?.intents?.[intentId] : undefined;

  return {
    ...(voiceConfig.tts.voice !== undefined ? { voice: voiceConfig.tts.voice } : {}),
    ...(voiceConfig.tts.format !== undefined ? { format: voiceConfig.tts.format } : {}),
    ...(profile?.voice !== undefined ? { voice: profile.voice } : {}),
    ...(profile?.language !== undefined ? { language: profile.language } : {}),
    ...(profile?.speed !== undefined ? { speed: profile.speed } : {}),
    ...(profile?.format !== undefined ? { format: profile.format } : {}),
    ...(intent?.voice !== undefined ? { voice: intent.voice } : {}),
    ...(intent?.language !== undefined ? { language: intent.language } : {}),
    ...(intent?.speed !== undefined ? { speed: intent.speed } : {}),
    ...(intent?.format !== undefined ? { format: intent.format } : {}),
  };
}

function persistSynthesizedAudio(input: {
  readonly artifactStore: ArtifactResourceStore;
  readonly audio: Uint8Array;
  readonly mimeType: string;
  readonly durationMs?: number;
  readonly sourceId: string;
  readonly retentionMaxArtifacts?: number;
}): string {
  const metadata = input.artifactStore.put({
    namespace: VOICE_SYNTHESIS_NAMESPACE,
    title: "Gateway voice synthesis",
    mimeType: input.mimeType,
    content: {
      type: "blob",
      blob: Buffer.from(input.audio).toString("base64"),
    },
    producer: { kind: "gateway", name: "voice-output-synthesis" },
    retention: { scope: "session", maxArtifacts: input.retentionMaxArtifacts ?? 50 },
    multimodal: {
      modality: "audio",
      source: {
        kind: "transform-output",
        id: input.sourceId,
      },
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    },
  });
  const artifact = input.artifactStore.get(VOICE_SYNTHESIS_NAMESPACE, metadata.id);
  const projected = artifact ? projectMultimodalArtifactResource(artifact) : undefined;
  if (!projected) {
    throw new Error("Stored synthesized audio artifact could not be projected as a multimodal replay reference.");
  }
  return projected.uri;
}

function handleSynthesisFailure(input: {
  readonly parts: readonly ContentPart[];
  readonly provider: string;
  readonly failureMode: VoiceFailureMode;
  readonly errorMessage: string;
  readonly options: VoiceOutputSynthesisOptions;
}): VoiceOutputSynthesisResult {
  const evidence: VoiceOutputSynthesisEvidence = {
    transform: "speech-synthesis",
    status: "failed",
    requestedCapability: "speech-synthesis",
    sourceModality: "text",
    outputModality: "audio",
    provider: input.provider,
    provenance: `tts:${input.provider}`,
    degradation: SYNTHESIS_DEGRADATION,
    errorMessage: input.errorMessage,
  };
  const event = toRoutingEvent(evidence, {
    sessionId: input.options.sessionId,
    tenantId: input.options.tenantId,
    provider: input.provider,
    model: input.options.model,
  });
  if (input.failureMode === "fail-open") {
    return { parts: input.parts, transforms: [evidence], events: [event] };
  }
  throw new KilnError("TTS_FAILED", input.errorMessage, {
    context: { provider: input.provider, channel: input.options.channel },
    retryable: false,
  });
}

function toRoutingEvent(
  transform: VoiceOutputSynthesisEvidence,
  context: {
    readonly sessionId: string;
    readonly tenantId: string;
    readonly provider: string;
    readonly model: string;
  },
): MultimodalRoutedEvent {
  const succeeded = transform.status === "succeeded";
  const reasonCode = succeeded
    ? "voice_synthesis_transform_succeeded"
    : "voice_synthesis_transform_failed";
  return {
    type: "multimodal_routed",
    provider: context.provider,
    model: context.model,
    strategy: succeeded ? "transform" : "unsupported",
    reasonCode,
    reason: succeeded
      ? "Assistant text was transformed to governed audio output."
      : "Assistant text could not be transformed to governed audio output.",
    requestedCapability: "speech-synthesis",
    requiredModalities: ["text"],
    artifactUris: transform.outputArtifactUri ? [transform.outputArtifactUri] : [],
    diagnostics: [
      {
        code: reasonCode,
        severity: succeeded ? "info" : "error",
        message: succeeded
          ? transform.degradation
          : transform.errorMessage ?? "Voice synthesis transform failed.",
        provider: context.provider,
        model: context.model,
      },
    ],
    timestamp: new Date(),
    sessionId: context.sessionId,
    tenantId: context.tenantId,
  };
}

function automaticAudioOutputMode(modes: readonly VoiceOutputMode[]): Exclude<VoiceOutputMode, "transcript-only" | "audio-on-demand"> | undefined {
  if (modes.includes("audio-response")) return "audio-response";
  if (modes.includes("artifact-only")) return "artifact-only";
  return undefined;
}

function onDemandAudioOutputMode(modes: readonly VoiceOutputMode[]): Exclude<VoiceOutputMode, "transcript-only" | "artifact-only"> | undefined {
  if (modes.includes("audio-on-demand")) return "audio-on-demand";
  if (modes.includes("audio-response")) return "audio-response";
  return undefined;
}

function resultIsQueuedOrEmpty(parts: readonly ContentPart[]): boolean {
  return parts.length === 0 || extractText(parts).trim() === "";
}

function toVoiceSurface(channel: string): VoiceSurface | undefined {
  return (VALID_VOICE_SURFACES as readonly string[]).includes(channel)
    ? channel as VoiceSurface
    : undefined;
}
