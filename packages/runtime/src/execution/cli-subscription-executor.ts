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
// while keeping all session state in the gateway's ModeBSession.

import type { ProviderAdapter, CreateMessageOptions, AgentResponse, AgentStreamEvent } from "@kilnai/core";
import { textParts, extractText } from "@kilnai/core";

/** Minimal session run options — structurally compatible with cli/wrapper/session IKilnSession. */
export interface CliSessionRunOptions {
  readonly prompt: string;
  readonly cwd?: string;
}

/** Minimal session event union — structurally compatible with cli/wrapper/session SessionEvent. */
export type CliSessionEvent =
  | { type: "text_delta"; content: string; isThinking?: boolean }
  | { type: "tool_use"; toolName: string; input: unknown }
  | { type: "tool_result"; toolName: string; output: string }
  | { type: "file_changed"; path: string; changeType: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number }
  | { type: "cost_update"; usd: number; inputTokens?: number; outputTokens?: number }
  | { type: "completed"; totalUsd: number; durationMs: number; isError: boolean; isPreflightCrash: boolean }
  | { type: "error"; code: string; message: string; isRetryable: boolean };

/** Minimal session interface — structurally compatible with cli/wrapper/session IKilnSession. */
export interface CliSession {
  run(options: CliSessionRunOptions): AsyncIterable<CliSessionEvent>;
  dispose(): Promise<void>;
}

/**
 * Factory injected by the CLI command. Creates a fresh one-shot CLI session per turn.
 * @param systemPrompt The assembled system prompt (memory + context already injected).
 * @param cwd Working directory for the subprocess.
 */
export type CliSessionFactory = (systemPrompt: string, cwd: string) => CliSession;

/**
 * Event callback for streaming CLI subprocess events to the TUI.
 * The executor fires this for each event from the CLI session.
 */
export type CliSessionEventCallback = (event: CliSessionEvent) => void;

/**
 * CliSubscriptionExecutor — implements ProviderAdapter using CLI subscription binaries.
 *
 * Plugs directly into ModeBOrchestrator as the `provider` dependency.
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
  ) {
    this.name = `cli-subscription:${providerLabel}`;
  }

  async createMessage(options: CreateMessageOptions): Promise<AgentResponse> {
    const prompt = buildPromptFromMessages(options.messages);
    const cwd = process.cwd();

    const session = this.factory(options.system, cwd);
    let content = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let isError = false;

    try {
      for await (const event of session.run({ prompt, cwd })) {
        // Stream event to TUI via callback
        this.onEvent?.(event);

        if (event.type === "text_delta" && !event.isThinking) {
          content += event.content;
        } else if (event.type === "cost_update") {
          if (event.inputTokens !== undefined) inputTokens = event.inputTokens;
          if (event.outputTokens !== undefined) outputTokens = event.outputTokens;
        } else if (event.type === "completed") {
          isError = event.isError;
        } else if (event.type === "error") {
          isError = true;
          throw new Error(`[${event.code}] ${event.message}`);
        }
      }
    } finally {
      await session.dispose();
    }

    return {
      parts: textParts(content),
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: isError ? "error" : "end_turn",
    };
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

/**
 * Serialize AgentMessage history into a single prompt string.
 *
 * The CLI binary receives one turn of input and processes it statelessly.
 * Multi-turn history is reconstructed from the gateway's ModeBSession each turn.
 *
 * Format: alternating labelled blocks. The last message must be "user".
 */
function buildPromptFromMessages(
  messages: CreateMessageOptions["messages"],
): string {
  if (messages.length === 0) return "";

  // Single message: just the content
  if (messages.length === 1) {
    return extractText(messages[0]!.parts);
  }

  // Multi-turn: serialize as labelled conversation
  return messages
    .map((m) => {
      const label = m.role === "user" ? "User" : "Assistant";
      return `${label}: ${extractText(m.parts)}`;
    })
    .join("\n\n");
}
