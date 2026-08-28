import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CanonicalSessionEvent, createSessionEvent } from "@kilnai/core/events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOperatorSessionEventPersistence } from "../../src/application/operator-session-event-persistence.js";
import { loadOperatorSessionSummaries } from "../../src/application/operator-session-history.js";
import { toCanonicalSessionEventPersistedTranscriptEventDraft } from "../../src/application/operator-transcript-projection.js";
import { type PersistedSessionMeta, SessionStore, TranscriptStore } from "../../src/wrapper/session-store.js";
import { runtimeCompletedDisposition } from "../fixtures/terminal-disposition.js";

describe("operator session event persistence", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("materializes idempotent GUI and TUI history metadata from canonical turn batches", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-operator-session-events-"));
    roots.push(root);
    const location = { sessionsPath: join(root, "sessions"), privateStateRoot: root };
    const transcriptStore = new TranscriptStore(location);
    const sessionStore = new SessionStore(location);
    const persist = createOperatorSessionEventPersistence({
      sessionStore,
      transcriptStore,
      workingDirectory: join(root, "workspace"),
    });
    const sessionId = "operator-session-1";

    const firstTurn = turnEvents({
      sessionId,
      turnOrdinal: 1,
      prompt: "hi",
      inputTokens: 3,
      outputTokens: 5,
      sequence: 1,
    });
    const secondTurn = turnEvents({
      sessionId,
      turnOrdinal: 2,
      prompt: "Persist sessions across GUI and TUI",
      inputTokens: 7,
      outputTokens: 11,
      sequence: firstTurn.length + 1,
    });

    await persist(firstTurn);
    await persist(secondTurn);
    await persist(secondTurn);

    const [meta, transcript, summaries, indexedSessions, continuationTarget] = await Promise.all([
      transcriptStore.readMeta(sessionId),
      transcriptStore.readTranscript(sessionId),
      loadOperatorSessionSummaries(sessionStore, transcriptStore),
      sessionStore.list(),
      sessionStore.getContinuationTargetSessionId(),
    ]);
    expect(meta).toMatchObject({
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      canonicalTitle: "Persist sessions across GUI and TUI",
      lastTurnOutcome: "completed",
      inputTokens: 10,
      outputTokens: 16,
      turnDepth: 2,
      sessionLedger: {
        currentPhase: "completed",
        lastProvider: "codex-oauth",
        turnDepth: 2,
      },
    });
    expect(transcript).toHaveLength(firstTurn.length + secondTurn.length);
    expect(indexedSessions).toEqual([
      expect.objectContaining({ sessionId, title: "Persist sessions across GUI and TUI" }),
    ]);
    expect(continuationTarget).toBeUndefined();
    expect(summaries).toEqual([
      expect.objectContaining({
        sessionId,
        title: "Persist sessions across GUI and TUI",
        lastRoute: expect.objectContaining({ provider: "codex-oauth" }),
      }),
    ]);
  });

  it("serializes concurrent surface projections under one session owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-operator-session-concurrent-"));
    roots.push(root);
    const location = { sessionsPath: join(root, "sessions"), privateStateRoot: root };
    const firstPersist = createOperatorSessionEventPersistence({
      sessionStore: new SessionStore(location),
      transcriptStore: new TranscriptStore(location),
      workingDirectory: join(root, "workspace"),
    });
    const secondPersist = createOperatorSessionEventPersistence({
      sessionStore: new SessionStore(location),
      transcriptStore: new TranscriptStore(location),
      workingDirectory: join(root, "workspace"),
    });
    const sessionId = "operator-session-concurrent";
    const first = turnEvents({
      sessionId,
      turnOrdinal: 1,
      prompt: "first",
      inputTokens: 2,
      outputTokens: 3,
      sequence: 1,
    });
    const second = turnEvents({
      sessionId,
      turnOrdinal: 2,
      prompt: "second",
      inputTokens: 5,
      outputTokens: 7,
      sequence: 1,
    });

    await Promise.all([firstPersist(first), secondPersist(second)]);

    const transcriptStore = new TranscriptStore(location);
    const sessionStore = new SessionStore(location);
    await expect(transcriptStore.readTranscript(sessionId)).resolves.toHaveLength(first.length + second.length);
    await expect(sessionStore.list()).resolves.toEqual([
      expect.objectContaining({ sessionId, cost: 0, providersUsed: ["codex-oauth"] }),
    ]);
  });

  it("repairs metadata from the canonical suffix when a process stops after transcript append", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-operator-session-projection-recovery-"));
    roots.push(root);
    const location = { sessionsPath: join(root, "sessions"), privateStateRoot: root };
    const transcriptStore = new TranscriptStore(location);
    const sessionStore = new SessionStore(location);
    const persist = createOperatorSessionEventPersistence({
      sessionStore,
      transcriptStore,
      workingDirectory: join(root, "workspace"),
    });
    const sessionId = "operator-session-projection-recovery";
    const events = turnEvents({
      sessionId,
      turnOrdinal: 1,
      prompt: "recover the sidebar projection",
      inputTokens: 3,
      outputTokens: 5,
      sequence: 1,
    });
    const prefix = events.slice(0, 3);
    const suffix = events.slice(3);

    await persist(prefix);
    await transcriptStore.appendManyNext(sessionId, suffix.map(toCanonicalSessionEventPersistedTranscriptEventDraft));
    await persist(suffix);

    await expect(transcriptStore.readMeta(sessionId)).resolves.toMatchObject({
      projectedTranscriptSequence: events.length,
      lastTurnOutcome: "completed",
      inputTokens: 3,
      outputTokens: 5,
      turnDepth: 1,
      sessionLedger: { currentPhase: "completed", turnDepth: 1 },
    });
    await expect(sessionStore.find(sessionId)).resolves.toMatchObject({
      sessionId,
      title: "recover the sidebar projection",
    });
  });

  it("clears a prior completion marker while a newer canonical turn is open", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-operator-session-open-turn-"));
    roots.push(root);
    const location = { sessionsPath: join(root, "sessions"), privateStateRoot: root };
    const transcriptStore = new TranscriptStore(location);
    const sessionStore = new SessionStore(location);
    const persist = createOperatorSessionEventPersistence({
      sessionStore,
      transcriptStore,
      workingDirectory: join(root, "workspace"),
    });
    const sessionId = "operator-session-open-turn";
    const firstTurn = turnEvents({
      sessionId,
      turnOrdinal: 1,
      prompt: "first",
      inputTokens: 1,
      outputTokens: 1,
      sequence: 1,
    });
    const secondTurnId = `${sessionId}:turn:2`;
    await persist(firstTurn);
    await persist([
      createSessionEvent<"turn_started">({
        kilnSessionId: sessionId,
        sequence: firstTurn.length + 1,
        kind: "turn_started",
        turnId: secondTurnId,
        turnOrdinal: 2,
        trigger: "user_message",
        timestamp: new Date("2026-08-24T18:02:00.000Z"),
      }),
      createSessionEvent<"user_message">({
        kilnSessionId: sessionId,
        sequence: firstTurn.length + 2,
        kind: "user_message",
        turnId: secondTurnId,
        messageId: `${secondTurnId}:user`,
        content: "second",
        timestamp: new Date("2026-08-24T18:02:01.000Z"),
      }),
    ]);

    await expect(transcriptStore.readMeta(sessionId)).resolves.toMatchObject({
      sessionLedger: { currentPhase: "interactive" },
    });
    const meta = await transcriptStore.readMeta(sessionId);
    expect(meta?.completedAt).toBeUndefined();
    expect(meta?.lastTurnOutcome).toBeUndefined();
  });

  it("projects only the events returned by the append instead of rereading the transcript", async () => {
    const sessionId = "operator-session-incremental-projection";
    const appended: Array<Record<string, unknown>> = [];
    let projectedMeta: PersistedSessionMeta | null = null;
    const appendManyNext = vi.fn(async (drafts: readonly Record<string, unknown>[]) => {
      const next = drafts.map((draft, index) => ({
        ...draft,
        sequence: appended.length + index + 1,
      }));
      appended.push(...next);
      return next;
    });
    const readMeta = vi.fn(async () => projectedMeta);
    const readAuthorityAdmissions = vi.fn(async () => []);
    const readTranscript = vi.fn(async () => {
      throw new Error("incremental projection must not reread the transcript");
    });
    const init = vi.fn(async (next: PersistedSessionMeta) => {
      projectedMeta = next;
    });
    const transcriptStore = {
      withSessionMutation: vi.fn(
        async (
          _id: string,
          operation: (mutation: {
            appendManyNext: typeof appendManyNext;
            readMeta: typeof readMeta;
            readAuthorityAdmissions: typeof readAuthorityAdmissions;
            readTranscript: typeof readTranscript;
            init: typeof init;
            finalize: (updates: Partial<PersistedSessionMeta>) => Promise<void>;
          }) => Promise<unknown>,
        ) =>
          operation({
            appendManyNext,
            readMeta,
            readAuthorityAdmissions,
            readTranscript,
            init,
            finalize: async () => undefined,
          }),
      ),
      readTranscript,
    } as unknown as TranscriptStore;
    const sessionStore = {
      replaceSnapshot: vi.fn(async () => undefined),
    } as unknown as SessionStore;
    const persist = createOperatorSessionEventPersistence({
      sessionStore,
      transcriptStore,
      workingDirectory: "C:/workspace",
    });

    const first = turnEvents({
      sessionId,
      turnOrdinal: 1,
      prompt: "incremental projection",
      inputTokens: 3,
      outputTokens: 5,
      sequence: 1,
    });
    await persist(first.slice(0, 3));
    for (const event of first.slice(3)) {
      await persist([event]);
    }

    expect(readTranscript).not.toHaveBeenCalled();
    expect(init).toHaveBeenCalledTimes(first.length - 2);
    expect(sessionStore.replaceSnapshot).toHaveBeenCalledTimes(first.length - 2);
  });

  it("matches one coherent history when cost updates arrive as incremental batches", async () => {
    const incrementalRoot = await mkdtemp(join(tmpdir(), "kiln-operator-session-incremental-cost-"));
    const coherentRoot = await mkdtemp(join(tmpdir(), "kiln-operator-session-coherent-cost-"));
    roots.push(incrementalRoot, coherentRoot);
    const sessionId = "operator-session-incremental-cost";
    const incrementalLocation = { sessionsPath: join(incrementalRoot, "sessions"), privateStateRoot: incrementalRoot };
    const coherentLocation = { sessionsPath: join(coherentRoot, "sessions"), privateStateRoot: coherentRoot };
    const incrementalTranscriptStore = new TranscriptStore(incrementalLocation);
    const incrementalSessionStore = new SessionStore(incrementalLocation);
    const coherentTranscriptStore = new TranscriptStore(coherentLocation);
    const coherentSessionStore = new SessionStore(coherentLocation);
    const incrementalPersist = createOperatorSessionEventPersistence({
      sessionStore: incrementalSessionStore,
      transcriptStore: incrementalTranscriptStore,
      workingDirectory: "C:/workspace",
    });
    const coherentPersist = createOperatorSessionEventPersistence({
      sessionStore: coherentSessionStore,
      transcriptStore: coherentTranscriptStore,
      workingDirectory: "C:/workspace",
    });
    const events = turnEvents({
      sessionId,
      turnOrdinal: 1,
      prompt: "incremental cost history",
      inputTokens: 3,
      outputTokens: 5,
      sequence: 1,
    });
    const costUpdate = createSessionEvent<"cost_updated">({
      kilnSessionId: sessionId,
      sequence: 7,
      kind: "cost_updated",
      turnId: `${sessionId}:turn:1`,
      provider: { provider: "codex-oauth", model: "gpt-5.6-terra" },
      usage: {
        inputTokens: 9,
        outputTokens: 13,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
      },
      cost: { currency: "USD", deltaUsd: 0.25, totalUsd: 0.25 },
      timestamp: new Date("2026-08-24T18:01:06.000Z"),
    });
    const costUpdate2 = createSessionEvent<"cost_updated">({
      kilnSessionId: sessionId,
      sequence: 8,
      kind: "cost_updated",
      turnId: `${sessionId}:turn:1`,
      provider: { provider: "codex-oauth", model: "gpt-5.6-terra" },
      usage: {
        inputTokens: 15,
        outputTokens: 20,
        cacheReadTokens: 4,
        cacheWriteTokens: 2,
      },
      cost: { currency: "USD", deltaUsd: 0.3, totalUsd: 0.55 },
      timestamp: new Date("2026-08-24T18:01:07.000Z"),
    });
    const toolCallId = `${sessionId}:tool:1`;
    const toolCallScopeId = `${sessionId}:scope:1`;
    const toolStarted = createSessionEvent<"tool_call_started">({
      kilnSessionId: sessionId,
      sequence: 4,
      kind: "tool_call_started",
      turnId: `${sessionId}:turn:1`,
      toolCallId,
      toolCallScopeId,
      toolName: "read_file",
      timestamp: new Date("2026-08-24T18:01:03.000Z"),
    });
    const toolDelta = createSessionEvent<"tool_call_output_delta">({
      kilnSessionId: sessionId,
      sequence: 5,
      kind: "tool_call_output_delta",
      turnId: `${sessionId}:turn:1`,
      toolCallId,
      toolCallScopeId,
      toolName: "read_file",
      stream: "stdout",
      delta: "contents",
      chunkIndex: 0,
      timestamp: new Date("2026-08-24T18:01:04.000Z"),
    });
    const toolCompleted = createSessionEvent<"tool_call_completed">({
      kilnSessionId: sessionId,
      sequence: 6,
      kind: "tool_call_completed",
      turnId: `${sessionId}:turn:1`,
      toolCallId,
      toolCallScopeId,
      toolName: "read_file",
      status: { state: "succeeded" },
      durationMs: 10,
      timestamp: new Date("2026-08-24T18:01:05.000Z"),
    });
    const coherentEvents = [
      ...events.slice(0, 3),
      toolStarted,
      toolDelta,
      toolCompleted,
      ...events.slice(3, 5),
      costUpdate,
      costUpdate2,
      events[5]!,
    ];

    await coherentPersist(coherentEvents);
    await incrementalPersist(events.slice(0, 3));
    await incrementalPersist([toolStarted]);
    await incrementalPersist([toolDelta]);
    await incrementalPersist([toolCompleted]);
    await incrementalPersist(events.slice(3, 5));
    await incrementalPersist([costUpdate]);
    await incrementalPersist([costUpdate2]);
    await incrementalPersist([costUpdate2]);
    await incrementalPersist([events[5]!]);

    const [incrementalMeta, coherentMeta, incrementalRecord, coherentRecord] = await Promise.all([
      incrementalTranscriptStore.readMeta(sessionId),
      coherentTranscriptStore.readMeta(sessionId),
      incrementalSessionStore.find(sessionId),
      coherentSessionStore.find(sessionId),
    ]);
    expect(incrementalMeta).toMatchObject({
      costUsd: 0.55,
      inputTokens: 15,
      outputTokens: 20,
      cacheReadTokens: 4,
      cacheWriteTokens: 2,
      providerTokenUsage: [
        {
          provider: "codex-oauth",
          model: "gpt-5.6-terra",
          inputTokens: 15,
          outputTokens: 20,
          cacheReadTokens: 4,
          cacheWriteTokens: 2,
        },
      ],
    });
    expect(incrementalMeta).toMatchObject({
      provider: coherentMeta?.provider,
      canonicalTitle: coherentMeta?.canonicalTitle,
      title: coherentMeta?.title,
      summary: coherentMeta?.summary,
      tags: coherentMeta?.tags,
      providersUsed: coherentMeta?.providersUsed,
      startedAt: coherentMeta?.startedAt,
      completedAt: coherentMeta?.completedAt,
      lastTurnOutcome: coherentMeta?.lastTurnOutcome,
      costUsd: coherentMeta?.costUsd,
      inputTokens: coherentMeta?.inputTokens,
      outputTokens: coherentMeta?.outputTokens,
      cacheReadTokens: coherentMeta?.cacheReadTokens,
      cacheWriteTokens: coherentMeta?.cacheWriteTokens,
      toolCount: coherentMeta?.toolCount,
      turnDepth: coherentMeta?.turnDepth,
      sessionLedger: coherentMeta?.sessionLedger,
    });
    expect(incrementalRecord).toMatchObject({
      provider: coherentRecord?.provider,
      title: coherentRecord?.title,
      summary: coherentRecord?.summary,
      tags: coherentRecord?.tags,
      providersUsed: coherentRecord?.providersUsed,
      cost: coherentRecord?.cost,
      completedAt: coherentRecord?.completedAt,
    });
  });
});

