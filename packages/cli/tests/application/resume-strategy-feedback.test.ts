import { describe, expect, it } from "vitest";
import { inferResumeStrategyFeedback } from "../../src/application/resume-strategy-feedback.js";
import type { PersistedSessionMeta, TranscriptStore } from "../../src/wrapper/session-store.js";

describe("inferResumeStrategyFeedback", () => {
  it("filters by providerThread.provider when present", async () => {
    const metas: Record<string, PersistedSessionMeta> = {
      "s-1": {
        kilnSessionId: "s-1",
        provider: "claude",
        providerThread: { provider: "codex", nativeSessionId: "th-1" },
        task: "task",
        startedAt: new Date().toISOString(),
        resumeStrategy: "cache-first",
        resumeOutcome: {
          succeeded: true,
          costUsd: 0.01,
          toolCallCount: 1,
          durationMs: 100,
          verificationPassed: true,
        },
      },
    };

    const transcriptStore = {
      listSessions: async () => ["s-1"],
      readMeta: async (sessionId: string) => metas[sessionId] ?? null,
    } as unknown as TranscriptStore;

    const feedback = await inferResumeStrategyFeedback(transcriptStore, "codex");
    expect(feedback.sampleSize).toBe(1);
  });
});
