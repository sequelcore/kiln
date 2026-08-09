import { describe, expect, it } from "vitest";
import {
  adoptManagedEconomicSnapshot,
  canonicalizeManagedEconomicValue,
  compareManagedEconomicAmounts,
  createManagedEconomicSettlement,
  digestManagedEconomicValue,
  digestManagedEconomicProfileAuthority,
  projectManagedEconomicProfileAuthority,
  deriveManagedEconomicMinimumReservation,
  narrowManagedEconomicExecutionAlternatives,
  selectManagedEconomicExecutionAlternative,
  validateManagedEconomicAdoptedSnapshot,
  validateManagedEconomicAmount,
  type ManagedEconomicEvidenceIdentity,
  type ManagedEconomicExecutionAlternative,
  type ManagedEconomicPriceEvidence,
  type ManagedEconomicQuotaEvidence,
  type ManagedEconomicReservation,
  type ManagedEconomicAdoptedSnapshotInput,
  type ManagedEconomicSelectionRequest,
  type ManagedEconomicSettlement,
} from "../../src/cost/managed-route-economics.js";
import type { ManagedAgentAuthorityProfile } from "../../src/agents/managed-invocation/index.js";

const CURRENT_AT = "2026-07-29T12:00:00.000Z";

const currentEvidence: ManagedEconomicEvidenceIdentity = {
  sourceIdentity: "synthetic-catalog",
  sourceRevision: "revision-7",
  sourceDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  observedAt: "2026-07-29T11:00:00.000Z",
  validUntil: "2026-07-29T13:00:00.000Z",
  confidence: "high",
  authority: "configured",
};

function amount(atoms: string, currency = "USD") {
  return {
    atoms,
    scale: 2,
    unit: "currency",
    scheme: { kind: "currency" as const, currency },
  };
}

function price(
  kind: ManagedEconomicPriceEvidence["kind"],
  evidence: ManagedEconomicEvidenceIdentity = currentEvidence,
): ManagedEconomicPriceEvidence {
  const identity = {
    providerId: "provider",
    modelId: "model",
    authBillingChannel: "oauth-subscription",
    executionMode: "standard",
    serviceTier: "default",
    rateCardId: "rate-card",
    rateCardRevision: "7",
    unit: "currency",
    scheme: { kind: "currency" as const, currency: "USD" },
    unitScheduleDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    contextClass: "standard",
    cacheClass: "default",
    auxiliaryScheduleDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    evidence,
  };

  switch (kind) {
    case "subscription":
      return { kind, identity };
    case "included":
      return { kind, identity, allowanceId: "included-window" };
    case "free":
      return { kind, identity };
    case "metered":
      return { kind, identity };
    case "unknown":
      return { kind, identity, reason: "provider-price-unavailable" };
    case "estimated":
      return { kind, identity, estimationMethod: "configured-rate-card" };
  }
}

