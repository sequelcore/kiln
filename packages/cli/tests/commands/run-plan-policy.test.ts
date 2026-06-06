import { describe, expect, it } from "vitest";
import { PLAN_POLICY } from "../../src/commands/run.js";
import { createPermissionEvaluator } from "../../src/wrapper/permission-evaluator.js";

describe("run plan permission policy", () => {
  it("admits governed control-plane tools while keeping plan mode read-only", () => {
    const evaluator = createPermissionEvaluator(PLAN_POLICY);

    expect(PLAN_POLICY.sandbox).toBe("read-only");
    expect(evaluator.evaluateTool("work_governance.assess").action).toBe("allow");
    expect(evaluator.evaluateTool("work_item.execution.start").action).toBe("allow");
    expect(evaluator.evaluateTool("managed_agent.invoke").action).toBe("allow");
    expect(evaluator.evaluateTool("kiln_config.read").action).toBe("allow");
    expect(evaluator.evaluateTool("tool_catalog_search").action).toBe("allow");
    expect(evaluator.evaluateTool("read").action).toBe("allow");
    expect(evaluator.evaluateTool("tree").action).toBe("allow");
    expect(evaluator.evaluateTool("grep").action).toBe("allow");
    expect(evaluator.evaluateTool("glob").action).toBe("allow");
    expect(evaluator.evaluateTool("git").action).toBe("allow");
    expect(evaluator.evaluateTool("resource_list").action).toBe("allow");
    expect(evaluator.evaluateTool("resource_template_list").action).toBe("allow");
    expect(evaluator.evaluateTool("resource_read").action).toBe("allow");
    expect(evaluator.evaluateTool("Bash").action).toBe("deny");
    expect(evaluator.evaluateTool("kiln_config.apply_change").action).toBe("deny");
    expect(evaluator.evaluateFile(".").action).toBe("allow");
    expect(evaluator.evaluateFile("packages/gui/src/App.tsx").action).toBe("allow");
    expect(evaluator.evaluateFile("C:/Proyectos/Sequel/cloned/opencode").action).toBe("allow");
    expect(evaluator.evaluateFile(".git/config").action).toBe("deny");
    expect(evaluator.evaluateFile("packages/gui/node_modules/react/index.js").action).toBe("deny");
  });
});
