import { describe, expect, it } from "vitest";
import {
  type AdmittedExecutionTarget,
  type ExecutionAccountAdmissionCandidate,
  selectAdmittedExecutionAccount,
} from "@kilnai/core/agents";

describe("model gateway execution-target overlay", () => {
  it("selects only canonical execution candidates admitted for the referenced target", () => {
    const admission: AdmittedExecutionTarget = {
      targetId: "target",
      providerId: "provider",
      providerModelId: "model",
      accountSelection: { kind: "policy", accountPolicyId: "policy", eligibleAccountIds: ["account-a"] },
    };
    const candidate: ExecutionAccountAdmissionCandidate = {
      accountId: "account-a",
      safety: "eligible",
      health: "healthy",
      quota: "available",
      capacity: "available",
      economicCost: { atoms: "1", scale: 0, unit: "request", scheme: { kind: "unit" } },
      pressure: 0,
    };
    expect(selectAdmittedExecutionAccount(admission, [candidate])).toMatchObject({ kind: "selected", accountId: "account-a" });
  });
});
