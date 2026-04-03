// Runtime: ApiExecutor — API-key-backed ProviderAdapter wrapper
// Thin pass-through that allows ProviderAdapter to be explicit about which
// execution path it belongs to (API vs CLI subscription).
// Used by widget/web/deployed channels; not used by TUI.

import type { ProviderAdapter, CreateMessageOptions, AgentResponse, AgentStreamEvent } from "@kilnai/core";

/**
 * ApiExecutor delegates to an underlying ProviderAdapter (Anthropic, OpenAI, etc).
 * Naming it explicitly makes gateway wiring self-documenting at the call site:
 *   new ApiExecutor(new AnthropicAdapter(...))  vs  new CliSubscriptionExecutor(...)
 */
export class ApiExecutor implements ProviderAdapter {
  readonly name: string;

  constructor(private readonly adapter: ProviderAdapter) {
    this.name = `api:${adapter.name}`;
  }

  createMessage(options: CreateMessageOptions): Promise<AgentResponse> {
    return this.adapter.createMessage(options);
  }

  streamMessage(options: CreateMessageOptions): AsyncGenerator<AgentStreamEvent> {
    return this.adapter.streamMessage(options);
  }
}
