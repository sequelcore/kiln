import type { ContentPart, VoiceConfig, VoiceTtsIntentId } from "@kilnai/core";
import { extractText, VALID_VOICE_TTS_INTENTS } from "@kilnai/core";

export interface VoiceOutputIntentSelectionInput {
  readonly parts: readonly ContentPart[];
  readonly voiceConfig: VoiceConfig;
  readonly voiceProfile?: string;
  readonly explicitIntent?: string;
  readonly escalationReason?: string;
}

export function selectVoiceOutputIntent(input: VoiceOutputIntentSelectionInput): VoiceTtsIntentId | undefined {
  const profileId = input.voiceProfile ?? input.voiceConfig.defaults?.ttsProfile;
  const profile = profileId ? input.voiceConfig.ttsProfiles?.[profileId] : undefined;
  if (!profile?.intents) {
    return undefined;
  }

  const availableIntents = new Set(Object.keys(profile.intents)
    .map((intent) => toVoiceTtsIntent(intent))
    .filter((intent): intent is VoiceTtsIntentId => intent !== undefined));
  if (availableIntents.size === 0) {
    return undefined;
  }

  const explicitIntent = toVoiceTtsIntent(input.explicitIntent);
  if (explicitIntent && availableIntents.has(explicitIntent)) {
    return explicitIntent;
  }

  const text = extractText(input.parts).trim();
  if (text === "") {
    return availableIntents.has("neutral") ? "neutral" : undefined;
  }

  if (availableIntents.has("calm") && shouldUseCalmIntent(text, input.escalationReason)) {
    return "calm";
  }

  if (availableIntents.has("careful") && shouldUseCarefulIntent(text)) {
    return "careful";
  }

  if (availableIntents.has("brief") && shouldUseBriefIntent(text)) {
    return "brief";
  }

  return availableIntents.has("neutral") ? "neutral" : undefined;
}

function shouldUseCalmIntent(text: string, escalationReason: string | undefined): boolean {
  if (escalationReason && escalationReason.trim() !== "") {
    return true;
  }

  return containsWord(text, [
    "blocked",
    "cannot",
    "can't",
    "denied",
    "error",
    "failed",
    "failure",
    "invalid",
    "issue",
    "problem",
    "sorry",
    "timeout",
    "unable",
  ]);
}

function shouldUseCarefulIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  if (text.length >= 500) {
    return true;
  }
  if (/```|`[^`]+`/.test(text)) {
    return true;
  }
  if (/(^|\n)\s*(-|\*|\d+\.)\s+\S/.test(text)) {
    return true;
  }
  return /\b(step\s+\d+|first|second|third|then|finally|instruction|instructions|verify|configure|install|run the command)\b/.test(normalized);
}

function shouldUseBriefIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized.length > 80 || text.includes("\n")) {
    return false;
  }

  return /^(done|fixed|ready|ok|okay|yes|no|got it|all set|working on it|sounds good|confirmed)[.!?]*$/.test(normalized)
    || /^(done|fixed|ready|all set|confirmed)[.!?]?\s/.test(normalized);
}

function containsWord(text: string, words: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return words.some((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, "u").test(normalized));
}

function toVoiceTtsIntent(intent: string | undefined): VoiceTtsIntentId | undefined {
  return intent && (VALID_VOICE_TTS_INTENTS as readonly string[]).includes(intent)
    ? intent as VoiceTtsIntentId
    : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
