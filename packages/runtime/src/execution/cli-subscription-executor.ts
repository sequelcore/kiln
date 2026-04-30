// Runtime: CliSubscriptionExecutor — subscription-backed ProviderAdapter
// Routes model calls through CLI subscription binaries (claude, codex, opencode)
// instead of direct HTTP API calls.
//
// DDD boundary: runtime cannot import @kilnai/cli (wrong dependency direction).
// The CLI command injects a CliSessionFactory when calling startTuiGateway().
// Runtime defines the factory interface; CLI provides the concrete session implementations.
//
// Execution model (stateless per turn):
//   1. Gateway assembles full prompt from session history (includes memory, context)
//   2. CliSubscriptionExecutor creates a fresh CLI session
//   3. Session runs one-shot: receives prompt, returns response, disposes
//   4. Gateway stores the response in session history
//
// This preserves flat-rate subscription auth (handled inside the CLI binary)
// while keeping all session state in the gateway's RuntimeSession.

import type { ProviderAdapter, CreateMessageOptions, AgentResponse, AgentStreamEvent } from "@kilnai/core";
import { extractText } from "@kilnai/core";
import { buildPromptFromMessages } from "./cli-prompt-serializer.js";
import { CliResponseAssembler } from "./cli-response-assembler.js";
import type {
  CliSessionFactory,
  CliSessionEventCallback,
} from "./cli-session-contract.js";
import type { OperatorSurfaceController } from "../operator/operator-surface-controller.js";
export type {
  CliSessionRunOptions,
  CliSessionEvent,
  CliSession,
  CliSessionFactory,
  CliSessionFactoryContext,
  CliSessionEventCallback,
} from "./cli-session-contract.js";

/**
 * CliSubscriptionExecutor — implements ProviderAdapter using CLI subscription binaries.
 *
 * Plugs directly into RuntimeSessionOrchestrator as the `provider` dependency.
 * The orchestrator sees it as any other ProviderAdapter; it is unaware of subprocess execution.
 *
 * Note: tool calls are not supported in this executor (CLI binaries handle their own tools).
 * The orchestrator's tool-round loop is bypassed because responses never contain tool_call parts.
 */
export class CliSubscriptionExecutor implements ProviderAdapter {
  readonly name: string;

  constructor(
    private readonly factory: CliSessionFactory,
    providerLabel: string,
    private readonly onEvent?: CliSessionEventCallback,
    private readonly getOperatorSurface?: () => OperatorSurfaceController | undefined,
  ) {
    this.name = `cli-subscription:${providerLabel}`;
  }

  async createMessage(options: CreateMessageOptions): Promise<AgentResponse> {
    const prompt = buildPromptFromMessages(options.messages);
    const cwd = process.cwd();

    const operatorSurface = this.getOperatorSurface?.();
    const session = this.factory(options.system, cwd, {
      kilnSessionId: options.sessionId,
      ...(operatorSurface ? { operatorSurface } : {}),
    });
    const assembler = new CliResponseAssembler();

    try {
      for await (const event of session.run({
        prompt,
        cwd,
        kilnSessionId: options.sessionId,
        system: options.system,
        messages: options.messages,
        reasoningEffort: options.reasoningEffort,
      })) {
        // Stream event to TUI via callback
        this.onEvent?.(event);
        assembler.consume(event);
      }
    } finally {
      await session.dispose();
    }

    return assembler.toResponse();
  }

  async *streamMessage(options: CreateMessageOptions): AsyncGenerator<AgentStreamEvent> {
    // Streaming is not supported in Phase 7c.
    // Phase 7d will implement delta streaming from subprocess stdout.
    const response = await this.createMessage(options);
    const text = extractText(response.parts);
    yield { type: "text", content: text };
    yield { type: "done", content: "" };
  }
}
