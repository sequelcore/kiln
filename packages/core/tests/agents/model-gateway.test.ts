import { describe, expect, it } from "vitest";
import {
  advanceExecutionAttempt,
  createExecutionAccountRef,
  createExecutionAccountPolicyId,
  createExecutionAttempt,
  selectExecutionCapacityAccount,
  type ExecutionAccountRef,
  type ExecutionAccountCapacityCandidate,
  type ProviderModelRouteIdentity,
} from "../../src/agents/execution-routing/index.js";
import {
  dispatchOneModelRound,
  type OneRoundModelDispatchInput,
  validateModelTurn,
  validateModelTurnResult,
  type ModelTurnResult,
} from "../../src/agents/execution-routing/index.js";
import { isSameProviderModelRoute } from "../../src/agents/provider-model-evidence.js";
import { KNOWN_DELIBERATION_LEVEL_IDS } from "../../src/agents/deliberation-policy.js";

const route = (scope = "default"): ProviderModelRouteIdentity => ({
  providerId: "fixture-provider",
  providerModelId: "fixture-model",
  scope,
});

const candidate = (
  id: string,
  options: Partial<Omit<ExecutionAccountCapacityCandidate, "account" | "route">> = {},
): ExecutionAccountCapacityCandidate => ({
  account: createExecutionAccountRef(id),
  route: route(),
  health: "healthy",
  leaseCapacity: "available",
  pressure: 0,
  reservedForNewWork: false,
  ...options,
});

