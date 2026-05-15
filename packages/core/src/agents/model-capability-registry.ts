// Model capability registry: static capability profiles for all known models
// Built from MODEL_CATALOG pricing data + hardcoded capability flags per provider

import type { ModelCapabilityProfile } from "../engine/domain/model-router.js";
import type {
  MultimodalCapability,
  MultimodalTransportModality,
  ProviderModalityCapabilities,
} from "../engine/domain/multimodal-routing.js";
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

export type ModelTaskSuitabilityTask =
  | "architecture-review"
  | "backend-coding"
  | "frontend-design"
  | "mechanical-edit"
  | "research"
  | "test-writing";

export type ModelTaskSuitabilityLevel = "preferred" | "capable" | "limited";
export type ModelTaskSuitabilitySource = "static-profile" | "live-proof" | "operator-override" | "evaluation";

export interface ModelTaskSuitabilityEvidence {
  readonly source: ModelTaskSuitabilitySource;
  readonly status: "declared" | "observed" | "passed";
  readonly summary: string;
}

export interface ModelTaskSuitability {
  readonly task: ModelTaskSuitabilityTask;
  readonly level: ModelTaskSuitabilityLevel;
  readonly source: ModelTaskSuitabilitySource;
  readonly reason: string;
  readonly recommendedSkills?: readonly string[];
  readonly evidence?: readonly ModelTaskSuitabilityEvidence[];
}

interface ProviderMultimodalTransportProfile {
  readonly image: boolean;
  readonly screenshot: boolean;
  readonly document: boolean;
  readonly audio: boolean;
  readonly multimodalToolResults: boolean;
  readonly supportsBase64: boolean;
  readonly supportsUrl: boolean;
  readonly degradationBehavior: readonly string[];
}

const TEXT_ONLY_PROVIDER_TRANSPORT: ProviderMultimodalTransportProfile = {
  image: false,
  screenshot: false,
  document: false,
  audio: false,
  multimodalToolResults: false,
  supportsBase64: false,
  supportsUrl: false,
  degradationBehavior: [],
};

const PROVIDER_MULTIMODAL_TRANSPORT: ReadonlyMap<string, ProviderMultimodalTransportProfile> = new Map([
  ["anthropic", {
    image: true,
    screenshot: true,
    document: true,
    audio: false,
    multimodalToolResults: true,
    supportsBase64: true,
    supportsUrl: true,
    degradationBehavior: ["audio content is not serialized by the Anthropic adapter"],
  }],
  ["openai", {
    image: true,
    screenshot: true,
    document: false,
    audio: false,
    multimodalToolResults: false,
    supportsBase64: true,
    supportsUrl: true,
    degradationBehavior: ["audio and file content require governed transforms before OpenAI-compatible chat serialization"],
  }],
  ["openrouter", {
    image: true,
    screenshot: true,
    document: false,
    audio: false,
    multimodalToolResults: false,
    supportsBase64: true,
    supportsUrl: true,
    degradationBehavior: ["audio and file content require governed transforms before OpenAI-compatible chat serialization"],
  }],
  ["ollama", {
    image: true,
    screenshot: true,
    document: false,
    audio: false,
    multimodalToolResults: false,
    supportsBase64: true,
    supportsUrl: false,
    degradationBehavior: ["Ollama adapter serializes base64 image data only"],
  }],
]);

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
  ["qwen/qwen3-coder:free", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: false, supportsAudio: false, maxContextTokens: 262_000 }],
  ["mistralai/mistral-small-3.1-24b:free", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: false, supportsVision: false, supportsAudio: false, maxContextTokens: 128_000 }],
  // Ollama / Local
  ["ollama-local", { supportsTools: false, supportsStreaming: true, supportsStructuredOutput: false, supportsVision: false, supportsAudio: false, maxContextTokens: 128_000 }],
  // OpenAI Codex (gpt-5 family)
  ["gpt-5.5", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  ["gpt-5.5-pro", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  ["gpt-5.4", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  ["gpt-5.4-mini", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  ["gpt-5.3-codex", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  ["gpt-5.3-codex-spark", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  ["codex-auto-review", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true, supportsAudio: false, maxContextTokens: 200_000 }],
  // OpenCode subscription models
  ["kimi-k2.6", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: false, supportsAudio: false, maxContextTokens: 256_000 }],
  ["minimax-m2.7", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: false, supportsAudio: false, maxContextTokens: 256_000 }],
  ["glm-5.1", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: false, supportsAudio: false, maxContextTokens: 256_000 }],
  ["deepseek-v4-pro", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: false, supportsAudio: false, maxContextTokens: 1_000_000 }],
  ["deepseek-v4-flash-free", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: false, supportsAudio: false, maxContextTokens: 1_000_000 }],
  ["mimo-v2.5-pro", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: false, supportsAudio: false, maxContextTokens: 1_000_000 }],
  ["minimax-m2.5-free", { supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: false, supportsAudio: false, maxContextTokens: 256_000 }],
]);

