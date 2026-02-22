import type { ProviderAdapter } from "./index.js";
import { textParts, extractText } from "./index.js";

export interface CompressOptions {
  /** Skip compression if text is shorter than this. Default: 2000. */
  readonly maxChars?: number;
  /** Custom system prompt for the compression call. */
  readonly system?: string;
}

const DEFAULT_MAX_CHARS = 2000;

const DEFAULT_SYSTEM =
  "Compress the following text into a concise summary that preserves all key facts, " +
  "data points, and actionable information. Remove redundancy and filler. " +
  "Output only the compressed text, nothing else.";

/**
 * Compress text using an LLM provider when it exceeds a character threshold.
 * Returns the original text unchanged if under the threshold.
 */
export async function compressContext(
  text: string,
  provider: ProviderAdapter,
  options?: CompressOptions,
): Promise<string> {
  const threshold = options?.maxChars ?? DEFAULT_MAX_CHARS;
  if (text.length <= threshold) return text;

  const response = await provider.createMessage({
    system: options?.system ?? DEFAULT_SYSTEM,
    messages: [{ role: "user", parts: textParts(text) }],
    maxTokens: Math.ceil(threshold / 2),
  });

  return extractText(response.parts);
}
