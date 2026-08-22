import { describe, expect, it } from "vitest";
import {
  ExecutionTargetWizardRequestSchema,
  ExecutionTargetWizardResultSchema,
} from "../src/execution-target-wizard.js";

const revision = `sha256:${"a".repeat(64)}`;

const previewRequest = {
  requestId: "request",
  action: "preview",
  expectedRevision: revision,
  discoveryIdentity: {
    providerId: "provider",
    providerRouteId: "provider:direct",
    providerModelId: "model",
  },
  label: "Route",
  dataClassification: "public",
  dataPolicyConfirmed: true,
} as const;

const applyRequest = {
  ...previewRequest,
  action: "apply",
  proposalId: "cfg_proposal",
  operatorApproved: true,
} as const;

describe("ExecutionTargetWizardRequestSchema", () => {
  it("admits only guided operator intent", () => {
    expect(ExecutionTargetWizardRequestSchema.parse(previewRequest)).toEqual(previewRequest);
    expect(ExecutionTargetWizardRequestSchema.parse(applyRequest)).toEqual(applyRequest);
  });

  it.each([
    { routeId: "operator-authored-route" },
    { accountId: "account" },
    { accountPolicyId: "policy" },
    { dataPolicyEvidence: {} },
    { economics: {} },
    { adapterCapabilityId: "adapter" },
    { evidenceRevision: revision },
    { apiKey: "secret" },
    { path: "C:/operator/config.yaml" },
    { payload: { secret: "x" } },
  ])("rejects raw material or secret-bearing field %j", (field) => {
    expect(() => ExecutionTargetWizardRequestSchema.parse({ ...previewRequest, ...field })).toThrow();
  });

  it("requires explicit confirmation and approval for apply", () => {
    expect(() => ExecutionTargetWizardRequestSchema.parse({ ...previewRequest, dataPolicyConfirmed: false })).toThrow();
    expect(() => ExecutionTargetWizardRequestSchema.parse({ ...previewRequest, action: "apply", operatorApproved: true })).toThrow();
    expect(() => ExecutionTargetWizardRequestSchema.parse({ ...applyRequest, proposalId: undefined })).toThrow();
    expect(() => ExecutionTargetWizardRequestSchema.parse({ ...applyRequest, operatorApproved: false })).toThrow();
    expect(() => ExecutionTargetWizardRequestSchema.parse({ ...previewRequest, expectedRevision: "absent" })).toThrow();
  });
});

describe("ExecutionTargetWizardResultSchema", () => {
  it("admits a safe preview projection without raw payload or paths", () => {
    const result = ExecutionTargetWizardResultSchema.parse({
      type: "execution_target_wizard_result",
      requestId: "request",
      status: "previewed",
      code: "EXECUTION_TARGET_PREVIEWED",
      message: "Execution target proposal is ready for approval.",
      action: "approve-and-apply",
      proposal: proposal(),
    });
    expect(result).toMatchObject({ status: "previewed", proposal: { operation: "target.create" } });
    expect(() => ExecutionTargetWizardResultSchema.parse({
      type: "execution_target_wizard_result",
      requestId: "request",
      status: "previewed",
      code: "EXECUTION_TARGET_PREVIEWED",
      message: "x",
      action: "approve-and-apply",
      proposal: { ...proposal(), previewDiff: "raw diff" },
    })).toThrow();
  });

  it("requires correlated honest terminal outcomes", () => {
    const catalogs = {
      executionRouteCatalog: { routes: [], revision },
      availableModels: { observedAt: "2026-08-13T18:00:00.000Z", entries: [] },
    };
    expect(ExecutionTargetWizardResultSchema.parse({
      type: "execution_target_wizard_result",
      requestId: "request",
      status: "created",
      code: "EXECUTION_TARGET_CREATED",
      message: "Execution target created.",
      action: "none",
      revision,
      proposal: proposal({ approvalStatus: "approved" }),
      ...catalogs,
    })).toBeTruthy();
    expect(ExecutionTargetWizardResultSchema.parse({
      type: "execution_target_wizard_result",
      requestId: "request",
      status: "committed-refresh-failed",
      code: "EXECUTION_TARGET_COMMITTED_REFRESH_FAILED",
      message: "Execution target was committed; refresh is required.",
      revision,
      proposal: proposal({ approvalStatus: "approved" }),
      action: "refresh-catalog",
    })).toBeTruthy();
    expect(ExecutionTargetWizardResultSchema.parse({
      type: "execution_target_wizard_result",
      requestId: "request",
      status: "rejected",
      code: "TARGET_REVISION_CONFLICT",
      message: "The current configuration changed. Refresh and retry.",
      action: "refresh-and-retry",
    })).toBeTruthy();
  });
});

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: "cfg_proposal",
    operation: "target.create",
    scope: "global",
    status: "valid",
    baseRevision: revision,
    authorityImpact: "expands-write",
    approvalRequired: true,
    approvalStatus: "required",
    activation: "next-session",
    owners: ["execution-routing", "execution-target-evidence"],
    reconciliationTargets: ["execution-routes"],
    diagnostics: [],
    rollback: { restorable: true, summary: "The previous configuration can be restored." },
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
    ...overrides,
  };
}
