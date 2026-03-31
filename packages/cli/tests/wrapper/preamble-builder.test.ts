import { describe, it, expect } from "vitest";
import { buildPreamble } from "../../src/wrapper/preamble-builder.js";
import type { SessionContext } from "../../src/wrapper/index.js";
import type { DomainConfig, Agent } from "@kilnai/core";

const MINIMAL_CONTEXT: SessionContext = {
  mode: "api-key",
  domain: {
    name: "generic",
    displayName: "Generic",
    detectPatterns: [],
    toolTags: new Set(),
    qualityGates: [],
    multishotExamples: "",
    phaseExamples: "",
  },
  systemPrompt: "",
  memorySnapshot: undefined,
  mcpServerEntryPath: "",
  workingDirectory: "/tmp",
  task: "Fix the login bug",
};

const FULL_DOMAIN: DomainConfig = {
  name: "python",
  displayName: "Python",
  detectPatterns: ["*.py"],
  toolTags: new Set(["python", "testing", "linting"]),
  qualityGates: [
    { name: "ruff", command: "ruff check .", description: "Lint check", required: true },
    { name: "pytest", command: "pytest .", description: "Run tests", required: false },
  ],
  multishotExamples: "",
  phaseExamples: "",
};

const FULL_AGENT: Agent = {
  name: "Aria",
  role: "Senior Python Engineer",
  goal: "Write clean, tested, maintainable Python code",
  backstory:
    "You are a senior Python engineer with deep expertise in async programming, testing, and clean architecture.",
  instructions: "Always run lint before committing. Use type hints everywhere.",
  tier: "coding",
  tools: ["bash", "edit"],
};

describe("buildPreamble", () => {
  it("includes all sections when agent and memory are present", () => {
    const ctx: SessionContext = {
      ...MINIMAL_CONTEXT,
      domain: FULL_DOMAIN,
      memorySnapshot: "Remember: use strict mode for new files",
    };
    const result = buildPreamble(ctx, { approval: "auto-approve", sandbox: "full" }, FULL_AGENT);

    expect(result).toContain("<kiln-preamble>");
    expect(result).toContain("<role>");
    expect(result).toContain("You are Aria, Senior Python Engineer. Goal: Write clean, tested, maintainable Python code");
    expect(result).toContain("You are a senior Python engineer");
    expect(result).toContain("<task>Fix the login bug</task>");
    expect(result).toContain("<domain>");
    expect(result).toContain("Project type: Python");
    expect(result).toContain("Tool tags: python, testing, linting");
    expect(result).toContain("Quality gates: ruff, pytest");
    expect(result).toContain("<constraints>");
    expect(result).toContain("Approval mode: auto-approve");
    expect(result).toContain("Sandbox: full");
    expect(result).toContain("<memory>");
    expect(result).toContain("Remember: use strict mode");
    expect(result).toContain("<instructions>");
    expect(result).toContain("Always run lint before committing");
    expect(result).toContain("</kiln-preamble>");
  });

  it("omits <role> when agent is undefined", () => {
    const result = buildPreamble(MINIMAL_CONTEXT, { approval: "ask", sandbox: "none" }, undefined);
    expect(result).not.toContain("<role>");
    expect(result).toContain("<task>Fix the login bug</task>");
    expect(result).toContain("<constraints>");
  });

  it("omits <instructions> when agent.instructions is undefined", () => {
    const agentWithoutInstructions: Agent = {
      name: "Aria",
      role: "Engineer",
      goal: "Assist",
      tier: "fast",
      tools: [],
    };
    const result = buildPreamble(
      MINIMAL_CONTEXT,
      { approval: "ask", sandbox: "none" },
      agentWithoutInstructions,
    );
    expect(result).toContain("<role>");
    expect(result).not.toContain("<instructions>");
  });

  it("omits <memory> when memorySnapshot is undefined", () => {
    const result = buildPreamble(MINIMAL_CONTEXT, { approval: "ask", sandbox: "none" }, undefined);
    expect(result).not.toContain("<memory>");
  });

  it("omits <memory> when memorySnapshot is empty string", () => {
    const ctx: SessionContext = { ...MINIMAL_CONTEXT, memorySnapshot: "  " };
    const result = buildPreamble(ctx, { approval: "ask", sandbox: "none" }, undefined);
    expect(result).not.toContain("<memory>");
  });

  it("truncates memorySnapshot at 200 lines", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 250; i++) {
      lines.push(`Line ${i}: context from prior session`);
    }
    const ctx: SessionContext = { ...MINIMAL_CONTEXT, memorySnapshot: lines.join("\n") };
    const result = buildPreamble(ctx, { approval: "ask", sandbox: "none" }, undefined);

    expect(result).toContain("[memory truncated — 50 lines omitted]");
    expect(result).not.toContain("Line 201");
    expect(result).toContain("Line 200");
  });

  it("does not truncate when memorySnapshot is exactly 200 lines", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 200; i++) {
      lines.push(`Line ${i}`);
    }
    const ctx: SessionContext = { ...MINIMAL_CONTEXT, memorySnapshot: lines.join("\n") };
    const result = buildPreamble(ctx, { approval: "ask", sandbox: "none" }, undefined);

    expect(result).not.toContain("truncated");
    expect(result).toContain("Line 200");
  });

  it("escapes XML special characters in task", () => {
    const ctx: SessionContext = { ...MINIMAL_CONTEXT, task: "Fix <bug> & fix 'error'" };
    const result = buildPreamble(ctx, { approval: "ask", sandbox: "none" }, undefined);
    expect(result).toContain("&lt;bug&gt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&apos;");
  });

  it("escapes XML special characters in memory", () => {
    const ctx: SessionContext = { ...MINIMAL_CONTEXT, memorySnapshot: "Use <b>bold</b> tags & wrap" };
    const result = buildPreamble(ctx, { approval: "ask", sandbox: "none" }, undefined);
    expect(result).toContain("&lt;b&gt;");
    expect(result).toContain("&amp;");
  });

  it("omits domain section when domain has no toolTags and no qualityGates", () => {
    const ctx: SessionContext = {
      ...MINIMAL_CONTEXT,
      domain: { ...MINIMAL_CONTEXT.domain, toolTags: new Set(), qualityGates: [] },
    };
    const result = buildPreamble(ctx, { approval: "ask", sandbox: "none" }, undefined);
    expect(result).not.toContain("<domain>");
  });

  it("always includes <task> even with minimal context", () => {
    const result = buildPreamble(MINIMAL_CONTEXT, { approval: "ask", sandbox: "none" }, undefined);
    expect(result).toMatch(/<task>Fix the login bug<\/task>/);
  });

  it("always includes <constraints> with policy fields", () => {
    const result = buildPreamble(MINIMAL_CONTEXT, { approval: "deny", sandbox: "full" }, undefined);
    expect(result).toContain("<constraints>");
    expect(result).toContain("Approval mode: deny");
    expect(result).toContain("Sandbox: full");
  });

  it("uses safe defaults when agent has minimal fields", () => {
    const minimalAgent: Agent = {
      name: "Bot",
      role: "Assistant",
      goal: "Help",
      tier: "fast",
      tools: [],
    };
    const result = buildPreamble(MINIMAL_CONTEXT, { approval: "ask", sandbox: "none" }, minimalAgent);
    expect(result).toContain("You are Bot, Assistant. Goal: Help");
    expect(result).not.toContain("undefined");
    expect(result).not.toContain("null");
  });
});
