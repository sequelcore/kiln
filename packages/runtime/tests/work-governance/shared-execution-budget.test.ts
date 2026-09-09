import { afterEach, describe, expect, it, vi } from "vitest";
import { textParts } from "@kilnai/core/engine";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { makeProvider, makeSession } from "../session/runtime-session-orchestrator-tools-test-fixture.js";
import { adoptBoundedWorkExecutionBudgetRevision, normalizeBoundedWorkExecutionBudgetRevision, normalizeBoundedWorkContractRevision } from "@kilnai/core/work-governance";
import { SqliteBoundedWorkAuthority } from "../../src/work-governance/sqlite-bounded-work-authority.js";
import { createRuntimeSharedExecutionBudgetScope, createRuntimeSharedExecutionBudgetScopeReference } from "../../src/work-governance/runtime-shared-execution-budget.js";

const authorities: SqliteBoundedWorkAuthority[] = [];
afterEach(() => { for (const authority of authorities.splice(0)) authority.close(); });
function fixture() {
  const authority = new SqliteBoundedWorkAuthority({ path: ":memory:" });
  authorities.push(authority);
  const revision = adoptBoundedWorkExecutionBudgetRevision({
    accountingLineageId: "run", adoptedAt: "2026-09-08T00:00:00.000Z",
    adoptedBy: { kind: "operator", actorId: "operator", decisionId: "decision" },
    limits: { maxExecutionAttempts: 1, maxManagedInvocations: 1, maxConcurrentManagedInvocations: 1, maxChildDepth: 1, maxReviewRounds: 0, maxRemediationRounds: 0, maxToolCalls: 32 },
    policy: { budgetExhaustion: "stop" },
  });
  const scope = createRuntimeSharedExecutionBudgetScope({ authority, projectRuntimeId: "project", goalRunId: "run", workItemId: "item", contractRevision: revision, route: { routeId: "route", harnessId: "runtime" }, harnessCapability: "authoritative", limits: { maximumManagedChildren: 1, maximumToolCalls: 32 } });
  return { authority, revision, scope };
}
const child = (invocationId: string) => ({ parentSessionId: "parent", goalRunId: "run", workItemId: "item", invocationId, routeId: "route", harnessId: "runtime", workspaceRoot: ".", routeWriteAllowedPaths: [], routeWriteDeniedPaths: [], writeRequested: false, requestedEffects: [], childDepth: 1 as const });
describe("shared execution budget", () => {
  it("enforces 20 parent plus 12 child logical calls through real orchestrators even when a per-call envelope omits the budget", async () => {
    const { scope } = fixture();
    const execute = vi.fn().mockResolvedValue("read evidence");
    async function run(count: number) {
      const provider = makeProvider();
      vi.mocked(provider.createMessage).mockResolvedValueOnce({ parts: [], inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, stopReason: "tool_use", toolCalls: Array.from({ length: count }, (_, i) => ({ id: `call-${i}`, name: "read", input: { path: `${i}` } })) });
      const orchestrator = new RuntimeSessionOrchestrator({ provider, sharedExecutionBudget: scope, tools: [{ name: "read", description: "read", inputSchema: {}, tags: new Set() }], builtinTools: new Map([["read", execute]]) });
      return orchestrator.processMessage(makeSession(), textParts("read"), undefined, undefined, { executionEnvelope: {} });
    }
    await run(20);
    await run(12);
    const before = execute.mock.calls.length;
    const denied = await run(1);
    expect(before).toBe(32);
    expect(execute).toHaveBeenCalledTimes(32);
    expect(denied).toMatchObject({ outcome: "paused", dispositionReason: "tool_call_limit" });
    expect(scope.snapshot().accounting?.toolCalls).toEqual({ kind: "observed", value: 32 });
  });
  it("counts parent 20 plus child 12 without formal verification and denies the next batch and replay", () => {
    const { scope } = fixture();
    const first = { sessionId: "parent", turnId: "turn", toolCallScopeId: "batch", toolCallCount: 20 };
    expect(scope.reserveToolBatch(first).admitted).toBe(true);
    expect(scope.reserveToolBatch({ ...first, sessionId: "child", toolCallCount: 12 }).admitted).toBe(true);
    expect(scope.reserveToolBatch({ ...first, toolCallScopeId: "next", toolCallCount: 1 }).admitted).toBe(false);
    expect(scope.reserveToolBatch(first).admitted).toBe(false);
    expect(scope.snapshot()).toMatchObject({ accounting: { toolCalls: { kind: "observed", value: 32 } }, settlement: { status: "settled" } });
  });
  it("denies concurrent and sequential second children while terminal settlement only releases active capacity", async () => {
    const { scope } = fixture();
    const admissions = await Promise.all(["a", "b"].map(async id => scope.admitManagedInvocation(child(id))));
    expect(admissions.filter(a => a.admitted)).toHaveLength(1);
    const first = admissions.find(a => a.admitted);
    if (!first?.admitted) throw new Error("missing admission");
    first.lifecycle.markDispatched("dispatch");
    first.lifecycle.settleTerminal("completed", `sha256:${"a".repeat(64)}`);
    expect(scope.admitManagedInvocation(child("c")).admitted).toBe(false);
    expect(scope.snapshot()).toMatchObject({ accounting: { managedInvocations: 1, activeManagedInvocations: 0 }, settlement: { status: "settled" } });
  });
  it("releases proven pre-dispatch cancellation but retains unknown dispatched children", () => {
    const { scope } = fixture();
    const first = scope.admitManagedInvocation(child("a"));
    if (!first.admitted) throw new Error("missing admission");
    first.lifecycle.releaseBeforeDispatch();
    const second = scope.admitManagedInvocation(child("b"));
    if (!second.admitted) throw new Error("missing second admission");
    second.lifecycle.markDispatched("dispatch");
    second.lifecycle.settleUnknown("startup result unknown");
    expect(scope.admitManagedInvocation(child("c")).admitted).toBe(false);
    expect(scope.snapshot()).toMatchObject({ accounting: { managedInvocations: 1, activeManagedInvocations: 1 }, settlement: { status: "reconciliation_required" } });
  });
  it("rejects unbound references, rebinding, altered limits and forged revision content", () => {
    const { scope, revision } = fixture();
    const reference = createRuntimeSharedExecutionBudgetScopeReference();
    expect(() => reference.assertBound()).toThrow();
    reference.bind(scope);
    expect(() => reference.bind(scope)).toThrow();
    expect(() => reference.assertCompatibleLimits({ maximumManagedChildren: 2, maximumToolCalls: 32 })).toThrow();
    expect(() => normalizeBoundedWorkExecutionBudgetRevision({ ...revision, limits: { ...revision.limits, maxToolCalls: 33 } })).toThrow();
    // A budget revision is never a goal contract or candidate-acceptance contract.
    // @ts-expect-error Resource budgets cannot cross the goal contract boundary.
    expect(() => normalizeBoundedWorkContractRevision(revision)).toThrow();
  });
});
