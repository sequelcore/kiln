import { describe, it, expect } from "vitest";
import { textParts } from "@kilnai/core/engine";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { DefaultAgentHandoffSummarizer } from "../../src/session/support/summarization/agent-handoff-summarizer.js";

function makeSession(): RuntimeSession {
  return new RuntimeSession({ appName: "test", tenantId: "test-tenant", userId: "user-1", systemPrompt: "test" });
}

describe("DefaultAgentHandoffSummarizer", () => {
  it("creates a bounded deterministic brief with both agent names", async () => {
    const session = makeSession();
    session.addUserMessage(textParts("I need a refund"));

    await expect(new DefaultAgentHandoffSummarizer().summarize(session, "SalesBot", "SupportBot")).resolves.toBe(
      "[Handoff from SalesBot to SupportBot]: user: I need a refund",
    );
  });

  it("uses only the recent ten messages", async () => {
    const session = makeSession();
    for (let i = 0; i < 15; i++) session.addUserMessage(textParts(`Message ${i}`));

    const result = await new DefaultAgentHandoffSummarizer().summarize(session, "A", "B");
    expect(result).not.toContain("Message 0");
    expect(result).toContain("Message 5");
    expect(result).toContain("Message 14");
  });

  it("returns an empty brief for empty history", async () => {
    await expect(new DefaultAgentHandoffSummarizer().summarize(makeSession(), "A", "B")).resolves.toBe("");
  });

  it("bounds long handoff briefs", async () => {
    const session = makeSession();
    session.addUserMessage(textParts("x".repeat(5000)));
    const result = await new DefaultAgentHandoffSummarizer().summarize(session, "A", "B");
    expect(result.length).toBeLessThanOrEqual(1200);
    expect(result.endsWith("...")).toBe(true);
  });

  it("keeps long agent names bounded", async () => {
    const session = makeSession();
    session.addUserMessage(textParts("x".repeat(5000)));
    const result = await new DefaultAgentHandoffSummarizer().summarize(session, "from-".repeat(500), "to-".repeat(500));
    expect(result.length).toBeLessThanOrEqual(1200);
    expect(result.endsWith("...")).toBe(true);
  });
});
