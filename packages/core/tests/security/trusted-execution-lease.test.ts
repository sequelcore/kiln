import { describe, expect, it } from "vitest";
import type { ActionEffectEnvelope, ResolvedInvocationEffect } from "../../src/engine/domain/action-effect.js";
import * as leaseModule from "../../src/security/trusted-execution-lease.js";
import {
  evaluateTrustedExecutionLeaseUse,
  TRUSTED_EXECUTION_LEASE_MAX_DURATION_MS,
  type TrustedExecutionLease,
  type TrustedExecutionLeaseUseContext,
  validateTrustedExecutionLeaseEvidence,
} from "../../src/security/trusted-execution-lease.js";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const PROJECT_A = `krp_${"1".repeat(64)}`;
const PROJECT_B = `krp_${"2".repeat(64)}`;

const effectCeiling = {
  operation: "mutate",
  boundaries: ["workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
} as const satisfies ActionEffectEnvelope;

const observedEffect = {
  operation: "observe",
  boundaries: ["workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
} as const satisfies ResolvedInvocationEffect;

const baseEvidence = {
  kind: "trusted-execution-lease",
  scope: "session",
  localPrincipalId: "os:operator-1",
  operatorSessionId: "operator-session-1",
  invocationTreeId: "invocation-tree-1",
  projectRuntimeId: PROJECT_A,
  compositionRevision: SHA_A,
  harness: "codex",
  routeId: "native-foreground",
  profileCeiling: "workspace-write",
  allowedToolNames: ["workspace.write", "workspace.read"],
  effectCeiling,
  policyDigest: SHA_A,
  enforcementRevision: "enforcement-1",
  issuedAt: "2026-08-24T00:00:00.000Z",
  expiresAt: "2026-08-24T01:00:00.000Z",
  status: { kind: "active" },
  authorizedBy: "Operator One",
} as const;

function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...baseEvidence, ...overrides };
}

function lease(overrides: Record<string, unknown> = {}): TrustedExecutionLease {
  return validateTrustedExecutionLeaseEvidence(evidence(overrides));
}

function context(overrides: Partial<TrustedExecutionLeaseUseContext> = {}): TrustedExecutionLeaseUseContext {
  return {
    now: "2026-08-24T00:30:00.000Z",
    localPrincipalId: baseEvidence.localPrincipalId,
    operatorSessionId: baseEvidence.operatorSessionId,
    invocationTreeId: baseEvidence.invocationTreeId,
    projectRuntimeId: PROJECT_A,
    compositionRevision: SHA_A,
    harness: "codex",
    routeId: baseEvidence.routeId,
    policyDigest: SHA_A,
    enforcementRevision: baseEvidence.enforcementRevision,
    requestedProfile: "workspace-write",
    toolName: "workspace.read",
    effect: observedEffect,
    ...overrides,
  };
}