describe("execution account capacity selection", () => {
  it("creates one canonical opaque account policy identity", () => {
    expect(createExecutionAccountPolicyId(" managed-codex ")).toBe("managed-codex");
    expect(() => createExecutionAccountPolicyId("   ")).toThrow("ExecutionAccountPolicyId must not be empty");
  });

  it("prefers a healthy compatible existing affinity over a lower-pressure un-affined account", () => {
    const selected = selectExecutionCapacityAccount({
      route: route(),
      affinity: { account: createExecutionAccountRef("account-b"), route: route() },
      work: "existing",
      candidates: [candidate("account-a", { pressure: 0 }), candidate("account-b", { pressure: 10 })],
    });

    expect(selected).toMatchObject({ selected: { account: createExecutionAccountRef("account-b"), reason: "existing-affinity" } });
  });

  it("selects the least pressured eligible account and breaks pressure ties by opaque account identity", () => {
    const selected = selectExecutionCapacityAccount({
      route: route(),
      work: "new",
      candidates: [candidate("account-c", { pressure: 2 }), candidate("account-b", { pressure: 1 }), candidate("account-a", { pressure: 1 })],
    });

    expect(selected).toMatchObject({ selected: { account: createExecutionAccountRef("account-a"), reason: "least-pressure" } });
  });

  it("retains deterministic rejection evidence when another candidate is selected", () => {
    const selected = selectExecutionCapacityAccount({
      route: route(),
      work: "new",
      candidates: [
        candidate("account-b", { health: "unhealthy" }),
        candidate("account-a", { pressure: 0 }),
      ],
    });

    expect(selected).toEqual({
      selected: {
        account: createExecutionAccountRef("account-a"),
        route: route(),
        reason: "least-pressure",
      },
      rejections: [{
        account: createExecutionAccountRef("account-b"),
        reason: "unhealthy",
      }],
    });
  });

  it("rejects duplicate account snapshots instead of depending on input ordering", () => {
    expect(() => selectExecutionCapacityAccount({
      route: route(),
      work: "new",
      candidates: [candidate("account-a", { pressure: 1 }), candidate(" account-a ", { pressure: 2 })],
    })).toThrow("candidates must not contain duplicate accounts");
  });

  it("canonicalizes account references so whitespace cannot create a second identity", () => {
    expect(createExecutionAccountRef(" account-a ")).toBe(createExecutionAccountRef("account-a"));
    expect(() => createExecutionAccountRef("   ")).toThrow("ExecutionAccountRef must not be empty");
  });

  it("keeps accounts reserved for new work unavailable to unrelated new work while allowing their matching affinity", () => {
    const reserved = candidate("account-a", { reservedForNewWork: true });

    expect(selectExecutionCapacityAccount({ route: route(), work: "new", candidates: [reserved] })).toEqual({
      selected: undefined,
      rejections: [{ account: createExecutionAccountRef("account-a"), reason: "reserved-for-new-work" }],
    });
    expect(selectExecutionCapacityAccount({
      route: route(),
      work: "existing",
      affinity: { account: createExecutionAccountRef("account-a"), route: route() },
      candidates: [reserved],
    })).toMatchObject({ selected: { account: createExecutionAccountRef("account-a"), reason: "existing-affinity" } });
  });

  it("rejects exhausted lease capacity for both new and existing-affinity work", () => {
    const exhausted = candidate("account-a", { leaseCapacity: "unavailable" });

    expect(selectExecutionCapacityAccount({ route: route(), work: "new", candidates: [exhausted] }))
      .toMatchObject({ rejections: [{ account: "account-a", reason: "lease-conflict" }] });
    expect(selectExecutionCapacityAccount({
      route: route(),
      work: "existing",
      affinity: { account: createExecutionAccountRef("account-a"), route: route() },
      candidates: [exhausted],
    })).toMatchObject({
      rejections: [{ account: "account-a", reason: "lease-conflict" }],
      affinity: { outcome: "rejected", reason: "lease-conflict" },
    });
  });

  it("fails closed when existing work's affinity is unavailable instead of silently rebinding", () => {
    const affinity = { account: createExecutionAccountRef("account-a"), route: route() };
    const result = selectExecutionCapacityAccount({
      route: route(),
      work: "existing",
      affinity,
      candidates: [candidate("account-b", { pressure: 0 })],
    });

    expect(result).toEqual({
      selected: undefined,
      rejections: [],
      affinity: { requested: affinity, outcome: "missing", reason: "missing-affinity-account" },
    });
  });

  it("requires an explicit policy to rebind existing work and records why it was rebound", () => {
    const affinity = { account: createExecutionAccountRef("account-a"), route: route() };
    const result = selectExecutionCapacityAccount({
      route: route(),
      work: "existing",
      affinity,
      allowAffinityRebind: true,
      candidates: [candidate("account-a", { health: "unhealthy" }), candidate("account-b", { pressure: 0 })],
    });

    expect(result).toEqual({
      selected: { account: createExecutionAccountRef("account-b"), route: route(), reason: "affinity-rebind" },
      rejections: [{ account: createExecutionAccountRef("account-a"), reason: "unhealthy" }],
      affinity: {
        requested: affinity,
        outcome: "rebound",
        reason: "unhealthy",
        reboundTo: createExecutionAccountRef("account-b"),
      },
    });
  });

  it("returns explicit, deterministic rejection evidence rather than silently falling back", () => {
    const result = selectExecutionCapacityAccount({
      route: route(),
      work: "new",
      candidates: [
        candidate("account-c", { health: "unhealthy" }),
        candidate("account-a", { route: route("other") }),
        candidate("account-b", { reservedForNewWork: true }),
      ],
    });

    expect(result).toEqual({
      selected: undefined,
      rejections: [
        { account: createExecutionAccountRef("account-a"), reason: "incompatible-route" },
        { account: createExecutionAccountRef("account-b"), reason: "reserved-for-new-work" },
        { account: createExecutionAccountRef("account-c"), reason: "unhealthy" },
      ],
    });
  });

  it("rejects invalid exported selection inputs at the domain boundary", () => {
    expect(() => selectExecutionCapacityAccount({ route: route(), work: "existing", candidates: [] }))
      .toThrow("Existing work requires an affinity");
    expect(() => selectExecutionCapacityAccount({
      route: route(),
      work: "new",
      candidates: [candidate("account-a", { pressure: -1 })],
    })).toThrow("pressure must be a non-negative finite number");
    expect(() => selectExecutionCapacityAccount({
      route: { providerId: "fixture-provider", providerModelId: "", scope: "default" },
      work: "new",
      candidates: [],
    })).toThrow("route.providerModelId must not be empty");
    expect(() => selectExecutionCapacityAccount({
      route: route(),
      work: "new",
      candidates: [{ ...candidate("account-a"), account: " account-a " as ExecutionAccountRef }],
    })).toThrow("candidates[0].account must be canonical");
    expect(() => selectExecutionCapacityAccount({
      route: route(),
      work: "existing",
      affinity: { account: createExecutionAccountRef("account-a"), route: route("other") },
      candidates: [],
    })).toThrow("affinity.route must match route");
  });

  it("uses one route identity equality rule across core consumers", () => {
    expect(isSameProviderModelRoute(route(), route())).toBe(true);
    expect(isSameProviderModelRoute(route(), route("another-scope"))).toBe(false);
  });
});

