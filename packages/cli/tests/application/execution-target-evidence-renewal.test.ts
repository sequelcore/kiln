import { describe, expect, it } from "vitest";
import { renewExecutionTargetEvidence } from "../../src/application/execution-target-evidence-renewal.js";
import { executionTargetEvidenceRevision } from "../../src/config/execution-target-evidence-store.js";
import {
  managedAgentIntentConfig,
  managedAgentTargetEvidence,
} from "../config/managed-agent-intent-config-fixture.js";

describe("execution-target evidence renewal", () => {
  it("moves observation provenance forward without changing authority material", () => {
    const intent = managedAgentIntentConfig().targetCatalog!;
    const currentEvidence = managedAgentTargetEvidence();
    const renewed = renewExecutionTargetEvidence({
      intent,
      currentEvidence,
      configurationRevision: `sha256:${"9".repeat(64)}`,
      discoveryByTargetId: new Map([["codex-standard", {
        entry: {
          providerId: "codex-oauth",
          providerRouteId: "gpt-5.6-codex",
          providerModelId: "gpt-5.6-codex",
          access: "subscription",
          family: "gpt-5.6",
          discovery: "observed",
          eligibility: "eligible",
          availability: "available",
          provenance: [],
          targets: [],
        },
        catalogObservedAt: "2026-09-01T00:00:00.000Z",
        sourceObservedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2027-09-01T00:00:00.000Z",
        evidenceIdentity: "runtime-provider-catalog:renewed",
        evidenceRevision: `sha256:${"8".repeat(64)}`,
        materialRevision: `sha256:${"7".repeat(64)}`,
        rawEvidence: { rawId: "gpt-5.6-codex", provenance: "provider-discovery" },
      }]]),
    });

    expect(executionTargetEvidenceRevision(renewed)).not.toBe(executionTargetEvidenceRevision(currentEvidence));
    expect(renewed.targets[0]).toMatchObject({
      discovery: {
        evidenceIdentity: "runtime-provider-catalog:renewed",
        expiresAt: "2027-09-01T00:00:00.000Z",
      },
      dataPolicyEvidence: {
        trainingPosture: "prohibited",
        expiresAt: "2027-09-01T00:00:00.000Z",
      },
      economics: {
        priceEvidence: {
          kind: "metered",
          evidence: { validUntil: "2027-09-01T00:00:00.000Z" },
        },
      },
    });
  });

  it("accepts a freshly observed provider route while preserving provider and model identity", () => {
    const intent = managedAgentIntentConfig().targetCatalog!;
    const renewed = renewExecutionTargetEvidence({
      intent,
      currentEvidence: managedAgentTargetEvidence(),
      configurationRevision: `sha256:${"9".repeat(64)}`,
      discoveryByTargetId: new Map([["codex-standard", {
        entry: {
          providerId: "codex-oauth",
          providerRouteId: "different-route",
          providerModelId: "gpt-5.6-codex",
          access: "subscription",
          family: "gpt-5.6",
          discovery: "observed",
          eligibility: "eligible",
          availability: "available",
          provenance: [],
          targets: [],
        },
        catalogObservedAt: "2026-09-01T00:00:00.000Z",
        sourceObservedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2027-09-01T00:00:00.000Z",
        evidenceIdentity: "runtime-provider-catalog:renewed",
        evidenceRevision: `sha256:${"8".repeat(64)}`,
        materialRevision: `sha256:${"7".repeat(64)}`,
        rawEvidence: { rawId: "gpt-5.6-codex", provenance: "provider-discovery" },
      }]]),
    });
    expect(renewed.targets[0]?.discovery.providerRouteId).toBe("different-route");
  });
});