function alternative(
  routeId: string,
  options: {
    account?: string;
    domainId?: string;
    domainRank?: number;
    priorityRank?: number;
    reservation?: ReturnType<typeof amount> | null;
    price?: ManagedEconomicPriceEvidence | null;
    quota?: ManagedEconomicEvidenceIdentity | null;
    quotaEvidence?: ManagedEconomicQuotaEvidence | null;
    bounded?: boolean;
    ceiling?: ReturnType<typeof amount> | null;
  } = {},
): ManagedEconomicExecutionAlternative {
  const account = options.account ?? "account-a";
  return {
    identity: {
      route: {
        routeId,
        providerId: "provider",
        modelId: "model",
        adapterCapabilityId: "direct-provider",
        adapterCapabilityVersion: "1",
        authBillingChannel: "oauth-subscription",
        executionMode: "standard",
        serviceTier: "default",
        accountPolicyId: account === "accountless" ? null : "account-policy",
        fallbackPosture: "disabled",
        overagePosture: "disabled",
        rateCardId: "rate-card",
        rateCardRevision: "7",
        priceEvidenceDigest: currentEvidence.sourceDigest,
        unit: "currency",
        scheme: { kind: "currency", currency: "USD" },
        contextClass: "standard",
        cacheClass: "default",
        auxiliaryScheduleDigest:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        envelopeDigest:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
      account:
        account === "accountless"
          ? { kind: "accountless" }
          : {
              kind: "account-bound",
              capacityIdentity: account,
              accountRef: `ref-${account}`,
              credentialRevision: "credential-3",
              creditPosture: "disabled",
              overagePosture: "disabled",
              quotaEvidence: options.quotaEvidence !== undefined
                ? options.quotaEvidence
                : options.quota === null
                  ? null
                  : {
                    kind: "known",
                    capacityIdentity: account,
                    subscriptionClass: "metered",
                    quotaClassId: "quota-class",
                    buckets: [{
                      bucketId: "primary",
                      dimension: "currency",
                      remaining: amount("10000"),
                      resetsAt: "2026-07-30T12:00:00.000Z",
                    }],
                    evidence: options.quota ?? currentEvidence,
                  },
            },
    },
    comparisonDomain: {
      id: options.domainId ?? "usd-standard",
      rank: options.domainRank ?? 0,
      basis: {
        unit: "currency",
        scheme: { kind: "currency", currency: "USD" },
        rateCardBasis: "rate-card:7",
        envelopeSemantics: "worst-case-v1",
      },
    },
    priorityRank: options.priorityRank ?? 0,
    priceEvidence: options.price === undefined ? price("metered") : options.price,
    executionEnvelope:
      options.bounded === false
        ? { kind: "unbounded", missingDimensions: ["output-tokens"] }
        : {
            kind: "bounded",
            digest:
              "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            limits: [amount("10000")],
          },
    worstCaseReservation:
      options.reservation === null
        ? { kind: "not-comparable", reason: "economic-basis-unavailable" }
        : { kind: "exact", amount: options.reservation ?? amount("100") },
    ceiling:
      options.ceiling === null || options.ceiling === undefined
        ? { kind: "none" }
        : { kind: "finite", amount: options.ceiling },
    accountSelectionReason: account === "accountless" ? "accountless" : "least-pressure",
    observedAffinityRevision: account === "accountless" ? null : "affinity-4",
  };
}

function request(
  alternatives: readonly ManagedEconomicExecutionAlternative[],
  overrides: Partial<ManagedEconomicSelectionRequest> = {},
): ManagedEconomicSelectionRequest {
  return {
    decisionAt: CURRENT_AT,
    evidenceRequirements: {
      quota: "required-for-account-bound",
      price: "required",
    },
    alternatives,
    ...overrides,
  };
}

function adoptedSnapshotInput(): ManagedEconomicAdoptedSnapshotInput {
  const selected = alternative("route-accountless", { account: "accountless" });
  if (selected.priceEvidence === undefined || selected.priceEvidence === null) {
    throw new Error("test fixture requires price evidence");
  }
  const rateSchedule = {
    unitRates: [{
      usageUnit: "input-token",
      price: {
        atoms: "125",
        scale: 6,
        unit: "input-token",
        scheme: selected.identity.route.scheme,
      },
    }],
    auxiliaryCharges: [],
  };
  const unitScheduleDigest = digestManagedEconomicValue(rateSchedule.unitRates);
  const auxiliaryScheduleDigest = digestManagedEconomicValue(rateSchedule.auxiliaryCharges);
  const route = {
    ...selected.identity.route,
    auxiliaryScheduleDigest,
  };
  const adoptedPriceEvidence = {
    ...selected.priceEvidence,
    identity: {
      ...selected.priceEvidence.identity,
      unitScheduleDigest,
      auxiliaryScheduleDigest,
    },
  } as ManagedEconomicPriceEvidence;
  return {
    policy: {
      policyId: "managed-policy",
      schemaVersion: 1,
      policyRevision: "revision-7",
      policyDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      comparisonDomains: [selected.comparisonDomain],
      noRouteAction: "deny",
      evidenceRequirements: {
        quota: "required-for-account-bound",
        price: "required",
      },
    },
    adoptedAt: "2026-07-29T11:30:00.000Z",
    adoptedDecisionAt: CURRENT_AT,
    callerConstraints: { providerIds: ["provider"] },
    routes: [{
      admittedIdentity: {
        routeId: selected.identity.route.routeId,
        sourceIdentity: "managed-route-config",
        providerId: selected.identity.route.providerId,
        modelId: selected.identity.route.modelId,
         adapterCapabilityId: selected.identity.route.adapterCapabilityId,
         adapterCapabilityVersion: selected.identity.route.adapterCapabilityVersion,
         accountPolicy: { kind: "accountless" },
         profileAuthorityDigest: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
       },
      route,
      comparisonDomain: selected.comparisonDomain,
      priorityRank: selected.priorityRank,
      priceEvidence: adoptedPriceEvidence,
      rateSchedule,
      executionEnvelope: selected.executionEnvelope as Extract<
        typeof selected.executionEnvelope,
        { readonly kind: "bounded" }
      >,
      worstCaseReservation: selected.worstCaseReservation,
      ceiling: selected.ceiling,
    }],
  };
}

function settlementFixture() {
  const adopted = adoptManagedEconomicSnapshot(adoptedSnapshotInput());
  const adoptedRoute = adopted.routes[0]!;
  const selectedIdentity = {
    route: adoptedRoute.route,
    account: { kind: "accountless" as const },
  };
  const commitment = {
    commitmentId: "commitment-settlement",
    reservation: {
      reservationId: "reservation-settlement",
      jobId: "job-settlement",
      economicAttemptId: "economic-attempt-settlement",
      policy: adopted.policy,
      selectedIdentity,
      priceIdentity: adoptedRoute.priceEvidence.identity,
      envelope: adoptedRoute.executionEnvelope,
      amounts: [amount("100")],
      authorityRevision: digestManagedEconomicValue(adopted),
    },
    rejected: [],
    notSelected: [],
  };
  const reportEvidence: ManagedEconomicEvidenceIdentity = {
    ...currentEvidence,
    sourceIdentity: "direct-adapter-usage",
    authority: "calculated-estimate",
  };
  return { adoptedRoute, commitment, selectedIdentity, reportEvidence };
}

describe("managed route economics", () => {
  it("canonicalizes and digests economic evidence independently of key order", () => {
    const left = {
      route: { providerId: "provider", routeId: "route-a" },
      constraints: { modelIds: ["model-a"], providerIds: undefined },
    };
    const right = {
      constraints: { modelIds: ["model-a"] },
      route: { routeId: "route-a", providerId: "provider" },
    };

    expect(canonicalizeManagedEconomicValue(left)).toBe(
      '{"constraints":{"modelIds":["model-a"]},"route":{"providerId":"provider","routeId":"route-a"}}',
    );
    expect(canonicalizeManagedEconomicValue(right)).toBe(
      canonicalizeManagedEconomicValue(left),
    );
    expect(digestManagedEconomicValue(right)).toBe(
      digestManagedEconomicValue(left),
    );
    expect(digestManagedEconomicValue(left)).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("commits the complete authority projection without persisting raw paths", () => {
    const authority: ManagedAgentAuthorityProfile = {
      authorityProfileId: "authority:route-a:foundation-readonly-plan",
      permissionProfile: "read-only",
      toolAuthority: {
        allowedToolNames: ["grep", "read", "grep"],
        writeAllowed: false,
        networkAllowed: true,
      },
      workingDirectory: { path: "C:\\synthetic\\workspace", mode: "read-only" },
      timeoutMs: 300000,
      timeoutSource: "default",
      credentialRoute: { mode: "credentialless" },
      memoryScope: { scope: { kind: "project", id: "synthetic" }, access: "read-only" },
      readAuthority: {
        workspace: {
          allowedPaths: ["C:\\synthetic\\workspace"],
          deniedPaths: ["C:\\synthetic\\workspace\\.git"],
        },
      },
    };
    const reordered: ManagedAgentAuthorityProfile = {
      ...authority,
      toolAuthority: { ...authority.toolAuthority, allowedToolNames: ["read", "grep"] },
    };
    const changed: ManagedAgentAuthorityProfile = {
      ...authority,
      toolAuthority: { ...authority.toolAuthority, networkAllowed: false },
    };
    const authorityWithEvidence: ManagedAgentAuthorityProfile = {
      ...authority,
      writeAuthority: {
        profile: "foundation-propose-writes",
        scope: {
          workspace: {
            mode: "propose",
            allowedPaths: ["C:\\synthetic\\workspace"],
            deniedPaths: ["C:\\synthetic\\workspace\\.git"],
          },
          memory: { mode: "none", operations: [] },
          artifacts: {
            mode: "propose",
            resourceUris: ["kiln://synthetic/resources/allowed"],
            retention: "session",
          },
          tools: { allowedToolNames: ["read"], deniedToolNames: [] },
        },
        approval: {
          mode: "required-before-apply",
          evidenceRequired: true,
          evidenceUris: ["kiln://synthetic/evidence/one"],
        },
      },
    };
    const changedEvidence: ManagedAgentAuthorityProfile = {
      ...authorityWithEvidence,
      writeAuthority: {
        ...authorityWithEvidence.writeAuthority!,
        approval: {
          ...authorityWithEvidence.writeAuthority!.approval,
          evidenceUris: ["kiln://synthetic/evidence/two"],
        },
      },
    };

    const digest = digestManagedEconomicProfileAuthority(authority);
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(digestManagedEconomicProfileAuthority(reordered)).toBe(digest);
    expect(digestManagedEconomicProfileAuthority(changed)).not.toBe(digest);
    const projection = JSON.stringify(projectManagedEconomicProfileAuthority(authority));
    expect(projection).not.toContain("synthetic\\\\workspace");
    expect(projection).toContain("sha256:");

    const evidenceProjection = JSON.stringify(projectManagedEconomicProfileAuthority(authorityWithEvidence));
    expect(evidenceProjection).not.toContain("kiln://synthetic/resources/allowed");
    expect(evidenceProjection).not.toContain("kiln://synthetic/evidence/one");
    expect(digestManagedEconomicProfileAuthority(changedEvidence))
      .not.toBe(digestManagedEconomicProfileAuthority(authorityWithEvidence));
  });

  it("adopts a complete immutable economic snapshot with canonical digests", () => {
    const input = adoptedSnapshotInput();
    const snapshot = adoptManagedEconomicSnapshot(input);
    const reordered = adoptManagedEconomicSnapshot({
      routes: input.routes,
      callerConstraints: input.callerConstraints,
      adoptedAt: input.adoptedAt,
      adoptedDecisionAt: input.adoptedDecisionAt,
      policy: input.policy,
    });

    expect(snapshot).toEqual(reordered);
    expect(snapshot.candidateSetDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(snapshot.snapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const authorityRevision = adoptManagedEconomicSnapshot({
      ...input,
      routes: [{
        ...input.routes[0]!,
        admittedIdentity: {
          ...input.routes[0]!.admittedIdentity,
          profileAuthorityDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }],
    });
    expect(authorityRevision.candidateSetDigest).not.toBe(snapshot.candidateSetDigest);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.routes)).toBe(true);
    expect(Object.isFrozen(snapshot.routes[0]?.priceEvidence.identity.evidence)).toBe(true);
    expect(validateManagedEconomicAdoptedSnapshot(snapshot)).toBe(snapshot);
  });

  it("represents account policy applicability before current account evidence is attached", () => {
    const accountless = adoptedSnapshotInput().routes[0]!;
    const accountBound = {
      ...accountless,
      admittedIdentity: {
        ...accountless.admittedIdentity,
        routeId: "route-account-bound",
        accountPolicy: { kind: "account-bound" as const, accountPolicyId: "account-policy" },
      },
      route: {
        ...accountless.route,
        routeId: "route-account-bound",
        accountPolicyId: "account-policy",
      },
    };

    expect(adoptManagedEconomicSnapshot({
      ...adoptedSnapshotInput(),
      routes: [accountBound],
    }).routes[0]?.admittedIdentity.accountPolicy).toEqual({
      kind: "account-bound",
      accountPolicyId: "account-policy",
    });
    expect(() => adoptManagedEconomicSnapshot({
      ...adoptedSnapshotInput(),
      routes: [{
        ...accountBound,
        route: { ...accountBound.route, accountPolicyId: null },
      }],
    })).toThrow(/account policy/u);
  });

  it("rejects incomplete or cross-route adopted economic evidence", () => {
    const input = adoptedSnapshotInput();
    const route = input.routes[0]!;
    expect(() => adoptManagedEconomicSnapshot({
      ...input,
      routes: [{
        ...route,
        priceEvidence: {
          ...route.priceEvidence,
          identity: { ...route.priceEvidence.identity, modelId: "different-model" },
        },
      }],
    })).toThrow(/price evidence/u);
    expect(() => adoptManagedEconomicSnapshot({
      ...input,
      routes: [{
        ...route,
        executionEnvelope: { ...route.executionEnvelope, limits: [] },
      }],
    })).toThrow(/at least one limit/u);
  });

  it("fails closed on canonical digest tampering and adopted identity revision drift", () => {
    const input = adoptedSnapshotInput();
    const snapshot = adoptManagedEconomicSnapshot(input);
    expect(() => validateManagedEconomicAdoptedSnapshot({
      ...snapshot,
      snapshotDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    })).toThrow(/snapshot digest/u);
    expect(() => validateManagedEconomicAdoptedSnapshot(snapshot, {
      policyId: snapshot.policy.policyId,
      policyRevision: "different-revision",
      candidateSetDigest: snapshot.candidateSetDigest,
      admittedCandidates: snapshot.routes.map(({ admittedIdentity }) => admittedIdentity),
      callerConstraints: snapshot.callerConstraints,
    })).toThrow(/identity-revision-conflict/u);
  });

  it("allows caller constraints to narrow persisted admission but never widen it", () => {
    const input = adoptedSnapshotInput();
    const snapshot = adoptManagedEconomicSnapshot(input);
    const expectation = {
      policyId: snapshot.policy.policyId,
      policyRevision: snapshot.policy.policyRevision,
      candidateSetDigest: snapshot.candidateSetDigest,
      admittedCandidates: snapshot.routes.map(({ admittedIdentity }) => admittedIdentity),
      callerConstraints: { providerIds: ["provider", "other-provider"] },
    };
    expect(validateManagedEconomicAdoptedSnapshot(snapshot, expectation)).toBe(snapshot);
    expect(() => validateManagedEconomicAdoptedSnapshot(snapshot, {
      ...expectation,
      callerConstraints: { routeIds: ["route-accountless"] },
    })).toThrow(/caller constraints cannot widen/u);
  });

  it.each([
    ["subscription", false, "selected"],
    ["included", false, "selected"],
    ["free", true, "selected"],
    ["metered", true, "selected"],
    ["unknown", false, "denied"],
    ["estimated", false, "selected"],
  ] as const)("keeps %s price evidence semantically distinct", (kind, comparable, expected) => {
    const candidate = alternative(`route-${kind}`, {
      account: "accountless",
      price: price(kind),
      reservation: comparable ? amount("0") : null,
    });
    const decision = selectManagedEconomicExecutionAlternative(request([candidate]));

    expect(decision.kind).toBe(expected);
    if (decision.kind === "selected") {
      expect(decision.selected.priceEvidence?.kind).toBe(kind);
      expect(decision.selected.worstCaseReservation.kind === "exact").toBe(comparable);
    }
  });

  it("never represents subscription, included, or unknown absence as numeric zero", () => {
    for (const kind of ["subscription", "included", "unknown"] as const) {
      const evidence = price(kind);
      expect("amount" in evidence).toBe(false);
      expect(alternative(`route-${kind}`, { price: evidence, reservation: null }).worstCaseReservation)
        .toEqual({ kind: "not-comparable", reason: "economic-basis-unavailable" });
    }
  });

  it.each([
    ["", 0, "currency"],
    ["00", 0, "currency"],
    ["01", 0, "currency"],
    ["-1", 0, "currency"],
    ["1.0", 0, "currency"],
    ["1", -1, "currency"],
    ["1", 1.5, "currency"],
    ["1", 19, "currency"],
    ["1", 0, ""],
  ])("rejects invalid canonical decimal atoms=%j scale=%j unit=%j", (atoms, scale, unit) => {
    expect(() =>
      validateManagedEconomicAmount({
        atoms,
        scale,
        unit,
        scheme: { kind: "currency", currency: "USD" },
      }),
    ).toThrow();
  });

  it("compares decimals exactly across scales with bigint arithmetic", () => {
    expect(compareManagedEconomicAmounts(amount("10"), {
      ...amount("100"),
      scale: 3,
    })).toBe(0);
    expect(compareManagedEconomicAmounts(amount("900719925474099300"), amount("900719925474099301")))
      .toBe(-1);
  });

  it("keeps currency, credit, and physical unit schemes distinct", () => {
    const currency = amount("100");
    const credit = {
      atoms: "100",
      scale: 2,
      unit: "credit",
      scheme: { kind: "credit" as const, creditSchemeId: "provider-credit-v1" },
    };
    const requests = {
      atoms: "1",
      scale: 0,
      unit: "request",
      scheme: { kind: "unit" as const },
    };
    expect(() => validateManagedEconomicAmount(currency)).not.toThrow();
    expect(() => validateManagedEconomicAmount(credit)).not.toThrow();
    expect(() => validateManagedEconomicAmount(requests)).not.toThrow();
    expect(() => compareManagedEconomicAmounts(currency, credit)).toThrow(
      "incompatible units or schemes",
    );
  });

  it("represents known, unlimited, and unknown quota evidence without invented fields", () => {
    const variants: readonly ManagedEconomicQuotaEvidence[] = [
      {
        kind: "known",
        capacityIdentity: "account-a",
        subscriptionClass: "metered",
        quotaClassId: "rolling-window",
        buckets: [{
          bucketId: "primary",
          dimension: "credit",
          remaining: amount("500"),
          resetsAt: "2026-07-30T12:00:00.000Z",
        }],
        evidence: currentEvidence,
      },
      {
        kind: "unlimited",
        capacityIdentity: "account-a",
        subscriptionClass: "subscription",
        quotaClassId: "provider-reported-unlimited",
        evidence: currentEvidence,
      },
      {
        kind: "unknown",
        capacityIdentity: "account-a",
        subscriptionClass: "unknown",
        reason: "provider-does-not-expose-quota",
        evidence: null,
      },
    ];
    expect(variants.map(({ kind }) => kind)).toEqual(["known", "unlimited", "unknown"]);
    expect(variants[2]).not.toHaveProperty("buckets");
  });

  it.each([
    ["quota-evidence-missing", alternative("route", { quota: null })],
    [
      "quota-evidence-stale",
      alternative("route", {
        quota: { ...currentEvidence, validUntil: "2026-07-29T11:59:59.999Z" },
      }),
    ],
    ["price-evidence-missing", alternative("route", { price: null })],
    [
      "price-evidence-stale",
      alternative("route", {
        price: price("metered", {
          ...currentEvidence,
          validUntil: "2026-07-29T11:59:59.999Z",
        }),
      }),
    ],
    [
      "comparison-domain-incompatible",
      {
        ...alternative("route"),
        comparisonDomain: {
          ...alternative("route").comparisonDomain,
          basis: {
            ...alternative("route").comparisonDomain.basis,
            scheme: { kind: "currency" as const, currency: "EUR" },
          },
        },
      },
    ],
    ["execution-envelope-unbounded", alternative("route", { bounded: false })],
    [
      "ceiling-exceeded",
      alternative("route", { reservation: amount("101"), ceiling: amount("100") }),
    ],
  ] as const)("returns the Core-owned %s rejection", (reason, candidate) => {
    const decision = selectManagedEconomicExecutionAlternative(request([candidate]));
    expect(decision).toMatchObject({
      kind: "denied",
      rejected: [{ stage: "economic-selection", reason }],
    });
  });

  it("admits a reservation exactly at its ceiling", () => {
    const decision = selectManagedEconomicExecutionAlternative(request([
      alternative("route", { reservation: amount("100"), ceiling: amount("100") }),
    ]));
    expect(decision.kind).toBe("selected");
  });

  it("rejects an explicit unknown price basis without erasing the unknown evidence", () => {
    const candidate = alternative("route", {
      account: "accountless",
      price: price("unknown"),
      reservation: null,
    });
    const decision = selectManagedEconomicExecutionAlternative(request([candidate]));
    expect(decision).toMatchObject({
      kind: "denied",
      rejected: [{
        reason: "price-evidence-missing",
        alternativeIdentity: candidate.identity,
      }],
    });
  });

  it("rejects same-rank domains with incompatible currency schemes", () => {
    const usd = alternative("usd");
    const eurBase = alternative("eur");
    const eur: ManagedEconomicExecutionAlternative = {
      ...eurBase,
      identity: {
        ...eurBase.identity,
        route: {
          ...eurBase.identity.route,
          scheme: { kind: "currency", currency: "EUR" },
        },
      },
      comparisonDomain: {
        ...eurBase.comparisonDomain,
        basis: {
          ...eurBase.comparisonDomain.basis,
          scheme: { kind: "currency", currency: "EUR" },
        },
      },
      worstCaseReservation: {
        kind: "exact",
        amount: amount("100", "EUR"),
      },
    };
    const decision = selectManagedEconomicExecutionAlternative(request([usd, eur]));
    expect(decision).toMatchObject({
      kind: "denied",
      rejected: [
        { reason: "comparison-domain-incompatible" },
        { reason: "comparison-domain-incompatible" },
      ],
    });
  });

  it("rejects an execution envelope whose digest is not the committed route digest", () => {
    const candidate = alternative("route");
    const mismatched: ManagedEconomicExecutionAlternative = {
      ...candidate,
      executionEnvelope: {
        ...candidate.executionEnvelope as Extract<typeof candidate.executionEnvelope, { kind: "bounded" }>,
        digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      },
    };
    expect(selectManagedEconomicExecutionAlternative(request([mismatched]))).toMatchObject({
      kind: "denied",
      rejected: [{ reason: "comparison-domain-incompatible" }],
    });
  });

  it.each([
    ["invalid authority", { authority: "self-asserted" }],
    ["invalid confidence", { confidence: "certain" }],
    ["non-canonical digest", { sourceDigest: `sha256:${"A".repeat(64)}` }],
    ["impossible calendar date", { observedAt: "2026-02-30T11:00:00.000Z" }],
    ["non-canonical timestamp", { observedAt: "2026-07-29T11:00:00Z" }],
    [
      "reversed validity interval",
      {
        observedAt: "2026-07-29T13:00:00.000Z",
        validUntil: "2026-07-29T12:00:00.000Z",
      },
    ],
  ])("fails closed for %s evidence", (_label, mutation) => {
    const malformed = {
      ...currentEvidence,
      ...mutation,
    } as unknown as ManagedEconomicEvidenceIdentity;
    const candidate = alternative("route", { price: price("metered", malformed) });
    expect(selectManagedEconomicExecutionAlternative(request([candidate]))).toMatchObject({
      kind: "denied",
      rejected: [{ reason: "comparison-domain-incompatible" }],
    });
  });

  it("binds quota evidence to the selected stable account capacity identity", () => {
    const mismatchedQuota: ManagedEconomicQuotaEvidence = {
      kind: "known",
      capacityIdentity: "different-account",
      subscriptionClass: "metered",
      quotaClassId: "quota-class",
      buckets: [{
        bucketId: "primary",
        dimension: "currency",
        remaining: amount("100"),
        resetsAt: "2026-07-30T12:00:00.000Z",
      }],
      evidence: currentEvidence,
    };
    const decision = selectManagedEconomicExecutionAlternative(request([
      alternative("route", { account: "account-a", quotaEvidence: mismatchedQuota }),
    ]));
    expect(decision).toMatchObject({
      kind: "denied",
      rejected: [{ reason: "comparison-domain-incompatible" }],
    });
  });

  it("preserves unknown quota evidence while rejecting it as unavailable", () => {
    const unknownQuota: ManagedEconomicQuotaEvidence = {
      kind: "unknown",
      capacityIdentity: "account-a",
      subscriptionClass: "unknown",
      reason: "provider-does-not-expose-quota",
      evidence: currentEvidence,
    };
    const decision = selectManagedEconomicExecutionAlternative(request([
      alternative("route", { account: "account-a", quotaEvidence: unknownQuota }),
    ]));
    expect(decision).toMatchObject({
      kind: "denied",
      rejected: [{ reason: "quota-evidence-missing" }],
    });
  });

  it.each([
    ["duplicate bucket identity", [
      {
        bucketId: "primary",
        dimension: "currency",
        remaining: amount("100"),
        resetsAt: null,
      },
      {
        bucketId: "primary",
        dimension: "request",
        remaining: null,
        resetsAt: null,
      },
    ]],
    ["invalid bucket reset", [{
      bucketId: "primary",
      dimension: "currency",
      remaining: amount("100"),
      resetsAt: "2026-02-30T12:00:00.000Z",
    }]],
  ] as const)("rejects %s in account quota evidence", (_label, buckets) => {
    const quota: ManagedEconomicQuotaEvidence = {
      kind: "known",
      capacityIdentity: "account-a",
      subscriptionClass: "metered",
      quotaClassId: "quota-class",
      buckets,
      evidence: currentEvidence,
    };
    expect(selectManagedEconomicExecutionAlternative(request([
      alternative("route", { account: "account-a", quotaEvidence: quota }),
    ]))).toMatchObject({
      kind: "denied",
      rejected: [{ reason: "comparison-domain-incompatible" }],
    });
  });

  it("rejects invalid quota class and exact remaining amount evidence", () => {
    const invalidClass: ManagedEconomicQuotaEvidence = {
      kind: "known",
      capacityIdentity: "account-a",
      subscriptionClass: "metered",
      quotaClassId: "",
      buckets: [{
        bucketId: "primary",
        dimension: "currency",
        remaining: amount("100"),
        resetsAt: null,
      }],
      evidence: currentEvidence,
    };
    expect(selectManagedEconomicExecutionAlternative(request([
      alternative("route", { account: "account-a", quotaEvidence: invalidClass }),
    ]))).toMatchObject({
      kind: "denied",
      rejected: [{ reason: "comparison-domain-incompatible" }],
    });

    const invalidRemaining: ManagedEconomicQuotaEvidence = {
      ...invalidClass,
      quotaClassId: "quota-class",
      buckets: [{
        bucketId: "primary",
        dimension: "currency",
        remaining: { ...amount("100"), atoms: "01" },
        resetsAt: null,
      }],
    };
    expect(selectManagedEconomicExecutionAlternative(request([
      alternative("route", { account: "account-a", quotaEvidence: invalidRemaining }),
    ]))).toMatchObject({
      kind: "denied",
      rejected: [{ reason: "comparison-domain-incompatible" }],
    });
  });

  it("allows missing optional price only for a non-comparable commitment", () => {
    const nonComparable = alternative("priority-only", {
      account: "accountless",
      price: null,
      reservation: null,
    });
    const selected = selectManagedEconomicExecutionAlternative(request([nonComparable], {
      evidenceRequirements: { quota: "optional", price: "optional" },
    }));
    expect(selected.kind).toBe("selected");

    const invalidComparable = alternative("invented-price", {
      account: "accountless",
      price: null,
      reservation: amount("0"),
    });
    expect(selectManagedEconomicExecutionAlternative(request([invalidComparable], {
      evidenceRequirements: { quota: "optional", price: "optional" },
    }))).toMatchObject({
      kind: "denied",
      rejected: [{ reason: "comparison-domain-incompatible" }],
    });

    const reservationPriceBinding: Pick<ManagedEconomicReservation, "priceIdentity"> = {
      priceIdentity: null,
    };
    expect(reservationPriceBinding.priceIdentity).toBeNull();
  });

  it.each([
    ["empty route identity", { routeId: "" }],
    ["invalid route digest", { envelopeDigest: "sha256:not-a-digest" }],
  ])("rejects malformed full route identity: %s", (_label, routeMutation) => {
    const candidate = alternative("route");
    const malformed: ManagedEconomicExecutionAlternative = {
      ...candidate,
      identity: {
        ...candidate.identity,
        route: { ...candidate.identity.route, ...routeMutation },
      },
    };
    expect(selectManagedEconomicExecutionAlternative(request([malformed]))).toMatchObject({
      kind: "denied",
      rejected: [{ reason: "comparison-domain-incompatible" }],
    });
  });

  it("rejects malformed full account identity", () => {
    const candidate = alternative("route");
    if (candidate.identity.account.kind !== "account-bound") {
      throw new Error("fixture must be account-bound");
    }
    const malformed: ManagedEconomicExecutionAlternative = {
      ...candidate,
      identity: {
        ...candidate.identity,
        account: { ...candidate.identity.account, accountRef: "" },
      },
    };
    expect(selectManagedEconomicExecutionAlternative(request([malformed]))).toMatchObject({
      kind: "denied",
      rejected: [{ reason: "comparison-domain-incompatible" }],
    });
  });

  it("rejects price evidence bound to a different exact model identity", () => {
    const candidate = alternative("route");
    const wrongPrice = price("metered");
    const malformed: ManagedEconomicExecutionAlternative = {
      ...candidate,
      priceEvidence: {
        ...wrongPrice,
        identity: { ...wrongPrice.identity, modelId: "different-model" },
      },
    };
    expect(selectManagedEconomicExecutionAlternative(request([malformed]))).toMatchObject({
      kind: "denied",
      rejected: [{ reason: "comparison-domain-incompatible" }],
    });
  });

  it("caller narrowing can only remove alternatives", () => {
    const candidates = [alternative("route-a"), alternative("route-b")];
    expect(narrowManagedEconomicExecutionAlternatives(candidates, {
      routeIds: ["route-b", "route-not-admitted"],
    }).map((candidate) => candidate.identity.route.routeId)).toEqual(["route-b"]);
  });

  it("keeps every settlement authority variant distinct and omits absent charges", () => {
    const identity = alternative("route").identity;
    const common = {
      reservationId: "reservation-1",
      dispatchFenceId: "dispatch-fence-1",
      actualIdentity: identity,
      units: [amount("10")],
      evidence: currentEvidence,
    };
    const settlements: readonly ManagedEconomicSettlement[] = [
      { kind: "charged", ...common, charge: amount("25") },
      { kind: "estimated", ...common, estimate: amount("25") },
      { kind: "subscription", ...common },
      { kind: "included", ...common, allowanceId: "allowance-1" },
      { kind: "free", ...common },
      {
        kind: "unknown",
        reservationId: "reservation-1",
        dispatchFenceId: "dispatch-fence-1",
        actualIdentity: null,
        reason: "settlement-unavailable",
        evidence: null,
      },
      {
        kind: "pending",
        reservationId: "reservation-1",
        dispatchFenceId: "dispatch-fence-1",
      },
      {
        kind: "leaked",
        reservationId: "reservation-1",
        dispatchFenceId: "dispatch-fence-1",
        reason: "external-work-unknown",
      },
    ];
    expect(settlements.map(({ kind }) => kind)).toEqual([
      "charged",
      "estimated",
      "subscription",
      "included",
      "free",
      "unknown",
      "pending",
      "leaked",
    ]);
    for (const settlement of settlements.filter(({ kind }) =>
      kind === "subscription" || kind === "included" || kind === "unknown")) {
      expect(settlement).not.toHaveProperty("charge");
      expect(settlement).not.toHaveProperty("estimate");
    }
  });

  it("projects exact provider units to a local estimate without relabelling it as a charge", () => {
    const fixture = settlementFixture();
    const settlement = createManagedEconomicSettlement({
      commitment: fixture.commitment,
      dispatchFenceId: "dispatch-fence-settlement",
      adoptedRoute: fixture.adoptedRoute,
      report: {
        actualIdentity: fixture.selectedIdentity,
        usage: {
          kind: "complete",
          units: [{ atoms: "200000", scale: 0, unit: "input-token", scheme: { kind: "unit" } }],
        },
        evidence: fixture.reportEvidence,
      },
    });

    expect(settlement).toMatchObject({
      kind: "estimated",
      estimate: { atoms: "25", scale: 0, unit: "currency", scheme: { kind: "currency", currency: "USD" } },
      evidence: { authority: "calculated-estimate" },
    });
    expect(settlement).not.toHaveProperty("charge");
  });

  it("accepts only a provider-reported charge matching the committed unit and scheme", () => {
    const fixture = settlementFixture();
    const providerEvidence: ManagedEconomicEvidenceIdentity = {
      ...fixture.reportEvidence,
      sourceIdentity: "provider-billing-response",
      authority: "provider-reported",
    };
    const create = (currency: string) => createManagedEconomicSettlement({
      commitment: fixture.commitment,
      dispatchFenceId: "dispatch-fence-settlement",
      adoptedRoute: fixture.adoptedRoute,
      report: {
        actualIdentity: fixture.selectedIdentity,
        usage: {
          kind: "complete",
          units: [{ atoms: "10", scale: 0, unit: "input-token", scheme: { kind: "unit" } }],
        },
        evidence: fixture.reportEvidence,
        providerCharge: {
          amount: { atoms: "25", scale: 2, unit: "currency", scheme: { kind: "currency", currency } },
          evidence: providerEvidence,
        },
      },
    });

    expect(create("USD")).toMatchObject({
      kind: "charged",
      charge: { atoms: "25", scale: 2, scheme: { currency: "USD" } },
      evidence: { authority: "provider-reported" },
    });
    expect(() => create("EUR")).toThrow(/committed route scheme/u);
  });

  it("rejects settlement reports whose actual execution identity differs from the commitment", () => {
    const fixture = settlementFixture();
    expect(() => createManagedEconomicSettlement({
      commitment: fixture.commitment,
      dispatchFenceId: "dispatch-fence-settlement",
      adoptedRoute: fixture.adoptedRoute,
      report: {
        actualIdentity: {
          ...fixture.selectedIdentity,
          route: { ...fixture.selectedIdentity.route, modelId: "different-model" },
        },
        usage: { kind: "complete", units: [] },
        evidence: fixture.reportEvidence,
      },
    })).toThrow(/actual identity does not match commitment/u);
  });

  it("keeps incomplete provider usage unknown without an authoritative provider charge", () => {
    const fixture = settlementFixture();
    const settlement = createManagedEconomicSettlement({
      commitment: fixture.commitment,
      dispatchFenceId: "dispatch-fence-settlement",
      adoptedRoute: fixture.adoptedRoute,
      report: {
        actualIdentity: fixture.selectedIdentity,
        usage: {
          kind: "incomplete",
          knownUnits: [{ atoms: "10", scale: 0, unit: "input-token", scheme: { kind: "unit" } }],
          reason: "provider-usage-unknown:output",
        },
        evidence: fixture.reportEvidence,
      },
    });

    expect(settlement).toMatchObject({
      kind: "unknown",
      reason: "provider-usage-unknown:output",
      actualIdentity: fixture.selectedIdentity,
    });
    expect(settlement).not.toHaveProperty("estimate");
  });
});

describe("minimum comparable reservation derivation", () => {
  const usd = { kind: "currency" as const, currency: "USD" };
  const usage = (atoms: string, scale = 0, unit = "input-token") => ({
    atoms,
    scale,
    unit,
    scheme: { kind: "unit" as const },
  });
  const rate = (atoms: string, scale = 6, usageUnit = "input-token") => ({
    usageUnit,
    price: { atoms, scale, unit: usageUnit, scheme: usd },
  });

  it("derives an exact minimum from unit rates, usage bounds, and fixed charges", () => {
    expect(deriveManagedEconomicMinimumReservation({
      unitRates: [rate("125")],
      usageLimits: [usage("200000")],
      auxiliaryCharges: [{
        id: "tool-call",
        amount: { atoms: "150", scale: 2, unit: "request", scheme: usd },
      }],
      outputUnit: "request",
      targetScheme: usd,
    })).toEqual({
      atoms: "265",
      scale: 1,
      unit: "request",
      scheme: usd,
    });
  });

  it("normalizes scales exactly without binary floating point", () => {
    expect(deriveManagedEconomicMinimumReservation({
      unitRates: [rate("1", 2)],
      usageLimits: [usage("25", 1)],
      auxiliaryCharges: [],
      outputUnit: "request",
      targetScheme: usd,
    })).toMatchObject({ atoms: "25", scale: 3 });
  });

  it("allows additional bounded usage dimensions without a separate rate", () => {
    expect(deriveManagedEconomicMinimumReservation({
      unitRates: [rate("125")],
      usageLimits: [usage("200000"), usage("1", 0, "request")],
      auxiliaryCharges: [],
      outputUnit: "request",
      targetScheme: usd,
    })).toMatchObject({ atoms: "25", scale: 0 });
  });

  it.each([
    {
      name: "duplicate rate",
      input: { unitRates: [rate("1"), rate("2")], usageLimits: [usage("1")] },
    },
    {
      name: "duplicate limit",
      input: { unitRates: [rate("1")], usageLimits: [usage("1"), usage("2")] },
    },
    {
      name: "missing limit",
      input: { unitRates: [rate("1")], usageLimits: [] },
    },
    {
      name: "wrong limit scheme",
      input: {
        unitRates: [rate("1")],
        usageLimits: [{ atoms: "1", scale: 0, unit: "input-token", scheme: usd }],
      },
    },
    {
      name: "wrong rate unit",
      input: {
        unitRates: [{ usageUnit: "input-token", price: { atoms: "1", scale: 0, unit: "output-token", scheme: usd } }],
        usageLimits: [usage("1")],
      },
    },
    {
      name: "wrong auxiliary unit",
      input: {
        unitRates: [rate("1")],
        usageLimits: [usage("1")],
        auxiliaryCharges: [{ id: "tool", amount: { atoms: "1", scale: 0, unit: "tool", scheme: usd } }],
      },
    },
    {
      name: "noncanonical atoms",
      input: { unitRates: [rate("01")], usageLimits: [usage("1")] },
    },
    {
      name: "unsupported resulting scale",
      input: { unitRates: [rate("1", 18)], usageLimits: [usage("1", 1)] },
    },
  ])("rejects $name", ({ input }) => {
    expect(() => deriveManagedEconomicMinimumReservation({
      auxiliaryCharges: [],
      outputUnit: "request",
      targetScheme: usd,
      ...input,
    })).toThrow();
  });
});
