import { describe, it, expect } from "vitest";
import { generateAgentCard } from "../../src/a2a/agent-card-generator.js";
import type { App } from "@kilnai/core";
import type { Team } from "@kilnai/core/engine";

function createMockApp(teams: Record<string, Team>): App {
  return {
    name: "test-app",
    teams,
    router: { rules: [], fallback: "default" },
    memory: { scopes: ["user"], backend: "memory" },
    channels: ["cli"],
  };
}

describe("generateAgentCard", () => {
  it("generates card with app name and capabilities from all teams", () => {
    const teams: Record<string, Team> = {
      team1: {
        name: "team1",
        agents: {},
        workflow: { phases: [], gates: {} },
        capabilities: [
          { name: "search", description: "Search the web", schema: {}, tags: [] },
          { name: "email", description: "Send emails", schema: { type: "object" }, tags: [] },
        ],
        qualityGates: [],
      },
      team2: {
        name: "team2",
        agents: {},
        workflow: { phases: [], gates: {} },
        capabilities: [
          { name: "translate", description: "Translate text", schema: {}, tags: [] },
        ],
        qualityGates: [],
      },
    };
    const app = createMockApp(teams);
    const card = generateAgentCard(app, { baseUrl: "https://example.com/agent" });

    expect(card.name).toBe("test-app");
    expect(card.capabilities).toHaveLength(3);
    expect(card.capabilities.map((c: { name: string }) => c.name)).toContain("search");
    expect(card.capabilities.map((c: { name: string }) => c.name)).toContain("email");
    expect(card.capabilities.map((c: { name: string }) => c.name)).toContain("translate");
  });

  it("uses provided description or defaults", () => {
    const app = createMockApp({ default: { name: "default", agents: {}, workflow: { phases: [], gates: {} }, capabilities: [], qualityGates: [] } });

    const card1 = generateAgentCard(app, { baseUrl: "https://example.com/agent" });
    expect(card1.description).toBe("test-app AI agent");

    const card2 = generateAgentCard(app, { baseUrl: "https://example.com/agent", description: "Custom description" });
    expect(card2.description).toBe("Custom description");
  });

  it("uses provided version or defaults to '1.0.0'", () => {
    const app = createMockApp({ default: { name: "default", agents: {}, workflow: { phases: [], gates: {} }, capabilities: [], qualityGates: [] } });

    const card1 = generateAgentCard(app, { baseUrl: "https://example.com/agent" });
    expect(card1.version).toBe("1.0.0");

    const card2 = generateAgentCard(app, { baseUrl: "https://example.com/agent", version: "2.0.0" });
    expect(card2.version).toBe("2.0.0");
  });

  it("maps capability schemas correctly", () => {
    const teams: Record<string, Team> = {
      team1: {
        name: "team1",
        agents: {},
        workflow: { phases: [], gates: {} },
        capabilities: [
          { name: "search", description: "Search", schema: { type: "object", properties: { query: { type: "string" } } }, tags: [] },
          { name: "email", description: "Email", schema: {}, tags: [], outputSchema: { type: "object", properties: { sent: { type: "boolean" } } } },
        ],
        qualityGates: [],
      },
    };
    const app = createMockApp(teams);
    const card = generateAgentCard(app, { baseUrl: "https://example.com/agent" });

    const searchCap = card.capabilities.find((c: { name: string }) => c.name === "search");
    expect(searchCap?.inputSchema).toEqual({ type: "object", properties: { query: { type: "string" } } });
    expect(searchCap?.outputSchema).toBeUndefined();

    const emailCap = card.capabilities.find((c: { name: string }) => c.name === "email");
    expect(emailCap?.inputSchema).toBeUndefined();
    expect(emailCap?.outputSchema).toEqual({ type: "object", properties: { sent: { type: "boolean" } } });
  });

  it("empty capabilities list when teams have no capabilities", () => {
    const teams: Record<string, Team> = {
      team1: { name: "team1", agents: {}, workflow: { phases: [], gates: {} }, capabilities: [], qualityGates: [] },
    };
    const app = createMockApp(teams);
    const card = generateAgentCard(app, { baseUrl: "https://example.com/agent" });

    expect(card.capabilities).toEqual([]);
  });
});
