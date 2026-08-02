import { describe, expect, it } from "vitest";
import { PLAN_POLICY, resolveRunBuiltinToolProjection } from "../../src/commands/run.js";
import { createPermissionEvaluator } from "../../src/wrapper/permission-evaluator.js";

describe("run plan permission policy", () => {
  it("projects the actual read-only planning catalog", () => {
    const plan = resolveRunBuiltinToolProjection(true);
    expect(plan.profile).toBe("read-only");
    expect(plan.alwaysOnTools).toEqual(expect.arrayContaining([
      "managed_agent.invoke",
      "managed_agent.status",
      "managed_agent.join",
    ]));
    expect(plan.alwaysOnTools).not.toContain("goal.create");
    expect(plan.alwaysOnTools).not.toContain("work_item.update");
    expect(plan.alwaysOnTools).not.toContain("work_item.execution.start");
    expect(plan.alwaysOnTools).not.toContain("bash");
    expect(plan.alwaysOnTools).not.toContain("write");
    expect(resolveRunBuiltinToolProjection(false)).toEqual({ profile: "execute", alwaysOnTools: [] });
  });

  it("admits governed control-plane tools while keeping plan mode read-only", () => {
    const evaluator = createPermissionEvaluator(PLAN_POLICY);

    expect(PLAN_POLICY.sandbox).toBe("read-only");
    expect(evaluator.evaluateTool("work_governance.assess").action).toBe("allow");
    expect(evaluator.evaluateTool("goal.create").action).toBe("deny");
    expect(evaluator.evaluateTool("work_item.update").action).toBe("deny");
    expect(evaluator.evaluateTool("work_item.execution.start").action).toBe("deny");
    expect(evaluator.evaluateTool("managed_agent.invoke").action).toBe("allow");
    expect(evaluator.evaluateTool("kiln_config.read").action).toBe("allow");
    expect(evaluator.evaluateTool("tool_catalog_search").action).toBe("allow");
    expect(evaluator.evaluateTool("memory_search").action).toBe("allow");
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
    expect(evaluator.evaluateFile("/workspace/references/cloned/opencode").action).toBe("allow");
    expect(evaluator.evaluateFile(".git/config").action).toBe("deny");
    expect(evaluator.evaluateFile("packages/gui/node_modules/react/index.js").action).toBe("deny");
    expect(JSON.stringify(PLAN_POLICY.fileGovernance?.allowGlobs ?? [])).not.toContain("/workspace/");
  });
});
