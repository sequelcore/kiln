import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelRegistry } from "../../src/channels/channel-registry.js";
import type { Channel, OutgoingMessage, EngineEvent } from "@kilnai/core";

function makeChannel(name: string): Channel {
  return {
    name,
    defaultFormat: "full",
    receive: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMessage(target = "user-1"): OutgoingMessage {
  return { content: "Hello", target };
}

describe("ChannelRegistry", () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  describe("register/unregister", () => {
    it("registers and retrieves a channel", () => {
      const ch = makeChannel("web");
      registry.register(ch);

      expect(registry.get("web")).toBe(ch);
      expect(registry.size).toBe(1);
    });

    it("returns undefined for unknown channel", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("unregisters a channel", () => {
      registry.register(makeChannel("slack"));
      expect(registry.unregister("slack")).toBe(true);
      expect(registry.get("slack")).toBeUndefined();
      expect(registry.size).toBe(0);
    });

    it("returns false when unregistering unknown channel", () => {
      expect(registry.unregister("nope")).toBe(false);
    });

    it("overwrites existing channel with same name", () => {
      const ch1 = makeChannel("web");
      const ch2 = makeChannel("web");
      registry.register(ch1);
      registry.register(ch2);

      expect(registry.get("web")).toBe(ch2);
      expect(registry.size).toBe(1);
    });
  });

  describe("getAll", () => {
    it("returns all registered channels", () => {
      registry.register(makeChannel("cli"));
      registry.register(makeChannel("web"));
      registry.register(makeChannel("slack"));

      const all = registry.getAll();
      expect(all).toHaveLength(3);
      expect(all.map((c) => c.name).sort()).toEqual(["cli", "slack", "web"]);
    });

    it("returns empty array when no channels registered", () => {
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe("sendTo", () => {
    it("sends message to named channel", async () => {
      const ch = makeChannel("web");
      registry.register(ch);

      const msg = makeMessage();
      const ok = await registry.sendTo("web", msg);

      expect(ok).toBe(true);
      expect(ch.send).toHaveBeenCalledWith(msg);
    });

    it("returns false for unknown channel", async () => {
      const ok = await registry.sendTo("nope", makeMessage());
      expect(ok).toBe(false);
    });
  });

  describe("broadcast", () => {
    it("sends to all channels", async () => {
      const ch1 = makeChannel("cli");
      const ch2 = makeChannel("web");
      registry.register(ch1);
      registry.register(ch2);

      const msg = makeMessage();
      await registry.broadcast(msg);

      expect(ch1.send).toHaveBeenCalledWith(msg);
      expect(ch2.send).toHaveBeenCalledWith(msg);
    });

    it("does not throw if a channel send fails", async () => {
      const good = makeChannel("good");
      const bad = makeChannel("bad");
      vi.mocked(bad.send).mockRejectedValue(new Error("network"));
      registry.register(good);
      registry.register(bad);

      await expect(registry.broadcast(makeMessage())).resolves.not.toThrow();
      expect(good.send).toHaveBeenCalled();
    });
  });

  describe("streamTo", () => {
    it("streams events to named channel", async () => {
      const ch = makeChannel("web");
      registry.register(ch);

      async function* events(): AsyncGenerator<EngineEvent> {
        yield { type: "phase_changed", timestamp: new Date(), payload: {} };
      }

      await registry.streamTo("web", events());

      expect(ch.stream).toHaveBeenCalled();
    });

    it("does nothing for unknown channel", async () => {
      async function* events(): AsyncGenerator<EngineEvent> {
        yield { type: "test", timestamp: new Date(), payload: {} };
      }

      await expect(registry.streamTo("nope", events())).resolves.not.toThrow();
    });
  });
});
