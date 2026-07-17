import { describe, it, expect } from "vitest";
import { textParts } from "@kilnai/core";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { serializeSession, deserializeSession } from "../../src/session/persistence/session-serializer.js";

function makeSession(): RuntimeSession {
  return new RuntimeSession({
    appName: "test",
    tenantId: "test-tenant",
    userId: "user1",
    systemPrompt: "Hello",
  });
}

describe("RuntimeSession agent fields", () => {
  describe("initial state", () => {
    it("activeAgentId starts null", () => {
      const session = makeSession();
      expect(session.activeAgentId).toBeNull();
    });

    it("agentTurnHistory starts empty", () => {
      const session = makeSession();
      expect(session.agentTurnHistory).toEqual([]);
    });
  });

  describe("setActiveAgent", () => {
    it("updates activeAgentId getter", () => {
      const session = makeSession();
      session.setActiveAgent("sales-agent");
      expect(session.activeAgentId).toBe("sales-agent");
    });

    it("pushes to agentTurnHistory with correct turnIndex (= history.length)", () => {
      const session = makeSession();
      session.setActiveAgent("support-agent");
      expect(session.agentTurnHistory).toHaveLength(1);
      expect(session.agentTurnHistory[0]).toEqual({ agentId: "support-agent", turnIndex: 0, fromAgentId: undefined });
    });

    it("multiple calls accumulate in agentTurnHistory", () => {
      const session = makeSession();
      session.setActiveAgent("sales-agent");
      session.setActiveAgent("billing-agent");
      session.setActiveAgent("support-agent");

      expect(session.agentTurnHistory).toHaveLength(3);
      expect(session.agentTurnHistory[0]!.agentId).toBe("sales-agent");
      expect(session.agentTurnHistory[1]!.agentId).toBe("billing-agent");
      expect(session.agentTurnHistory[2]!.agentId).toBe("support-agent");
    });

    it("increments version", () => {
      const session = makeSession();
      const vBefore = session.version;
      session.setActiveAgent("agent-x");
      expect(session.version).toBe(vBefore + 1);
    });

    it("after addUserMessage has correct turnIndex", () => {
      const session = makeSession();
      session.addUserMessage(textParts("hi"));
      session.addAssistantMessage(textParts("hello"));
      session.setActiveAgent("agent-a");

      expect(session.agentTurnHistory[0]).toEqual({ agentId: "agent-a", turnIndex: 2, fromAgentId: undefined });
    });

    it("same agentId is a no-op (version unchanged)", () => {
      const session = makeSession();
      session.setActiveAgent("agent-x");
      const vBefore = session.version;
      session.setActiveAgent("agent-x");
      expect(session.version).toBe(vBefore);
      expect(session.agentTurnHistory).toHaveLength(1);
    });

    it("no-op does not push to agentTurnHistory", () => {
      const session = makeSession();
      session.setActiveAgent("agent-x");
      session.setActiveAgent("agent-x");
      session.setActiveAgent("agent-x");
      expect(session.agentTurnHistory).toHaveLength(1);
    });

    it("different agentId increments handoffCount", () => {
      const session = makeSession();
      expect(session.handoffCount).toBe(0);
      session.setActiveAgent("agent-a");
      expect(session.handoffCount).toBe(1);
      session.setActiveAgent("agent-b");
      expect(session.handoffCount).toBe(2);
    });

    it("handoffBrief stored in turn entry", () => {
      const session = makeSession();
      session.setActiveAgent("agent-a");
      session.setActiveAgent("agent-b", "Customer needs billing help");
      expect(session.agentTurnHistory[1]!.handoffBrief).toBe("Customer needs billing help");
    });

    it("fromAgentId is undefined for first agent assignment", () => {
      const session = makeSession();
      session.setActiveAgent("agent-a");
      expect(session.agentTurnHistory[0]!.fromAgentId).toBeUndefined();
    });

    it("fromAgentId is previous agent on subsequent calls", () => {
      const session = makeSession();
      session.setActiveAgent("agent-a");
      session.setActiveAgent("agent-b");
      expect(session.agentTurnHistory[1]!.fromAgentId).toBe("agent-a");
    });

    it("lastRouteChangeAt reflects history length at switch time", () => {
      const session = makeSession();
      session.addUserMessage(textParts("hi"));
      session.addAssistantMessage(textParts("hello"));
      session.setActiveAgent("agent-a");
      expect(session.lastRouteChangeAt).toBe(2);
      session.addUserMessage(textParts("more"));
      session.setActiveAgent("agent-b");
      expect(session.lastRouteChangeAt).toBe(3);
    });

    it("handoffCount starts at 0", () => {
      const session = makeSession();
      expect(session.handoffCount).toBe(0);
    });
  });

  describe("setSystemPrompt", () => {
    it("updates the systemPrompt getter", () => {
      const session = makeSession();
      session.setSystemPrompt("New prompt");
      expect(session.systemPrompt).toBe("New prompt");
    });

    it("increments version", () => {
      const session = makeSession();
      const vBefore = session.version;
      session.setSystemPrompt("Updated");
      expect(session.version).toBe(vBefore + 1);
    });
  });

  describe("serialization", () => {
    it("serializeSession includes activeAgentId and agentTurnHistory", () => {
      const session = makeSession();
      session.setActiveAgent("sales-agent");

      const json = serializeSession(session);
      const parsed = JSON.parse(json);

      expect(parsed.activeAgentId).toBe("sales-agent");
      expect(parsed.agentTurnHistory).toEqual([{ agentId: "sales-agent", turnIndex: 0 }]);
    });

    it("round-trip preserves handoffCount", () => {
      const session = makeSession();
      session.setActiveAgent("agent-a");
      session.setActiveAgent("agent-b");

      const json = serializeSession(session);
      const restored = deserializeSession(json);

      expect(restored.handoffCount).toBe(2);
    });

    it("round-trip preserves lastRouteChangeAt", () => {
      const session = makeSession();
      session.addUserMessage(textParts("hello"));
      session.setActiveAgent("agent-a");

      const json = serializeSession(session);
      const restored = deserializeSession(json);

      expect(restored.lastRouteChangeAt).toBe(1);
    });

    it("round-trip preserves handoffBrief in turn entry", () => {
      const session = makeSession();
      session.setActiveAgent("agent-a");
      session.setActiveAgent("agent-b", "Customer wants refund");

      const json = serializeSession(session);
      const restored = deserializeSession(json);

      expect(restored.agentTurnHistory[1]!.handoffBrief).toBe("Customer wants refund");
    });

    it("round-trip preserves fromAgentId in turn entry", () => {
      const session = makeSession();
      session.setActiveAgent("agent-a");
      session.setActiveAgent("agent-b");

      const json = serializeSession(session);
      const restored = deserializeSession(json);

      expect(restored.agentTurnHistory[1]!.fromAgentId).toBe("agent-a");
    });

    it("round-trip preserves activeAgentId", () => {
      const session = makeSession();
      session.setActiveAgent("billing-agent");

      const json = serializeSession(session);
      const restored = deserializeSession(json);

      expect(restored.activeAgentId).toBe("billing-agent");
    });

    it("round-trip preserves agentTurnHistory", () => {
      const session = makeSession();
      session.addUserMessage(textParts("hello"));
      session.setActiveAgent("sales-agent");
      session.addUserMessage(textParts("pricing?"));
      session.setActiveAgent("billing-agent");

      const json = serializeSession(session);
      const restored = deserializeSession(json);

      expect(restored.agentTurnHistory).toHaveLength(2);
      expect(restored.agentTurnHistory[0]).toEqual({ agentId: "sales-agent", turnIndex: 1, fromAgentId: undefined });
      expect(restored.agentTurnHistory[1]).toEqual({ agentId: "billing-agent", turnIndex: 2, fromAgentId: "sales-agent" });
    });

    it("fromSerialized restores activeAgentId correctly", () => {
      const session = makeSession();
      session.setActiveAgent("support-agent");
      session.addUserMessage(textParts("help"));

      const json = serializeSession(session);
      const data = JSON.parse(json);
      const restored = RuntimeSession.fromSerialized(data);

      expect(restored.activeAgentId).toBe("support-agent");
    });
  });
});
