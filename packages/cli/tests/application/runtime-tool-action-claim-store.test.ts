import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import {
  defineEffectiveAuthorityAdmissionBundle,
  defineRuntimeToolActionClaim,
  type RuntimeToolActionClaim,
  type RuntimeToolActionClaimPermit,
} from "@kilnai/runtime";
import { SqliteRuntimeToolActionClaimStore } from "../../src/application/runtime-tool-action-claim-store.js";

const effect = {
  operation: "mutate" as const,
  boundaries: ["workspace"] as const,
  reversibility: "reversible" as const,
  dataEgress: "none" as const,
  identityUse: "none" as const,
  consequences: ["local-state"] as const,
  idempotency: "idempotent" as const,
};

function admission() {
  const revision = { revisionSetId: "runtime-tool-store-test", revisions: { test: "runtime-tool-store-test" } } as const;
  const turnId = canonicalTurnId("session-1", 1);
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: "session-1", turnId, admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "test", revision: "test", skillIds: [] },
      authorityCeiling: { maximumAuthority: "destructive", reason: "test", subjectId: "session-1" },
    },
    turn: {
      authority: {
        executionMode: "execute", requestedAuthority: "destructive", admittedAuthority: "destructive",
        sourcePolicy: "runtime_surface_projection", reason: "test", completeness: "authoritative",
        toolCount: 0, deniedToolCount: 0, sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: {
        status: "admitted",
        decision: createOperatorAdoptionDecisionAuthority({ ownerSessionId: "session-1", operatorTurnId: turnId, actorId: "user-1" }),
      },
      tools: { allowedToolPermissions: [], deniedToolNames: [] }, effectCeiling: effect,
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        route: { routeId: "route-1", providerId: "provider-1", providerModelId: "model-1", accountSelection: { mode: "exact", accountId: "account-1", source: "route" } },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: { status: "bound", routeId: "route-1", accountId: "account-1", credentialId: "credential-1", credentialRevision: "revision-1" },
      },
    },
  });
}

