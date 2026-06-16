import { describe, it, expect } from "vitest";
import { AnnotationAuthorizer } from "../../src/security/annotation-authorizer.js";
import type { CapabilityAnnotations } from "../../src/engine/domain/capability.js";
import { CONSERVATIVE_UNKNOWN_ENVELOPE, type ActionEffectEnvelope } from "../../src/engine/domain/action-effect.js";

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

  describe("Level 2: idempotent", () => {
    it("classifies idempotent tools as L2 audited", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("update_user", { idempotent: true });

      expect(result.level).toBe(2);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("no-annotation tools get conservative L4 (unknown identity)", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("some_tool");

      expect(result.level).toBe(4);
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });

    it("empty annotations get conservative L4 (unknown identity)", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("some_tool", {});

      expect(result.level).toBe(4);
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe("Level 4: destructive and unknown", () => {
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

    it("returns reason describing irreversible mutation with external impact", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("drop_table", { destructive: true });

      expect(result.reason).toContain("Irreversible");
    });
  });

  describe("Envelope passthrough", () => {
    it("prefers explicit effectEnvelope over annotations", () => {
      const authorizer = new AnnotationAuthorizer();
      const observeEnvelope: ActionEffectEnvelope = {
        operation: "observe",
        boundaries: ["process"],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: [],
        idempotency: "idempotent",
      };
      const result = authorizer.authorize("observe_tool", undefined, observeEnvelope);

      expect(result.level).toBe(1);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("uses annotations when no envelope provided", () => {
      const authorizer = new AnnotationAuthorizer();
      const result = authorizer.authorize("get_users", { readOnly: true });

      expect(result.level).toBe(1);
      expect(result.allowed).toBe(true);
    });
  });

  describe("Custom policy", () => {
    it("annotations override custom defaultLevel", () => {
      const authorizer = new AnnotationAuthorizer({ defaultLevel: 1 });
      const annotations: CapabilityAnnotations = { destructive: true };
      const result = authorizer.authorize("delete", annotations);

      expect(result.level).toBe(4);
    });

    it("custom policy with envelope bypasses unknown identity", () => {
      const authorizer = new AnnotationAuthorizer({ defaultLevel: 1 });
      const observeEnvelope: ActionEffectEnvelope = {
        operation: "observe",
        boundaries: ["process", "workspace"],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: [],
        idempotency: "idempotent",
      };
      const result = authorizer.authorize("observe_tool", undefined, observeEnvelope);

      expect(result.level).toBe(1);
      expect(result.allowed).toBe(true);
    });
  });
});
