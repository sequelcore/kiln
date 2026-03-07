import { describe, it, expect } from "vitest";
import { AnnotationAuthorizer } from "../../src/security/annotation-authorizer.js";
import type { CapabilityAnnotations } from "../../src/engine/domain/capability.js";

describe("AnnotationAuthorizer", () => {
  describe("Level 1: readOnly", () => {
    it("classifies readOnly tools as L1 auto-execute", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("get_users", { readOnly: true });

      expect(result.level).toBe(1);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("readOnly takes priority even with other annotations", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("get_users", { readOnly: true, idempotent: true });

      expect(result.level).toBe(1);
      expect(result.allowed).toBe(true);
    });
  });

  describe("Level 2: idempotent / default", () => {
    it("classifies idempotent tools as L2 audited", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("update_user", { idempotent: true });

      expect(result.level).toBe(2);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("uses defaultLevel=2 when no annotations", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("some_tool");

      expect(result.level).toBe(2);
      expect(result.allowed).toBe(true);
    });

    it("uses defaultLevel=2 for empty annotations object", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("some_tool", {});

      expect(result.level).toBe(2);
      expect(result.allowed).toBe(true);
    });
  });

  describe("Level 3: unknown requiring confirmation", () => {
    it("requires approval when requireApprovalForUnknown is set", () => {
      const authorizer = new AnnotationAuthorizer({ requireApprovalForUnknown: true });
      const result = authorizer.authorize("unknown_tool");

      expect(result.level).toBe(3);
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe("Level 4: destructive", () => {
    it("classifies destructive tools as L4 always-confirm", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("delete_database", { destructive: true });

      expect(result.level).toBe(4);
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });

    it("destructive overrides readOnly", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("delete_db", { destructive: true, readOnly: true });

      expect(result.level).toBe(4);
      expect(result.allowed).toBe(false);
    });

    it("includes tool name in reason", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("drop_table", { destructive: true });

      expect(result.reason).toContain("drop_table");
    });
  });

  describe("Custom policy", () => {
    it("uses custom defaultLevel", () => {
      const authorizer = new AnnotationAuthorizer({ defaultLevel: 3 });
      const result = authorizer.authorize("some_tool", {});

      expect(result.level).toBe(3);
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });

    it("custom defaultLevel applies to no-annotation tools", () => {
      const authorizer = new AnnotationAuthorizer({ defaultLevel: 1 });
      const result = authorizer.authorize("some_tool");

      expect(result.level).toBe(1);
      expect(result.allowed).toBe(true);
    });

    it("annotations override custom defaultLevel", () => {
      const authorizer = new AnnotationAuthorizer({ defaultLevel: 1 });
      const annotations: CapabilityAnnotations = { destructive: true };
      const result = authorizer.authorize("delete", annotations);

      expect(result.level).toBe(4);
    });
  });
});
