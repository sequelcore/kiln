import { describe, expect, it } from "vitest";
import {
  admitManagedRoute,
  createCapacityIdentity,
  createCredentialRevisionId,
} from "../../../src/agents/managed-invocation/route-capability.js";
import type {
  CallerAuthorityProfile,
  RequestedWorkContract,
  RouteCapability,
} from "../../../src/agents/managed-invocation/route-capability.js";

const evaluatedAt = "2026-08-08T00:00:00.000Z";
const caller: CallerAuthorityProfile = {
  authorityCeiling: "audited",
  allowedToolNames: ["read_file", "search"],
  allowsRecursion: false,
  allowsAttachments: false,
  allowsWrite: false,
};
const work: RequestedWorkContract = {
  evaluatedAt,
  access: "read-only",
  requestedAuthority: "audited",
  requiredToolNames: ["read_file"],
  requiresRecursion: false,
  requiresAttachments: false,
  requiresWrite: false,
  minimumProof: "configured",
};

function route(overrides: Partial<RouteCapability> = {}): RouteCapability {
  return {
    identity: { routeId: "route-alpha", revision: "r1" },
    target: { providerId: "any-provider", modelId: "any-model" },
    adapter: { kind: "direct-provider", capabilityId: "adapter.alpha", capabilityVersion: "1" },
    authorityCeiling: "destructive",
    toolNames: ["read_file", "search", "write_file"],
    supportsRecursion: true,
    supportsAttachments: true,
    supportsWrite: true,
    proof: {
      status: "live-proven",
      source: "synthetic",
      freshness: "fresh",
      observedAt: "2026-08-07T00:00:00.000Z",
      expiresAt: "2026-08-09T00:00:00.000Z",
      provenAccess: ["read-only"],
    },
    capacity: { kind: "accountless" },
    settlement: { kind: "not-required" },
    ...overrides,
  };
}

describe("admitManagedRoute", () => {
  it("admits a route with caller-narrowed authority and tools regardless of provider ID", () => {
    const first = admitManagedRoute({ route: route(), work, caller });
    const second = admitManagedRoute({ route: route({ target: { providerId: "different-provider", modelId: "any-model" } }), work, caller });

    expect(first).toMatchObject({ status: "admitted", effectiveAuthority: "audited", allowedToolNames: ["read_file", "search"] });
    expect(second).toMatchObject({ status: "admitted", effectiveAuthority: "audited", allowedToolNames: ["read_file", "search"] });
  });

  it("does not let readonly proof authorize a write work profile", () => {
    const decision = admitManagedRoute({ route: route({ authorityCeiling: "read_only", supportsWrite: false }), work: { ...work, access: "approved-write", requestedAuthority: "audited", requiresWrite: true }, caller: { ...caller, allowsWrite: true } });

    expect(decision).toEqual({
      status: "unavailable",
      routeId: "route-alpha",
      reasons: [
        { code: "authority-exceeds-route-ceiling" },
        { code: "write-not-supported-by-route" },
        { code: "access-unproven", access: "approved-write" },
      ],
    });
  });

  it("does not let live proof for readonly authorize an apply-approved-writes profile", () => {
    const decision = admitManagedRoute({ route: route(), work: { ...work, access: "approved-write", requestedAuthority: "destructive", requiresWrite: true }, caller: { ...caller, authorityCeiling: "destructive", allowsWrite: true } });

    expect(decision).toEqual({
      status: "unavailable",
      routeId: "route-alpha",
      reasons: [{ code: "access-unproven", access: "approved-write" }],
    });
  });

  it("reports stale proof as unresolved using only the injected evaluation time", () => {
    const decision = admitManagedRoute({ route: route({
      proof: {
        status: "live-proven",
        source: "synthetic",
        freshness: "fresh",
        observedAt: "2026-08-07T00:00:00.000Z",
        expiresAt: "2026-08-07T23:59:59.000Z",
        provenAccess: ["read-only"],
      },
    }), work, caller });

    expect(decision).toEqual({
      status: "unresolved",
      routeId: "route-alpha",
      reasons: [{ code: "proof-stale" }],
    });
  });

  it("requires the exact existing external-runtime attachment identity", () => {
    const attachment = { kind: "external-runtime" as const, runtimeId: "runtime-alpha", attachmentId: "attachment-alpha" };
    const decision = admitManagedRoute({ route: route({ externalRuntimeAttachment: attachment }), work: { ...work, requestedExternalRuntimeAttachment: { ...attachment, attachmentId: "attachment-beta" } }, caller });

    expect(decision).toEqual({
      status: "unavailable",
      routeId: "route-alpha",
      reasons: [{ code: "external-runtime-attachment-mismatch" }],
    });
  });

  it("rejects exhausted capacity evidence for the route's account policy without selecting an account", () => {
    const decision = admitManagedRoute({ route: route({ capacity: { kind: "policy-bound", accountPolicyId: "policy-alpha" } }), work, caller, capacitySnapshot: {
      accountPolicyId: "policy-alpha", availability: "exhausted", freshness: "fresh",
      observedAt: "2026-08-07T00:00:00.000Z", expiresAt: "2026-08-09T00:00:00.000Z",
    } });

    expect(decision).toEqual({
      status: "unavailable",
      routeId: "route-alpha",
      reasons: [{ code: "capacity-exhausted" }],
    });
  });

  it("rejects a snapshot for a different policy", () => {
    const decision = admitManagedRoute({ route: route({ capacity: { kind: "policy-bound", accountPolicyId: "policy-alpha" } }), work, caller, capacitySnapshot: {
      accountPolicyId: "policy-beta", availability: "available", freshness: "fresh",
      observedAt: "2026-08-07T00:00:00.000Z", expiresAt: "2026-08-09T00:00:00.000Z",
    } });
    expect(decision).toEqual({ status: "unavailable", routeId: "route-alpha", reasons: [{ code: "capacity-policy-mismatch" }] });
  });

  it("defers a policy-bound capacity decision when no snapshot is supplied", () => {
    expect(admitManagedRoute({ route: route({ capacity: { kind: "policy-bound", accountPolicyId: "policy-alpha" } }), work, caller })).toMatchObject({ status: "admitted" });
  });

  it("keeps accountless routes independent of capacity evidence", () => {
    expect(admitManagedRoute({ route: route(), work, caller })).toMatchObject({ status: "admitted" });
  });

  it("keeps identity values exact and never serializes credential material in capacity evidence", () => {
    const capacityIdentity = "account.alpha:primary";
    const credentialRevision = "a".repeat(64);
    expect(createCapacityIdentity(capacityIdentity)).toBe(capacityIdentity);
    expect(createCredentialRevisionId(credentialRevision)).toBe(credentialRevision);
    expect(JSON.stringify({ route: route({ capacity: { kind: "policy-bound", accountPolicyId: "policy-alpha" } }), capacitySnapshot: { accountPolicyId: "policy-alpha", availability: "available", freshness: "fresh", observedAt: "2026-08-07T00:00:00.000Z", expiresAt: "2026-08-09T00:00:00.000Z" } })).not.toContain("credential");
  });
});
