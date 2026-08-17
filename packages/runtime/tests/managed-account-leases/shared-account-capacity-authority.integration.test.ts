import { afterEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { createExecutionAccountRef, createExecutionAccountPolicyId } from "@kilnai/core/agents";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  readAccountOutcomeIncidents,
  SqliteManagedAccountLeaseAuthority,
} from "../../src/managed-account-leases/managed-account-lease-authority.js";
import { createOperatorSessionAccountCapacityAuthority } from "../../src/execution-routing/operator-session-execution-routing-service.js";

const roots: string[] = [];
const authorities: SqliteManagedAccountLeaseAuthority[] = [];

afterEach(() => {
  for (const authority of authorities.splice(0)) authority.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createAuthority(
  path: string,
  kind: "agent-task-runtime" | "model-gateway-ingress" | "operator-session",
  domain: string = kind,
  now = () => Date.now(),
) {
  const authority = new SqliteManagedAccountLeaseAuthority({
    path, participantKind: kind, recoveryDomain: domain, ownerId: `${kind}-${domain}`,
    configurationRevision: "rev-1", now, ownerStaleMs: 10,
  });
  authorities.push(authority);
  return authority;
}

function capacityInput(id: string, revision = "a".repeat(64)) {
  const route = { providerId: "provider", providerModelId: "model", scope: "gateway" };
  return {
    runtimeInvocationId: id,
    intentFingerprint: `sha256:${"a".repeat(64)}`,
    accountPolicyId: createExecutionAccountPolicyId("policy"),
    route,
    candidates: [{
      candidate: { account: createExecutionAccountRef("configured:account"), route, health: "healthy" as const, leaseCapacity: "available" as const, pressure: 0, reservedForNewWork: false },
      capacityIdentity: "stable-account",
      credentialRevisionId: revision,
      usageEvidence: { health: "healthy" as const, freshness: "missing" as const },
      capacity: { maxConcurrency: 1, reservedAffinitySlots: 0 },
    }],
  } as const;
}

// Strictly below the process case's own timeout, so a worker that never becomes
// ready reports that instead of being killed by the runner first.
const WORKER_READINESS_TIMEOUT_MS = 30_000;

async function waitFor(paths: readonly string[]): Promise<void> {
  const deadline = Date.now() + WORKER_READINESS_TIMEOUT_MS;
  while (paths.some((path) => !existsSync(path))) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for process-capacity worker readiness.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function runProcess(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("shared account capacity in managed authority", () => {
  it("recovers retained operator-session capacity when the canonical factory claims a new generation", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const previous = createAuthority(path, "operator-session", "operator-factory-recovery");
    expect(previous.acquireAccountCapacity(capacityInput("abandoned-operator-turn")).status).toBe("acquired");
    previous.close();
    authorities.splice(authorities.indexOf(previous), 1);

    const current = createOperatorSessionAccountCapacityAuthority({
      path,
      recoveryDomain: "operator-factory-recovery",
      ownerId: "replacement-operator-session",
      configurationRevision: "rev-1",
      ownerStaleMs: 10,
    });
    authorities.push(current);

    expect(current.acquireAccountCapacity(capacityInput("replacement-operator-turn"))).toMatchObject({
      status: "acquired",
    });
  });

  it("shares physical maxConcurrency across recovery participants and credential revisions", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const managed = createAuthority(path, "agent-task-runtime");
    const gateway = createAuthority(path, "model-gateway-ingress");

    expect(gateway.acquireAccountCapacity(capacityInput("gateway")).status).toBe("acquired");
    expect(managed.acquireAccountCapacity(capacityInput("managed", "b".repeat(64)))).toMatchObject({ status: "unavailable" });
  });

  it("shares physical maxConcurrency with operator sessions instead of creating a surface-local pool", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const gateway = createAuthority(path, "model-gateway-ingress");
    const operator = createAuthority(path, "operator-session");

    expect(gateway.acquireAccountCapacity(capacityInput("gateway")).status).toBe("acquired");
    expect(operator.acquireAccountCapacity(capacityInput("operator", "b".repeat(64))))
      .toMatchObject({ status: "unavailable" });
  });

  it("projects shared capacity as advisory catalog evidence while atomic acquire remains authoritative", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const gateway = createAuthority(path, "model-gateway-ingress");
    const operator = createAuthority(path, "operator-session");
    const input = capacityInput("gateway");

    expect(operator.observeCandidateCapacity(input.candidates)).toMatchObject([{ leaseCapacity: "available" }]);
    expect(gateway.acquireAccountCapacity(input).status).toBe("acquired");
    expect(operator.observeCandidateCapacity(input.candidates)).toMatchObject([{ leaseCapacity: "unavailable" }]);
    expect(operator.acquireAccountCapacity(capacityInput("operator"))).toMatchObject({ status: "unavailable" });
  });

  it("fences, settles idempotently, and rejects settlement conflicts", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const authority = createAuthority(join(root, "authority.sqlite"), "model-gateway-ingress");
    authority.acquireAccountCapacity(capacityInput("gateway"));
    authority.fenceAccountCapacityDispatch("gateway", "fence");
    const settlement = { kind: "completed" as const, outcome: "success" as const, observedAt: "2026-08-08T00:00:00.000Z" };
    expect(authority.settleAccountCapacity("gateway", "fence", settlement).state).toBe("released");
    expect(authority.settleAccountCapacity("gateway", "fence", settlement).state).toBe("released");
    expect(() => authority.settleAccountCapacity("gateway", "fence", { ...settlement, outcome: "cancelled" })).toThrow(/conflicts/i);
    expect(() => authority.settleAccountCapacity("gateway", "fence", { ...settlement, observedAt: "2026-08-08Tgarbage" })).toThrow(/canonical ISO timestamp/i);
  });

  it("retains an unknown outcome without holding local capacity or permitting redispatch", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const path = join(root, "authority.sqlite");
    const authority = createAuthority(path, "model-gateway-ingress", "gateway");
    authority.acquireAccountCapacity(capacityInput("uncertain"));
    authority.fenceAccountCapacityDispatch("uncertain", "uncertain-fence");
    const settlement = {
      kind: "unknown" as const,
      reason: "terminal provider evidence is unavailable",
      observedAt: "2026-08-13T08:00:00.000Z",
    };

    expect(authority.settleAccountCapacity("uncertain", "uncertain-fence", settlement))
      .toMatchObject({ state: "settlement-pending" });
    expect(authority.acquireAccountCapacity(capacityInput("uncertain")))
      .toMatchObject({ status: "acquired", replay: true, record: { state: "settlement-pending" } });
    expect(() => authority.fenceAccountCapacityDispatch("uncertain", "second-fence")).toThrow(/conflicts/i);
    expect(authority.acquireAccountCapacity(capacityInput("next")))
      .toMatchObject({ status: "acquired", replay: false });

    const database = new Database(path, { readonly: true, strict: true });
    expect(database.query<{ lifecycle_state: string; released_at: string | null; settlement_json: string }, []>(
      "SELECT lifecycle_state,released_at,settlement_json FROM account_leases WHERE runtime_invocation_id='uncertain'",
    ).get()).toEqual({
      lifecycle_state: "settlement-pending",
      released_at: expect.any(String),
      settlement_json: JSON.stringify(settlement),
    });
    database.close();
  });

  it("continues counting unsettled economic rows against shared account capacity", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const path = join(root, "authority.sqlite");
    const authority = createAuthority(path, "model-gateway-ingress", "gateway");
    authority.acquireAccountCapacity(capacityInput("economic-holder"));
    const database = new Database(path, { strict: true });
    database.query(
      `UPDATE account_leases
       SET runtime_invocation_id=NULL,economic_attempt_id='economic-attempt',commitment_id='commitment',
           lifecycle_state='settlement-pending',released_at=?
       WHERE job_id='economic-holder'`,
    ).run("2026-08-13T08:00:00.000Z");
    database.close();

    expect(authority.acquireAccountCapacity(capacityInput("gateway"))).toMatchObject({ status: "unavailable" });
  });

  it("releases stale pre-fence capacity without adopting its generation", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const path = join(root, "authority.sqlite"); let now = 1_000;
    const old = createAuthority(path, "model-gateway-ingress", "gateway", () => now);
    old.acquireAccountCapacity(capacityInput("gateway"));
    const before = new Database(path, { readonly: true, strict: true });
    const identity = before.query<{ owner_id: string; owner_generation: string }, []>(
      "SELECT owner_id,owner_generation FROM account_leases WHERE runtime_invocation_id='gateway'",
    ).get();
    before.close();
    now = 2_000;
    const replacement = createAuthority(path, "model-gateway-ingress", "gateway", () => now);
    expect(replacement.recoverAccountCapacity()).toMatchObject([{ runtimeInvocationId: "gateway", state: "released" }]);
    expect(() => old.fenceAccountCapacityDispatch("gateway", "old-fence")).toThrow(/stale|ownership/i);
    expect(() => replacement.fenceAccountCapacityDispatch("gateway", "new-fence")).toThrow(/stale|unavailable/i);
    expect(replacement.acquireAccountCapacity(capacityInput("replacement"))).toMatchObject({ status: "acquired" });
    const after = new Database(path, { readonly: true, strict: true });
    expect(after.query<{ owner_id: string; owner_generation: string }, []>(
      "SELECT owner_id,owner_generation FROM account_leases WHERE runtime_invocation_id='gateway'",
    ).get()).toEqual(identity);
    after.close();
  });

  it("settles stale fenced capacity as unknown without fabricating a provider outcome", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const path = join(root, "authority.sqlite"); let now = 1_000;
    const old = createAuthority(path, "model-gateway-ingress", "gateway", () => now);
    old.acquireAccountCapacity(capacityInput("gateway"));
    old.fenceAccountCapacityDispatch("gateway", "gateway-fence");
    now = 2_000;
    const replacement = createAuthority(path, "model-gateway-ingress", "gateway", () => now);

    expect(replacement.recoverAccountCapacity()).toMatchObject([{
      runtimeInvocationId: "gateway",
      state: "settlement-pending",
      dispatchFenceId: "gateway-fence",
    }]);
    expect(replacement.acquireAccountCapacity(capacityInput("replacement"))).toMatchObject({ status: "acquired" });
    const database = new Database(path, { readonly: true, strict: true });
    const recovered = database.query<{ released_at: string | null; settlement_json: string }, []>(
      "SELECT released_at,settlement_json FROM account_leases WHERE runtime_invocation_id='gateway'",
    ).get()!;
    database.close();
    expect(recovered.released_at).toBe(new Date(now).toISOString());
    expect(JSON.parse(recovered.settlement_json)).toMatchObject({
      kind: "unknown",
      observedAt: new Date(now).toISOString(),
    });
    expect(JSON.parse(recovered.settlement_json)).not.toHaveProperty("outcome");
  });

  it("projects current-generation capacity during recovery without mutating it", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const path = join(root, "authority.sqlite");
    const authority = createAuthority(path, "model-gateway-ingress", "gateway");
    authority.acquireAccountCapacity(capacityInput("gateway"));
    const beforeDatabase = new Database(path, { readonly: true, strict: true });
    const before = beforeDatabase.query<{ owner_id: string; owner_generation: string; lifecycle_state: string; released_at: string | null }, []>(
      "SELECT owner_id,owner_generation,lifecycle_state,released_at FROM account_leases WHERE runtime_invocation_id='gateway'",
    ).get();
    beforeDatabase.close();

    expect(authority.recoverAccountCapacity()).toMatchObject([{ runtimeInvocationId: "gateway", state: "held" }]);

    const afterDatabase = new Database(path, { readonly: true, strict: true });
    const after = afterDatabase.query<{ owner_id: string; owner_generation: string; lifecycle_state: string; released_at: string | null }, []>(
      "SELECT owner_id,owner_generation,lifecycle_state,released_at FROM account_leases WHERE runtime_invocation_id='gateway'",
    ).get();
    afterDatabase.close();
    expect(after).toEqual(before);
  });

  it("reads retained unknown outcomes after capacity is released without adopting ownership or exposing account identity", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const path = join(root, "authority.sqlite"); let now = 1_000;
    const gateway = createAuthority(path, "model-gateway-ingress", "gateway", () => now);
    const operator = createAuthority(path, "operator-session", "operator", () => now);
    gateway.acquireAccountCapacity(capacityInput("gateway"));
    gateway.fenceAccountCapacityDispatch("gateway", "gateway-fence");
    gateway.settleAccountCapacity("gateway", "gateway-fence", {
      kind: "unknown",
      reason: "transport disconnected before terminal evidence",
      observedAt: "2026-08-13T07:48:43.000Z",
    });
    operator.acquireAccountCapacity({
      ...capacityInput("operator"),
      candidates: [{ ...capacityInput("operator").candidates[0], capacityIdentity: "operator-account" }],
    });
    operator.fenceAccountCapacityDispatch("operator", "operator-fence");
    gateway.close();
    const database = new Database(path, { strict: true });
    const before = database.query<{ owner_generation: string }, []>(
      "SELECT owner_generation FROM account_leases WHERE runtime_invocation_id='gateway'",
    ).get();
    database.close();

    const incidents = readAccountOutcomeIncidents({
      path,
      participantKind: "model-gateway-ingress",
      recoveryDomain: "gateway",
    });
    expect(incidents).toMatchObject([{
      runtimeInvocationId: "gateway",
      dispatchFenceId: "gateway-fence",
      lifecycleState: "settlement-pending",
      capacityState: "released",
      settlement: {
        kind: "unknown",
        reason: "transport disconnected before terminal evidence",
      },
    }]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).not.toHaveProperty("ownerId");
    expect(incidents[0]).not.toHaveProperty("accountRef");
    expect(incidents[0]).not.toHaveProperty("capacityIdentity");
    expect(incidents[0]).not.toHaveProperty("credentialRevisionId");
    expect(incidents[0]).not.toHaveProperty("candidateRejections");
    const afterDatabase = new Database(path, { readonly: true, strict: true });
    const after = afterDatabase.query<{ owner_generation: string }, []>(
      "SELECT owner_generation FROM account_leases WHERE runtime_invocation_id='gateway'",
    ).get();
    afterDatabase.close();
    expect(after).toEqual(before);

    const corruptDatabase = new Database(path, { strict: true });
    corruptDatabase.query("UPDATE account_leases SET settlement_json=? WHERE runtime_invocation_id='gateway'").run(
      JSON.stringify({
        kind: "unknown",
        reason: "transport disconnected before terminal evidence",
        observedAt: "2026-08-13T07:48:43.000Z",
        credentialRevisionId: "must-not-project",
      }),
    );
    corruptDatabase.close();
    expect(() => readAccountOutcomeIncidents({
      path,
      participantKind: "model-gateway-ingress",
      recoveryDomain: "gateway",
    })).toThrow(/settlement is corrupt/i);
  });

  it("admits a new configuration revision when only stale account-only capacity remains", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const path = join(root, "authority.sqlite"); let now = 1_000;
    createAuthority(path, "model-gateway-ingress", "gateway", () => now).acquireAccountCapacity(capacityInput("gateway"));
    now = 2_000;
    const replacement = new SqliteManagedAccountLeaseAuthority({ path, participantKind: "model-gateway-ingress", recoveryDomain: "gateway", ownerId: "replacement", configurationRevision: "rev-2", now: () => now, ownerStaleMs: 10 });
    authorities.push(replacement);
    expect(replacement.recoverAccountCapacity()).toMatchObject([{ runtimeInvocationId: "gateway", state: "released" }]);
  });

  it("admits a new configuration revision after the old owner is stale and no capacity remains", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const path = join(root, "authority.sqlite"); let now = 1_000;
    const old = createAuthority(path, "model-gateway-ingress", "gateway", () => now);
    old.acquireAccountCapacity(capacityInput("gateway"));
    old.releaseAccountCapacityPreFence("gateway");
    now = 2_000;

    const replacement = new SqliteManagedAccountLeaseAuthority({
      path,
      participantKind: "model-gateway-ingress",
      recoveryDomain: "gateway",
      ownerId: "replacement",
      configurationRevision: "rev-2",
      now: () => now,
      ownerStaleMs: 10,
    });
    authorities.push(replacement);

    expect(replacement.recoverAccountCapacity()).toEqual([]);
  });

  it("preserves an unknown outcome while recovering stale leaked account-only capacity", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const path = join(root, "authority.sqlite"); let now = 1_000;
    const old = createAuthority(path, "model-gateway-ingress", "gateway", () => now);
    old.acquireAccountCapacity(capacityInput("gateway"));
    old.fenceAccountCapacityDispatch("gateway", "gateway-fence");
    const settlement = {
      kind: "unknown" as const,
      reason: "terminal provider evidence is unavailable",
      observedAt: "2026-08-13T08:00:00.000Z",
    };
    old.settleAccountCapacity("gateway", "gateway-fence", settlement);
    const database = new Database(path, { strict: true });
    database.query("UPDATE account_leases SET lifecycle_state='leaked',released_at=NULL WHERE runtime_invocation_id='gateway'").run();
    database.close();
    now = 2_000;
    const replacement = createAuthority(path, "model-gateway-ingress", "gateway", () => now);
    expect(replacement.recoverAccountCapacity()).toMatchObject([{
      runtimeInvocationId: "gateway",
      state: "settlement-pending",
      dispatchFenceId: "gateway-fence",
    }]);
    expect(replacement.acquireAccountCapacity(capacityInput("replacement"))).toMatchObject({ status: "acquired" });
    const after = new Database(path, { readonly: true, strict: true });
    expect(after.query<{ lifecycle_state: string; released_at: string | null; settlement_json: string }, []>(
      "SELECT lifecycle_state,released_at,settlement_json FROM account_leases WHERE runtime_invocation_id='gateway'",
    ).get()).toEqual({
      lifecycle_state: "settlement-pending",
      released_at: new Date(now).toISOString(),
      settlement_json: JSON.stringify(settlement),
    });
    after.close();
  });

  it.each(["settlement-pending", "leaked"] as const)(
    "does not let agent-task commitment recovery adopt Gateway account-only %s capacity",
    (lifecycleState) => {
      const root = mkdtempSync(join(tmpdir(), "kiln-capacity-recovery-isolation-")); roots.push(root);
      const path = join(root, "authority.sqlite");
      const gateway = createAuthority(path, "model-gateway-ingress", "gateway");
      expect(gateway.acquireAccountCapacity(capacityInput(`gateway-${lifecycleState}`)).status).toBe("acquired");
      gateway.fenceAccountCapacityDispatch(`gateway-${lifecycleState}`, `fence-${lifecycleState}`);
      gateway.settleAccountCapacity(`gateway-${lifecycleState}`, `fence-${lifecycleState}`, {
        kind: "unknown",
        reason: "terminal provider evidence is unavailable",
        observedAt: "2026-08-13T08:00:00.000Z",
      });
      gateway.close();

      const database = new Database(path, { strict: true });
      database.query(
        "UPDATE account_leases SET lifecycle_state=?,diagnostic_uris=? WHERE runtime_invocation_id=?",
      ).run(lifecycleState, JSON.stringify(["kiln://model-gateway/incidents/synthetic"]), `gateway-${lifecycleState}`);
      const before = database.query<{
        owner_id: string;
        owner_generation: string;
        lifecycle_state: string;
        diagnostic_uris: string;
      }, [string]>(
        "SELECT owner_id,owner_generation,lifecycle_state,diagnostic_uris FROM account_leases WHERE runtime_invocation_id=?",
      ).get(`gateway-${lifecycleState}`);
      database.close();

      const agentTasks = createAuthority(path, "agent-task-runtime", "agent-tasks");
      expect(agentTasks.recoverCommitments()).toEqual([]);

      const afterDatabase = new Database(path, { readonly: true, strict: true });
      const after = afterDatabase.query<{
        owner_id: string;
        owner_generation: string;
        lifecycle_state: string;
        diagnostic_uris: string;
      }, [string]>(
        "SELECT owner_id,owner_generation,lifecycle_state,diagnostic_uris FROM account_leases WHERE runtime_invocation_id=?",
      ).get(`gateway-${lifecycleState}`);
      afterDatabase.close();
      expect(after).toEqual(before);
    },
  );

  it("allows exactly one final-slot winner across real Bun processes", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-process-")); roots.push(root);
    const db = join(root, "authority.sqlite");
    const start = join(root, "start");
    const workerSource = fileURLToPath(new URL("./shared-account-capacity-worker.ts", import.meta.url));
    const workerBundle = join(root, "shared-account-capacity-worker.js");
    const build = await runProcess("bun", ["build", workerSource, "--target=bun", "--outfile", workerBundle]);
    expect({ code: build.code, stderr: build.stderr }).toEqual({ code: 0, stderr: "" });
    const ids = ["one", "two"] as const;
    const ready = ids.map((id) => join(root, `${id}.ready`));
    const result = ids.map((id) => join(root, `${id}.result`));
    const children = ids.map((id, index) => runProcess("bun", ["run", workerBundle, db, id, ready[index]!, start, result[index]!]));
    await waitFor(ready);
    writeFileSync(start, "go");
    const outcomes = await Promise.all(children);
    expect(outcomes.map(({ code, stderr }) => ({ code, stderr }))).toEqual([{ code: 0, stderr: "" }, { code: 0, stderr: "" }]);
    expect(outcomes.every(({ stdout }) => stdout === "")).toBe(true);
    expect(result.filter((path) => JSON.parse(readFileSync(path, "utf8")).status === "acquired")).toHaveLength(1);
    // This case bundles a worker with `bun build` and then starts two cold Bun
    // processes. The package default of ten seconds is sized for in-process
    // work and cannot cover that on a shared runner, where the case passed and
    // failed across consecutive runs.
  }, 60_000);
});
