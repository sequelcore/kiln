// MessageFormatter: unified channel output formatting
// Single source of truth for adapting content to channel-specific formats

import type { MessageFormat } from "@kilnai/core";

/** WhatsApp Cloud API enforces a 4096-character limit per text message */
const WHATSAPP_MAX_MESSAGE_LENGTH = 4096;

/** Adapt content for a specific channel format */
export function formatForChannel(content: string, format: MessageFormat): string {
  switch (format) {
    case "short":
      // Strip markdown for plain text channels (SMS, etc.)
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

/**
 * Convert standard markdown to WhatsApp-compatible formatting.
 *
 * WhatsApp Cloud API supports:
 *   *bold*        (single asterisk)
 *   _italic_      (single underscore)
 *   ~strikethrough~ (single tilde)
 *   ```monospace``` (triple backtick, inline only -- no language tags)
 *
 * This function converts Claude's markdown output to WhatsApp format and
 * truncates to the 4096-char Cloud API limit.
 */
export function toWhatsAppFormat(text: string): string {
  return convertMarkdownToWhatsApp(text).slice(0, WHATSAPP_MAX_MESSAGE_LENGTH);
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

// Control characters used as placeholders during bold/italic disambiguation.
// \x01 and \x02 won't appear in normal text or markdown.
const BOLD_OPEN = "\x01";
const BOLD_CLOSE = "\x02";

function convertMarkdownToWhatsApp(text: string): string {
  return (
    text
      // Fenced code blocks → WhatsApp monospace (strip language tag)
      .replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, "```$1```")
      // Inline code → WhatsApp monospace
      .replace(/`([^`]+)`/g, "```$1```")
      // Bold: **text** → placeholder (no asterisks, so italic regex won't match)
      .replace(/\*\*([^*]+)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`)
      // Italic: remaining single *text* → _text_
      .replace(/\*([^*]+)\*/g, "_$1_")
      // Restore bold placeholders → WhatsApp bold *text*
      .replace(/\x01([^\x02]*)\x02/g, "*$1*")
      // Strikethrough: ~~text~~ → ~text~
      .replace(/~~([^~]+)~~/g, "~$1~")
      // Headers: ## Title → *Title* (bold in WhatsApp)
      .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
      // Links: [text](url) → text (url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      // Unordered list markers: normalize to bullet
      .replace(/^[-*+]\s/gm, "\u2022 ")
  );
}
