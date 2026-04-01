import { describe, it, expect } from "vitest";
import { normalizePermissionPolicy } from "../../src/wrapper/permission-normalizer.js";

describe("normalizePermissionPolicy", () => {
  it("returns empty arrays for bare policy", () => {
    const r = normalizePermissionPolicy({ approval: "on-request", sandbox: "read-only" });
    expect(r.tools).toHaveLength(0);
    expect(r.commands).toHaveLength(0);
    expect(r.agentScopes).toHaveLength(0);
    expect(r.dataFirewall).toHaveLength(0);
  });

  it("applies safe-defaults when safeDefaults=true", () => {
    const r = normalizePermissionPolicy({ safeDefaults: true });
    expect(r.tools.length).toBeGreaterThan(0);
    expect(r.fileGovernance.denyGlobs).toContain("**/.env");
    expect(r.auditLog).toBe(true);
  });

  it("user tool rule overrides safe-default (last-match-wins)", () => {
    const r = normalizePermissionPolicy({ safeDefaults: true, tools: [{ tool: "WebFetch", action: "allow" }] });
    expect(r.tools.find((t) => t.tool === "WebFetch")?.action).toBe("allow");
  });

  it("merges fileGovernance without duplicates", () => {
    const r = normalizePermissionPolicy({ safeDefaults: true, fileGovernance: { denyGlobs: ["**/.env", "**/custom/**"] } });
    const globs = r.fileGovernance.denyGlobs ?? [];
    expect(globs.filter((g) => g === "**/.env")).toHaveLength(1);
    expect(globs).toContain("**/custom/**");
  });

  it("preserves explicit auditLog=false with safeDefaults=true", () => {
    const r = normalizePermissionPolicy({ safeDefaults: true, auditLog: false });
    expect(r.auditLog).toBe(false);
  });
});
