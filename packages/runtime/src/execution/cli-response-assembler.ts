import type { AgentResponse } from "@kilnai/core";
import { textParts } from "@kilnai/core";

type CliResponseAssemblerEvent =
  | { type: "text_delta"; content: string; isThinking?: boolean }
  | { type: "tool_use"; toolName: string; input: unknown }
  | { type: "tool_result"; toolName: string; output: string }
  | { type: "file_changed"; path: string; changeType: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number }
  | { type: "cost_update"; usd: number; inputTokens?: number; outputTokens?: number }
  | { type: "completed"; totalUsd: number; durationMs: number; isError: boolean; isPreflightCrash: boolean }
  | { type: "error"; code: string; message: string; isRetryable: boolean };

export class CliResponseAssembler {
  private content = "";
  private inputTokens = 0;
  private outputTokens = 0;
  private isError = false;

  consume(event: CliResponseAssemblerEvent): void {
    if (event.type === "text_delta" && !event.isThinking) {
      this.content += event.content;
    } else if (event.type === "cost_update") {
      if (event.inputTokens !== undefined) this.inputTokens = event.inputTokens;
      if (event.outputTokens !== undefined) this.outputTokens = event.outputTokens;
    } else if (event.type === "completed") {
      this.isError = event.isError;
    } else if (event.type === "error") {
      this.isError = true;
      throw new Error(`[${event.code}] ${event.message}`);
    }
  }

  toResponse(): AgentResponse {
    return {
      parts: textParts(this.content),
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: this.isError ? "error" : "end_turn",
    };
  }
}
