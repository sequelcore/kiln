import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionRoute } from "../../src/application/execution-route-creation.js";
import { executionTargetEvidenceRevision } from "../../src/config/execution-target-evidence-store.js";

const mutationMocks = vi.hoisted(() => ({
  propose: vi.fn(),
  approve: vi.fn(),
  apply: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../src/application/config-mutation-authority.js", () => ({
  proposeConfigMutation: mutationMocks.propose,
  approveConfigMutation: mutationMocks.approve,
  applyConfigMutation: mutationMocks.apply,
}));

vi.mock("../../src/application/config-mutation-store.js", () => ({
  ConfigMutationStore: class {
    saveProposal = mutationMocks.save;
  },
}));

describe("createExecutionRoute", () => {
  beforeEach(() => {
    mutationMocks.propose.mockReset().mockReturnValue({
      proposal: { proposalId: "cfg_target_create", status: "valid", approvalRequired: true, diagnostics: [] },
    });
    mutationMocks.approve.mockReset().mockReturnValue({ approvalId: "approval_target_create" });
    mutationMocks.apply.mockReset().mockResolvedValue({
      settlement: { outcome: "committed", committedRevision: "sha256:next", diagnostics: [] },
    });
    mutationMocks.save.mockReset();
  });

  it("commits target intent through the authority with exact config and evidence revisions", async () => {
    const input = creationInput();
    const result = await createExecutionRoute(input);

    expect(mutationMocks.propose).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: "C:/fixture/project",
      operation: "target.create",
      payload: expect.objectContaining({
        target: input.draft.intent,
        expectedRevision: "sha256:expected",
        evidenceRevision: executionTargetEvidenceRevision({
          ...input.currentEvidence,
          targets: [...input.currentEvidence.targets, input.draft.evidence],
        }),
      }),
    }));
    expect(mutationMocks.approve).toHaveBeenCalledWith(expect.objectContaining({ surface: "cli" }));
    expect(mutationMocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      approvalId: "approval_target_create",
      requester: "operator",
    }));
    expect(result).toEqual({ status: "created", revision: "sha256:next" });
  });

  it("reports a committed revision when reconciliation fails after commit", async () => {
    mutationMocks.apply.mockResolvedValue({
      settlement: { outcome: "committed-reconciliation-failed", committedRevision: "sha256:committed", diagnostics: [{ message: "refresh failed" }] },
    });

    const result = await createExecutionRoute(creationInput());

    expect(result).toEqual({ status: "committed-refresh-failed", revision: "sha256:committed" });
  });

  it("reports an authority rejection without claiming the target was created", async () => {
    mutationMocks.apply.mockResolvedValue({
      settlement: { outcome: "rejected", committedRevision: null, diagnostics: [{ message: "revision drift" }] },
    });

    await expect(createExecutionRoute(creationInput())).rejects.toThrow("revision drift");
  });

  it("does not mint durable approval without an explicit operator decision", async () => {
    await expect(createExecutionRoute({ ...creationInput(), operatorApproved: false }))
      .rejects.toThrow("requires explicit operator approval");
    expect(mutationMocks.approve).not.toHaveBeenCalled();
    expect(mutationMocks.apply).not.toHaveBeenCalled();
  });

  it("validates the complete intent/evidence pair before publishing either authority", async () => {
    const input = creationInput();
    const publishEvidence = vi.fn(input.publishEvidence);

    await expect(createExecutionRoute({
      ...input,
      draft: {
        ...input.draft,
        evidence: {
          ...input.draft.evidence,
          discovery: { ...input.draft.evidence.discovery, providerModelId: "different-model" },
        },
      },
      publishEvidence,
    })).rejects.toThrow("managed evidence provider model mismatch");

    expect(publishEvidence).not.toHaveBeenCalled();
    expect(mutationMocks.propose).not.toHaveBeenCalled();
  });
});