describe("TrustedExecutionLease passive evidence", () => {
  it("normalizes and freezes a passive evidence value without granting authority", () => {
    const normalized = lease();

    expect(normalized.allowedToolNames).toEqual(["workspace.read", "workspace.write"]);
    expect(normalized.authorizedBy).toBe("Operator One");
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.allowedToolNames)).toBe(true);
    expect(Object.isFrozen(normalized.effectCeiling)).toBe(true);
    expect(Object.isFrozen(normalized.status)).toBe(true);
  });

  it("does not expose issuance, renewal, transition, or child-delegation APIs", () => {
    expect(Object.keys(leaseModule).sort()).toEqual([
      "TRUSTED_EXECUTION_LEASE_MAX_DURATION_MS",
      "evaluateTrustedExecutionLeaseUse",
      "validateTrustedExecutionLeaseEvidence",
    ]);
  });

  it("accepts at most one hour and rejects longer or non-positive lifetimes", () => {
    expect(TRUSTED_EXECUTION_LEASE_MAX_DURATION_MS).toBe(3_600_000);
    expect(() => lease({ expiresAt: "2026-08-24T01:00:00.001Z" })).toThrow("exceeds one hour");
    expect(() => lease({ expiresAt: baseEvidence.issuedAt })).toThrow("must be after issuedAt");
  });

  it.each([
    ["issuedAt", "2026-08-24T00:00:00Z"],
    ["expiresAt", "2026-08-24T01:00:00+00:00"],
  ])("rejects a non-canonical %s timestamp", (field, value) => {
    expect(() => lease({ [field]: value })).toThrow("canonical ISO timestamp");
  });

  it("rejects terminal lifecycle evidence that predates issuance", () => {
    expect(() => lease({ status: { kind: "revoked", at: "2026-08-23T23:59:59.999Z" } })).toThrow(
      "cannot predate issuance",
    );
  });

  it("retains a post-expiry terminal timestamp as audit evidence", () => {
    expect(lease({ status: { kind: "revoked", at: "2026-08-24T02:00:00.000Z" } }).status).toEqual({
      kind: "revoked",
      at: "2026-08-24T02:00:00.000Z",
    });
  });

  it.each([
    ["completed", "completed"],
    ["session-closed", "session-closed"],
    ["revoked", "revoked"],
  ] as const)("does not match terminal %s evidence", (kind, reason) => {
    expect(
      evaluateTrustedExecutionLeaseUse(lease({ status: { kind, at: "2026-08-24T00:20:00.000Z" } }), context()),
    ).toEqual({ matches: false, status: kind, reason });
  });

  it("does not match before issuance, at expiry, completion, or session closure", () => {
    expect(evaluateTrustedExecutionLeaseUse(lease(), context({ now: "2026-08-23T23:59:59.999Z" }))).toMatchObject({
      matches: false,
      reason: "not-yet-valid",
    });
    expect(evaluateTrustedExecutionLeaseUse(lease(), context({ now: baseEvidence.expiresAt }))).toMatchObject({
      matches: false,
      reason: "expired",
    });
    expect(evaluateTrustedExecutionLeaseUse(lease(), context({ invocationCompleted: true }))).toMatchObject({
      matches: false,
      reason: "completed",
    });
    expect(evaluateTrustedExecutionLeaseUse(lease(), context({ sessionClosed: true }))).toMatchObject({
      matches: false,
      reason: "session-closed",
    });
  });

  it.each([
    ["localPrincipalId", "os:operator-2"],
    ["operatorSessionId", "operator-session-2"],
    ["invocationTreeId", "invocation-tree-2"],
    ["projectRuntimeId", PROJECT_B],
    ["compositionRevision", SHA_B],
    ["harness", "opencode"],
    ["routeId", "different-route"],
  ] as const)("binds matching to %s", (field, value) => {
    expect(evaluateTrustedExecutionLeaseUse(lease(), context({ [field]: value }))).toMatchObject({
      matches: false,
      reason: "identity-mismatch",
    });
  });

  it("binds matching to policy and enforcement revisions", () => {
    expect(evaluateTrustedExecutionLeaseUse(lease(), context({ policyDigest: SHA_B }))).toMatchObject({
      matches: false,
      reason: "policy-revision-mismatch",
    });
    expect(evaluateTrustedExecutionLeaseUse(lease(), context({ enforcementRevision: "enforcement-2" }))).toMatchObject({
      matches: false,
      reason: "enforcement-revision-mismatch",
    });
  });

  it("checks the requested profile, exact tool, and resolved effect", () => {
    expect(
      evaluateTrustedExecutionLeaseUse(lease(), context({ requestedProfile: "trusted-full-access" })),
    ).toMatchObject({ matches: false, reason: "profile-ceiling-exceeded" });
    expect(evaluateTrustedExecutionLeaseUse(lease(), context({ toolName: "workspace.delete" }))).toMatchObject({
      matches: false,
      reason: "tool-not-approved",
    });
    expect(
      evaluateTrustedExecutionLeaseUse(lease(), context({ effect: { ...observedEffect, boundaries: ["network"] } })),
    ).toMatchObject({ matches: false, reason: "effect-ceiling-exceeded" });
    expect(evaluateTrustedExecutionLeaseUse(lease(), context())).toEqual({ matches: true, status: "active" });
  });

  it.each([
    ["unknown harness", { harness: "unknown" }],
    ["unknown profile", { profileCeiling: "root" }],
    ["malformed effect ceiling", { effectCeiling: { ...effectCeiling, boundaries: ["internet"] } }],
    ["duplicate tool", { allowedToolNames: ["workspace.read", "workspace.read"] }],
    ["malformed project binding", { projectRuntimeId: "project-1" }],
    ["malformed policy digest", { policyDigest: "sha256:not-a-digest" }],
    ["unknown field", { resourceScope: ["workspace"] }],
  ])("rejects %s", (_label, override) => {
    expect(() => lease(override)).toThrow();
  });

  it("fails closed for malformed evidence or use context", () => {
    const malformedLease = { ...lease(), allowedToolNames: [" workspace.read"] } as TrustedExecutionLease;
    const malformedContext = { ...context(), toolName: " workspace.read" };
    const malformedLifecycle = { ...context(), sessionClosed: 0 } as unknown as TrustedExecutionLeaseUseContext;

    expect(evaluateTrustedExecutionLeaseUse(malformedLease, context())).toMatchObject({
      matches: false,
      reason: "malformed-evidence",
    });
    expect(evaluateTrustedExecutionLeaseUse(lease(), malformedContext)).toMatchObject({
      matches: false,
      reason: "malformed-context",
    });
    expect(evaluateTrustedExecutionLeaseUse(lease(), malformedLifecycle)).toMatchObject({
      matches: false,
      reason: "malformed-context",
    });
  });
});
