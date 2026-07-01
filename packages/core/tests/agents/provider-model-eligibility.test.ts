import { describe, expect, it } from "vitest";
import {
  createProviderModelEvidence,
  type ProviderModelEvidence,
  type ProviderModelEvidenceAuthority,
  type ProviderModelEvidenceObservation,
  type ProviderModelEvidenceState,
  type ProviderModelEvidenceValue,
} from "../../src/agents/provider-model-evidence.js";
import {
  deriveProviderModelEligibility,
  type ProviderModelCapabilityClaim,
  type ProviderModelEligibilityRequirements,
} from "../../src/agents/provider-model-eligibility.js";

const NOW = "2026-07-01T12:00:00.000Z";
const SOURCE = { kind: "catalog", id: "fixture-catalog", version: "1" } as const;

const DEFAULT_STATES = {
  advertised: "confirmed",
  discovered: "confirmed",
  configured: "confirmed",
  authenticated: "confirmed",
  entitled: "confirmed",
  capabilityCompatible: "confirmed",
  policyAdmitted: "confirmed",
  routeHealthy: "confirmed",
  probeVerified: "not-required",
  selectable: "unknown",
} as const;

const DEFAULT_AUTHORITIES: Readonly<Record<ProviderModelEvidenceState, ProviderModelEvidenceAuthority>> = {
  advertised: "provider-authoritative",
  discovered: "provider-authoritative",
  configured: "operator-declared",
  authenticated: "harness-reported",
  entitled: "provider-authoritative",
  capabilityCompatible: "provider-authoritative",
  policyAdmitted: "operator-declared",
  routeHealthy: "runtime-observed",
  probeVerified: "probe-verified",
  selectable: "operator-declared",
};

function observation(
  state: ProviderModelEvidenceState,
  value: ProviderModelEvidenceValue,
  authority: ProviderModelEvidenceAuthority = DEFAULT_AUTHORITIES[state],
): ProviderModelEvidenceObservation {
  return {
    state,
    value,
    provenance: `fixture:${state}`,
    authority,
    source: SOURCE,
    observedAt: NOW,
    expiresAt: "2026-07-02T12:00:00.000Z",
    freshness: "fresh",
  };
}

function evidence(
  overrides: Partial<typeof DEFAULT_STATES> = {},
  options: {
    readonly routeScope?: string;
    readonly routeModel?: string;
    readonly normalizedFamily?: string;
    readonly staleStates?: readonly ProviderModelEvidenceState[];
    readonly authorities?: Readonly<Partial<Record<ProviderModelEvidenceState, ProviderModelEvidenceAuthority>>>;
    readonly observedAt?: string;
  } = {},
): ProviderModelEvidence {
  const states = { ...DEFAULT_STATES, ...overrides };
  const observations = (Object.entries(states) as [ProviderModelEvidenceState, ProviderModelEvidenceValue][])
    .filter(([, value]) => value !== "not-required")
    .map(([state, value]) => ({
      ...observation(state, value, options.authorities?.[state]),
      observedAt: options.observedAt ?? NOW,
      freshness: options.staleStates?.includes(state) ? "stale" as const : "fresh" as const,
    }));

  return createProviderModelEvidence({
    identity: {
      harness: {
        harnessId: "fixture-harness",
        reportedProviderId: "fixture-provider",
        reportedModelId: options.routeModel ?? "fixture-model-v1",
      },
      provider: { providerId: "fixture-provider" },
      normalizedModel: { family: options.normalizedFamily ?? "fixture-family", version: "1" },
      route: {
        providerId: "fixture-provider",
        providerModelId: options.routeModel ?? "fixture-model-v1",
        scope: options.routeScope ?? "account-a",
      },
    },
    aliases: [{ alias: "fixture-latest", rawId: "fixture-model-v1", provenance: "fixture alias", source: SOURCE }],
    states,
    observations,
    failures: [],
  });
}

function evidenceWithObservations(
  input: ProviderModelEvidence,
  observations: readonly ProviderModelEvidenceObservation[],
): ProviderModelEvidence {
  return createProviderModelEvidence({
    identity: input.identity,
    aliases: input.aliases,
    states: input.states,
    observations,
    failures: input.failures,
  });
}

