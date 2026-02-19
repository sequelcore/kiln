import { OpenAICompatAdapter } from "./openai-compat.js";

export const DEEPSEEK_CHAT = "deepseek-chat";
export const DEEPSEEK_REASONER = "deepseek-reasoner";

export class DeepSeekAdapter extends OpenAICompatAdapter {
  constructor(config: { apiKey: string; defaultModel?: string }) {
    super({
      apiKey: config.apiKey,
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: config.defaultModel ?? DEEPSEEK_CHAT,
      providerName: "deepseek",
    });
  }
}
