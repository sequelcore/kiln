import { describe, expect, it } from "vitest";
import {
  createRunHostToolSandbox,
  PLAN_POLICY,
  projectRunBuiltinToolOptions,
  resolveRunBuiltinToolProjection,
} from "../../src/commands/run.js";
import { assertBoundHostToolSandbox } from "@kilnai/core/sandbox";
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

  it("projects an explicit no-tool run as a strict empty tool surface", () => {
    expect(projectRunBuiltinToolOptions({ additionalTools: [] }, false, true).toolProjection).toEqual({
      mode: "strict",
      alwaysOnTools: [],
    });
  });

  it("binds host-tool enforcement to the exact CLI policy and read-only authority", () => {
    const permissionPolicy = { approval: "never", sandbox: "danger-full-access" } as const;
    const sandbox = assertBoundHostToolSandbox(createRunHostToolSandbox({
      cwd: "C:/workspace",
      sessionId: "session-1",
      configurationRevisionId: `sha256:${"1".repeat(64)}`,
      permissionPolicy,
      requestedAuthority: "read_only",
    }));

    expect(sandbox.policy.config).toMatchObject({ fsPolicy: "read-only", netPolicy: "none" });
    expect(sandbox.policy.canRead("C:/workspace/README.md")).toBe(true);
    expect(sandbox.policy.canRead("C:/outside/private.txt")).toBe(false);
    expect(sandbox.policy.canWrite("C:/workspace/README.md")).toBe(false);
  });

  it("admits an explicit additional directory without widening read-only authority", () => {
    const permissionPolicy = { approval: "never", sandbox: "read-only" } as const;
    const sandbox = assertBoundHostToolSandbox(createRunHostToolSandbox({
      cwd: "C:/workspace",
      addDir: "C:/fixtures/context-efficiency",
      sessionId: "session-1",
      configurationRevisionId: `sha256:${"1".repeat(64)}`,
      permissionPolicy,
      requestedAuthority: "read_only",
    }));

    expect(sandbox.policy.canRead("C:/workspace/README.md")).toBe(true);
    expect(sandbox.policy.canRead("C:/fixtures/context-efficiency/shard-1.txt")).toBe(true);
    expect(sandbox.policy.canRead("C:/fixtures/other/shard-1.txt")).toBe(false);
    expect(sandbox.policy.canWrite("C:/fixtures/context-efficiency/shard-1.txt")).toBe(false);
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
    expect(evaluator.evaluateTool("kiln_config.apply_change").action).toBe("deny");
    expect(evaluator.evaluateFile(".").action).toBe("allow");
    expect(evaluator.evaluateFile("packages/gui/src/App.tsx").action).toBe("allow");
    expect(evaluator.evaluateFile("/workspace/references/cloned/opencode").action).toBe("allow");
    expect(evaluator.evaluateFile(".git/config").action).toBe("deny");
    expect(evaluator.evaluateFile("packages/gui/node_modules/react/index.js").action).toBe("deny");
    expect(JSON.stringify(PLAN_POLICY.fileGovernance?.allowGlobs ?? [])).not.toContain("/workspace/");
  });

  it("gates native shell access by command shape instead of denying the tool outright", () => {
    const evaluator = createPermissionEvaluator(PLAN_POLICY);

    // The shell tool itself is admitted; per-invocation command patterns
    // enforce the read-only boundary, matching how Claude Code, Codex, and
    // opencode gate shell access by command shape rather than by tool name.
    expect(evaluator.evaluateTool("Bash").action).toBe("allow");
    expect(evaluator.evaluateTool("bash").action).toBe("allow");

    expect(evaluator.evaluateCommand("git status", "bash").action).toBe("allow");
    expect(evaluator.evaluateCommand("git diff HEAD~1", "bash").action).toBe("allow");
    expect(evaluator.evaluateCommand("git log -20", "bash").action).toBe("allow");
    expect(evaluator.evaluateCommand("git show HEAD", "bash").action).toBe("allow");
    expect(evaluator.evaluateCommand("cat package.json", "bash").action).toBe("allow");
    expect(evaluator.evaluateCommand("ls -la packages/cli", "bash").action).toBe("allow");
    expect(evaluator.evaluateCommand("head -50 README.md", "bash").action).toBe("allow");
    expect(evaluator.evaluateCommand("tail -50 README.md", "bash").action).toBe("allow");
    expect(evaluator.evaluateCommand("wc -l README.md", "bash").action).toBe("allow");
    expect(evaluator.evaluateCommand("pwd", "bash").action).toBe("allow");

    // Unmatched shapes -- including write effects and command chaining that
    // widens a read-only pattern into a different command -- fall through to
    // the untrusted-approval default and are denied.
    expect(evaluator.evaluateCommand("rm -rf /", "bash").action).toBe("deny");
    expect(evaluator.evaluateCommand("npm install", "bash").action).toBe("deny");
    expect(evaluator.evaluateCommand("git push origin main", "bash").action).toBe("deny");
    expect(evaluator.evaluateCommand("curl https://example.com", "bash").action).toBe("deny");
    expect(evaluator.evaluateCommand("cat package.json && rm -rf /", "bash").action).toBe("deny");
  });
});
