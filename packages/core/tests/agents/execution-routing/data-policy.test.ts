import { describe, expect, it } from "vitest";
import {
  decideExecutionTargetDataPolicy,
  defineExecutionTargetDataPolicyEvidence,
  type ExecutionTargetDataPolicyEvidence,
} from "../../../src/agents/execution-routing/data-policy.js";
import { defineExecutionTargetCatalog } from "../../../src/agents/execution-routing/index.js";

const evidence = (): ExecutionTargetDataPolicyEvidence => ({
  providerId: "provider-a",
  providerModelId: "model-a",
  dataUse: "not-used",
  trainingPosture: "prohibited",
  retention: { posture: "zero", days: 0 },
  permittedMaximumClassification: "confidential",
  permittedClassifications: ["public", "internal", "confidential"],
  sourceIdentity: "provider-privacy",
  sourceRevision: "2026-08",
  sourceDigest: `sha256:${"a".repeat(64)}`,
  observedAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-08-31T00:00:00.000Z",
});

describe("ExecutionTarget data policy", () => {
  it("requires policy evidence on every canonical execution target", () => {
    const economicEvidence = {
      sourceIdentity: "fixture-source", sourceRevision: "revision-1",
      sourceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T00:00:00.000Z", confidence: "high" as const, authority: "configured" as const,
    };
    expect(() => defineExecutionTargetCatalog({
      accounts: [{
        id: "account-a", providerId: "provider-a", credentialId: "credential-a",
        maxConcurrency: 1, reservedAffinitySlots: 0,
        economics: { capacityIdentity: "capacity-a", subscriptionClass: "subscription", quotaClassId: "quota-a", creditPosture: "disabled", overagePosture: "disabled" },
      }],
      accountPolicies: [{ id: "policy-a", accountIds: ["account-a"], strategy: "economic-least-pressure" }],
      targets: [{
        id: "target-a",
        label: "Target A",
        providerId: "provider-a",
        providerModelId: "model-a",
        dataClassification: "internal",
        accountPolicyId: "policy-a",
        economics: {
          adapterCapabilityId: "adapter-a", adapterCapabilityVersion: "v1", authBillingChannel: "subscription",
          executionMode: "direct", serviceTier: "standard", rateCardBasis: "subscription",
          envelopeSemantics: "request", fallbackPosture: "disabled", overagePosture: "disabled",
          contextClass: "default", cacheClass: "default",
          priceEvidence: { kind: "subscription", rateCardId: "rate-a", rateCardRevision: "v1", evidence: economicEvidence },
          auxiliaryCharges: [], executionEnvelope: { limits: [] },
        },
      } as never],
    })).toThrow(/dataPolicyEvidence/u);
  });

  it("admits current target evidence within the configured classification", () => {
    expect(decideExecutionTargetDataPolicy({
      evidence: evidence(), providerId: "provider-a", providerModelId: "model-a",
      requestedClassification: "confidential", now: new Date("2026-08-15T00:00:00.000Z"),
    })).toEqual(expect.objectContaining({ status: "admitted", freshness: "current", reason: "policy-admitted" }));
  });

  it.each([
    ["missing", undefined, "missing-evidence"],
    ["expired", { ...evidence(), expiresAt: "2026-08-14T00:00:00.000Z" }, "expired-evidence"],
    ["expiry boundary", evidence(), "expired-evidence"],
    ["provider drift", { ...evidence(), providerId: "provider-b" }, "provider-mismatch"],
    ["model drift", { ...evidence(), providerModelId: "model-b" }, "model-mismatch"],
    ["classification widening", { ...evidence(), permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"] }, "classification-not-permitted"],
  ] as [string, ExecutionTargetDataPolicyEvidence | undefined, string][])("denies %s before execution", (_case, policy, reason) => {
    expect(decideExecutionTargetDataPolicy({
      evidence: policy, providerId: "provider-a", providerModelId: "model-a",
      requestedClassification: "confidential",
      now: new Date(_case === "expiry boundary" ? "2026-08-31T00:00:00.000Z" : "2026-08-15T00:00:00.000Z"),
    })).toEqual(expect.objectContaining({ status: "denied", reason }));
  });

  it("denies malformed evidence passed from an untyped persistence boundary", () => {
    expect(decideExecutionTargetDataPolicy({
      evidence: { ...evidence(), sourceDigest: "raw" } as never,
      providerId: "provider-a", providerModelId: "model-a", requestedClassification: "internal",
      now: new Date("2026-08-15T00:00:00.000Z"),
    })).toEqual({ status: "denied", freshness: "invalid", reason: "malformed-evidence" });
  });

  it("rejects malformed evidence at the canonical definition boundary", () => {
    expect(() => defineExecutionTargetDataPolicyEvidence({ ...evidence(), sourceDigest: "raw" } as never)).toThrow("sourceDigest");
    expect(() => defineExecutionTargetDataPolicyEvidence({ ...evidence(), retention: { posture: "zero", days: 1 } })).toThrow("retention");
    expect(() => defineExecutionTargetDataPolicyEvidence({ ...evidence(), permittedClassifications: ["public", "confidential"] })).toThrow("downward-closed");
  });
});
