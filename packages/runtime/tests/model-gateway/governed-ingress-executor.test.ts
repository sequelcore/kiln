import { describe, expect, it, vi } from "vitest";
import { createExecutionAccountRef, type ModelTurnResult } from "@kilnai/core/agents";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import { executeGovernedIngress } from "../../src/model-gateway/governed-ingress-executor.js";
import type { GovernedOneRoundInvocationPorts } from "../../src/execution-kernel/governed-one-round-invocation.js";
import { InMemoryModelGatewayReplayGuard, type ModelGatewayReplayGuard } from "../../src/model-gateway/replay-guard.js";

const route = { providerId: "fixture-provider", providerModelId: "fixture-model", scope: "fixture" };
const admission = { routeId: "fixture-route", providerId: route.providerId, providerModelId: route.providerModelId, accountSelection: { mode: "exact" as const, accountId: "account-1", source: "route" as const } };
const result: ModelTurnResult = { parts: [{ type: "text", text: "done" }], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "completed" };

async function eventually(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for assertion.");
}

function fixture(overrides: { readonly guard?: ModelGatewayReplayGuard; readonly execute?: () => Promise<ModelTurnResult>; readonly project?: () => string } = {}) {
  const dispatch = vi.fn(overrides.execute ?? (async () => result));
  const authority = new SqliteManagedAccountLeaseAuthority({ path: ":memory:", participantKind: "model-gateway-ingress", recoveryDomain: `executor-test-${crypto.randomUUID()}`, configurationRevision: "test" });
  const ports: GovernedOneRoundInvocationPorts = {
    candidateCatalog: { list: async () => ({ admission, candidates: [{ candidate: { accountId: "account-1", safety: "eligible" as const, health: "healthy" as const, quota: "available" as const, capacity: "available" as const, economicCost: { atoms: "0", scale: 0, unit: "request", scheme: { kind: "unit" as const } }, pressure: 0 }, lease: { candidate: { account: createExecutionAccountRef("account-1"), route, health: "healthy", leaseCapacity: "available", pressure: 0, reservedForNewWork: false }, capacityIdentity: "configured:fixture:account", credentialRevisionId: "a".repeat(64), usageEvidence: { health: "healthy", freshness: "missing" }, capacity: { maxConcurrency: 10, reservedAffinitySlots: 0 } } }] }) },
    accountCapacityAuthority: authority,
    attemptEvidence: { record: async () => undefined },
    dispatcherResolver: { resolve: async () => ({ dispatchOneRound: dispatch }) },
  };
  return {
    dispatch,
    input: {
      protocol: "fixture-protocol", rawBody: '{"x":1}', identity: { tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn" }, route,
      affinity: { continuity: "none" as const }, authority: { status: "admitted" as const, capabilityId: "capability", scopes: ["model.invoke"] }, budget: { status: "admitted" as const, evidenceId: "budget" }, toolExecutionMode: "caller-owned" as const,
      turn: { history: [{ role: "user" as const, parts: [{ type: "text" as const, text: "hello" }] }] }, signal: new AbortController().signal, invocationPorts: ports,
      createAttemptId: () => "attempt", createResponseId: () => "response", replayGuard: overrides.guard,
      projectSuccess: () => overrides.project?.() ?? "projected",
    },
  };
}

describe("governed ingress executor", () => {
  it("includes the protocol discriminator in the replay fingerprint", async () => {
    const delegate = new InMemoryModelGatewayReplayGuard({ hmacKey: "executor-protocol-key-with-at-least-32" });
    const fingerprint = vi.fn((input) => delegate.fingerprint(input));
    const guard: ModelGatewayReplayGuard = { fingerprint, claim: (x) => delegate.claim(x), markCommitted: (x, y) => delegate.markCommitted(x, y), settleUnknown: (x, y) => delegate.settleUnknown(x, y), complete: (x, y, z) => delegate.complete(x, y, z), abandon: (x, y) => delegate.abandon(x, y) };
    const subject = fixture({ guard });
    await executeGovernedIngress(subject.input);
    expect(fingerprint.mock.calls[0]![0].ingress).toBe("fixture-protocol");
  });

  it("abandons a precommit selection failure so a retry may dispatch", async () => {
    const guard = new InMemoryModelGatewayReplayGuard({ hmacKey: "executor-abandon-key-with-at-least-32!" });
    const subject = fixture({ guard });
    subject.input.invocationPorts.candidateCatalog.list = async () => { throw new Error("unavailable"); };
    await expect(executeGovernedIngress(subject.input)).rejects.toThrow("unavailable");
    const retry = fixture({ guard });
    await expect(executeGovernedIngress(retry.input)).resolves.toMatchObject({ kind: "success" });
  });

  it("joins concurrent claims and replays the completed projected result", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const guard = new InMemoryModelGatewayReplayGuard({ hmacKey: "executor-concurrent-key-with-at-least-32" });
    const first = fixture({ guard });
    const catalog = vi.fn(async () => { await waiting; return { admission, candidates: [{ candidate: { accountId: "account-1", safety: "eligible" as const, health: "healthy" as const, quota: "available" as const, capacity: "available" as const, economicCost: { atoms: "0", scale: 0, unit: "request", scheme: { kind: "unit" as const } }, pressure: 0 }, lease: { candidate: { account: createExecutionAccountRef("account-1"), route, health: "healthy" as const, leaseCapacity: "available" as const, pressure: 0, reservedForNewWork: false }, capacityIdentity: "configured:fixture:account", credentialRevisionId: "a".repeat(64), usageEvidence: { health: "healthy" as const, freshness: "missing" as const }, capacity: { maxConcurrency: 10, reservedAffinitySlots: 0 } } }] }; });
    first.input.invocationPorts.candidateCatalog.list = catalog;
    const pending = executeGovernedIngress(first.input);
    await eventually(() => expect(catalog).toHaveBeenCalledTimes(1));
    const joined = await executeGovernedIngress(fixture({ guard }).input);
    expect(joined).toMatchObject({ kind: "join-inflight" });
    release(); await pending;
    await expect(executeGovernedIngress(fixture({ guard }).input)).resolves.toMatchObject({ kind: "success", replayed: true });
    expect(first.dispatch).toHaveBeenCalledTimes(1);
  });

  it("settles committed unknown when projection fails after dispatch", async () => {
    const guard = new InMemoryModelGatewayReplayGuard({ hmacKey: "executor-projection-key-with-at-least-32" });
    const subject = fixture({ guard, project: () => { throw new Error("cannot project"); } });
    await expect(executeGovernedIngress(subject.input)).rejects.toThrow("committed response");
    await expect(executeGovernedIngress(fixture({ guard }).input)).resolves.toMatchObject({ kind: "committed-unknown" });
    expect(subject.dispatch).toHaveBeenCalledTimes(1);
  });

  it("wraps replay completion failure as committed and settles unknown", async () => {
    const delegate = new InMemoryModelGatewayReplayGuard({ hmacKey: "executor-complete-failure-key-at-least-32" });
    const guard: ModelGatewayReplayGuard = {
      fingerprint: (x) => delegate.fingerprint(x), claim: (x) => delegate.claim(x),
      markCommitted: (x, y) => delegate.markCommitted(x, y), settleUnknown: (x, y) => delegate.settleUnknown(x, y),
      complete: () => { throw new Error("replay backend unavailable"); },
      abandon: (x, y) => delegate.abandon(x, y),
    };
    const subject = fixture({ guard });
    await expect(executeGovernedIngress(subject.input)).rejects.toMatchObject({ code: "committed-execution-failure" });
    await expect(executeGovernedIngress(fixture({ guard }).input)).resolves.toMatchObject({ kind: "committed-unknown" });
    expect(subject.dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not abandon when the commit transition itself fails", async () => {
    const delegate = new InMemoryModelGatewayReplayGuard({ hmacKey: "executor-commit-failure-key-at-least-32" });
    let abandons = 0;
    const guard: ModelGatewayReplayGuard = { fingerprint: (x) => delegate.fingerprint(x), claim: (x) => delegate.claim(x), markCommitted: () => { throw new Error("commit unavailable"); }, settleUnknown: (x, y) => delegate.settleUnknown(x, y), complete: (x, y, z) => delegate.complete(x, y, z), abandon: (x, y) => { abandons++; delegate.abandon(x, y); } };
    await expect(executeGovernedIngress(fixture({ guard }).input)).rejects.toThrow("commit unavailable");
    expect(abandons).toBe(0);
  });
});
