import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import {
  defineEffectiveAuthorityAdmissionBundle,
  defineRuntimeModelRoundActionClaim,
  type RuntimeModelRoundActionClaim,
  type RuntimeModelRoundAdmissionReceipt,
  type RuntimeModelRoundDigest,
} from "@kilnai/runtime";
import {
  SqliteRuntimeModelRoundActionClaimStore,
  type RuntimeModelRoundActionClaimStoreOptions,
} from "../../src/application/runtime-model-round-action-claim-store.js";

type ClaimIdentity = Omit<RuntimeModelRoundActionClaim, "claimId" | "admissionId" | "status" | "claimedAt" | "settledAt" | "outcome" | "unknownReason">;

const digest = (letter: string): RuntimeModelRoundDigest => `sha256:${letter.repeat(64)}`;

function admission(): RuntimeModelRoundAdmissionReceipt {
  const revision = { revisionSetId: "runtime-model-round-store-test", revisions: { test: "runtime-model-round-store-test" } } as const;
  const turnId = canonicalTurnId("session-1", 1);
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "session-1", turnId, admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: { skillCatalog: { catalogId: "test", revision: "test", skillIds: [] }, authorityCeiling: { maximumAuthority: "read_only", reason: "test", subjectId: "session-1" } },
    turn: {
      authority: { executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "fail_closed", sourcePolicy: "runtime_surface_projection", reason: "test", completeness: "authoritative", toolCount: 0, deniedToolCount: 0, sandboxProjection: "read_only" },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "admitted", decision: createOperatorAdoptionDecisionAuthority({ ownerSessionId: "session-1", operatorTurnId: turnId, actorId: "user-1" }) },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: { operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" },
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: { targetId: "target-1", providerId: "provider-1", providerModelId: "model-1", accountSelection: { kind: "operator-override", accountPolicyId: "policy-1", accountId: "account-1" } },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: { status: "bound", routeId: "target-1", accountId: "account-1", credentialId: "credential-1", credentialRevision: "revision-1" },
      },
    },
  });
}

function claim(overrides: Partial<ClaimIdentity> = {}): RuntimeModelRoundActionClaim {
  const bundle = admission();
  return defineRuntimeModelRoundActionClaim({
    admission: bundle,
    sessionId: "session-1",
    turnId: bundle.turnId,
    attemptId: "attempt-1",
    round: 0,
    intentFingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    effectIdentity: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    providerRequestId: "request-1",
    routeId: "target-1",
    accountId: "account-1",
    credentialRevision: "revision-1",
    ...overrides,
  }, "2026-01-01T00:00:00.000Z");
}

function options(path: string): RuntimeModelRoundActionClaimStoreOptions {
  return { path };
}

