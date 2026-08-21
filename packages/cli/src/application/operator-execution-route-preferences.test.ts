import { describe, expect, it, vi } from "vitest";
import {
  persistGuiExecutionRouteSelectionPreference,
  resolveGuiExecutionRouteSelectionPreference,
} from "./operator-execution-route-preferences.js";
import type { KilnGlobalConfig } from "../config/global-config.js";

const mutateGlobalConfig = vi.hoisted(() => vi.fn());

vi.mock("../config/global-config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/global-config.js")>()),
  mutateGlobalConfig,
}));

describe("operator execution-route preferences", () => {
  it("resolves a persisted GUI execution target and optional account override", () => {
    const config: KilnGlobalConfig = {
      version: "4",
      ui: { targetSelection: { targetId: "terra", accountOverrideId: "work" } },
    };

    expect(resolveGuiExecutionRouteSelectionPreference(config)).toEqual({ routeId: "terra", accountOverrideId: "work" });
  });

  it("persists only canonical execution-route references", () => {
    const current = { version: "4", ui: { theme: "phosphor" } } satisfies KilnGlobalConfig;
    mutateGlobalConfig.mockImplementation((mutation) => ({ config: mutation(current) }));

    persistGuiExecutionRouteSelectionPreference("terra", "work");

    expect(mutateGlobalConfig.mock.calls[0]?.[0](current)).toEqual({
      version: "4",
      ui: { theme: "phosphor", targetSelection: { targetId: "terra", accountOverrideId: "work" } },
    });
  });
});
