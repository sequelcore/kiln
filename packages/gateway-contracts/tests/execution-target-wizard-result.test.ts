import { describe, expect, it } from "vitest";
import { ExecutionTargetWizardResultSchema } from "../src/execution-target-wizard.js";

describe("ExecutionTargetWizardResultSchema", () => {
  it("rejects impossible status/code combinations and unsafe projections", () => {
    const revision = `sha256:${"b".repeat(64)}`;
    const proposal = {
      proposalId: "cfg_proposal",
      operation: "target.create",
      scope: "global",
      status: "valid",
      baseRevision: revision,
      authorityImpact: "expands-write",
      approvalRequired: true,
      approvalStatus: "approved",
      activation: "next-session",
      owners: ["execution-routing"],
      reconciliationTargets: ["execution-routes"],
      diagnostics: [],
      rollback: { restorable: true, summary: "Restorable." },
      target: {
        routeId: "route",
        label: "Route",
        providerId: "provider",
        providerModelId: "model",
        accountSelectionMode: "automatic",
        dataClassification: "public",
        billingClass: "subscription",
        capabilityPosture: "kiln-executable",
        discoveryExpiresAt: "2027-01-01T00:00:00.000Z",
        evidenceExpiresAt: "2027-01-01T00:00:00.000Z",
      },
    };
    for (const value of [
      { type: "execution_target_wizard_result", requestId: "request", status: "created", code: "TARGET_REVISION_CONFLICT", message: "x", revision, proposal, executionRouteCatalog: { routes: [], revision }, availableModels: { observedAt: "2026-08-13T18:00:00.000Z", entries: [] } },
      { type: "execution_target_wizard_result", requestId: "request", status: "rejected", code: "EXECUTION_TARGET_CREATED", message: "x", action: "refresh-and-retry" },
      { type: "execution_target_wizard_result", requestId: "request", status: "rejected", code: "TARGET_REVISION_CONFLICT", message: "x", action: "refresh-and-retry", canonicalPath: "C:/operator/config.yaml" },
    ]) {
      expect(() => ExecutionTargetWizardResultSchema.parse(value)).toThrow();
    }
  });
});