describe("SqliteRuntimeModelRoundActionClaimStore", () => {
  it("rejects a fixed-path overlap before invalidating the live owner's permit", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-round-owner-"));
    const path = join(root, "claims.sqlite");
    try {
      const first = new SqliteRuntimeModelRoundActionClaimStore({ path, ownerId: "first-owner" });
      const original = claim();
      const permit = first.claim(original);
      expect(() => new SqliteRuntimeModelRoundActionClaimStore({ path, ownerId: "second-owner" }))
        .toThrow(/live owner/iu);
      expect(first.read(original.claimId)).toMatchObject({ status: "claimed" });
      permit.consume();
      first.settle(permit, { kind: "success" });
      first.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a stale owner's permit after fail-closed successor recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-round-stale-"));
    const path = join(root, "claims.sqlite");
    const now = "2026-01-01T00:00:00.000Z";
    try {
      const first = new SqliteRuntimeModelRoundActionClaimStore({ path, now: () => now, ownerId: "first-owner" });
      const original = claim();
      const permit = first.claim(original);
      const inspection = new Database(path, { strict: true });
      inspection.query("UPDATE runtime_action_claim_store_owner SET heartbeat=0").run();
      inspection.close();

      const successor = new SqliteRuntimeModelRoundActionClaimStore({ path, now: () => now, ownerId: "second-owner" });
      expect(successor.read(original.claimId)).toMatchObject({ status: "unknown", unknownReason: "process-restarted-before-settlement" });
      expect(() => permit.consume()).toThrow(/ownership|stale/iu);
      successor.close();
      first.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("releases ownership before shutdown recovery and invalidates the old permit", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-round-shutdown-"));
    const path = join(root, "claims.sqlite");
    try {
      const first = new SqliteRuntimeModelRoundActionClaimStore({ path });
      const original = claim();
      const permit = first.claim(original);
      first.close();

      const successor = new SqliteRuntimeModelRoundActionClaimStore({ path });
      expect(successor.read(original.claimId)).toMatchObject({ status: "unknown" });
      expect(() => permit.consume()).toThrow(/closed/iu);
      successor.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists one claim and rejects a second permit after reopening", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-round-"));
    const path = join(root, "claims.sqlite");
    try {
      const first = new SqliteRuntimeModelRoundActionClaimStore(options(path));
      first.claim(claim());
      first.close();

      const reopened = new SqliteRuntimeModelRoundActionClaimStore(options(path));
      expect(() => reopened.claim(claim())).toThrow(/already exists|claimed/iu);
      expect(reopened.read(claim().claimId)).toMatchObject({
        claimId: claim().claimId,
        status: "unknown",
        unknownReason: "process-restarted-before-settlement",
      });
      reopened.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("consumes a permit once and preserves unknown settlement", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-round-"));
    const path = join(root, "claims.sqlite");
    try {
      const store = new SqliteRuntimeModelRoundActionClaimStore(options(path));
      const permit = store.claim(claim());
      expect(() => store.settle(permit, { kind: "unknown", reason: "provider-dispatch-failed", settledAt: "2026-01-01T00:00:01.000Z" })).toThrow(/consumed|boundary/iu);
      permit.consume();
      store.settle(permit, { kind: "unknown", reason: "provider-dispatch-failed", settledAt: "2026-01-01T00:00:01.000Z" });

      expect(store.read(claim().claimId)).toMatchObject({
        status: "unknown",
        unknownReason: "provider-dispatch-failed",
      });
      expect(() => store.settle(permit, { kind: "success" })).toThrow(/permit|settled|unknown/iu);
      expect(() => permit.consume()).toThrow(/already been consumed/iu);
      store.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a forged permit even when its visible identity is copied", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-round-"));
    const path = join(root, "claims.sqlite");
    try {
      const store = new SqliteRuntimeModelRoundActionClaimStore(options(path));
      const permit = store.claim(claim());
      permit.consume();
      const forged = { ...permit, consume: () => undefined };
      expect(() => store.settle(forged, { kind: "success" })).toThrow(/unknown|invalid|boundary/iu);
      store.settle(permit, { kind: "success" });
      store.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("owns one admission/attempt/round slot and rejects mutated immutable identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-round-"));
    const path = join(root, "claims.sqlite");
    try {
      const store = new SqliteRuntimeModelRoundActionClaimStore(options(path));
      store.claim(claim());

      expect(() => store.claim(claim())).toThrow(/already exists|claimed/iu);
      expect(() => store.claim(claim({
        intentFingerprint: digest("d"),
      }))).toThrow(/immutable|already exists|claimed/iu);
      expect(() => store.claim(claim({
        effectIdentity: digest("e"),
      }))).toThrow(/immutable|already exists|claimed/iu);
      expect(() => store.claim(claim({ providerRequestId: "request-mutated" }))).toThrow(/immutable|already exists|claimed/iu);
      expect(() => store.claim(claim({ routeId: "route-mutated" }))).toThrow(/immutable|already exists|claimed/iu);
      expect(() => store.claim(claim({ accountId: "account-mutated" }))).toThrow(/immutable|already exists|claimed/iu);
      expect(() => store.claim(claim({ credentialRevision: "revision-mutated" }))).toThrow(/immutable|already exists|claimed/iu);
      store.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
