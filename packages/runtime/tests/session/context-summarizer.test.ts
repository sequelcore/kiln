import { describe, it, expect } from "vitest";
import { textParts } from "@kilnai/core/engine";
import { DefaultContextSummarizer, summarizeConversationLocally } from "../../src/session/support/summarization/context-summarizer.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

function makeSession(): RuntimeSession {
  return new RuntimeSession({ appName: "test", tenantId: "test-tenant", userId: "user-1", systemPrompt: "You are helpful." });
}

describe("DefaultContextSummarizer", () => {
  it("projects recent conversation locally without a provider", async () => {
    const summarizer = new DefaultContextSummarizer();
    const session = makeSession();
    session.addUserMessage(textParts("I need help with my bill."));
    session.addAssistantMessage(textParts("Sure, let me look into that."));

    await expect(summarizer.summarize(session)).resolves.toBe(
      "user: I need help with my bill. | assistant: Sure, let me look into that.",
    );
  });

  it("limits the projection to the last ten messages", async () => {
    const summarizer = new DefaultContextSummarizer();
    const session = makeSession();
    for (let i = 0; i < 6; i++) {
      session.addUserMessage(textParts(`User message ${i}`));
      session.addAssistantMessage(textParts(`Assistant message ${i}`));
    }

    const result = await summarizer.summarize(session);
    expect(result).not.toContain("User message 0");
    expect(result).toContain("User message 1");
    expect(result).toContain("Assistant message 5");
  });

  it("returns 'No conversation history.' for an empty session", async () => {
    await expect(new DefaultContextSummarizer().summarize(makeSession())).resolves.toBe("No conversation history.");
  });

  it("bounds long transcript projections", async () => {
    const summarizer = new DefaultContextSummarizer();
    const session = makeSession();
    session.addUserMessage(textParts("x".repeat(5000)));
    const result = await summarizer.summarize(session);
    expect(result.length).toBeLessThanOrEqual(1200);
    expect(result.endsWith("...")).toBe(true);
  });

  it("represents non-text content without crossing the provider boundary", () => {
    expect(summarizeConversationLocally([{ role: "user" as const, parts: [] }])).toBe("user: [non-text content]");
  });

  it("honors small and invalid local bounds safely", () => {
    const message = [{ role: "user" as const, parts: textParts("abcdef") }];
    expect(summarizeConversationLocally(message, 2)).toHaveLength(2);
    expect(summarizeConversationLocally(message, -10)).toHaveLength(1);
  });
});
