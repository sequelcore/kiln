import { describe, it, expect } from "vitest";
import { normalizePermissionPolicy } from "../../src/wrapper/permission-normalizer.js";

describe("normalizePermissionPolicy", () => {
  it("returns empty arrays for bare policy", () => {
    const r = normalizePermissionPolicy({ approval: "on-request", sandbox: "read-only" });
    expect(r.tools).toHaveLength(0);
    expect(r.commands).toHaveLength(0);
    expect(r.agentScopes).toHaveLength(0);
    expect(r.memory.read).toHaveLength(0);
    expect(r.memory.write).toHaveLength(0);
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
    expect(r.tools.find((t) => t.tool === "web_fetch")?.action).toBe("allow");
  });

  it("canonicalizes aliases before deduplication while preserving the last authored outcome", () => {
    const r = normalizePermissionPolicy({
      tools: [
        { tool: "WebFetch", action: "deny" },
        { tool: "web_fetch", action: "allow" },
      ],
    });

    expect(r.tools).toEqual([{ tool: "web_fetch", action: "allow" }]);
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

  it("preserves command rules that share pattern but differ by shell", () => {
    const r = normalizePermissionPolicy({
      commands: [
        { pattern: "npm test*", shell: "bash", action: "allow" },
        { pattern: "npm test*", shell: "zsh", action: "deny" },
      ],
    });

    expect(r.commands).toHaveLength(2);
    expect(
      r.commands.find((rule) => rule.pattern === "npm test*" && rule.shell === "bash")?.action,
    ).toBe("allow");
    expect(
      r.commands.find((rule) => rule.pattern === "npm test*" && rule.shell === "zsh")?.action,
    ).toBe("deny");
  });

  it("keeps last-match-wins for duplicate command pattern + shell pairs", () => {
    const r = normalizePermissionPolicy({
      commands: [
        { pattern: "npm test*", shell: "bash", action: "deny" },
        { pattern: "npm test*", shell: "bash", action: "allow" },
      ],
    });

    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]?.action).toBe("allow");
    expect(r.commands[0]?.shell).toBe("bash");
  });

  it("normalizes memory authority rules with deduplication", () => {
    const r = normalizePermissionPolicy({
      memory: {
        read: [
          {
            operations: ["read"],
            scopeKinds: ["project"],
            scopeIds: ["kiln"],
            layers: ["working"],
          },
        ],
        write: [
          {
            operations: ["save"],
            scopeKinds: ["project"],
            scopeIds: ["kiln"],
            layers: ["working"],
          },
          {
            operations: ["save"],
            scopeKinds: ["project"],
            scopeIds: ["kiln"],
            layers: ["working"],
          },
        ],
      },
    });

    expect(r.memory.read).toHaveLength(1);
    expect(r.memory.write).toHaveLength(1);
    expect(r.memory.write[0]?.operations).toEqual(["save"]);
  });
});
