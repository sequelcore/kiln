// Model capability registry: static capability profiles for all known models
// Built from MODEL_CATALOG pricing data + hardcoded capability flags per provider

import type { ModelCapabilityProfile } from "../engine/domain/model-router.js";
import { MODEL_CATALOG } from "./model-pricing.js";

/** Capability flags per model (not available in MODEL_CATALOG) */
interface CapabilityFlags {
  readonly supportsTools: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsVision: boolean;
  readonly supportsAudio: boolean;
  readonly maxContextTokens: number;
}

const MODEL_CAPABILITIES: ReadonlyMap<string, CapabilityFlags> = new Map([
  // Anthropic
  ["claude-opus-4-6", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  ["claude-sonnet-4-6", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  ["claude-haiku-4-5-20251001", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  // OpenAI
  ["gpt-4o", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 128_000 }],
  ["gpt-4o-mini", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 128_000 }],
  ["o3", { supportsTools: true, supportsStreaming: false, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  ["o3-mini", { supportsTools: true, supportsStreaming: false, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  // DeepSeek
  ["deepseek-chat", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: false, supportsAudio: false, maxContextTokens: 64_000 }],
  ["deepseek-reasoner", { supportsTools: false, supportsStreaming: true, supportsStructuredOutput: false, supportsVision: false, supportsAudio: false, maxContextTokens: 64_000 }],
  // OpenRouter (free tier)
  ["nvidia/nemotron-3-nano-30b-a3b:free", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: false, supportsVision: false, supportsAudio: false, maxContextTokens: 256_000 }],
  ["stepfun/step-3.5-flash:free", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: false, supportsVision: false, supportsAudio: false, maxContextTokens: 256_000 }],
  ["arcee-ai/trinity-large-preview:free", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: false, supportsAudio: false, maxContextTokens: 131_000 }],
  ["meta-llama/llama-3.3-70b-instruct:free", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: false, supportsVision: false, supportsAudio: false, maxContextTokens: 128_000 }],
  ["google/gemma-3-27b-it:free", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 131_000 }],
  ["qwen/qwen3-coder-480b-a35b-instruct:free", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: false, supportsAudio: false, maxContextTokens: 262_000 }],
  ["mistralai/mistral-small-3.1-24b:free", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: false, supportsVision: false, supportsAudio: false, maxContextTokens: 128_000 }],
  // Ollama / Local
  ["ollama-local", { supportsTools: false, supportsStreaming: true, supportsStructuredOutput: false, supportsVision: false, supportsAudio: false, maxContextTokens: 128_000 }],
  // OpenAI Codex (gpt-5 family)
  ["gpt-5.4", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  ["gpt-5.4-mini", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  ["gpt-5.3-codex", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  ["gpt-5.3-codex-spark", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
]);

function buildProfiles(): ReadonlyMap<string, ModelCapabilityProfile> {
  const map = new Map<string, ModelCapabilityProfile>();
  for (const entry of MODEL_CATALOG) {
    const caps = MODEL_CAPABILITIES.get(entry.model);
    if (!caps) continue;
    map.set(`${entry.provider}/${entry.model}`, {
      provider: entry.provider,
      model: entry.model,
      supportsTools: caps.supportsTools,
      supportsStreaming: caps.supportsStreaming,
      supportsStructuredOutput: caps.supportsStructuredOutput,
      supportsVision: caps.supportsVision,
      supportsAudio: caps.supportsAudio,
      maxContextTokens: caps.maxContextTokens,
      qualityTier: entry.qualityTier,
      inputPer1M: entry.inputPer1M,
      outputPer1M: entry.outputPer1M,
    });
  }
  return map;
}

const PROFILES = buildProfiles();
const ALL_PROFILES: readonly ModelCapabilityProfile[] = Array.from(PROFILES.values());

export class ModelCapabilityRegistry {
  /** Get capability profile for a specific model */
  get(model: string): ModelCapabilityProfile | undefined {
    return PROFILES.get(model) ?? ALL_PROFILES.find((profile) => profile.model === model);
  }

  /** Get capability profile for an exact provider/model pair */
  getByProvider(provider: string, model: string): ModelCapabilityProfile | undefined {
    return PROFILES.get(`${provider}/${model}`);
  }

  /** Return models that support the required capabilities */
  eligible(request: { hasTools: boolean; requiresStreaming: boolean }): readonly ModelCapabilityProfile[] {
    return ALL_PROFILES.filter((p) => {
      if (request.hasTools && !p.supportsTools) return false;
      if (request.requiresStreaming && !p.supportsStreaming) return false;
      return true;
    });
  }

  /** Return all known model profiles */
  all(): readonly ModelCapabilityProfile[] {
    return ALL_PROFILES;
  }
}
