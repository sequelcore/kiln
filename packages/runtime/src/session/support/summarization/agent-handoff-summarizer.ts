// Agent handoff summarizer: generates a brief context summary for warm agent handoffs.
// Follows the same pattern as DefaultContextSummarizer.

import type { ProviderAdapter, AgentMessage } from "@kilnai/core";
import { extractText } from "@kilnai/core";
import type { RuntimeSession } from "../../runtime-session.js";

export interface AgentHandoffSummarizer {
  summarize(session: RuntimeSession, fromAgentName: string, toAgentName: string): Promise<string>;
}

const HANDOFF_MAX_MESSAGES = 10;
const HANDOFF_MAX_TOKENS = 150;

export class DefaultAgentHandoffSummarizer implements AgentHandoffSummarizer {
  private readonly provider: ProviderAdapter;

  constructor(provider: ProviderAdapter) {
    this.provider = provider;
  }

  async summarize(session: RuntimeSession, fromAgentName: string, toAgentName: string): Promise<string> {
    const history = session.conversationHistory;
    const recent: readonly AgentMessage[] = history.slice(-HANDOFF_MAX_MESSAGES);

    if (recent.length === 0) return "";

    const systemPrompt = `You are generating a handoff brief from agent "${fromAgentName}" to agent "${toAgentName}". In 2-3 sentences, summarize: what the customer needs, what has been discussed so far, and any important context the next agent should know. Be concise and actionable.`;

    const response = await this.provider.createMessage({
      system: systemPrompt,
      messages: recent,
      maxTokens: HANDOFF_MAX_TOKENS,
    });

    const brief = extractText(response.parts);
    return brief ? `[Handoff from ${fromAgentName}]: ${brief}` : "";
  }
}
