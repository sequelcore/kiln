import type { ActionEffectEnvelope, ResolvedInvocationEffect } from "@kilnai/core";
import { describe, expect, it } from "vitest";
import {
  type AttendedTrustedExecutionLeaseApprovalBinding,
  type AttendedTrustedExecutionLeaseApprovalDecision,
  AttendedTrustedExecutionLeaseAuthority,
  type AttendedTrustedExecutionLeaseIssueRequest,
  TRUSTED_EXECUTION_LEASE_MAX_DURATION_MS,
} from "../../src/execution-kernel/attended-trusted-execution-lease-authority.js";

const SHA_A = `sha256:${"a".repeat(64)}` as const;
const SHA_B = `sha256:${"b".repeat(64)}` as const;
const PROJECT_RUNTIME_ID = `krp_${"1".repeat(64)}` as const;

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

const request = {
  harness: "codex",
  routeId: "native-foreground",
  profileCeiling: "workspace-write",
  allowedToolNames: ["workspace.write", "workspace.read"],
  effectCeiling,
  policyDigest: SHA_A,
  enforcementRevision: "enforcement-1",
  durationMs: TRUSTED_EXECUTION_LEASE_MAX_DURATION_MS,
} satisfies AttendedTrustedExecutionLeaseIssueRequest;

function makeAuthority(
  approve: (
    binding: AttendedTrustedExecutionLeaseApprovalBinding,
  ) => AttendedTrustedExecutionLeaseApprovalDecision | Promise<AttendedTrustedExecutionLeaseApprovalDecision>,
  now: () => string = () => "2026-08-24T00:00:00.000Z",
): AttendedTrustedExecutionLeaseAuthority {
  return new AttendedTrustedExecutionLeaseAuthority({
    binding: {
      localPrincipalId: "process-principal:1",
      operatorSessionId: "operator-session-1",
      invocationTreeId: "invocation-tree-1",
      projectRuntimeId: PROJECT_RUNTIME_ID,
      compositionRevision: SHA_A,
    },
    approvalPort: { approve },
    now,
  });
}

function useInput(overrides: Record<string, unknown> = {}) {
  return {
    now: "2026-08-24T00:30:00.000Z",
    harness: "codex" as const,
    routeId: request.routeId,
    policyDigest: request.policyDigest,
    enforcementRevision: request.enforcementRevision,
    requestedProfile: "workspace-write" as const,
    toolName: "workspace.read",
    effect: observedEffect,
    ...overrides,
  };
}

