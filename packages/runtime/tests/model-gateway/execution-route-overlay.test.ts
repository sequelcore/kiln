import { describe, expect, it } from "vitest";
import { selectExecutionAccountCandidate, type AdmittedExecutionRoute, type ExecutionAccountCandidate } from "@kilnai/core";

describe("model gateway execution-route overlay", () => {
  it("selects only canonical execution candidates admitted for the referenced route", () => {
    const admission: AdmittedExecutionRoute = {
      routeId: "route",
      providerId: "provider",
      providerModelId: "model",
      accountSelection: { mode: "automatic", accountPolicyId: "policy", eligibleAccountIds: ["account-a"] },
    };
    const candidate: ExecutionAccountCandidate = {
      accountId: "account-a",
      safety: "eligible",
      health: "healthy",
      quota: "available",
      capacity: "available",
      economicCost: { atoms: "1", scale: 0, unit: "request", scheme: { kind: "unit" } },
      pressure: 0,
    };
    expect(selectExecutionAccountCandidate(admission, [candidate])).toMatchObject({ kind: "selected", accountId: "account-a" });
  });
});
