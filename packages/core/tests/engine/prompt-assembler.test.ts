import { describe, it, expect } from "vitest";
import { assembleAgentPrompt } from "../../src/engine/domain/prompt-assembler.js";
import type { Agent } from "../../src/engine/domain/agent.js";
import type { PromptContext } from "../../src/engine/domain/prompt-assembler.js";

describe("assembleAgentPrompt", () => {
  function makeAgent(overrides: Partial<Agent> = {}): Agent {
    return {
      name: "Aria",
      role: "Senior Architect",
      goal: "Design robust, maintainable solutions",
      tier: "reasoning",
      tools: [],
      ...overrides,
    };
  }

  describe("identity section (always present)", () => {
    it("includes identity line for minimal agent", () => {
      const agent = makeAgent();
      const prompt = assembleAgentPrompt(agent);
      expect(prompt).toContain("You are Aria, Senior Architect.");
      expect(prompt).toContain("Your goal: Design robust, maintainable solutions");
    });

    it("formats identity correctly with different values", () => {
      const agent = makeAgent({
        name: "Marcus",
        role: "Implementation Specialist",
        goal: "Write clean code",
      });
      const prompt = assembleAgentPrompt(agent);
      expect(prompt).toContain("You are Marcus, Implementation Specialist.");
      expect(prompt).toContain("Your goal: Write clean code");
    });

    it("does not use article before role", () => {
      const agent = makeAgent({ role: "Implementation Specialist" });
      const prompt = assembleAgentPrompt(agent);
      expect(prompt).not.toContain(", a Implementation Specialist");
      expect(prompt).not.toContain(", an Implementation Specialist");
    });
  });

  describe("backstory section (optional)", () => {
    it("includes backstory when provided", () => {
      const agent = makeAgent({
        backstory: "Pragmatic architect who values simplicity over cleverness.",
      });
      const prompt = assembleAgentPrompt(agent);
      expect(prompt).toContain("Pragmatic architect who values simplicity over cleverness.");
    });

    it("omits backstory when not provided", () => {
      const agent = makeAgent();
      const prompt = assembleAgentPrompt(agent);
      expect(prompt).not.toContain("backstory");
    });

    it("omits backstory section when backstory is empty string", () => {
      const agent = makeAgent({ backstory: "" });
      const prompt = assembleAgentPrompt(agent);
      // Only identity section should be present -- no empty section after it
      const sections = prompt.split("\n\n");
      expect(sections).toHaveLength(1);
      expect(sections[0]).toContain("You are Aria");
    });

    it("omits backstory section when backstory is whitespace-only", () => {
      const agent = makeAgent({ backstory: "   " });
      const prompt = assembleAgentPrompt(agent);
      const sections = prompt.split("\n\n");
      expect(sections).toHaveLength(1);
    });

    it("places backstory after identity", () => {
      const agent = makeAgent({
        backstory: "Experienced professional.",
      });
      const prompt = assembleAgentPrompt(agent);
      const lines = prompt.split("\n\n");
      expect(lines[0]).toContain("You are Aria");
      expect(lines[1]).toBe("Experienced professional.");
    });
  });

  describe("instructions section (optional)", () => {
    it("includes instructions when provided", () => {
      const agent = makeAgent({
        instructions: "Always write tests before implementation.",
      });
      const prompt = assembleAgentPrompt(agent);
      expect(prompt).toContain("## Operating Rules");
      expect(prompt).toContain("Always write tests before implementation.");
    });

    it("omits instructions when not provided", () => {
      const agent = makeAgent();
      const prompt = assembleAgentPrompt(agent);
      expect(prompt).not.toContain("Operating Rules");
    });

    it("places instructions after backstory", () => {
      const agent = makeAgent({
        backstory: "Professional background.",
        instructions: "Work carefully.",
      });
      const prompt = assembleAgentPrompt(agent);
      const sections = prompt.split("\n\n");
      expect(sections[0]).toContain("You are Aria");
      expect(sections[1]).toBe("Professional background.");
      expect(sections[2]).toContain("## Operating Rules");
      expect(sections[2]).toContain("Work carefully.");
    });
  });

  describe("team context section (when context provided)", () => {
    it("includes team name and mode when provided", () => {
      const agent = makeAgent();
      const context: PromptContext = { teamName: "Alpha Squad", teamMode: "supervisor" };
      const prompt = assembleAgentPrompt(agent, context);
      expect(prompt).toContain("You are part of team 'Alpha Squad' in supervisor mode.");
    });

    it("defaults to sequential mode when teamMode not provided", () => {
      const agent = makeAgent();
      const context: PromptContext = { teamName: "Dev Team" };
      const prompt = assembleAgentPrompt(agent, context);
      expect(prompt).toContain("You are part of team 'Dev Team' in sequential mode.");
    });

    it("includes teammates when provided", () => {
      const agent = makeAgent();
      const context: PromptContext = {
        teamName: "Dev Team",
        teammates: [
          { name: "Marcus", role: "Implementer" },
          { name: "Zoe", role: "Optimizer" },
        ],
      };
      const prompt = assembleAgentPrompt(agent, context);
      expect(prompt).toContain("Teammates: Marcus (Implementer), Zoe (Optimizer)");
    });

    it("omits team context when no context provided", () => {
      const agent = makeAgent();
      const prompt = assembleAgentPrompt(agent);
      expect(prompt).not.toContain("You are part of team");
    });

    it("omits team context when context has no team data", () => {
      const agent = makeAgent();
      const context: PromptContext = {};
      const prompt = assembleAgentPrompt(agent, context);
      expect(prompt).not.toContain("You are part of team");
    });

    it("places team context after instructions", () => {
      const agent = makeAgent({
        backstory: "Background.",
        instructions: "Rules.",
      });
      const context: PromptContext = {
        teamName: "Team",
        teammates: [{ name: "Bob", role: "Helper" }],
      };
      const prompt = assembleAgentPrompt(agent, context);
      const sections = prompt.split("\n\n");
      expect(sections[0]).toContain("You are Aria");
      expect(sections[1]).toBe("Background.");
      expect(sections[2]).toContain("Operating Rules");
      expect(sections[3]).toContain("You are part of team 'Team'");
    });
  });

  describe("capabilities section (when provided)", () => {
    it("includes capabilities with name and description", () => {
      const agent = makeAgent();
      const context: PromptContext = {
        capabilities: [
          { name: "code_edit", description: "Edit code files" },
          { name: "memory_save", description: "Save to memory" },
        ],
      };
      const prompt = assembleAgentPrompt(agent, context);
      expect(prompt).toContain("## Available Tools");
      expect(prompt).toContain("- code_edit: Edit code files");
      expect(prompt).toContain("- memory_save: Save to memory");
    });

    it("omits capabilities section when no capabilities provided", () => {
      const agent = makeAgent();
      const prompt = assembleAgentPrompt(agent, {});
      expect(prompt).not.toContain("Available Tools");
    });

    it("places capabilities after team context", () => {
      const agent = makeAgent();
      const context: PromptContext = {
        teamName: "Team",
        capabilities: [{ name: "tool", description: "A tool" }],
      };
      const prompt = assembleAgentPrompt(agent, context);
      const sections = prompt.split("\n\n");
      expect(sections[0]).toContain("You are Aria");
      expect(sections[1]).toContain("You are part of team 'Team'");
      expect(sections[2]).toContain("## Available Tools");
    });
  });

  describe("quality gates section (when provided)", () => {
    it("includes quality gates with name and description", () => {
      const agent = makeAgent();
      const context: PromptContext = {
        qualityGates: [
          { name: "test", description: "Run tests" },
          { name: "lint", description: "Check formatting" },
        ],
      };
      const prompt = assembleAgentPrompt(agent, context);
      expect(prompt).toContain("## Quality Standards");
      expect(prompt).toContain("- test: Run tests");
      expect(prompt).toContain("- lint: Check formatting");
    });

    it("omits quality gates section when no gates provided", () => {
      const agent = makeAgent();
      const prompt = assembleAgentPrompt(agent, {});
      expect(prompt).not.toContain("Quality Standards");
    });

    it("places quality gates after capabilities", () => {
      const agent = makeAgent();
      const context: PromptContext = {
        capabilities: [{ name: "tool", description: "A tool" }],
        qualityGates: [{ name: "gate", description: "A gate" }],
      };
      const prompt = assembleAgentPrompt(agent, context);
      const sections = prompt.split("\n\n");
      expect(sections[0]).toContain("You are Aria");
      expect(sections[1]).toContain("## Available Tools");
      expect(sections[2]).toContain("## Quality Standards");
    });
  });

  describe("full assembly order", () => {
    it("assembles full prompt in correct order", () => {
      const agent = makeAgent({
        backstory: "Professional history.",
        instructions: "Follow best practices.",
      });
      const context: PromptContext = {
        teamName: "Engineering",
        teamMode: "supervisor",
        teammates: [{ name: "Bob", role: "Reviewer" }],
        capabilities: [{ name: "edit", description: "Edit files" }],
        qualityGates: [{ name: "tests", description: "Run tests" }],
      };
      const prompt = assembleAgentPrompt(agent, context);
      const sections = prompt.split("\n\n");
      
      expect(sections[0]).toContain("You are Aria, Senior Architect");
      expect(sections[1]).toBe("Professional history.");
      expect(sections[2]).toContain("## Operating Rules");
      expect(sections[3]).toContain("You are part of team 'Engineering' in supervisor mode");
      expect(sections[4]).toContain("## Available Tools");
      expect(sections[5]).toContain("## Quality Standards");
    });
  });

  describe("edge cases", () => {
    it("handles empty arrays in context gracefully", () => {
      const agent = makeAgent();
      const context: PromptContext = {
        teamName: "Team",
        teammates: [],
        capabilities: [],
        qualityGates: [],
      };
      const prompt = assembleAgentPrompt(agent, context);
      expect(prompt).toContain("You are Aria");
      expect(prompt).toContain("You are part of team 'Team'");
      expect(prompt).not.toContain("Teammates:");
      expect(prompt).not.toContain("Available Tools");
      expect(prompt).not.toContain("Quality Standards");
    });

    it("handles agent with all optional fields", () => {
      const agent = makeAgent({
        name: "Dr. Voss",
        role: "Security Reviewer",
        goal: "Find vulnerabilities",
        backstory: "Skeptical reviewer.",
        instructions: "Flag any eval() usage.",
        tier: "reasoning",
        tools: ["verify"],
      });
      const prompt = assembleAgentPrompt(agent);
      expect(prompt).toContain("You are Dr. Voss, Security Reviewer");
      expect(prompt).toContain("Your goal: Find vulnerabilities");
      expect(prompt).toContain("Skeptical reviewer.");
      expect(prompt).toContain("Flag any eval() usage.");
    });
  });
});
