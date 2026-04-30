import type {
  KilnEvent,
  MemoryContextAdmittedEvent,
  MemoryContextDeferredEvent,
  MemoryRecordCreatedEvent,
  MemoryRecordDeletedEvent,
  MemoryRecordUpdatedEvent,
  MemoryRelationCreatedEvent,
  MemoryRelationDeletedEvent,
  MemoryRevisionCreatedEvent,
} from "@kilnai/core";
import type { GuiMemoryLatticeInvalidatedFrame } from "@kilnai/gateway-contracts";

type MemoryLatticeEvent =
  | MemoryRecordCreatedEvent
  | MemoryRecordUpdatedEvent
  | MemoryRecordDeletedEvent
  | MemoryRelationCreatedEvent
  | MemoryRelationDeletedEvent
  | MemoryRevisionCreatedEvent
  | MemoryContextAdmittedEvent
  | MemoryContextDeferredEvent;

export function projectMemoryLatticeInvalidationFrame(
  event: KilnEvent,
): GuiMemoryLatticeInvalidatedFrame | null {
  if (!isMemoryLatticeEvent(event)) {
    return null;
  }

  const base = {
    type: "memory_lattice_invalidated",
    occurredAt: event.timestamp.toISOString(),
    ...(event.scope ? { scope: event.scope } : {}),
  } satisfies Pick<GuiMemoryLatticeInvalidatedFrame, "type" | "occurredAt" | "scope">;

  switch (event.type) {
    case "memory_record_created": return {
      ...base,
      reason: "record_created",
      layer: event.layer,
      recordId: event.recordId,
    };
    case "memory_record_updated": return {
      ...base,
      reason: "record_updated",
      layer: event.layer,
      recordId: event.recordId,
    };
    case "memory_record_deleted": return {
      ...base,
      reason: "record_deleted",
      layer: event.layer,
      recordId: event.recordId,
    };
    case "memory_relation_created": return {
      ...base,
      reason: "relation_created",
      relationId: event.relationId,
      recordId: event.sourceRecordId,
    };
    case "memory_relation_deleted": return {
      ...base,
      reason: "relation_deleted",
      relationId: event.relationId,
      recordId: event.sourceRecordId,
    };
    case "memory_revision_created": return {
      ...base,
      reason: "revision_created",
      revisionId: event.revisionId,
      recordId: event.recordId,
    };
    case "memory_context_admitted": return {
      ...base,
      reason: "context_admitted",
      admissionId: event.admissionId,
      recordId: event.recordId,
    };
    case "memory_context_deferred": return {
      ...base,
      reason: "context_deferred",
      admissionId: event.admissionId,
      recordId: event.recordId,
    };
  }
}

function isMemoryLatticeEvent(event: KilnEvent): event is MemoryLatticeEvent {
  return event.type === "memory_record_created"
    || event.type === "memory_record_updated"
    || event.type === "memory_record_deleted"
    || event.type === "memory_relation_created"
    || event.type === "memory_relation_deleted"
    || event.type === "memory_revision_created"
    || event.type === "memory_context_admitted"
    || event.type === "memory_context_deferred";
}