describe("ExecutionAttempt", () => {
  const accountA = createExecutionAccountRef("account-a");

  it("only permits the planned -> leased -> dispatching -> committed -> terminal sequence", () => {
    const planned = createExecutionAttempt({ attemptId: "attempt-1", account: accountA });
    const leased = advanceExecutionAttempt(planned, "leased");
    const dispatching = advanceExecutionAttempt(leased, "dispatching");
    const committed = advanceExecutionAttempt(dispatching, "committed");
    const terminal = advanceExecutionAttempt(committed, "succeeded");

    expect([planned.phase, leased.phase, dispatching.phase, committed.phase, terminal.phase])
      .toEqual(["planned", "leased", "dispatching", "committed", "succeeded"]);
    expect(() => advanceExecutionAttempt(planned, "committed")).toThrow("Invalid ExecutionAttempt transition");
    expect(() => advanceExecutionAttempt(terminal, "leased")).toThrow("Invalid ExecutionAttempt transition");
  });

  it("permits explicit pre-commit failure and cancellation terminal states", () => {
    const planned = createExecutionAttempt({ attemptId: "attempt-precommit", account: accountA });
    const leased = advanceExecutionAttempt(planned, "leased");

    expect(advanceExecutionAttempt(planned, "failed").phase).toBe("failed");
    expect(advanceExecutionAttempt(leased, "cancelled").phase).toBe("cancelled");
  });

  it("rejects blank attempt identifiers at the exported creation boundary", () => {
    expect(() => createExecutionAttempt({ attemptId: " ", account: accountA })).toThrow("attemptId must not be empty");
  });
});

