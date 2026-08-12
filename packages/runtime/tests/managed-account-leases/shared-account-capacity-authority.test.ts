import { afterEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { createAccountRef } from "@kilnai/core";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";

const roots: string[] = [];
const authorities: SqliteManagedAccountLeaseAuthority[] = [];

afterEach(() => {
  for (const authority of authorities.splice(0)) authority.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createAuthority(
  path: string,
  kind: "managed-job-runtime" | "model-gateway-ingress" | "operator-session",
  domain = kind,
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
    accountPolicyId: "policy",
    route,
    candidates: [{
      candidate: { account: createAccountRef("configured:account"), route, health: "healthy" as const, leaseCapacity: "available" as const, pressure: 0, reservedForNewWork: false },
      capacityIdentity: "stable-account",
      credentialRevisionId: revision,
      usageEvidence: { health: "healthy" as const, freshness: "missing" as const },
      capacity: { maxConcurrency: 1, reservedAffinitySlots: 0 },
    }],
  } as const;
}

async function waitFor(paths: readonly string[]): Promise<void> {
  const deadline = Date.now() + 10_000;
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
  it("shares physical maxConcurrency across recovery participants and credential revisions", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-"));
    roots.push(root);
    const path = join(root, "authority.sqlite");
    const managed = createAuthority(path, "managed-job-runtime");
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

  it("adopts retained account-only capacity and fences the stale generation", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const path = join(root, "authority.sqlite"); let now = 1_000;
    const old = createAuthority(path, "model-gateway-ingress", "gateway", () => now);
    old.acquireAccountCapacity(capacityInput("gateway"));
    now = 2_000;
    const replacement = createAuthority(path, "model-gateway-ingress", "gateway", () => now);
    expect(replacement.recoverAccountCapacity()).toHaveLength(1);
    expect(() => old.fenceAccountCapacityDispatch("gateway", "old-fence")).toThrow(/stale|ownership/i);
    expect(replacement.fenceAccountCapacityDispatch("gateway", "new-fence").state).toBe("dispatch-fenced");
  });

  it("fails closed when retained recovery state has a different configuration revision", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const path = join(root, "authority.sqlite"); let now = 1_000;
    createAuthority(path, "model-gateway-ingress", "gateway", () => now).acquireAccountCapacity(capacityInput("gateway"));
    now = 2_000;
    expect(() => new SqliteManagedAccountLeaseAuthority({ path, participantKind: "model-gateway-ingress", recoveryDomain: "gateway", ownerId: "replacement", configurationRevision: "rev-2", now: () => now, ownerStaleMs: 10 }))
      .toThrow(/configuration revision/i);
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

  it("fails closed when account-only recovery encounters an anomalous consuming state", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-capacity-")); roots.push(root);
    const path = join(root, "authority.sqlite");
    const old = createAuthority(path, "model-gateway-ingress", "gateway");
    old.acquireAccountCapacity(capacityInput("gateway"));
    old.close();
    const database = new Database(path, { strict: true });
    database.query("UPDATE account_leases SET lifecycle_state='leaked' WHERE runtime_invocation_id='gateway'").run();
    database.close();
    const replacement = createAuthority(path, "model-gateway-ingress", "gateway");
    expect(() => replacement.recoverAccountCapacity()).toThrow(/unsupported consuming state leaked/i);
  });

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
  });
});
