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
  projectedContext: { blocks: [], estimatedTokens: 0 },
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
  it("includes all sections when projectedContext contains memory", () => {
    const ctx: SessionContext = {
      ...MINIMAL_CONTEXT,
      domain: FULL_DOMAIN,
      projectedContext: { 
        blocks: [{ id: "mem1", kind: "memory", source: "test", content: "Remember: use strict mode", required: false, score: 0.6 }],
        estimatedTokens: 10 
      },
    };
    const result = buildPreamble(ctx, { approval: "never", sandbox: "danger-full-access" }, FULL_AGENT);

    expect(result).toContain("<kiln-preamble>");
    expect(result).toContain("<role>");
    expect(result).toContain("You are Aria, Senior Python Engineer");
    expect(result).toContain("<task>Fix the login bug</task>");
    expect(result).toContain("<domain>");
    expect(result).toContain("<constraints>");
    expect(result).toContain("<memory>");
    expect(result).toContain("Remember: use strict mode");
    expect(result).toContain("<instructions>");
    expect(result).toContain("</kiln-preamble>");
  });

  it("omits <role> when agent is undefined", () => {
    const result = buildPreamble(MINIMAL_CONTEXT, { approval: "on-request", sandbox: "read-only" }, undefined);
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
      { approval: "on-request", sandbox: "read-only" },
      agentWithoutInstructions,
    );
    expect(result).toContain("<role>");
    expect(result).not.toContain("<instructions>");
  });

  it("omits <memory> when projectedContext has no memory blocks", () => {
    const result = buildPreamble(MINIMAL_CONTEXT, { approval: "on-request", sandbox: "read-only" }, undefined);
    expect(result).not.toContain("<memory>");
  });

  it("omits <memory> when projectedContext block content is empty", () => {
    const ctx: SessionContext = {
      ...MINIMAL_CONTEXT,
      projectedContext: { blocks: [{ id: "x", kind: "memory", source: "test", content: "  ", required: false, score: 0.5 }], estimatedTokens: 0 },
    };
    const result = buildPreamble(ctx, { approval: "on-request", sandbox: "read-only" }, undefined);
    expect(result).not.toContain("<memory>");
  });

  it("omits <memory> when excludeFromContext is true even if projectedContext has memory", () => {
    const ctx: SessionContext = {
      ...MINIMAL_CONTEXT,
      projectedContext: {
        blocks: [{ id: "mem1", kind: "memory", source: "test", content: "Sensitive memory context", required: false, score: 0.6 }],
        estimatedTokens: 10,
      },
    };
    const result = buildPreamble(
      ctx,
      {
        approval: "on-request",
        sandbox: "read-only",
        fileGovernance: { excludeFromContext: true },
      },
      undefined,
    );
    expect(result).not.toContain("<memory>");
    expect(result).not.toContain("Sensitive memory context");
  });

  it("includes <memory> when excludeFromContext is false", () => {
    const ctx: SessionContext = {
      ...MINIMAL_CONTEXT,
      projectedContext: {
        blocks: [{ id: "mem1", kind: "memory", source: "test", content: "Normal memory context", required: false, score: 0.6 }],
        estimatedTokens: 10,
      },
    };
    const result = buildPreamble(
      ctx,
      {
        approval: "on-request",
        sandbox: "read-only",
        fileGovernance: { excludeFromContext: false },
      },
      undefined,
    );
    expect(result).toContain("<memory>");
    expect(result).toContain("Normal memory context");
  });

  it("includes <memory> when excludeFromContext is undefined", () => {
    const ctx: SessionContext = {
      ...MINIMAL_CONTEXT,
      projectedContext: {
        blocks: [{ id: "mem1", kind: "memory", source: "test", content: "Default memory context", required: false, score: 0.6 }],
        estimatedTokens: 10,
      },
    };
    const result = buildPreamble(
      ctx,
      {
        approval: "on-request",
        sandbox: "read-only",
        fileGovernance: {},
      },
      undefined,
    );
    expect(result).toContain("<memory>");
    expect(result).toContain("Default memory context");
  });

  it("truncates projectedContext memory at 200 lines", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 250; i++) {
      lines.push(`Line ${i}: context from prior session`);
    }
    const ctx: SessionContext = {
      ...MINIMAL_CONTEXT,
      projectedContext: { blocks: [{ id: "mem1", kind: "memory", source: "test", content: lines.join("\n"), required: false, score: 0.6 }], estimatedTokens: 1000 },
    };
    const result = buildPreamble(ctx, { approval: "on-request", sandbox: "read-only" }, undefined);

    expect(result).toContain("[memory truncated — 50 lines omitted]");
    expect(result).not.toContain("Line 201");
    expect(result).toContain("Line 200");
  });

  it("does not truncate when projectedContext memory is exactly 200 lines", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 200; i++) {
      lines.push(`Line ${i}`);
    }
    const ctx: SessionContext = {
      ...MINIMAL_CONTEXT,
      projectedContext: { blocks: [{ id: "mem1", kind: "memory", source: "test", content: lines.join("\n"), required: false, score: 0.6 }], estimatedTokens: 800 },
    };
    const result = buildPreamble(ctx, { approval: "on-request", sandbox: "read-only" }, undefined);

    expect(result).not.toContain("truncated");
    expect(result).toContain("Line 200");
  });

  it("escapes XML special characters in task", () => {
    const ctx: SessionContext = { ...MINIMAL_CONTEXT, task: "Fix <bug> & fix 'error'" };
    const result = buildPreamble(ctx, { approval: "on-request", sandbox: "read-only" }, undefined);
    expect(result).toContain("&lt;bug&gt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&apos;");
  });

  it("escapes XML special characters in memory", () => {
    const ctx: SessionContext = {
      ...MINIMAL_CONTEXT,
      projectedContext: { blocks: [{ id: "mem1", kind: "memory", source: "test", content: "Use <b>bold</b> tags & wrap", required: false, score: 0.6 }], estimatedTokens: 10 },
    };
    const result = buildPreamble(ctx, { approval: "on-request", sandbox: "read-only" }, undefined);
    expect(result).toContain("&lt;b&gt;");
    expect(result).toContain("&amp;");
  });

  it("omits domain section when domain has no toolTags and no qualityGates", () => {
    const ctx: SessionContext = {
      ...MINIMAL_CONTEXT,
      domain: { ...MINIMAL_CONTEXT.domain, toolTags: new Set(), qualityGates: [] },
    };
    const result = buildPreamble(ctx, { approval: "on-request", sandbox: "read-only" }, undefined);
    expect(result).not.toContain("<domain>");
  });

  it("always includes <task> even with minimal context", () => {
    const result = buildPreamble(MINIMAL_CONTEXT, { approval: "on-request", sandbox: "read-only" }, undefined);
    expect(result).toMatch(/<task>Fix the login bug<\/task>/);
  });

  it("always includes <constraints> with policy fields", () => {
    const result = buildPreamble(MINIMAL_CONTEXT, { approval: "untrusted", sandbox: "danger-full-access" }, undefined);
    expect(result).toContain("<constraints>");
    expect(result).toContain("Approval mode: untrusted");
    expect(result).toContain("Sandbox: danger-full-access");
  });

  it("uses safe defaults when agent has minimal fields", () => {
    const minimalAgent: Agent = {
      name: "Bot",
      role: "Assistant",
      goal: "Help",
      tier: "fast",
      tools: [],
    };
    const result = buildPreamble(MINIMAL_CONTEXT, { approval: "on-request", sandbox: "read-only" }, minimalAgent);
    expect(result).toContain("You are Bot, Assistant. Goal: Help");
    expect(result).not.toContain("undefined");
    expect(result).not.toContain("null");
  });
});