function capability(
  capabilityName: string,
  authority: ProviderModelEvidenceAuthority = "provider-authoritative",
): ProviderModelCapabilityClaim & { readonly route: ProviderModelEvidence["identity"]["route"] } {
  return {
    capability: capabilityName,
    supported: true,
    provenance: "fixture capability declaration",
    authority,
    source: SOURCE,
    observedAt: NOW,
    freshness: "fresh",
    route: {
      providerId: "fixture-provider",
      providerModelId: "fixture-model-v1",
      scope: "account-a",
    },
  };
}

function requirements(
  overrides: Partial<ProviderModelEligibilityRequirements> = {},
): ProviderModelEligibilityRequirements {
  return {
    use: "interactive",
    requiredCapabilities: [],
    minimumCapabilityAuthority: "harness-reported",
    requireProbe: false,
    evaluatedAt: NOW,
    ...overrides,
  } as ProviderModelEligibilityRequirements;
}

describe("deriveProviderModelEligibility", () => {
  it("rejects structurally plausible evidence that did not pass the validation boundary", () => {
    const validated = evidence();
    const rawCopy = structuredClone(validated) as ProviderModelEvidence;

    expect(() => deriveProviderModelEligibility(rawCopy, requirements(), [])).toThrow(
      "Provider-model evidence must be created by createProviderModelEvidence",
    );
  });
  it("admits complete fresh evidence deterministically without mutating the evidence", () => {
    const input = evidence();
    const before = structuredClone(input);
    const first = deriveProviderModelEligibility(input, requirements(), []);
    const second = deriveProviderModelEligibility(input, requirements(), []);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ eligible: true, use: "interactive", reasons: [] });
    expect(input).toEqual(before);
  });

  it.each([
    ["configured", "missing-configured-evidence"],
    ["authenticated", "missing-authentication-evidence"],
    ["entitled", "missing-entitlement-evidence"],
    ["capabilityCompatible", "missing-capability-evidence"],
    ["policyAdmitted", "missing-policy-evidence"],
    ["routeHealthy", "missing-route-health-evidence"],
  ] as const)("fails closed when required %s evidence is missing", (state, reason) => {
    const decision = deriveProviderModelEligibility(evidence({ [state]: "unknown" }), requirements(), []);

    expect(decision).toMatchObject({ eligible: false });
    expect(decision.reasons).toContain(reason);
  });

  it("does not promote authentication into entitlement", () => {
    const decision = deriveProviderModelEligibility(
      evidence({ authenticated: "confirmed", entitled: "unknown" }),
      requirements(),
      [],
    );

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain("missing-entitlement-evidence");
  });

  it("does not promote discovery into capability compatibility or route health", () => {
    const decision = deriveProviderModelEligibility(
      evidence({ discovered: "confirmed", capabilityCompatible: "unknown", routeHealthy: "unknown" }),
      requirements(),
      [],
    );

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      "missing-capability-evidence",
      "missing-route-health-evidence",
    ]));
  });

  it("rejects stale required evidence even when its state is confirmed", () => {
    const decision = deriveProviderModelEligibility(
      evidence({}, { staleStates: ["entitled"] }),
      requirements(),
      [],
    );

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain("stale-entitlement-evidence");
  });

  it("uses the explicit decision time and rejects expired evidence even when labeled fresh", () => {
    const input = evidence();
    const expiredButMislabeled = evidenceWithObservations(
      input,
      input.observations.map((item) => ({
        ...item,
        freshness: "fresh" as const,
        observedAt: "2026-07-01T11:00:00.000Z",
        expiresAt: "2026-07-01T11:59:59.000Z",
      })),
    );

    const decision = deriveProviderModelEligibility(
      expiredButMislabeled,
      requirements({ evaluatedAt: NOW } as Partial<ProviderModelEligibilityRequirements>),
      [],
    );

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain("stale-authentication-evidence");
  });

  it.each([
    ["authenticated", "insufficient-authentication-authority"],
    ["entitled", "insufficient-entitlement-authority"],
    ["policyAdmitted", "insufficient-policy-authority"],
    ["routeHealthy", "insufficient-route-health-authority"],
  ] as const)("does not authorize %s from inferred evidence", (state, reason) => {
    const input = evidence();
    const inferred = evidenceWithObservations(
      input,
      input.observations.map((item) => (
        item.state === state ? { ...item, authority: "inferred" as const } : item
      )),
    );

    const decision = deriveProviderModelEligibility(inferred, requirements(), []);

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain(reason);
  });

  it("rejects matching free-form capability claims outside the canonical registry vocabulary", () => {
    const inventedCapability = "provider-special-secret-mode";
    const decision = deriveProviderModelEligibility(
      evidence(),
      requirements({ requiredCapabilities: [inventedCapability] }),
      [capability(inventedCapability)],
    );

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain(`unknown-capability:${inventedCapability}`);
  });

  it("keeps policy denial distinct from an unhealthy route", () => {
    const policyDenied = deriveProviderModelEligibility(
      evidence({ policyAdmitted: "denied" }),
      requirements(),
      [],
    );
    const unhealthy = deriveProviderModelEligibility(
      evidence({ routeHealthy: "denied" }),
      requirements(),
      [],
    );

    expect(policyDenied.reasons).toContain("policy-denied");
    expect(policyDenied.reasons).not.toContain("route-unhealthy");
    expect(unhealthy.reasons).toContain("route-unhealthy");
    expect(unhealthy.reasons).not.toContain("policy-denied");
  });

  it.each([
    ["configured", "configuration-denied"],
    ["authenticated", "authentication-denied"],
    ["entitled", "entitlement-denied"],
    ["capabilityCompatible", "capability-incompatible"],
    ["policyAdmitted", "policy-denied"],
    ["routeHealthy", "route-unhealthy"],
    ["probeVerified", "probe-failed"],
  ] as const)("retains an explicit denial classification for %s", (state, reason) => {
    const decision = deriveProviderModelEligibility(
      evidence({ [state]: "denied" }),
      requirements({ requireProbe: state === "probeVerified" }),
      [],
    );

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain(reason);
  });

  it("fails closed when a confirmed state lacks its own confirming observation", () => {
    const input = evidence();
    const withoutEntitlementObservation = evidenceWithObservations(
      input,
      input.observations.filter((item) => item.state !== "entitled"),
    );

    const decision = deriveProviderModelEligibility(withoutEntitlementObservation, requirements(), []);

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain("missing-entitlement-evidence");
  });

  it("requires probe evidence only for a use policy that explicitly requires it", () => {
    const input = evidence({ probeVerified: "unknown" });

    expect(deriveProviderModelEligibility(input, requirements({ requireProbe: false }), []).eligible).toBe(true);
    expect(deriveProviderModelEligibility(input, requirements({ requireProbe: true }), [])).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(["missing-probe-evidence"]),
    });
  });

  it("requires every requested capability to have fresh evidence with sufficient authority", () => {
    const req = requirements({ requiredCapabilities: ["tools", "structured-output"] });

    expect(deriveProviderModelEligibility(evidence(), req, [capability("tools")])).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(["missing-capability:structured-output"]),
    });
    expect(deriveProviderModelEligibility(evidence(), req, [
      capability("tools", "inferred"),
      capability("structured-output"),
    ])).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(["insufficient-capability-authority:tools"]),
    });
  });

  it("does not use a capability claim belonging to another execution route", () => {
    const routeBClaim = {
      ...capability("tools"),
      route: { providerId: "fixture-provider", providerModelId: "fixture-model-v1", scope: "account-b" },
    };

    const decision = deriveProviderModelEligibility(
      evidence(),
      requirements({ requiredCapabilities: ["tools"] }),
      [routeBClaim],
    );

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain("missing-capability:tools");
  });

  it.each([
    ["empty provenance", { provenance: "" }],
    ["empty source identity", { source: { kind: "catalog", id: "" } }],
    ["malformed observation time", { observedAt: "not-a-timestamp" }],
    ["expiry before observation", { expiresAt: "2026-07-01T11:59:59.000Z" }],
  ] as const)("rejects capability claims with %s at the eligibility boundary", (_label, invalid) => {
    const claim = { ...capability("tools"), ...invalid } as ProviderModelCapabilityClaim;

    expect(() => deriveProviderModelEligibility(
      evidence(),
      requirements({ requiredCapabilities: ["tools"] }),
      [claim],
    )).toThrow(TypeError);
  });

  it.each([
    ["configured", "provider-authoritative", "insufficient-configured-authority"],
    ["policyAdmitted", "harness-reported", "insufficient-policy-authority"],
    ["authenticated", "operator-declared", "insufficient-authentication-authority"],
    ["entitled", "operator-declared", "insufficient-entitlement-authority"],
    ["routeHealthy", "operator-declared", "insufficient-route-health-authority"],
  ] as const)("rejects %s evidence from a source without authority for that purpose", (state, authority, reason) => {
    const decision = deriveProviderModelEligibility(
      evidence({}, { authorities: { [state]: authority } }),
      requirements(),
      [],
    );

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain(reason);
  });

  it("accepts explicit authority owners for canonical and provider facts", () => {
    const decision = deriveProviderModelEligibility(evidence({}, {
      authorities: {
        configured: "operator-declared",
        policyAdmitted: "operator-declared",
        authenticated: "harness-reported",
        entitled: "provider-authoritative",
        routeHealthy: "runtime-observed",
      },
    }), requirements(), []);

    expect(decision.eligible).toBe(true);
  });

  it("lets an equal-authority denial override confirmation regardless of claim order", () => {
    const confirmation = capability("tools", "provider-authoritative");
    const denial = { ...confirmation, supported: false, provenance: "provider denial" };
    const req = requirements({ requiredCapabilities: ["tools"] });

    expect(deriveProviderModelEligibility(evidence(), req, [confirmation, denial]).reasons)
      .toContain("unsupported-capability:tools");
    expect(deriveProviderModelEligibility(evidence(), req, [denial, confirmation]).reasons)
      .toContain("unsupported-capability:tools");
  });

  it("lets a higher-authority denial override a lower-authority confirmation", () => {
    const confirmation = capability("tools", "harness-reported");
    const denial = { ...capability("tools", "provider-authoritative"), supported: false };

    expect(deriveProviderModelEligibility(
      evidence(),
      requirements({ requiredCapabilities: ["tools"] }),
      [confirmation, denial],
    ).reasons).toContain("unsupported-capability:tools");
  });

  it("rejects observations from the future relative to the deterministic evaluation time", () => {
    const decision = deriveProviderModelEligibility(
      evidence({}, { observedAt: "2026-07-01T12:00:01.000Z" }),
      requirements({ evaluatedAt: NOW } as Partial<ProviderModelEligibilityRequirements>),
      [],
    );

    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain("future-entitlement-evidence");
  });

  it("distinguishes stale and authoritative unsupported capability evidence", () => {
    const req = requirements({ requiredCapabilities: ["tools"] });
    const staleClaim = { ...capability("tools"), freshness: "stale" as const };
    const unsupportedClaim = { ...capability("tools", "provider-authoritative"), supported: false };

    expect(deriveProviderModelEligibility(evidence(), req, [staleClaim]).reasons)
      .toContain("stale-capability:tools");
    expect(deriveProviderModelEligibility(evidence(), req, [unsupportedClaim]).reasons)
      .toContain("unsupported-capability:tools");
  });

  it("lets the highest-authority capability claim control contradictory lower-authority evidence", () => {
    const req = requirements({ requiredCapabilities: ["tools"] });
    const lowerDenial = { ...capability("tools", "harness-reported"), supported: false };
    const providerConfirmation = capability("tools", "provider-authoritative");

    expect(deriveProviderModelEligibility(evidence(), req, [lowerDenial, providerConfirmation])).toMatchObject({
      eligible: true,
      reasons: [],
    });
  });

  it("allows interactive and managed-agent policies to require different evidence", () => {
    const input = evidence({ probeVerified: "unknown" });
    const interactive = deriveProviderModelEligibility(
      input,
      requirements({ use: "interactive", requireProbe: false }),
      [],
    );
    const managed = deriveProviderModelEligibility(
      input,
      requirements({ use: "managed-agent", requireProbe: true }),
      [],
    );

    expect(interactive.eligible).toBe(true);
    expect(managed).toMatchObject({ eligible: false, use: "managed-agent" });
    expect(managed.reasons).toContain("missing-probe-evidence");
  });

  it("preserves aliases and distinct execution routes for the same normalized family", () => {
    const accountA = evidence({}, { routeScope: "account-a", normalizedFamily: "fixture-family" });
    const accountB = evidence({}, { routeScope: "account-b", normalizedFamily: "fixture-family" });
    const decisionA = deriveProviderModelEligibility(accountA, requirements(), []);
    const decisionB = deriveProviderModelEligibility(accountB, requirements(), []);

    expect(decisionA.route).not.toEqual(decisionB.route);
    expect(decisionA.normalizedModel).toEqual(decisionB.normalizedModel);
    expect(decisionA.aliases).toEqual(accountA.aliases);
    expect(decisionB.aliases).toEqual(accountB.aliases);
  });
});
