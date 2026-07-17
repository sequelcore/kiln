export type ConversationProjectionRole = "user" | "assistant" | "tool" | "error";

export interface ConversationProjectionMessageInput {
  readonly id: string;
  readonly kind: "message";
  readonly role: ConversationProjectionRole;
  readonly turnId?: string;
  readonly streaming?: boolean;
}

export interface ConversationProjectionEventInput {
  readonly id: string;
  readonly kind: "event";
  readonly eventKind: string;
  readonly turnId?: string;
  readonly toolCallId?: string;
}

export type ConversationProjectionInput =
  | ConversationProjectionMessageInput
  | ConversationProjectionEventInput;

export interface ConversationProjectionActivityInput<TPhase extends string = string> {
  readonly phase: TPhase;
  readonly toolName?: string;
  readonly details?: string;
}

export type ConversationProjectionItem<TPhase extends string = string> =
  | {
      readonly kind: "message";
      readonly entryId: string;
      readonly beforeEventIds: readonly string[];
      readonly afterEventIds: readonly string[];
    }
  | {
      readonly kind: "activity";
      readonly phase: TPhase;
      readonly toolName?: string;
      readonly details?: string;
      readonly eventIds: readonly string[];
    }
  | {
      readonly kind: "event";
      readonly entryId: string;
    };

export interface ConversationTurnProjectionOptions<TPhase extends string = string> {
  readonly activity?: ConversationProjectionActivityInput<TPhase>;
  readonly collapseCompletedToolStarts?: boolean;
  readonly anchorToolEventsToAssistant?: boolean;
}

type MutableProjectedMessageItem = {
  kind: "message";
  entryId: string;
  beforeEventIds: string[];
  afterEventIds: string[];
};

export function operatorEventAnchorsAssistantTurn(eventKind: string): boolean {
  return eventKind === "tool_call_started" || eventKind === "tool_call_completed";
}

export function projectConversationTurnItems<TPhase extends string = string>(
  entries: readonly ConversationProjectionInput[],
  options: ConversationTurnProjectionOptions<TPhase> = {},
): readonly ConversationProjectionItem<TPhase>[] {
  const items: ConversationProjectionItem<TPhase>[] = [];
  const pendingToolEvents: ConversationProjectionEventInput[] = [];
  const anchorToolEventsToAssistant = options.anchorToolEventsToAssistant !== false;
  let lastAssistantItem: MutableProjectedMessageItem | null = null;
  const visibleEntries = options.collapseCompletedToolStarts === false
    ? [...entries]
    : removeCompletedStartedToolEvents(entries);

  const flushPendingToolEvents = (mode: "standalone" | "activity" = "standalone"): void => {
    if (pendingToolEvents.length === 0) return;
    if (mode === "activity" && options.activity) {
      items.push({
        kind: "activity",
        phase: options.activity.phase,
        toolName: options.activity.toolName,
        details: options.activity.details,
        eventIds: pendingToolEvents.map((entry) => entry.id),
      });
      pendingToolEvents.length = 0;
      return;
    }
    for (const entry of pendingToolEvents) {
      items.push({ kind: "event", entryId: entry.id });
    }
    pendingToolEvents.length = 0;
  };

  for (const entry of visibleEntries) {
    if (entry.kind === "event" && operatorEventAnchorsAssistantTurn(entry.eventKind)) {
      if (!anchorToolEventsToAssistant) {
        flushPendingToolEvents();
        items.push({ kind: "event", entryId: entry.id });
        lastAssistantItem = null;
        continue;
      }
      if (
        lastAssistantItem
        && pendingToolEvents.length === 0
        && turnIdsCompatible(entry.turnId, turnIdForItem(lastAssistantItem, visibleEntries))
      ) {
        lastAssistantItem.beforeEventIds = [...lastAssistantItem.beforeEventIds, entry.id];
        continue;
      }
      pendingToolEvents.push(entry);
      continue;
    }

    if (entry.kind === "message") {
      if (entry.role === "assistant") {
        const compatiblePending = pendingToolEvents.filter((event) => turnIdsCompatible(event.turnId, entry.turnId));
        const incompatiblePending = pendingToolEvents.filter((event) => !turnIdsCompatible(event.turnId, entry.turnId));
        pendingToolEvents.length = 0;
        pendingToolEvents.push(...incompatiblePending);
        flushPendingToolEvents();
        const item: MutableProjectedMessageItem = {
          kind: "message",
          entryId: entry.id,
          beforeEventIds: compatiblePending.map((event) => event.id),
          afterEventIds: [],
        };
        items.push(item);
        lastAssistantItem = item;
        continue;
      }

      flushPendingToolEvents();
      items.push({ kind: "message", entryId: entry.id, beforeEventIds: [], afterEventIds: [] });
      lastAssistantItem = null;
      continue;
    }

    flushPendingToolEvents();
    items.push({ kind: "event", entryId: entry.id });
    lastAssistantItem = null;
  }

  flushPendingToolEvents(options.activity ? "activity" : "standalone");
  if (options.activity) {
    const lastItem = items[items.length - 1];
    if (!lastItem || lastItem.kind !== "activity") {
      items.push({
        kind: "activity",
        phase: options.activity.phase,
        toolName: options.activity.toolName,
        details: options.activity.details,
        eventIds: [],
      });
    }
  }

  return items;
}

function removeCompletedStartedToolEvents(
  entries: readonly ConversationProjectionInput[],
): readonly ConversationProjectionInput[] {
  const completedToolCallIds = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "event" || entry.eventKind !== "tool_call_completed" || !entry.toolCallId) continue;
    completedToolCallIds.add(entry.toolCallId);
  }
  if (completedToolCallIds.size === 0) {
    return [...entries];
  }
  return entries.filter((entry) => (
    entry.kind !== "event"
    || entry.eventKind !== "tool_call_started"
    || !entry.toolCallId
    || !completedToolCallIds.has(entry.toolCallId)
  ));
}

function turnIdsCompatible(left: string | undefined, right: string | undefined): boolean {
  return !left || !right || left === right;
}

function turnIdForItem(
  item: Extract<ConversationProjectionItem, { readonly kind: "message" }>,
  entries: readonly ConversationProjectionInput[],
): string | undefined {
  return entries.find((entry) => entry.id === item.entryId)?.turnId;
}
