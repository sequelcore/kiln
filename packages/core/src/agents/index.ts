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
  readonly system: string;
  readonly messages: readonly AgentMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: ToolChoiceOption;
  readonly outputSchema?: Record<string, unknown>;
  readonly maxTokens?: number;
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
export { OpenAIAdapter, GPT4O, GPT4O_MINI, O3, O3_MINI } from "./infrastructure/openai.js";
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
export { CodexOAuthAuth } from "./infrastructure/codex-oauth-auth.js";
export { CodexOAuthAdapter } from "./infrastructure/codex-oauth.js";
export type {
  CodexOAuthAuthOptions,
  CodexOAuthTokenFile,
  DeviceAuthorizationResult,
  PollAuthorizationParams,
} from "./infrastructure/codex-oauth-auth.js";
export { classifyToolError } from "./tool-error-classifier.js";
export { executeWithRetry } from "./tool-execution-engine.js";
export type { ToolExecutor } from "./tool-execution-engine.js";
export { SlidingWindowRateLimiter } from "./sliding-window-rate-limiter.js";
export { ModelCapabilityRegistry } from "./model-capability-registry.js";
export { scoreComplexity } from "./complexity-scorer.js";
export type { ComplexityScorerInput } from "./complexity-scorer.js";
export { RulesRouter } from "./rules-router.js";
export {
  appendExecutionIdentity,
  formatExecutionIdentity,
  resolveExecutionIdentity,
} from "./execution-identity.js";
export type { ExecutionIdentity, ResolveExecutionIdentityOptions } from "./execution-identity.js";
