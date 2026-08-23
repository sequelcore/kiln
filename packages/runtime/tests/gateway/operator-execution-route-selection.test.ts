import { describe, expect, it } from "vitest";
import type { ExecutionRouteCatalogEntry } from "@kilnai/gateway-contracts";
import { rejectUnavailableExecutionRoute } from "../../src/gateway/operator-execution-route-selection.js";

const route = {
  routeId: "terra",
  label: "Terra",
  providerId: "codex-oauth",
  providerModelId: "gpt-5.6-terra",
  accountOverrideIds: ["work"],
  accountSelection: { mode: "automatic" as const, eligibleAccountCount: 1, allowOperatorOverride: true },
  availability: "available" as const,
  reasonCodes: ["configured" as const],
  repairActions: [],
} satisfies ExecutionRouteCatalogEntry;

describe("operator execution route selection", () => {
  it("rejects an unknown route without materializing a provider", () => {
    expect(rejectUnavailableExecutionRoute({ routes: [route] }, { routeId: "missing" })).toMatchObject({
      ok: false,
      reasonCode: "route-not-configured",
    });
  });

  it("keeps configured unavailable routes visible but fails their selection closed", () => {
    expect(rejectUnavailableExecutionRoute({ routes: [{ ...route, availability: "unavailable", reasonCodes: ["missing-credentials" as const], repairActions: ["authenticate-provider" as const] }] }, { routeId: "terra" })).toMatchObject({
      ok: false,
      reasonCode: "missing-credentials",
      repairActions: ["authenticate-provider"],
    });
  });

  it("rejects account overrides outside the selected route policy", () => {
    expect(rejectUnavailableExecutionRoute({ routes: [route] }, { routeId: "terra", accountOverrideId: "personal" })).toMatchObject({
      ok: false,
      reasonCode: "account-unavailable",
    });
  });
});
