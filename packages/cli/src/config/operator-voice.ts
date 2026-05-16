import type { SttAdapter, TtsAdapter, VoiceConfig } from "@kilnai/core";
import type { KilnGlobalConfig } from "./global-config.js";

export interface OperatorVoiceRuntime {
  readonly voiceConfig?: VoiceConfig;
  readonly sttAdapter?: SttAdapter;
  readonly ttsAdapter?: TtsAdapter;
  readonly warnings: readonly string[];
}

export async function resolveOperatorVoiceRuntime(
  globalConfig: KilnGlobalConfig | null | undefined,
): Promise<OperatorVoiceRuntime> {
  const voiceConfig = globalConfig?.operatorVoice;
  if (!voiceConfig) {
    return { warnings: [] };
  }

  const warnings: string[] = [];
  const { createSttAdapter, createTtsAdapter } = await import("@kilnai/runtime");
  let sttAdapter: SttAdapter | undefined;
  let ttsAdapter: TtsAdapter | undefined;

  try {
    sttAdapter = createSttAdapter(voiceConfig.stt);
  } catch (error) {
    warnings.push(`Operator STT adapter was not initialized: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    ttsAdapter = createTtsAdapter(voiceConfig.tts);
  } catch (error) {
    warnings.push(`Operator TTS adapter was not initialized: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    voiceConfig,
    ...(sttAdapter ? { sttAdapter } : {}),
    ...(ttsAdapter ? { ttsAdapter } : {}),
    warnings,
  };
}
