import { describe, expect, it } from "vitest";
import {
  orderManagedEconomicExecutionAlternatives,
  selectManagedEconomicExecutionAlternative,
  type ManagedEconomicExecutionAlternative,
  type ManagedEconomicPriceEvidence,
  type ManagedEconomicSelectionRequest,
} from "../../src/cost/managed-route-economics.js";

const evidence = {
  sourceIdentity: "synthetic",
  sourceRevision: "1",
  sourceDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  observedAt: "2026-07-29T11:00:00.000Z",
  validUntil: "2026-07-29T13:00:00.000Z",
  confidence: "high" as const,
  authority: "configured" as const,
};

function makeAlternative(
  routeId: string,
  options: {
    readonly domainRank?: number;
    readonly priorityRank?: number;
    readonly reservationAtoms?: string;
    readonly accountIdentity?: string;
    readonly accountless?: boolean;
    readonly priceKind?: ManagedEconomicPriceEvidence["kind"];
    readonly comparable?: boolean;
  } = {},
): ManagedEconomicExecutionAlternative {
  const priceKind = options.priceKind ?? "metered";
  const exactAmount = {
    atoms: options.reservationAtoms ?? "100",
    scale: 2,
    unit: "currency",
    scheme: { kind: "currency" as const, currency: "USD" },
  };
  const priceIdentity = {
    providerId: "provider",
    modelId: "model",
    authBillingChannel: "channel",
    executionMode: "standard",
    serviceTier: "default",
    rateCardId: "rate",
    rateCardRevision: "1",
    unit: "currency",
    scheme: exactAmount.scheme,
    unitScheduleDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    contextClass: "standard",
    cacheClass: "default",
    auxiliaryScheduleDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    evidence,
  };
  const priceEvidence: ManagedEconomicPriceEvidence =
    priceKind === "included"
      ? { kind: priceKind, identity: priceIdentity, allowanceId: "allowance" }
      : priceKind === "unknown"
        ? { kind: priceKind, identity: priceIdentity, reason: "unavailable" }
        : priceKind === "estimated"
          ? { kind: priceKind, identity: priceIdentity, estimationMethod: "configured-rate-card" }
          : { kind: priceKind, identity: priceIdentity };

  return {
    identity: {
      route: {
        routeId,
        providerId: "provider",
        modelId: "model",
        adapterCapabilityId: "direct",
        adapterCapabilityVersion: "1",
        authBillingChannel: "channel",
        executionMode: "standard",
        serviceTier: "default",
        accountPolicyId: options.accountless ? null : "policy",
        fallbackPosture: "disabled",
        overagePosture: "disabled",
        rateCardId: "rate",
        rateCardRevision: "1",
        priceEvidenceDigest: evidence.sourceDigest,
        unit: "currency",
        scheme: exactAmount.scheme,
        contextClass: "standard",
        cacheClass: "default",
        auxiliaryScheduleDigest: priceIdentity.auxiliaryScheduleDigest,
        envelopeDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      },
      account: options.accountless
        ? { kind: "accountless" }
        : {
            kind: "account-bound",
            capacityIdentity: options.accountIdentity ?? "account-a",
            accountRef: "account-ref",
            credentialRevision: "1",
            creditPosture: "disabled",
            overagePosture: "disabled",
            quotaEvidence: {
              kind: "known",
              capacityIdentity: options.accountIdentity ?? "account-a",
              subscriptionClass: priceKind === "estimated" ? "unknown" : priceKind,
              quotaClassId: "quota",
              buckets: [{
                bucketId: "primary",
                dimension: "currency",
                remaining: exactAmount,
                resetsAt: "2026-07-30T12:00:00.000Z",
              }],
              evidence,
            },
          },
    },
    comparisonDomain: {
      id: `domain-${options.domainRank ?? 0}`,
      rank: options.domainRank ?? 0,
      basis: {
        unit: "currency",
        scheme: exactAmount.scheme,
        rateCardBasis: "rate:1",
        envelopeSemantics: "worst-case-v1",
      },
    },
    priorityRank: options.priorityRank ?? 0,
    priceEvidence,
    executionEnvelope: {
      kind: "bounded",
      digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      limits: [exactAmount],
    },
    worstCaseReservation: options.comparable === false
      ? { kind: "not-comparable", reason: "economic-basis-unavailable" }
      : { kind: "exact", amount: exactAmount },
    ceiling: { kind: "none" },
    accountSelectionReason: options.accountless ? "accountless" : "least-pressure",
    observedAffinityRevision: options.accountless ? null : "1",
  };
}

