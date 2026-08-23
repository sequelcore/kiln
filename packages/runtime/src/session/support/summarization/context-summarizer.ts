import type { AgentMessage } from "@kilnai/core";
import { extractText } from "@kilnai/core";
import type { RuntimeSession } from "../../runtime-session.js";

const SUMMARY_MAX_MESSAGES = 10;
export const LOCAL_SUMMARY_MAX_CHARACTERS = 1200;
const SUMMARY_ELLIPSIS = "...";

/**
 * Produces a bounded transcript projection without crossing the model/provider
 * boundary. The full session remains canonical; this value is only a compact
 * handoff/escalation aid.
 */
export function summarizeConversationLocally(
  messages: readonly AgentMessage[],
  maxCharacters = LOCAL_SUMMARY_MAX_CHARACTERS,
): string {
  const boundedMaxCharacters = Number.isFinite(maxCharacters)
    ? Math.max(1, Math.floor(maxCharacters))
    : LOCAL_SUMMARY_MAX_CHARACTERS;
  const recent = messages.slice(-SUMMARY_MAX_MESSAGES);
  if (recent.length === 0) return "No conversation history.";

  const lines = recent.map((message) => {
    const text = extractText(message.parts).replace(/\s+/gu, " ").trim();
    return `${message.role}: ${text || "[non-text content]"}`;
  });
  const summary = lines.join(" | ");
  if (summary.length <= boundedMaxCharacters) return summary;
  if (boundedMaxCharacters <= SUMMARY_ELLIPSIS.length) return summary.slice(0, boundedMaxCharacters);
  return `${summary.slice(0, boundedMaxCharacters - SUMMARY_ELLIPSIS.length).trimEnd()}${SUMMARY_ELLIPSIS}`;
}

export class DefaultContextSummarizer {
  async summarize(session: RuntimeSession): Promise<string> {
    return summarizeConversationLocally(session.conversationHistory);
  }
}
