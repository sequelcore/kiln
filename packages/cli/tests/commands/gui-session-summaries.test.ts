import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSessionSummaries } from "../../src/commands/gui-session-summaries.js";
import { loadSessionDetail } from "../../src/commands/gui-session-detail.js";
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
      eventId: "evt-1",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-04-22T18:59:30.000Z",
      kind: "user_message",
      source: { actor: "user", surface: "gui" },
      payload: { content: "load me" },
    });

    const detail = await loadSessionDetail(transcriptStore, sessionId);

    expect(detail?.id).toBe(sessionId);
    expect(detail?.meta.kilnSessionId).toBe(sessionId);
    expect(detail?.events[0]).toMatchObject({
      eventId: "evt-1",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-04-22T18:59:30.000Z",
      kind: "user_message",
      payload: { content: "load me" },
    });
  });

  it("projects the latest turn outcome separately from session lifecycle phase", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-session-outcome-"));
    const sessionStore = new SessionStore(tmpDir);
    const transcriptStore = new TranscriptStore(tmpDir);
    const sessionId = "kiln-gui:_gui:user-outcome:1776916221777";

    await sessionStore.append({
      sessionId,
      provider: "codex-oauth",
      task: "interactive",
      completedAt: "2026-04-22T20:00:00.000Z",
      cost: 0,
      projectPath: tmpDir,
    });
    await transcriptStore.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "interactive",
      startedAt: "2026-04-22T19:59:00.000Z",
      completedAt: "2026-04-22T20:00:00.000Z",
      lastTurnOutcome: "failed",
      sessionLedger: {
        currentPhase: "completed",
      },
    });

    const summaries = await loadSessionSummaries(sessionStore, transcriptStore);
    const detail = await loadSessionDetail(transcriptStore, sessionId);

    expect(summaries[0]).toMatchObject({
      id: sessionId,
      lastTurnOutcome: "failed",
    });
    expect(detail?.meta).toMatchObject({
      lastTurnOutcome: "failed",
      sessionLedger: {
        currentPhase: "completed",
      },
    });
  });

  it("preserves canonical event kind and payload in session detail projection", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-gui-session-detail-events-"));
    const transcriptStore = new TranscriptStore(tmpDir);
    const sessionId = "kiln-gui:_gui:user-3:1776916221888";

    await transcriptStore.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "interactive",
      startedAt: "2026-04-22T18:59:00.000Z",
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-2",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-04-22T18:59:35.000Z",
      kind: "assistant_delta",
      source: { actor: "assistant", surface: "gui" },
      payload: { messageId: "msg-2", delta: "hello" },
    });

    const detail = await loadSessionDetail(transcriptStore, sessionId);

    expect(detail?.events[0]).toMatchObject({
      eventId: "evt-2",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-04-22T18:59:35.000Z",
      kind: "assistant_delta",
      payload: { messageId: "msg-2", delta: "hello" },
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
