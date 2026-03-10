import { OpenAICompatAdapter } from "./openai-compat.js";

export const NEMOTRON_NANO_FREE = "nvidia/nemotron-3-nano-30b-a3b:free";
export const STEP_FLASH_FREE = "stepfun/step-3.5-flash:free";
export const TRINITY_LARGE_FREE = "arcee-ai/trinity-large-preview:free";
export const LLAMA_33_70B_FREE = "meta-llama/llama-3.3-70b-instruct:free";
export const GEMMA_3_27B_FREE = "google/gemma-3-27b-it:free";
export const QWEN3_CODER_FREE = "qwen/qwen3-coder-480b-a35b-instruct:free";
export const MISTRAL_SMALL_FREE = "mistralai/mistral-small-3.1-24b:free";

export class OpenRouterAdapter extends OpenAICompatAdapter {
  private readonly appUrl?: string;
  private readonly appName?: string;

  constructor(config: {
    apiKey: string;
    defaultModel?: string;
    appUrl?: string;
    appName?: string;
  }) {
    super({
      apiKey: config.apiKey,
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: config.defaultModel ?? NEMOTRON_NANO_FREE,
      providerName: "openrouter",
    });
    this.appUrl = config.appUrl;
    this.appName = config.appName;
  }

  protected override buildHeaders(): Record<string, string> {
    const headers = super.buildHeaders();
    if (this.appUrl) headers["HTTP-Referer"] = this.appUrl;
    if (this.appName) headers["X-Title"] = this.appName;
    return headers;
  }
}
