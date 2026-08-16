import { describe, expect, it } from "vitest";
import type { MemoryRecordCreatedEvent, ModelRoutedEvent } from "@kilnai/core/events";
import { projectMemoryLatticeInvalidationFrame } from "../../src/gateway/gui-memory-lattice-events.js";

describe("projectMemoryLatticeInvalidationFrame", () => {
  it("projects memory domain events into bounded GUI invalidation frames", () => {
    const frame = projectMemoryLatticeInvalidationFrame({
      type: "memory_record_created",
      timestamp: new Date("2026-04-30T12:00:00.000Z"),
      sessionId: "memory-session",
      recordId: "record-1",
      scope: { kind: "project", id: "kiln" },
      layer: "semantic",
      topicKey: "Memory Lattice",
    } satisfies MemoryRecordCreatedEvent);

    expect(frame).toEqual({
      type: "memory_lattice_invalidated",
      occurredAt: "2026-04-30T12:00:00.000Z",
      reason: "record_created",
      scope: { kind: "project", id: "kiln" },
      layer: "semantic",
      recordId: "record-1",
    });
  });

  it("ignores unrelated runtime events", () => {
    const frame = projectMemoryLatticeInvalidationFrame({
      type: "model_routed",
      timestamp: new Date("2026-04-30T12:00:00.000Z"),
      sessionId: "session-1",
      provider: "codex",
      model: "gpt-5.4",
      reason: "operator selection",
    } satisfies ModelRoutedEvent);

    expect(frame).toBeNull();
  });
});
