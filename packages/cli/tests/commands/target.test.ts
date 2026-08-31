import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { targetAvailableModelsCommand, targetCommand, targetCreateCommand } from "../../src/commands/target.js";
import type { ExecutionTargetWizardRequest, ExecutionTargetWizardResult } from "@kilnai/gateway-contracts";

const globalConfigMocks = vi.hoisted(() => ({
  config: {
    version: "7",
    targetCatalog: {
      accounts: [],
      accountPolicies: [],
      targets: [
        { id: "terra", kind: "direct", providerId: "codex-oauth", providerModelId: "gpt-5.6-terra" },
        { id: "claude-cli", kind: "harness", providerId: "claude", providerModelId: "claude-opus-4-6" },
      ],
    },
    targetRouting: { defaultTargetId: "terra" },
  } as Record<string, unknown>,
}));

const mutationMocks = vi.hoisted(() => ({
  propose: vi.fn(),
  approve: vi.fn(),
  apply: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../src/config/global-config.js", () => ({
  defaultGlobalConfig: () => ({ version: "7" }),
  readGlobalConfig: () => globalConfigMocks.config,
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

describe("targetCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mutationMocks.propose.mockReset().mockImplementation(({ payload }: { readonly payload: { readonly targetId: string } }) => {
      const target = (globalConfigMocks.config.targetCatalog as { readonly targets: readonly { readonly id: string; readonly kind: string }[] }).targets
        .find((candidate) => candidate.id === payload.targetId);
      return {
        proposal: target?.kind === "direct"
          ? { proposalId: "cfg_target", status: "valid", approvalRequired: true, diagnostics: [], previewDiff: "target diff" }
          : { proposalId: "cfg_target", status: "invalid", approvalRequired: false, diagnostics: [{ message: target ? `Execution target '${payload.targetId}' is not a direct operator target.` : `Execution target '${payload.targetId}' is not configured.` }] },
      };
    });
    mutationMocks.approve.mockReset().mockReturnValue({ approvalId: "approval_target" });
    mutationMocks.apply.mockReset().mockResolvedValue({
      settlement: { outcome: "committed", diagnostics: [] },
    });
    mutationMocks.save.mockReset();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("lists direct and harness targets with one explicit default", async () => {
    await targetCommand();
    const output = consoleSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(output).toContain("Execution Targets:");
    expect(output).toContain("terra [direct] codex-oauth/gpt-5.6-terra *");
    expect(output).toContain("claude-cli [harness] claude/claude-opus-4-6");
  });

  it("selects one configured direct target without retaining an account override", async () => {
    await targetCommand(["select", "terra", "--approve"]);
    expect(mutationMocks.propose).toHaveBeenCalledWith(expect.objectContaining({
      operation: "target.select",
      payload: { targetId: "terra" },
    }));
    expect(mutationMocks.save).toHaveBeenCalledOnce();
    expect(mutationMocks.approve).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: "cfg_target",
      surface: "cli",
    }));
    expect(mutationMocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: "cfg_target",
      approvalId: "approval_target",
      requester: "operator",
    }));
  });

  it("requires explicit approval before selecting a target with unknown authority impact", async () => {
    await expect(targetCommand(["select", "terra"]))
      .rejects.toThrow("repeat with --approve");
    expect(mutationMocks.save).not.toHaveBeenCalled();
    expect(mutationMocks.approve).not.toHaveBeenCalled();
    expect(mutationMocks.apply).not.toHaveBeenCalled();
  });

  it("rejects harness targets as the direct operator default", async () => {
    await expect(targetCommand(["select", "claude-cli"]))
      .rejects.toThrow("is not a direct operator target");
  });

  it("prints the supplied Runtime available-model catalog without executing a provider", async () => {
    await targetAvailableModelsCommand({ readCatalog: async () => ({
      observedAt: "2026-08-13T18:00:00.000Z",
      models: [{
        providerId: "provider",
        providerRouteId: "provider:direct",
        providerModelId: "model",
        access: "api" as const,
        family: "model",
        discovery: "stale" as const,
        eligibility: "unknown" as const,
        availability: "unknown" as const,
        provenance: [],
        targets: [],
      }],
    }) });
    const output = consoleSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(output).toContain("Available Models:");
    expect(output).toContain("discovery=stale");
    expect(output).toContain("not-configured");
  });

  it("sanitizes discovery failures", async () => {
    await targetAvailableModelsCommand({ readCatalog: async () => { throw new Error("token=secret C:\\operator"); } });
    const output = consoleSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(output).toContain("current provider discovery failed");
    expect(output).not.toMatch(/secret|operator/u);
  });

  it("previews a uniquely selected current model from guided flags", async () => {
    const create = vi.fn(async (request: ExecutionTargetWizardRequest): Promise<ExecutionTargetWizardResult> => previewResult(request));
    await targetCreateCommand(["openai/gpt-4o", "--classification", "public", "--confirm-data-policy"], {
      requestId: () => "wizard-1",
      readCurrent: async () => wizardContext(),
      create,
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      action: "preview",
      requestId: "wizard-1",
      expectedRevision: `sha256:${"d".repeat(64)}`,
      discoveryIdentity: { providerId: "openai", providerRouteId: "openai:direct", providerModelId: "gpt-4o" },
      dataClassification: "public",
      dataPolicyConfirmed: true,
    }));
    expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toMatch(/routeId|accountId|economics|evidence/u);
    const output = consoleSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(output).toContain("Execution target previewed:");
    expect(output).toContain("model: openai/gpt-4o");
    expect(output).toContain("next: repeat with --approve");
    expect(output).not.toContain("cfg_preview");
    expect(output).not.toContain("target-openai-gpt-4o");
  });

  it("previews internally and applies the exact proposal when approved", async () => {
    const create = vi.fn(async (request: ExecutionTargetWizardRequest): Promise<ExecutionTargetWizardResult> => (
      request.action === "preview"
        ? previewResult(request)
        : createdResult(request)
    ));
    const confirmedProposalIds: string[] = [];
    const confirm = vi.fn(async (proposal: Extract<ExecutionTargetWizardResult, { readonly status: "previewed" }>["proposal"]) => {
      confirmedProposalIds.push(proposal.proposalId);
      const outputBeforeConfirmation = consoleSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
      expect(outputBeforeConfirmation).toContain("Execution target previewed:");
      expect(outputBeforeConfirmation).toContain("model: openrouter/org/model/variant");
      expect(outputBeforeConfirmation).toContain("classification: internal");
      expect(outputBeforeConfirmation).toContain("label: Model");
      expect(outputBeforeConfirmation).toContain("next: confirm the exact proposal above");
      return true;
    });
    await targetCreateCommand(["openrouter/org/model/variant", "--classification", "internal", "--confirm-data-policy", "--label", "Model", "--approve"], {
      requestId: () => "wizard-2",
      readCurrent: async () => ({ ...wizardContext(), catalog: { ...wizardContext().catalog, models: [{ ...wizardContext().catalog.models[0]!, providerId: "openrouter", providerRouteId: "openrouter:direct", providerModelId: "org/model/variant" }] } }),
      create,
      confirm,
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ action: "preview", label: "Model", dataClassification: "internal" });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ action: "apply", proposalId: "cfg_preview", operatorApproved: true });
    expect(confirm).toHaveBeenCalledOnce();
    expect(create.mock.calls[1]?.[0]).toMatchObject({ proposalId: confirmedProposalIds[0] });
    const output = consoleSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(output).toContain("Execution target created:");
    expect(output).toContain("model: openrouter/org/model/variant");
    expect(output).not.toContain("cfg_preview");
  });

  it.each([
    [["openai/gpt-4o", "--confirm-data-policy"], "classification"],
    [["openai/gpt-4o", "--classification", "public"], "confirm-data-policy"],
    [["openai/gpt-4o", "--classification", "public", "--confirm-data-policy", "--preview"], "Unknown target create flag"],
    [["openai/gpt-4o", "--classification", "public", "--classification", "internal", "--confirm-data-policy"], "--classification more than once"],
    [["openai/gpt-4o", "--classification", "public", "--confirm-data-policy", "--label", "one", "--label", "two"], "--label more than once"],
  ])("rejects missing or legacy flags (%s)", async (args, message) => {
    await expect(targetCreateCommand(args, { readCurrent: async () => wizardContext(), create: vi.fn() })).rejects.toThrow(message);
  });

  it("rejects an ambiguous selector before creation", async () => {
    const context = wizardContext();
    await expect(targetCreateCommand(["openai/gpt-4o", "--classification", "public", "--confirm-data-policy"], {
      readCurrent: async () => ({ ...context, catalog: { ...context.catalog, models: [context.catalog.models[0]!, { ...context.catalog.models[0]!, providerRouteId: "openai:secondary" }] } }),
      create: vi.fn(),
    })).rejects.toThrow(/ambiguous/u);
  });

  it("explains the governed data policy when confirmation is missing", async () => {
    await expect(targetCreateCommand(["openai/gpt-4o", "--classification", "public"], {
      readCurrent: async () => wizardContext(),
      create: vi.fn(),
    })).rejects.toThrow("service operation; training may be permitted; retention up to 3650 days");
  });

  it("does not apply a preview when confirmation is declined", async () => {
    const create = vi.fn(async (request: ExecutionTargetWizardRequest): Promise<ExecutionTargetWizardResult> => previewResult(request));
    const confirm = vi.fn(async () => false);
    await targetCreateCommand(["openai/gpt-4o", "--classification", "public", "--confirm-data-policy", "--approve"], {
      requestId: () => "wizard-declined",
      readCurrent: async () => wizardContext(),
      create,
      confirm,
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n")).toContain("was not applied");
  });

  it("fails closed without an interactive confirmation port", async () => {
    const create = vi.fn(async (request: ExecutionTargetWizardRequest): Promise<ExecutionTargetWizardResult> => previewResult(request));
    await targetCreateCommand(["openai/gpt-4o", "--classification", "public", "--confirm-data-policy", "--approve"], {
      requestId: () => "wizard-noninteractive",
      readCurrent: async () => wizardContext(),
      create,
    });
    expect(create).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n")).toContain("declined or unavailable");
  });
});

