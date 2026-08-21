import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { targetAvailableModelsCommand, targetCommand } from "../../src/commands/target.js";

const globalConfigMocks = vi.hoisted(() => ({
  config: {
    version: "4",
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
  defaultGlobalConfig: () => ({ version: "4" }),
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
      entries: [{ providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model", discoveryState: "stale", eligibilityState: "unknown", availabilityState: "unknown", configuredState: "unconfigured", configuredRouteRefs: [], reasonCodes: ["discovery-stale", "eligibility-unknown", "availability-unknown", "route-not-configured"] }],
    }) });
    const output = consoleSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(output).toContain("Available Models:");
    expect(output).toContain("discovery=stale");
    expect(output).toContain("configured=unconfigured");
  });

  it("sanitizes discovery failures", async () => {
    await targetAvailableModelsCommand({ readCatalog: async () => { throw new Error("token=secret C:\\operator"); } });
    const output = consoleSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(output).toContain("current provider discovery failed");
    expect(output).not.toMatch(/secret|operator/u);
  });
});
