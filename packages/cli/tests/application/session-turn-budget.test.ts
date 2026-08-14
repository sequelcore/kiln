import { describe, expect, it, vi } from "vitest";
import {
  createCliTranscriptSessionTokenUsageReader,
  createRuntimeSessionTurnBudgetFromGlobalConfig,
} from "../../src/application/session-turn-budget.js";
import type { TranscriptStore } from "../../src/wrapper/session-store.js";

describe("session turn token budget helpers", () => {
  it("does not construct authority or read usage without policy", () => {
    const reader = vi.fn();
    expect(createRuntimeSessionTurnBudgetFromGlobalConfig(null, reader)).toBeUndefined();
    expect(reader).not.toHaveBeenCalled();
  });

  it("reads all providers for exactly one session and excludes cache tokens", async () => {
    const store = {
      listSessions: vi.fn(),
      readMeta: vi.fn().mockResolvedValue({ inputTokens: 100, outputTokens: 30, providerTokenUsage: [
        { provider: "codex", inputTokens: 80, outputTokens: 20 },
        { provider: "openai", inputTokens: 40, outputTokens: 15 },
      ] }),
      readTranscript: vi.fn().mockResolvedValue([
        { kind: "cost_updated", turnId: "one", payload: { usage: { inputTokens: 90, outputTokens: 30, cacheReadTokens: 99 } } },
        { kind: "cost_updated", turnId: "two", payload: { usage: { inputTokens: 30, outputTokens: 10, cacheWriteTokens: 99 } } },
      ]),
    } as unknown as TranscriptStore;
    const usage = await createCliTranscriptSessionTokenUsageReader(store)("session-a");
    expect(usage.observedTokens).toBe(160);
    expect(store.readMeta).toHaveBeenCalledExactlyOnceWith("session-a");
    expect(store.readTranscript).toHaveBeenCalledExactlyOnceWith("session-a");
    expect(store.listSessions).not.toHaveBeenCalled();
  });

  it("fails closed when persisted token fields are invalid", async () => {
    const store = {
      readMeta: vi.fn().mockResolvedValue({ inputTokens: "bad" }),
      readTranscript: vi.fn().mockResolvedValue([]),
    } as unknown as TranscriptStore;
    await expect(createCliTranscriptSessionTokenUsageReader(store)("session-a")).rejects.toThrow("invalid");
  });

  it("treats an empty session as zero but rejects partial token usage evidence", async () => {
    const empty = {
      readMeta: vi.fn().mockResolvedValue({}),
      readTranscript: vi.fn().mockResolvedValue([]),
    } as unknown as TranscriptStore;
    await expect(createCliTranscriptSessionTokenUsageReader(empty)("session-a"))
      .resolves.toMatchObject({ observedTokens: 0 });

    const partialMeta = {
      readMeta: vi.fn().mockResolvedValue({ inputTokens: 10 }),
      readTranscript: vi.fn().mockResolvedValue([]),
    } as unknown as TranscriptStore;
    await expect(createCliTranscriptSessionTokenUsageReader(partialMeta)("session-a")).rejects.toThrow("invalid");

    const partialEvent = {
      readMeta: vi.fn().mockResolvedValue(null),
      readTranscript: vi.fn().mockResolvedValue([
        { kind: "cost_updated", turnId: "one", payload: { usage: { inputTokens: 10 } } },
      ]),
    } as unknown as TranscriptStore;
    await expect(createCliTranscriptSessionTokenUsageReader(partialEvent)("session-a")).rejects.toThrow("invalid");
  });

  it("sums distinct provider effects in one turn but uses the largest repeated snapshot", async () => {
    const store = {
      readMeta: vi.fn().mockResolvedValue(null),
      readTranscript: vi.fn().mockResolvedValue([
        { kind: "cost_updated", turnId: "one", payload: { provider: "codex", model: "a", usage: { inputTokens: 10, outputTokens: 5 } } },
        { kind: "cost_updated", turnId: "one", payload: { provider: "codex", model: "a", usage: { inputTokens: 20, outputTokens: 5 } } },
        { kind: "cost_updated", turnId: "one", payload: { provider: "openai", model: "b", usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 99 } } },
        { kind: "cost_updated", turnId: "two", payload: { provider: "codex", model: "a", usage: { inputTokens: 4, outputTokens: 1 } } },
      ]),
    } as unknown as TranscriptStore;
    await expect(createCliTranscriptSessionTokenUsageReader(store)("session-a"))
      .resolves.toMatchObject({ observedTokens: 40 });
  });
});
