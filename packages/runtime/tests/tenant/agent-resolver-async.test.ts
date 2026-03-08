import { describe, it, expect, vi } from "vitest";
import type { TenantConfig } from "@kilnai/core";
import { textParts } from "@kilnai/core";
import { resolveAgentContextAsync } from "../../src/tenant/agent-resolver.js";
import { ModeBSession } from "../../src/session/mode-b-session.js";
import type { AgentHandoffSummarizer } from "../../src/session/agent-handoff-summarizer.js";

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

function makeSession(activeAgentId?: string): ModeBSession {
  const session = new ModeBSession({ appName: "test-app", userId: "user-1", systemPrompt: "base" });
  if (activeAgentId) {
    session.setActiveAgent(activeAgentId);
    // Add some history turns for the guard to check
    session.addUserMessage(textParts("hello"));
    session.addAssistantMessage(textParts("hi"));
  }
  return session;
}

const mockEventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };

function makeSummarizer(result = "[Handoff from Agent A]: Customer needs help with billing"): AgentHandoffSummarizer {
  return {
    summarize: vi.fn().mockResolvedValue(result),
  };
}

describe("resolveAgentContextAsync", () => {
  it("no agent change -- does not call summarizer", async () => {
    const tenant = makeTenant();
    // Session already on agent-b, message routes to fallback (agent-b) -- no change
    const session = makeSession("agent-b");
    const summarizer = makeSummarizer();

    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { handoffSummarizer: summarizer, eventBus: mockEventBus },
    );

    expect(result.isHandoff).toBe(false);
    expect(summarizer.summarize).not.toHaveBeenCalled();
  });

  it("agent change -- calls summarizer with correct from/to names", async () => {
    const tenant = makeTenant();
    // Session on agent-a, message routes to fallback agent-b
    const session = makeSession("agent-a");
    const summarizer = makeSummarizer();

    await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { handoffSummarizer: summarizer, eventBus: mockEventBus },
    );

    expect(summarizer.summarize).toHaveBeenCalledOnce();
    expect(summarizer.summarize).toHaveBeenCalledWith(session, "Agent A", "Agent B");
  });

  it("agent change -- appends brief to system prompt", async () => {
    const tenant = makeTenant();
    const session = makeSession("agent-a");
    const brief = "[Handoff from Agent A]: Customer wants billing help";
    const summarizer = makeSummarizer(brief);

    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { handoffSummarizer: summarizer, eventBus: mockEventBus },
    );

    expect(result.isHandoff).toBe(true);
    expect(result.systemPrompt).toContain(brief);
    expect(result.handoffBrief).toBe(brief);
    // The brief is appended after the base system prompt
    expect(result.systemPrompt).toMatch(/Agent B.*\n\n\[Handoff from Agent A\]/s);
  });

  it("ping-pong blocked -- does not call summarizer", async () => {
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

    const summarizer = makeSummarizer();

    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { handoffSummarizer: summarizer, eventBus: mockEventBus },
    );

    expect(result.pingPongBlocked).toBe(true);
    expect(summarizer.summarize).not.toHaveBeenCalled();
  });

  it("summarizer failure -- fail-open, returns original prompt without brief", async () => {
    const tenant = makeTenant();
    const session = makeSession("agent-a");
    const summarizer: AgentHandoffSummarizer = {
      summarize: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    };

    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { handoffSummarizer: summarizer, eventBus: mockEventBus },
    );

    expect(result.isHandoff).toBe(true);
    expect(result.handoffBrief).toBeUndefined();
    // Prompt should not contain any handoff brief
    expect(result.systemPrompt).not.toContain("[Handoff from");
  });

  it("no summarizer provided -- skips brief generation", async () => {
    const tenant = makeTenant();
    const session = makeSession("agent-a");

    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { eventBus: mockEventBus },
    );

    expect(result.isHandoff).toBe(true);
    expect(result.handoffBrief).toBeUndefined();
  });

  it("no agents configured -- passthrough", async () => {
    const tenant = makeTenant({ agents: undefined, routing: undefined });
    const session = makeSession();
    const summarizer = makeSummarizer();

    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello"),
      session,
      { handoffSummarizer: summarizer },
    );

    expect(result.isHandoff).toBe(false);
    expect(result.activeAgentId).toBeUndefined();
    expect(summarizer.summarize).not.toHaveBeenCalled();
  });

  it("single agent -- passthrough without handoff", async () => {
    const tenant = makeTenant({
      agents: [{ id: "solo", name: "Solo Agent", role: "General", goal: "Assist" }],
      routing: undefined,
    });
    const session = makeSession();
    const summarizer = makeSummarizer();

    const result = await resolveAgentContextAsync(
      tenant,
      textParts("hello"),
      session,
      { handoffSummarizer: summarizer },
    );

    expect(result.isHandoff).toBe(false);
    expect(result.activeAgentId).toBe("solo");
    expect(result.activeAgentName).toBe("Solo Agent");
    expect(summarizer.summarize).not.toHaveBeenCalled();
  });

  it("handoff_requested event emitted on agent change", async () => {
    const tenant = makeTenant();
    const session = makeSession("agent-a");
    const eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    const summarizer = makeSummarizer();

    await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { handoffSummarizer: summarizer, eventBus },
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
    const summarizer = makeSummarizer();

    await resolveAgentContextAsync(
      tenant,
      textParts("hello there"),
      session,
      { handoffSummarizer: summarizer, eventBus },
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

  describe("Tier 2 embedding routing", () => {
    function makeAgentRag(result?: { agentId: string; score: number }) {
      return {
        selectAgent: vi.fn().mockResolvedValue(result ?? undefined),
        ingestAgents: vi.fn().mockResolvedValue(undefined),
      };
    }

    it("agentRag provided - embedding tier used when regex misses", async () => {
      const tenant = makeTenant();
      const session = makeSession();
      const agentRag = makeAgentRag({ agentId: "agent-a", score: 0.92 });

      const result = await resolveAgentContextAsync(
        tenant,
        textParts("I need assistance with my account"),
        session,
        { agentRag: agentRag as never, eventBus: mockEventBus },
      );

      // Regex rules don't match "I need assistance with my account", so embedding tier kicks in
      expect(agentRag.selectAgent).toHaveBeenCalledOnce();
      expect(result.routingResult?.tier).toBe("embedding");
      expect(result.activeAgentId).toBe("agent-a");
    });

    it("agentRag provided - regex tier still preferred when regex matches", async () => {
      const tenant = makeTenant();
      const session = makeSession();
      const agentRag = makeAgentRag({ agentId: "agent-b", score: 0.99 });

      const result = await resolveAgentContextAsync(
        tenant,
        textParts("I want to buy something"),
        session,
        { agentRag: agentRag as never, eventBus: mockEventBus },
      );

      // "buy" matches the regex rule for agent-a, so regex tier is preferred
      expect(agentRag.selectAgent).not.toHaveBeenCalled();
      expect(result.routingResult?.tier).toBe("rule");
      expect(result.activeAgentId).toBe("agent-a");
    });

    it("agentRag not provided - regex + fallback only", async () => {
      const tenant = makeTenant();
      const session = makeSession();

      const result = await resolveAgentContextAsync(
        tenant,
        textParts("I need assistance with my account"),
        session,
        { eventBus: mockEventBus },
      );

      // No agentRag → sync path, regex misses → fallback
      expect(result.routingResult?.tier).toBe("fallback");
      expect(result.activeAgentId).toBe("agent-b");
    });

    it("agentRag failure - fail-open to fallback", async () => {
      const tenant = makeTenant();
      const session = makeSession();
      const agentRag = {
        selectAgent: vi.fn().mockRejectedValue(new Error("Embedding service unavailable")),
        ingestAgents: vi.fn().mockResolvedValue(undefined),
      };

      const result = await resolveAgentContextAsync(
        tenant,
        textParts("I need assistance with my account"),
        session,
        { agentRag: agentRag as never, eventBus: mockEventBus },
      );

      // agentRag throws → fail-open to regex fallback
      expect(agentRag.selectAgent).toHaveBeenCalledOnce();
      expect(result.routingResult?.tier).toBe("fallback");
      expect(result.activeAgentId).toBe("agent-b");
    });

    it("embedding result triggers handoff when different agent", async () => {
      const tenant = makeTenant();
      // Session currently on agent-b, embedding routes to agent-a
      const session = makeSession("agent-b");
      const agentRag = makeAgentRag({ agentId: "agent-a", score: 0.88 });

      const result = await resolveAgentContextAsync(
        tenant,
        textParts("I need assistance with my account"),
        session,
        { agentRag: agentRag as never, eventBus: mockEventBus },
      );

      expect(result.isHandoff).toBe(true);
      expect(result.previousAgentId).toBe("agent-b");
      expect(result.activeAgentId).toBe("agent-a");
      expect(result.routingResult?.tier).toBe("embedding");
    });

    it("embedding confidence propagated to ResolvedAgentContext", async () => {
      const tenant = makeTenant();
      const session = makeSession();
      const agentRag = makeAgentRag({ agentId: "agent-a", score: 0.85 });

      const result = await resolveAgentContextAsync(
        tenant,
        textParts("I need assistance with my account"),
        session,
        { agentRag: agentRag as never, eventBus: mockEventBus },
      );

      expect(result.routingResult?.tier).toBe("embedding");
      expect(result.routingResult?.confidence).toBe(0.85);
    });
  });
});