function turnEvents(input: {
  readonly sessionId: string;
  readonly turnOrdinal: number;
  readonly prompt: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly sequence: number;
}): readonly CanonicalSessionEvent[] {
  const turnId = `${input.sessionId}:turn:${input.turnOrdinal}`;
  const timestamp = (offset: number) => new Date(Date.UTC(2026, 7, 24, 18, input.turnOrdinal, offset));
  return [
    createSessionEvent<"turn_started">({
      kilnSessionId: input.sessionId,
      sequence: input.sequence,
      kind: "turn_started",
      turnId,
      turnOrdinal: input.turnOrdinal,
      trigger: "user_message",
      timestamp: timestamp(0),
    }),
    createSessionEvent<"user_message">({
      kilnSessionId: input.sessionId,
      sequence: input.sequence + 1,
      kind: "user_message",
      turnId,
      messageId: `${turnId}:user`,
      content: input.prompt,
      timestamp: timestamp(1),
    }),
    createSessionEvent<"provider_routed">({
      kilnSessionId: input.sessionId,
      sequence: input.sequence + 2,
      kind: "provider_routed",
      turnId,
      routeId: "codex-default",
      provider: { provider: "codex-oauth", model: "gpt-5.6-terra" },
      reason: "test route",
      timestamp: timestamp(2),
    }),
    createSessionEvent<"assistant_message">({
      kilnSessionId: input.sessionId,
      sequence: input.sequence + 3,
      kind: "assistant_message",
      turnId,
      messageId: `${turnId}:assistant`,
      content: "Completed.",
      provider: { provider: "codex-oauth", model: "gpt-5.6-terra" },
      timestamp: timestamp(3),
    }),
    createSessionEvent<"cost_updated">({
      kilnSessionId: input.sessionId,
      sequence: input.sequence + 4,
      kind: "cost_updated",
      turnId,
      provider: { provider: "codex-oauth", model: "gpt-5.6-terra" },
      usage: {
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      cost: { currency: "USD", deltaUsd: 0 },
      timestamp: timestamp(4),
    }),
    createSessionEvent<"turn_completed">({
      kilnSessionId: input.sessionId,
      sequence: input.sequence + 5,
      kind: "turn_completed",
      turnId,
      ...runtimeCompletedDisposition(),
      outputMessageId: `${turnId}:assistant`,
      timestamp: timestamp(5),
    }),
  ];
}
