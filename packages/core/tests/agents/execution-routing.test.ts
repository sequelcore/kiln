import { describe, expect, it } from "vitest";

import {
  admitOperatorExecutionIntent,
  defineExecutionTargetCatalog,
  selectAdmittedExecutionAccount,
  type ExecutionAccountAdmissionCandidate,
} from "../../src/agents/execution-routing/index.js";
import { createManagedEconomicAmountFromDecimal } from "../../src/cost/managed-route-economics.js";

const cost = (value: string) => createManagedEconomicAmountFromDecimal({
  value,
  unit: "request",
  scheme: { kind: "currency", currency: "USD" },
});

const evidence = {
  sourceIdentity: "fixture-source",
  sourceRevision: "revision-1",
  sourceDigest: `sha256:${"a".repeat(64)}`,
  observedAt: "2026-01-01T00:00:00.000Z",
  validUntil: "2026-12-31T00:00:00.000Z",
  confidence: "high" as const,
  authority: "configured" as const,
};

const accountEconomics = {
  capacityIdentity: "fixture-capacity",
  subscriptionClass: "subscription" as const,
  quotaClassId: "fixture-quota",
  creditPosture: "disabled" as const,
  overagePosture: "disabled" as const,
};

const targetEconomics = {
  adapterCapabilityId: "fixture-adapter",
  adapterCapabilityVersion: "v1",
  authBillingChannel: "fixture-auth",
  executionMode: "fixture-mode",
  serviceTier: "fixture-tier",
  rateCardBasis: "fixture-basis",
  envelopeSemantics: "fixture-envelope",
  fallbackPosture: "disabled" as const,
  overagePosture: "disabled" as const,
  contextClass: "fixture-context",
  cacheClass: "fixture-cache",
  priceEvidence: {
    kind: "subscription" as const,
    rateCardId: "fixture-rate-card",
    rateCardRevision: "v1",
    evidence,
  },
  auxiliaryCharges: [],
  executionEnvelope: { limits: [cost("1")] },
};

const dataPolicyEvidence = (providerId: string, providerModelId: string) => ({
  providerId,
  providerModelId,
  dataUse: "not-used" as const,
  trainingPosture: "prohibited" as const,
  retention: { posture: "zero" as const, days: 0 },
  permittedMaximumClassification: "confidential" as const,
  permittedClassifications: ["public", "internal", "confidential"] as const,
  sourceIdentity: "fixture-privacy-policy",
  sourceRevision: "fixture-revision-1",
  sourceDigest: `sha256:${"b".repeat(64)}` as const,
  observedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-12-31T00:00:00.000Z",
});

function catalog() {
  return defineExecutionTargetCatalog({
    accounts: [
      { id: "work", providerId: "codex-oauth", credentialId: "credential-work", maxConcurrency: 2, reservedAffinitySlots: 1, economics: accountEconomics },
      { id: "personal", providerId: "codex-oauth", credentialId: "credential-personal", maxConcurrency: 2, reservedAffinitySlots: 1, economics: accountEconomics },
      { id: "other", providerId: "opencode-go", credentialId: "credential-other", maxConcurrency: 2, reservedAffinitySlots: 1, economics: accountEconomics },
    ],
    accountPolicies: [
      { id: "codex-shared", accountIds: ["work", "personal"], strategy: "economic-least-pressure" },
      { id: "codex-work", accountIds: ["work"], strategy: "economic-least-pressure" },
    ],
    targets: [
      {
        id: "terra",
        providerId: "codex-oauth",
        label: "Terra",
        providerModelId: "codex/gpt-5.6-terra",
        dataClassification: "confidential",
        dataPolicyEvidence: dataPolicyEvidence("codex-oauth", "codex/gpt-5.6-terra"),
        accountPolicyId: "codex-shared",
        economics: targetEconomics,
      },
      {
        id: "terra-work",
        providerId: "codex-oauth",
        label: "Terra Work",
        providerModelId: "codex/gpt-5.6-terra",
        dataClassification: "confidential",
        dataPolicyEvidence: dataPolicyEvidence("codex-oauth", "codex/gpt-5.6-terra"),
        accountPolicyId: "codex-work",
        economics: targetEconomics,
      },
    ],
  });
}

