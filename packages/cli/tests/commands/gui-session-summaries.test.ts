import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSessionSummaries } from "../../src/commands/gui-session-summaries.js";
import { loadSessionDetail } from "../../src/commands/gui.js";
import { SessionStore, TranscriptStore } from "../../src/wrapper/session-store.js";

describe("GUI session summaries", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("groups provider turns under the canonical Kiln session", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-sessions-"));
    const sessionStore = new SessionStore(tmpDir);
    const transcriptStore = new TranscriptStore(tmpDir);

    await sessionStore.append({
      sessionId: "kiln-session-1",
      provider: "codex-oauth",
      task: "interactive",
      canonicalTitle: "Plan universal session metadata",
      completedAt: "2026-04-22T18:37:00.000Z",
      cost: 0.1,
      projectPath: tmpDir,
    });
    await transcriptStore.init("kiln-session-1", {
      kilnSessionId: "kiln-session-1",
      provider: "codex-oauth",
      task: "interactive",
      startedAt: "2026-04-22T18:37:00.000Z",
    });
    await sessionStore.append({
      sessionId: "kiln-session-1",
      provider: "opencode",
      task: "interactive",
      summary: "Plan universal session metadata and keep providers traceable.",
      providersUsed: ["opencode", "codex-oauth", "openai"],
      completedAt: "2026-04-22T18:38:00.000Z",
      cost: 0.2,
      projectPath: tmpDir,
      providerThread: { provider: "opencode", nativeSessionId: "ses_native" },
    });

    const summaries = await loadSessionSummaries(sessionStore, transcriptStore);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: "kiln-session-1",
      providersUsed: ["opencode", "codex-oauth", "openai"],
      lastProvider: "opencode",
      completedAt: "2026-04-22T18:38:00.000Z",
      taskSummary: "Plan universal session metadata and keep providers traceable.",
    });
    expect(summaries[0]?.cost).toBeCloseTo(0.3);
  });

  it("falls back to deterministic title when summary metadata is missing", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-sessions-title-"));
    const sessionStore = new SessionStore(tmpDir);
    const transcriptStore = new TranscriptStore(tmpDir);

    await sessionStore.append({
      sessionId: "kiln-session-2",
      provider: "claude",
      task: "Refactor session ledger metadata slice for provider-agnostic resume",
      completedAt: "2026-04-22T19:00:00.000Z",
      cost: 0.15,
      projectPath: tmpDir,
    });
    await transcriptStore.init("kiln-session-2", {
      kilnSessionId: "kiln-session-2",
      provider: "claude",
      task: "Refactor session ledger metadata slice for provider-agnostic resume",
      startedAt: "2026-04-22T19:00:00.000Z",
    });

    const summaries = await loadSessionSummaries(sessionStore, transcriptStore);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.taskSummary).toBe("Refactor session ledger metadata slice for provider-agnostic resume");
  });

  it("loads detail from session metadata when transcript storage is present", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-session-detail-"));
    const sessionStore = new SessionStore(tmpDir);
    const transcriptStore = new TranscriptStore(tmpDir);
    const sessionId = "kiln-gui:_gui:user-1:1776916220893";

    await sessionStore.append({
      sessionId,
      provider: "codex-oauth",
      task: "interactive",
      completedAt: "2026-04-22T19:00:00.000Z",
      cost: 0,
      projectPath: tmpDir,
    });
    await transcriptStore.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "interactive",
      startedAt: "2026-04-22T18:59:00.000Z",
    });
    await transcriptStore.append(sessionId, {
      seq: 1,
      ts: "2026-04-22T18:59:30.000Z",
      type: "user",
      data: { content: "load me" },
    });

    const detail = await loadSessionDetail(transcriptStore, sessionId);

    expect(detail?.id).toBe(sessionId);
    expect(detail?.meta.kilnSessionId).toBe(sessionId);
    expect(detail?.transcript[0]).toMatchObject({
      type: "user",
      data: { content: "load me" },
    });
  });

  it("does not list ledger-only rows without canonical transcript metadata", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-session-detail-no-fallback-"));
    const sessionStore = new SessionStore(tmpDir);
    const transcriptStore = new TranscriptStore(tmpDir);
    const sessionId = "kiln-gui:_gui:user-2:1776916220999";

    await sessionStore.append({
      sessionId,
      provider: "codex-oauth",
      task: "interactive",
      title: "whats up",
      summary: "whats up",
      tags: ["codex-oauth"],
      providersUsed: ["codex-oauth"],
      completedAt: "2026-04-22T19:00:00.000Z",
      cost: 0,
      projectPath: tmpDir,
      providerThread: { provider: "codex-oauth", nativeSessionId: "native-1" },
    });

    const summaries = await loadSessionSummaries(sessionStore, transcriptStore);
    const detail = await loadSessionDetail(transcriptStore, sessionId);

    expect(summaries).toHaveLength(0);
    expect(detail).toBeNull();
  });
});
