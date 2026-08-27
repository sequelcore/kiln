import { describe, expect, it, vi } from "vitest";
import { createOperatorExecutionTargetSelectionPort } from "../../src/application/operator-execution-target-selection.js";
import { managedAgentIntentConfig } from "../config/managed-agent-intent-config-fixture.js";
import { syntheticExecutionTargetCatalog } from "../config/execution-target-evidence-fixture.js";

const readExecutionTargetCatalog = (config: ReturnType<typeof managedAgentIntentConfig> | null) =>
  config ? syntheticExecutionTargetCatalog(config) ?? undefined : undefined;

describe("operator execution target selection", () => {
  it("admits against one captured config snapshot instead of mixing revisions", async () => {
    const readConfigSnapshot = vi.fn()
      .mockReturnValueOnce({ config: managedAgentIntentConfig(), revision: `sha256:${"a".repeat(64)}` })
      .mockReturnValue({ config: null, revision: `sha256:${"b".repeat(64)}` });
    const port = createOperatorExecutionTargetSelectionPort({
      readConfigSnapshot,
      readExecutionTargetCatalog,
      resolveAccountAvailability: async () => [{ accountId: "codex-account", available: true, reasonCodes: [] }],
    });

    await expect(port.admit({ targetId: "codex-standard" })).resolves.toMatchObject({
      ok: true,
      admission: { targetId: "codex-standard" },
    });
    expect(readConfigSnapshot).toHaveBeenCalledTimes(1);
  });

  it("resolves availability only for the selected target during admission", async () => {
    const config = managedAgentIntentConfig();
    const baseCatalog = syntheticExecutionTargetCatalog(config)!;
    const resolveAccountAvailability = vi.fn(async () => (
      [{ accountId: "codex-account", available: true, reasonCodes: [] as const }]
    ));
    const port = createOperatorExecutionTargetSelectionPort({
      readConfigSnapshot: () => ({ config, revision: `sha256:${"a".repeat(64)}` }),
      readExecutionTargetCatalog: () => ({
        ...baseCatalog,
        targets: [
          ...baseCatalog.targets,
          { ...baseCatalog.targets[0]!, id: "unrelated-target", label: "Unrelated target" },
        ],
      }),
      resolveAccountAvailability,
    });

    await expect(port.admit({ targetId: "codex-standard" })).resolves.toMatchObject({
      ok: true,
      admission: { targetId: "codex-standard" },
    });
    expect(resolveAccountAvailability).toHaveBeenCalledTimes(1);
    expect(resolveAccountAvailability).toHaveBeenCalledWith(expect.objectContaining({
      admission: expect.objectContaining({ targetId: "codex-standard" }),
    }));
  });

  it("rejects unknown targets and ineligible account overrides before resolving availability", async () => {
    const resolveAccountAvailability = vi.fn(async () => (
      [{ accountId: "codex-account", available: true, reasonCodes: [] as const }]
    ));
    const port = createOperatorExecutionTargetSelectionPort({
      readConfigSnapshot: () => ({ config: managedAgentIntentConfig(), revision: `sha256:${"a".repeat(64)}` }),
      readExecutionTargetCatalog,
      resolveAccountAvailability,
    });

    await expect(port.admit({ targetId: "missing" })).resolves.toMatchObject({
      ok: false,
      reasonCode: "target-not-configured",
      reason: "Execution target 'missing' is not configured.",
    });
    await expect(port.admit({ targetId: "codex-standard", accountOverrideId: "personal" })).resolves.toMatchObject({
      ok: false,
      reasonCode: "account-unavailable",
    });
    expect(resolveAccountAvailability).not.toHaveBeenCalled();
  });

  it("projects target availability from the configured account candidates", async () => {
    const accountAvailability = { current: [] as { accountId: string; available: boolean; reasonCodes: readonly any[] }[] };
    const resolveAccountAvailability = vi.fn(async ({ admission }: {
      readonly admission: { readonly targetId: string; readonly providerId: string; readonly providerModelId: string };
    }) => {
      expect(admission).toMatchObject({
        targetId: "codex-standard",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-codex",
      });
      return accountAvailability.current;
    });
    const port = createOperatorExecutionTargetSelectionPort({
      readConfigSnapshot: () => ({ config: managedAgentIntentConfig(), revision: `sha256:${"a".repeat(64)}` }),
      readExecutionTargetCatalog,
      resolveAccountAvailability,
    });

    const [unavailable] = await port.getTargets();
    expect(unavailable).toMatchObject({
      targetId: "codex-standard",
      availability: "unavailable",
      reasonCodes: ["missing-credentials"],
      repairActions: ["authenticate-provider", "check-account", "refresh-model-catalog"],
      eligibleAccountCount: 0,
    });

    accountAvailability.current = [{ accountId: "codex-account", available: true, reasonCodes: [] }];
    const [available] = await port.getTargets();
    expect(available).toMatchObject({
      targetId: "codex-standard",
      availability: "available",
      reasonCodes: [],
      repairActions: [],
      eligibleAccountCount: 1,
      accountOverrideIds: ["codex-account"],
    });
    expect(resolveAccountAvailability).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["account-capacity-exhausted", ["account-capacity-exhausted"]],
    ["quota-exhausted", ["quota-exhausted"]],
    ["provider-unavailable", ["provider-unavailable"]],
  ] as const)("projects sanitized %s account evidence through admission", async (_name, reasonCodes) => {
    const port = createOperatorExecutionTargetSelectionPort({
      readConfigSnapshot: () => ({ config: managedAgentIntentConfig(), revision: `sha256:${"a".repeat(64)}` }),
      readExecutionTargetCatalog,
      resolveAccountAvailability: async () => [{ accountId: "codex-account", available: false, reasonCodes }],
    });

    const [target] = await port.getTargets();
    expect(target).toMatchObject({ availability: "unavailable", reasonCodes });
    await expect(port.admit({ targetId: "codex-standard" })).resolves.toMatchObject({ ok: false, reasonCode: reasonCodes[0] });
  });

  it.each(["quota-stale", "quota-unknown"] as const)(
    "fails closed when quota evidence is %s",
    async (reasonCode) => {
      const port = createOperatorExecutionTargetSelectionPort({
        readConfigSnapshot: () => ({ config: managedAgentIntentConfig(), revision: `sha256:${"a".repeat(64)}` }),
        readExecutionTargetCatalog,
        resolveAccountAvailability: async () => [{
          accountId: "codex-account",
          available: false,
          reasonCodes: [reasonCode],
        }],
      });

      const [target] = await port.getTargets();
      expect(target).toMatchObject({ availability: "unavailable", reasonCodes: [reasonCode], eligibleAccountCount: 0 });
      await expect(port.admit({ targetId: "codex-standard" })).resolves.toMatchObject({ ok: false, reasonCode });
    },
  );
});
