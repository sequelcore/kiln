import { describe, expect, it } from "vitest";
import { resolveChatLayout } from "../src/components/chat-layout.js";

const emptyReadyChat = {
  activeSurface: "chat" as const,
  conversationEntryCount: 0,
  pendingApprovalCount: 0,
  hasForegroundGoal: false,
  sessionStatus: "ready" as const,
};

describe("resolveChatLayout", () => {
  it("uses the landing layout only for an empty, ready chat", () => {
    expect(resolveChatLayout(emptyReadyChat)).toBe("landing");
  });

  it.each([
    ["first conversation entry", { conversationEntryCount: 1 }],
    ["pending approval", { pendingApprovalCount: 1 }],
    ["foreground goal", { hasForegroundGoal: true }],
    ["browser surface", { activeSurface: "browser" as const }],
    ["workspace surface", { activeSurface: "workspace" as const }],
    ["connecting session", { sessionStatus: "connecting" as const }],
    ["running session", { sessionStatus: "running" as const }],
  ])("uses the active layout for %s", (_reason, state) => {
    expect(resolveChatLayout({ ...emptyReadyChat, ...state })).toBe("active");
  });
});
