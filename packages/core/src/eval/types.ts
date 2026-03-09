// Eval runtime types -- core types used by scorers and experiment runners

export interface EvalInput {
  readonly input: string;
  readonly output: string;
  readonly expected?: string;
  readonly context?: readonly string[];
  readonly durationMs?: number;
  readonly costUsd?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface EvalScore {
  readonly name: string;
  readonly score: number;
  readonly reasoning?: string;
}

export interface Scorer {
  readonly name: string;
  score(input: EvalInput): Promise<EvalScore>;
}

export interface ScorerLLM {
  evaluate(prompt: string): Promise<string>;
}

export interface DatasetItem {
  readonly id: string;
  readonly input: string;
  readonly expected?: string;
  readonly context?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

export interface Dataset {
  readonly name: string;
  readonly items: readonly DatasetItem[];
}

export interface ExperimentTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ExperimentResult {
  readonly itemId: string;
  readonly output: string;
  readonly scores: readonly EvalScore[];
  readonly durationMs: number;
  readonly tokenUsage: ExperimentTokenUsage;
}

export interface Experiment {
  readonly name: string;
  readonly datasetName: string;
  readonly scorers: readonly string[];
  readonly results: readonly ExperimentResult[];
  readonly startedAt: string;
  readonly completedAt?: string;
}
