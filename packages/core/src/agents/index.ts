import type { ContentPart } from "../engine/domain/content.js";

/**
 * Agent role in the orchestration.
 * Built-in roles: "architect", "worker", "optimizer".
 * Domain apps can define arbitrary roles (e.g. "summarizer", "reviewer").
 */
export type AgentRole = string;

/** Message for agent communication */
export interface AgentMessage {
  readonly role: "user" | "assistant";
  readonly parts: readonly ContentPart[];
}

/** Streaming event from an agent */
export interface AgentStreamEvent {
  readonly type: "thinking" | "text" | "tool_use" | "tool_result" | "done";
  readonly content: string;
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

/** Provider adapter interface -- all LLM providers implement this */
export interface ProviderAdapter {
  readonly name: string;
  createMessage(options: CreateMessageOptions): Promise<AgentResponse>;
  streamMessage(options: CreateMessageOptions): AsyncGenerator<AgentStreamEvent>;
}

/** Tool choice strategy for agent calls */
export type ToolChoiceOption =
  | { readonly type: "auto" }
  | { readonly type: "any" }
  | { readonly type: "none" }
  | { readonly type: "tool"; readonly name: string };

/** Options for creating a message */
export interface CreateMessageOptions {
  readonly sessionId?: string;
  readonly system: string;
  readonly messages: readonly AgentMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: ToolChoiceOption;
  readonly outputSchema?: Record<string, unknown>;
  readonly maxTokens?: number;
  readonly reasoningEffort?: ReasoningEffort;
}

/** Response from an agent */
export interface AgentResponse {
  readonly parts: readonly ContentPart[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly toolCalls: readonly ToolCall[];
  readonly stopReason: string;
}

/** Tool definition for agent */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly tags: ReadonlySet<string>;
}

/** Tool call from agent */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export { ToolRegistry } from "./tool-registry.js";
export {
  AnthropicAdapter,
  CLAUDE_OPUS,
  CLAUDE_SONNET,
  CLAUDE_HAIKU,
} from "./infrastructure/anthropic.js";
export { ProviderRegistry } from "./provider-registry.js";
export type { DiscoveredDirectProviderModelCapabilities } from "./provider-execution-profiles.js";
export { OpenAIAdapter, GPT4O, GPT4O_MINI, O3, O3_MINI } from "./infrastructure/openai.js";
export { LmStudioAdapter, LMSTUDIO_BASE_URL, LMSTUDIO_DEFAULT_MODEL } from "./infrastructure/lmstudio.js";
export type { LmStudioAdapterConfig } from "./infrastructure/lmstudio.js";
export { DeepSeekAdapter, DEEPSEEK_CHAT, DEEPSEEK_REASONER } from "./infrastructure/deepseek.js";
export { OllamaAdapter, LLAMA3, CODELLAMA, DEEPSEEK_CODER } from "./infrastructure/ollama.js";
export {
  OpenRouterAdapter,
  NEMOTRON_NANO_FREE,
  STEP_FLASH_FREE,
  TRINITY_LARGE_FREE,
  LLAMA_33_70B_FREE,
  GEMMA_3_27B_FREE,
  QWEN3_CODER_FREE,
  MISTRAL_SMALL_FREE,
} from "./infrastructure/openrouter.js";
export { type CatalogPricing, MODEL_CATALOG, CODEX_DEFAULT_MODEL } from "./model-pricing.js";
export { CircuitBreaker } from "./circuit-breaker.js";
export type { CircuitBreakerConfig, CircuitState } from "./circuit-breaker.js";
export { ToolCache } from "./tool-cache.js";
export { compressContext } from "./context-compressor.js";
export type { CompressOptions } from "./context-compressor.js";
export { McpClient } from "./mcp-client.js";
export { ToolRAG } from "./tool-rag.js";
export { AgentRAG } from "./agent-rag.js";
export type { AgentDescription, AgentRagResult } from "./agent-rag.js";
export { OpenAISttAdapter } from "./infrastructure/openai-stt.js";
export type { OpenAISttConfig } from "./infrastructure/openai-stt.js";
export { DeepgramSttAdapter } from "./infrastructure/deepgram-stt.js";
export type { DeepgramSttConfig } from "./infrastructure/deepgram-stt.js";
export { OpenAITtsAdapter } from "./infrastructure/openai-tts.js";
export type { OpenAITtsConfig } from "./infrastructure/openai-tts.js";
export { ElevenLabsTtsAdapter } from "./infrastructure/elevenlabs-tts.js";
export type { ElevenLabsTtsConfig } from "./infrastructure/elevenlabs-tts.js";
export { CodexOAuthAuth } from "./infrastructure/codex-oauth-auth.js";
export { CODEX_DEVICE_VERIFICATION_URI } from "./infrastructure/codex-oauth-auth.js";
export { CodexOAuthAdapter } from "./infrastructure/codex-oauth.js";
export type {
  CodexOAuthAuthOptions,
  CodexOAuthTokenFile,
  DeviceAuthorizationResult,
  PollAuthorizationParams,
} from "./infrastructure/codex-oauth-auth.js";
export { OpenCodeAuth } from "./infrastructure/opencode-auth.js";
export type { OpenCodeAuthFile, OpenCodeAuthOptions, OpenCodeTier } from "./infrastructure/opencode-auth.js";
export {
  OpenCodeAdapter,
  OpenCodeRateLimitError,
  OpenCodeQuotaError,
  OPENCODE_BASE_URL,
} from "./infrastructure/opencode-provider.js";
export type { OpenCodeAdapterConfig } from "./infrastructure/opencode-provider.js";
export { classifyToolError } from "./tool-error-classifier.js";
export { executeWithRetry } from "./tool-execution-engine.js";
export type { ToolExecutor } from "./tool-execution-engine.js";
export { SlidingWindowRateLimiter } from "./sliding-window-rate-limiter.js";
export { ModelCapabilityRegistry } from "./model-capability-registry.js";
export type {
  ModelTaskSuitability,
  ModelTaskSuitabilityEvidence,
  ModelTaskSuitabilityLevel,
  ModelTaskSuitabilitySource,
  ModelTaskSuitabilityTask,
} from "./model-capability-registry.js";
export {
  normalizeToolCall,
  normalizeToolInput,
  getInvalidToolInputDetails,
} from "./tool-call-input.js";
export type { InvalidToolInputDetails } from "./tool-call-input.js";
export {
  isDirectProviderId,
  listDirectProviderExecutionProfiles,
  getDirectProviderExecutionProfile,
  resolveDirectProviderExecutionProfile,
} from "./provider-execution-profiles.js";
export { scoreComplexity } from "./complexity-scorer.js";
export type { ComplexityScorerInput } from "./complexity-scorer.js";
export { RulesRouter } from "./rules-router.js";
export {
  appendExecutionIdentity,
  formatExecutionIdentity,
  resolveExecutionIdentity,
} from "./execution-identity.js";
export type {
  ExecutionBillingMode,
  ExecutionIdentity,
  ResolveExecutionIdentityOptions,
} from "./execution-identity.js";
export type {
  DirectProviderId,
  DirectProviderExecutionMode,
  DirectProviderExecutionProfile,
  ResolvedDirectProviderExecutionProfile,
} from "./provider-execution-profiles.js";
export {
  createProviderModelRouteHealthRecord,
  evaluateProviderModelRouteHealth,
  formatProviderModelRouteCooldown,
  mapProviderModelRouteErrorToOutcome,
} from "./provider-model-route-health.js";
export type {
  ProviderModelRouteHealthDecision,
  ProviderModelRouteHealthRecord,
  ProviderModelRouteKey,
} from "./provider-model-route-health.js";

export {
  CredentialPool,
  PooledProviderAdapter,
  AllCredentialsExhaustedError,
  isOk,
  isRetryable,
  isAuthError,
  getResetAt,
  computeCooldownUntil,
  DEFAULT_COOLDOWN_POLICY,
  createCooldownPolicy,
  selectCredential,
  createInitialSelectionContext,
  updateSelectionContext,
  computePoolMetrics,
} from "./credential-pool/index.js";
export type {
  Credential,
  Lease,
  CredentialSource,
  CredentialOutcome,
  CooldownPolicy,
  SelectionStrategy,
  CredentialPoolStatePort,
  CredentialPoolConfig,
  PoolMetrics,
  CredentialPoolSnapshot,
  CredentialPoolEntrySnapshot,
  ErrorOutcomeMapper,
  PooledProviderAdapterConfig,
} from "./credential-pool/index.js";
export * from "./managed-invocation/index.js";
