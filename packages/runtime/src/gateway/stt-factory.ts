// STT adapter factory -- resolves config to concrete adapter

import type { SttAdapter, SttProviderConfig } from "@kilnai/core";
import { OpenAISttAdapter, DeepgramSttAdapter, KilnError } from "@kilnai/core";

export function createSttAdapter(config: SttProviderConfig): SttAdapter {
  const apiKey = config.apiKeyEnv ? process.env[config.apiKeyEnv] ?? "" : "";
  if (!apiKey) {
    throw new KilnError("CONFIG_MISSING_ENV", `STT provider "${config.provider}" requires API key from env var "${config.apiKeyEnv}"`, {
      context: { provider: config.provider, apiKeyEnv: config.apiKeyEnv },
    });
  }

  switch (config.provider) {
    case "openai":
      return new OpenAISttAdapter({ apiKey, model: config.model, language: config.language });
    case "deepgram":
      return new DeepgramSttAdapter({ apiKey, model: config.model, language: config.language });
    default:
      throw new KilnError("CONFIG_INVALID", `Unknown STT provider: ${config.provider}`, {
        context: { provider: config.provider },
      });
  }
}
