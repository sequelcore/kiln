import type { KilnAppConfig, SystemPromptOptions } from "../config.js";

/** Build a structured system prompt using the app's custom builder. */
export function buildSystemPrompt(
  config: KilnAppConfig,
  options: SystemPromptOptions,
): string {
  return config.buildSystemPrompt(options);
}
