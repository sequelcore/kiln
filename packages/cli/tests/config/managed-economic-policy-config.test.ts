import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountRef } from "@kilnai/core";
import { SqliteManagedAccountLeaseAuthority } from "@kilnai/runtime";
import { validateGlobalConfig, type KilnGlobalConfig } from "../../src/config/global-config.js";
import {
  closeManagedAccountRuntimeComposition,
  createManagedAccountRuntimeComposition,
  projectManagedEconomicJobAdoption,
} from "../../src/config/managed-agent-routes.js";

function economicConfig(): KilnGlobalConfig {
  return {
    version: "1",
    managedAgents: {
      schemaVersion: 2,
      routes: [{
        id: "codex-standard",
        kind: "direct",
        provider: "codex-oauth",
        model: "gpt-5.6-codex",
        credentials: {
          mode: "runtime-selected",
          routeId: "codex-standard",
          accountPolicyId: "codex-standard-policy",
        },
      }],
      economicPolicies: [{
        id: "default-economic-policy",
        revision: "rev-2026-07",
        evidenceRequirements: {
          quota: "required-for-account-bound",
          price: "required",
        },
        noRouteAction: "deny",
        comparisonDomains: [{
          id: "usd-worst-case",
          rank: 0,
          unit: "request",
          scheme: { kind: "currency", currency: "USD" },
          rateCardBasis: "public-rate-card",
          envelopeSemantics: "configured-upper-bound",
        }],
        candidates: [{
          routeId: "codex-standard",
          comparisonDomainId: "usd-worst-case",
          priorityRank: 0,
          ceiling: {
            kind: "finite",
            amount: {
              atoms: "25",
              scale: 0,
              unit: "request",
              scheme: { kind: "currency", currency: "USD" },
            },
          },
          worstCaseReservation: {
            kind: "exact",
            amount: {
              atoms: "25",
              scale: 0,
              unit: "request",
              scheme: { kind: "currency", currency: "USD" },
            },
          },
        }],
      }],
    },
    modelGateway: {
      port: 4819,
      accounts: [{
        id: "codex-account",
        providerId: "codex-oauth",
        credentialId: "codex-credential",
        maxConcurrency: 1,
        reservedAffinitySlots: 0,
        economics: {
          capacityIdentity: "codex-capacity",
          subscriptionClass: "metered",
          quotaClassId: "codex-standard",
          creditPosture: "disabled",
          overagePosture: "disabled",
        },
      }],
      replay: { ttlMs: 60_000, maxEntries: 10, hmacKeyEnv: "REPLAY_SECRET" },
      surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
      principals: [{
        tokenEnv: "KILN_RESPONSES_TOKEN",
        ingress: "openai-responses",
        tenantId: "tenant",
        applicationId: "managed-agent",
        callerId: "caller",
        capabilityId: "model-invoke",
        scopes: ["model.invoke"],
        budgetEvidenceId: "budget",
        virtualModelIds: ["codex-standard-policy"],
      }],
      virtualModels: [{
        id: "codex-standard-policy",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-codex",
        accountIds: ["codex-account"],
        capabilities: ["text"],
        affinity: { continuity: "none" },
        economics: {
          adapterCapabilityId: "codex-direct",
          adapterCapabilityVersion: "v1",
          authBillingChannel: "oauth-subscription",
          executionMode: "responses-api",
          serviceTier: "standard",
          rateCardBasis: "public-rate-card",
          envelopeSemantics: "configured-upper-bound",
          fallbackPosture: "disabled",
          overagePosture: "disabled",
          contextClass: "standard-context",
          cacheClass: "provider-cache",
          priceEvidence: {
            kind: "metered",
            rateCardId: "codex-public",
            rateCardRevision: "rev-2026-07",
            unitPrices: [{
              usageUnit: "input-token",
              price: {
                atoms: "125",
                scale: 6,
                unit: "input-token",
                scheme: { kind: "currency", currency: "USD" },
              },
            }],
            evidence: {
              sourceIdentity: "openai-pricing",
              sourceRevision: "rev-2026-07",
              sourceDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              observedAt: "2026-07-29T00:00:00.000Z",
              validUntil: "2026-08-29T00:00:00.000Z",
              confidence: "high",
              authority: "provider-reported",
            },
          },
          auxiliaryCharges: [],
          executionEnvelope: {
            limits: [{
              atoms: "200000",
              scale: 0,
              unit: "input-token",
              scheme: { kind: "unit" },
            }],
          },
        },
      }],
    },
  };
}

