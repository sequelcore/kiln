import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  ManagedWriteApprovalError,
  ManagedWriteApprovalSchemaError,
  SqliteManagedWriteApprovalAuthority,
  type ManagedWriteApprovalBinding,
} from "../../src/managed-write-approvals/sqlite-managed-write-approval-authority.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function authority(now = () => Date.parse("2026-08-09T20:00:00.000Z")) {
  const root = mkdtempSync(join(tmpdir(), "kiln-managed-write-approval-"));
  roots.push(root);
  return new SqliteManagedWriteApprovalAuthority({ path: join(root, "approvals.sqlite"), now });
}

function binding(overrides: Partial<ManagedWriteApprovalBinding> = {}): ManagedWriteApprovalBinding {
  return {
    projectId: "project-approval-test",
    jobId: "job-1",
    callerId: "trusted-operator",
    workItemFingerprint: `sha256:${"1".repeat(64)}`,
    configuredAgentProfileId: "opencode-write-worker",
    access: "approved-write",
    routeId: "opencode-go-write",
    providerId: "opencode-go",
    model: "kimi-k2.6",
    adapterCapabilityId: "direct-runtime",
    adapterCapabilityVersion: "1",
    authorityDigest: `sha256:${"2".repeat(64)}`,
    effectDigest: `sha256:${"3".repeat(64)}`,
    revisionDigest: `sha256:${"4".repeat(64)}`,
    ...overrides,
  };
}

function expectErrorCode(action: () => unknown, code: ManagedWriteApprovalError["code"]): void {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`expected ${code}`);
}

function createLegacyV1Schema(database: Database): void {
  database.exec(`CREATE TABLE managed_write_approvals (
    approval_id TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK(state IN ('issued','revoked','consumed')),
    binding_json TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    approver_id TEXT NOT NULL,
    revoked_at TEXT,
    consumed_at TEXT,
    consumed_by TEXT
  );
  CREATE INDEX managed_write_approvals_project ON managed_write_approvals(approval_id, state);
  PRAGMA user_version=1;`);
}