function completeDraft() {
  const economics = routeEconomics();
  return {
    status: "complete" as const,
    discoveryIdentity: { providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model" },
    route: {
      id: "route",
      label: "Route",
      providerId: "provider",
      providerModelId: "model",
      accountSelection: { mode: "exact" as const, accountId: "account" },
      dataClassification: "public" as const,
      dataPolicyEvidence: dataPolicyEvidence(),
      economics,
    },
    intent: {
      id: "route",
      kind: "direct" as const,
      label: "Route",
      providerId: "provider",
      providerModelId: "model",
      accountSelection: { mode: "exact" as const, accountId: "account" },
      dataClassification: "public" as const,
      economics: {
        authBillingChannel: economics.authBillingChannel,
        executionMode: economics.executionMode,
        serviceTier: economics.serviceTier,
        fallbackPosture: economics.fallbackPosture,
        overagePosture: economics.overagePosture,
        executionEnvelope: economics.executionEnvelope,
      },
    },
    evidence: {
      targetId: "route",
      kind: "direct" as const,
      discovery: {
        providerId: "provider",
        providerRouteId: "provider:direct",
        providerModelId: "model",
        evidenceIdentity: "runtime-provider-catalog:fixture",
        evidenceRevision: `sha256:${"d".repeat(64)}` as const,
        observedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
      dataPolicyEvidence: dataPolicyEvidence(),
      economics: {
        adapterCapabilityId: economics.adapterCapabilityId,
        adapterCapabilityVersion: economics.adapterCapabilityVersion,
        rateCardBasis: economics.rateCardBasis,
        envelopeSemantics: economics.envelopeSemantics,
        contextClass: economics.contextClass,
        cacheClass: economics.cacheClass,
        priceEvidence: economics.priceEvidence,
        auxiliaryCharges: economics.auxiliaryCharges,
      },
    },
  };
}

function creationInput() {
  const currentEvidence = emptyEvidence();
  const currentIntent = emptyIntent(executionTargetEvidenceRevision(currentEvidence));
  return {
    draft: completeDraft(),
    expectedRevision: "sha256:expected",
    projectPath: "C:/fixture/project",
    approvalSurface: "cli" as const,
    operatorApproved: true,
    globalConfigPath: "C:/fixture/home/kiln/config.yaml",
    currentEvidence,
    currentIntent,
    publishEvidence: ({ snapshot }: { readonly snapshot: unknown }) => ({
      revision: executionTargetEvidenceRevision(snapshot),
      path: "fixture-evidence.json",
      created: true,
    }),
  };
}

function emptyIntent(evidenceRevision: `sha256:${string}`) {
  return {
    evidenceRevision,
    accounts: [{ id: "account", providerId: "provider", credentialId: "opaque-ref", maxConcurrency: 1, reservedAffinitySlots: 0, economics: { creditPosture: "disabled" as const, overagePosture: "disabled" as const } }],
    accountPolicies: [],
    targets: [],
  };
}

function emptyEvidence() {
  return {
    version: 1 as const,
    accounts: [{ accountId: "account", providerId: "provider", economics: { capacityIdentity: "fixture", subscriptionClass: "subscription" as const, quotaClassId: "fixture" } }],
    targets: [],
  };
}

function routeEconomics() {
  return { adapterCapabilityId: "fixture", adapterCapabilityVersion: "v1", authBillingChannel: "fixture", executionMode: "direct", serviceTier: "standard", rateCardBasis: "subscription", envelopeSemantics: "turn", fallbackPosture: "disabled" as const, overagePosture: "disabled" as const, contextClass: "standard", cacheClass: "provider", priceEvidence: { kind: "subscription" as const, rateCardId: "fixture", rateCardRevision: "v1", evidence: { sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z", confidence: "high" as const, authority: "configured" as const } }, auxiliaryCharges: [], executionEnvelope: { limits: [] } };
}

function dataPolicyEvidence() {
  return { providerId: "provider", providerModelId: "model", dataUse: "not-used" as const, trainingPosture: "prohibited" as const, retention: { posture: "zero" as const, days: 0 }, permittedMaximumClassification: "public" as const, permittedClassifications: ["public"] as const, sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"b".repeat(64)}` as const, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" };
}
