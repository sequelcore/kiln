import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defineExecutionTargetEvidenceSnapshot,
  executionTargetEvidenceRevision,
  projectExecutionTargetCatalogFromIntent,
  readExecutionTargetEvidenceSnapshot,
  writeExecutionTargetEvidenceSnapshot,
} from "../../src/config/execution-target-evidence-store.js";

describe("execution target managed evidence", () => {
  it("resolves minimal operator intent through one exact managed-evidence revision", () => {
    const evidence = evidenceSnapshot();
    const revision = executionTargetEvidenceRevision(evidence);
    const catalog = projectExecutionTargetCatalogFromIntent(targetIntent(revision), evidence, revision);

    expect(targetIntent(revision).targets[0]).not.toHaveProperty("dataPolicyEvidence");
    expect(targetIntent(revision).targets[0]?.economics).not.toHaveProperty("priceEvidence");
    expect(targetIntent(revision).accounts[0]?.economics).toEqual({
      creditPosture: "disabled",
      overagePosture: "disabled",
    });
    expect(catalog.targets[0]).toMatchObject({
      id: "fixture-target",
      providerId: "fixture-provider",
      providerModelId: "fixture-model",
      dataPolicyEvidence: { sourceRevision: "policy-v1" },
      economics: {
        adapterCapabilityId: "fixture-adapter",
        authBillingChannel: "oauth-subscription",
        fallbackPosture: "disabled",
      },
    });
  });

  it("rejects missing, extra, mismatched, and revision-drifted evidence", () => {
    const evidence = evidenceSnapshot();
    const revision = executionTargetEvidenceRevision(evidence);

    expect(() => projectExecutionTargetCatalogFromIntent(
      targetIntent(`sha256:${"f".repeat(64)}`),
      evidence,
      revision,
    )).toThrow(/revision/u);
    const missing = { ...evidence, targets: [] };
    const missingRevision = executionTargetEvidenceRevision(missing);
    expect(() => projectExecutionTargetCatalogFromIntent(
      targetIntent(missingRevision),
      missing,
      missingRevision,
    )).toThrow(/fixture-target.*evidence/u);
    const extra = {
      ...evidence,
      targets: [...evidence.targets, { ...evidence.targets[0]!, targetId: "unconfigured-target" }],
    };
    const extraRevision = executionTargetEvidenceRevision(extra);
    expect(() => projectExecutionTargetCatalogFromIntent(
      targetIntent(extraRevision),
      extra,
      extraRevision,
    )).toThrow(/unconfigured-target/u);
    const mismatched = {
      ...evidence,
      targets: [{
        ...evidence.targets[0]!,
        discovery: { ...evidence.targets[0]!.discovery, providerModelId: "other-model" },
      }],
    };
    const mismatchedRevision = executionTargetEvidenceRevision(mismatched);
    expect(() => projectExecutionTargetCatalogFromIntent(
      targetIntent(mismatchedRevision),
      mismatched,
      mismatchedRevision,
    )).toThrow(/provider model/u);
  });

  it("writes immutable content-addressed evidence and rejects tampering", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-target-evidence-"));
    const globalConfigPath = join(root, "kiln", "config.yaml");
    const written = writeExecutionTargetEvidenceSnapshot({
      globalConfigPath,
      snapshot: evidenceSnapshot(),
    });

    expect(readExecutionTargetEvidenceSnapshot({
      globalConfigPath,
      revision: written.revision,
    })).toEqual(defineExecutionTargetEvidenceSnapshot(evidenceSnapshot()));
    expect(writeExecutionTargetEvidenceSnapshot({
      globalConfigPath,
      snapshot: evidenceSnapshot(),
    })).toMatchObject({ revision: written.revision, path: written.path, created: false });

    writeFileSync(written.path, readFileSync(written.path, "utf8").replace("fixture-model", "tampered-model"), "utf8");
    expect(() => readExecutionTargetEvidenceSnapshot({
      globalConfigPath,
      revision: written.revision,
    })).toThrow(/digest/u);
  });
});

function targetIntent(evidenceRevision: `sha256:${string}`) {
  return {
    evidenceRevision,
    accounts: [{
      id: "fixture-account",
      providerId: "fixture-provider",
      credentialId: "fixture-credential",
      maxConcurrency: 1,
      reservedAffinitySlots: 0,
      economics: { creditPosture: "disabled" as const, overagePosture: "disabled" as const },
    }],
    accountPolicies: [{
      id: "fixture-account-policy",
      accountIds: ["fixture-account"],
      strategy: "economic-least-pressure" as const,
    }],
    targets: [{
      id: "fixture-target",
      kind: "direct" as const,
      label: "Fixture target",
      providerId: "fixture-provider",
      providerModelId: "fixture-model",
      accountPolicyId: "fixture-account-policy",
      dataClassification: "internal" as const,
      economics: {
        authBillingChannel: "oauth-subscription",
        executionMode: "responses-api",
        serviceTier: "standard",
        fallbackPosture: "disabled" as const,
        overagePosture: "disabled" as const,
        executionEnvelope: { limits: [] },
      },
    }],
  };
}

function evidenceSnapshot() {
  return {
    version: 1 as const,
    accounts: [{
      accountId: "fixture-account",
      providerId: "fixture-provider",
      economics: {
        capacityIdentity: "fixture-capacity",
        subscriptionClass: "subscription" as const,
        quotaClassId: "fixture-quota",
      },
    }],
    targets: [{
      targetId: "fixture-target",
      kind: "direct" as const,
      discovery: {
        providerId: "fixture-provider",
        providerRouteId: "fixture-provider:direct",
        providerModelId: "fixture-model",
        evidenceIdentity: "runtime-provider-catalog:fixture",
        evidenceRevision: `sha256:${"d".repeat(64)}` as const,
        observedAt: "2026-08-20T00:00:00.000Z",
        expiresAt: "2027-08-20T00:00:00.000Z",
      },
      dataPolicyEvidence: {
        providerId: "fixture-provider",
        providerModelId: "fixture-model",
        dataUse: "not-used" as const,
        trainingPosture: "prohibited" as const,
        retention: { posture: "zero" as const, days: 0 },
        permittedMaximumClassification: "internal" as const,
        permittedClassifications: ["public", "internal"] as const,
        sourceIdentity: "fixture-policy",
        sourceRevision: "policy-v1",
        sourceDigest: `sha256:${"a".repeat(64)}` as const,
        observedAt: "2026-08-20T00:00:00.000Z",
        expiresAt: "2027-08-20T00:00:00.000Z",
      },
      economics: {
        adapterCapabilityId: "fixture-adapter",
        adapterCapabilityVersion: "v1",
        rateCardBasis: "public-rate-card",
        envelopeSemantics: "configured-upper-bound",
        contextClass: "standard-context",
        cacheClass: "provider-cache",
        priceEvidence: {
          kind: "subscription" as const,
          rateCardId: "fixture-rate-card",
          rateCardRevision: "rate-v1",
          evidence: {
            sourceIdentity: "fixture-pricing",
            sourceRevision: "pricing-v1",
            sourceDigest: `sha256:${"b".repeat(64)}`,
            observedAt: "2026-08-20T00:00:00.000Z",
            validUntil: "2027-08-20T00:00:00.000Z",
            confidence: "high" as const,
            authority: "provider-reported" as const,
          },
        },
        auxiliaryCharges: [],
      },
    }],
  };
}
