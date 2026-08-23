import type { RuntimeSession } from "../../runtime-session.js";
import {
  LOCAL_SUMMARY_MAX_CHARACTERS,
  summarizeConversationLocally,
} from "./context-summarizer.js";

const MAX_AGENT_NAME_CHARACTERS = 256;

function boundAgentName(name: string): string {
  if (name.length <= MAX_AGENT_NAME_CHARACTERS) return name;
  return `${name.slice(0, MAX_AGENT_NAME_CHARACTERS - 3)}...`;
}

export class DefaultAgentHandoffSummarizer {
  async summarize(session: RuntimeSession, fromAgentName: string, toAgentName: string): Promise<string> {
    const prefix = `[Handoff from ${boundAgentName(fromAgentName)} to ${boundAgentName(toAgentName)}]: `;
    const summary = summarizeConversationLocally(
      session.conversationHistory,
      Math.max(1, LOCAL_SUMMARY_MAX_CHARACTERS - prefix.length),
    );
    if (summary === "No conversation history.") return "";
    const result = `${prefix}${summary}`;
    if (result.length <= LOCAL_SUMMARY_MAX_CHARACTERS) return result;
    return `${result.slice(0, LOCAL_SUMMARY_MAX_CHARACTERS - 3).trimEnd()}...`;
  }
}
