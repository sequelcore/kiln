export { ModeBSession } from "./mode-b-session.js";
export type { ModeBSessionConfig, SerializedSessionData, AgentTurnEntry } from "./mode-b-session.js";
export { ModeBOrchestrator } from "./mode-b-orchestrator.js";
export type { OrchestratorDeps, OrchestrateResult, PerCallToolConfig, ToolExecutionSummary } from "./mode-b-orchestrator.js";

// Persistence + registry
export {
  SessionRegistry,
  InMemorySessionStore,
  RedisSessionStore,
  createRedisSessionStore,
  serializeSession,
  deserializeSession,
} from "./persistence/index.js";
export type { SessionStore, RedisLike } from "./persistence/index.js";

// Session mode + lifecycle transitions
export { isValidTransition, transitionSessionMode } from "./session-mode.js";
export type { SessionMode } from "./session-mode.js";

// Session support helpers
export { getProjectContextArtifactCache, ProjectContextArtifactCache } from "./context-artifact-cache.js";
export { DefaultEscalationDetector, wordOverlapSimilarity } from "./escalation-detector.js";
export type {
  EscalationSignal,
  EscalationDetector,
  DefaultEscalationDetectorConfig,
} from "./escalation-detector.js";
export { DefaultContextSummarizer } from "./context-summarizer.js";
export type { ContextSummarizer } from "./context-summarizer.js";
export { DefaultAgentHandoffSummarizer } from "./agent-handoff-summarizer.js";
export type { AgentHandoffSummarizer } from "./agent-handoff-summarizer.js";