describe("caller-owned one-round dispatcher", () => {
  const customCall = {
    kind: "custom" as const,
    id: "call-1",
    name: "shell",
    input: { kind: "raw-text" as const, value: "echo  one\r\n  two" },
  };
  const result: ModelTurnResult = {
    parts: [{ type: "tool-call", call: customCall }],
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "tool-call",
  };
  const turn = {
    history: [{ role: "developer" as const, parts: [{ type: "text" as const, text: "fixture" }] }],
    tools: [{ kind: "custom" as const, name: "shell", description: "Run syntax", grammar: { syntax: "lark" as const, source: "start: /.+/" } }],
    toolChoice: { kind: "tool" as const, name: "shell" },
    maxOutputTokens: 10,
  };

  it("calls exactly once and preserves custom tool input byte-for-byte", async () => {
    let calls = 0;
    const input: OneRoundModelDispatchInput = {
      account: createExecutionAccountRef("account-a"), route: route(), sessionId: "session-1",
      turn,
    };

    const received = await dispatchOneModelRound({
      dispatchOneRound: async (received) => {
        calls += 1;
        expect(received).toBe(input);
        return result;
      },
    }, input);

    expect(calls).toBe(1);
    expect(received).toBe(result);
    expect(received.parts[0]).toMatchObject({ call: { input: { kind: "raw-text", value: "echo  one\r\n  two" } } });
  });

  it("rejects denied deliberation before the one-round dispatcher", async () => {
    let calls = 0;
    await expect(dispatchOneModelRound({
      dispatchOneRound: async () => {
        calls += 1;
        return result;
      },
    }, {
      account: createExecutionAccountRef("account-a"),
      route: route(),
      sessionId: "session-denied",
      turn: {
        ...turn,
        deliberationResolution: {
          status: "denied",
          requested: {
            mode: "fixed",
            preferredLevel: KNOWN_DELIBERATION_LEVEL_IDS.max,
            onUnsupported: "deny",
          },
          source: "operator",
          reason: "preferred-level-unsupported",
        },
      },
    })).rejects.toThrow("Denied deliberation cannot execute");
    expect(calls).toBe(0);
  });

  it("rejects undeclared or wrong-kind provider tool calls after the single dispatch", async () => {
    const input: OneRoundModelDispatchInput = {
      account: createExecutionAccountRef("account-a"), route: route(), sessionId: "session-1", turn,
    };
    let calls = 0;
    await expect(dispatchOneModelRound({ dispatchOneRound: async () => {
      calls += 1;
      return { ...result, parts: [{ type: "tool-call", call: { ...customCall, name: "undeclared" } }] };
    } }, input)).rejects.toThrow("declared");
    await expect(dispatchOneModelRound({ dispatchOneRound: async () => {
      calls += 1;
      return {
        ...result,
        parts: [{ type: "tool-call", call: {
          kind: "function", id: "call-wrong-kind", name: "shell",
          input: { kind: "json-object", value: {} },
        } }],
      };
    } }, input)).rejects.toThrow("kind");
    expect(calls).toBe(2);
  });

  it("validates unique tools, finite JSON, and function input objects", () => {
    expect(() => validateModelTurn({ ...turn, tools: [...turn.tools, turn.tools[0]!] })).toThrow("unique");
    expect(() => validateModelTurn({
      history: [],
      tools: [{ kind: "function", name: "lookup", inputSchema: { type: "object", limit: Number.NaN } }],
    })).toThrow("finite");
    expect(() => validateModelTurn({
      history: [{ role: "assistant", parts: [{
        type: "tool-call", call: {
          kind: "function", id: "call-json", name: "lookup",
          input: { kind: "json-object", value: [] as never },
        },
      }] }],
      tools: [{ kind: "function", name: "lookup", inputSchema: { type: "object" } }],
    })).toThrow("JSON object");
  });

  it("uses namespace plus name as the identity of caller-owned function tools", () => {
    const namespacedTurn = {
      history: [{ role: "assistant" as const, parts: [{
        type: "tool-call" as const,
        call: { kind: "function" as const, namespace: "files", id: "call-read", name: "read", input: { kind: "json-object" as const, value: {} } },
      }] }],
      tools: [
        { kind: "function" as const, namespace: "files", name: "read", inputSchema: {} },
        { kind: "function" as const, namespace: "database", name: "read", inputSchema: {} },
      ],
      toolChoice: { kind: "tool" as const, namespace: "files", name: "read" },
    };

    expect(() => validateModelTurn(namespacedTurn)).not.toThrow();
    expect(() => validateModelTurn({
      ...namespacedTurn,
      toolChoice: { kind: "tool", namespace: "missing", name: "read" },
    })).toThrow("exist");
    expect(() => validateModelTurn({ ...namespacedTurn, tools: [...namespacedTurn.tools, namespacedTurn.tools[0]!] })).toThrow("unique");
  });

  it("requires tool results to match an earlier call id and kind without nesting", () => {
    expect(() => validateModelTurn({
      history: [{ role: "user", parts: [{ type: "tool-result", callId: "missing", content: [{ type: "text", text: "done" }] }] }],
    })).toThrow("prior tool call");
    expect(() => validateModelTurn({
      history: [
        { role: "assistant", parts: [{ type: "tool-call", call: customCall }] },
        { role: "user", parts: [{ type: "tool-result", callId: "call-1", content: [{ type: "text", text: "done" }] }] },
        { role: "user", parts: [{ type: "tool-result", callId: "call-1", content: [{ type: "text", text: "again" }] }] },
      ],
    })).toThrow("duplicates");
    expect(() => validateModelTurn({
      history: [
        { role: "assistant", parts: [{ type: "tool-call", call: customCall }] },
        { role: "user", parts: [{ type: "tool-result", callId: "call-1", content: [{ type: "tool-result" }] as never }] },
      ],
    })).toThrow("nested");
    expect(() => validateModelTurn({
      history: [
        { role: "assistant", parts: [{ type: "tool-call", call: customCall }] },
        { role: "user", parts: [{ type: "tool-result", callId: "call-1", isError: "yes" as never, content: [] }] },
      ],
    })).toThrow("isError");
  });

  it("allows only assistant tool calls followed by user tool results", () => {
    for (const role of ["user", "developer"] as const) {
      expect(() => validateModelTurn({
        history: [{ role, parts: [{ type: "tool-call", call: customCall }] }],
      })).toThrow("assistant-only");
    }
    for (const role of ["assistant", "developer"] as const) {
      expect(() => validateModelTurn({
        history: [
          { role: "assistant", parts: [{ type: "tool-call", call: customCall }] },
          { role, parts: [{ type: "tool-result", callId: "call-1", content: [{ type: "text", text: "done" }] }] },
        ],
      })).toThrow("user-only");
    }
    expect(() => validateModelTurn({
      history: [
        { role: "assistant", parts: [{ type: "tool-call", call: customCall }] },
        { role: "user", parts: [{ type: "tool-result", callId: "call-1", content: [{ type: "text", text: "done" }] }] },
      ],
    })).not.toThrow();
  });

  it("accepts portable reasoning summaries and rejects invalid result usage", () => {
    expect(() => validateModelTurn({
      history: [{ role: "assistant", parts: [{ type: "reasoning-summary", text: "Checked constraints." }] }],
    })).not.toThrow();
    expect(() => validateModelTurnResult({ ...result, usage: { ...result.usage, outputTokens: Number.POSITIVE_INFINITY } }))
      .toThrow("finite");
    expect(() => validateModelTurn({
      history: [{ role: "user", parts: [{ type: "reasoning-summary", text: "not model reasoning" }] }],
    })).toThrow("assistant");
    expect(() => validateModelTurnResult({ ...result, usage: { inputTokens: 1 } as never })).toThrow("usage.outputTokens");
  });

  it("validates protocol-neutral response, deliberation, summary, and tool options", () => {
    expect(() => validateModelTurn({
      ...turn,
      instructions: "Stay concise.",
      parallelToolCalls: false,
      responseFormat: { kind: "json-schema", name: "answer", strict: true, schema: { type: "object" } },
      deliberationResolution: {
        status: "exact",
        requested: {
          mode: "fixed",
          preferredLevel: KNOWN_DELIBERATION_LEVEL_IDS.high,
          onUnsupported: "deny",
        },
        selectedLevel: KNOWN_DELIBERATION_LEVEL_IDS.high,
        source: "operator",
        capabilityEvidence: {
          sourceIdentity: "fixture-catalog",
          sourceRevision: "1",
          observedAt: "2026-08-02T00:00:00.000Z",
        },
      },
      reasoningSummary: "concise",
      textVerbosity: "low",
    })).not.toThrow();
    expect(() => validateModelTurn({ ...turn, parallelToolCalls: "yes" as never })).toThrow("parallelToolCalls");
    expect(() => validateModelTurn({ ...turn, tools: [{ ...turn.tools[0]!, description: 42 as never }] })).toThrow("description");
    expect(() => validateModelTurn({ ...turn, textVerbosity: "verbose" as never })).toThrow("textVerbosity");
  });

  it("accepts URL images without invented media types and requires media type for base64", () => {
    expect(() => validateModelTurn({
      history: [{ role: "user", parts: [{ type: "image", source: { kind: "url", url: "https://fixture.invalid/image" } }] }],
    })).not.toThrow();
    expect(() => validateModelTurn({
      history: [{ role: "user", parts: [{ type: "image", source: { kind: "base64", data: "AAAA" } } as never] }],
    })).toThrow("mediaType");
  });
});
