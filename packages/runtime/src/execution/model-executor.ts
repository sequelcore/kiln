// Runtime: ModelExecutor — generalized model invocation interface
// Allows the gateway to support multiple execution backends:
//   - CliSubscriptionExecutor: spawns CLI processes (subscription-backed)
//   - ApiExecutor: calls provider APIs directly (API-key-backed)

export interface ExecutionMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ExecutionRequest {
  /** Fully assembled system prompt (memory + context already injected by orchestrator). */
  readonly systemPrompt: string;
  /** Full conversation history, newest last. */
  readonly messages: readonly ExecutionMessage[];
  /** Working directory for the execution. */
  readonly cwd?: string;
}

export interface ExecutionResult {
  /** Full text response from the model. */
  readonly content: string;
  /** Input tokens consumed (0 if unavailable). */
  readonly inputTokens: number;
  /** Output tokens consumed (0 if unavailable). */
  readonly outputTokens: number;
}

/** A model execution backend. Owned by runtime; chosen per channel type. */
export interface ModelExecutor {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  /** Human-readable name for logging and debugging. */
  readonly name: string;
}
