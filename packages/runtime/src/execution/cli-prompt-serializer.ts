import type { CreateMessageOptions } from "@kilnai/core";
import { extractText } from "@kilnai/core";

/**
 * Serialize AgentMessage history into a single prompt string.
 *
 * The CLI binary receives one turn of input and processes it statelessly.
 * Multi-turn history is reconstructed from the gateway's RuntimeSession each turn.
 *
 * Format: alternating labelled blocks. The last message must be "user".
 */
export function buildPromptFromMessages(
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
