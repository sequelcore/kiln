/** Agent role in the orchestration */
export type AgentRole = "architect" | "worker" | "optimizer";

/** Message for agent communication */
export interface AgentMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
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

/** Options for creating a message */
export interface CreateMessageOptions {
  readonly system: string;
  readonly messages: readonly AgentMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly outputSchema?: Record<string, unknown>;
  readonly maxTokens?: number;
}

/** Response from an agent */
export interface AgentResponse {
  readonly content: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly toolCalls: readonly ToolCall[];
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
export { OpenAIAdapter, GPT4O, GPT4O_MINI, O3, O3_MINI, CODEX } from "./infrastructure/openai.js";
export { DeepSeekAdapter, DEEPSEEK_CHAT, DEEPSEEK_REASONER } from "./infrastructure/deepseek.js";
export { OllamaAdapter, LLAMA3, CODELLAMA, DEEPSEEK_CODER } from "./infrastructure/ollama.js";
export { type CatalogPricing, MODEL_CATALOG, findCheapest } from "./model-pricing.js";
export { CircuitBreaker } from "./circuit-breaker.js";
export type { CircuitBreakerConfig, CircuitState } from "./circuit-breaker.js";
