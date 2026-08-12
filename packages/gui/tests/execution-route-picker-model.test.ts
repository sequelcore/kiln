import { describe, expect, it } from "vitest";
import { projectExecutionRoutePicker } from "../src/components/execution-route-picker-model.js";

describe("execution route picker model", () => {
  it("keeps unavailable routes visible and projects automatic plus exact account choices", () => {
    const rows = projectExecutionRoutePicker({ routes: [{ routeId: "terra", label: "Terra", providerId: "codex", providerModelId: "gpt", accountOverrideIds: ["work"], accountSelection: { mode: "automatic", eligibleAccountCount: 1, allowOperatorOverride: true }, availability: "unresolved", reasonCodes: ["missing-credentials"], repairActions: ["authenticate-provider"] }] });
    expect(rows[0]).toMatchObject({ routeId: "terra", available: false, reason: "missing-credentials", repairActions: ["authenticate-provider"], accountOptions: [{ id: "", mode: "automatic" }, { id: "work", mode: "exact" }] });
  });
});
