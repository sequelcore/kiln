import { describe, expect, it, vi } from "vitest";
import {
  createCliTranscriptBudgetUsageReader,
  createRuntimeBudgetAdmissionFromGlobalConfig,
} from "../../src/application/runtime-budget-admission.js";
import type { TranscriptStore } from "../../src/wrapper/session-store.js";

describe("runtime budget admission helpers", () => {
  it("reads provider-scoped usage from session metadata instead of the final provider", async () => {
    const store = {
      listSessions: vi.fn().mockResolvedValue(["s1"]),
      readMeta: vi.fn().mockResolvedValue({
        kilnSessionId: "s1",
        provider: "openai",
        task: "fallback turn",
        startedAt: new Date().toISOString(),
        providerTokenUsage: [
          { provider: "codex-oauth", model: "gpt-5.4", inputTokens: 80, outputTokens: 20 },
          { provider: "openai", model: "gpt-5.4", inputTokens: 5, outputTokens: 5 },
        ],
      }),
      readTranscript: vi.fn().mockResolvedValue([]),
    } as unknown as TranscriptStore;

    const reader = createCliTranscriptBudgetUsageReader(store);
    const usage = await reader({
      providerId: "codex-oauth",
      subject: "runtime-session-turn",
      sessionId: "next",
    });

    expect(usage.tokensUsed).toBe(100);
    expect(usage.source).toBe("cli-transcript-session-usage");
  });

  it("reads canonical cost_updated transcript usage by provider", async () => {
    const store = {
      listSessions: vi.fn().mockResolvedValue(["s1"]),
      readMeta: vi.fn().mockResolvedValue({
        kilnSessionId: "s1",
        provider: "openai",
        task: "fallback turn",
        startedAt: new Date().toISOString(),
      }),
      readTranscript: vi.fn().mockResolvedValue([
        {
          kind: "cost_updated",
          payload: {
            provider: { provider: "codex-oauth", model: "gpt-5.4" },
            usage: { inputTokens: 30, outputTokens: 10, cacheReadTokens: 2 },
          },
        },
        {
          kind: "cost_updated",
          payload: {
            provider: { provider: "openai", model: "gpt-5.4" },
            usage: { inputTokens: 500, outputTokens: 500 },
          },
        },
      ]),
    } as unknown as TranscriptStore;

    const reader = createCliTranscriptBudgetUsageReader(store);
    const usage = await reader({
      providerId: "codex-oauth",
      subject: "runtime-session-turn",
      sessionId: "next",
    });

    expect(usage.tokensUsed).toBe(42);
  });

  it("accumulates provider transcript usage across interactive turns", async () => {
    const store = {
      listSessions: vi.fn().mockResolvedValue(["s1"]),
      readMeta: vi.fn().mockResolvedValue({
        kilnSessionId: "s1",
        provider: "codex-oauth",
        task: "interactive",
        startedAt: new Date().toISOString(),
        providerTokenUsage: [
          { provider: "codex-oauth", model: "gpt-5.4", inputTokens: 10, outputTokens: 5 },
        ],
      }),
      readTranscript: vi.fn().mockResolvedValue([
        {
          kind: "cost_updated",
          turnId: "s1:turn:1",
          payload: {
            provider: { provider: "codex-oauth", model: "gpt-5.4" },
            usage: { inputTokens: 80, outputTokens: 20 },
          },
        },
        {
          kind: "cost_updated",
          turnId: "s1:turn:1",
          payload: {
            provider: { provider: "codex-oauth", model: "gpt-5.4" },
            usage: { inputTokens: 90, outputTokens: 30 },
          },
        },
        {
          kind: "cost_updated",
          turnId: "s1:turn:2",
          payload: {
            provider: { provider: "codex-oauth", model: "gpt-5.4" },
            usage: { inputTokens: 25, outputTokens: 5 },
          },
        },
        {
          kind: "cost_updated",
          turnId: "s1:turn:2",
          payload: {
            provider: { provider: "openai", model: "gpt-5.4" },
            usage: { inputTokens: 500, outputTokens: 500 },
          },
        },
      ]),
    } as unknown as TranscriptStore;

    const reader = createCliTranscriptBudgetUsageReader(store);
    const usage = await reader({
      providerId: "codex-oauth",
      subject: "runtime-session-turn",
      sessionId: "next",
    });

    expect(usage.tokensUsed).toBe(150);
  });

  it("creates no admission port when global budget-aware routing is disabled", () => {
    expect(createRuntimeBudgetAdmissionFromGlobalConfig(null, vi.fn())).toBeUndefined();
    expect(createRuntimeBudgetAdmissionFromGlobalConfig({ workerRouting: { budgetAware: false } } as never, vi.fn()))
      .toBeUndefined();
  });
});
