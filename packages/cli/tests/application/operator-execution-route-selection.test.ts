import { describe, expect, it, vi } from "vitest";
import { createOperatorExecutionRouteSelectionPort } from "../../src/application/operator-execution-route-selection.js";
import { economicConfig } from "../config/managed-economic-policy-config-fixture.js";
import { syntheticExecutionCatalog } from "../config/execution-target-evidence-fixture.js";

const readExecutionCatalog = (config: ReturnType<typeof economicConfig> | null) =>
  config ? syntheticExecutionCatalog(config) ?? undefined : undefined;

describe("operator execution target selection", () => {
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
      readConfigSnapshot: () => ({ config: economicConfig(), revision: `sha256:${"a".repeat(64)}` }),
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
      readConfigSnapshot: () => ({ config: economicConfig(), revision: `sha256:${"a".repeat(64)}` }),
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
        readConfigSnapshot: () => ({ config: economicConfig(), revision: `sha256:${"a".repeat(64)}` }),
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
