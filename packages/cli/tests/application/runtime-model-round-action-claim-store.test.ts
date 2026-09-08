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
      capabilityParticipation: { status: "not-requested" },
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

  it("gates old-schema migration on ownership and preserves fenced rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-round-legacy-owner-"));
    const path = join(root, "claims.sqlite");
    const now = "2026-01-01T00:00:00.000Z";
    const original = claim({ attemptId: "attempt-legacy-owner" });
    const db = new Database(path, { create: true, strict: true });
    try {
      db.exec(`
        CREATE TABLE runtime_action_claim_store_owner (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          owner_id TEXT NOT NULL,
          owner_generation TEXT NOT NULL,
          heartbeat INTEGER NOT NULL
        );
        INSERT INTO runtime_action_claim_store_owner(singleton,owner_id,owner_generation,heartbeat)
          VALUES(1,'live-owner','live-generation',1767225600000);
        CREATE TABLE runtime_model_round_action_claims (
          claim_id TEXT PRIMARY KEY,
          admission_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          attempt_id TEXT NOT NULL,
          round INTEGER NOT NULL CHECK(round >= 0),
          intent_fingerprint TEXT NOT NULL,
          effect_identity TEXT NOT NULL,
          provider_request_id TEXT NOT NULL,
          route_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          credential_revision TEXT NOT NULL,
          permit_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK(status IN ('claimed','settled','unknown')),
          claimed_at TEXT NOT NULL,
          settled_at TEXT,
          outcome TEXT CHECK(outcome IS NULL OR outcome IN ('success','unknown')),
          unknown_reason TEXT,
          UNIQUE(admission_id, attempt_id, round, intent_fingerprint, effect_identity)
        );
        CREATE UNIQUE INDEX runtime_model_round_action_claims_slot
          ON runtime_model_round_action_claims(admission_id, attempt_id, round);
        CREATE INDEX runtime_model_round_action_claims_permit
          ON runtime_model_round_action_claims(permit_id);
      `);
      db.query(`
        INSERT INTO runtime_model_round_action_claims(
          claim_id,admission_id,session_id,turn_id,attempt_id,round,intent_fingerprint,effect_identity,
          provider_request_id,route_id,account_id,credential_revision,permit_id,status,claimed_at,
          settled_at,outcome,unknown_reason
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'claimed',?,NULL,NULL,NULL)
      `).run(
        original.claimId,
        original.admissionId,
        original.sessionId,
        original.turnId,
        original.attemptId,
        original.round,
        original.intentFingerprint,
        original.effectIdentity,
        original.providerRequestId,
        original.routeId,
        original.accountId,
        original.credentialRevision,
        "legacy-permit",
        original.claimedAt ?? now,
      );
      const before = db.query<{ status: string; outcome: string | null }, [string]>(
        "SELECT status,outcome FROM runtime_model_round_action_claims WHERE claim_id=?",
      ).get(original.claimId);
      expect(() => new SqliteRuntimeModelRoundActionClaimStore({
        path,
        now: () => now,
        ownerId: "new-owner",
      })).toThrow(/live owner/iu);
      const blockedSchema = db.query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='runtime_model_round_action_claims'",
      ).get();
      const blockedRow = db.query<{ status: string; outcome: string | null }, [string]>(
        "SELECT status,outcome FROM runtime_model_round_action_claims WHERE claim_id=?",
      ).get(original.claimId);
      expect(blockedSchema?.sql).not.toContain("not_dispatched");
      expect(blockedRow).toEqual(before);
      expect(blockedRow).toEqual({ status: "claimed", outcome: null });

      db.query("UPDATE runtime_action_claim_store_owner SET heartbeat=0 WHERE singleton=1").run();
      const successor = new SqliteRuntimeModelRoundActionClaimStore({ path, now: () => now, ownerId: "successor-owner" });
      const recovered = successor.read(original.claimId);
      expect(recovered).toMatchObject({
        claimId: original.claimId,
        admissionId: original.admissionId,
        attemptId: original.attemptId,
        round: original.round,
        intentFingerprint: original.intentFingerprint,
        effectIdentity: original.effectIdentity,
        providerRequestId: original.providerRequestId,
        status: "unknown",
        unknownReason: "process-restarted-before-settlement",
      });
      const migratedRow = db.query<{ permit_id: string; status: string; outcome: string; unknown_reason: string }, [string]>(
        "SELECT permit_id,status,outcome,unknown_reason FROM runtime_model_round_action_claims WHERE claim_id=?",
      ).get(original.claimId);
      const migratedSchema = db.query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='runtime_model_round_action_claims'",
      ).get();
      expect(migratedSchema?.sql).toContain("not_dispatched");
      expect(migratedRow).toMatchObject({
        permit_id: "legacy-permit",
        status: "unknown",
        outcome: "unknown",
        unknown_reason: "process-restarted-before-settlement",
      });

      const budgetClaim = claim({ attemptId: "attempt-budget-after-migration" });
      const budgetPermit = successor.claim(budgetClaim);
      budgetPermit.consume();
      successor.settle(budgetPermit, { kind: "not_dispatched", settledAt: "2026-01-01T00:00:01.000Z" });
      expect(successor.read(budgetClaim.claimId)).toMatchObject({ status: "settled", outcome: "not_dispatched" });
      successor.close();

      const reopened = new SqliteRuntimeModelRoundActionClaimStore({ path, now: () => now, ownerId: "reopened-owner" });
      expect(reopened.read(original.claimId)).toMatchObject({ status: "unknown", unknownReason: "process-restarted-before-settlement" });
      expect(reopened.read(budgetClaim.claimId)).toMatchObject({ status: "settled", outcome: "not_dispatched" });
      expect(() => reopened.claim(original)).toThrow(/already exists|unknown/iu);
      expect(() => reopened.claim(budgetClaim)).toThrow(/already exists|settled/iu);
      reopened.close();
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists a fenced not-dispatched settlement after transport consumption", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-runtime-round-budget-denied-"));
    const path = join(root, "claims.sqlite");
    try {
      const store = new SqliteRuntimeModelRoundActionClaimStore(options(path));
      const original = claim({ attemptId: "attempt-budget-denied" });
      const permit = store.claim(original);
      permit.consume();
      store.settle(permit, { kind: "not_dispatched", settledAt: "2026-01-01T00:00:01.000Z" });
      expect(store.read(original.claimId)).toMatchObject({ status: "settled", outcome: "not_dispatched" });
      expect(() => store.claim(original)).toThrow(/already exists|settled/iu);
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