function claim(overrides: Partial<Pick<RuntimeToolActionClaim, "normalizedInput" | "resolvedEffect" | "adapterIdentity">> = {}): RuntimeToolActionClaim {
  const bundle = admission();
  return defineRuntimeToolActionClaim({
    admission: bundle, sessionId: bundle.sessionId, turnId: bundle.turnId, attemptId: "attempt-1",
    toolCallScopeId: "scope-1", toolCallId: "call-1", selector: "filesystem.write",
    normalizedInput: '{"path":"a.txt","text":"x"}', resolvedEffect: effect,
    adapterIdentity: "operator:builtin:filesystem.write", ...overrides,
  }, "2026-01-01T00:00:00.000Z");
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function open() {
  const dir = mkdtempSync(join(tmpdir(), "kiln-runtime-tool-claim-"));
  dirs.push(dir);
  return new SqliteRuntimeToolActionClaimStore({ path: join(dir, "claims.sqlite"), now: () => "2026-01-01T00:00:00.000Z", idGenerator: () => "permit-1" });
}

describe("SqliteRuntimeToolActionClaimStore", () => {
  it("rejects a project-private claim path redirected through a junction", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiln-runtime-tool-private-root-"));
    dirs.push(dir);
    const privateRoot = join(dir, "private");
    const redirected = join(dir, "redirected");
    mkdirSync(privateRoot, { recursive: true });
    mkdirSync(redirected, { recursive: true });
    try {
      symlinkSync(redirected, join(privateRoot, "runtime"), "junction");
    } catch {
      return;
    }

    expect(() => new SqliteRuntimeToolActionClaimStore({
      path: join(privateRoot, "runtime", "claims.sqlite"),
      privateStateRoot: privateRoot,
    })).toThrow(/unsafe/iu);
    expect(readdirSync(redirected)).toEqual([]);
  });

  it("rejects a fixed-path overlap before invalidating the live owner's permit", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiln-runtime-tool-owner-"));
    dirs.push(dir);
    const path = join(dir, "claims.sqlite");
    const now = () => "2026-01-01T00:00:00.000Z";
    const first = new SqliteRuntimeToolActionClaimStore({ path, ownerId: "first-owner", ownerStaleMs: 30_000, now });
    const original = claim();
    const permit = first.claim(original);
    expect(() => new SqliteRuntimeToolActionClaimStore({
      path,
      ownerId: "second-owner",
      ownerStaleMs: 30_000,
      now,
    })).toThrow(/live owner.*retry in 30 seconds.*do not delete action-claim state/iu);
    expect(first.read(original.claimId)).toMatchObject({ status: "claimed" });
    permit.consume();
    first.settle(permit, { kind: "success" });
    first.close();
  });

  it("rejects a stale owner's permit after fail-closed successor recovery", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiln-runtime-tool-stale-"));
    dirs.push(dir);
    const path = join(dir, "claims.sqlite");
    const now = "2026-01-01T00:00:00.000Z";
    const first = new SqliteRuntimeToolActionClaimStore({ path, now: () => now, ownerId: "first-owner" });
    const original = claim();
    const permit = first.claim(original);
    const inspection = new Database(path, { strict: true });
    inspection.query("UPDATE runtime_action_claim_store_owner SET heartbeat=0").run();
    inspection.close();

    const successor = new SqliteRuntimeToolActionClaimStore({ path, now: () => now, ownerId: "second-owner" });
    expect(successor.read(original.claimId)).toMatchObject({ status: "unknown", unknownReason: "process-restarted-before-settlement" });
    expect(() => permit.consume()).toThrow(/ownership|stale/iu);
    successor.close();
    first.close();
  });

  it("releases ownership before shutdown recovery and invalidates the old permit", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiln-runtime-tool-shutdown-"));
    dirs.push(dir);
    const path = join(dir, "claims.sqlite");
    const first = new SqliteRuntimeToolActionClaimStore({ path });
    const original = claim();
    const permit = first.claim(original);
    first.close();

    const successor = new SqliteRuntimeToolActionClaimStore({ path });
    expect(successor.read(original.claimId)).toMatchObject({ status: "unknown" });
    expect(() => permit.consume()).toThrow(/closed/iu);
    successor.close();
  });

  it("persists a claimed row and reopens it as unknown", () => {
    const first = open();
    const row = claim();
    first.claim(row);
    expect(first.read(row.claimId)?.status).toBe("claimed");
    first.close();

    const directory = dirs.at(-1);
    if (directory === undefined) throw new Error("Expected runtime tool claim fixture directory.");
    const reopened = new SqliteRuntimeToolActionClaimStore({ path: join(directory, "claims.sqlite"), now: () => "2026-01-01T00:00:01.000Z", idGenerator: () => "permit-2" });
    expect(reopened.read(row.claimId)).toMatchObject({ status: "unknown", unknownReason: "process-restarted-before-settlement" });
    expect(reopened.read(row.claimId)?.outcome).toBeUndefined();
    reopened.close();
  });

  it("rejects a duplicate slot and every mutated immutable identity", () => {
    const store = open();
    const original = claim();
    store.claim(original);
    expect(() => store.claim(claim({ normalizedInput: '{"path":"other.txt","text":"x"}' }))).toThrow(/immutable identity mismatch.*normalizedInput/);
    expect(() => store.claim(claim({ resolvedEffect: { ...effect, boundaries: ["network"] } }))).toThrow(/immutable identity mismatch.*resolvedEffect/);
    expect(() => store.claim(claim({ adapterIdentity: "operator:other-adapter" }))).toThrow(/immutable identity mismatch.*adapterIdentity/);
    store.close();
  });

  it("requires the exact consumed permit and rejects forged or double settlement", () => {
    const store = open();
    const row = claim();
    const permit = store.claim(row);
    expect(() => store.settle(permit, { kind: "success" })).toThrow(/consumed exactly/);
    permit.consume();
    store.settle(permit, { kind: "success" });
    expect(store.read(row.claimId)).toMatchObject({ status: "settled", outcome: "success" });
    expect(() => store.settle(permit, { kind: "success" })).toThrow(/Invalid|consumed|Unknown|settled/);
    const forged = { ...permit, consume: () => undefined } as RuntimeToolActionClaimPermit;
    expect(() => store.settle(forged, { kind: "success" })).toThrow(/Invalid|consumed|Unknown/);
    store.close();
  });
});
