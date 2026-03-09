// createScorer: creates a Scorer instance from YAML config

import type { Scorer, ScorerLLM } from "./types.js";
import type { EvalScorerConfig } from "../engine/domain/eval-config.js";
import { KilnError } from "../engine/errors.js";
import { ExactMatchScorer } from "./scorers/exact-match-scorer.js";
import { ContainsScorer } from "./scorers/contains-scorer.js";
import { JsonValidityScorer } from "./scorers/json-validity-scorer.js";
import { LengthScorer } from "./scorers/length-scorer.js";
import { LatencyScorer } from "./scorers/latency-scorer.js";
import { CostScorer } from "./scorers/cost-scorer.js";
import { CompositeScorer } from "./scorers/composite-scorer.js";
import { FaithfulnessScorer } from "./scorers/faithfulness-scorer.js";
import { RelevanceScorer } from "./scorers/relevance-scorer.js";
import { CoherenceScorer } from "./scorers/coherence-scorer.js";
import { HallucinationScorer } from "./scorers/hallucination-scorer.js";
import { ToxicityScorer } from "./scorers/toxicity-scorer.js";
import { CustomPromptScorer } from "./scorers/custom-prompt-scorer.js";
import { PolicyAdherenceScorer } from "./scorers/policy-adherence-scorer.js";
import { ContextRelevanceScorer } from "./scorers/context-relevance-scorer.js";
import { ToolTrajectoryScorer } from "./scorers/tool-trajectory-scorer.js";

export function createScorer(config: EvalScorerConfig, llm?: ScorerLLM): Scorer {
  switch (config.type) {
    case "exact-match":
      return new ExactMatchScorer();
    case "contains":
      return new ContainsScorer(config.substrings ?? []);
    case "json-validity":
      return new JsonValidityScorer(config.schema);
    case "length":
      return new LengthScorer(config.minLength, config.maxLength);
    case "latency":
      return new LatencyScorer(config.maxLatencyMs ?? 5000);
    case "cost":
      return new CostScorer(config.maxCostUsd ?? 1.0);
    case "composite": {
      const subScorers = (config.scorers ?? []).map((s) => createScorer(s, llm));
      return new CompositeScorer(config.name, subScorers);
    }
    case "faithfulness":
    case "relevance":
    case "coherence":
    case "hallucination":
    case "toxicity":
    case "custom-prompt":
    case "policy-adherence":
    case "context-relevance":
    case "tool-trajectory":
      return createLLMScorer(config, llm);
    default:
      throw new KilnError("EVAL_SCORER_FAILED", `Unknown scorer type: ${config.type}`, {
        context: { type: config.type, name: config.name },
      });
  }
}

function createLLMScorer(config: EvalScorerConfig, llm?: ScorerLLM): Scorer {
  if (!llm) {
    throw new KilnError("EVAL_SCORER_FAILED", `LLM scorer "${config.name}" requires a ScorerLLM instance`, {
      context: { type: config.type, name: config.name },
      suggestion: "Pass a ScorerLLM instance when creating LLM-based scorers",
    });
  }
  switch (config.type) {
    case "faithfulness": return new FaithfulnessScorer(llm);
    case "relevance": return new RelevanceScorer(llm);
    case "coherence": return new CoherenceScorer(llm);
    case "hallucination": return new HallucinationScorer(llm);
    case "toxicity": return new ToxicityScorer(llm);
    case "custom-prompt": return new CustomPromptScorer(config.name, config.prompt ?? "", llm);
    case "policy-adherence": return new PolicyAdherenceScorer(llm, config.policies ?? []);
    case "context-relevance": return new ContextRelevanceScorer(llm);
    case "tool-trajectory": return new ToolTrajectoryScorer(llm);
    default:
      throw new KilnError("EVAL_SCORER_FAILED", `Unknown LLM scorer type: ${config.type}`, {
        context: { type: config.type, name: config.name },
      });
  }
}
