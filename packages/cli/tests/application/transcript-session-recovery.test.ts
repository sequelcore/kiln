import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recoverStaleOpenTranscriptSessions } from "../../src/application/transcript-session-recovery.js";
import { SessionStore, TranscriptStore } from "../../src/wrapper/session-store.js";

describe("recoverStaleOpenTranscriptSessions", () => {
  let tmpDir: string;
  let sessionStore: SessionStore;
  let transcriptStore: TranscriptStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kiln-transcript-recovery-"));
    sessionStore = new SessionStore(tmpDir);
    transcriptStore = new TranscriptStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("closes stale open transcript turns and indexes orphan sessions", async () => {
    const sessionId = "kiln-gui:_gui:user-1:1778246833142";
    await transcriptStore.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "Continue governed GUI workflow",
      startedAt: "2026-05-30T06:43:55.824Z",
      resumeStrategy: "none",
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-turn-started",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-05-30T06:43:55.900Z",
      kind: "turn_started",
      turnId: `${sessionId}:turn:1`,
      source: { actor: "runtime", surface: "gui", component: "gui-command" },
      payload: {
        turnId: `${sessionId}:turn:1`,
        turnOrdinal: 1,
        trigger: "user_message",
      },
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-user-message",
      kilnSessionId: sessionId,
      sequence: 2,
      timestamp: "2026-05-30T06:43:56.000Z",
      kind: "user_message",
      turnId: `${sessionId}:turn:1`,
      source: { actor: "user", surface: "gui", component: "gui-command" },
      payload: {
        messageId: `${sessionId}:turn:1:user`,
        content: "Continue the existing governed GUI workflow.",
      },
    });

    const result = await recoverStaleOpenTranscriptSessions({
      transcriptStore,
      sessionStore,
      projectPath: tmpDir,
      now: new Date("2026-05-30T06:50:00.000Z"),
      staleAfterMs: 60_000,
    });

    expect(result.recoveredSessionIds).toEqual([sessionId]);
    const transcript = await transcriptStore.readTranscript(sessionId);
    expect(transcript.map((event) => event.kind)).toEqual([
      "turn_started",
      "user_message",
      "error_recorded",
      "turn_completed",
    ]);
    expect(transcript.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(transcript.at(-2)).toMatchObject({
      kind: "error_recorded",
      turnId: `${sessionId}:turn:1`,
      payload: {
        errorCode: "STALE_OPEN_TURN_RECOVERED",
        retriable: true,
      },
    });
    expect(transcript.at(-1)).toMatchObject({
      kind: "turn_completed",
      turnId: `${sessionId}:turn:1`,
      payload: {
        outcome: "failed",
      },
    });
    await expect(transcriptStore.readMeta(sessionId)).resolves.toMatchObject({
      completedAt: "2026-05-30T06:50:00.000Z",
      lastTurnOutcome: "failed",
      sessionLedger: {
        currentPhase: "recovered",
        lastError: "Recovered stale open turn kiln-gui:_gui:user-1:1778246833142:turn:1.",
      },
    });
    await expect(sessionStore.list()).resolves.toEqual([
      expect.objectContaining({
        sessionId,
        provider: "codex-oauth",
        task: "Continue governed GUI workflow",
        completedAt: "2026-05-30T06:50:00.000Z",
        projectPath: tmpDir,
        resumeStrategy: "none",
      }),
    ]);
  });

  it("leaves recent open turns untouched", async () => {
    const sessionId = "kiln-gui:_gui:user-2:1778246833142";
    await transcriptStore.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "Recent live turn",
      startedAt: "2026-05-30T06:49:30.000Z",
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-turn-started",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-05-30T06:49:30.000Z",
      kind: "turn_started",
      turnId: `${sessionId}:turn:1`,
      source: { actor: "runtime", surface: "gui", component: "gui-command" },
      payload: { turnId: `${sessionId}:turn:1`, turnOrdinal: 1, trigger: "user_message" },
    });

    const result = await recoverStaleOpenTranscriptSessions({
      transcriptStore,
      sessionStore,
      projectPath: tmpDir,
      now: new Date("2026-05-30T06:50:00.000Z"),
      staleAfterMs: 60_000,
    });

    expect(result.recoveredSessionIds).toEqual([]);
    await expect(transcriptStore.readTranscript(sessionId)).resolves.toHaveLength(1);
    await expect(sessionStore.list()).resolves.toEqual([]);
  });

  it("leaves completed sessions untouched", async () => {
    const sessionId = "kiln-gui:_gui:user-3:1778246833142";
    await transcriptStore.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "Completed turn",
      startedAt: "2026-05-30T06:40:00.000Z",
      completedAt: "2026-05-30T06:41:00.000Z",
      lastTurnOutcome: "completed",
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-turn-started",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-05-30T06:40:00.000Z",
      kind: "turn_started",
      turnId: `${sessionId}:turn:1`,
      source: { actor: "runtime", surface: "gui", component: "gui-command" },
      payload: { turnId: `${sessionId}:turn:1`, turnOrdinal: 1, trigger: "user_message" },
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-turn-completed",
      kilnSessionId: sessionId,
      sequence: 2,
      timestamp: "2026-05-30T06:41:00.000Z",
      kind: "turn_completed",
      turnId: `${sessionId}:turn:1`,
      source: { actor: "runtime", surface: "gui", component: "gui-command" },
      payload: { turnId: `${sessionId}:turn:1`, outcome: "completed" },
    });

    const result = await recoverStaleOpenTranscriptSessions({
      transcriptStore,
      sessionStore,
      projectPath: tmpDir,
      now: new Date("2026-05-30T06:50:00.000Z"),
      staleAfterMs: 60_000,
    });

    expect(result.recoveredSessionIds).toEqual([]);
    await expect(transcriptStore.readTranscript(sessionId)).resolves.toHaveLength(2);
  });
});