function accountlessEconomicConfig(): KilnGlobalConfig {
  const config = structuredClone(economicConfig()) as Record<string, any>;
  config.managedAgents.routes[0].credentials = {
    mode: "credentialless",
    economicsRouteId: "codex-standard-policy",
  };
  config.modelGateway.accounts = [];
  config.modelGateway.virtualModels[0].accountIds = [];
  return config as KilnGlobalConfig;
}

function economicJob(jobId: string, economicAttemptId: string) {
  return {
    version: 6,
    id: jobId,
    projectId: "project-a",
    callerId: "caller-a",
    economicAttemptId,
    adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
    economicPolicyId: "default-economic-policy",
    economicPolicyRevision: "rev-2026-07",
    constraints: {},
    candidateSet: { candidates: [{
      routeId: "codex-standard",
      routeSource: "explicit-managed-route",
      providerId: "codex-oauth",
      model: "gpt-5.6-codex",
      accountPolicyId: "codex-standard-policy",
      adapterCapabilityId: "codex-direct",
      adapterCapabilityVersion: "v1",
    }] },
  } as never;
}

function economicRoutingResolution() {
  return {
    route: { providerId: "codex-oauth", providerModelId: "gpt-5.6-codex", scope: "virtual:codex-standard-policy" },
    affinityPolicy: { continuity: "none" as const },
    candidates: [{
      candidate: {
        account: createAccountRef("configured:codex-account:fixture"),
        route: { providerId: "codex-oauth", providerModelId: "gpt-5.6-codex", scope: "virtual:codex-standard-policy" },
        health: "healthy" as const,
        leaseCapacity: "available" as const,
        pressure: 0,
        reservedForNewWork: false,
      },
      capacityIdentity: "codex-capacity",
      credentialRevisionId: "a".repeat(64),
      usageEvidence: { health: "healthy" as const, freshness: "missing" as const },
      quotaEvidence: {
        kind: "known" as const,
        capacityIdentity: "codex-capacity",
        subscriptionClass: "metered" as const,
        quotaClassId: "codex-standard",
        buckets: [{
          bucketId: "request-budget",
          dimension: "request",
          remaining: {
            atoms: "100",
            scale: 0,
            unit: "request",
            scheme: { kind: "currency" as const, currency: "USD" },
          },
          resetsAt: null,
        }],
        evidence: economicConfig().modelGateway!.virtualModels[0]!.economics!.priceEvidence.evidence,
      },
      capacity: { maxConcurrency: 1, reservedAffinitySlots: 0 },
    }],
  };
}

async function acquireRecoveryFixture(
  composition: NonNullable<ReturnType<typeof createManagedAccountRuntimeComposition>>,
  jobId: string,
  economicAttemptId: string,
) {
  const adoption = await projectManagedEconomicJobAdoption(
    economicConfig(),
    economicJob(jobId, economicAttemptId),
    { resolve: async () => economicRoutingResolution() } as never,
  );
  return composition.authority.acquireCommitment({
    jobId,
    economicAttemptId,
    intentFingerprint: `sha256:${"9".repeat(64)}`,
    ...adoption,
  });
}

