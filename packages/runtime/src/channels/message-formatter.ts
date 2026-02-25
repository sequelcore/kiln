// MessageFormatter: unified channel output formatting
// Single source of truth for adapting content to channel-specific formats

import type { MessageFormat } from "@kilnai/core";

/** WhatsApp Cloud API enforces a 4096-character limit per text message */
const WHATSAPP_MAX_MESSAGE_LENGTH = 4096;

/** Adapt content for a specific channel format */
export function formatForChannel(content: string, format: MessageFormat): string {
  switch (format) {
    case "short":
      // Strip markdown, truncate for messaging platforms (WhatsApp, SMS)
      return stripMarkdown(content).slice(0, WHATSAPP_MAX_MESSAGE_LENGTH);
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
