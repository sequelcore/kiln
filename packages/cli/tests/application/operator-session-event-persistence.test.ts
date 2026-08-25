import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionEvent, type CanonicalSessionEvent } from "@kilnai/core";
import { createOperatorSessionEventPersistence } from "../../src/application/operator-session-event-persistence.js";
import { loadOperatorSessionSummaries } from "../../src/application/operator-session-history.js";
import { SessionStore, TranscriptStore } from "../../src/wrapper/session-store.js";

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
      outcome: "completed",
      outputMessageId: `${turnId}:assistant`,
      timestamp: timestamp(5),
    }),
  ];
}
