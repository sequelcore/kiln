import { describe, it, expect, vi } from "vitest";
import { type TenantConfig, textParts } from "@kilnai/core/engine";
import { resolveAgentContextAsync } from "../../src/tenant/agent-resolver.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

function makeTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "test-tenant",
    appName: "test-app",
    name: "Test",
    enabled: true,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    agents: [
      { id: "agent-a", name: "Agent A", role: "Sales", goal: "Sell" },
      { id: "agent-b", name: "Agent B", role: "Support", goal: "Help" },
    ],
    routing: {
      rules: [{ match: "buy|price", agent: "agent-a" }],
      fallback: "agent-b",
    },
    ...overrides,
  } as TenantConfig;
}

function makeSession(activeAgentId?: string): RuntimeSession {
  const session = new RuntimeSession({ appName: "test-app", tenantId: "test-tenant", userId: "user-1", systemPrompt: "base" });
  if (activeAgentId) {
    session.setActiveAgent(activeAgentId);
    // Add some history turns for the guard to check
    session.addUserMessage(textParts("hello"));
    session.addAssistantMessage(textParts("hi"));
  }
  return session;
}

const mockEventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };

describe("resolveAgentContextAsync", () => {
  it("no agent change -- does not create a handoff brief", async () => {
    const tenant = makeTenant();
    // Session already on agent-b, message routes to fallback (agent-b) -- no change
    const session = makeSession("agent-b");
    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { eventBus: mockEventBus },
    );

    expect(result.isHandoff).toBe(false);
  });

  it("agent change -- creates a local brief with correct from/to names", async () => {
    const tenant = makeTenant();
    // Session on agent-a, message routes to fallback agent-b
    const session = makeSession("agent-a");
    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { eventBus: mockEventBus },
    );

    expect(result.handoffBrief).toContain("[Handoff from Agent A to Agent B]");
  });

  it("agent change -- appends brief to system prompt", async () => {
    const tenant = makeTenant();
    const session = makeSession("agent-a");
    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { eventBus: mockEventBus },
    );

    expect(result.isHandoff).toBe(true);
    expect(result.systemPrompt).toContain("[Handoff from Agent A to Agent B]");
    expect(result.handoffBrief).toContain("user: hello");
    // The brief is appended after the base system prompt
    expect(result.systemPrompt).toMatch(/Agent B.*\n\n\[Handoff from Agent A to Agent B\]/s);
  });

  it("ping-pong blocked -- does not create a handoff brief", async () => {
    const tenant = makeTenant({
      routing: {
        rules: [{ match: "buy|price", agent: "agent-a" }],
        fallback: "agent-b",
        rerouteAfterTurns: 10, // high cooldown to trigger block
      },
    } as Partial<TenantConfig>);
    // Session on agent-a with very recent handoff
    const session = makeSession("agent-a");
    // The session just switched so cooldown is active (only 2 turns in history, need 10)

    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { eventBus: mockEventBus },
    );

    expect(result.pingPongBlocked).toBe(true);
  });

  it("local handoff summary is independent of provider failures", async () => {
    const tenant = makeTenant();
    const session = makeSession("agent-a");
    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { eventBus: mockEventBus },
    );

    expect(result.isHandoff).toBe(true);
    expect(result.handoffBrief).toContain("[Handoff from Agent A to Agent B]");
  });

  it("always creates a deterministic brief on handoff", async () => {
    const tenant = makeTenant();
    const session = makeSession("agent-a");

    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { eventBus: mockEventBus },
    );

    expect(result.isHandoff).toBe(true);
    expect(result.handoffBrief).toContain("[Handoff from Agent A to Agent B]");
  });

  it("no agents configured -- passthrough", async () => {
    const tenant = makeTenant({ agents: undefined, routing: undefined });
    const session = makeSession();
    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello"),
      session,
      {},
    );

    expect(result.isHandoff).toBe(false);
    expect(result.activeAgentId).toBeUndefined();
  });

  it("single agent -- passthrough without handoff", async () => {
    const tenant = makeTenant({
      agents: [{ id: "solo", name: "Solo Agent", role: "General", goal: "Assist" }],
      routing: undefined,
    });
    const session = makeSession();
    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello"),
      session,
      {},
    );

    expect(result.isHandoff).toBe(false);
    expect(result.activeAgentId).toBe("solo");
    expect(result.activeAgentName).toBe("Solo Agent");
  });

  it("handoff_requested event emitted on agent change", async () => {
    const tenant = makeTenant();
    const session = makeSession("agent-a");
    const eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { eventBus },
    );

    const requestedCall = eventBus.emit.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "handoff_requested",
    );
    expect(requestedCall).toBeDefined();
    const event = requestedCall![0] as { type: string; fromAgent: string; toAgent: string; sessionId: string };
    expect(event.fromAgent).toBe("Agent A");
    expect(event.toAgent).toBe("Agent B");
    expect(event.sessionId).toBe(session.id);
  });

  it("handoff_completed event emitted on agent change", async () => {
    const tenant = makeTenant();
    const session = makeSession("agent-a");
    const eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { eventBus },
    );

    const completedCall = eventBus.emit.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "handoff_completed",
    );
    expect(completedCall).toBeDefined();
    const event = completedCall![0] as { type: string; fromAgent: string; toAgent: string; accepted: boolean; sessionId: string };
    expect(event.fromAgent).toBe("Agent A");
    expect(event.toAgent).toBe("Agent B");
    expect(event.accepted).toBe(true);
    expect(event.sessionId).toBe(session.id);
  });

});
