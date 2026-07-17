export interface CatalogPricing {
  readonly model: string;
  readonly provider: string;
  readonly inputPer1M: number;
  readonly outputPer1M: number;
  readonly qualityTier: "high" | "medium" | "low";
  readonly cachedInputRatePer1M?: number;
}

export const MODEL_CATALOG: readonly CatalogPricing[] = [
  // Anthropic
  { model: "claude-opus-4-6", provider: "anthropic", inputPer1M: 15, outputPer1M: 75, qualityTier: "high" },
  { model: "claude-sonnet-4-6", provider: "anthropic", inputPer1M: 3, outputPer1M: 15, qualityTier: "high" },
  { model: "claude-haiku-4-5-20251001", provider: "anthropic", inputPer1M: 0.80, outputPer1M: 4, qualityTier: "medium" },
  // OpenAI
  { model: "gpt-4o", provider: "openai", inputPer1M: 2.50, outputPer1M: 10, qualityTier: "high" },
  { model: "gpt-4o-mini", provider: "openai", inputPer1M: 0.15, outputPer1M: 0.60, qualityTier: "medium" },
  { model: "o3", provider: "openai", inputPer1M: 10, outputPer1M: 40, qualityTier: "high" },
  { model: "o3-mini", provider: "openai", inputPer1M: 1.10, outputPer1M: 4.40, qualityTier: "medium" },
  // DeepSeek
  { model: "deepseek-chat", provider: "deepseek", inputPer1M: 0.27, outputPer1M: 1.10, qualityTier: "medium" },
  { model: "deepseek-reasoner", provider: "deepseek", inputPer1M: 0.55, outputPer1M: 2.19, qualityTier: "medium" },
  // OpenRouter (free tier)
  { model: "nvidia/nemotron-3-nano-30b-a3b:free", provider: "openrouter", inputPer1M: 0, outputPer1M: 0, qualityTier: "medium" },
  { model: "stepfun/step-3.5-flash:free", provider: "openrouter", inputPer1M: 0, outputPer1M: 0, qualityTier: "medium" },
  { model: "arcee-ai/trinity-large-preview:free", provider: "openrouter", inputPer1M: 0, outputPer1M: 0, qualityTier: "medium" },
  { model: "meta-llama/llama-3.3-70b-instruct:free", provider: "openrouter", inputPer1M: 0, outputPer1M: 0, qualityTier: "medium" },
  // Local
  { model: "ollama-local", provider: "ollama", inputPer1M: 0, outputPer1M: 0, qualityTier: "low" },
  // OpenAI Codex
  { model: "gpt-5.6", provider: "openai", inputPer1M: 5.00, outputPer1M: 30.00, qualityTier: "high", cachedInputRatePer1M: 0.50 },
  { model: "gpt-5.6-sol", provider: "openai", inputPer1M: 5.00, outputPer1M: 30.00, qualityTier: "high", cachedInputRatePer1M: 0.50 },
  { model: "gpt-5.6-terra", provider: "openai", inputPer1M: 2.50, outputPer1M: 15.00, qualityTier: "high", cachedInputRatePer1M: 0.25 },
  { model: "gpt-5.6-luna", provider: "openai", inputPer1M: 1.00, outputPer1M: 6.00, qualityTier: "medium", cachedInputRatePer1M: 0.10 },
  { model: "gpt-5.4", provider: "openai", inputPer1M: 2.50, outputPer1M: 15.00, qualityTier: "high", cachedInputRatePer1M: 0.25 },
  { model: "gpt-5.3-codex", provider: "openai", inputPer1M: 1.75, outputPer1M: 14.00, qualityTier: "high", cachedInputRatePer1M: 0.175 },
  { model: "gpt-5.3-codex-spark", provider: "openai", inputPer1M: 1.75, outputPer1M: 14.00, qualityTier: "high", cachedInputRatePer1M: 0.175 },
];

export const CODEX_DEFAULT_MODEL = "gpt-5.6";
