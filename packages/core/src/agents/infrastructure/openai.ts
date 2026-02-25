import { OpenAICompatAdapter } from "./openai-compat.js";

export const GPT4O = "gpt-4o";
export const GPT4O_MINI = "gpt-4o-mini";
export const O3 = "o3";
export const O3_MINI = "o3-mini";

export class OpenAIAdapter extends OpenAICompatAdapter {
  constructor(config: { apiKey: string; defaultModel?: string }) {
    super({
      apiKey: config.apiKey,
      baseUrl: "https://api.openai.com/v1",
      defaultModel: config.defaultModel ?? GPT4O,
      providerName: "openai",
    });
  }
}
