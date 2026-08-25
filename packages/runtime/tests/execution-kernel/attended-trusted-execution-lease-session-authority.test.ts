import type { ActionEffectEnvelope } from "@kilnai/core/engine";
import { describe, expect, it } from "vitest";
import type {
  AttendedTrustedExecutionLeaseApprovalBinding,
  AttendedTrustedExecutionLeaseApprovalDecision,
  AttendedTrustedExecutionLeaseIssueRequest,
} from "../../src/execution-kernel/attended-trusted-execution-lease-authority.js";
import {
  AttendedTrustedExecutionLeaseSessionAuthority,
  AttendedTrustedExecutionLeaseSessionAuthorityError,
} from "../../src/execution-kernel/attended-trusted-execution-lease-session-authority.js";

const SHA_A = `sha256:${"a".repeat(64)}` as const;
const SHA_B = `sha256:${"b".repeat(64)}` as const;
const PROJECT_RUNTIME_ID = `krp_${"1".repeat(64)}` as const;
const EFFECT_CEILING = {
  operation: "mutate",
  boundaries: ["workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "idempotent",
} as const satisfies ActionEffectEnvelope;

const issueRequest = {
  harness: "codex",
  routeId: "native-foreground",
  profileCeiling: "workspace-write",
  allowedToolNames: ["workspace.read", "workspace.write"],
  effectCeiling: EFFECT_CEILING,
  policyDigest: SHA_A,
  enforcementRevision: "enforcement-1",
  durationMs: 60 * 60 * 1000,
} satisfies AttendedTrustedExecutionLeaseIssueRequest;

function makeSession(
  approve: (
    binding: AttendedTrustedExecutionLeaseApprovalBinding,
  ) => AttendedTrustedExecutionLeaseApprovalDecision | Promise<AttendedTrustedExecutionLeaseApprovalDecision> = () => ({
    status: "approved",
  }),
  now: () => string = () => "2026-08-24T00:00:00.000Z",
): AttendedTrustedExecutionLeaseSessionAuthority {
  return new AttendedTrustedExecutionLeaseSessionAuthority({
    binding: {
      localPrincipalId: "process-principal:1",
      operatorSessionId: "operator-session-1",
      projectRuntimeId: PROJECT_RUNTIME_ID,
      compositionRevision: SHA_A,
    },
    approvalPort: { approve },
    now,
  });
}

describe("AttendedTrustedExecutionLeaseSessionAuthority", () => {
  it("creates one fixed-tree child and rejects a duplicate tree", () => {
    const session = makeSession();
    const first = session.createInvocationTreeAuthority("invocation-tree-1");

    expect(first.binding).toMatchObject({
      localPrincipalId: "process-principal:1",
      operatorSessionId: "operator-session-1",
      invocationTreeId: "invocation-tree-1",
      projectRuntimeId: PROJECT_RUNTIME_ID,
      compositionRevision: SHA_A,
    });
    expect(() => session.createInvocationTreeAuthority("invocation-tree-1")).toThrowError(
      expect.objectContaining({ code: "duplicate-invocation-tree" }),
    );
    expect(session.lifecycle).toBe("open");
  });

  it("shares the typed approval port while keeping each tree binding exact", async () => {
    const observedTrees: string[] = [];
    const session = makeSession((binding) => {
      observedTrees.push(binding.invocationTreeId);
      return { status: "approved" };
    });
    const first = session.createInvocationTreeAuthority("invocation-tree-1");
    const second = session.createInvocationTreeAuthority("invocation-tree-2");

    await expect(first.issue(issueRequest)).resolves.toMatchObject({ status: "issued" });
    await expect(second.issue(issueRequest)).resolves.toMatchObject({ status: "issued" });
    expect(observedTrees).toEqual(["invocation-tree-1", "invocation-tree-2"]);
    expect(first.currentLease?.invocationTreeId).toBe("invocation-tree-1");
    expect(second.currentLease?.invocationTreeId).toBe("invocation-tree-2");
  });

  it("closes every child and rejects future tree creation", async () => {
    const session = makeSession();
    const first = session.createInvocationTreeAuthority("invocation-tree-1");
    const second = session.createInvocationTreeAuthority("invocation-tree-2");
    await first.issue(issueRequest);
    await second.issue(issueRequest);

    session.closeSession();

    expect(session.lifecycle).toBe("session-closed");
    expect(first.lifecycle).toBe("session-closed");
    expect(second.lifecycle).toBe("session-closed");
    expect(first.currentLease?.status).toEqual({ kind: "session-closed", at: "2026-08-24T00:00:00.000Z" });
    expect(second.currentLease?.status).toEqual({ kind: "session-closed", at: "2026-08-24T00:00:00.000Z" });
    expect(() => session.createInvocationTreeAuthority("invocation-tree-3")).toThrowError(
      expect.objectContaining({ code: "session-closed" }),
    );
  });

  it("closes every active child despite a backwards wall clock and remains retryable", async () => {
    let now = "2026-08-24T00:00:00.000Z";
    const session = makeSession(undefined, () => now);
    const child = session.createInvocationTreeAuthority("invocation-tree-rollback");
    await expect(child.issue(issueRequest)).resolves.toMatchObject({ status: "issued" });

    now = "2026-08-23T23:59:59.000Z";
    expect(() => session.closeSession()).not.toThrow();
    expect(() => session.closeSession()).not.toThrow();
    expect(session.lifecycle).toBe("session-closed");
    expect(child.lifecycle).toBe("session-closed");
    expect(child.currentLease?.status).toEqual({
      kind: "session-closed",
      at: "2026-08-24T00:00:00.000Z",
    });
  });

  it("revokes every child and rejects future tree creation", async () => {
    const session = makeSession();
    const first = session.createInvocationTreeAuthority("invocation-tree-1");
    const second = session.createInvocationTreeAuthority("invocation-tree-2");
    await first.issue(issueRequest);
    await second.issue(issueRequest);

    session.revoke();

    expect(session.lifecycle).toBe("revoked");
    expect(first.currentLease?.status).toEqual({ kind: "revoked", at: "2026-08-24T00:00:00.000Z" });
    expect(second.currentLease?.status).toEqual({ kind: "revoked", at: "2026-08-24T00:00:00.000Z" });
    expect(() => session.createInvocationTreeAuthority("invocation-tree-3")).toThrowError(
      expect.objectContaining({ code: "revoked" }),
    );
  });

  it("fans out composition invalidation and prevents a late child approval", async () => {
    let resolveApproval!: (decision: AttendedTrustedExecutionLeaseApprovalDecision) => void;
    const approval = new Promise<AttendedTrustedExecutionLeaseApprovalDecision>((resolve) => {
      resolveApproval = resolve;
    });
    const session = makeSession(() => approval);
    const pending = session.createInvocationTreeAuthority("invocation-tree-1");
    const active = session.createInvocationTreeAuthority("invocation-tree-2");
    const pendingIssue = pending.issue(issueRequest);
    const activeIssue = active.issue(issueRequest);
    // The shared approval resolves only after the owner has invalidated the
    // composition, so neither pending child may activate.
    session.onCompositionRevisionChange(SHA_B);
    resolveApproval({ status: "approved" });

    await expect(pendingIssue).resolves.toMatchObject({ status: "denied", reason: "composition-revision-changed" });
    await expect(activeIssue).resolves.toMatchObject({ status: "denied", reason: "composition-revision-changed" });
    expect(session.lifecycle).toBe("composition-revision-changed");
    expect(pending.lifecycle).toBe("composition-revision-changed");
    expect(active.lifecycle).toBe("composition-revision-changed");
    expect(pending.binding.compositionRevision).toBe(SHA_B);
    expect(() => session.createInvocationTreeAuthority("invocation-tree-3")).toThrowError(
      expect.objectContaining({ code: "composition-revision-changed" }),
    );
  });

  it("keeps its state process-local without a serialization or persistence surface", () => {
    const session = makeSession();
    session.createInvocationTreeAuthority("invocation-tree-1");

    expect(Object.keys(session)).toEqual([]);
    expect("toJSON" in session).toBe(false);
    expect("serialize" in session).toBe(false);
    expect("persist" in session).toBe(false);
    expect(JSON.stringify(session)).toBe("{}");
  });

  it("exposes typed lifecycle errors for malformed tree ids and terminal owners", () => {
    const session = makeSession();

    expect(() => session.createInvocationTreeAuthority(" bad tree ")).toThrowError(
      expect.objectContaining({ code: "invalid-invocation-tree" }),
    );
    session.closeSession();
    try {
      session.createInvocationTreeAuthority("invocation-tree-1");
      throw new Error("expected session creation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AttendedTrustedExecutionLeaseSessionAuthorityError);
      expect((error as AttendedTrustedExecutionLeaseSessionAuthorityError).code).toBe("session-closed");
    }
  });
});
