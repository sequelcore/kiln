import { describe, it, expect, vi } from "vitest";
import type { EventStore, KilnEvent } from "@kilnai/core/events";
import { CompositeEventStore } from "../../src/observability/composite-event-store.js";

function makeEvent(overrides: Partial<KilnEvent> = {}): KilnEvent {
  return {
    type: "phase_changed",
    timestamp: new Date(),
    sessionId: "sess-1",
    ...overrides,
  } as KilnEvent;
}

function makeMockStore(overrides: Partial<EventStore> = {}): EventStore {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    getBySession: vi.fn().mockResolvedValue([]),
    getAfter: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("CompositeEventStore", () => {
  describe("save()", () => {
    it("calls all stores", async () => {
      const s1 = makeMockStore();
      const s2 = makeMockStore();
      const composite = new CompositeEventStore([s1, s2]);
      const event = makeEvent();

      await composite.save(event);

      expect(s1.save).toHaveBeenCalledWith(event);
      expect(s2.save).toHaveBeenCalledWith(event);
    });

    it("continues if one store fails", async () => {
      const s1 = makeMockStore({
        save: vi.fn().mockRejectedValue(new Error("boom")),
      });
      const s2 = makeMockStore();
      const composite = new CompositeEventStore([s1, s2]);
      const event = makeEvent();

      // Should not throw
      await composite.save(event);

      expect(s1.save).toHaveBeenCalledWith(event);
      expect(s2.save).toHaveBeenCalledWith(event);
    });

    it("works with zero stores", async () => {
      const composite = new CompositeEventStore([]);
      await composite.save(makeEvent()); // no-op, no throw
    });
  });

  describe("getBySession()", () => {
    it("returns from first successful store", async () => {
      const events = [makeEvent({ sessionId: "sess-1" })];
      const s1 = makeMockStore({
        getBySession: vi.fn().mockResolvedValue(events),
      });
      const s2 = makeMockStore();
      const composite = new CompositeEventStore([s1, s2]);

      const result = await composite.getBySession("sess-1");

      expect(result).toEqual(events);
      expect(s2.getBySession).not.toHaveBeenCalled();
    });

    it("tries next store on failure", async () => {
      const events = [makeEvent()];
      const s1 = makeMockStore({
        getBySession: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const s2 = makeMockStore({
        getBySession: vi.fn().mockResolvedValue(events),
      });
      const composite = new CompositeEventStore([s1, s2]);

      const result = await composite.getBySession("sess-1");

      expect(result).toEqual(events);
      expect(s1.getBySession).toHaveBeenCalledWith("sess-1");
      expect(s2.getBySession).toHaveBeenCalledWith("sess-1");
    });

    it("returns empty array if all stores fail", async () => {
      const s1 = makeMockStore({
        getBySession: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const s2 = makeMockStore({
        getBySession: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const composite = new CompositeEventStore([s1, s2]);

      const result = await composite.getBySession("sess-1");

      expect(result).toEqual([]);
    });
  });

  describe("getAfter()", () => {
    it("returns from first successful store", async () => {
      const events = [makeEvent()];
      const s1 = makeMockStore({
        getAfter: vi.fn().mockResolvedValue(events),
      });
      const s2 = makeMockStore();
      const composite = new CompositeEventStore([s1, s2]);

      const result = await composite.getAfter("sess-1", "evt-5");

      expect(result).toEqual(events);
      expect(s2.getAfter).not.toHaveBeenCalled();
    });

    it("tries next store on failure", async () => {
      const events = [makeEvent()];
      const s1 = makeMockStore({
        getAfter: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const s2 = makeMockStore({
        getAfter: vi.fn().mockResolvedValue(events),
      });
      const composite = new CompositeEventStore([s1, s2]);

      const result = await composite.getAfter("sess-1", "evt-5");

      expect(result).toEqual(events);
    });

    it("returns empty array if all stores fail", async () => {
      const s1 = makeMockStore({
        getAfter: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const composite = new CompositeEventStore([s1]);

      const result = await composite.getAfter("sess-1", "evt-5");

      expect(result).toEqual([]);
    });
  });
});
