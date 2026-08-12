import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adoptBoundedWorkContractRevision,
  supersedeBoundedWorkContractRevision,
  type BoundedWorkContract,
} from "@kilnai/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  BoundedWorkAuthorityError,
  SqliteBoundedWorkAuthority,
} from "../../src/work-governance/sqlite-bounded-work-authority.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kiln-bounded-work-"));
  roots.push(root);
  return join(root, "bounded-work.sqlite");
}

async function waitFor(paths: readonly string[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (paths.some((path) => !existsSync(path))) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for bounded-work workers.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function runProcess(command: string, args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const baseContract = (maxExecutionAttempts = 2, maxManagedInvocations = 2): BoundedWorkContract => ({
  schema: "kiln.bounded-work-contract/v1",
  intent: { objective: "Bound work.", acceptanceCriteria: ["tests"], nonGoals: [] },
  scope: {
    allowedWorkItemIds: ["work-1"],
    permittedEffects: ["modify_source", "invoke_managed_agent"],
    permittedSurfaces: ["core"],
    allowedRoots: ["packages/core"],
    deniedRoots: [],
    refactorAuthority: "scoped",
    migrationAuthority: "none",
    dependencyAuthority: "none",
  },
  limits: {
    maxExecutionAttempts,
    maxManagedInvocations,
    maxConcurrentManagedInvocations: 1,
    maxChildDepth: 1,
    maxReviewRounds: 1,
    maxRemediationRounds: 1,
  },
  tripwires: {},
  policy: {
    scopeExpansion: "approval_required",
    budgetExhaustion: "pause",
    minimumHarnessCapability: "authoritative",
  },
});

const firstRevision = (attempts = 2, invocations = 2) => adoptBoundedWorkContractRevision({
  contract: baseContract(attempts, invocations),
  accountingLineageId: "goal-1",
  adoptedAt: "2026-08-12T18:00:00.000Z",
  adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-1" },
});

const governedRequest = {
  harnessCapability: "authoritative" as const,
  scope: {
    workItemId: "work-1",
    effect: "modify_source" as const,
    surface: "core",
    paths: ["packages/core/src/index.ts"],
  },
};

const reserve = (
  authority: SqliteBoundedWorkAuthority,
  revision = firstRevision(),
  idempotencyKey = "attempt-1",
  routeId = "codex-oauth",
) => authority.reserve({
  ...governedRequest,
  projectRuntimeId: "project-1",
  goalRunId: "goal-1",
  workItemId: "work-1",
  contractRevision: revision,
  idempotencyKey,
  route: { routeId, harnessId: "kiln-direct" },
  reservation: { kind: "execution_attempt", amount: 1 },
});

describe("SqliteBoundedWorkAuthority", () => {
  it("admits exactly one final-slot winner across real Bun processes", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-bounded-work-process-"));
    roots.push(root);
    const path = join(root, "bounded-work.sqlite");
    const start = join(root, "start");
    const workerSource = fileURLToPath(new URL("./bounded-work-authority-worker.ts", import.meta.url));
    const workerBundle = join(root, "bounded-work-authority-worker.js");
    const build = await runProcess("bun", ["build", workerSource, "--target=bun", "--outfile", workerBundle]);
    expect({ code: build.code, stderr: build.stderr }).toEqual({ code: 0, stderr: "" });
    const ids = ["attempt-one", "attempt-two"] as const;
    const ready = ids.map((id) => join(root, `${id}.ready`));
    const result = ids.map((id) => join(root, `${id}.result`));
    const children = ids.map((id, index) => runProcess("bun", ["run", workerBundle, path, id, ready[index]!, start, result[index]!]));
    await waitFor(ready);
    writeFileSync(start, "go");
    const outcomes = await Promise.all(children);
    expect(outcomes.map(({ code, stderr }) => ({ code, stderr }))).toEqual([
      { code: 0, stderr: "" },
      { code: 0, stderr: "" },
    ]);
    expect(outcomes.every(({ stdout }) => stdout === "")).toBe(true);
    const decisions = result.map((file) => JSON.parse(readFileSync(file, "utf8")) as { kind: string });
    expect(decisions.filter((decision) => decision.kind === "admitted")).toHaveLength(1);
    expect(decisions.filter((decision) => decision.kind === "pause_budget_exhausted")).toHaveLength(1);
  });

  it("keeps cumulative limits across routes and restarts", async () => {
    const path = await databasePath();
    const revision = firstRevision();
    const first = new SqliteBoundedWorkAuthority({ path, now: () => Date.parse("2026-08-12T18:10:00.000Z") });
    expect(reserve(first, revision, "attempt-1", "codex-oauth").decision.kind).toBe("admitted");
    expect(reserve(first, revision, "attempt-2", "opencode-go").decision.kind).toBe("admitted");
    first.close();

    const restarted = new SqliteBoundedWorkAuthority({ path, now: () => Date.parse("2026-08-12T18:11:00.000Z") });
    expect(reserve(restarted, revision, "attempt-3", "native-codex").decision).toMatchObject({
      kind: "pause_budget_exhausted",
      exhaustedLimits: ["execution_attempts"],
    });
    expect(restarted.inspect({ projectRuntimeId: "project-1", accountingLineageId: "goal-1" }))
      .toMatchObject({ executionAttempts: 2, revision: 2 });
    restarted.close();
  });

  it("isolates identical goal lineages in different project runtimes", async () => {
    const authority = new SqliteBoundedWorkAuthority({ path: await databasePath() });
    expect(reserve(authority).decision.kind).toBe("admitted");
    expect(authority.reserve({
      ...governedRequest,
      projectRuntimeId: "project-2",
      goalRunId: "goal-1",
      workItemId: "work-1",
      contractRevision: firstRevision(),
      idempotencyKey: "attempt-1",
      route: { routeId: "codex-oauth", harnessId: "kiln-direct" },
      reservation: { kind: "execution_attempt", amount: 1 },
    }).decision.kind).toBe("admitted");
    expect(authority.inspect({ projectRuntimeId: "project-1", accountingLineageId: "goal-1" }))
      .toMatchObject({ executionAttempts: 1 });
    expect(authority.inspect({ projectRuntimeId: "project-2", accountingLineageId: "goal-1" }))
      .toMatchObject({ executionAttempts: 1 });
    authority.close();
  });

  it("replays an exact idempotency request and rejects a changed request", async () => {
    const authority = new SqliteBoundedWorkAuthority({ path: await databasePath() });
    const first = reserve(authority);
    expect(reserve(authority)).toEqual(first);
    expect(() => authority.reserve({
      ...governedRequest,
      projectRuntimeId: "project-1",
      goalRunId: "goal-1",
      workItemId: "work-1",
      contractRevision: firstRevision(),
      idempotencyKey: "attempt-1",
      route: { routeId: "codex-oauth", harnessId: "kiln-direct" },
      reservation: { kind: "execution_attempt", amount: 2 },
    })).toThrowError(BoundedWorkAuthorityError);
    expect(authority.inspect({ projectRuntimeId: "project-1", accountingLineageId: "goal-1" }))
      .toMatchObject({ executionAttempts: 1, revision: 1 });
    authority.close();
  });

  it("persists typed scope and capability denials without consuming counters", async () => {
    const authority = new SqliteBoundedWorkAuthority({ path: await databasePath() });
    const outOfScope = authority.reserve({
      ...governedRequest,
      scope: { ...governedRequest.scope, paths: ["packages/runtime/src/index.ts"] },
      projectRuntimeId: "project-1",
      goalRunId: "goal-1",
      workItemId: "work-1",
      contractRevision: firstRevision(),
      idempotencyKey: "scope-denial",
      route: { routeId: "native-codex", harnessId: "codex-cli" },
      reservation: { kind: "execution_attempt", amount: 1 },
    });
    expect(outOfScope.decision.kind).toBe("pause_scope_revision_required");
    expect(authority.reserve({
      ...governedRequest,
      harnessCapability: "advisory_only",
      projectRuntimeId: "project-1",
      goalRunId: "goal-1",
      workItemId: "work-1",
      contractRevision: firstRevision(),
      idempotencyKey: "capability-denial",
      route: { routeId: "native-codex", harnessId: "codex-cli" },
      reservation: { kind: "execution_attempt", amount: 1 },
    }).decision.kind).toBe("pause_capability_unavailable");
    expect(authority.inspect({ projectRuntimeId: "project-1", accountingLineageId: "goal-1" }))
      .toMatchObject({ executionAttempts: 0, revision: 0 });
    authority.close();
  });

  it("releases a pre-dispatch reservation exactly once", async () => {
    const authority = new SqliteBoundedWorkAuthority({ path: await databasePath() });
    const admitted = reserve(authority);
    if (!admitted.reservation) throw new Error("expected reservation");
    const released = authority.releaseBeforeDispatch({
      reservationId: admitted.reservation.reservationId,
      expectedReservationRevision: admitted.reservation.revision,
    });
    expect(released.state).toBe("released");
    expect(authority.releaseBeforeDispatch({
      reservationId: admitted.reservation.reservationId,
      expectedReservationRevision: admitted.reservation.revision,
    })).toEqual(released);
    expect(authority.inspect({ projectRuntimeId: "project-1", accountingLineageId: "goal-1" }))
      .toMatchObject({ executionAttempts: 0, revision: 2 });
    authority.close();
  });

  it("holds post-dispatch unknown work until authoritative reconciliation", async () => {
    const authority = new SqliteBoundedWorkAuthority({ path: await databasePath() });
    const revision = firstRevision(2, 3);
    const admitted = authority.reserve({
      ...governedRequest,
      scope: { ...governedRequest.scope, effect: "invoke_managed_agent" },
      projectRuntimeId: "project-1",
      goalRunId: "goal-1",
      workItemId: "work-1",
      contractRevision: revision,
      idempotencyKey: "child-1",
      route: { routeId: "codex-oauth", harnessId: "kiln-direct" },
      reservation: { kind: "managed_invocation", amount: 1, childDepth: 1 },
    });
    if (!admitted.reservation) throw new Error("expected reservation");
    const dispatched = authority.markDispatched({
      reservationId: admitted.reservation.reservationId,
      expectedReservationRevision: admitted.reservation.revision,
      dispatchId: "dispatch-1",
    });
    const pending = authority.settleUnknown({
      reservationId: dispatched.reservationId,
      expectedReservationRevision: dispatched.revision,
      reason: "provider outcome unavailable",
    });
    expect(pending.state).toBe("reconciliation_required");
    expect(authority.reserve({
      ...governedRequest,
      scope: { ...governedRequest.scope, effect: "invoke_managed_agent" },
      projectRuntimeId: "project-1",
      goalRunId: "goal-1",
      workItemId: "work-1",
      contractRevision: revision,
      idempotencyKey: "child-2",
      route: { routeId: "opencode-go", harnessId: "kiln-direct" },
      reservation: { kind: "managed_invocation", amount: 1, childDepth: 1 },
    }).decision).toMatchObject({
      kind: "pause_budget_exhausted",
      exhaustedLimits: ["concurrent_managed_invocations"],
    });

    const reconciled = authority.reconcileTerminal({
      reservationId: pending.reservationId,
      expectedReservationRevision: pending.revision,
      terminalEvidenceDigest: `sha256:${"a".repeat(64)}`,
      terminalOutcome: "completed",
    });
    expect(reconciled.state).toBe("settled");
    expect(authority.inspect({ projectRuntimeId: "project-1", accountingLineageId: "goal-1" }))
      .toMatchObject({ managedInvocations: 1, activeManagedInvocations: 0 });
    const next = authority.reserve({
      ...governedRequest,
      scope: { ...governedRequest.scope, effect: "invoke_managed_agent" },
      projectRuntimeId: "project-1",
      goalRunId: "goal-1",
      workItemId: "work-1",
      contractRevision: revision,
      idempotencyKey: "child-3",
      route: { routeId: "codex-oauth", harnessId: "kiln-direct" },
      reservation: { kind: "managed_invocation", amount: 1, childDepth: 1 },
    });
    if (!next.reservation) throw new Error("expected reservation");
    const nextDispatched = authority.markDispatched({
      reservationId: next.reservation.reservationId,
      expectedReservationRevision: next.reservation.revision,
      dispatchId: "dispatch-3",
    });
    expect(authority.settleTerminal({
      reservationId: nextDispatched.reservationId,
      expectedReservationRevision: nextDispatched.revision,
      terminalEvidenceDigest: `sha256:${"b".repeat(64)}`,
      terminalOutcome: "failed",
    })).toMatchObject({ state: "settled", terminalOutcome: "failed" });
    authority.close();
  });

  it("adopts a successor revision without resetting accounting and rejects stale revisions", async () => {
    const authority = new SqliteBoundedWorkAuthority({ path: await databasePath() });
    const first = firstRevision(1);
    expect(reserve(authority, first).decision.kind).toBe("admitted");
    const successor = supersedeBoundedWorkContractRevision({
      current: first,
      contract: baseContract(2),
      expectedRevisionDigest: first.revisionDigest,
      accountingLineageId: "goal-1",
      adoptedAt: "2026-08-12T18:20:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-2" },
    });
    expect(reserve(authority, successor, "attempt-2").decision.kind).toBe("admitted");
    expect(() => reserve(authority, first, "attempt-stale")).toThrowError(BoundedWorkAuthorityError);
    expect(authority.inspect({ projectRuntimeId: "project-1", accountingLineageId: "goal-1" }))
      .toMatchObject({ contractRevisionDigest: successor.revisionDigest, executionAttempts: 2 });
    authority.close();
  });
});
