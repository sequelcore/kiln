import { describe, expect, it } from "vitest";
import { describeTrustedExecutionEnforcement } from "../../src/security/trusted-execution-enforcement.js";

describe("describeTrustedExecutionEnforcement", () => {
  it("describes Codex as strongly enforced", () => {
    expect(describeTrustedExecutionEnforcement({ harness: "codex" })).toEqual({
      approvalControl: "enforced",
      filesystemSandbox: "enforced",
      networkBoundary: "enforced",
      strength: "strong",
    });
  });

  it.each([
    [true, "enforced"],
    [false, "unknown"],
  ] as const)("uses Claude's skip-permissions determinant (%s)", (allowDangerouslySkipPermissions, approvalControl) => {
    expect(
      describeTrustedExecutionEnforcement({ harness: "claude-code", allowDangerouslySkipPermissions }),
    ).toMatchObject({
      approvalControl,
      filesystemSandbox: "not-enforced",
      networkBoundary: "not-enforced",
      strength: "rules-only",
    });
  });

  it.each([
    ["allow", "enforced"],
    ["deny", "enforced"],
    ["ask", "unknown"],
  ] as const)("uses OpenCode's permission default (%s)", (permissionDefault, approvalControl) => {
    expect(describeTrustedExecutionEnforcement({ harness: "opencode", permissionDefault })).toMatchObject({
      approvalControl,
      filesystemSandbox: "not-enforced",
      networkBoundary: "not-enforced",
      strength: "rules-only",
    });
  });
});
