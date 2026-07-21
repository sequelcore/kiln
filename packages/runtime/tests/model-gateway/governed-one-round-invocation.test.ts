import { describe, expect, it } from "vitest";
import { createAccountRef, type ModelGatewayAccountCandidate, type ModelGatewayRoute, type ModelTurnResult } from "@kilnai/core";
import {
  GovernedOneRoundCommittedError,
  GovernedOneRoundInvocationError,
  invokeGovernedOneRound,
  type GovernedOneRoundInvocationPorts,
} from "../../src/model-gateway/governed-one-round-invocation.js";

const route: ModelGatewayRoute = { providerId: "fixture-provider", providerModelId: "fixture-model", scope: "fixture" };
const candidate = (id: string): ModelGatewayAccountCandidate => ({
  account: createAccountRef(id), route, health: "healthy", pressure: 0, reservedForNewWork: false,
});
const customInput = "echo  one\r\n  two";
const modelResult: ModelTurnResult = {
  parts: [{ type: "tool-call", call: { kind: "custom", id: "call-1", name: "native_tool", input: { kind: "raw-text", value: customInput } } }],
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stopReason: "tool-call",
};

function ports(overrides: Partial<GovernedOneRoundInvocationPorts> = {}): GovernedOneRoundInvocationPorts & { readonly events: string[]; readonly calls: number } {
  const events: string[] = [];
  let calls = 0;
  return {
    candidateCatalog: { list: async () => [candidate("account-a")] },
    affinityStore: { read: async () => undefined, write: async () => undefined },
    accountLease: { acquire: async () => ({ leaseId: "lease-1" }), release: async () => undefined },
    attemptEvidence: { record: async (event) => { events.push(event.phase); } },
    dispatcherResolver: { resolve: async () => ({ dispatchOneRound: async () => { calls += 1; return modelResult; } }) },
    ...overrides,
    events,
    get calls() { return calls; },
  };
}

const input = () => ({
  attemptId: "attempt-1",
  identity: { tenantId: "tenant-1", applicationId: "app-1", callerId: "caller-1", sessionId: "session-1", turnId: "turn-1" },
  route,
  authority: { status: "admitted" as const, capabilityId: "cap-1", scopes: ["model.invoke"] },
  budget: { status: "admitted" as const, evidenceId: "budget-1" },
  affinity: { key: "session-route", continuity: "prefer" as const },
  toolExecutionMode: "caller-owned" as const,
  turn: {
    history: [{ role: "developer" as const, parts: [{ type: "text" as const, text: "fixture system" }] }],
    tools: [{ kind: "custom" as const, name: "native_tool", grammar: { syntax: "lark" as const, source: "start: /.+/" } }],
    toolChoice: { kind: "tool" as const, name: "native_tool" },
    responseFormat: { kind: "json-schema" as const, name: "answer", schema: { type: "object" }, strict: true },
    reasoning: { effort: "low" as const }, textVerbosity: "high" as const, maxOutputTokens: 10,
  },
});

