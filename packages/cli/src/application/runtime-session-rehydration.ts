import {
  reconstructGoalRunsFromSessionEvents,
  reconstructWorkItemsFromSessionEvents,
  textParts,
  type CanonicalSessionEvent,
  type GoalRunStore,
  type WorkItemStore,
} from "@kilnai/core";
import type { RuntimeSession, RuntimeSessionHydrator } from "@kilnai/runtime";
import type { PersistedTranscriptEvent, TranscriptStore } from "../wrapper/session-store.js";

export interface TranscriptRuntimeSessionHydratorOptions {
  readonly transcriptStore: TranscriptStore;
  readonly workItemStore?: WorkItemStore;
  readonly goalRunStore?: GoalRunStore;
  readonly maxMessages?: number;
  readonly maxCharacters?: number;
}

interface ConversationEntry {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly sequence: number;
}

interface AssistantDeltaBuffer {
  readonly messageId: string;
  readonly firstSequence: number;
  readonly parts: string[];
}

const DEFAULT_MAX_MESSAGES = 40;
const DEFAULT_MAX_CHARACTERS = 120_000;

function textPayload(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function conversationEntriesFromTranscript(events: readonly PersistedTranscriptEvent[]): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  const assistantMessageIds = new Set<string>();
  const assistantDeltaBuffers = new Map<string, AssistantDeltaBuffer>();

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.kind === "user_message") {
      const content = textPayload(event.payload, "content");
      if (content) {
        entries.push({ role: "user", content, sequence: event.sequence });
      }
      continue;
    }

    if (event.kind === "assistant_message") {
      const content = textPayload(event.payload, "content");
      const messageId = textPayload(event.payload, "messageId");
      if (messageId) {
        assistantMessageIds.add(messageId);
      }
      if (content) {
        entries.push({ role: "assistant", content, sequence: event.sequence });
      }
      continue;
    }

    if (event.kind === "assistant_delta") {
      const delta = textPayload(event.payload, "delta");
      const messageId = textPayload(event.payload, "messageId") ?? `${event.turnId ?? "turn"}:assistant`;
      if (!delta) {
        continue;
      }
      const existing = assistantDeltaBuffers.get(messageId);
      if (existing) {
        existing.parts.push(delta);
      } else {
        assistantDeltaBuffers.set(messageId, {
          messageId,
          firstSequence: event.sequence,
          parts: [delta],
        });
      }
    }
  }

  for (const buffer of assistantDeltaBuffers.values()) {
    if (assistantMessageIds.has(buffer.messageId)) {
      continue;
    }
    const content = buffer.parts.join("").trim();
    if (content) {
      entries.push({ role: "assistant", content, sequence: buffer.firstSequence });
    }
  }

  return entries.sort((left, right) => left.sequence - right.sequence);
}

function boundConversationEntries(
  entries: readonly ConversationEntry[],
  maxMessages: number,
  maxCharacters: number,
): ConversationEntry[] {
  const bounded: ConversationEntry[] = [];
  let remainingCharacters = maxCharacters;

  for (const entry of [...entries].slice(-maxMessages).reverse()) {
    if (remainingCharacters <= 0) {
      break;
    }
    const content = entry.content.length > remainingCharacters
      ? entry.content.slice(entry.content.length - remainingCharacters)
      : entry.content;
    bounded.push({ ...entry, content });
    remainingCharacters -= content.length;
  }

  return bounded.reverse();
}

function hydrateRuntimeSession(session: RuntimeSession, entries: readonly ConversationEntry[]): number {
  let messageCount = 0;
  for (const entry of entries) {
    if (entry.role === "user") {
      session.addUserMessage(textParts(entry.content));
    } else {
      session.addAssistantMessage(textParts(entry.content));
    }
    messageCount += 1;
  }
  return messageCount;
}

function canonicalSessionEventsFromTranscript(
  events: readonly PersistedTranscriptEvent[],
  sessionId: string,
): CanonicalSessionEvent[] {
  return [...events]
    .filter((event) => event.kilnSessionId === sessionId)
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => {
      const { payload, timestamp, ...envelope } = event;
      return {
        ...payload,
        ...envelope,
        timestamp: new Date(timestamp),
      } as CanonicalSessionEvent;
    });
}

function hydrateRuntimeSessionEvents(
  session: RuntimeSession,
  events: readonly PersistedTranscriptEvent[],
  sessionId: string,
): readonly CanonicalSessionEvent[] {
  if (session.sessionEvents.length > 0) {
    return session.sessionEvents;
  }
  const canonicalEvents = canonicalSessionEventsFromTranscript(events, sessionId);
  if (canonicalEvents.length === 0) {
    return [];
  }
  session.appendSessionEvents(canonicalEvents);
  return canonicalEvents;
}

function hydrateWorkGovernanceStores(
  events: readonly CanonicalSessionEvent[],
  options: Pick<TranscriptRuntimeSessionHydratorOptions, "workItemStore" | "goalRunStore">,
): void {
  if (options.workItemStore) {
    for (const item of reconstructWorkItemsFromSessionEvents(events).items) {
      if (!options.workItemStore.get(item.id)) {
        options.workItemStore.restore(item);
      }
    }
  }
  if (options.goalRunStore) {
    for (const goal of reconstructGoalRunsFromSessionEvents(events).goals) {
      if (!options.goalRunStore.get(goal.id)) {
        options.goalRunStore.restore(goal);
      }
    }
  }
}

export function createTranscriptRuntimeSessionHydrator(
  options: TranscriptRuntimeSessionHydratorOptions,
): RuntimeSessionHydrator {
  const maxMessages = Math.max(1, options.maxMessages ?? DEFAULT_MAX_MESSAGES);
  const maxCharacters = Math.max(1, options.maxCharacters ?? DEFAULT_MAX_CHARACTERS);

  return async ({ sessionId, session }) => {
    const transcript = await options.transcriptStore.readTranscript(sessionId);
    const entries = boundConversationEntries(
      conversationEntriesFromTranscript(transcript),
      maxMessages,
      maxCharacters,
    );
    const messageCount = hydrateRuntimeSession(session, entries);
    const sessionEvents = hydrateRuntimeSessionEvents(session, transcript, sessionId);
    hydrateWorkGovernanceStores(sessionEvents, options);

    if (messageCount === 0 && sessionEvents.length === 0) {
      return {
        rehydrated: false,
        messageCount,
        reason: "no-conversation-events",
      };
    }

    return {
      rehydrated: true,
      messageCount,
      reason: "transcript-store",
      sourceSequence: transcript.at(-1)?.sequence,
    };
  };
}