describe("managed economic policy config", () => {
  it("projects a replay-stable Core snapshot solely from config and persisted admission", async () => {
    const resolve = vi.fn(async () => ({
      route: { providerId: "codex-oauth", providerModelId: "gpt-5.6-codex", scope: "virtual:codex-standard-policy" },
      affinityPolicy: { continuity: "none" },
      candidates: [],
    }));
    const adoption = await projectManagedEconomicJobAdoption(economicConfig(), {
      version: 6,
      economicAttemptId: "economic-attempt:test-attempt-001",
      adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
      economicPolicyId: "default-economic-policy",
      economicPolicyRevision: "rev-2026-07",
      constraints: {},
      candidateSet: {
        economicPolicyId: "default-economic-policy",
        economicPolicyRevision: "rev-2026-07",
        admissionProfileId: "foundation-readonly-plan",
        constraints: {},
        candidates: [{
          routeId: "codex-standard",
          routeSource: "explicit-managed-route",
          providerId: "codex-oauth",
          model: "gpt-5.6-codex",
          accountPolicyId: "codex-standard-policy",
          surface: "direct-provider",
          adapterCapabilityId: "codex-direct",
          adapterCapabilityVersion: "v1",
        }],
        rejections: [],
      },
    } as never, { resolve } as never);

    expect(adoption.snapshot).toMatchObject({
      adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
      policy: { policyId: "default-economic-policy", policyRevision: "rev-2026-07" },
      routes: [{
        route: {
          routeId: "codex-standard",
          rateCardRevision: "rev-2026-07",
          priceEvidenceDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        admittedIdentity: {
          adapterCapabilityId: "codex-direct",
          accountPolicy: { kind: "account-bound", accountPolicyId: "codex-standard-policy" },
        },
      }],
    });
    expect(adoption.snapshot.snapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(adoption.expectation.candidateSetDigest).toBe(adoption.snapshot.candidateSetDigest);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it.each([
    { continuity: "prefer" as const, scope: "session" as const, allowRebind: true },
    { continuity: "require" as const, scope: "turn" as const },
  ])("projects configured $continuity/$scope affinity as opaque persisted-lineage evidence", async (affinityPolicy) => {
    const resolve = vi.fn(async () => ({
      route: { providerId: "codex-oauth", providerModelId: "gpt-5.6-codex", scope: "virtual:codex-standard-policy" },
      affinityPolicy,
      candidates: [],
    }));
    const job = {
      version: 6,
      id: "job-affinity",
      projectId: "project-a",
      callerId: "caller-a",
      economicAttemptId: "economic-attempt:affinity-001",
      adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
      economicPolicyId: "default-economic-policy",
      economicPolicyRevision: "rev-2026-07",
      constraints: {},
      parent: { invocationId: "parent-invocation-secret", turnId: "parent-turn-secret" },
      candidateSet: {
        candidates: [{
          routeId: "codex-standard",
          routeSource: "explicit-managed-route",
          providerId: "codex-oauth",
          model: "gpt-5.6-codex",
          accountPolicyId: "codex-standard-policy",
          adapterCapabilityId: "codex-direct",
          adapterCapabilityVersion: "v1",
        }],
      },
    } as never;

    const adoption = await projectManagedEconomicJobAdoption(economicConfig(), job, { resolve } as never);
    const request = adoption.routeCapacity[0]?.affinityRequest;

    expect(request).toMatchObject(affinityPolicy);
    expect(request).toHaveProperty("key", expect.stringMatching(/^[a-f0-9]{64}$/u));
    expect(JSON.stringify(request)).not.toContain("parent-invocation-secret");
    expect(JSON.stringify(request)).not.toContain("parent-turn-secret");
  });

  it("fails closed when configured affinity continuity lacks persisted parent lineage", async () => {
    const resolve = vi.fn(async () => ({
      route: { providerId: "codex-oauth", providerModelId: "gpt-5.6-codex", scope: "virtual:codex-standard-policy" },
      affinityPolicy: { continuity: "require" as const, scope: "session" as const },
      candidates: [],
    }));

    await expect(projectManagedEconomicJobAdoption(economicConfig(), {
      version: 6,
      id: "job-affinity",
      projectId: "project-a",
      callerId: "caller-a",
      economicAttemptId: "economic-attempt:affinity-001",
      adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
      economicPolicyId: "default-economic-policy",
      economicPolicyRevision: "rev-2026-07",
      constraints: {},
      candidateSet: { candidates: [{
        routeId: "codex-standard", routeSource: "explicit-managed-route",
        providerId: "codex-oauth", model: "gpt-5.6-codex",
        accountPolicyId: "codex-standard-policy",
        adapterCapabilityId: "codex-direct", adapterCapabilityVersion: "v1",
      }] },
    } as never, { resolve } as never)).rejects.toMatchObject({ code: "identity-revision-conflict" });
  });

  it("maps exact persisted policy revision drift to identity-revision-conflict without capacity lookup", async () => {
    const resolve = vi.fn();
    await expect(projectManagedEconomicJobAdoption(economicConfig(), {
      version: 6,
      economicPolicyId: "default-economic-policy",
      economicPolicyRevision: "older-revision",
      candidateSet: { candidates: [] },
    } as never, { resolve } as never)).rejects.toMatchObject({
      code: "identity-revision-conflict",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("projects an accountless route without fabricating account candidates", async () => {
    const config = accountlessEconomicConfig();
    const resolve = vi.fn();
    const adoption = await projectManagedEconomicJobAdoption(config, {
      version: 6,
      economicAttemptId: "economic-attempt:accountless-001",
      adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
      economicPolicyId: "default-economic-policy",
      economicPolicyRevision: "rev-2026-07",
      constraints: {},
      candidateSet: {
        candidates: [{
          routeId: "codex-standard",
          routeSource: "explicit-managed-route",
          providerId: "codex-oauth",
          model: "gpt-5.6-codex",
          adapterCapabilityId: "codex-direct",
          adapterCapabilityVersion: "v1",
        }],
      },
    } as never, { resolve } as never);

    expect(adoption.snapshot.routes[0]).toMatchObject({
      admittedIdentity: { accountPolicy: { kind: "accountless" } },
      route: { accountPolicyId: null },
    });
    expect(adoption.routeCapacity).toEqual([{ routeId: "codex-standard" }]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("validates an explicit accountless economics route without fabricating an account", () => {
    const config = accountlessEconomicConfig();

    expect(() => validateGlobalConfig(config)).not.toThrow();
    expect(config.modelGateway?.accounts).toEqual([]);
    expect(config.modelGateway?.virtualModels[0]?.accountIds).toEqual([]);
  });

  it("rejects missing, mismatched, and account-backed accountless economics links", () => {
    const missing = accountlessEconomicConfig() as Record<string, any>;
    delete missing.managedAgents.routes[0].credentials.economicsRouteId;
    expect(() => validateGlobalConfig(missing)).toThrow(/explicit virtual economics route reference/);

    const mismatched = accountlessEconomicConfig() as Record<string, any>;
    mismatched.modelGateway.virtualModels[0].providerModelId = "different-model";
    expect(() => validateGlobalConfig(mismatched)).toThrow(/provider and model must match/);

    const accountBacked = accountlessEconomicConfig() as Record<string, any>;
    accountBacked.modelGateway.accounts = structuredClone(economicConfig().modelGateway!.accounts);
    accountBacked.modelGateway.virtualModels[0].accountIds = ["codex-account"];
    expect(() => validateGlobalConfig(accountBacked)).toThrow(/must have zero accountIds/);
  });

  it("creates the shared SQLite authority for accountless-only economics", () => {
    const cwd = mkdtempSync(join(tmpdir(), "kiln-accountless-economics-"));
    try {
      const composition = createManagedAccountRuntimeComposition(accountlessEconomicConfig(), cwd);
      expect(composition?.authority).toBeDefined();
      expect(composition?.routing).toBeDefined();
    } finally {
      closeManagedAccountRuntimeComposition(cwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("releases orphaned pre-fence commitments when a new composition takes ownership", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "kiln-economic-held-recovery-"));
    try {
      const first = createManagedAccountRuntimeComposition(economicConfig(), cwd)!;
      await expect(acquireRecoveryFixture(first, "job-held", "economic-attempt:held-001"))
        .resolves.toMatchObject({ status: "committed", record: { state: "held" } });
      closeManagedAccountRuntimeComposition(cwd);

      const restarted = createManagedAccountRuntimeComposition(economicConfig(), cwd)!;
      expect(restarted.authority.queryCommitment("job-held", "economic-attempt:held-001"))
        .toMatchObject({ state: "released" });
      await expect(acquireRecoveryFixture(restarted, "job-next", "economic-attempt:held-002"))
        .resolves.toMatchObject({ status: "committed" });
    } finally {
      closeManagedAccountRuntimeComposition(cwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps recovered dispatch-fenced commitments settlement-pending and capacity-consuming", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "kiln-economic-fenced-recovery-"));
    try {
      const first = createManagedAccountRuntimeComposition(economicConfig(), cwd)!;
      await acquireRecoveryFixture(first, "job-fenced", "economic-attempt:fenced-001");
      first.authority.fenceDispatch("job-fenced", "economic-attempt:fenced-001", "dispatch-fence-a");
      closeManagedAccountRuntimeComposition(cwd);

      const restarted = createManagedAccountRuntimeComposition(economicConfig(), cwd)!;
      expect(restarted.authority.queryCommitment("job-fenced", "economic-attempt:fenced-001"))
        .toMatchObject({ state: "settlement-pending" });
      await expect(acquireRecoveryFixture(restarted, "job-next", "economic-attempt:fenced-002"))
        .resolves.toMatchObject({ status: "denied" });
    } finally {
      closeManagedAccountRuntimeComposition(cwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("fails composition startup and closes the authority when recovery fails", () => {
    const cwd = mkdtempSync(join(tmpdir(), "kiln-economic-recovery-failure-"));
    const recover = vi.spyOn(SqliteManagedAccountLeaseAuthority.prototype, "recoverCommitments")
      .mockImplementationOnce(() => { throw new Error("synthetic recovery failure"); });
    const close = vi.spyOn(SqliteManagedAccountLeaseAuthority.prototype, "close");
    try {
      expect(() => createManagedAccountRuntimeComposition(economicConfig(), cwd))
        .toThrow("Managed account startup recovery failed");
      expect(close).toHaveBeenCalledOnce();
    } finally {
      recover.mockRestore();
      close.mockRestore();
      closeManagedAccountRuntimeComposition(cwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it("admits one explicit versioned policy with complete direct-route economics", () => {
    expect(() => validateGlobalConfig(economicConfig())).not.toThrow();
  });

  it("requires the one-way schema version and rejects unknown policy fields", () => {
    const missingVersion = structuredClone(economicConfig()) as Record<string, any>;
    delete missingVersion.managedAgents.schemaVersion;
    expect(() => validateGlobalConfig(missingVersion)).toThrow(/schemaVersion must be 2/);

    const unknown = structuredClone(economicConfig()) as Record<string, any>;
    unknown.managedAgents.economicPolicies[0].estimatedCost = 0.25;
    expect(() => validateGlobalConfig(unknown)).toThrow(/estimatedCost/);

    const unknownReservation = structuredClone(economicConfig()) as Record<string, any>;
    unknownReservation.managedAgents.economicPolicies[0].candidates[0].worstCaseReservation.rounding = "float";
    expect(() => validateGlobalConfig(unknownReservation)).toThrow(/rounding/);

    const emptyPolicies = structuredClone(economicConfig()) as Record<string, any>;
    emptyPolicies.managedAgents.economicPolicies = [];
    expect(() => validateGlobalConfig(emptyPolicies)).toThrow(/schemaVersion 2 requires non-empty economicPolicies/);

    const missingPolicies = structuredClone(economicConfig()) as Record<string, any>;
    delete missingPolicies.managedAgents.economicPolicies;
    expect(() => validateGlobalConfig(missingPolicies)).toThrow(/schemaVersion 2 requires non-empty economicPolicies/);
  });

  it("rejects broken candidate, route, virtual-model, and account cross-links", () => {
    const unknownRoute = structuredClone(economicConfig()) as Record<string, any>;
    unknownRoute.managedAgents.economicPolicies[0].candidates[0].routeId = "missing";
    expect(() => validateGlobalConfig(unknownRoute)).toThrow(/routeId must reference managedAgents.routes/);

    const missingRouteEconomics = structuredClone(economicConfig()) as Record<string, any>;
    delete missingRouteEconomics.modelGateway.virtualModels[0].economics;
    expect(() => validateGlobalConfig(missingRouteEconomics)).toThrow(/virtual model with economics/);

    const missingAccountEconomics = structuredClone(economicConfig()) as Record<string, any>;
    delete missingAccountEconomics.modelGateway.accounts[0].economics;
    expect(() => validateGlobalConfig(missingAccountEconomics)).toThrow(/economics for every account candidate/);
  });

  it("rejects unsupported providers, implicit fallback, and incompatible ceilings", () => {
    const unsupported = structuredClone(economicConfig()) as Record<string, any>;
    unsupported.managedAgents.routes[0].provider = "anthropic";
    unsupported.modelGateway.accounts[0].providerId = "anthropic";
    unsupported.modelGateway.virtualModels[0].providerId = "anthropic";
    expect(() => validateGlobalConfig(unsupported)).toThrow(/supported direct economic route/);

    const fallback = structuredClone(economicConfig()) as Record<string, any>;
    fallback.modelGateway.virtualModels[0].economics.fallbackPosture = "committed";
    expect(() => validateGlobalConfig(fallback)).toThrow(/uncommitted fallback or overage/);

    const ceiling = structuredClone(economicConfig()) as Record<string, any>;
    ceiling.managedAgents.economicPolicies[0].candidates[0].ceiling.amount.scheme.currency = "EUR";
    expect(() => validateGlobalConfig(ceiling)).toThrow(/comparison domain unit and scheme/);

    const committedAccount = structuredClone(economicConfig()) as Record<string, any>;
    committedAccount.modelGateway.accounts[0].economics.creditPosture = "committed";
    expect(() => validateGlobalConfig(committedAccount)).toThrow(/account credit or overage subcommitments/);
  });

  it("rejects duplicate domains, candidates, and non-canonical decimal ceilings", () => {
    const duplicateDomain = structuredClone(economicConfig()) as Record<string, any>;
    duplicateDomain.managedAgents.economicPolicies[0].comparisonDomains.push(
      structuredClone(duplicateDomain.managedAgents.economicPolicies[0].comparisonDomains[0]),
    );
    expect(() => validateGlobalConfig(duplicateDomain)).toThrow(/id must be unique/);

    const duplicateCandidate = structuredClone(economicConfig()) as Record<string, any>;
    duplicateCandidate.managedAgents.economicPolicies[0].candidates.push(
      structuredClone(duplicateCandidate.managedAgents.economicPolicies[0].candidates[0]),
    );
    expect(() => validateGlobalConfig(duplicateCandidate)).toThrow(/routeId must be unique/);

    const malformedAmount = structuredClone(economicConfig()) as Record<string, any>;
    malformedAmount.managedAgents.economicPolicies[0].candidates[0].ceiling.amount.atoms = "01";
    expect(() => validateGlobalConfig(malformedAmount)).toThrow(/canonical non-negative base-10/);
  });

  it("binds candidate reservations and policy domains to exact route economics", () => {
    const aboveCeiling = structuredClone(economicConfig()) as Record<string, any>;
    aboveCeiling.managedAgents.economicPolicies[0].candidates[0].worstCaseReservation.amount.atoms = "26";
    expect(() => validateGlobalConfig(aboveCeiling)).toThrow(/must not exceed its finite ceiling/);

    const underReserved = structuredClone(economicConfig()) as Record<string, any>;
    underReserved.managedAgents.economicPolicies[0].candidates[0].worstCaseReservation.amount.atoms = "24";
    expect(() => validateGlobalConfig(underReserved)).toThrow(/must cover the derived minimum reservation/);

    const mismatchedBasis = structuredClone(economicConfig()) as Record<string, any>;
    mismatchedBasis.managedAgents.economicPolicies[0].comparisonDomains[0].rateCardBasis = "different-rate-card";
    expect(() => validateGlobalConfig(mismatchedBasis)).toThrow(/rateCardBasis must match route economics/);

    const mismatchedEnvelope = structuredClone(economicConfig()) as Record<string, any>;
    mismatchedEnvelope.managedAgents.economicPolicies[0].comparisonDomains[0].envelopeSemantics = "different-envelope";
    expect(() => validateGlobalConfig(mismatchedEnvelope)).toThrow(/envelopeSemantics must match route economics/);

    const missingReservation = structuredClone(economicConfig()) as Record<string, any>;
    delete missingReservation.managedAgents.economicPolicies[0].candidates[0].worstCaseReservation;
    expect(() => validateGlobalConfig(missingReservation)).toThrow(/worstCaseReservation/);

    const notComparableMetered = structuredClone(economicConfig()) as Record<string, any>;
    notComparableMetered.managedAgents.economicPolicies[0].candidates[0].ceiling = { kind: "none" };
    notComparableMetered.managedAgents.economicPolicies[0].candidates[0].worstCaseReservation = {
      kind: "not-comparable",
      reason: "subscription-basis",
    };
    expect(() => validateGlobalConfig(notComparableMetered)).toThrow(/metered route requires an exact worst-case reservation/);

    const subscription = structuredClone(economicConfig()) as Record<string, any>;
    subscription.modelGateway.virtualModels[0].economics.priceEvidence.kind = "subscription";
    delete subscription.modelGateway.virtualModels[0].economics.priceEvidence.unitPrices;
    subscription.managedAgents.economicPolicies[0].candidates[0].ceiling = { kind: "none" };
    subscription.managedAgents.economicPolicies[0].candidates[0].worstCaseReservation = {
      kind: "not-comparable",
      reason: "subscription-basis",
    };
    expect(() => validateGlobalConfig(subscription)).not.toThrow();
    subscription.managedAgents.economicPolicies[0].candidates[0].worstCaseReservation.reason = "included-basis";
    expect(() => validateGlobalConfig(subscription)).toThrow(/subscription-basis/);

    const priceScheme = structuredClone(economicConfig()) as Record<string, any>;
    priceScheme.modelGateway.virtualModels[0].economics.priceEvidence.unitPrices[0].price.scheme.currency = "EUR";
    expect(() => validateGlobalConfig(priceScheme)).toThrow(/route price scheme must match its comparison domain/);

    const auxiliaryScheme = structuredClone(economicConfig()) as Record<string, any>;
    auxiliaryScheme.modelGateway.virtualModels[0].economics.auxiliaryCharges = [{
      id: "tool-call",
      amount: { atoms: "1", scale: 2, unit: "request", scheme: { kind: "currency", currency: "EUR" } },
    }];
    expect(() => validateGlobalConfig(auxiliaryScheme)).toThrow(/auxiliary charge unit and scheme must match its comparison domain/);
  });

  it("requires proven free routes to reserve exact zero without auxiliary charges", () => {
    const free = structuredClone(economicConfig()) as Record<string, any>;
    free.modelGateway.virtualModels[0].economics.priceEvidence.kind = "free";
    delete free.modelGateway.virtualModels[0].economics.priceEvidence.unitPrices;
    free.managedAgents.economicPolicies[0].candidates[0].worstCaseReservation.amount.atoms = "0";
    expect(() => validateGlobalConfig(free)).not.toThrow();

    const nonzero = structuredClone(free);
    nonzero.managedAgents.economicPolicies[0].candidates[0].worstCaseReservation.amount.atoms = "1";
    expect(() => validateGlobalConfig(nonzero)).toThrow(/exact zero worst-case reservation/);

    const chargedAuxiliary = structuredClone(free);
    chargedAuxiliary.modelGateway.virtualModels[0].economics.auxiliaryCharges = [{
      id: "tool-call",
      amount: { atoms: "1", scale: 2, unit: "request", scheme: { kind: "currency", currency: "USD" } },
    }];
    expect(() => validateGlobalConfig(chargedAuxiliary)).toThrow(/cannot declare separately charged auxiliary calls/);
  });
});
