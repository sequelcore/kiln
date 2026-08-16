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

describe("managed authority lease history migration", () => {
  it("preserves v0 runtime lease history while adding native economic identity columns", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-lease-history-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const legacy = new Database(path, { create: true, strict: true });
    legacy.exec(`
      CREATE TABLE runtime_owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner_id TEXT NOT NULL, heartbeat INTEGER NOT NULL
      );
      CREATE TABLE account_leases (
        lease_id TEXT PRIMARY KEY, account_policy_id TEXT NOT NULL, account_ref TEXT NOT NULL,
        capacity_identity TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
        route_scope TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE,
        runtime_invocation_id TEXT NOT NULL UNIQUE, credential_revision_id TEXT NOT NULL,
        owner_id TEXT NOT NULL, acquired_at TEXT NOT NULL, lifecycle_state TEXT NOT NULL,
        released_at TEXT, selection_reason TEXT NOT NULL, candidate_rejections TEXT NOT NULL,
        affinity_outcome TEXT, purpose TEXT NOT NULL, resource_uris TEXT NOT NULL,
        diagnostic_uris TEXT NOT NULL
      );
      INSERT INTO account_leases VALUES(
        'legacy-lease', 'managed-codex', 'configured:account-a', 'account-a',
        'codex-oauth', 'gpt-5.6-terra', 'virtual:managed-codex', 'legacy-job',
        'legacy-invocation', '${"a".repeat(64)}', 'legacy-owner',
        '2026-07-28T22:20:00.000Z', 'released', '2026-07-28T22:21:00.000Z',
        'least-pressure', '[]', NULL, 'new',
        '["kiln://managed-accounts/leases/legacy-lease"]', '[]'
      );
      INSERT INTO account_leases VALUES(
        'legacy-active', 'managed-codex', 'configured:account-b', 'account-b',
        'codex-oauth', 'gpt-5.6-terra', 'virtual:managed-codex', 'legacy-active-job',
        'legacy-active-invocation', '${"b".repeat(64)}', 'legacy-owner',
        '2026-07-28T22:22:00.000Z', 'held', NULL,
        'least-pressure', '[]', NULL, 'new',
        '["kiln://managed-accounts/leases/legacy-active"]', '[]'
      );
    `);
    legacy.close();

    const authority = new SqliteManagedAccountLeaseAuthority({
      path,
      ownerId: "owner-a",
      now: () => Date.parse("2026-07-31T11:00:00.000Z"),
    });
    authority.recoverCommitments();
    authority.close();

    const migrated = new Database(path, { strict: true });
    const columns = migrated.query<{ name: string; notnull: number }, []>(
      "PRAGMA table_info(account_leases)",
    ).all();
    expect(columns.find((column) => column.name === "runtime_invocation_id")?.notnull).toBe(0);
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "economic_attempt_id",
      "commitment_id",
      "usage_evidence",
    ]));
    expect(migrated.query<{
      runtime_invocation_id: string;
      economic_attempt_id: string | null;
      commitment_id: string | null;
      lifecycle_state: string;
      usage_evidence: string;
    }, []>(`SELECT runtime_invocation_id,economic_attempt_id,commitment_id,lifecycle_state,usage_evidence
      FROM account_leases WHERE lease_id='legacy-lease'`).get()).toEqual({
      runtime_invocation_id: "legacy-invocation",
      economic_attempt_id: null,
      commitment_id: null,
      lifecycle_state: "released",
      usage_evidence: '{"health":"healthy","freshness":"missing"}',
    });
    expect(migrated.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(5);
    expect(migrated.query<{ lifecycle_state: string; diagnostic_uris: string }, []>(
      "SELECT lifecycle_state,diagnostic_uris FROM account_leases WHERE lease_id='legacy-active'",
    ).get()).toEqual({
      lifecycle_state: "leaked",
      diagnostic_uris: '["kiln://managed-accounts/leases/legacy-active/orphaned-identity-recovery"]',
    });
    migrated.close();

  });

  it("releases a claimed owner generation when migration fails", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-lease-broken-migration-"));
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

  it.each([
    { version: 1, economic: false, label: "v1" },
    { version: 2, economic: true, label: "pre-final v2" },
  ])("preserves $label lifecycle and identity evidence through rebuild and reopen", ({ version, economic }) => {
    const root = mkdtempSync(join(tmpdir(), `kiln-lease-${version}-`));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const legacy = new Database(path, { create: true, strict: true });
    legacy.exec(`
      CREATE TABLE runtime_owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner_id TEXT NOT NULL,
        heartbeat INTEGER NOT NULL, owner_generation TEXT
      );
      CREATE TABLE account_leases (
        lease_id TEXT PRIMARY KEY, account_policy_id TEXT NOT NULL, account_ref TEXT NOT NULL,
        capacity_identity TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
        route_scope TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE,
        runtime_invocation_id TEXT NOT NULL UNIQUE,
        ${economic ? "economic_attempt_id TEXT, commitment_id TEXT," : ""}
        credential_revision_id TEXT NOT NULL, owner_id TEXT NOT NULL, acquired_at TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL, released_at TEXT, selection_reason TEXT NOT NULL,
        candidate_rejections TEXT NOT NULL, usage_evidence TEXT NOT NULL,
        affinity_outcome TEXT, purpose TEXT NOT NULL, resource_uris TEXT NOT NULL,
        diagnostic_uris TEXT NOT NULL, affinity_key TEXT,
        affinity_expected_capacity_identity TEXT, affinity_commit_outcome TEXT
      );
      INSERT INTO account_leases VALUES(
        'history-${version}', 'policy-${version}', 'configured:account-${version}', 'capacity-${version}',
        'provider-${version}', 'model-${version}', 'virtual:policy-${version}', 'job-${version}',
        'runtime-${version}', ${economic ? `'economic-attempt:${version}', 'commitment-${version}',` : ""}
        '${"b".repeat(64)}', 'owner-history', '2026-07-28T22:20:00.000Z',
        'release-failed', NULL, 'existing-affinity',
        '[{"account":"configured:rejected","reason":"lease-conflict"}]',
        '${usageEvidence}', 'honored', 'affinity',
        '["kiln://managed-accounts/leases/history-${version}"]',
        '["kiln://evidence/release-${version}"]', '${"c".repeat(64)}',
        'capacity-previous', 'won'
      );
      PRAGMA user_version=${version};
    `);
    legacy.close();

    for (const ownerId of ["migration-owner", "reopen-owner"]) {
      const authority = new SqliteManagedAccountLeaseAuthority({ path, ownerId });
      authority.close();
    }

    const reopened = new Database(path, { strict: true });
    expect(reopened.query<Record<string, unknown>, []>(
      `SELECT lease_id,account_policy_id,account_ref,capacity_identity,provider_id,model_id,
        route_scope,job_id,runtime_invocation_id,economic_attempt_id,commitment_id,
        lifecycle_state,released_at,selection_reason,candidate_rejections,usage_evidence,
        affinity_outcome,purpose,resource_uris,diagnostic_uris,affinity_key,
        affinity_expected_capacity_identity,affinity_commit_outcome
       FROM account_leases WHERE lease_id='history-${version}'`,
    ).get()).toEqual({
      lease_id: `history-${version}`,
      account_policy_id: `policy-${version}`,
      account_ref: `configured:account-${version}`,
      capacity_identity: `capacity-${version}`,
      provider_id: `provider-${version}`,
      model_id: `model-${version}`,
      route_scope: `virtual:policy-${version}`,
      job_id: `job-${version}`,
      runtime_invocation_id: `runtime-${version}`,
      economic_attempt_id: economic ? `economic-attempt:${version}` : null,
      commitment_id: economic ? `commitment-${version}` : null,
      lifecycle_state: "release-failed",
      released_at: null,
      selection_reason: "existing-affinity",
      candidate_rejections: '[{"account":"configured:rejected","reason":"lease-conflict"}]',
      usage_evidence: usageEvidence,
      affinity_outcome: "honored",
      purpose: "affinity",
      resource_uris: `["kiln://managed-accounts/leases/history-${version}"]`,
      diagnostic_uris: `["kiln://evidence/release-${version}"]`,
      affinity_key: "c".repeat(64),
      affinity_expected_capacity_identity: "capacity-previous",
      affinity_commit_outcome: "won",
    });
    reopened.close();
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
      usage_evidence,affinity_outcome,purpose,resource_uris,diagnostic_uris
    ) VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?,?,?, ?,?,?,?,?,NULL,?,?,?)`).run(
      "native-economic", "native-policy", "configured:native", "native-capacity", "provider", "model",
      "economic:native", "native-job", "economic-attempt:native", "native-commitment", "d".repeat(64),
      "historical-owner", "2026-07-30T00:00:00.000Z", "released", "2026-07-30T00:01:00.000Z",
      "least-pressure", "[]", usageEvidence, "new", "[]", "[]",
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
});