function wizardContext() {
  return {
    revision: `sha256:${"d".repeat(64)}`,
    catalog: {
      observedAt: "2026-08-13T18:00:00.000Z",
      models: [{
        providerId: "openai",
        providerRouteId: "openai:direct",
        providerModelId: "gpt-4o",
        access: "api" as const,
        family: "gpt-4o",
        displayName: "GPT-4o",
        discovery: "observed" as const,
        eligibility: "eligible" as const,
        availability: "unavailable" as const,
        provenance: [],
        targets: [],
      }],
    },
  };
}

function previewResult(request: ExecutionTargetWizardRequest): Extract<ExecutionTargetWizardResult, { readonly status: "previewed" }> {
  const target = {
    targetId: `target-${request.discoveryIdentity.providerId}-${request.discoveryIdentity.providerModelId.replace(/[^A-Za-z0-9._-]/gu, "-")}`,
    label: request.label ?? "Model",
    providerId: request.discoveryIdentity.providerId,
    providerModelId: request.discoveryIdentity.providerModelId,
    accountPolicyId: "fixture-account-policy",
    eligibleAccountCount: 1,
    dataClassification: request.dataClassification,
    billingClass: "metered" as const,
    capabilityPosture: "kiln-executable" as const,
    discoveryExpiresAt: "2027-01-01T00:00:00.000Z",
    evidenceExpiresAt: "2027-01-01T00:00:00.000Z",
  };
  return {
    type: "execution_target_wizard_result",
    requestId: request.requestId,
    status: "previewed",
    code: "EXECUTION_TARGET_PREVIEWED",
    action: "approve-and-apply",
    message: "Preview ready.",
    proposal: {
      proposalId: "cfg_preview",
      operation: "target.create",
      scope: "global",
      status: "valid",
      baseRevision: `sha256:${"d".repeat(64)}`,
      authorityImpact: "expands-write",
      approvalRequired: true,
      approvalStatus: "required",
      activation: "next-session",
      owners: ["execution-routing"],
      reconciliationTargets: ["execution-targets"],
      diagnostics: [],
      rollback: { restorable: true, summary: "Restorable." },
      target,
    },
  };
}

function createdResult(request: Extract<ExecutionTargetWizardRequest, { readonly action: "apply" }>): Extract<ExecutionTargetWizardResult, { readonly status: "created" }> {
  const preview = previewResult(request);
  const target = preview.proposal.target;
  const proposal = { ...preview.proposal, approvalStatus: "approved" as const, target };
  return {
    ...preview,
    status: "created",
    code: "EXECUTION_TARGET_CREATED",
    action: "none",
    message: "Created callback fixture.",
    revision: `sha256:${"e".repeat(64)}`,
    proposal,
    modelCatalog: {
      observedAt: "2026-08-13T18:00:00.000Z",
      revision: `sha256:${"e".repeat(64)}`,
      models: [],
    },
  };
}
