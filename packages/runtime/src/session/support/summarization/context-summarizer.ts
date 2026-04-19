import type { ProviderAdapter, AgentMessage } from "@kilnai/core";
import { extractText } from "@kilnai/core";
import type { RuntimeSession } from "../../runtime-session.js";

export interface ContextSummarizer {
  summarize(session: RuntimeSession): Promise<string>;
}

const SUMMARY_SYSTEM_PROMPT = "Summarize this customer conversation in 1-3 sentences for a human agent. Include: what the customer needs, what has been tried, and the current status.";
const SUMMARY_MAX_MESSAGES = 10;
const SUMMARY_MAX_TOKENS = 200;

export class DefaultContextSummarizer implements ContextSummarizer {
  private readonly provider: ProviderAdapter;

  constructor(provider: ProviderAdapter) {
    this.provider = provider;
  }

  async summarize(session: RuntimeSession): Promise<string> {
    const history = session.conversationHistory;
    const recent: readonly AgentMessage[] = history.slice(-SUMMARY_MAX_MESSAGES);

    if (recent.length === 0) return "No conversation history.";

    const response = await this.provider.createMessage({
      system: SUMMARY_SYSTEM_PROMPT,
      messages: recent,
      maxTokens: SUMMARY_MAX_TOKENS,
    });

    return extractText(response.parts);
  }
}
