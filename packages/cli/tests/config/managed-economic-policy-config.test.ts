import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { createAccountRef } from "@kilnai/core";
import { SqliteManagedAccountLeaseAuthority } from "@kilnai/runtime";
import { validateGlobalConfig, type KilnGlobalConfig } from "../../src/config/global-config.js";
import {
  closeManagedAccountRuntimeComposition,
  createManagedAccountRuntimeComposition,
  projectManagedEconomicJobAdoption,
} from "../../src/config/managed-agent-routes.js";
import { economicConfig } from "./managed-economic-policy-config-fixture.js";

const testProfileAuthorityDigest = `sha256:${"9".repeat(64)}`;

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
    id: jobId,
    projectId: "project-a",
    callerId: "caller-a",
    adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
    dispatch: {
      kind: "economic" as const,
      economicAttemptId,
      economicPolicyId: "default-economic-policy",
      economicPolicyRevision: "rev-2026-07",
      constraints: {},
      candidateSet: {
        economicPolicyId: "default-economic-policy",
        economicPolicyRevision: "rev-2026-07",
        admissionProfileId: "foundation-readonly-plan" as const,
        constraints: {},
        candidates: [{
          routeId: "codex-standard",
          routeSource: "explicit-managed-route",
          providerId: "codex-oauth",
          model: "gpt-5.6-codex",
          accountPolicyId: "codex-standard-policy",
          adapterCapabilityId: "codex-direct",
          adapterCapabilityVersion: "v1",
          profileAuthorityDigest: testProfileAuthorityDigest,
        }],
        rejections: [],
      },
    },
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
      accountEconomics: {
        capacityIdentity: "codex-capacity",
        subscriptionClass: "metered" as const,
        quotaClassId: "codex-standard",
        creditPosture: "disabled" as const,
        overagePosture: "disabled" as const,
      },
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
      projectId: "project-a",
      callerId: "caller-a",
      adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
      dispatch: {
        kind: "economic" as const,
        economicAttemptId: "economic-attempt:test-attempt-001",
        economicPolicyId: "default-economic-policy",
        economicPolicyRevision: "rev-2026-07",
        constraints: {},
        candidateSet: {
          economicPolicyId: "default-economic-policy",
          economicPolicyRevision: "rev-2026-07",
          admissionProfileId: "foundation-readonly-plan" as const,
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
            profileAuthorityDigest: testProfileAuthorityDigest,
          }],
          rejections: [],
        },
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
      id: "job-affinity",
      projectId: "project-a",
      callerId: "caller-a",
      adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
      parent: { invocationId: "parent-invocation-secret", turnId: "parent-turn-secret" },
      dispatch: {
        kind: "economic" as const,
        economicAttemptId: "economic-attempt:affinity-001",
        economicPolicyId: "default-economic-policy",
        economicPolicyRevision: "rev-2026-07",
        constraints: {},
        candidateSet: {
          economicPolicyId: "default-economic-policy",
          economicPolicyRevision: "rev-2026-07",
          admissionProfileId: "foundation-readonly-plan" as const,
          constraints: {},
          candidates: [{
            routeId: "codex-standard",
            routeSource: "explicit-managed-route",
            providerId: "codex-oauth",
            model: "gpt-5.6-codex",
            accountPolicyId: "codex-standard-policy",
            adapterCapabilityId: "codex-direct",
            adapterCapabilityVersion: "v1",
            profileAuthorityDigest: testProfileAuthorityDigest,
          }],
          rejections: [],
        },
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
      id: "job-affinity",
      projectId: "project-a",
      callerId: "caller-a",
      adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
      dispatch: {
        kind: "economic" as const,
        economicAttemptId: "economic-attempt:affinity-001",
        economicPolicyId: "default-economic-policy",
        economicPolicyRevision: "rev-2026-07",
        constraints: {},
        candidateSet: {
          economicPolicyId: "default-economic-policy",
          economicPolicyRevision: "rev-2026-07",
          admissionProfileId: "foundation-readonly-plan" as const,
          constraints: {},
          candidates: [{
            routeId: "codex-standard", routeSource: "explicit-managed-route",
            providerId: "codex-oauth", model: "gpt-5.6-codex",
            accountPolicyId: "codex-standard-policy",
            adapterCapabilityId: "codex-direct", adapterCapabilityVersion: "v1",
            profileAuthorityDigest: testProfileAuthorityDigest,
          }],
          rejections: [],
        },
      },
    } as never, { resolve } as never)).rejects.toMatchObject({ code: "identity-revision-conflict" });
  });

  it("maps exact persisted policy revision drift to identity-revision-conflict without capacity lookup", async () => {
    const resolve = vi.fn();
    await expect(projectManagedEconomicJobAdoption(economicConfig(), {
      projectId: "project-a",
      callerId: "caller-a",
      adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
      dispatch: {
        kind: "economic" as const,
        economicAttemptId: "economic-attempt:revision-drift-001",
        economicPolicyId: "default-economic-policy",
        economicPolicyRevision: "older-revision",
        constraints: {},
        candidateSet: {
          economicPolicyId: "default-economic-policy",
          economicPolicyRevision: "older-revision",
          admissionProfileId: "foundation-readonly-plan" as const,
          constraints: {},
          candidates: [],
          rejections: [],
        },
      },
    } as never, { resolve } as never)).rejects.toMatchObject({
      code: "identity-revision-conflict",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a pre-V9 economic job shape with a typed identity conflict", async () => {
    await expect(projectManagedEconomicJobAdoption(economicConfig(), {
      economicPolicyId: "default-economic-policy",
      economicPolicyRevision: "rev-2026-07",
      candidateSet: { candidates: [] },
    } as never, { resolve: vi.fn() } as never)).rejects.toMatchObject({
      code: "identity-revision-conflict",
    });
  });

  it("projects an accountless route without fabricating account candidates", async () => {
    const config = accountlessEconomicConfig();
    const resolve = vi.fn();
    const adoption = await projectManagedEconomicJobAdoption(config, {
      projectId: "project-a",
      callerId: "caller-a",
      adoptedDecisionAt: "2026-07-31T11:00:00.000Z",
      dispatch: {
        kind: "economic" as const,
        economicAttemptId: "economic-attempt:accountless-001",
        economicPolicyId: "default-economic-policy",
        economicPolicyRevision: "rev-2026-07",
        constraints: {},
        candidateSet: {
          economicPolicyId: "default-economic-policy",
          economicPolicyRevision: "rev-2026-07",
          admissionProfileId: "foundation-readonly-plan" as const,
          constraints: {},
          candidates: [{
            routeId: "codex-standard",
            routeSource: "explicit-managed-route",
            providerId: "codex-oauth",
            model: "gpt-5.6-codex",
            adapterCapabilityId: "codex-direct",
            adapterCapabilityVersion: "v1",
            profileAuthorityDigest: testProfileAuthorityDigest,
          }],
          rejections: [],
        },
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
      expect(restarted.authority.createManagedJobCommitmentRecoveryPort().query({
        jobId: "job-held", economicAttemptId: "economic-attempt:held-001",
      })).toBe("absent");
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
      expect(restarted.authority.createManagedJobCommitmentRecoveryPort().query({
        jobId: "job-fenced", economicAttemptId: "economic-attempt:fenced-001",
      })).toBe("dispatch-fenced");
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
    expect(() => validateGlobalConfig(missingVersion)).toThrow(/schemaVersion 2/);

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

  it("diagnoses pre-v2 managed-agent routes as a re-authoring boundary", () => {
    const legacy = structuredClone(economicConfig()) as Record<string, any>;
    delete legacy.managedAgents.schemaVersion;
    delete legacy.managedAgents.economicPolicies;
    delete legacy.modelGateway;

    expect(() => validateGlobalConfig(legacy)).toThrow(
      /retired pre-v2 schema.*re-author.*global-config\.md#managed-economic-policy-schema-v2/i,
    );
  });

  it("keeps the documented subscription schema-v2 example executable", () => {
    const example = parse(readFileSync(
      new URL("../../../../docs/examples/configs/managed-agents-schema-v2-subscription.yaml", import.meta.url),
      "utf8",
    ));

    expect(() => validateGlobalConfig(example)).not.toThrow();
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
