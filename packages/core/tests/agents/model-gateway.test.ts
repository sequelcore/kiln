import { describe, expect, it } from "vitest";
import {
  advanceAttemptCommit,
  createAccountRef,
  createAttemptCommit,
  reassignAttemptAccount,
  reserveAccountForNewWork,
  selectModelGatewayAccount,
  type AccountRef,
  type ModelGatewayAccountCandidate,
  type ModelGatewayRoute,
} from "../../src/agents/model-gateway/index.js";
import { isSameProviderModelRoute } from "../../src/agents/provider-model-evidence.js";

const route = (scope = "default"): ModelGatewayRoute => ({
  providerId: "fixture-provider",
  providerModelId: "fixture-model",
  scope,
});

const candidate = (
  id: string,
  options: Partial<Omit<ModelGatewayAccountCandidate, "account" | "route">> = {},
): ModelGatewayAccountCandidate => ({
  account: createAccountRef(id),
  route: route(),
  health: "healthy",
  pressure: 0,
  reservedForNewWork: false,
  ...options,
});

describe("model gateway account selection", () => {
  it("prefers a healthy compatible existing affinity over a lower-pressure un-affined account", () => {
    const selected = selectModelGatewayAccount({
      route: route(),
      affinity: { account: createAccountRef("account-b"), route: route() },
      work: "existing",
      candidates: [candidate("account-a", { pressure: 0 }), candidate("account-b", { pressure: 10 })],
    });

    expect(selected).toMatchObject({ selected: { account: createAccountRef("account-b"), reason: "existing-affinity" } });
  });

  it("selects the least pressured eligible account and breaks pressure ties by opaque account identity", () => {
    const selected = selectModelGatewayAccount({
      route: route(),
      work: "new",
      candidates: [candidate("account-c", { pressure: 2 }), candidate("account-b", { pressure: 1 }), candidate("account-a", { pressure: 1 })],
    });

    expect(selected).toMatchObject({ selected: { account: createAccountRef("account-a"), reason: "least-pressure" } });
  });

  it("rejects duplicate account snapshots instead of depending on input ordering", () => {
    expect(() => selectModelGatewayAccount({
      route: route(),
      work: "new",
      candidates: [candidate("account-a", { pressure: 1 }), candidate(" account-a ", { pressure: 2 })],
    })).toThrow("candidates must not contain duplicate accounts");
  });

  it("canonicalizes account references so whitespace cannot create a second identity", () => {
    expect(createAccountRef(" account-a ")).toBe(createAccountRef("account-a"));
    expect(() => createAccountRef("   ")).toThrow("AccountRef must not be empty");
  });

  it("keeps accounts reserved for new work unavailable to unrelated new work while allowing their matching affinity", () => {
    const reserved = candidate("account-a", { reservedForNewWork: true });

    expect(selectModelGatewayAccount({ route: route(), work: "new", candidates: [reserved] })).toEqual({
      selected: undefined,
      rejections: [{ account: createAccountRef("account-a"), reason: "reserved-for-new-work" }],
    });
    expect(selectModelGatewayAccount({
      route: route(),
      work: "existing",
      affinity: { account: createAccountRef("account-a"), route: route() },
      candidates: [reserved],
    })).toMatchObject({ selected: { account: createAccountRef("account-a"), reason: "existing-affinity" } });
  });

  it("fails closed when existing work's affinity is unavailable instead of silently rebinding", () => {
    const affinity = { account: createAccountRef("account-a"), route: route() };
    const result = selectModelGatewayAccount({
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
    const affinity = { account: createAccountRef("account-a"), route: route() };
    const result = selectModelGatewayAccount({
      route: route(),
      work: "existing",
      affinity,
      allowAffinityRebind: true,
      candidates: [candidate("account-a", { health: "unhealthy" }), candidate("account-b", { pressure: 0 })],
    });

    expect(result).toEqual({
      selected: { account: createAccountRef("account-b"), route: route(), reason: "affinity-rebind" },
      rejections: [{ account: createAccountRef("account-a"), reason: "unhealthy" }],
      affinity: {
        requested: affinity,
        outcome: "rebound",
        reason: "unhealthy",
        reboundTo: createAccountRef("account-b"),
      },
    });
  });

  it("returns explicit, deterministic rejection evidence rather than silently falling back", () => {
    const result = selectModelGatewayAccount({
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
        { account: createAccountRef("account-a"), reason: "incompatible-route" },
        { account: createAccountRef("account-b"), reason: "reserved-for-new-work" },
        { account: createAccountRef("account-c"), reason: "unhealthy" },
      ],
    });
  });

  it("creates a new-work reservation only for an eligible selection", () => {
    const result = reserveAccountForNewWork({ route: route(), work: "new", candidates: [candidate("account-a")] });

    expect(result).toEqual({ account: createAccountRef("account-a"), route: route() });
  });

  it("rejects invalid exported selection and reservation inputs at the domain boundary", () => {
    expect(() => selectModelGatewayAccount({ route: route(), work: "existing", candidates: [] }))
      .toThrow("Existing work requires an affinity");
    expect(() => selectModelGatewayAccount({
      route: route(),
      work: "new",
      candidates: [candidate("account-a", { pressure: -1 })],
    })).toThrow("pressure must be a non-negative finite number");
    expect(() => selectModelGatewayAccount({
      route: { providerId: "fixture-provider", providerModelId: "", scope: "default" },
      work: "new",
      candidates: [],
    })).toThrow("route.providerModelId must not be empty");
    expect(() => selectModelGatewayAccount({
      route: route(),
      work: "new",
      candidates: [{ ...candidate("account-a"), account: " account-a " as AccountRef }],
    })).toThrow("candidates[0].account must be canonical");
    expect(() => selectModelGatewayAccount({
      route: route(),
      work: "existing",
      affinity: { account: createAccountRef("account-a"), route: route("other") },
      candidates: [],
    })).toThrow("affinity.route must match route");
    expect(() => reserveAccountForNewWork({
      route: route(),
      work: "existing",
      affinity: { account: createAccountRef("account-a"), route: route() },
      candidates: [],
    })).toThrow("New-work reservations require work: new");
  });

  it("uses one route identity equality rule across core consumers", () => {
    expect(isSameProviderModelRoute(route(), route())).toBe(true);
    expect(isSameProviderModelRoute(route(), route("another-scope"))).toBe(false);
  });
});

describe("AttemptCommit", () => {
  const accountA = createAccountRef("account-a");
  const accountB = createAccountRef("account-b");

  it("only permits the planned -> leased -> dispatching -> committed -> terminal sequence", () => {
    const planned = createAttemptCommit({ attemptId: "attempt-1", account: accountA });
    const leased = advanceAttemptCommit(planned, "leased");
    const dispatching = advanceAttemptCommit(leased, "dispatching");
    const committed = advanceAttemptCommit(dispatching, "committed");
    const terminal = advanceAttemptCommit(committed, "succeeded");

    expect([planned.phase, leased.phase, dispatching.phase, committed.phase, terminal.phase])
      .toEqual(["planned", "leased", "dispatching", "committed", "succeeded"]);
    expect(() => advanceAttemptCommit(planned, "committed")).toThrow("Invalid AttemptCommit transition");
    expect(() => advanceAttemptCommit(terminal, "leased")).toThrow("Invalid AttemptCommit transition");
  });

  it("allows account failover only before dispatch might have produced provider effects", () => {
    const planned = createAttemptCommit({ attemptId: "attempt-1", account: accountA });
    const leased = advanceAttemptCommit(planned, "leased");
    const dispatching = advanceAttemptCommit(leased, "dispatching");

    expect(reassignAttemptAccount(leased, accountB)).toMatchObject({ account: accountB, phase: "leased" });
    expect(() => reassignAttemptAccount(dispatching, accountB)).toThrow("cannot change accounts after dispatching");
    expect(() => reassignAttemptAccount(advanceAttemptCommit(dispatching, "committed"), accountB))
      .toThrow("cannot change accounts after committed");
  });

  it("rejects blank attempt identifiers at the exported creation boundary", () => {
    expect(() => createAttemptCommit({ attemptId: " ", account: accountA })).toThrow("attemptId must not be empty");
  });
});
