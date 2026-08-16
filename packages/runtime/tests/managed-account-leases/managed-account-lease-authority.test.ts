import { afterEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";

const roots: string[] = [];

const usageEvidence = '{"health":"healthy","freshness":"missing"}';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("managed authority lease schema", () => {
  it("releases a claimed owner generation when schema setup fails", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-lease-broken-schema-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const broken = new Database(path, { create: true, strict: true });
    broken.exec(`
      CREATE TABLE runtime_owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner_id TEXT NOT NULL,
        heartbeat INTEGER NOT NULL, owner_generation TEXT
      );
      CREATE TABLE account_leases (lease_id TEXT PRIMARY KEY);
      INSERT INTO account_leases VALUES('broken-row');
      PRAGMA user_version=1;
    `);
    broken.close();

    let firstError: unknown;
    let secondError: unknown;
    try { new SqliteManagedAccountLeaseAuthority({ path, ownerId: "first-owner" }); } catch (error) { firstError = error; }
    try { new SqliteManagedAccountLeaseAuthority({ path, ownerId: "second-owner" }); } catch (error) { secondError = error; }
    expect(firstError).toBeInstanceOf(Error);
    expect(secondError).toBeInstanceOf(Error);
    expect((secondError as Error).message).not.toContain("already has a live owner");
  });

  it("reopens the current schema repeatedly without rewriting native economic identity evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-lease-current-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    new SqliteManagedAccountLeaseAuthority({ path, ownerId: "schema-owner" }).close();
    const db = new Database(path, { strict: true });
    db.query(`INSERT INTO account_leases(
      lease_id,account_policy_id,account_ref,capacity_identity,provider_id,model_id,route_scope,
      job_id,runtime_invocation_id,economic_attempt_id,commitment_id,credential_revision_id,
      owner_id,acquired_at,lifecycle_state,released_at,selection_reason,candidate_rejections,
      usage_evidence,affinity_outcome,purpose,resource_uris,diagnostic_uris,
      participant_kind,recovery_domain,owner_generation
    ) VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?,?,?, ?,?,?,?,?,NULL,?,?,?,?,?,?)`).run(
      "native-economic", "native-policy", "configured:native", "native-capacity", "provider", "model",
      "economic:native", "native-job", "economic-attempt:native", "native-commitment", "d".repeat(64),
      "historical-owner", "2026-07-30T00:00:00.000Z", "released", "2026-07-30T00:01:00.000Z",
      "least-pressure", "[]", usageEvidence, "new", "[]", "[]",
      "agent-task-runtime", "agent-tasks", "historical-generation",
    );
    db.close();

    for (const ownerId of ["first-reopen", "second-reopen"]) {
      new SqliteManagedAccountLeaseAuthority({ path, ownerId }).close();
    }
    const current = new Database(path, { strict: true });
    expect(current.query<Record<string, unknown>, []>(
      "SELECT job_id,runtime_invocation_id,economic_attempt_id,commitment_id,lifecycle_state,released_at FROM account_leases WHERE lease_id='native-economic'",
    ).get()).toEqual({
      job_id: "native-job",
      runtime_invocation_id: null,
      economic_attempt_id: "economic-attempt:native",
      commitment_id: "native-commitment",
      lifecycle_state: "released",
      released_at: "2026-07-30T00:01:00.000Z",
    });
    current.close();
  });

  it("converges an identified pre-identity lease store onto mandatory participant identity", () => {
    const path = preIdentityStore("kiln-lease-converge-", {
      participantKind: "model-gateway-ingress",
      recoveryDomain: "model-gateway",
      ownerGeneration: "historical-generation",
    });

    new SqliteManagedAccountLeaseAuthority({ path, ownerId: "converging-owner" }).close();

    const db = new Database(path, { readonly: true, strict: true });
    expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()).toEqual({ user_version: 6 });
    expect(
      db
        .query<{ name: string; notnull: number }, []>("PRAGMA table_info(account_leases)")
        .all()
        .filter((column) => ["participant_kind", "recovery_domain", "owner_generation"].includes(column.name))
        .map((column) => [column.name, column.notnull]),
    ).toEqual([
      ["participant_kind", 1],
      ["recovery_domain", 1],
      ["owner_generation", 1],
    ]);
    expect(
      db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='account_leases' AND sql IS NOT NULL",
        )
        .all()
        .map((index) => index.name)
        .sort(),
    ).toEqual(["account_leases_capacity_state", "account_leases_runtime_invocation"]);
    expect(
      db
        .query<Record<string, unknown>, []>(
          "SELECT lease_id,participant_kind,recovery_domain,owner_generation,lifecycle_state FROM account_leases",
        )
        .all(),
    ).toEqual([
      {
        lease_id: "carried-lease",
        participant_kind: "model-gateway-ingress",
        recovery_domain: "model-gateway",
        owner_generation: "historical-generation",
        lifecycle_state: "released",
      },
    ]);
    expect(db.query<{ present: number }, []>(
      "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='account_leases_pre_identity'",
    ).get()).toBeNull();
    db.close();
  });

  it("refuses to converge a lease whose writing participant is unattributable", () => {
    const path = preIdentityStore("kiln-lease-unattributable-", {
      participantKind: null,
      recoveryDomain: null,
      ownerGeneration: null,
    });

    for (const ownerId of ["first-owner", "second-owner"]) {
      expect(() => new SqliteManagedAccountLeaseAuthority({ path, ownerId })).toThrow("unattributable");
    }

    const db = new Database(path, { readonly: true, strict: true });
    expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()).toEqual({ user_version: 5 });
    expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM account_leases").get())
      .toEqual({ count: 1 });
    db.close();
  });
});

