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
  mutate: vi.fn(),
}));

vi.mock("../../src/config/global-config.js", () => ({
  defaultGlobalConfig: () => ({ version: "4" }),
  readGlobalConfig: () => globalConfigMocks.config,
  mutateGlobalConfig: (mutation: (current: unknown) => unknown) => {
    globalConfigMocks.config = mutation(globalConfigMocks.config) as Record<string, unknown>;
    globalConfigMocks.mutate(globalConfigMocks.config);
  },
}));

describe("targetCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    globalConfigMocks.mutate.mockClear();
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
    await targetCommand(["select", "terra"]);
    expect(globalConfigMocks.mutate).toHaveBeenCalledWith(expect.objectContaining({
      targetRouting: { defaultTargetId: "terra" },
      ui: { targetSelection: { targetId: "terra" } },
    }));
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
