import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  ManagedWriteApprovalError,
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

describe("SqliteManagedWriteApprovalAuthority", () => {
  it("rejects the legacy v1 binding store without mutating it", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-managed-write-approval-v1-"));
    roots.push(root);
    const path = join(root, "approvals.sqlite");
    const legacy = new Database(path, { create: true, strict: true });
    legacy.exec("CREATE TABLE legacy_marker(value TEXT NOT NULL); INSERT INTO legacy_marker VALUES ('preserved'); PRAGMA user_version=1;");
    legacy.close();

    expect(() => new SqliteManagedWriteApprovalAuthority({ path })).toThrow(
      "Managed write approval schema version 1 is unsupported.",
    );

    const observed = new Database(path, { strict: true });
    expect(observed.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(1);
    expect(observed.query<{ value: string }, []>("SELECT value FROM legacy_marker").get()?.value).toBe("preserved");
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
