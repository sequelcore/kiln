// TTS adapter factory -- resolves config to concrete adapter

import type { TtsAdapter, TtsProviderConfig } from "@kilnai/core";
import { ElevenLabsTtsAdapter, KilnError, OpenAITtsAdapter } from "@kilnai/core";
import { KokoroLocalTtsAdapter } from "./local-voice-adapters.js";

export function createTtsAdapter(config: TtsProviderConfig): TtsAdapter {
  switch (config.provider) {
    case "openai": {
      const apiKey = resolveRequiredApiKey(config);
      return new OpenAITtsAdapter({ apiKey, model: config.model, voice: config.voice });
    }
    case "elevenlabs": {
      const apiKey = resolveRequiredApiKey(config);
      if (!config.voice) {
        throw new KilnError("CONFIG_INVALID", "ElevenLabs TTS provider requires voice", {
          context: { provider: config.provider },
        });
      }
      return new ElevenLabsTtsAdapter({ apiKey, model: config.model, voice: config.voice });
    }
    case "kokoro-local":
      return new KokoroLocalTtsAdapter({
        command: resolveRequiredLocalCommand(config, "TTS"),
        args: config.args,
        model: config.model,
        modelPath: resolveOptionalEnvValue(config.modelPath, config.modelPathEnv),
        device: config.device,
        timeoutMs: config.timeoutMs,
        voice: config.voice,
        format: config.format,
      });
    default:
      throw new KilnError("CONFIG_INVALID", `Unknown TTS provider: ${config.provider}`, {
        context: { provider: config.provider },
      });
  }
}

function resolveRequiredApiKey(config: TtsProviderConfig): string {
  const apiKey = config.apiKeyEnv ? process.env[config.apiKeyEnv] ?? "" : "";
  if (!apiKey) {
    throw new KilnError("CONFIG_MISSING_ENV", `TTS provider "${config.provider}" requires API key from env var "${config.apiKeyEnv}"`, {
      context: { provider: config.provider, apiKeyEnv: config.apiKeyEnv },
    });
  }
  return apiKey;
}

function resolveRequiredLocalCommand(config: TtsProviderConfig, kind: string): string {
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
