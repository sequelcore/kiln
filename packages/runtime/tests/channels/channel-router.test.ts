import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelRouter } from "../../src/channels/channel-router.js";
import { ChannelRegistry } from "../../src/channels/channel-registry.js";
import { InMemoryIdentityResolver } from "../../src/channels/types.js";
import type { Channel, IncomingMessage, OutgoingMessage } from "@kilnai/core";
import { textParts, extractText } from "@kilnai/core";

function makeChannel(name: string): Channel {
  return {
    name,
    defaultFormat: "full",
    receive: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMessage(text: string, overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return { parts: textParts(text), source: "test", ...overrides };
}

describe("ChannelRouter", () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  describe("resolveTeam()", () => {
    it("matches pattern rules", () => {
      const router = new ChannelRouter({
        rules: [
          { match: /trade|buy|sell/i, team: "trading" },
          { match: /research|investigate/i, team: "research" },
        ],
        fallbackTeam: "general",
        registry,
      });

      expect(router.resolveTeam("I want to buy AAPL")).toBe("trading");
      expect(router.resolveTeam("Investigate this paper")).toBe("research");
      expect(router.resolveTeam("Hello world")).toBe("general");
    });

    it("returns first matching rule", () => {
      const router = new ChannelRouter({
        rules: [
          { match: /hello/i, team: "greetings" },
          { match: /hello world/i, team: "specific" },
        ],
        fallbackTeam: "default",
        registry,
      });

      expect(router.resolveTeam("hello world")).toBe("greetings");
    });

    it("returns fallback when no rules match", () => {
      const router = new ChannelRouter({
        rules: [],
        fallbackTeam: "fallback",
        registry,
      });

      expect(router.resolveTeam("anything")).toBe("fallback");
    });
  });

  describe("route()", () => {
    it("resolves identity and routes to correct team", async () => {
      const resolver = new InMemoryIdentityResolver();
      resolver.addMapping("slack", "U123", "user-42");

      const router = new ChannelRouter({
        rules: [{ match: /deploy/i, team: "ops" }],
        fallbackTeam: "general",
        identityResolver: resolver,
        registry,
      });

      const result = await router.route("slack", makeMessage("deploy to staging", { userId: "U123" }));

      expect(result.team).toBe("ops");
      expect(result.engineUserId).toBe("user-42");
      expect(result.channelName).toBe("slack");
      expect(extractText(result.message.parts)).toBe("deploy to staging");
    });

    it("returns null userId when resolver has no mapping", async () => {
      const resolver = new InMemoryIdentityResolver();

      const router = new ChannelRouter({
        fallbackTeam: "default",
        identityResolver: resolver,
        registry,
      });

      const result = await router.route("web", makeMessage("hello", { userId: "unknown" }));
      expect(result.engineUserId).toBeNull();
    });

    it("skips identity resolution when no resolver provided", async () => {
      const router = new ChannelRouter({
        fallbackTeam: "default",
        registry,
      });

      const result = await router.route("cli", makeMessage("test", { userId: "u1" }));
      expect(result.engineUserId).toBeNull();
    });

    it("dispatches to route handler and sends response back", async () => {
      const ch = makeChannel("web");
      registry.register(ch);

      const router = new ChannelRouter({
        fallbackTeam: "default",
        registry,
      });

      const response: OutgoingMessage = { parts: textParts("Done"), target: "user-1" };
      router.onRoute(async () => response);

      await router.route("web", makeMessage("do something"));

      expect(ch.send).toHaveBeenCalledWith(response);
    });

    it("does not send when handler returns null", async () => {
      const ch = makeChannel("web");
      registry.register(ch);

      const router = new ChannelRouter({
        fallbackTeam: "default",
        registry,
      });

      router.onRoute(async () => null);

      await router.route("web", makeMessage("silent"));

      expect(ch.send).not.toHaveBeenCalled();
    });

    it("does not send when channel is not registered", async () => {
      const router = new ChannelRouter({
        fallbackTeam: "default",
        registry,
      });

      const response: OutgoingMessage = { parts: textParts("Done"), target: "user-1" };
      router.onRoute(async () => response);

      // Should not throw even though channel "unknown" is not registered
      await expect(router.route("unknown", makeMessage("test"))).resolves.toBeDefined();
    });
  });
});
