import {
  type ActionEffectEnvelope,
  deriveAuthorityFromEffect,
  resolveInvocationEffect,
} from "@kilnai/core/engine";
import { describe, expect, it } from "vitest";
import { buildRuntimeInvocationEffectResolvers } from "../../src/session/runtime-invocation-effect-resolvers.js";

const MANAGED_INVOCATION_ENVELOPE: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace", "network"],
  reversibility: "irreversible",
  dataEgress: "unknown",
  identityUse: "authenticated",
  consequences: ["local-state", "external-state"],
  idempotency: "non-idempotent",
};

describe("runtime invocation effect resolvers", () => {
  it.each(["managed_agent.invoke", "managed_agent.start"])(
    "admits a %s read-only child as audited without interactive approval",
    (toolName) => {
      const effect = resolveInvocationEffect(toolName, {
        profile: "foundation-readonly-plan",
        requestedAuthority: "read_only",
      }, MANAGED_INVOCATION_ENVELOPE, buildRuntimeInvocationEffectResolvers());

      expect(effect).toEqual({
        operation: "mutate",
        boundaries: ["process", "workspace", "network"],
        reversibility: "compensatable",
        dataEgress: "project-data",
        identityUse: "authenticated",
        consequences: ["local-state", "external-state"],
        idempotency: "non-idempotent",
      });
      expect(deriveAuthorityFromEffect(effect)).toMatchObject({
        level: 2,
        allowed: true,
        requiresApproval: false,
      });
    },
  );

  it("preserves the conservative envelope for a write-capable child", () => {
    const effect = resolveInvocationEffect("managed_agent.invoke", {
      profile: "foundation-apply-approved-writes",
      requestedAuthority: "destructive",
    }, MANAGED_INVOCATION_ENVELOPE, buildRuntimeInvocationEffectResolvers());

    expect(effect).toEqual(MANAGED_INVOCATION_ENVELOPE);
    expect(deriveAuthorityFromEffect(effect)).toMatchObject({
      level: 4,
      allowed: false,
      requiresApproval: true,
    });
  });
});
