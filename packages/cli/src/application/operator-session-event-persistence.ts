import {
  executionSessionBindingKey,
  type CanonicalSessionEvent,
  type ExecutionSessionBindingEvidence,
} from "@kilnai/core";
import type { CanonicalSessionEventPersistence } from "@kilnai/runtime";
import type {
  PersistedProviderTokenUsage,
  PersistedProviderTokenUsageSnapshot,
  PersistedSessionMeta,
  SessionStore,
  TranscriptStore,
} from "../wrapper/session-store.js";
import { deriveSessionMetadata, shouldPromoteLatestPromptToSessionTitle } from "./session-metadata.js";
import { toCanonicalSessionEventPersistedTranscriptEventDraft } from "./operator-transcript-projection.js";
import { canonicalSessionEventsFromTranscript } from "./runtime-session-rehydration.js";

export function createOperatorSessionEventPersistence(input: {
  readonly sessionStore: SessionStore;
  readonly transcriptStore: TranscriptStore;
  readonly workingDirectory: string;
}): CanonicalSessionEventPersistence {
  return async (events) => {
    const sessionId = requireSingleSession(events);
    if (!sessionId) return;

    await input.transcriptStore.withSessionMutation(sessionId, async (mutation) => {
      const appendedTranscriptEvents = await mutation.appendManyNext(
        events.map(toCanonicalSessionEventPersistedTranscriptEventDraft),
      );

      const [existingMeta, authorityAdmissions] = await Promise.all([
        mutation.readMeta(),
        mutation.readAuthorityAdmissions(),
      ]);
      let projectionBase = existingMeta;
      let canonicalEvents = canonicalSessionEventsFromTranscript(appendedTranscriptEvents, sessionId);
      const projectedSequence = existingMeta?.projectedTranscriptSequence;
      const hasProjectionGap =
        projectedSequence !== undefined && appendedTranscriptEvents[0]?.sequence !== projectedSequence + 1;
      const requiresCanonicalRebuild = existingMeta !== null && projectedSequence === undefined;
      if (requiresCanonicalRebuild) {
        // Metadata written before the projection cursor existed has no
        // trustworthy transcript position. Rebuild canonical fields once,
        // retaining only evidence that the transcript does not own.
        canonicalEvents = canonicalSessionEventsFromTranscript(await mutation.readTranscript(), sessionId);
        projectionBase = nonCanonicalSessionMeta(existingMeta);
      } else if (hasProjectionGap) {
        // A prior process may have settled the JSONL append but stopped before
        // materializing metadata. Replay only the unprojected canonical suffix.
        canonicalEvents = canonicalSessionEventsFromTranscript(
          (await mutation.readTranscript()).filter((event) => event.sequence > projectedSequence),
          sessionId,
        );
      } else if (!existingMeta && !canonicalEvents.some((event) => event.kind === "turn_started")) {
        // A process can stop after the transcript append and before metadata is
        // materialized. Rebuild that interrupted projection from canonical
        // JSONL while the same session owner still holds the mutation lock.
        canonicalEvents = canonicalSessionEventsFromTranscript(await mutation.readTranscript(), sessionId);
      }
      if (!existingMeta && !canonicalEvents.some((event) => event.kind === "turn_started")) {
        return;
      }

      const meta =
        canonicalEvents.length === 0 && existingMeta
          ? existingMeta
          : canonicalEvents.length === 0
            ? null
            : projectSessionMeta({
                sessionId,
                events: canonicalEvents,
                existingMeta: projectionBase,
                workingDirectory: input.workingDirectory,
                executionBindings: authorityAdmissions.flatMap((record) =>
                  record.bundle.turn.execution.status === "routed" ? [record.bundle.turn.execution.binding] : [],
                ),
              });
      if (!meta) return;

      if (meta !== existingMeta) {
        await mutation.init(meta);
      }
      await input.sessionStore.replaceSnapshot(
        {
          sessionId,
          provider: meta.provider,
          task: meta.task,
          canonicalTitle: meta.canonicalTitle,
          title: meta.title,
          summary: meta.summary,
          tags: meta.tags,
          providersUsed: meta.providersUsed,
          completedAt: meta.completedAt ?? meta.startedAt,
          // SessionStore.replaceSnapshot consumes this cumulative value. It is
          // never merged as another turn delta.
          cost: meta.costUsd ?? 0,
          projectPath: input.workingDirectory,
          ...(meta.providerThread ? { providerThread: meta.providerThread } : {}),
          ...(meta.resumeStrategy ? { resumeStrategy: meta.resumeStrategy } : {}),
        },
        { updateContinuationTarget: false },
      );
    });
  };
}

function requireSingleSession(events: readonly CanonicalSessionEvent[]): string | undefined {
  const sessionId = events[0]?.kilnSessionId;
  if (!sessionId) return undefined;
  if (events.some((event) => event.kilnSessionId !== sessionId)) {
    throw new Error("A canonical session persistence batch cannot span sessions.");
  }
  return sessionId;
}

