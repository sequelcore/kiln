import { describe, expect, it, vi } from "vitest";
import { createOperatorExecutionRouteSelectionPort } from "../../src/application/operator-execution-route-selection.js";
import { managedAgentIntentConfig } from "../config/managed-agent-intent-config-fixture.js";
import { syntheticExecutionCatalog } from "../config/execution-target-evidence-fixture.js";

const readExecutionCatalog = (config: ReturnType<typeof managedAgentIntentConfig> | null) =>
  config ? syntheticExecutionCatalog(config) ?? undefined : undefined;

describe("operator execution target selection", () => {
  it("admits against one captured config snapshot instead of mixing two revisions", async () => {
    const readConfigSnapshot = vi.fn()
      .mockReturnValueOnce({ config: managedAgentIntentConfig(), revision: `sha256:${"a".repeat(64)}` })
      .mockReturnValue({ config: null, revision: `sha256:${"b".repeat(64)}` });
    const port = createOperatorExecutionRouteSelectionPort({
      readConfigSnapshot,
      readExecutionCatalog,
      resolveAccountAvailability: async () => [{ accountId: "codex-account", available: true, reasonCodes: [] }],
    });

    await expect(port.admit({ routeId: "codex-standard" })).resolves.toMatchObject({
      ok: true,
      admission: { routeId: "codex-standard" },
    });
    expect(readConfigSnapshot).toHaveBeenCalledTimes(1);
  });

  it("resolves availability only for the selected route during admission", async () => {
    const config = managedAgentIntentConfig();
    const baseCatalog = syntheticExecutionCatalog(config)!;
    const resolveAccountAvailability = vi.fn(async () => (
      [{ accountId: "codex-account", available: true, reasonCodes: [] as const }]
    ));
    const port = createOperatorExecutionRouteSelectionPort({
      readConfigSnapshot: () => ({ config, revision: `sha256:${"a".repeat(64)}` }),
      readExecutionCatalog: () => ({
        ...baseCatalog,
        routes: [
          ...baseCatalog.routes,
          { ...baseCatalog.routes[0]!, id: "unrelated-route", label: "Unrelated route" },
        ],
      }),
      resolveAccountAvailability,
    });

    await expect(port.admit({ routeId: "codex-standard" })).resolves.toMatchObject({
      ok: true,
      admission: { routeId: "codex-standard" },
    });
    expect(resolveAccountAvailability).toHaveBeenCalledTimes(1);
    expect(resolveAccountAvailability).toHaveBeenCalledWith(expect.objectContaining({
      admission: expect.objectContaining({ routeId: "codex-standard" }),
    }));
  });

  it("rejects unknown routes and ineligible account overrides before resolving availability", async () => {
    const resolveAccountAvailability = vi.fn(async () => (
      [{ accountId: "codex-account", available: true, reasonCodes: [] as const }]
    ));
    const port = createOperatorExecutionRouteSelectionPort({
      readConfigSnapshot: () => ({ config: managedAgentIntentConfig(), revision: `sha256:${"a".repeat(64)}` }),
      readExecutionCatalog,
      resolveAccountAvailability,
    });

    await expect(port.admit({ routeId: "missing" })).resolves.toMatchObject({
      ok: false,
      reasonCode: "route-not-configured",
      reason: "Execution target 'missing' is not configured.",
    });
    await expect(port.admit({ routeId: "codex-standard", accountOverrideId: "personal" })).resolves.toMatchObject({
      ok: false,
      reasonCode: "account-unavailable",
    });
    expect(resolveAccountAvailability).not.toHaveBeenCalled();
  });

  it("projects route availability from the configured account candidates", async () => {
    const accountAvailability = { current: [] as { accountId: string; available: boolean; reasonCodes: readonly any[] }[] };
    const resolveAccountAvailability = vi.fn(async ({ admission }: {
      readonly admission: { readonly routeId: string; readonly providerId: string; readonly providerModelId: string };
    }) => {
      expect(admission).toMatchObject({
        routeId: "codex-standard",
        providerId: "codex-oauth",
        providerModelId: "gpt-5.6-codex",
      });
      return accountAvailability.current;
    });
    const port = createOperatorExecutionRouteSelectionPort({
      readConfigSnapshot: () => ({ config: managedAgentIntentConfig(), revision: `sha256:${"a".repeat(64)}` }),
      readExecutionCatalog,
      resolveAccountAvailability,
    });

    const unavailable = await port.getCatalog();
    expect(unavailable.routes[0]).toMatchObject({
      routeId: "codex-standard",
      availability: "unavailable",
      reasonCodes: ["missing-credentials"],
      repairActions: ["authenticate-provider", "check-account", "refresh-route-catalog"],
      accountSelection: { mode: "automatic", eligibleAccountCount: 0 },
    });

    accountAvailability.current = [{ accountId: "codex-account", available: true, reasonCodes: [] }];
    const available = await port.getCatalog();
    expect(available.routes[0]).toMatchObject({
      routeId: "codex-standard",
      availability: "available",
      reasonCodes: [],
      repairActions: [],
      accountSelection: { mode: "automatic", eligibleAccountCount: 1 },
      accountOverrideIds: ["codex-account"],
    });
    expect(resolveAccountAvailability).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["account-capacity-exhausted", ["account-capacity-exhausted"]],
    ["quota-exhausted", ["quota-exhausted"]],
    ["provider-unavailable", ["provider-unavailable"]],
  ] as const)("projects sanitized %s account evidence through admission", async (_name, reasonCodes) => {
    const port = createOperatorExecutionRouteSelectionPort({
      readConfigSnapshot: () => ({ config: managedAgentIntentConfig(), revision: `sha256:${"a".repeat(64)}` }),
      readExecutionCatalog,
      resolveAccountAvailability: async () => [{ accountId: "codex-account", available: false, reasonCodes }],
    });

    const catalog = await port.getCatalog();
    expect(catalog.routes[0]).toMatchObject({ availability: "unavailable", reasonCodes });
    await expect(port.admit({ routeId: "codex-standard" })).resolves.toMatchObject({ ok: false, reasonCode: reasonCodes[0] });
  });

  it.each(["quota-stale", "quota-unknown"] as const)(
    "fails closed when quota evidence is %s",
    async (reasonCode) => {
      const port = createOperatorExecutionRouteSelectionPort({
        readConfigSnapshot: () => ({ config: managedAgentIntentConfig(), revision: `sha256:${"a".repeat(64)}` }),
        readExecutionCatalog,
        resolveAccountAvailability: async () => [{
          accountId: "codex-account",
          available: false,
          reasonCodes: [reasonCode],
        }],
      });

      const catalog = await port.getCatalog();
      expect(catalog.routes[0]).toMatchObject({
        availability: "unavailable",
        reasonCodes: [reasonCode],
        accountSelection: { eligibleAccountCount: 0 },
      });
      await expect(port.admit({ routeId: "codex-standard" })).resolves.toMatchObject({
        ok: false,
        reasonCode,
      });
    },
  );
});
