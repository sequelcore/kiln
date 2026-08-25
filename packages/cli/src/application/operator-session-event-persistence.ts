import {
  executionSessionBindingKey,
  type CanonicalSessionEvent,
  type ExecutionSessionBindingEvidence,
} from "@kilnai/core";
import type { CanonicalSessionEventPersistence } from "@kilnai/runtime";
import {
  type PersistedProviderTokenUsage,
  type PersistedSessionMeta,
  type SessionStore,
  type TranscriptStore,
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

    await input.transcriptStore.appendManyNext(
      sessionId,
      events.map(toCanonicalSessionEventPersistedTranscriptEventDraft),
    );

    const transcript = await input.transcriptStore.readTranscript(sessionId);
    const canonicalEvents = canonicalSessionEventsFromTranscript(transcript, sessionId);
    if (!canonicalEvents.some((event) => event.kind === "turn_started")) return;

    const [existingMeta, authorityAdmissions] = await Promise.all([
      input.transcriptStore.readMeta(sessionId),
      input.transcriptStore.readAuthorityAdmissions(sessionId),
    ]);
    const meta = projectSessionMeta({
      sessionId,
      events: canonicalEvents,
      existingMeta,
      workingDirectory: input.workingDirectory,
      executionBindings: authorityAdmissions.flatMap((record) => (
        record.bundle.turn.execution.status === "routed"
          ? [record.bundle.turn.execution.binding]
          : []
      )),
    });
    await input.transcriptStore.init(sessionId, meta);
    await input.sessionStore.append({
      sessionId,
      provider: meta.provider,
      task: meta.task,
      canonicalTitle: meta.canonicalTitle,
      title: meta.title,
      summary: meta.summary,
      tags: meta.tags,
      providersUsed: meta.providersUsed,
      completedAt: meta.completedAt ?? meta.startedAt,
      cost: meta.costUsd ?? 0,
      projectPath: input.workingDirectory,
      ...(meta.providerThread ? { providerThread: meta.providerThread } : {}),
      ...(meta.resumeStrategy ? { resumeStrategy: meta.resumeStrategy } : {}),
    }, { updateContinuationTarget: false });
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
  const userMessages = input.events.flatMap((event) => event.kind === "user_message" ? [event.content] : []);
  let canonicalTitle: string | undefined;
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
  const latestTurn = input.events.filter((event) => event.kind === "turn_completed").at(-1);
  const latestError = input.events.filter((event) => event.kind === "error_recorded").at(-1);
  const executionBindings = dedupeExecutionBindings([
    ...(input.existingMeta?.executionBindings ?? []),
    ...input.executionBindings,
  ]);
  const usage = projectTokenUsage(input.events);
  const exactArtifacts = [...new Set([
    ...(input.existingMeta?.exactArtifacts ?? []),
    ...input.events.flatMap((event) => event.kind === "file_changed" ? [event.change.path] : []),
  ])];

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
    startedAt: turnStartedEvents[0]?.timestamp.toISOString()
      ?? input.existingMeta?.startedAt
      ?? firstTimestamp,
    ...(latestTurn ? {
      completedAt: latestTurn.timestamp.toISOString(),
      lastTurnOutcome: latestTurn.outcome,
    } : {}),
    costUsd: usage.costUsd,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    providerTokenUsage: usage.byProvider,
    executionBindings,
    toolCount: input.events.filter((event) => event.kind === "tool_call_completed").length,
    turnDepth: turnStartedEvents.length,
    sessionLedger: {
      ...input.existingMeta?.sessionLedger,
      currentPhase: latestTurn ? "completed" : "interactive",
      workingDirectory: input.workingDirectory,
      ...(latestError ? { lastError: latestError.message } : {}),
      ...(latestProvider ? { lastProvider: latestProvider.provider } : {}),
      toolCallCount: input.events.filter((event) => event.kind === "tool_call_completed").length,
      turnDepth: turnStartedEvents.length,
    },
    ...(exactArtifacts.length > 0 ? { exactArtifacts } : {}),
  };
}

function dedupeExecutionBindings(
  bindings: readonly ExecutionSessionBindingEvidence[],
): readonly ExecutionSessionBindingEvidence[] {
  return [...new Map(bindings.map((binding) => [executionSessionBindingKey(binding), binding])).values()];
}

function projectTokenUsage(events: readonly CanonicalSessionEvent[]): {
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly byProvider: readonly PersistedProviderTokenUsage[];
} {
  const latestByTurnProvider = new Map<string, Extract<CanonicalSessionEvent, { readonly kind: "cost_updated" }>>();
  let costUsd = 0;
  for (const event of events) {
    if (event.kind !== "cost_updated") continue;
    costUsd += event.cost.deltaUsd;
    latestByTurnProvider.set(
      `${event.turnId ?? event.eventId}\0${event.provider.provider}\0${event.provider.model}`,
      event,
    );
  }

  const byProvider = new Map<string, PersistedProviderTokenUsage>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  for (const event of latestByTurnProvider.values()) {
    inputTokens += event.usage.inputTokens;
    outputTokens += event.usage.outputTokens;
    cacheReadTokens += event.usage.cacheReadTokens;
    cacheWriteTokens += event.usage.cacheWriteTokens;
    const key = `${event.provider.provider}\0${event.provider.model}`;
    const current = byProvider.get(key);
    byProvider.set(key, {
      provider: event.provider.provider,
      model: event.provider.model,
      inputTokens: (current?.inputTokens ?? 0) + event.usage.inputTokens,
      outputTokens: (current?.outputTokens ?? 0) + event.usage.outputTokens,
      cacheReadTokens: (current?.cacheReadTokens ?? 0) + event.usage.cacheReadTokens,
      cacheWriteTokens: (current?.cacheWriteTokens ?? 0) + event.usage.cacheWriteTokens,
    });
  }

  return {
    costUsd,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    byProvider: [...byProvider.values()],
  };
}
