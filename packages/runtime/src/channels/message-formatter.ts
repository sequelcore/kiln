// MessageFormatter: unified SDK message formatting for all channel adapters
// Single source of truth -- replaces duplicate switch statements in run.ts and session-state.ts

import type { MessageFormat } from "@kiln/core";

/** A formatted output line ready for channel delivery */
export interface OutputLine {
  readonly text: string;
  readonly stream: "stdout" | "stderr" | "system";
  readonly timestamp: number;
}

/** Format an SDK message into an OutputLine. Handles all known message types. */
export function formatSdkMessage(msg: { type: string; [key: string]: unknown }): OutputLine | null {
  const timestamp = Date.now();

  switch (msg.type) {
    case "system/init":
      return {
        text: `[system] Model: ${(msg as { model?: string }).model ?? "unknown"}`,
        stream: "system",
        timestamp,
      };
    case "assistant/text":
      return {
        text: String((msg as { text?: string }).text ?? ""),
        stream: "stdout",
        timestamp,
      };
    case "assistant/tool_use": {
      const toolMsg = msg as { name?: string; input?: unknown };
      return {
        text: `[tool] ${toolMsg.name ?? "unknown"}`,
        stream: "system",
        timestamp,
      };
    }
    case "assistant/tool_result": {
      const resultMsg = msg as { name?: string; output?: string };
      const output = resultMsg.output;
      if (output && output.length > 200) {
        return { text: `[tool result] ${resultMsg.name}: ${output.slice(0, 197)}...`, stream: "system", timestamp };
      }
      return { text: `[tool result] ${resultMsg.name}: ${output ?? ""}`, stream: "system", timestamp };
    }
    case "result/success":
      return {
        text: `[result] ${String((msg as { result?: string }).result ?? "Session complete")}`,
        stream: "system",
        timestamp,
      };
    case "result/error":
      return {
        text: `[error] ${String((msg as { error?: string }).error ?? "Unknown error")}`,
        stream: "stderr",
        timestamp,
      };
    default:
      return null;
  }
}

/** Adapt content for a specific channel format */
export function formatForChannel(content: string, format: MessageFormat): string {
  switch (format) {
    case "short":
      // Strip markdown, truncate for messaging platforms (WhatsApp, SMS)
      return stripMarkdown(content).slice(0, 4096);
    case "full":
      // Keep full markdown (web, Slack)
      return content;
    case "structured":
      // Return as-is (REST API consumers parse it)
      return content;
    default:
      return content;
  }
}

/** Strip basic markdown formatting for plain text channels */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "[code block]") // code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/#+\s/g, "") // headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/^[-*]\s/gm, "- "); // list items
}
