import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@kilnai/core/agents";
import { appendOperatorSurfaceToolDirective } from "../../src/session/runtime-session-orchestrator-routing.js";

describe("runtime session orchestrator routing", () => {
  it("does not change the system prompt when no operator surface tools are present", () => {
    const tools: ToolDefinition[] = [
      {
        name: "read",
        description: "Read a file",
        inputSchema: {},
        tags: new Set(["filesystem"]),
      },
    ];

    expect(appendOperatorSurfaceToolDirective("System", tools)).toBe("System");
  });

  it("adds operator-surface guidance when operator tools are available", () => {
    const tools: ToolDefinition[] = [
      {
        name: "operator_set_theme",
        description: "Change the live operator surface theme",
        inputSchema: {},
        tags: new Set(["operator-ui"]),
      },
    ];

    const system = appendOperatorSurfaceToolDirective("System", tools);

    expect(system).toContain("--- Operator Surface Tools ---");
    expect(system).toContain("call operator_set_theme");
    expect(system).toContain("instead of proposing repository or config changes");
    expect(system).toContain("scope=\"session\"");
  });
});
