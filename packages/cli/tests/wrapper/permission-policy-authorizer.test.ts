import { describe, expect, it } from "vitest";
import { PermissionPolicyAuthorizer } from "../../src/wrapper/permission-policy-authorizer.js";
import type { KilnPermissionPolicy } from "../../src/wrapper/session.js";
import type { ResolvedInvocationEffect } from "@kilnai/core/engine";

function makePolicy(approval: KilnPermissionPolicy["approval"]): KilnPermissionPolicy {
  return { approval };
}

describe("PermissionPolicyAuthorizer", () => {
  describe("authorize()", () => {
    const readOnly: ResolvedInvocationEffect = {
      operation: "observe",
      boundaries: ["process", "workspace"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: [],
      idempotency: "idempotent",
    };
    const destructive: ResolvedInvocationEffect = {
      operation: "mutate",
      boundaries: ["process", "workspace"],
      reversibility: "irreversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: ["local-state"],
      idempotency: "non-idempotent",
    };

    it("approval=never: allows all tools at level 1, no approval needed", () => {
      const auth = new PermissionPolicyAuthorizer(makePolicy("never"));
      const result = auth.authorize("bash", destructive);
      expect(result.allowed).toBe(true);
      expect(result.level).toBe(4);
      expect(result.requiresApproval).toBe(false);
      expect(result.reason).toContain("approval=never");
    });

    it("approval=untrusted: denies all tools at level 4, approval required", () => {
      const auth = new PermissionPolicyAuthorizer(makePolicy("untrusted"));
      const result = auth.authorize("write", readOnly);
      expect(result.allowed).toBe(false);
      expect(result.level).toBe(4);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain("untrusted");
    });

    it("approval=on-request: denies at level 3, approval required", () => {
      const auth = new PermissionPolicyAuthorizer(makePolicy("on-request"));
      const result = auth.authorize("edit", destructive);
      expect(result.allowed).toBe(false);
      expect(result.level).toBe(4);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain("on-request");
      expect(result.reason).toContain("edit");
    });

    it("approval=on-failure: denies at level 3, approval required", () => {
      const auth = new PermissionPolicyAuthorizer(makePolicy("on-failure"));
      const result = auth.authorize("write", destructive);
      expect(result.allowed).toBe(false);
      expect(result.level).toBe(4);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain("on-failure");
    });

    it("approval=on-request auto-authorizes read-only tools", () => {
      const auth = new PermissionPolicyAuthorizer(makePolicy("on-request"));
      const result = auth.authorize("read", readOnly);
      expect(result.allowed).toBe(true);
      expect(result.level).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("approval=on-failure auto-authorizes read-only tools", () => {
      const auth = new PermissionPolicyAuthorizer(makePolicy("on-failure"));
      const result = auth.authorize("grep", readOnly);
      expect(result.allowed).toBe(true);
      expect(result.level).toBe(1);
      expect(result.requiresApproval).toBe(false);
    });

    it("returns reason string mentioning tool name for gated modes", () => {
      const auth = new PermissionPolicyAuthorizer(makePolicy("on-request"));
      const result = auth.authorize("git", destructive);
      expect(result.reason).toContain("git");
    });
  });
});
