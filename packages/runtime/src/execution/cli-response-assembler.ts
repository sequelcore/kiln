import type { AgentResponse, ExecutionSessionEvent } from "@kilnai/core";
import { textParts } from "@kilnai/core";

export class CliResponseAssembler {
  private content = "";
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private isError = false;

  consume(event: ExecutionSessionEvent): void {
    if (event.type === "text_delta" && !event.isThinking) {
      this.content += event.content;
    } else if (event.type === "cost_update") {
      if (event.inputTokens !== undefined) this.inputTokens = event.inputTokens;
      if (event.outputTokens !== undefined) this.outputTokens = event.outputTokens;
      if (event.cacheReadTokens !== undefined) this.cacheReadTokens = event.cacheReadTokens;
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
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: this.isError ? "error" : "end_turn",
    };
  }
}
