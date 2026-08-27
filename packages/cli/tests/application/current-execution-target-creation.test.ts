import { describe, expect, it, vi } from "vitest";
import type { ModelCatalogEntry, ExecutionTargetWizardRequest } from "@kilnai/gateway-contracts";
import { admitExecutionTargetWizardRequest, type ExecutionTargetWizardAdmissionInput } from "../../src/application/execution-target-wizard-admission.js";
import {
  createCurrentExecutionTarget,
  parseExecutionTargetWizardRevision,
} from "../../src/application/current-execution-target-creation.js";

describe("guided execution-target admission", () => {
  it("builds a deterministic safe proposal without publishing evidence", async () => {
    const input = fixture();
    const first = admitExecutionTargetWizardRequest(input);
    const second = admitExecutionTargetWizardRequest(input);
    expect(first.proposal).toEqual(second.proposal);
    expect(first.proposal.target.targetId).toMatch(/^target-/u);
    expect(first.proposal.target.accountPolicyId).toBe("policy-openai");
    expect(first.proposal.target.billingClass).toBe("metered");
    expect(first.proposal.target.capabilityPosture).toBe("kiln-executable");
    expect(first.draft.target.accountPolicyId).toBe("policy-openai");
    expect(first.draft.target.economics.priceEvidence.kind).toBe("unknown");
    expect(JSON.stringify(first.proposal)).not.toMatch(/accountId|sourceDigest|path|secret|token/u);
  });

  it("does not bind proposal identity to request correlation metadata", () => {
    const input = fixture();
    const first = admitExecutionTargetWizardRequest(input);
    const second = admitExecutionTargetWizardRequest({
      ...input,
      request: { ...input.request, requestId: "a-different-correlation-id" },
    });
    expect(second.proposal.proposalId).toBe(first.proposal.proposalId);
  });

  it("does not block merely because availability is unavailable", () => {
    const input = fixture();
    const current = {
      ...input.current,
      catalog: {
        ...input.current.catalog,
        models: [{ ...input.current.catalog.models[0]!, availability: "unavailable" as const }],
      },
    };
    expect(() => admitExecutionTargetWizardRequest({ ...input, current })).not.toThrow();
  });

  it("rejects when the current Available Models projection omits the evidence record", () => {
    const input = fixture();
    expect(() => admitExecutionTargetWizardRequest({
      ...input,
      current: { ...input.current, catalog: { ...input.current.catalog, models: [] } },
    })).toThrowError(expect.objectContaining({ code: "TARGET_DISCOVERY_STALE" }));
  });

  it("honors adapter evidence that narrows a dynamic provider to text-only", () => {
    const input = fixture();
    const narrowedEvidence = {
      ...input.admittedEvidence,
      evidenceRevision: `sha256:${"d".repeat(64)}` as `sha256:${string}`,
      materialRevision: `sha256:${"d".repeat(64)}` as `sha256:${string}`,
      modelCapabilities: { supportsFunctionTools: false, supportsRuntimeTools: false },
    };
    const admitted = admitExecutionTargetWizardRequest({
      ...input,
      admittedEvidence: narrowedEvidence,
      current: { ...input.current, discoveryEvidence: narrowedEvidence },
    });

    expect(admitted.proposal.target.capabilityPosture).toBe("text-only");
    expect(admitted.draft.target.economics.executionMode).toBe("text-only");
  });

  it.each([
    ["stale discovery", { discovery: "stale" as const }, "TARGET_DISCOVERY_STALE"],
    ["identity drift", { providerModelId: "changed-model" }, "TARGET_IDENTITY_CHANGED"],
    ["revision drift", undefined, "TARGET_REVISION_CONFLICT"],
  ])("rejects %s with a typed code", (_label, entryChange, code) => {
    const input = fixture();
    const current = entryChange
      ? {
          ...input.current,
          discoveryEvidence: {
            ...input.current.discoveryEvidence,
            entry: { ...input.current.discoveryEvidence.entry, ...entryChange },
          },
        }
      : { ...input.current, revision: `sha256:${"f".repeat(64)}` };
    try {
      admitExecutionTargetWizardRequest({ ...input, current });
      throw new Error("expected admission rejection");
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
  });

  it.each([
    ["absent", [], [], "TARGET_ACCOUNT_UNAVAILABLE"],
    ["ambiguous accounts", [account("account-a"), account("account-b")], [], "TARGET_ACCOUNT_UNAVAILABLE"],
    ["ambiguous policies", [account("account-a"), account("account-b")], [policy("policy-a", ["account-a"]), policy("policy-b", ["account-b"])], "TARGET_ACCOUNT_UNAVAILABLE"],
  ])("rejects %s account selection", (_label, accounts, policies, code) => {
    const input = fixture();
    const current = {
      ...input.current,
      executionCatalog: { ...input.current.executionCatalog, accounts, accountPolicies: policies },
    };
    expect(() => admitExecutionTargetWizardRequest({ ...input, current })).toThrowError(expect.objectContaining({ code }));
  });

  it("binds apply to the preview proposal and revalidates current evidence", async () => {
    const input = fixture();
    const preview = admitExecutionTargetWizardRequest(input);
    const commit = vi.fn(async () => ({ status: "created" as const, revision: parseExecutionTargetWizardRevision(input.current.revision) }));
    const request: ExecutionTargetWizardRequest = {
      ...input.request,
      action: "apply",
      proposalId: preview.proposal.proposalId,
      operatorApproved: true,
    };
    const result = await createCurrentExecutionTarget({
      request,
      admittedEvidence: input.admittedEvidence,
      projectPath: "C:/fixture/project",
      approvalSurface: "cli",
      resolveCurrentEvidence: async () => input.current,
      commit,
    });
    expect(result).toMatchObject({ status: "created", code: "EXECUTION_TARGET_CREATED", requestId: request.requestId });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("rejects an apply with a different proposal id before commit", async () => {
    const input = fixture();
    await expect(createCurrentExecutionTarget({
      request: { ...input.request, action: "apply", proposalId: "cfg_other", operatorApproved: true },
      admittedEvidence: input.admittedEvidence,
      projectPath: "C:/fixture/project",
      approvalSurface: "cli",
      resolveCurrentEvidence: async () => input.current,
      commit: vi.fn(),
    })).resolves.toMatchObject({ status: "rejected", code: "TARGET_REVISION_CONFLICT" });
  });

  it("rejects changed same-identity discovery evidence before commit", async () => {
    const input = fixture();
    const preview = admitExecutionTargetWizardRequest(input);
    const changedEvidence = {
      ...input.current.discoveryEvidence,
      evidenceRevision: `sha256:${"e".repeat(64)}` as `sha256:${string}`,
      materialRevision: `sha256:${"e".repeat(64)}` as `sha256:${string}`,
      sourceObservedAt: "2026-08-14T18:00:00.000Z",
      modelCapabilities: { supportsFunctionTools: false, supportsRuntimeTools: false },
    };
    const commit = vi.fn();
    const resolveCurrentEvidence = vi.fn()
      .mockResolvedValueOnce(input.current)
      .mockResolvedValueOnce({ ...input.current, discoveryEvidence: changedEvidence });

    const result = await createCurrentExecutionTarget({
      request: { ...input.request, action: "apply", proposalId: preview.proposal.proposalId, operatorApproved: true },
      admittedEvidence: input.admittedEvidence,
      projectPath: "C:/fixture/project",
      approvalSurface: "cli",
      resolveCurrentEvidence,
      commit,
    });

    expect(result).toMatchObject({ status: "rejected", code: "TARGET_DISCOVERY_STALE" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("accepts a newer equivalent observation while binding the same approved material", async () => {
    const input = fixture();
    const preview = admitExecutionTargetWizardRequest(input);
    const newerEvidence = {
      ...input.current.discoveryEvidence,
      evidenceRevision: `sha256:${"e".repeat(64)}` as `sha256:${string}`,
      catalogObservedAt: "2026-08-14T18:00:00.000Z",
      sourceObservedAt: "2026-08-14T18:00:00.000Z",
    };
    const newerCurrent = {
      ...input.current,
      catalog: { ...input.current.catalog, observedAt: newerEvidence.catalogObservedAt },
      discoveryEvidence: newerEvidence,
    };
    const commit = vi.fn(async () => ({ status: "created" as const, revision: parseExecutionTargetWizardRevision(input.current.revision) }));
    const result = await createCurrentExecutionTarget({
      request: { ...input.request, action: "apply", proposalId: preview.proposal.proposalId, operatorApproved: true },
      admittedEvidence: input.admittedEvidence,
      projectPath: "C:/fixture/project",
      approvalSurface: "cli",
      resolveCurrentEvidence: async () => newerCurrent,
      commit,
    });

    expect(result).toMatchObject({ status: "created", code: "EXECUTION_TARGET_CREATED" });
    expect(commit).toHaveBeenCalledOnce();
  });

  it("reports committed-refresh-failed when readback fails after a committed write", async () => {
    const input = fixture();
    const preview = admitExecutionTargetWizardRequest(input);
    const resolveCurrentEvidence = vi.fn()
      .mockResolvedValueOnce(input.current)
      .mockResolvedValueOnce(input.current)
      .mockRejectedValueOnce(new Error("refresh unavailable"));
    const result = await createCurrentExecutionTarget({
      request: { ...input.request, action: "apply", proposalId: preview.proposal.proposalId, operatorApproved: true },
      admittedEvidence: input.admittedEvidence,
      projectPath: "C:/fixture/project",
      approvalSurface: "cli",
      resolveCurrentEvidence,
      commit: vi.fn(async () => ({ status: "created" as const, revision: parseExecutionTargetWizardRevision(input.current.revision) })),
    });
    expect(result).toMatchObject({ status: "committed-refresh-failed", code: "EXECUTION_TARGET_COMMITTED_REFRESH_FAILED", revision: input.current.revision });
  });
});

function fixture(): ExecutionTargetWizardAdmissionInput {
  const revision = `sha256:${"a".repeat(64)}`;
  const discoveryEvidence = {
    entry: entry(),
    catalogObservedAt: "2026-08-13T18:00:00.000Z",
    sourceObservedAt: "2026-08-13T18:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    evidenceIdentity: "runtime-provider-catalog:fixture",
    evidenceRevision: `sha256:${"b".repeat(64)}` as `sha256:${string}`,
    materialRevision: `sha256:${"b".repeat(64)}` as `sha256:${string}`,
    rawEvidence: { rawId: "gpt-5.6", provenance: "fixture" },
  };
  return {
    request: {
      requestId: "wizard-request",
      action: "preview" as const,
      expectedRevision: revision,
      discoveryIdentity: { providerId: "codex-oauth", providerRouteId: "codex-oauth:direct", providerModelId: "gpt-5.6" },
      label: "Primary model",
      dataClassification: "public" as const,
      dataPolicyConfirmed: true as const,
    },
    admittedEvidence: discoveryEvidence,
    current: {
      catalog: { observedAt: "2026-08-13T18:00:00.000Z", models: [entry()] },
      executionCatalog: {
        accounts: [account("account-a")],
        accountPolicies: [policy("policy-openai", ["account-a"])],
        targets: [],
      },
      targetIntent: {
        evidenceRevision: `sha256:${"c".repeat(64)}` as `sha256:${string}`,
        accounts: [{ id: "account-a", providerId: "openai", credentialId: "opaque", maxConcurrency: 2, reservedAffinitySlots: 0, economics: { creditPosture: "disabled" as const, overagePosture: "disabled" as const } }],
        accountPolicies: [policy("policy-openai", ["account-a"])],
        targets: [],
      },
      targetEvidence: { version: 1 as const, accounts: [], targets: [] },
      revision,
      discoveryEvidence,
    },
  };
}

function entry(): ModelCatalogEntry {
  return {
    providerId: "codex-oauth",
    providerRouteId: "codex-oauth:direct",
    providerModelId: "gpt-5.6",
    access: "subscription",
    family: "gpt-5.6",
    displayName: "GPT-5.6",
    discovery: "observed",
    eligibility: "eligible",
    availability: "available",
    provenance: [],
    targets: [],
  };
}

function account(id: string) {
  return {
    id,
    providerId: "codex-oauth",
    credentialId: "opaque",
    maxConcurrency: 2,
    reservedAffinitySlots: 0,
    economics: {
      capacityIdentity: "account-economics",
      subscriptionClass: "metered" as const,
      quotaClassId: "quota-openai",
      creditPosture: "disabled" as const,
      overagePosture: "disabled" as const,
    },
  };
}

function policy(id: string, accountIds: readonly string[]) {
  return { id, accountIds, strategy: "economic-least-pressure" as const };
}