describe("AttendedTrustedExecutionLeaseAuthority", () => {
  it("issues one frozen Core lease from one exact frozen approval binding", async () => {
    let observedBinding: AttendedTrustedExecutionLeaseApprovalBinding | undefined;
    const authority = makeAuthority((binding) => {
      observedBinding = binding;
      return { status: "approved", authorizedBy: "Operator One" };
    });

    const result = await authority.issue(request);

    expect(result.status).toBe("issued");
    if (result.status !== "issued") return;
    expect(result.lease).toMatchObject({
      kind: "trusted-execution-lease",
      scope: "session",
      localPrincipalId: "process-principal:1",
      operatorSessionId: "operator-session-1",
      invocationTreeId: "invocation-tree-1",
      projectRuntimeId: PROJECT_RUNTIME_ID,
      compositionRevision: SHA_A,
      issuedAt: "2026-08-24T00:00:00.000Z",
      expiresAt: "2026-08-24T01:00:00.000Z",
      status: { kind: "active" },
      authorizedBy: "Operator One",
    });
    expect(result.lease.allowedToolNames).toEqual(["workspace.read", "workspace.write"]);
    expect(observedBinding).toBeDefined();
    expect(Object.isFrozen(observedBinding)).toBe(true);
    expect(Object.isFrozen(observedBinding?.allowedToolNames)).toBe(true);
    expect(Object.isFrozen(observedBinding?.effectCeiling)).toBe(true);
    expect(observedBinding).not.toHaveProperty("status");
    expect(observedBinding).not.toHaveProperty("authorizedBy");
    expect(Object.isFrozen(result.lease)).toBe(true);
    expect(authority.currentLease).toBe(result.lease);
    expect(authority.lifecycle).toBe("active");
  });

  it("does not create authority when the operator denies approval", async () => {
    const authority = makeAuthority(() => ({ status: "denied" }));

    await expect(authority.issue(request)).resolves.toEqual({ status: "denied", reason: "approval-denied" });
    expect(authority.currentLease).toBeUndefined();
    expect(authority.lifecycle).toBe("open");
  });

  it("prevents concurrent issuance and ignores approval that arrives after session close", async () => {
    let resolveApproval!: (decision: AttendedTrustedExecutionLeaseApprovalDecision) => void;
    const approval = new Promise<AttendedTrustedExecutionLeaseApprovalDecision>((resolve) => {
      resolveApproval = resolve;
    });
    const authority = makeAuthority(() => approval);

    const first = authority.issue(request);
    await expect(authority.issue(request)).resolves.toEqual({ status: "denied", reason: "approval-pending" });
    authority.closeSession();
    resolveApproval({ status: "approved", authorizedBy: "Late operator response" });

    await expect(first).resolves.toEqual({ status: "denied", reason: "session-closed" });
    expect(authority.currentLease).toBeUndefined();
    expect(authority.lifecycle).toBe("session-closed");
  });

  it("fails closed when composition changes while approval is pending", async () => {
    let resolveApproval!: (decision: AttendedTrustedExecutionLeaseApprovalDecision) => void;
    const approval = new Promise<AttendedTrustedExecutionLeaseApprovalDecision>((resolve) => {
      resolveApproval = resolve;
    });
    const authority = makeAuthority(() => approval);

    const pending = authority.issue(request);
    authority.onCompositionRevisionChange(SHA_B);
    resolveApproval({ status: "approved" });

    await expect(pending).resolves.toEqual({ status: "denied", reason: "composition-revision-changed" });
    expect(authority.currentLease).toBeUndefined();
    expect(authority.lifecycle).toBe("composition-revision-changed");
  });

  it("does not activate a late approval after explicit revocation", async () => {
    let resolveApproval!: (decision: AttendedTrustedExecutionLeaseApprovalDecision) => void;
    const approval = new Promise<AttendedTrustedExecutionLeaseApprovalDecision>((resolve) => {
      resolveApproval = resolve;
    });
    const authority = makeAuthority(() => approval);

    const pending = authority.issue(request);
    authority.revoke();
    resolveApproval({ status: "approved" });

    await expect(pending).resolves.toEqual({ status: "denied", reason: "revoked" });
    expect(authority.currentLease).toBeUndefined();
    expect(authority.lifecycle).toBe("revoked");
  });

  it("uses the Core evaluator for exact use matching and terminal lifecycle", async () => {
    const authority = makeAuthority(() => ({ status: "approved" }));
    const issued = await authority.issue(request);
    expect(issued.status).toBe("issued");
    expect(authority.evaluateUse(useInput())).toEqual({ matches: true, status: "active" });
    expect(authority.evaluateUse(useInput({ toolName: "workspace.delete" }))).toMatchObject({
      matches: false,
      reason: "tool-not-approved",
    });
    expect(authority.evaluateUse(useInput({ localPrincipalId: "forged" }))).toMatchObject({
      matches: false,
      reason: "malformed-context",
    });

    authority.completeInvocation();
    expect(authority.currentLease?.status).toEqual({ kind: "completed", at: "2026-08-24T00:00:00.000Z" });
    expect(authority.evaluateUse(useInput())).toEqual({ matches: false, status: "completed", reason: "completed" });
  });

  it("terminalizes fail closed when the wall clock moves backwards", async () => {
    let now = "2026-08-24T00:00:00.000Z";
    const authority = makeAuthority(
      () => ({ status: "approved" }),
      () => now,
    );
    await expect(authority.issue(request)).resolves.toMatchObject({ status: "issued" });

    now = "2026-08-23T23:59:59.000Z";
    expect(() => authority.closeSession()).not.toThrow();
    expect(authority.lifecycle).toBe("session-closed");
    expect(authority.currentLease?.status).toEqual({
      kind: "session-closed",
      at: "2026-08-24T00:00:00.000Z",
    });
    expect(authority.evaluateUse(useInput())).toEqual({
      matches: false,
      status: "session-closed",
      reason: "session-closed",
    });
  });

  it("latches observed expiry so a later clock rollback cannot reactivate the lease", async () => {
    const authority = makeAuthority(() => ({ status: "approved" }));
    await expect(authority.issue(request)).resolves.toMatchObject({ status: "issued" });

    expect(authority.evaluateUse(useInput({ now: "2026-08-24T01:00:00.000Z" }))).toEqual({
      matches: false,
      status: "revoked",
      reason: "expired",
    });
    expect(authority.lifecycle).toBe("revoked");
    expect(authority.evaluateUse(useInput({ now: "2026-08-24T00:30:00.000Z" }))).toEqual({
      matches: false,
      status: "revoked",
      reason: "revoked",
    });
  });

  it("revokes an active lease and cannot issue another lease for the tree", async () => {
    const authority = makeAuthority(() => ({ status: "approved" }));
    const issued = await authority.issue(request);
    expect(issued.status).toBe("issued");

    authority.revoke();
    expect(authority.currentLease?.status).toEqual({ kind: "revoked", at: "2026-08-24T00:00:00.000Z" });
    expect(authority.evaluateUse(useInput())).toEqual({ matches: false, status: "revoked", reason: "revoked" });
    await expect(authority.issue(request)).resolves.toEqual({ status: "denied", reason: "revoked" });
    expect(authority).not.toHaveProperty("renew");
    expect(authority).not.toHaveProperty("issueChild");
  });

  it("rejects a lifetime outside the hard one-hour cap before asking for approval", async () => {
    let approvals = 0;
    const authority = makeAuthority(() => {
      approvals += 1;
      return { status: "approved" };
    });

    await expect(
      authority.issue({ ...request, durationMs: TRUSTED_EXECUTION_LEASE_MAX_DURATION_MS + 1 }),
    ).resolves.toEqual({
      status: "denied",
      reason: "invalid-request",
    });
    await expect(authority.issue({ ...request, durationMs: 0 })).resolves.toEqual({
      status: "denied",
      reason: "invalid-request",
    });
    expect(approvals).toBe(0);
  });
});
