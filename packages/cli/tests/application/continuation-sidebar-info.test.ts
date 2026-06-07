import { describe, expect, it } from "vitest";
import { loadContinuationSidebarInfo } from "../../src/application/continuation-sidebar-info.js";
import type { SessionStore, TranscriptStore, PersistedSessionMeta } from "../../src/wrapper/session-store.js";

describe("loadContinuationSidebarInfo", () => {
  it("uses latest session per provider from canonical session ordering", async () => {
    const sessionStore = {
      list: async () => ([
        {
          sessionId: "claude-new",
          provider: "claude",
          task: "task",
          completedAt: new Date().toISOString(),
          cost: 0,
          projectPath: "/tmp",
        },
        {
          sessionId: "codex-new",
          provider: "codex",
          task: "task",
          completedAt: new Date().toISOString(),
          cost: 0,
          projectPath: "/tmp",
        },
        {
          sessionId: "claude-old",
          provider: "claude",
          task: "task",
          completedAt: new Date().toISOString(),
          cost: 0,
          projectPath: "/tmp",
        },
      ]),
    } as unknown as SessionStore;

    const metaBySession: Record<string, PersistedSessionMeta> = {
      "claude-new": {
        kilnSessionId: "claude-new",
        provider: "claude",
        task: "task",
        startedAt: new Date().toISOString(),
        resumeStrategy: "cache-first",
        resumeFeedback: {
          sampleSize: 7,
          influencedChoice: true,
          preferredStrategy: "cache-first",
        },
      },
      "codex-new": {
        kilnSessionId: "codex-new",
        provider: "codex",
        task: "task",
        startedAt: new Date().toISOString(),
        resumeStrategy: "none",
      },
      "claude-old": {
        kilnSessionId: "claude-old",
        provider: "claude",
        task: "task",
        startedAt: new Date().toISOString(),
        resumeStrategy: "provider-native",
      },
    };

    const transcriptStore = {
      readMeta: async (sessionId: string) => metaBySession[sessionId] ?? null,
    } as unknown as TranscriptStore;

    const info = await loadContinuationSidebarInfo(sessionStore, transcriptStore, ["claude", "codex"]);
    expect(info).toEqual({
      claude: {
        strategy: "cache-first",
        feedbackLabel: "applied cache-first · 7",
      },
    });
  });
});