/** Writes a lease store in the pre-identity shape: nullable identity columns at user_version 5. */
function preIdentityStore(
  prefix: string,
  identity: {
    readonly participantKind: string | null;
    readonly recoveryDomain: string | null;
    readonly ownerGeneration: string | null;
  },
): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  const path = join(root, "authority.sqlite");
  const db = new Database(path, { create: true, strict: true });
  db.exec(`
    CREATE TABLE account_leases (
      lease_id TEXT PRIMARY KEY, account_policy_id TEXT NOT NULL, account_ref TEXT NOT NULL,
      capacity_identity TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
      route_scope TEXT NOT NULL, job_id TEXT NOT NULL, runtime_invocation_id TEXT,
      economic_attempt_id TEXT, commitment_id TEXT,
      credential_revision_id TEXT NOT NULL, owner_id TEXT NOT NULL, acquired_at TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL, released_at TEXT, selection_reason TEXT NOT NULL,
      candidate_rejections TEXT NOT NULL, usage_evidence TEXT NOT NULL DEFAULT '${usageEvidence}',
      affinity_outcome TEXT, purpose TEXT NOT NULL, resource_uris TEXT NOT NULL,
      diagnostic_uris TEXT NOT NULL, affinity_key TEXT,
      affinity_expected_capacity_identity TEXT, affinity_commit_outcome TEXT,
      participant_kind TEXT, recovery_domain TEXT, owner_generation TEXT,
      dispatch_fence_id TEXT, settlement_json TEXT, intent_fingerprint TEXT,
      configuration_revision TEXT
    );
    CREATE UNIQUE INDEX account_leases_runtime_invocation
    ON account_leases(runtime_invocation_id) WHERE runtime_invocation_id IS NOT NULL;
    CREATE INDEX account_leases_capacity_state ON account_leases(capacity_identity, lifecycle_state);
    PRAGMA user_version=5;
  `);
  db.query(`INSERT INTO account_leases(
    lease_id,account_policy_id,account_ref,capacity_identity,provider_id,model_id,route_scope,
    job_id,runtime_invocation_id,economic_attempt_id,commitment_id,credential_revision_id,
    owner_id,acquired_at,lifecycle_state,released_at,selection_reason,candidate_rejections,
    usage_evidence,affinity_outcome,purpose,resource_uris,diagnostic_uris,
    participant_kind,recovery_domain,owner_generation
  ) VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?)`).run(
    "carried-lease", "carried-policy", "configured:carried", "carried-capacity", "provider", "model",
    "gateway:carried", "carried-job", "carried-invocation", "e".repeat(64),
    "historical-owner", "2026-07-30T00:00:00.000Z", "released", "2026-07-30T00:01:00.000Z",
    "least-pressure", "[]", usageEvidence, "new", "[]", "[]",
    identity.participantKind, identity.recoveryDomain, identity.ownerGeneration,
  );
  db.close();
  return path;
}
