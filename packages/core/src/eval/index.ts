// Eval bounded context -- evaluation framework

export type { EvalInput, EvalScore, Scorer, ScorerLLM, DatasetItem, Dataset, ExperimentTokenUsage, ExperimentResult, Experiment } from "./types.js";
export { ExactMatchScorer } from "./scorers/exact-match-scorer.js";
export { ContainsScorer } from "./scorers/contains-scorer.js";
export { JsonValidityScorer } from "./scorers/json-validity-scorer.js";
export { LengthScorer } from "./scorers/length-scorer.js";
export { LatencyScorer } from "./scorers/latency-scorer.js";
export { CostScorer } from "./scorers/cost-scorer.js";
export { EffortScorer } from "./scorers/effort-scorer.js";
export { ResolutionScorer } from "./scorers/resolution-scorer.js";
export { CompositeScorer } from "./scorers/composite-scorer.js";
export { FaithfulnessScorer } from "./scorers/faithfulness-scorer.js";
export { RelevanceScorer } from "./scorers/relevance-scorer.js";
export { CoherenceScorer } from "./scorers/coherence-scorer.js";
export { HallucinationScorer } from "./scorers/hallucination-scorer.js";
export { ToxicityScorer } from "./scorers/toxicity-scorer.js";
export { CustomPromptScorer } from "./scorers/custom-prompt-scorer.js";
export { PolicyAdherenceScorer } from "./scorers/policy-adherence-scorer.js";
export { ContextRelevanceScorer } from "./scorers/context-relevance-scorer.js";
export { ToolTrajectoryScorer } from "./scorers/tool-trajectory-scorer.js";
export { ToolCallingAccuracyScorer } from "./scorers/tool-calling-accuracy-scorer.js";
export { MultiTurnConsistencyScorer } from "./scorers/multi-turn-consistency-scorer.js";
export { SafetyPreservationScorer } from "./scorers/safety-preservation-scorer.js";
export { RoutingAccuracyScorer } from "./scorers/routing-accuracy-scorer.js";
export { HandoffQualityScorer } from "./scorers/handoff-quality-scorer.js";
export { MilestoneScorer } from "./scorers/milestone-scorer.js";
export { parseDatasetJsonl } from "./dataset-loader.js";
export { createScorer } from "./scorer-factory.js";
export { ExperimentRunner } from "./experiment-runner.js";
export type { ExperimentRunnerConfig, GenerateOutputResult } from "./experiment-runner.js";
export { BenchmarkBaselineRunner } from "./benchmark-runner.js";
export type {
  BenchmarkBaselineRunnerOptions,
  BenchmarkBaselineRunResult,
  BenchmarkItemExecutionContext,
  BenchmarkItemExecutor,
} from "./benchmark-runner.js";
export { compareExperiments, evaluateCachePolicyPromotion } from "./experiment-comparator.js";
export type {
  CachePolicyPromotionInput,
  CachePolicyPromotionResult,
  ComparisonResult,
  ScorerComparison,
} from "./experiment-comparator.js";
export { ConsistencyRunner } from "./consistency-runner.js";
export type { ConsistencyRunnerConfig, ConsistencyResult, ConsistencyItemResult, ExperimentExecutor } from "./consistency-runner.js";
export {
  KILN_BENCHMARK_PROFILES,
  KILN_EXTERNAL_BENCHMARK_TRACKS,
  evaluateBenchmarkReadiness,
} from "./benchmark-baseline.js";
export { evaluateWebRetrievalBenchmark, projectWebRetrievalObservation } from "./web-retrieval-benchmark.js";
export type {
  WebRetrievalBenchmarkCase,
  WebRetrievalBenchmarkObservation,
  WebRetrievalBenchmarkReport,
  WebRetrievalProviderMetrics,
} from "./web-retrieval-benchmark.js";
export { evaluateProgressiveLoadingPromotion } from "./progressive-loading-benchmark.js";
export type {
  ProgressiveLoadingObservation,
  ProgressiveLoadingPolicy,
  ProgressiveLoadingPromotionOptions,
  ProgressiveLoadingPromotionReport,
  ProgressiveLoadingTokenDelta,
} from "./progressive-loading-benchmark.js";
export { evaluateContextAllocationPromotion } from "./context-allocation-benchmark.js";
export type {
  ContextAllocationBenchmarkPolicy,
  ContextAllocationObservation,
  ContextAllocationPromotionReport,
  ContextAllocationTaskClassComparison,
} from "./context-allocation-benchmark.js";
export {
  evaluatePhaseAwareRoutePromotion,
  evaluateDeliberationPromotion,
} from "./phase-aware-routing-benchmark.js";
export type {
  PhaseAwareRouteBenchmarkPolicy,
  PhaseAwareRouteObservation,
  PhaseAwareRoutePromotionReport,
  PhaseAwareRouteTaskClassComparison,
  DeliberationBenchmarkLevel,
  DeliberationObservation,
  DeliberationPromotionReport,
  DeliberationTaskClassComparison,
} from "./phase-aware-routing-benchmark.js";
export { createBenchmarkProfileScorers } from "./benchmark-scorers.js";
export { projectBfclDataset } from "./adapters/bfcl-adapter.js";
export type { BfclAdapterOptions, BfclFunctionCall, BfclProjectionResult, BfclUnsupportedRow } from "./adapters/bfcl-adapter.js";
export { projectAgentDojoDataset } from "./adapters/agentdojo-adapter.js";
export type {
  AgentDojoAdapterOptions,
  AgentDojoProjectionResult,
  AgentDojoUnsupportedRow,
} from "./adapters/agentdojo-adapter.js";
export { projectTauDataset } from "./adapters/tau-adapter.js";
export type { TauAdapterOptions, TauProjectionResult, TauUnsupportedRow } from "./adapters/tau-adapter.js";
export { generateBenchmarkPublicReport } from "./benchmark-report.js";
export type { BenchmarkPublicReport, BenchmarkPublicReportInput } from "./benchmark-report.js";
export type {
  BenchmarkBaselineResult,
  BenchmarkEvidenceArtifact,
  BenchmarkEvidenceArtifactKind,
  BenchmarkProfile,
  BenchmarkProfileReadiness,
  BenchmarkReadinessInput,
  BenchmarkReadinessReport,
  BenchmarkReadinessStatus,
  BenchmarkSurface,
  BenchmarkTrack,
  BenchmarkTrackId,
} from "./benchmark-baseline.js";
