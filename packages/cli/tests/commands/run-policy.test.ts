import {
  PLAN_POLICY,
  resolveRunPermissionPolicy,
} from "../../src/commands/run.js";

describe("run canonical policy and quality gates", () => {
  it("uses resolved YAML permissions for normal runs", () => {
    const permissions = {
      approval: "on-request" as const,
      sandbox: "read-only" as const,
      safeDefaults: true,
      tools: [{ tool: "read", action: "allow" as const }],
    };

    expect(resolveRunPermissionPolicy({}, permissions)).toEqual(permissions);
  });

  it("keeps plan mode explicitly narrowed and read-only", () => {
    const configured = { approval: "never" as const, sandbox: "danger-full-access" as const };

    expect(resolveRunPermissionPolicy({ plan: true }, configured)).toBe(PLAN_POLICY);
    expect(resolveRunPermissionPolicy({ plan: true }, configured).sandbox).toBe("read-only");
  });

});