function projectSessionMeta(input: {
  readonly sessionId: string;
  readonly events: readonly CanonicalSessionEvent[];
  readonly existingMeta: PersistedSessionMeta | null;
  readonly workingDirectory: string;
  readonly executionBindings: readonly Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>[];
}): PersistedSessionMeta {
  const firstTimestamp = input.events[0]?.timestamp.toISOString();
  if (!firstTimestamp) throw new Error("Canonical session metadata requires at least one event.");
  const userMessages = input.events.flatMap((event) => (event.kind === "user_message" ? [event.content] : []));
  let canonicalTitle = input.existingMeta?.canonicalTitle;
  for (const prompt of userMessages) {
    if (!canonicalTitle || shouldPromoteLatestPromptToSessionTitle({ existingTitle: canonicalTitle, latestPrompt: prompt })) {
      canonicalTitle = deriveSessionMetadata({ prompt }).canonicalTitle;
    }
  }

  const routedProviders = input.events.flatMap((event) => event.kind === "provider_routed" ? [event.provider] : []);
  const latestProvider = routedProviders.at(-1);
  const task = input.existingMeta?.task ?? "interactive";
  const metadata = deriveSessionMetadata({
    task,
    canonicalTitle: canonicalTitle ?? input.existingMeta?.canonicalTitle,
    title: input.existingMeta?.title,
    tags: input.existingMeta?.tags,
    providersUsed: [
      ...(input.existingMeta?.providersUsed ?? []),
      ...routedProviders.map((provider) => provider.provider),
    ],
    provider: latestProvider?.provider ?? input.existingMeta?.provider,
    model: latestProvider?.model,
    hasFileChanges: input.events.some((event) => event.kind === "file_changed"),
    hasApprovals: input.events.some((event) => event.kind === "approval_requested"),
    hasError: input.events.some((event) => event.kind === "error_recorded"),
  });
  const turnStartedEvents = input.events.filter((event) => event.kind === "turn_started");
  const latestTurnStarted = turnStartedEvents.at(-1);
  const latestTurn = latestTurnStarted
    ? input.events
        .filter(
          (event): event is Extract<CanonicalSessionEvent, { readonly kind: "turn_completed" }> =>
            event.kind === "turn_completed" && event.turnId === latestTurnStarted.turnId,
        )
        .at(-1)
    : input.events
        .filter(
          (event): event is Extract<CanonicalSessionEvent, { readonly kind: "turn_completed" }> =>
            event.kind === "turn_completed",
        )
        .at(-1);
  const latestError = input.events.filter((event) => event.kind === "error_recorded").at(-1);
  const executionBindings = dedupeExecutionBindings([
    ...(input.existingMeta?.executionBindings ?? []),
    ...input.executionBindings,
  ]);
  const usage = projectTokenUsage({
    existingMeta: input.existingMeta,
    events: input.events,
  });
  const exactArtifacts = [
    ...new Set([
      ...(input.existingMeta?.exactArtifacts ?? []),
      ...input.events.flatMap((event) => (event.kind === "file_changed" ? [event.change.path] : [])),
    ]),
  ];
  const toolCount =
    (input.existingMeta?.toolCount ?? 0) + input.events.filter((event) => event.kind === "tool_call_completed").length;
  const turnDepth = (input.existingMeta?.turnDepth ?? 0) + turnStartedEvents.length;
  const hasNewTurn = turnStartedEvents.length > 0;
  const currentPhase = latestTurn
    ? "completed"
    : hasNewTurn
      ? "interactive"
      : (input.existingMeta?.sessionLedger?.currentPhase ?? "interactive");

  return {
    ...input.existingMeta,
    kilnSessionId: input.sessionId,
    provider: latestProvider?.provider ?? input.existingMeta?.provider ?? "unknown",
    canonicalTitle: metadata.canonicalTitle,
    title: metadata.title,
    summary: metadata.summary,
    tags: metadata.tags,
    providersUsed: metadata.providersUsed,
    task,
    startedAt: turnStartedEvents[0]?.timestamp.toISOString() ?? input.existingMeta?.startedAt ?? firstTimestamp,
    ...(latestTurn
      ? {
          completedAt: latestTurn.timestamp.toISOString(),
          lastTurnOutcome: latestTurn.outcome,
        }
      : hasNewTurn
        ? {
            completedAt: undefined,
            lastTurnOutcome: undefined,
          }
        : {}),
    costUsd: usage.costUsd,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    providerTokenUsage: usage.byProvider,
    providerTokenUsageSnapshots: usage.snapshots,
    projectedTranscriptSequence: Math.max(
      input.existingMeta?.projectedTranscriptSequence ?? 0,
      ...input.events.map((event) => event.sequence),
    ),
    executionBindings,
    toolCount,
    turnDepth,
    sessionLedger: {
      ...input.existingMeta?.sessionLedger,
      currentPhase,
      workingDirectory: input.workingDirectory,
      ...(latestError ? { lastError: latestError.message } : {}),
      ...(latestProvider ? { lastProvider: latestProvider.provider } : {}),
      toolCallCount: toolCount,
      turnDepth,
    },
    ...(exactArtifacts.length > 0 ? { exactArtifacts } : {}),
  };
}

