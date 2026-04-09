import { describe, expect, it } from "vitest";
import { PLAN_EXIT_TOOL_NAME, planExitToolSchema } from "../plan-exit-tool.js";

describe("plan-exit-tool", () => {
  it("uses submit_plan as schema name", () => {
    expect(PLAN_EXIT_TOOL_NAME).toBe("submit_plan");
    expect(planExitToolSchema.name).toBe("submit_plan");
  });

  it("requires the plan field in input schema", () => {
    expect(planExitToolSchema.inputSchema.required).toContain("plan");
  });
});
