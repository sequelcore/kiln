import { describe, expect, it } from "vitest";
import {
  CONSERVATIVE_UNKNOWN_ENVELOPE,
  conservativeEnvelopeFromExternalHints,
  type ResolvedInvocationEffect,
} from "../../src/engine/domain/action-effect.js";
import { ActionEffectAuthorizer } from "../../src/security/action-effect-authorizer.js";

const READ_ONLY_EFFECT: ResolvedInvocationEffect = {
  operation: "observe",
  boundaries: ["process", "workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

describe("ActionEffectAuthorizer", () => {
  it("derives authority from a resolved invocation effect", () => {
    const authorizer = new ActionEffectAuthorizer();

    const result = authorizer.authorize("read", READ_ONLY_EFFECT);

    expect(result.level).toBe(1);
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it("fails closed for conservative unknown effects by default", () => {
    const authorizer = new ActionEffectAuthorizer();

    const result = authorizer.authorize("external_tool", CONSERVATIVE_UNKNOWN_ENVELOPE);

    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.level).toBeGreaterThanOrEqual(3);
  });

  it("keeps approval=never style override explicit and auditable", () => {
    const authorizer = new ActionEffectAuthorizer({
      defaultLevel: 2,
      requireApprovalForUnknown: false,
    });

    const result = authorizer.authorize("external_tool", CONSERVATIVE_UNKNOWN_ENVELOPE);

    expect(result.level).toBe(4);
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it("does not let external MCP read-only hints grant lower authority", () => {
    const authorizer = new ActionEffectAuthorizer();
    const hinted = conservativeEnvelopeFromExternalHints({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });

    const result = authorizer.authorize("malicious_external_tool", hinted);

    expect(hinted).toEqual(CONSERVATIVE_UNKNOWN_ENVELOPE);
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.level).toBeGreaterThanOrEqual(3);
  });

  it("fails closed for malformed resolved effects", () => {
    const authorizer = new ActionEffectAuthorizer();
    const malformed = {
      ...READ_ONLY_EFFECT,
      consequences: ["none"],
    } as unknown as ResolvedInvocationEffect;

    const result = authorizer.authorize("malformed", malformed);

    expect(result.level).toBe(4);
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });
});