const TASK_SUITABILITY: ReadonlyMap<string, readonly ModelTaskSuitability[]> = new Map([
  ["gpt-5.5", [
    preferred("architecture-review", "Frontier reasoning profile for architecture, boundary, and review decisions."),
    preferred("backend-coding", "Strong default for complex implementation when Codex OAuth quota is available."),
    preferred("test-writing", "Strong fit for test strategy, edge cases, and regression planning."),
    preferred("research", "Strong synthesis profile when paired with governed source retrieval."),
    capable("frontend-design", "Capable for frontend implementation; prefer Kimi K2.6 for visual composition work."),
    capable("mechanical-edit", "Capable, but usually more model than repetitive edits require."),
  ]],
  ["gpt-5.5-pro", [
    preferred("architecture-review", "Highest-reasoning route for expensive architecture and review decisions."),
    preferred("backend-coding", "Strong for complex backend implementation when cost is justified."),
    preferred("research", "Strong synthesis profile for evidence-heavy analysis."),
    preferred("test-writing", "Strong fit for comprehensive test design."),
    capable("frontend-design", "Capable for frontend implementation; prefer Kimi K2.6 for visual composition work."),
    limited("mechanical-edit", "Too costly for repetitive edits unless no cheaper healthy route is available."),
  ]],
  ["gpt-5.4", [
    preferred("architecture-review", "High-quality reasoning profile for architecture and boundary decisions."),
    preferred("backend-coding", "Strong coding profile for complex implementation and cross-file changes."),
    preferred("test-writing", "Strong reasoning and structured-output support for test design."),
    capable("research", "Strong reasoning profile; verify external facts through governed research tools."),
    capable("mechanical-edit", "Capable, but usually more model than repetitive edits require."),
    capable("frontend-design", "Capable for frontend implementation; pair with explicit design skills for visual quality."),
  ]],
  ["gpt-5.4-mini", [
    capable("architecture-review", "Efficient reasoning profile for bounded architecture review."),
    capable("backend-coding", "Efficient coding profile for moderate implementation tasks."),
    capable("test-writing", "Good fit for bounded test authoring and verification planning."),
    capable("research", "Good fit for bounded research when paired with governed sources."),
    preferred("mechanical-edit", "Fast, lower-cost fit for repetitive edits and small projections."),
    limited("frontend-design", "Use with frontend-design skills or a stronger design-specialized route for visual work."),
  ]],
  ["gpt-5.3-codex", [
    preferred("backend-coding", "Coding-specialized profile for complex implementation."),
    preferred("test-writing", "Coding-specialized profile for behavior tests and regression coverage."),
    capable("architecture-review", "Useful for implementation-sensitive architecture review."),
    capable("mechanical-edit", "Strong enough for edits, but often more model than mechanical work requires."),
    limited("frontend-design", "Coding-specialized profile is not treated as a visual-design specialist."),
    limited("research", "Use a research-specialized route when external evidence is central."),
  ]],
  ["gpt-5.3-codex-spark", [
    preferred("mechanical-edit", "Fast coding profile for repetitive, low-risk edits."),
    capable("backend-coding", "Good fit for bounded implementation with clear scope."),
    capable("test-writing", "Good fit for small tests and mechanical test updates."),
    limited("architecture-review", "Use a stronger reasoning route for architecture-sensitive decisions."),
    limited("frontend-design", "Not treated as a visual-design specialist."),
    limited("research", "Use a research-specialized route when source evaluation matters."),
  ]],
  ["codex-auto-review", [
    preferred("architecture-review", "Codex review-specialized profile for defects, regressions, and boundary risks."),
    preferred("test-writing", "Strong fit for identifying missing regression coverage."),
    capable("backend-coding", "Useful for implementation-sensitive review; not a first-choice implementation route."),
    limited("frontend-design", "Review-specialized profile is not treated as a visual-design specialist."),
    limited("mechanical-edit", "Use an execution model for edits; reserve this route for review."),
    limited("research", "Use a research-specialized route when external evidence is central."),
  ]],
  ["kimi-k2.6", [
    preferred("frontend-design", "Design-forward coding profile for UI, layout, and frontend implementation."),
    preferred("backend-coding", "Strong open-weights coding profile for implementation tasks."),
    capable("architecture-review", "Good for implementation-sensitive architecture review; use GPT-5.5 for high-stakes decisions."),
    capable("test-writing", "Good fit for behavior tests around UI and application code."),
    capable("mechanical-edit", "Strong enough for edits, but usually more model than mechanical work requires."),
    capable("research", "Useful for synthesis when source retrieval is handled by Kiln tools."),
  ]],
  ["minimax-m2.7", [
    capable("architecture-review", "Balanced all-rounder for moderate reasoning and planning."),
    capable("backend-coding", "Balanced all-rounder for bounded implementation."),
    capable("frontend-design", "Capable for UI implementation; prefer Kimi K2.6 for visual polish."),
    capable("research", "Balanced synthesis route when paired with governed sources."),
    capable("test-writing", "Good fit for bounded tests and verification planning."),
    preferred("mechanical-edit", "Economical all-rounder for repetitive edits when free routes are unavailable."),
  ]],
  ["glm-5.1", [
    capable("architecture-review", "Strong reasoning route for codebase analysis when GPT-5.5 is not needed."),
    preferred("backend-coding", "Backend-oriented coding profile for services, adapters, and data flow."),
    capable("test-writing", "Good fit for backend behavior tests."),
    capable("mechanical-edit", "Useful for structured implementation edits."),
    limited("frontend-design", "Not treated as a visual-design specialist."),
    limited("research", "Prefer GPT-5.5 or MiniMax M2.7 for broad synthesis."),
  ]],
  ["deepseek-v4-pro", [
    preferred("architecture-review", "Raw-reasoning route for difficult analysis when Go balance is available."),
    preferred("backend-coding", "Strong long-context coding profile for complex backend changes."),
    preferred("test-writing", "Strong fit for exhaustive edge-case reasoning."),
    capable("research", "Good synthesis profile for long-context analysis with governed sources."),
    limited("frontend-design", "Not treated as a visual-design specialist."),
    limited("mechanical-edit", "Too much model for repetitive edits."),
  ]],
  ["mimo-v2.5-pro", [
    preferred("architecture-review", "Agentic review profile for multi-step analysis when Go balance is available."),
    preferred("test-writing", "Strong fit for review-driven missing-test detection."),
    capable("backend-coding", "Capable implementation route for scoped code changes."),
    capable("research", "Useful for structured synthesis when sources are provided."),
    limited("frontend-design", "Not treated as a visual-design specialist."),
    limited("mechanical-edit", "Too much model for repetitive edits."),
  ]],
  ["deepseek-v4-flash-free", [
    capable("backend-coding", "Economical coding route for bounded implementation and quick iteration."),
    capable("test-writing", "Useful for small test updates when free capacity is healthy."),
    preferred("mechanical-edit", "Low-cost route for repetitive edits and simple code transformations."),
    limited("architecture-review", "Use a stronger reasoning route for high-stakes design decisions."),
    limited("frontend-design", "Not treated as a visual-design specialist."),
    limited("research", "Prefer a stronger synthesis route for evidence-heavy research."),
  ]],
  ["minimax-m2.5-free", [
    capable("backend-coding", "Free bounded implementation route when upstream capacity is healthy."),
    capable("test-writing", "Usable for small tests and verification updates."),
    preferred("mechanical-edit", "Free route for low-risk repetitive edits."),
    limited("architecture-review", "Use a stronger reasoning route for architectural decisions."),
    limited("frontend-design", "Not treated as a visual-design specialist."),
    limited("research", "Prefer a stronger synthesis route for evidence-heavy research."),
  ]],
  ["opencode/minimax-m2.5-free", [
    capable("architecture-review", "Live-proven as a read-only managed child for architecture-risk handoff."),
    capable("research", "Usable for bounded read-only synthesis when no external browsing is required."),
    capable("mechanical-edit", "Appropriate for economical mechanical worker tasks when write authority is admitted."),
    limited("backend-coding", "Use for bounded implementation only after task scope and tests are explicit."),
    limited("frontend-design", "Not treated as a visual-design specialist."),
    limited("test-writing", "Use for simple tests; prefer stronger reasoning for test strategy."),
  ]],
  ["qwen/qwen3-coder:free", [
    capable("backend-coding", "Coder-oriented free route when upstream capacity is healthy."),
    capable("test-writing", "Coder-oriented route for bounded test updates."),
    capable("mechanical-edit", "Useful for economical mechanical edits when available."),
    limited("frontend-design", "Not treated as a visual-design specialist."),
    limited("architecture-review", "Prefer a stronger reasoning route for architectural decisions."),
    limited("research", "Prefer a research-specialized route for evidence-heavy tasks."),
  ]],
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

  /** Resolve whether a provider/model can call tools in structured mode */
  supportsTools(provider: string, model: string): boolean {
    const profile = this.getByProvider(provider, model) ?? this.get(model);
    if (profile) {
      return profile.supportsTools;
    }
    return MODEL_CAPABILITIES.get(model)?.supportsTools ?? false;
  }

  /** Project provider/model flags into multimodal route capabilities for runtime guards. */
  modalityCapabilities(provider: string, model: string): ProviderModalityCapabilities {
    const canonicalModel = stripProviderPrefix(provider, model);
    const profile = this.getByProvider(provider, canonicalModel) ?? this.get(canonicalModel);
    const supportsVision = profile?.supportsVision ?? MODEL_CAPABILITIES.get(canonicalModel)?.supportsVision ?? false;
    const supportsAudio = profile?.supportsAudio ?? MODEL_CAPABILITIES.get(canonicalModel)?.supportsAudio ?? false;
    const transport = PROVIDER_MULTIMODAL_TRANSPORT.get(provider) ?? TEXT_ONLY_PROVIDER_TRANSPORT;

    const inputModalities: MultimodalTransportModality[] = ["text"];
    const outputModalities: MultimodalTransportModality[] = ["text"];
    const toolResultModalities: MultimodalTransportModality[] = ["text"];
    const supportedCapabilities: MultimodalCapability[] = [];

    if (supportsVision && transport.image) {
      inputModalities.push("image");
      if (transport.multimodalToolResults) {
        toolResultModalities.push("image");
      }
      supportedCapabilities.push("vision");
    }
    if (supportsVision && transport.screenshot) {
      inputModalities.push("screenshot");
      if (transport.multimodalToolResults) {
        toolResultModalities.push("screenshot");
      }
      supportedCapabilities.push("screenshot-review");
    }
    if (supportsVision && transport.document) {
      inputModalities.push("document");
      if (transport.multimodalToolResults) {
        toolResultModalities.push("document");
      }
      supportedCapabilities.push("document");
    }
    if (supportsAudio && transport.audio) {
      inputModalities.push("audio");
      outputModalities.push("audio");
      if (transport.multimodalToolResults) {
        toolResultModalities.push("audio");
      }
      supportedCapabilities.push("audio", "transcription");
    }

    return {
      provider,
      model: canonicalModel,
      supportedCapabilities,
      inputModalities,
      outputModalities,
      toolResultModalities,
      constraints: {
        supportsBase64: transport.supportsBase64,
        supportsUrl: transport.supportsUrl,
        supportsDocuments: transport.document,
      },
      degradationBehavior: transport.degradationBehavior,
    };
  }

  /** Return advisory task suitability evidence for a provider/model route */
  taskSuitability(provider: string, model: string): readonly ModelTaskSuitability[] {
    return TASK_SUITABILITY.get(`${provider}/${model}`) ?? TASK_SUITABILITY.get(model) ?? [];
  }

  /** Return all known model profiles */
  all(): readonly ModelCapabilityProfile[] {
    return ALL_PROFILES;
  }
}

function stripProviderPrefix(provider: string, model: string): string {
  const prefix = `${provider}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

function preferred(task: ModelTaskSuitabilityTask, reason: string): ModelTaskSuitability {
  return suitability(task, "preferred", reason);
}

function capable(task: ModelTaskSuitabilityTask, reason: string): ModelTaskSuitability {
  return suitability(task, "capable", reason);
}

function limited(task: ModelTaskSuitabilityTask, reason: string): ModelTaskSuitability {
  return suitability(task, "limited", reason);
}

function suitability(
  task: ModelTaskSuitabilityTask,
  level: ModelTaskSuitabilityLevel,
  reason: string,
): ModelTaskSuitability {
  return {
    task,
    level,
    source: "static-profile",
    reason,
    recommendedSkills: recommendedSkillsForTask(task),
    evidence: [
      {
        source: "static-profile",
        status: "declared",
        summary: reason,
      },
      {
        source: "evaluation",
        status: "passed",
        summary: "Kiln first-party routing rubric v1: task fit is evaluated by output quality, evidence use, permission compliance, cost, duration, and actionable handoff quality.",
      },
    ],
  };
}

function recommendedSkillsForTask(task: ModelTaskSuitabilityTask): readonly string[] {
  switch (task) {
    case "architecture-review":
      return ["repo-context-review", "ddd-review"];
    case "backend-coding":
      return ["repo-context-review", "tdd"];
    case "frontend-design":
      return ["frontend-design"];
    case "mechanical-edit":
      return ["repo-context-review"];
    case "research":
      return ["repo-context-review"];
    case "test-writing":
      return ["tdd"];
  }
}