describe("invokeGovernedOneRound", () => {
  it("dispatches exactly once, returns caller-owned tool calls, and never needs a tool executor", async () => {
    const fixture = ports();
    const result = await invokeGovernedOneRound(input(), fixture);

    expect(fixture.calls).toBe(1);
    expect(result.result.parts).toBe(modelResult.parts);
    expect(result.result.parts[0]).toMatchObject({ call: { input: { kind: "raw-text", value: customInput } } });
    expect(fixture.events).toEqual(["planned", "leased", "dispatching", "committed", "succeeded"]);
  });

  it("passes canonical custom call input to the dispatcher byte-for-byte", async () => {
    let receivedInput: string | undefined;
    let receivedVerbosity: string | undefined;
    let dispatches = 0;
    const customCall = { kind: "custom" as const, id: "prior-call", name: "native_tool", input: { kind: "raw-text" as const, value: customInput } };
    const fixture = ports({ dispatcherResolver: { resolve: async () => ({
      dispatchOneRound: async (request) => {
        dispatches += 1;
        const part = request.turn.history[0]?.parts[0];
        receivedInput = part?.type === "tool-call" && part.call.kind === "custom" ? part.call.input.value : undefined;
        receivedVerbosity = request.turn.textVerbosity;
        return modelResult;
      },
    }) } });

    await invokeGovernedOneRound({
      ...input(),
      turn: {
        ...input().turn,
        history: [
          { role: "assistant", parts: [{ type: "tool-call", call: customCall }] },
          { role: "user", parts: [{ type: "tool-result", callId: "prior-call", content: [{ type: "text", text: "done" }] }] },
        ],
      },
    }, fixture);

    expect(dispatches).toBe(1);
    expect(receivedInput).toBe(customInput);
    expect(receivedVerbosity).toBe("high");
  });

  it("fails closed for unavailable affinity unless explicit rebind is admitted", async () => {
    const affinity = { account: createAccountRef("missing-account"), route };
    const closed = ports({ affinityStore: { read: async () => affinity, write: async () => undefined } });
    await expect(invokeGovernedOneRound({ ...input(), affinity: { key: "session-route", continuity: "require" } }, closed))
      .rejects.toMatchObject({ code: "no-eligible-account" });

    const rebound = ports({ affinityStore: { read: async () => affinity, write: async () => undefined } });
    const result = await invokeGovernedOneRound({ ...input(), affinity: { key: "session-route", continuity: "require", allowRebind: true } }, rebound);
    expect(result.selection.selected).toMatchObject({ account: createAccountRef("account-a"), reason: "affinity-rebind" });
  });

  it("fails closed on a lease conflict before resolving or calling a dispatcher", async () => {
    const fixture = ports({ accountLease: { acquire: async () => undefined, release: async () => undefined } });
    await expect(invokeGovernedOneRound(input(), fixture)).rejects.toMatchObject({ code: "lease-conflict" });
    expect(fixture.calls).toBe(0);
    expect(fixture.events).toEqual(["planned"]);
  });

  it("records failure when dispatcher resolution fails before dispatch", async () => {
    const fixture = ports({ dispatcherResolver: { resolve: async () => { throw new Error("unavailable"); } } });
    await expect(invokeGovernedOneRound(input(), fixture)).rejects.toThrow("unavailable");
    expect(fixture.events).toEqual(["planned", "leased", "failed"]);
    expect(fixture.calls).toBe(0);
  });

  it("cancels before dispatch without resolving a dispatcher", async () => {
    const controller = new AbortController(); controller.abort();
    const fixture = ports();
    await expect(invokeGovernedOneRound({ ...input(), signal: controller.signal }, fixture))
      .rejects.toMatchObject({ code: "aborted" });
    expect(fixture.events).toEqual(["planned", "leased", "cancelled"]);
    expect(fixture.calls).toBe(0);
  });

  it("commits before provider failure and does not retry another account", async () => {
    let releases = 0;
    let affinityWrites = 0;
    const fixture = ports({
      dispatcherResolver: { resolve: async () => ({ dispatchOneRound: async () => { throw new Error("provider failed"); } }) },
      affinityStore: { read: async () => undefined, write: async () => { affinityWrites += 1; } },
    });
    const withRelease = { ...fixture, accountLease: { acquire: fixture.accountLease.acquire, release: async () => { releases += 1; } } };
    const failure = await invokeGovernedOneRound(input(), withRelease).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GovernedOneRoundCommittedError);
    expect(failure).toMatchObject({ cause: { message: "provider failed" }, retryable: false });
    expect(fixture.events).toEqual(["planned", "leased", "dispatching", "committed", "failed"]);
    expect(fixture.calls).toBe(0);
    expect(releases).toBe(1);
    expect(affinityWrites).toBe(0);
  });

  it("runs the committed lifecycle hook immediately before dispatch and treats hook failure as committed unknown", async () => {
    const order: string[] = [];
    const fixture = ports({
      attemptEvidence: { record: async ({ phase }) => { order.push(`evidence:${phase}`); } },
      dispatcherResolver: { resolve: async () => ({ dispatchOneRound: async () => { order.push("provider"); return modelResult; } }) },
    });
    await invokeGovernedOneRound({ ...input(), lifecycle: { afterCommittedBeforeDispatch: () => { order.push("hook"); } } }, fixture);
    expect(order.indexOf("evidence:committed")).toBeLessThan(order.indexOf("hook"));
    expect(order.indexOf("hook")).toBeLessThan(order.indexOf("provider"));

    const failed = ports();
    const error = await invokeGovernedOneRound({
      ...input(),
      lifecycle: { afterCommittedBeforeDispatch: () => { throw new Error("guard unavailable"); } },
    }, failed).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GovernedOneRoundCommittedError);
    expect(failed.calls).toBe(0);
    expect(failed.events).toEqual(["planned", "leased", "dispatching", "committed", "failed"]);
  });

  it("rejects non-caller-owned or denied authority before any port work", async () => {
    const fixture = ports();
    await expect(invokeGovernedOneRound({ ...input(), toolExecutionMode: "kiln-owned" }, fixture))
      .rejects.toMatchObject({ code: "tool-execution-mode" });
    await expect(invokeGovernedOneRound({ ...input(), authority: { status: "denied", capabilityId: "cap-1", scopes: [] } }, fixture))
      .rejects.toMatchObject({ code: "authority-denied" });
    await expect(invokeGovernedOneRound({ ...input(), budget: { status: "denied", evidenceId: "budget-2" } }, fixture))
      .rejects.toMatchObject({ code: "budget-denied" });
    expect(fixture.events).toEqual([]);
  });

  it("rejects malformed route and budget input before catalog, affinity, or lease work", async () => {
    const fixture = ports();
    await expect(invokeGovernedOneRound({ ...input(), route: { ...route, providerModelId: "" } }, fixture))
      .rejects.toMatchObject({ code: "invalid-input" });
    await expect(invokeGovernedOneRound({ ...input(), turn: { ...input().turn, maxOutputTokens: 0 } }, fixture))
      .rejects.toMatchObject({ code: "invalid-input" });
    expect(fixture.events).toEqual([]);
  });

  it("emits secret-free serializable evidence", async () => {
    const recorded: unknown[] = [];
    const fixture = ports({ attemptEvidence: { record: async (event) => { recorded.push(event); } } });
    await invokeGovernedOneRound(input(), fixture);
    const serialized = JSON.stringify(recorded);
    expect(serialized).not.toMatch(/token|secret|authorization|password/i);
    expect(JSON.parse(serialized)).toHaveLength(5);
    expect(recorded[0]).toMatchObject({ callerId: "caller-1" });
  });

  it("uses caller-owned attempt ids so two attempts for one turn remain distinct", async () => {
    const attemptIds: string[] = [];
    const fixture = ports({ attemptEvidence: { record: async (event) => { attemptIds.push(event.attemptId); } } });

    await invokeGovernedOneRound({ ...input(), attemptId: "attempt-a" }, fixture);
    await invokeGovernedOneRound({ ...input(), attemptId: "attempt-b" }, fixture);

    expect(new Set(attemptIds)).toEqual(new Set(["attempt-a", "attempt-b"]));
  });

  it("records planned before lease acquisition", async () => {
    const order: string[] = [];
    const fixture = ports({
      attemptEvidence: { record: async (event) => { order.push(`evidence:${event.phase}`); } },
      accountLease: {
        acquire: async () => { order.push("lease:acquire"); return { leaseId: "lease-1" }; },
        release: async () => { order.push("lease:release"); },
      },
    });

    await invokeGovernedOneRound(input(), fixture);
    expect(order.slice(0, 3)).toEqual(["evidence:planned", "lease:acquire", "evidence:leased"]);
  });

  it("does not read or write affinity when continuity is none and returns no affinity", async () => {
    let reads = 0; let writes = 0;
    const fixture = ports({ affinityStore: {
      read: async () => { reads += 1; return undefined; },
      write: async () => { writes += 1; },
    } });

    const result = await invokeGovernedOneRound({ ...input(), affinity: { continuity: "none" } }, fixture);
    expect({ reads, writes, affinity: result.affinity }).toEqual({ reads: 0, writes: 0, affinity: undefined });
  });

  it("preserves a committed response when affinity and terminal evidence closeout fail", async () => {
    const fixture = ports({
      affinityStore: { read: async () => undefined, write: async () => { throw new Error("store unavailable"); } },
      attemptEvidence: { record: async (event) => { if (event.phase === "succeeded") throw new Error("sink unavailable"); } },
    });

    const result = await invokeGovernedOneRound(input(), fixture);
    expect(result.result).toBe(modelResult);
    expect(result.closeout).toEqual({
      status: "incomplete",
      diagnostics: [
        { code: "affinity-write-failed", phase: "committed" },
        { code: "terminal-evidence-failed", phase: "succeeded" },
      ],
    });
  });

  it("does not let lease release failure mask committed success or provider failure", async () => {
    const releaseFails = { acquire: async () => ({ leaseId: "lease-1" }), release: async () => { throw new Error("release unavailable"); } };
    const success = await invokeGovernedOneRound(input(), ports({ accountLease: releaseFails }));
    expect(success.result).toBe(modelResult);
    expect(success.closeout.diagnostics).toContainEqual({ code: "lease-release-failed", phase: "succeeded" });

    const failure = await invokeGovernedOneRound(input(), ports({
      accountLease: releaseFails,
      dispatcherResolver: { resolve: async () => ({ dispatchOneRound: async () => { throw new Error("provider failed"); } }) },
    })).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GovernedOneRoundCommittedError);
    expect(failure).toMatchObject({
      cause: { message: "provider failed" },
      diagnostics: [{ code: "lease-release-failed", phase: "failed" }],
    });
  });

  it("validates the caller-owned attempt id before catalog work", async () => {
    let catalogCalls = 0;
    const fixture = ports({ candidateCatalog: { list: async () => { catalogCalls += 1; return [candidate("account-a")]; } } });
    await expect(invokeGovernedOneRound({ ...input(), attemptId: " " }, fixture))
      .rejects.toMatchObject({ code: "invalid-input" });
    expect(catalogCalls).toBe(0);
  });

  it("validates caller identity before catalog work", async () => {
    let catalogCalls = 0;
    const fixture = ports({ candidateCatalog: { list: async () => { catalogCalls += 1; return [candidate("account-a")]; } } });
    await expect(invokeGovernedOneRound({ ...input(), identity: { ...input().identity, callerId: " " } }, fixture))
      .rejects.toMatchObject({ code: "invalid-input" });
    expect(catalogCalls).toBe(0);
  });
});
