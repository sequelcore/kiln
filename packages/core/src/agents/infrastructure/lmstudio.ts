import { OpenAICompatAdapter } from "./openai-compat.js";

export const LMSTUDIO_BASE_URL = "http://localhost:1234/v1";
export const LMSTUDIO_DEFAULT_MODEL = "qwen/qwen3.5-9b";

export interface LmStudioAdapterConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly defaultModel?: string;
  readonly internalRetry?: boolean;
}

export class LmStudioAdapter extends OpenAICompatAdapter {
  constructor(config: LmStudioAdapterConfig = {}) {
    super({
      apiKey: config.apiKey ?? "lmstudio",
      baseUrl: config.baseUrl ?? LMSTUDIO_BASE_URL,
      defaultModel: config.defaultModel ?? LMSTUDIO_DEFAULT_MODEL,
      providerName: "lmstudio",
      internalRetry: config.internalRetry,
    });
  }
}
