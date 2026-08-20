import { describe, expect, it } from "vitest";
import {
  PLAN_POLICY,
  resolveRunPermissionPolicy,
} from "../../src/commands/run.js";
import { createPermissionEvaluator } from "../../src/wrapper/permission-evaluator.js";
import { MODEL_FACING_DEFAULT_PERMISSION_POLICY } from "../../src/config/model-facing-permission-policy.js";

describe("run canonical policy and quality gates", () => {
  it("uses resolved YAML permissions for normal runs", () => {
    const permissions = {
      approval: "on-request" as const,
      sandbox: "read-only" as const,
      safeDefaults: true,
      auditLog: true,
      tools: [{ tool: "read", action: "allow" as const }],
    };

    expect(resolveRunPermissionPolicy({}, permissions)).toEqual(permissions);
    expect(resolveRunPermissionPolicy({}, {
      approval: "untrusted",
      sandbox: "read-only",
    })).toEqual({
      approval: "untrusted",
      sandbox: "read-only",
      safeDefaults: true,
      auditLog: true,
    });
  });

  it("uses the one immutable model-facing fallback when configuration is absent", () => {
    expect(resolveRunPermissionPolicy({})).toBe(MODEL_FACING_DEFAULT_PERMISSION_POLICY);
    expect(Object.isFrozen(MODEL_FACING_DEFAULT_PERMISSION_POLICY)).toBe(true);
    expect(MODEL_FACING_DEFAULT_PERMISSION_POLICY).toEqual({
      approval: "on-request",
      sandbox: "read-only",
      safeDefaults: true,
      auditLog: true,
    });
  });

  it("keeps plan mode explicitly narrowed and read-only", () => {
    const configured = {
      approval: "never" as const,
      sandbox: "danger-full-access" as const,
      tools: [
        { tool: "managed_agent.invoke", action: "deny" as const },
        { tool: "write", action: "allow" as const },
        { tool: "grep", action: "ask" as const },
      ],
    };

    const resolved = resolveRunPermissionPolicy({ plan: true }, configured);
    const evaluator = createPermissionEvaluator(resolved);

    expect(resolved).not.toBe(PLAN_POLICY);
    expect(resolved.sandbox).toBe("read-only");
    expect(evaluator.evaluateTool("managed_agent.invoke").action).toBe("deny");
    expect(evaluator.evaluateTool("write").action).toBe("deny");
    expect(evaluator.evaluateTool("grep").action).toBe("deny");
    expect(evaluator.evaluateTool("read").action).toBe("allow");
  });

});
