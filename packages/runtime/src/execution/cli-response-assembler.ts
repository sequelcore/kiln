import type { AgentResponse, ExecutionSessionEvent } from "@kilnai/core";
import type { TurnTerminalDisposition } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core";

export class CliResponseAssembler {
  private content = "";
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private terminalDisposition: TurnTerminalDisposition | undefined;

  consume(event: ExecutionSessionEvent): void {
    if (event.type === "text_delta" && !event.isThinking) {
      this.content += event.content;
    } else if (event.type === "cost_update") {
      if (event.inputTokens !== undefined) this.inputTokens = event.inputTokens;
      if (event.outputTokens !== undefined) this.outputTokens = event.outputTokens;
      if (event.cacheReadTokens !== undefined) this.cacheReadTokens = event.cacheReadTokens;
    } else if (event.type === "completed") {
      this.terminalDisposition = event.disposition;
    } else if (event.type === "error") {
      throw new Error(`[${event.code}] ${event.message}`);
    }
  }

  toResponse(): AgentResponse {
    const terminalDisposition = this.terminalDisposition;
    if (terminalDisposition === undefined) {
      throw new Error("CLI session ended without a terminal disposition.");
    }
    return {
      parts: textParts(this.content),
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: terminalDisposition.dispositionReason,
    };
  }
}
