import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recoverStaleOpenTranscriptSessions } from "../../src/application/transcript-session-recovery.js";
import { SessionStore, TranscriptStore, type PersistedTranscriptEventDraft } from "../../src/wrapper/session-store.js";

async function appendTranscript(
  store: TranscriptStore,
  sessionId: string,
  event: PersistedTranscriptEventDraft,
): Promise<void> {
  await store.appendManyNext(sessionId, [event]);
}

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
    await appendTranscript(transcriptStore, sessionId, {
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
    await appendTranscript(transcriptStore, sessionId, {
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
    await appendTranscript(transcriptStore, sessionId, {
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
    await appendTranscript(transcriptStore, sessionId, {
      eventId: "evt-turn-started",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-05-30T06:40:00.000Z",
      kind: "turn_started",
      turnId: `${sessionId}:turn:1`,
      source: { actor: "runtime", surface: "gui", component: "gui-command" },
      payload: { turnId: `${sessionId}:turn:1`, turnOrdinal: 1, trigger: "user_message" },
    });
    await appendTranscript(transcriptStore, sessionId, {
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

  it("recovers a newer open turn even when the session previously completed a turn", async () => {
    const sessionId = "kiln-gui:_gui:user-4:1778246833142";
    const turnOne = `${sessionId}:turn:1`;
    const turnTwo = `${sessionId}:turn:2`;
    await transcriptStore.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "A session with a new in-flight turn",
      startedAt: "2026-05-30T06:40:00.000Z",
      completedAt: "2026-05-30T06:41:00.000Z",
      lastTurnOutcome: "completed",
    });
    await transcriptStore.appendManyNext(sessionId, [
      {
        eventId: "evt-turn-one-started",
        kilnSessionId: sessionId,
        timestamp: "2026-05-30T06:40:00.000Z",
        kind: "turn_started",
        turnId: turnOne,
        source: { actor: "runtime", surface: "gui", component: "gui-command" },
        payload: { turnId: turnOne, turnOrdinal: 1, trigger: "user_message" },
      },
      {
        eventId: "evt-turn-one-completed",
        kilnSessionId: sessionId,
        timestamp: "2026-05-30T06:41:00.000Z",
        kind: "turn_completed",
        turnId: turnOne,
        source: { actor: "runtime", surface: "gui", component: "gui-command" },
        payload: { turnId: turnOne, outcome: "completed" },
      },
      {
        eventId: "evt-turn-two-started",
        kilnSessionId: sessionId,
        timestamp: "2026-05-30T06:42:00.000Z",
        kind: "turn_started",
        turnId: turnTwo,
        source: { actor: "runtime", surface: "gui", component: "gui-command" },
        payload: { turnId: turnTwo, turnOrdinal: 2, trigger: "user_message" },
      },
    ]);

    const result = await recoverStaleOpenTranscriptSessions({
      transcriptStore,
      sessionStore,
      projectPath: tmpDir,
      now: new Date("2026-05-30T06:50:00.000Z"),
      staleAfterMs: 60_000,
    });

    expect(result.recoveredSessionIds).toEqual([sessionId]);
    await expect(transcriptStore.readTranscript(sessionId)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "turn_completed", turnId: turnOne }),
      expect.objectContaining({ kind: "turn_completed", turnId: turnTwo }),
    ]));
  });

  it("closes a transcript orphan when metadata was interrupted before initialization", async () => {
    const sessionId = "kiln-gui:_gui:user-5:1778246833142";
    const turnId = `${sessionId}:turn:1`;
    await appendTranscript(transcriptStore, sessionId, {
      eventId: "evt-orphan-turn-started",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-05-30T06:40:00.000Z",
      kind: "turn_started",
      turnId,
      source: { actor: "runtime", surface: "gui", component: "gui-command" },
      payload: { turnId, turnOrdinal: 1, trigger: "user_message" },
    });

    const result = await recoverStaleOpenTranscriptSessions({
      transcriptStore,
      sessionStore,
      projectPath: tmpDir,
      now: new Date("2026-05-30T06:50:00.000Z"),
      staleAfterMs: 60_000,
    });

    expect(result.recoveredSessionIds).toEqual([sessionId]);
    await expect(transcriptStore.readTranscript(sessionId)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "error_recorded", turnId }),
      expect.objectContaining({ kind: "turn_completed", turnId, payload: { turnId, outcome: "failed", durationMs: 600000 } }),
    ]));
    await expect(transcriptStore.readMeta(sessionId)).resolves.toBeNull();
    await expect(sessionStore.list()).resolves.toEqual([]);
  });

  it("uses evidence from the open turn instead of unrelated newer session events", async () => {
    const sessionId = "kiln-gui:_gui:user-6:1778246833142";
    const firstTurn = `${sessionId}:turn:1`;
    const secondTurn = `${sessionId}:turn:2`;
    await transcriptStore.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "A session with an interrupted earlier turn",
      startedAt: "2026-05-30T06:40:00.000Z",
    });
    await transcriptStore.appendManyNext(sessionId, [
      {
        eventId: "evt-old-turn-started",
        kilnSessionId: sessionId,
        timestamp: "2026-05-30T06:40:00.000Z",
        kind: "turn_started",
        turnId: firstTurn,
        source: { actor: "runtime", surface: "gui", component: "gui-command" },
        payload: { turnId: firstTurn, turnOrdinal: 1, trigger: "user_message" },
      },
      {
        eventId: "evt-new-turn-started",
        kilnSessionId: sessionId,
        timestamp: "2026-05-30T06:49:30.000Z",
        kind: "turn_started",
        turnId: secondTurn,
        source: { actor: "runtime", surface: "gui", component: "gui-command" },
        payload: { turnId: secondTurn, turnOrdinal: 2, trigger: "user_message" },
      },
      {
        eventId: "evt-new-turn-completed",
        kilnSessionId: sessionId,
        timestamp: "2026-05-30T06:49:45.000Z",
        kind: "turn_completed",
        turnId: secondTurn,
        source: { actor: "runtime", surface: "gui", component: "gui-command" },
        payload: { turnId: secondTurn, outcome: "completed" },
      },
    ]);

    const result = await recoverStaleOpenTranscriptSessions({
      transcriptStore,
      sessionStore,
      projectPath: tmpDir,
      now: new Date("2026-05-30T06:50:00.000Z"),
      staleAfterMs: 60_000,
    });

    expect(result.recoveredSessionIds).toEqual([sessionId]);
    await expect(transcriptStore.readTranscript(sessionId)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "turn_completed", turnId: firstTurn }),
      expect.objectContaining({ kind: "turn_completed", turnId: secondTurn }),
    ]));
  });
});
