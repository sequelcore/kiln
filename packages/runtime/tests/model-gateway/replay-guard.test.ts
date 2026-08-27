import { describe, expect, it } from "vitest";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import { InMemoryModelGatewayReplayGuard } from "../../src/model-gateway/replay-guard.js";

const fingerprintInput = (overrides: Record<string, unknown> = {}) => ({
  rawBody: '{"input":"hello"}', ingress: "openai-responses", tenantId: "tenant-a", applicationId: "app-a",
  callerId: "caller-a", sessionId: "ns-session", turnId: "ns-turn",
  route: { providerId: "provider", providerModelId: "model", scope: "scope" },
  toolExecutionMode: "caller-owned", affinityKey: "affinity-a", ...overrides,
});

function bundle() {
  const revision = { revisionSetId: "replay-guard-test", revisions: { modelGateway: ("sha256:" + "a".repeat(64)) as `sha256:${string}` } } as const;
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "ns-session", turnId: "ns-turn", admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: { skillCatalog: { catalogId: "replay", revision: ("sha256:" + "b".repeat(64)) as `sha256:${string}`, skillIds: [] }, authorityCeiling: { maximumAuthority: "read_only", reason: "fixture" } },
    turn: {
      authority: { executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "read_only", sourcePolicy: "runtime_surface_projection", reason: "fixture", completeness: "authoritative", toolCount: 0, deniedToolCount: 0 },
      workGovernance: { status: "not-required" }, operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [], deniedToolNames: [], callerOwnedToolContract: { names: [], digest: ("sha256:" + "c".repeat(64)) as `sha256:${string}` } },
      effectCeiling: { operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" },
      budget: { status: "not-configured" },
      execution: { status: "routed", target: { targetId: "route", providerId: "provider", providerModelId: "model", accountSelection: { kind: "operator-override", accountPolicyId: "policy", accountId: "account" } }, dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } }, binding: { status: "bound", routeId: "route", accountId: "account", credentialId: "credential", credentialRevision: "d".repeat(64) } },
    },
  });
}

describe("InMemoryModelGatewayReplayGuard", () => {
  it("distinguishes every trusted replay dimension and exact raw body", () => {
    const guard = new InMemoryModelGatewayReplayGuard({ hmacKey: "synthetic-test-key-with-32-bytes!!" });
    const original = guard.fingerprint(fingerprintInput());
    for (const changed of [
      { rawBody: '{ "input":"hello"}' }, { tenantId: "tenant-b" }, { applicationId: "app-b" }, { callerId: "caller-b" },
      { sessionId: "other-session" }, { turnId: "other-turn" }, { route: { providerId: "provider", providerModelId: "other", scope: "scope" } },
      { affinityKey: "affinity-b" },
    ]) expect(guard.fingerprint(fingerprintInput(changed))).not.toBe(original);
  });

  it("binds an attempt to an admission and one exact action, retaining the tombstone after payload expiry", () => {
    let now = 100;
    const guard = new InMemoryModelGatewayReplayGuard({ hmacKey: "synthetic-test-key-with-32-bytes!!", now: () => now, ttlMs: 1_000, createFence: (() => { let id = 0; return () => `f-${++id}`; })() });
    const key = guard.fingerprint(fingerprintInput());
    const first = guard.claim(key);
    expect(first.kind).toBe("dispatch");
    if (first.kind !== "dispatch") throw new Error("fixture");
    expect(first.attemptId).toMatch(/^attempt-/);
    const admitted = guard.persistAdmission(first.key, first.fence, bundle());
    const permit = guard.claimAction(first.key, first.fence, { admissionId: admitted.admissionId, effectIdentity: "model-round:test" });
    permit.consume();
    expect(() => permit.consume()).toThrow("already been consumed");
    expect(() => guard.claimAction(first.key, first.fence, { admissionId: admitted.admissionId, effectIdentity: "model-round:test" })).toThrow("current phase");
    guard.complete(first.key, first.fence, { responseId: "resp-1", result: { parts: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "completed" } });
    expect(guard.claim(key)).toMatchObject({ kind: "replay-completed" });
    now = 2_000;
    expect(guard.claim(key)).toEqual({ kind: "committed-unknown" });
  });

  it("allows only pre-action abandonment and rejects stale fences", () => {
    const guard = new InMemoryModelGatewayReplayGuard({ hmacKey: "capacity-test-key-with-32-bytes!!" });
    const key = guard.fingerprint(fingerprintInput());
    const claim = guard.claim(key);
    if (claim.kind !== "dispatch") throw new Error("fixture");
    expect(() => guard.persistAdmission(key, claim.fence + "-stale" as never, bundle())).toThrow("Stale replay fence");
    expect(() => guard.claimAction(key, claim.fence, { admissionId: "sha256:" + "a".repeat(64) as `sha256:${string}`, effectIdentity: "model-round:test" })).toThrow("current phase");
    expect(guard.abandon(key, claim.fence)).toBeUndefined();
  });

  it("bounds admitted pre-action state without expiring the action tombstone", () => {
    let now = 100;
    const guard = new InMemoryModelGatewayReplayGuard({ hmacKey: "admitted-expiry-test-key-with-32-bytes", now: () => now, ttlMs: 1_000 });
    const key = guard.fingerprint(fingerprintInput({ rawBody: "admitted-expiry" }));
    const claim = guard.claim(key);
    if (claim.kind !== "dispatch") throw new Error("Expected a dispatch claim.");
    guard.persistAdmission(claim.key, claim.fence, bundle());
    now = 1_101;
    expect(guard.claim(key).kind).toBe("dispatch");
  });

  it("does not let retained terminal tombstones consume pre-action capacity", () => {
    const guard = new InMemoryModelGatewayReplayGuard({
      hmacKey: "terminal-capacity-test-key-32-bytes",
      maxEntries: 1,
    });
    const firstKey = guard.fingerprint(fingerprintInput({ rawBody: "first" }));
    const first = guard.claim(firstKey);
    if (first.kind !== "dispatch") throw new Error("Expected the first dispatch claim.");
    const admitted = guard.persistAdmission(first.key, first.fence, bundle());
    guard.claimAction(first.key, first.fence, {
      admissionId: admitted.admissionId,
      effectIdentity: "model-round:first",
    }).consume();
    guard.settleUnknown(first.key, first.fence);

    const secondKey = guard.fingerprint(fingerprintInput({ rawBody: "second" }));
    expect(guard.claim(secondKey).kind).toBe("dispatch");
    expect(guard.claim(firstKey)).toEqual({ kind: "committed-unknown" });
  });
});