function candidate(
  accountId: string,
  overrides: Partial<ExecutionAccountAdmissionCandidate> = {},
): ExecutionAccountAdmissionCandidate {
  return {
    accountId,
    safety: "eligible",
    health: "healthy",
    quota: "available",
    capacity: "available",
    economicCost: cost("1"),
    pressure: 0,
    ...overrides,
  };
}

describe("execution routing", () => {
  it("defines an immutable catalog with unique canonical ids and provider-homogeneous policies", () => {
    const defined = catalog();

    expect(Object.isFrozen(defined)).toBe(true);
    expect(Object.isFrozen(defined.targets)).toBe(true);
    expect(Object.isFrozen(defined.accounts[0]!.economics)).toBe(true);
    expect(Object.isFrozen(defined.targets[0]!.economics.executionEnvelope.limits)).toBe(true);
    expect(() => defineExecutionTargetCatalog({ ...defined, accounts: [...defined.accounts, { id: "work", providerId: "codex-oauth", credentialId: "other", maxConcurrency: 1, reservedAffinitySlots: 0, economics: accountEconomics }] })).toThrow(/unique canonical id/u);
    expect(() => defineExecutionTargetCatalog({ ...defined, accountPolicies: [{ id: "mixed", accountIds: ["work", "other"], strategy: "economic-least-pressure" }] })).toThrow(/same provider/u);
    expect(() => defineExecutionTargetCatalog({ ...defined, targets: [{ ...defined.targets[0]!, id: "-bad" }] })).toThrow(/canonical id/u);
    expect(() => defineExecutionTargetCatalog({ ...defined, accounts: [{ ...defined.accounts[0]!, maxConcurrency: 0 }] })).toThrow(/maxConcurrency/u);
    expect(() => defineExecutionTargetCatalog({ ...defined, accounts: [{ ...defined.accounts[0]!, reservedAffinitySlots: 3 }] })).toThrow(/reservedAffinitySlots/u);
  });

  it("rejects malformed persisted account and target economics", () => {
    const defined = catalog();

    expect(() => defineExecutionTargetCatalog({
      ...defined,
      accounts: defined.accounts.map((account, index) => index === 0
        ? { ...account, economics: { ...accountEconomics, quotaClassId: "" } as typeof accountEconomics }
        : account),
    })).toThrow(/quotaClassId/u);

    expect(() => defineExecutionTargetCatalog({
      ...defined,
      targets: [{
        ...defined.targets[0]!,
        economics: {
          ...targetEconomics,
          priceEvidence: {
            ...targetEconomics.priceEvidence,
            evidence: { ...evidence, sourceDigest: "" },
          },
        } as typeof targetEconomics,
      }],
    })).toThrow(/sourceDigest/u);

    expect(() => defineExecutionTargetCatalog({
      ...defined,
      targets: [{
        ...defined.targets[0]!,
        economics: {
          ...targetEconomics,
          executionEnvelope: { limits: [{ ...cost("1"), scale: 19 }] },
        } as typeof targetEconomics,
      }],
    })).toThrow(/scale/u);
  });

  it("rejects unknown references and incompatible target providers", () => {
    const defined = catalog();

    expect(() => defineExecutionTargetCatalog({ ...defined, targets: [{ ...defined.targets[0]!, accountPolicyId: "missing" }] })).toThrow(/unknown account policy/u);
    expect(() => defineExecutionTargetCatalog({ ...defined, targets: [{ ...defined.targets[1]!, providerId: "opencode-go" }] })).toThrow(/provider/u);
  });

  it("admits policy overrides only within the target policy and commits secret-free identity", () => {
    const defined = catalog();
    const overridden = admitOperatorExecutionIntent(defined, { targetId: "terra", accountOverrideId: "personal" });

    expect(overridden).toEqual({
      targetId: "terra",
      providerId: "codex-oauth",
      providerModelId: "codex/gpt-5.6-terra",
      accountSelection: { kind: "operator-override", accountPolicyId: "codex-shared", accountId: "personal" },
    });
    expect(JSON.stringify(overridden)).not.toContain("credential");
    expect(selectAdmittedExecutionAccount(overridden, [
      candidate("work", { economicCost: cost("0") }),
      candidate("personal", { economicCost: cost("1") }),
    ])).toMatchObject({ kind: "selected", accountId: "personal" });
    expect(() => admitOperatorExecutionIntent(defined, { targetId: "terra-work", accountOverrideId: "personal" })).toThrow(/not eligible/u);
    expect(admitOperatorExecutionIntent(defined, { targetId: "terra-work", accountOverrideId: "work" }).accountSelection).toEqual({
      kind: "operator-override", accountPolicyId: "codex-work", accountId: "work",
    });
  });

  it("rejects safety, health, exhausted or unknown quota, and capacity before ranking economic candidates", () => {
    const admission = admitOperatorExecutionIntent(catalog(), { targetId: "terra" });
    const selected = selectAdmittedExecutionAccount(admission, [
      candidate("work", { safety: "ineligible", economicCost: cost("0") }),
      candidate("personal", { health: "unhealthy", economicCost: cost("0") }),
      candidate("work", { quota: "exhausted", economicCost: cost("0") }),
      candidate("personal", { quota: "unknown", economicCost: cost("0") }),
      candidate("personal", { capacity: "exhausted", economicCost: cost("0") }),
      candidate("work", { economicCost: cost("3"), pressure: 10 }),
      candidate("personal", { economicCost: cost("2"), pressure: 100 }),
    ]);

    expect(selected).toMatchObject({ kind: "selected", accountId: "personal" });
    expect(selected.rejected.map((rejection) => rejection.reason)).toEqual([
      "safety-ineligible",
      "health-unhealthy",
      "quota-exhausted",
      "quota-unknown",
      "capacity-exhausted",
    ]);
  });

  it("rejects candidates with invalid managed economic costs", () => {
    const admission = admitOperatorExecutionIntent(catalog(), { targetId: "terra" });
    const invalidCost = { ...cost("1"), atoms: "not-canonical" } as ExecutionAccountAdmissionCandidate["economicCost"];

    expect(() => selectAdmittedExecutionAccount(admission, [
      candidate("work", { safety: "ineligible", economicCost: invalidCost }),
    ])).toThrow(/economicCost/u);
  });

  it("orders policy candidates by cost, pressure, then account id deterministically", () => {
    const admission = admitOperatorExecutionIntent(catalog(), { targetId: "terra" });
    const selected = selectAdmittedExecutionAccount(admission, [
      candidate("work", { economicCost: cost("1.00"), pressure: 2 }),
      candidate("personal", { economicCost: cost("1"), pressure: 1 }),
    ]);

    expect(selected).toMatchObject({ kind: "selected", accountId: "personal" });
    const tie = selectAdmittedExecutionAccount(admission, [
      candidate("work"),
      candidate("personal"),
    ]);
    expect(tie).toMatchObject({ kind: "selected", accountId: "personal" });
  });

  it("never falls back from a one-account target policy", () => {
    const admission = admitOperatorExecutionIntent(catalog(), { targetId: "terra-work" });
    const selected = selectAdmittedExecutionAccount(admission, [
      candidate("work", { health: "unhealthy" }),
      candidate("personal"),
    ]);

    expect(selected).toEqual({
      kind: "rejected",
      rejected: [{ accountId: "work", reason: "health-unhealthy" }],
    });
  });
});