function nonCanonicalSessionMeta(meta: PersistedSessionMeta): PersistedSessionMeta {
  return {
    kilnSessionId: meta.kilnSessionId,
    provider: meta.provider,
    task: meta.task,
    startedAt: meta.startedAt,
    ...(meta.providerThread ? { providerThread: meta.providerThread } : {}),
    ...(meta.resumeStrategy ? { resumeStrategy: meta.resumeStrategy } : {}),
    ...(meta.resumeFeedback ? { resumeFeedback: meta.resumeFeedback } : {}),
    ...(meta.resumeOutcome ? { resumeOutcome: meta.resumeOutcome } : {}),
  };
}

function dedupeExecutionBindings(
  bindings: readonly ExecutionSessionBindingEvidence[],
): readonly ExecutionSessionBindingEvidence[] {
  return [...new Map(bindings.map((binding) => [executionSessionBindingKey(binding), binding])).values()];
}

function projectTokenUsage(input: {
  readonly existingMeta: PersistedSessionMeta | null;
  readonly events: readonly CanonicalSessionEvent[];
}): {
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly byProvider: readonly PersistedProviderTokenUsage[];
  readonly snapshots: readonly PersistedProviderTokenUsageSnapshot[];
} {
  // Canonical cost_updated semantics are explicit: deltaUsd is the one-time
  // session-cost delta for this event identity; usage is a cumulative
  // turn/provider/model snapshot. Replacing the snapshot while summing only
  // deltas keeps incremental and replayed projections equivalent.
  const existingSnapshots = input.existingMeta?.providerTokenUsageSnapshots;
  const snapshots = new Map<string, PersistedProviderTokenUsageSnapshot>(
    (existingSnapshots ?? []).map((snapshot) => [snapshot.key, snapshot]),
  );
  const byProvider = new Map<string, PersistedProviderTokenUsage>();
  for (const usage of input.existingMeta?.providerTokenUsage ?? []) {
    byProvider.set(providerUsageKey(usage), { ...usage });
  }

  let costUsd = input.existingMeta?.costUsd ?? 0;
  for (const event of input.events) {
    if (event.kind !== "cost_updated") continue;
    costUsd += event.cost.deltaUsd;
    const snapshot = providerUsageSnapshot(event);
    const previous = snapshots.get(snapshot.key);
    if (previous) {
      adjustProviderUsage(byProvider, previous, -1);
    }
    snapshots.set(snapshot.key, snapshot);
    adjustProviderUsage(byProvider, snapshot, 1);
  }

  const totals = [...byProvider.values()].reduce(
    (current, usage) => ({
      inputTokens: current.inputTokens + (usage.inputTokens ?? 0),
      outputTokens: current.outputTokens + (usage.outputTokens ?? 0),
      cacheReadTokens: current.cacheReadTokens + (usage.cacheReadTokens ?? 0),
      cacheWriteTokens: current.cacheWriteTokens + (usage.cacheWriteTokens ?? 0),
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  );
  return {
    costUsd,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    byProvider: [...byProvider.values()],
    snapshots: [...snapshots.values()],
  };
}

function providerUsageKey(usage: Pick<PersistedProviderTokenUsage, "provider" | "model">): string {
  return `${usage.provider}\0${usage.model ?? ""}`;
}

function providerUsageSnapshot(
  event: Extract<CanonicalSessionEvent, { readonly kind: "cost_updated" }>,
): PersistedProviderTokenUsageSnapshot {
  return {
    key: `${event.turnId ?? event.eventId}\0${event.provider.provider}\0${event.provider.model}`,
    provider: event.provider.provider,
    model: event.provider.model,
    inputTokens: event.usage.inputTokens,
    outputTokens: event.usage.outputTokens,
    cacheReadTokens: event.usage.cacheReadTokens,
    cacheWriteTokens: event.usage.cacheWriteTokens,
  };
}

function adjustProviderUsage(
  byProvider: Map<string, PersistedProviderTokenUsage>,
  usage: PersistedProviderTokenUsage,
  direction: 1 | -1,
): void {
  const key = providerUsageKey(usage);
  const current = byProvider.get(key);
  byProvider.set(key, {
    provider: usage.provider,
    ...(usage.model !== undefined ? { model: usage.model } : {}),
    inputTokens: (current?.inputTokens ?? 0) + direction * (usage.inputTokens ?? 0),
    outputTokens: (current?.outputTokens ?? 0) + direction * (usage.outputTokens ?? 0),
    cacheReadTokens: (current?.cacheReadTokens ?? 0) + direction * (usage.cacheReadTokens ?? 0),
    cacheWriteTokens: (current?.cacheWriteTokens ?? 0) + direction * (usage.cacheWriteTokens ?? 0),
  });
}
