import { describe, it, expect } from "vitest";
import { checkPingPong } from "../../src/tenant/ping-pong-guard.js";
import type { TenantRoutingConfig } from "@kilnai/core/engine";
import type { RoutingResult } from "../../src/tenant/tenant-router.js";

function mockSession(overrides: Partial<{
  activeAgentId: string | undefined;
  handoffCount: number;
  lastRouteChangeAt: number;
  conversationHistory: unknown[];
  agentTurnHistory: Array<{ agentId: string; turnIndex: number; fromAgentId?: string }>;
}> = {}) {
  return {
    activeAgentId: overrides.activeAgentId,
    handoffCount: overrides.handoffCount ?? 0,
    lastRouteChangeAt: overrides.lastRouteChangeAt ?? 0,
    conversationHistory: overrides.conversationHistory ?? [],
    agentTurnHistory: overrides.agentTurnHistory ?? [],
  } as any;
}

function routing(agentId: string): RoutingResult {
  return { agentId, tier: "rule" };
}

const baseConfig: TenantRoutingConfig = { fallback: "default" };

describe("checkPingPong", () => {
  it("same agent is never blocked", () => {
    const session = mockSession({ activeAgentId: "agent-a", handoffCount: 10 });
    const result = checkPingPong(routing("agent-a"), session, baseConfig);
    expect(result.blocked).toBe(false);
  });

  it("maxHandoffs exceeded blocks reroute", () => {
    const session = mockSession({
      activeAgentId: "agent-a",
      handoffCount: 5,
      conversationHistory: [{}, {}, {}, {}, {}],
      lastRouteChangeAt: 0,
    });
    const result = checkPingPong(routing("agent-b"), session, { ...baseConfig, maxHandoffs: 5 });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("max_handoffs_exceeded");
  });

  it("maxHandoffs not exceeded allows reroute", () => {
    const session = mockSession({
      activeAgentId: "agent-a",
      handoffCount: 2,
      conversationHistory: [{}, {}, {}],
      lastRouteChangeAt: 0,
    });
    const result = checkPingPong(routing("agent-b"), session, { ...baseConfig, maxHandoffs: 5 });
    expect(result.blocked).toBe(false);
  });

  it("maxHandoffs defaults to 3", () => {
    const atLimit = mockSession({
      activeAgentId: "agent-a",
      handoffCount: 3,
      conversationHistory: [{}, {}, {}, {}],
      lastRouteChangeAt: 0,
    });
    expect(checkPingPong(routing("agent-b"), atLimit, baseConfig).blocked).toBe(true);

    const belowLimit = mockSession({
      activeAgentId: "agent-a",
      handoffCount: 2,
      conversationHistory: [{}, {}, {}],
      lastRouteChangeAt: 0,
    });
    expect(checkPingPong(routing("agent-b"), belowLimit, baseConfig).blocked).toBe(false);
  });

  it("cooldown active blocks reroute", () => {
    const session = mockSession({
      activeAgentId: "agent-a",
      handoffCount: 0,
      conversationHistory: [{}, {}],
      lastRouteChangeAt: 2,
    });
    const result = checkPingPong(routing("agent-b"), session, { ...baseConfig, rerouteAfterTurns: 3 });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("cooldown_active");
  });

  it("cooldown expired allows reroute", () => {
    const session = mockSession({
      activeAgentId: "agent-a",
      handoffCount: 0,
      conversationHistory: [{}, {}, {}, {}, {}],
      lastRouteChangeAt: 1,
    });
    const result = checkPingPong(routing("agent-b"), session, { ...baseConfig, rerouteAfterTurns: 3 });
    expect(result.blocked).toBe(false);
  });

  it("rerouteAfterTurns defaults to 1", () => {
    const noTurns = mockSession({
      activeAgentId: "agent-a",
      handoffCount: 0,
      conversationHistory: [{}, {}],
      lastRouteChangeAt: 2,
    });
    expect(checkPingPong(routing("agent-b"), noTurns, baseConfig).blocked).toBe(true);

    const oneTurn = mockSession({
      activeAgentId: "agent-a",
      handoffCount: 0,
      conversationHistory: [{}, {}, {}],
      lastRouteChangeAt: 2,
    });
    expect(checkPingPong(routing("agent-b"), oneTurn, baseConfig).blocked).toBe(false);
  });

  it("rerouteAfterTurns=0 disables cooldown", () => {
    const session = mockSession({
      activeAgentId: "agent-a",
      handoffCount: 0,
      conversationHistory: [{}, {}],
      lastRouteChangeAt: 2,
    });
    const result = checkPingPong(routing("agent-b"), session, { ...baseConfig, rerouteAfterTurns: 0 });
    expect(result.blocked).toBe(false);
  });

  it("bidirectional pair A→B→A blocked", () => {
    const session = mockSession({
      activeAgentId: "agent-b",
      handoffCount: 1,
      conversationHistory: [{}, {}, {}, {}],
      lastRouteChangeAt: 1,
      agentTurnHistory: [
        { agentId: "agent-b", turnIndex: 1, fromAgentId: "agent-a" },
      ],
    });
    const result = checkPingPong(routing("agent-a"), session, baseConfig);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("bidirectional_pair");
  });

  it("bidirectional pair does not block A→B→C", () => {
    const session = mockSession({
      activeAgentId: "agent-b",
      handoffCount: 1,
      conversationHistory: [{}, {}, {}, {}],
      lastRouteChangeAt: 1,
      agentTurnHistory: [
        { agentId: "agent-b", turnIndex: 1, fromAgentId: "agent-a" },
      ],
    });
    const result = checkPingPong(routing("agent-c"), session, baseConfig);
    expect(result.blocked).toBe(false);
  });

  it("first routing is never blocked (no history)", () => {
    const session = mockSession({
      activeAgentId: undefined,
      handoffCount: 0,
      conversationHistory: [],
      agentTurnHistory: [],
    });
    const result = checkPingPong(routing("agent-a"), session, baseConfig);
    expect(result.blocked).toBe(false);
  });

  it("session with no activeAgentId is never blocked", () => {
    const session = mockSession({
      activeAgentId: undefined,
      handoffCount: 10,
      conversationHistory: [],
      agentTurnHistory: [],
    });
    const result = checkPingPong(routing("agent-x"), session, baseConfig);
    expect(result.blocked).toBe(false);
  });
});
