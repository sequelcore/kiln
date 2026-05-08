import { describe, expect, it } from "vitest";
import { shouldPromoteLatestPromptToSessionTitle } from "../../src/application/session-metadata.js";

describe("session metadata promotion", () => {
  it("replaces low-signal initial greetings with the first substantive prompt", () => {
    expect(shouldPromoteLatestPromptToSessionTitle({
      existingTitle: "hello",
      latestPrompt: "Diagnose why resumed GUI sessions lose conversational state",
    })).toBe(true);
  });

  it("does not replace a substantive title with a short continuation", () => {
    expect(shouldPromoteLatestPromptToSessionTitle({
      existingTitle: "Diagnose resumed GUI session continuity",
      latestPrompt: "ok",
    })).toBe(false);
  });
});
