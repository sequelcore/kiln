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

  it("rejects an obsolete lease schema without rewriting its authority rows", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-lease-obsolete-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const obsolete = new Database(path, { create: true, strict: true });
    obsolete.exec(`
      CREATE TABLE account_leases (lease_id TEXT PRIMARY KEY);
      INSERT INTO account_leases VALUES('retained-row');
      PRAGMA user_version=5;
    `);
    obsolete.close();

    for (const ownerId of ["first-owner", "second-owner"]) {
      expect(() => new SqliteManagedAccountLeaseAuthority({ path, ownerId }))
        .toThrow("predates the canonical action-claim schema");
    }

    const retained = new Database(path, { readonly: true, strict: true });
    expect(retained.query<{ user_version: number }, []>("PRAGMA user_version").get())
      .toEqual({ user_version: 5 });
    expect(retained.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM account_leases").get())
      .toEqual({ count: 1 });
    retained.close();
  });
});
