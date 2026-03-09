// EvalConfig types -- YAML configuration for evaluation framework

export type EvalScorerType =
  | "exact-match"
  | "contains"
  | "json-validity"
  | "length"
  | "latency"
  | "cost"
  | "faithfulness"
  | "relevance"
  | "coherence"
  | "hallucination"
  | "toxicity"
  | "custom-prompt"
  | "composite"
  | "policy-adherence"
  | "context-relevance"
  | "effort"
  | "resolution"
  | "tool-trajectory";

export interface EvalScorerConfig {
  readonly name: string;
  readonly type: EvalScorerType;
  readonly scorers?: readonly EvalScorerConfig[];
  readonly schema?: Record<string, unknown>;
  readonly prompt?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly maxLatencyMs?: number;
  readonly maxCostUsd?: number;
  readonly substrings?: readonly string[];
  readonly policies?: readonly string[];
}

export interface EvalDatasetConfig {
  readonly name: string;
  readonly path: string;
}

export interface EvalExperimentConfig {
  readonly name: string;
  readonly dataset: string;
  readonly team: string;
  readonly scorers: readonly string[];
  readonly overrides?: Record<string, unknown>;
  readonly compare?: string;
}

export interface EvalConfig {
  readonly datasets: readonly EvalDatasetConfig[];
  readonly scorers: readonly EvalScorerConfig[];
  readonly experiments: readonly EvalExperimentConfig[];
}

export interface EvalValidationError {
  readonly field: string;
  readonly message: string;
}

const VALID_SCORER_TYPES: readonly string[] = [
  "exact-match", "contains", "json-validity", "length", "latency", "cost",
  "faithfulness", "relevance", "coherence", "hallucination", "toxicity",
  "custom-prompt", "composite",
  "effort", "resolution",
  "policy-adherence", "context-relevance", "tool-trajectory",
];

