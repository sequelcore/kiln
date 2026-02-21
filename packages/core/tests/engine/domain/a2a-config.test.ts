import { describe, it, expect } from "vitest";
import { validateAgentCard, type AgentCard } from "../../../src/engine/domain/a2a-config.js";

describe("validateAgentCard", () => {
  it("returns empty array for valid card", () => {
    const card: AgentCard = {
      name: "test-agent",
      description: "A test agent",
      url: "https://example.com/agent",
      version: "1.0.0",
      capabilities: [
        { name: "search", description: "Search the web" },
      ],
    };
    expect(validateAgentCard(card)).toEqual([]);
  });

  it("errors on missing name", () => {
    const card = {
      name: "",
      description: "A test agent",
      url: "https://example.com/agent",
      version: "1.0.0",
      capabilities: [],
    } as AgentCard;
    const errors = validateAgentCard(card);
    expect(errors).toContainEqual({ field: "name", message: "must be a non-empty string" });
  });

  it("errors on missing description", () => {
    const card = {
      name: "test-agent",
      description: "",
      url: "https://example.com/agent",
      version: "1.0.0",
      capabilities: [],
    } as AgentCard;
    const errors = validateAgentCard(card);
    expect(errors).toContainEqual({ field: "description", message: "must be a non-empty string" });
  });

  it("errors on missing url", () => {
    const card = {
      name: "test-agent",
      description: "A test agent",
      url: "",
      version: "1.0.0",
      capabilities: [],
    } as AgentCard;
    const errors = validateAgentCard(card);
    expect(errors).toContainEqual({ field: "url", message: "must be a non-empty string" });
  });

  it("errors on missing version", () => {
    const card = {
      name: "test-agent",
      description: "A test agent",
      url: "https://example.com/agent",
      version: "",
      capabilities: [],
    } as AgentCard;
    const errors = validateAgentCard(card);
    expect(errors).toContainEqual({ field: "version", message: "must be a non-empty string" });
  });

  it("errors on missing capabilities array", () => {
    const card = {
      name: "test-agent",
      description: "A test agent",
      url: "https://example.com/agent",
      version: "1.0.0",
    } as AgentCard;
    const errors = validateAgentCard(card);
    expect(errors).toContainEqual({ field: "capabilities", message: "must be an array" });
  });

  it("errors on invalid capability entry missing name", () => {
    const card: AgentCard = {
      name: "test-agent",
      description: "A test agent",
      url: "https://example.com/agent",
      version: "1.0.0",
      capabilities: [
        { name: "", description: "Search" },
      ],
    };
    const errors = validateAgentCard(card);
    expect(errors).toContainEqual({ field: "capabilities[0].name", message: "must be a non-empty string" });
  });

  it("errors on invalid capability entry missing description", () => {
    const card: AgentCard = {
      name: "test-agent",
      description: "A test agent",
      url: "https://example.com/agent",
      version: "1.0.0",
      capabilities: [
        { name: "search", description: "" },
      ],
    };
    const errors = validateAgentCard(card);
    expect(errors).toContainEqual({ field: "capabilities[0].description", message: "must be a non-empty string" });
  });

  it("valid card with authentication passes", () => {
    const card: AgentCard = {
      name: "test-agent",
      description: "A test agent",
      url: "https://example.com/agent",
      version: "1.0.0",
      capabilities: [],
      authentication: {
        schemes: ["bearer"],
        credentials: "API_KEY",
      },
    };
    expect(validateAgentCard(card)).toEqual([]);
  });

  it("valid card with input/output modes passes", () => {
    const card: AgentCard = {
      name: "test-agent",
      description: "A test agent",
      url: "https://example.com/agent",
      version: "1.0.0",
      capabilities: [],
      inputModes: ["text", "image"],
      outputModes: ["text"],
    };
    expect(validateAgentCard(card)).toEqual([]);
  });
});
