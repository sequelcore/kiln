import { describe, it, expect } from "vitest";
import { textParts } from "@kilnai/core";
import { ModeBSession } from "../../src/session/mode-b-session.js";
import { serializeSession, deserializeSession } from "../../src/session/session-serializer.js";

function makeSession(): ModeBSession {
  return new ModeBSession({
    appName: "test",
    userId: "user1",
    systemPrompt: "Hello",
  });
}

describe("ModeBSession agent fields", () => {
  describe("initial state", () => {
    it("activeAgentId starts undefined", () => {
      const session = makeSession();
      expect(session.activeAgentId).toBeUndefined();
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
      expect(session.agentTurnHistory[0]).toEqual({ agentId: "support-agent", turnIndex: 0 });
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

      expect(session.agentTurnHistory[0]).toEqual({ agentId: "agent-a", turnIndex: 2 });
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
      expect(restored.agentTurnHistory[0]).toEqual({ agentId: "sales-agent", turnIndex: 1 });
      expect(restored.agentTurnHistory[1]).toEqual({ agentId: "billing-agent", turnIndex: 2 });
    });

    it("backward compat: deserialize session JSON without agent fields", () => {
      const session = makeSession();
      session.addUserMessage(textParts("hi"));

      const json = serializeSession(session);
      const parsed = JSON.parse(json);

      // Remove agent fields to simulate old serialized data
      delete parsed.activeAgentId;
      delete parsed.agentTurnHistory;

      const restored = deserializeSession(JSON.stringify(parsed));

      expect(restored.activeAgentId).toBeUndefined();
      expect(restored.agentTurnHistory).toEqual([]);
    });

    it("fromSerialized restores activeAgentId correctly", () => {
      const session = makeSession();
      session.setActiveAgent("support-agent");
      session.addUserMessage(textParts("help"));

      const json = serializeSession(session);
      const data = JSON.parse(json);
      const restored = ModeBSession.fromSerialized(data);

      expect(restored.activeAgentId).toBe("support-agent");
    });
  });
});