export function validateEvalConfig(config: EvalConfig): EvalValidationError[] {
  const errors: EvalValidationError[] = [];

  // --- datasets ---
  if (!config.datasets || !Array.isArray(config.datasets) || config.datasets.length === 0) {
    errors.push({ field: "datasets", message: "must be a non-empty array" });
  } else {
    const datasetNames = new Set<string>();
    for (let i = 0; i < config.datasets.length; i++) {
      const ds = config.datasets[i]!;
      if (!ds.name || typeof ds.name !== "string") {
        errors.push({ field: `datasets[${i}].name`, message: "must be a non-empty string" });
      } else if (datasetNames.has(ds.name)) {
        errors.push({ field: `datasets[${i}].name`, message: "duplicate dataset name" });
      } else {
        datasetNames.add(ds.name);
      }
      if (!ds.path || typeof ds.path !== "string") {
        errors.push({ field: `datasets[${i}].path`, message: "must be a non-empty string" });
      }
    }
  }

  // --- scorers ---
  if (!config.scorers || !Array.isArray(config.scorers) || config.scorers.length === 0) {
    errors.push({ field: "scorers", message: "must be a non-empty array" });
  } else {
    const scorerNames = new Set<string>();
    for (let i = 0; i < config.scorers.length; i++) {
      const sc = config.scorers[i]!;
      if (!sc.name || typeof sc.name !== "string") {
        errors.push({ field: `scorers[${i}].name`, message: "must be a non-empty string" });
      } else if (scorerNames.has(sc.name)) {
        errors.push({ field: `scorers[${i}].name`, message: "duplicate scorer name" });
      } else {
        scorerNames.add(sc.name);
      }
      if (!sc.type || !VALID_SCORER_TYPES.includes(sc.type)) {
        errors.push({ field: `scorers[${i}].type`, message: `must be one of: ${VALID_SCORER_TYPES.join(", ")}` });
      }
      if (sc.type === "composite") {
        if (!sc.scorers || !Array.isArray(sc.scorers) || sc.scorers.length === 0) {
          errors.push({ field: `scorers[${i}].scorers`, message: "composite scorer must have a non-empty scorers array" });
        }
      }
      if (sc.type === "custom-prompt") {
        if (!sc.prompt || typeof sc.prompt !== "string") {
          errors.push({ field: `scorers[${i}].prompt`, message: "custom-prompt scorer must have a non-empty prompt string" });
        }
      }
      if (sc.type === "policy-adherence") {
        if (!sc.policies || !Array.isArray(sc.policies) || sc.policies.length === 0) {
          errors.push({ field: `scorers[${i}].policies`, message: "policy-adherence scorer must have a non-empty policies array" });
        }
      }
      if (sc.type === "contains") {
        if (!sc.substrings || !Array.isArray(sc.substrings) || sc.substrings.length === 0) {
          errors.push({ field: `scorers[${i}].substrings`, message: "contains scorer must have a non-empty substrings array" });
        }
      }
      if (sc.type === "length") {
        if (sc.minLength !== undefined && sc.minLength < 0) {
          errors.push({ field: `scorers[${i}].minLength`, message: "must be >= 0" });
        }
        if (sc.maxLength !== undefined && sc.maxLength <= 0) {
          errors.push({ field: `scorers[${i}].maxLength`, message: "must be > 0" });
        }
        if (sc.minLength !== undefined && sc.maxLength !== undefined && sc.minLength >= sc.maxLength) {
          errors.push({ field: `scorers[${i}].minLength`, message: "must be less than maxLength" });
        }
      }
      if (sc.type === "latency" && sc.maxLatencyMs !== undefined && sc.maxLatencyMs <= 0) {
        errors.push({ field: `scorers[${i}].maxLatencyMs`, message: "must be > 0" });
      }
      if (sc.type === "cost" && sc.maxCostUsd !== undefined && sc.maxCostUsd <= 0) {
        errors.push({ field: `scorers[${i}].maxCostUsd`, message: "must be > 0" });
      }
    }
  }

  // --- experiments ---
  if (!config.experiments || !Array.isArray(config.experiments) || config.experiments.length === 0) {
    errors.push({ field: "experiments", message: "must be a non-empty array" });
  } else {
    const experimentNames = new Set<string>();
    const datasetNames = new Set((config.datasets ?? []).map((d) => d.name));
    const scorerNames = new Set((config.scorers ?? []).map((s) => s.name));
    for (let i = 0; i < config.experiments.length; i++) {
      const exp = config.experiments[i]!;
      if (!exp.name || typeof exp.name !== "string") {
        errors.push({ field: `experiments[${i}].name`, message: "must be a non-empty string" });
      } else if (experimentNames.has(exp.name)) {
        errors.push({ field: `experiments[${i}].name`, message: "duplicate experiment name" });
      } else {
        experimentNames.add(exp.name);
      }
      if (!exp.dataset || typeof exp.dataset !== "string") {
        errors.push({ field: `experiments[${i}].dataset`, message: "must be a non-empty string" });
      } else if (!datasetNames.has(exp.dataset)) {
        errors.push({ field: `experiments[${i}].dataset`, message: `references unknown dataset "${exp.dataset}"` });
      }
      if (!exp.team || typeof exp.team !== "string") {
        errors.push({ field: `experiments[${i}].team`, message: "must be a non-empty string" });
      }
      if (!exp.scorers || !Array.isArray(exp.scorers) || exp.scorers.length === 0) {
        errors.push({ field: `experiments[${i}].scorers`, message: "must be a non-empty array" });
      } else {
        for (let j = 0; j < exp.scorers.length; j++) {
          if (!scorerNames.has(exp.scorers[j]!)) {
            errors.push({ field: `experiments[${i}].scorers[${j}]`, message: `references unknown scorer "${exp.scorers[j]}"` });
          }
        }
      }
      if (exp.compare !== undefined) {
        if (exp.compare === exp.name) {
          errors.push({ field: `experiments[${i}].compare`, message: "cannot compare to itself" });
        } else if (!experimentNames.has(exp.compare) && !config.experiments.some((e) => e.name === exp.compare)) {
          errors.push({ field: `experiments[${i}].compare`, message: `references unknown experiment "${exp.compare}"` });
        }
      }
    }

    // cycle detection for compare references
    const compareGraph = new Map<string, string>();
    for (const exp of config.experiments) {
      if (exp.compare !== undefined && exp.name) {
        compareGraph.set(exp.name, exp.compare);
      }
    }
    for (const [start, target] of compareGraph) {
      let current = target;
      const visited = new Set([start]);
      while (current && compareGraph.has(current)) {
        if (visited.has(current)) {
          const idx = config.experiments.findIndex((e) => e.name === start);
          errors.push({ field: `experiments[${idx}].compare`, message: `circular compare reference: ${start} -> ... -> ${current}` });
          break;
        }
        visited.add(current);
        current = compareGraph.get(current)!;
      }
    }
  }

  return errors;
}
