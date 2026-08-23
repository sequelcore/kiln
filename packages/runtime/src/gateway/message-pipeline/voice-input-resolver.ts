// Extracted from the gateway message pipeline; behavior is intentionally unchanged.
import type {
  ContentPart,
  ArtifactResourceStore,
  SttAdapter,
  VoiceConfig,
  VoiceFailureMode,
  VoiceSurface
} from "@kilnai/core";
import {
  hasModality,
  KilnError,
  VALID_VOICE_SURFACES
} from "@kilnai/core";
import {
  AudioTransformError,
  createAudioTransformRoutingEvents,
  createGenericMediaDownloader,
  transformAudioParts
} from "../audio-preprocessor.js";
import type {
  RuntimePipelineLedgerEvent
} from "./runtime-ledger-replay.js";
import type { EffectiveAuthorityAdmissionBundle } from "../../session/effective-authority-admission-bundle.js";
import type { RuntimeMediaActionClaimContext } from "../../execution-kernel/runtime-media-action-claim.js";

export async function resolveVoiceInputParts(input: {
  readonly parts: readonly ContentPart[];
  readonly voiceConfig?: VoiceConfig;
  readonly sttAdapter?: SttAdapter;
  readonly artifactStore?: ArtifactResourceStore;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly channel: string;
  readonly sessionId: string;
  readonly mediaActionClaims?: RuntimeMediaActionClaimContext;
  readonly authorityAdmission?: EffectiveAuthorityAdmissionBundle;
  readonly attemptId?: string;
  readonly callerId?: string;
  readonly idempotencyKey?: string;
  readonly logicalSendSlotPrefix?: string;
  readonly abortSignal?: AbortSignal;
}): Promise<{
  readonly parts: readonly ContentPart[];
  readonly events: readonly RuntimePipelineLedgerEvent[];
}> {
  if (!hasModality(input.parts, "audio") || !shouldApplyVoiceInputTransform(input.voiceConfig, input.channel)) {
    return { parts: input.parts, events: [] };
  }

  const failureMode = resolveVoiceInputFailureMode(input.voiceConfig, input.channel);
  if (!input.sttAdapter) {
    return handleVoiceInputFailure({
      parts: input.parts,
      failureMode,
      message: "Voice input requested but no STT adapter is configured.",
    });
  }
  if (!input.artifactStore) {
    return handleVoiceInputFailure({
      parts: input.parts,
      failureMode,
      message: "Voice input requested but no artifact store is configured for governed audio evidence.",
    });
  }

  try {
    const transformed = await transformAudioParts(input.parts, input.sttAdapter, createGenericMediaDownloader(), {
      artifactStore: input.artifactStore,
      sourceIdPrefix: `${input.appName}:${input.tenantId}:${input.userId}:${input.channel}`,
      maxArtifacts: input.voiceConfig?.policy?.artifacts?.retentionMaxArtifacts,
      mediaActionClaims: input.mediaActionClaims,
      authorityAdmission: input.authorityAdmission,
      attemptId: input.attemptId,
      callerId: input.callerId,
      idempotencyKey: input.idempotencyKey,
      logicalSendSlotPrefix: input.logicalSendSlotPrefix,
      abortSignal: input.abortSignal,
    });
    return {
      parts: transformed.parts,
      events: createAudioTransformRoutingEvents({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        provider: input.sttAdapter.name,
        model: input.voiceConfig?.stt.model ?? input.sttAdapter.name,
      }, transformed.transforms),
    };
  } catch (error) {
    if (error instanceof AudioTransformError) {
      const events = createAudioTransformRoutingEvents({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        provider: input.sttAdapter.name,
        model: input.voiceConfig?.stt.model ?? input.sttAdapter.name,
      }, error.transforms);
      if (failureMode === "fail-open" && !error.actionClaimed) {
        return { parts: input.parts, events };
      }
      throw new KilnError("STT_FAILED", "Voice input transcription failed.", {
        context: { provider: input.sttAdapter.name, channel: input.channel },
        cause: error,
      });
    }
    throw error;
  }
}

function shouldApplyVoiceInputTransform(voiceConfig: VoiceConfig | undefined, channel: string): boolean {
  if (!voiceConfig) {
    return false;
  }
  const surface = toVoiceSurface(channel);
  if (!surface) {
    return false;
  }
  const surfacePolicy = voiceConfig.policy?.surfaces?.[surface];
  if (surfacePolicy?.enabled === false) {
    return false;
  }
  const inputModes = surfacePolicy?.input?.modes;
  if (inputModes && inputModes.length === 0) {
    return false;
  }
  return true;
}

function resolveVoiceInputFailureMode(
  voiceConfig: VoiceConfig | undefined,
  channel: string,
): VoiceFailureMode {
  const surface = toVoiceSurface(channel);
  return (surface ? voiceConfig?.policy?.surfaces?.[surface]?.input?.failureMode : undefined)
    ?? voiceConfig?.policy?.defaultInputFailureMode
    ?? "fail-closed";
}

function handleVoiceInputFailure(input: {
  readonly parts: readonly ContentPart[];
  readonly failureMode: VoiceFailureMode;
  readonly message: string;
}): {
  readonly parts: readonly ContentPart[];
  readonly events: readonly RuntimePipelineLedgerEvent[];
} {
  if (input.failureMode === "fail-open") {
    return { parts: input.parts, events: [] };
  }
  throw new KilnError("STT_FAILED", input.message, {
    retryable: false,
  });
}

function toVoiceSurface(channel: string): VoiceSurface | undefined {
  return VALID_VOICE_SURFACES.includes(channel as VoiceSurface)
    ? channel as VoiceSurface
    : undefined;
}

