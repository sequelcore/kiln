// STT adapter factory -- resolves config to concrete adapter

import type { SttAdapter, SttProviderConfig } from "@kilnai/core";
import { KilnError } from "@kilnai/core";
import { DeepgramSttAdapter } from "./stt/deepgram-stt.js";
import { OpenAISttAdapter } from "./stt/openai-stt.js";
import { WhisperLocalSttAdapter } from "./local-voice-adapters.js";

export function createSttAdapter(config: SttProviderConfig): SttAdapter {
  switch (config.provider) {
    case "openai": {
      const apiKey = resolveRequiredApiKey(config);
      return new OpenAISttAdapter({ apiKey, model: config.model, language: config.language });
    }
    case "deepgram": {
      const apiKey = resolveRequiredApiKey(config);
      return new DeepgramSttAdapter({ apiKey, model: config.model, language: config.language });
    }
    case "whisper-local":
      return new WhisperLocalSttAdapter({
        command: resolveRequiredLocalCommand(config, "STT"),
        args: config.args,
        model: config.model,
        modelPath: resolveOptionalEnvValue(config.modelPath, config.modelPathEnv),
        device: config.device,
        language: config.language,
        timeoutMs: config.timeoutMs,
      });
    default:
      throw new KilnError("CONFIG_INVALID", `Unknown STT provider: ${config.provider}`, {
        context: { provider: config.provider },
      });
  }
}

function resolveRequiredApiKey(config: SttProviderConfig): string {
  const apiKey = config.apiKeyEnv ? process.env[config.apiKeyEnv] ?? "" : "";
  if (!apiKey) {
    throw new KilnError("CONFIG_MISSING_ENV", `STT provider "${config.provider}" requires API key from env var "${config.apiKeyEnv}"`, {
      context: { provider: config.provider, apiKeyEnv: config.apiKeyEnv },
    });
  }
  return apiKey;
}

function resolveRequiredLocalCommand(config: SttProviderConfig, kind: string): string {
  const command = config.command ?? (config.commandEnv ? process.env[config.commandEnv] : undefined);
  if (!command) {
    throw new KilnError("CONFIG_MISSING_ENV", `${kind} provider "${config.provider}" requires local command via command or commandEnv`, {
      context: { provider: config.provider, commandEnv: config.commandEnv },
    });
  }
  return command;
}

function resolveOptionalEnvValue(value: string | undefined, envName: string | undefined): string | undefined {
  return value ?? (envName ? process.env[envName] : undefined);
}