function makeSelectionRequest(
  alternatives: readonly ManagedEconomicExecutionAlternative[],
): ManagedEconomicSelectionRequest {
  return {
    decisionAt: "2026-07-29T12:00:00.000Z",
    evidenceRequirements: {
      quota: "required-for-account-bound",
      price: "required",
    },
    alternatives,
  };
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length <= 1) {
    return [values];
  }
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidateIndex) => candidateIndex !== index))
      .map((remaining) => [value, ...remaining]),
  );
}

describe("managed route economic ordering properties", () => {
  it("explains a single eligible alternative without a cost claim", () => {
    const decision = selectManagedEconomicExecutionAlternative(makeSelectionRequest([
      makeAlternative("only"),
    ]));
    expect(decision).toMatchObject({
      kind: "selected",
      explanation: { kind: "only-eligible-alternative", cheapestRouteClaim: false },
    });
  });

  it("selects lower exact reservation only within equal domain and priority", () => {
    const selected = selectManagedEconomicExecutionAlternative(makeSelectionRequest([
      makeAlternative("expensive", { reservationAtoms: "200" }),
      makeAlternative("cheap", { reservationAtoms: "100" }),
    ]));
    expect(selected.kind === "selected" && selected.selected.identity.route.routeId).toBe("cheap");
  });

  it("configured priority outranks a cheaper amount", () => {
    const selected = selectManagedEconomicExecutionAlternative(makeSelectionRequest([
      makeAlternative("priority", { priorityRank: 0, reservationAtoms: "900" }),
      makeAlternative("cheap", { priorityRank: 1, reservationAtoms: "1" }),
    ]));
    expect(selected.kind === "selected" && selected.selected.identity.route.routeId).toBe("priority");
    expect(selected.kind === "selected" && selected.explanation).toEqual({
      kind: "configured-priority-order",
      cheapestRouteClaim: false,
    });
    expect(selected.kind === "selected" && selected.notSelected[0]?.reason)
      .toBe("higher-priority-rank");
  });

  it("domain rank outranks amount without making a cheapest-route claim", () => {
    const selected = selectManagedEconomicExecutionAlternative(makeSelectionRequest([
      makeAlternative("preferred-domain", { domainRank: 0, reservationAtoms: "900" }),
      makeAlternative("cheap", { domainRank: 1, reservationAtoms: "1" }),
    ]));
    expect(selected).toMatchObject({
      kind: "selected",
      selected: { identity: { route: { routeId: "preferred-domain" } } },
      explanation: { kind: "configured-domain-order", cheapestRouteClaim: false },
    });
    expect(selected.kind === "selected" && selected.notSelected[0]?.reason)
      .toBe("higher-comparison-domain-rank");
  });

  it("is input-order independent across every permutation", () => {
    const values = [
      makeAlternative("route-c", { reservationAtoms: "300" }),
      makeAlternative("route-a", { reservationAtoms: "100" }),
      makeAlternative("route-b", { reservationAtoms: "200" }),
    ];
    const selected = permutations(values).map((candidateOrder) => {
      const decision = selectManagedEconomicExecutionAlternative(makeSelectionRequest(candidateOrder));
      return decision.kind === "selected" ? decision.selected.identity.route.routeId : "denied";
    });
    expect(new Set(selected)).toEqual(new Set(["route-a"]));
  });

  it("is total for route/account ties", () => {
    const values = [
      makeAlternative("route-b", { accountIdentity: "account-b" }),
      makeAlternative("route-a", { accountIdentity: "account-z" }),
      makeAlternative("route-a", { accountIdentity: "account-a" }),
      makeAlternative("route-a", { accountless: true }),
    ];
    expect(orderManagedEconomicExecutionAlternatives(values).map(stableIdentity)).toEqual([
      "route-a/account-a",
      "route-a/account-z",
      "route-a/accountless",
      "route-b/account-b",
    ]);
  });

  it("is transitive", () => {
    const values = [
      makeAlternative("route-d", { domainRank: 1 }),
      makeAlternative("route-c", { priorityRank: 1 }),
      makeAlternative("route-b", { reservationAtoms: "200" }),
      makeAlternative("route-a", { reservationAtoms: "100" }),
    ];
    const expected = orderManagedEconomicExecutionAlternatives(values).map(stableIdentity);
    for (const candidateOrder of permutations(values)) {
      expect(orderManagedEconomicExecutionAlternatives(candidateOrder).map(stableIdentity))
        .toEqual(expected);
    }
  });

  it("uses priority deterministically for mixed comparable and non-comparable evidence", () => {
    const nonComparable = makeAlternative("subscription", {
      priorityRank: 0,
      priceKind: "subscription",
      comparable: false,
    });
    const metered = makeAlternative("metered", {
      priorityRank: 1,
      priceKind: "metered",
      reservationAtoms: "1",
    });
    for (const order of [[nonComparable, metered], [metered, nonComparable]]) {
      const decision = selectManagedEconomicExecutionAlternative(makeSelectionRequest(order));
      expect(decision.kind === "selected" && decision.selected.identity.route.routeId).toBe("subscription");
      expect(decision.kind === "selected" && decision.explanation.cheapestRouteClaim).toBe(false);
    }
  });

  it("uses stable identity rather than an implicit comparability rank for mixed evidence", () => {
    const subscription = makeAlternative("a-subscription", {
      priceKind: "subscription",
      comparable: false,
    });
    const metered = makeAlternative("z-metered", { reservationAtoms: "1" });
    const decision = selectManagedEconomicExecutionAlternative(
      makeSelectionRequest([subscription, metered]),
    );
    expect(decision).toMatchObject({
      kind: "selected",
      selected: { identity: { route: { routeId: "a-subscription" } } },
      notSelected: [{ reason: "stable-route-id-order" }],
      explanation: { kind: "stable-identity-order", cheapestRouteClaim: false },
    });
  });

  it("explains comparable amount, route, and capacity tie-breaks separately", () => {
    const amountDecision = selectManagedEconomicExecutionAlternative(makeSelectionRequest([
      makeAlternative("expensive", { reservationAtoms: "200" }),
      makeAlternative("cheap", { reservationAtoms: "100" }),
    ]));
    expect(amountDecision).toMatchObject({
      kind: "selected",
      explanation: { kind: "lower-comparable-reservation", cheapestRouteClaim: true },
      notSelected: [{ reason: "higher-worst-case-reservation" }],
    });

    const routeDecision = selectManagedEconomicExecutionAlternative(makeSelectionRequest([
      makeAlternative("route-b"),
      makeAlternative("route-a"),
    ]));
    expect(routeDecision).toMatchObject({
      kind: "selected",
      explanation: { kind: "stable-identity-order", cheapestRouteClaim: false },
      notSelected: [{ reason: "stable-route-id-order" }],
    });

    const capacityDecision = selectManagedEconomicExecutionAlternative(makeSelectionRequest([
      makeAlternative("route", { accountIdentity: "capacity-b" }),
      makeAlternative("route", { accountIdentity: "capacity-a" }),
    ]));
    expect(capacityDecision).toMatchObject({
      kind: "selected",
      notSelected: [{ reason: "stable-capacity-identity-order" }],
    });
  });

  it("canonicalizes rejection order independently of input order", () => {
    const missingPriceA = {
      ...makeAlternative("route-a"),
      priceEvidence: null,
    };
    const missingPriceB = {
      ...makeAlternative("route-b"),
      priceEvidence: null,
    };
    const decisions = [
      [missingPriceB, missingPriceA],
      [missingPriceA, missingPriceB],
    ].map((alternatives) =>
      selectManagedEconomicExecutionAlternative(makeSelectionRequest(alternatives)));
    expect(decisions[0]).toEqual(decisions[1]);
  });

  it("fails closed deterministically on duplicate route and capacity identities", () => {
    const first = makeAlternative("duplicate", {
      accountIdentity: "same-capacity",
      reservationAtoms: "100",
    });
    const second = makeAlternative("duplicate", {
      accountIdentity: "same-capacity",
      reservationAtoms: "200",
    });
    const decisions = [
      [first, second],
      [second, first],
    ].map((alternatives) =>
      selectManagedEconomicExecutionAlternative(makeSelectionRequest(alternatives)));
    expect(decisions[0]).toEqual(decisions[1]);
    expect(decisions[0]).toMatchObject({
      kind: "denied",
      rejected: [
        { reason: "comparison-domain-incompatible" },
        { reason: "comparison-domain-incompatible" },
      ],
    });
  });
});

function stableIdentity(alternative: ManagedEconomicExecutionAlternative): string {
  const account = alternative.identity.account.kind === "accountless"
    ? "accountless"
    : alternative.identity.account.capacityIdentity;
  return `${alternative.identity.route.routeId}/${account}`;
}
