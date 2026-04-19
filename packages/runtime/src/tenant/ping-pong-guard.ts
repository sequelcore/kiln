// Ping-pong guard: prevents rapid agent switching loops in multi-agent routing.
// Pure stateless function -- no external deps.

import type { TenantRoutingConfig } from "@kilnai/core";
import type { RuntimeSession } from "../session/runtime-session.js";
import type { RoutingResult } from "./tenant-router.js";

export interface PingPongCheckResult {
  readonly blocked: boolean;
  readonly reason?: string;
}

export function checkPingPong(
  routingResult: RoutingResult,
  session: RuntimeSession,
  config: TenantRoutingConfig,
): PingPongCheckResult {
  // Same agent -- not a reroute
  if (routingResult.agentId === session.activeAgentId) {
    return { blocked: false };
  }

  // No active agent yet -- first routing, never block
  if (!session.activeAgentId) {
    return { blocked: false };
  }

  // Max handoffs exceeded
  if (session.handoffCount >= (config.maxHandoffs ?? 3)) {
    return { blocked: true, reason: "max_handoffs_exceeded" };
  }

  // Cooldown: not enough turns since last route change
  const turnsSinceLastChange = session.conversationHistory.length - session.lastRouteChangeAt;
  if (turnsSinceLastChange < (config.rerouteAfterTurns ?? 1)) {
    return { blocked: true, reason: "cooldown_active" };
  }

  // Bidirectional pair: A→B→A blocked
  const lastEntry = session.agentTurnHistory.length > 0
    ? session.agentTurnHistory[session.agentTurnHistory.length - 1]
    : undefined;
  if (lastEntry?.fromAgentId && lastEntry.fromAgentId === routingResult.agentId) {
    return { blocked: true, reason: "bidirectional_pair" };
  }

  return { blocked: false };
}