describe("SqliteManagedWriteApprovalAuthority", () => {
  it("migrates an empty legacy v1 store into an empty canonical v2 store", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-managed-write-approval-v1-"));
    roots.push(root);
    const path = join(root, "approvals.sqlite");
    const legacy = new Database(path, { create: true, strict: true });
    createLegacyV1Schema(legacy);
    legacy.close();

    const approvals = new SqliteManagedWriteApprovalAuthority({
      path,
      now: () => Date.parse("2026-08-09T20:00:00.000Z"),
    });
    expect(approvals.inspect("managed-write-approval:legacy-1")).toBeUndefined();
    approvals.close();

    const observed = new Database(path, { strict: true });
    expect(observed.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(
      observed
        .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get("managed_write_approvals_v1_archive")?.name,
    ).toBe("managed_write_approvals_v1_archive");
    expect(
      observed.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM managed_write_approvals").get()?.count,
    ).toBe(0);
    observed.close();
  });

  it("archives every v1 row without converting its obsolete binding into authority", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-managed-write-approval-v1-row-"));
    roots.push(root);
    const path = join(root, "approvals.sqlite");
    const legacy = new Database(path, { create: true, strict: true });
    createLegacyV1Schema(legacy);
    const legacyBinding = { ...binding(), admissionProfileId: "foundation-apply-approved-writes" };
    legacy
      .query(
        "INSERT INTO managed_write_approvals(approval_id,state,binding_json,issued_at,expires_at,approver_id) VALUES(?,?,?,?,?,?)",
      )
      .run(
        "managed-write-approval:legacy-1",
        "issued",
        JSON.stringify(legacyBinding),
        "2026-08-09T19:59:00.000Z",
        "2026-08-09T20:05:00.000Z",
        "operator-1",
      );
    legacy.close();

    const approvals = new SqliteManagedWriteApprovalAuthority({
      path,
      now: () => Date.parse("2026-08-09T20:00:00.000Z"),
      idGenerator: () => "legacy-1",
    });
    expect(approvals.inspect("managed-write-approval:legacy-1")).toBeUndefined();
    expect(() =>
      approvals.issue({
        binding: binding(),
        approverId: "operator-1",
        expiresAt: "2026-08-09T20:05:00.000Z",
      }),
    ).toThrow("Managed write approval id already exists in archived evidence.");
    approvals.close();

    const observed = new Database(path, { strict: true });
    expect(
      observed.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM managed_write_approvals").get()?.count,
    ).toBe(0);
    expect(
      observed
        .query<{ binding_json: string }, [string]>(
          "SELECT binding_json FROM managed_write_approvals_v1_archive WHERE approval_id=?",
        )
        .get("managed-write-approval:legacy-1")?.binding_json,
    ).toBe(JSON.stringify(legacyBinding));
    observed.close();
  });

  it("reopens a migrated store without repeating the archive", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-managed-write-approval-v1-reopen-"));
    roots.push(root);
    const path = join(root, "approvals.sqlite");
    const legacy = new Database(path, { create: true, strict: true });
    createLegacyV1Schema(legacy);
    legacy.close();

    const first = new SqliteManagedWriteApprovalAuthority({ path });
    first.close();
    const second = new SqliteManagedWriteApprovalAuthority({ path });
    second.close();

    const observed = new Database(path, { strict: true });
    expect(
      observed
        .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?")
        .get("managed_write_approvals_v1_archive")?.count,
    ).toBe(1);
    expect(observed.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(2);
    observed.close();
  });

  it("rolls back a malformed v1 migration without mutating the legacy table", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-managed-write-approval-v1-malformed-"));
    roots.push(root);
    const path = join(root, "approvals.sqlite");
    const legacy = new Database(path, { create: true, strict: true });
    legacy.exec("CREATE TABLE managed_write_approvals(approval_id TEXT PRIMARY KEY); PRAGMA user_version=1;");
    legacy.close();

    try {
      new SqliteManagedWriteApprovalAuthority({ path });
      throw new Error("expected malformed schema error");
    } catch (error) {
      expect(error).toBeInstanceOf(ManagedWriteApprovalSchemaError);
      expect(error).toMatchObject({ code: "unsupported_schema" });
      expect(error).toHaveProperty("message", "Managed write approval schema version 1 is malformed.");
    }

    const observed = new Database(path, { strict: true });
    expect(observed.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(1);
    expect(
      observed
        .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get("managed_write_approvals")?.name,
    ).toBe("managed_write_approvals");
    expect(
      observed
        .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get("managed_write_approvals_v1_archive"),
    ).toBeNull();
    observed.close();
  });

  it("rejects an unknown schema version without mutating the store", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-managed-write-approval-unknown-"));
    roots.push(root);
    const path = join(root, "approvals.sqlite");
    const legacy = new Database(path, { create: true, strict: true });
    legacy.exec(
      "CREATE TABLE future_marker(value TEXT NOT NULL); INSERT INTO future_marker VALUES ('preserved'); PRAGMA user_version=99;",
    );
    legacy.close();

    try {
      new SqliteManagedWriteApprovalAuthority({ path });
      throw new Error("expected unsupported schema error");
    } catch (error) {
      expect(error).toBeInstanceOf(ManagedWriteApprovalSchemaError);
      expect(error).toMatchObject({ code: "unsupported_schema" });
      expect(error).toHaveProperty("message", "Managed write approval schema version 99 is unsupported.");
    }

    const observed = new Database(path, { strict: true });
    expect(observed.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(99);
    expect(observed.query<{ value: string }, []>("SELECT value FROM future_marker").get()?.value).toBe("preserved");
    expect(
      observed
        .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get("managed_write_approvals"),
    ).toBeNull();
    observed.close();
  });

  it("issues and atomically consumes one exact approval, with idempotent same-consumer reads", () => {
    const approvals = authority();
    const issued = approvals.issue({ binding: binding(), approverId: "operator-1", expiresAt: "2026-08-09T20:05:00.000Z" });

    expect(issued).toMatchObject({ approvalId: expect.stringMatching(/^managed-write-approval:/u), state: "issued" });
    const consumed = approvals.consume({ approvalId: issued.approvalId, binding: binding(), consumerId: "agent-task:job-1" });
    expect(consumed).toMatchObject({ approvalId: issued.approvalId, state: "consumed", consumedBy: "agent-task:job-1" });
    expect(approvals.consume({ approvalId: issued.approvalId, binding: binding(), consumerId: "agent-task:job-1" })).toEqual(consumed);
    expectErrorCode(
      () => approvals.consume({ approvalId: issued.approvalId, binding: binding(), consumerId: "agent-task:job-2" }),
      "approval_replayed",
    );
    approvals.close();
  });

  it.each([
    ["job", { jobId: "job-2" }],
    ["route", { routeId: "other-route" }],
    ["caller", { callerId: "other-trusted-operator" }],
    ["work item", { workItemFingerprint: `sha256:${"7".repeat(64)}` }],
    ["authority scope", { authorityDigest: `sha256:${"5".repeat(64)}` }],
    ["effect", { effectDigest: `sha256:${"6".repeat(64)}` }],
  ])("rejects a %s mismatch before consumption", (_label, overrides) => {
    const approvals = authority();
    const issued = approvals.issue({ binding: binding(), approverId: "operator-1", expiresAt: "2026-08-09T20:05:00.000Z" });

    expectErrorCode(
      () => approvals.consume({ approvalId: issued.approvalId, binding: binding(overrides), consumerId: "agent-task:job-1" }),
      "approval_binding_mismatch",
    );
    expect(approvals.inspect(issued.approvalId)?.state).toBe("issued");
    approvals.close();
  });

  it("fails closed for expiry and revocation", () => {
    let now = Date.parse("2026-08-09T20:00:00.000Z");
    const approvals = authority(() => now);
    const expired = approvals.issue({ binding: binding(), approverId: "operator-1", expiresAt: "2026-08-09T20:01:00.000Z" });
    now = Date.parse("2026-08-09T20:01:01.000Z");
    expectErrorCode(
      () => approvals.consume({ approvalId: expired.approvalId, binding: binding(), consumerId: "agent-task:job-1" }),
      "approval_expired",
    );

    const revoked = approvals.issue({ binding: binding(), approverId: "operator-1", expiresAt: "2026-08-09T20:05:00.000Z" });
    approvals.revoke({ approvalId: revoked.approvalId, projectId: "project-approval-test" });
    expectErrorCode(
      () => approvals.consume({ approvalId: revoked.approvalId, binding: binding(), consumerId: "agent-task:job-1" }),
      "approval_revoked",
    );
    approvals.close();
  });

  it("preserves terminal state across restart and allows no second consumer", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-managed-write-approval-restart-"));
    roots.push(root);
    const path = join(root, "approvals.sqlite");
    const first = new SqliteManagedWriteApprovalAuthority({ path, now: () => Date.parse("2026-08-09T20:00:00.000Z") });
    const issued = first.issue({ binding: binding(), approverId: "operator-1", expiresAt: "2026-08-09T20:05:00.000Z" });
    first.consume({ approvalId: issued.approvalId, binding: binding(), consumerId: "agent-task:job-1" });
    first.close();

    const restarted = new SqliteManagedWriteApprovalAuthority({ path, now: () => Date.parse("2026-08-09T20:01:00.000Z") });
    expect(restarted.inspect(issued.approvalId)).toMatchObject({ state: "consumed", consumedBy: "agent-task:job-1" });
    expectErrorCode(
      () => restarted.consume({ approvalId: issued.approvalId, binding: binding(), consumerId: "agent-task:job-2" }),
      "approval_replayed",
    );
    restarted.close();
  });

  it("allows only one competing consumer to consume an approval", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-managed-write-approval-race-"));
    roots.push(root);
    const path = join(root, "approvals.sqlite");
    const first = new SqliteManagedWriteApprovalAuthority({ path });
    const second = new SqliteManagedWriteApprovalAuthority({ path });
    const issued = first.issue({ binding: binding(), approverId: "operator-1", expiresAt: "2099-08-09T20:05:00.000Z" });

    const results = await Promise.allSettled([
      Promise.resolve().then(() => first.consume({ approvalId: issued.approvalId, binding: binding(), consumerId: "agent-task:job-1" })),
      Promise.resolve().then(() => second.consume({ approvalId: issued.approvalId, binding: binding(), consumerId: "agent-task:job-2" })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0]).toMatchObject({ reason: { code: "approval_replayed" } });
    first.close();
    second.close();
  });
});
