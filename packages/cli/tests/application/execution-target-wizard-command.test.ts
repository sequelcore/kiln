import { describe, expect, it, vi } from "vitest";
import type { ExecutionTargetWizardRequest, ExecutionTargetWizardResult } from "@kilnai/gateway-contracts";
import { runExecutionTargetWizardCommand } from "../../src/application/execution-target-wizard-command.js";

describe("runExecutionTargetWizardCommand", () => {
  it("parses guided intent and never accepts raw material", async () => {
    const create = vi.fn(async (request: ExecutionTargetWizardRequest): Promise<ExecutionTargetWizardResult> => result(request.requestId));
    const request = guidedRequest();
    await expect(runExecutionTargetWizardCommand({ request, create })).resolves.toMatchObject({
      status: "previewed",
      requestId: request.requestId,
    });
    expect(create).toHaveBeenCalledWith(request);
    await expect(runExecutionTargetWizardCommand({
      request: { ...request, material: { routeId: "operator-authored" } },
      create,
    })).rejects.toThrow();
  });

  it("does not parse a source file or JSON stdin", async () => {
    const create = vi.fn();
    await expect(runExecutionTargetWizardCommand({ source: JSON.stringify(guidedRequest()), create } as unknown as Parameters<typeof runExecutionTargetWizardCommand>[0])).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

function guidedRequest(): ExecutionTargetWizardRequest {
  return {
    requestId: "wizard-request",
    action: "preview",
    expectedRevision: `sha256:${"a".repeat(64)}`,
    discoveryIdentity: {
      providerId: "openai",
      providerRouteId: "openai:direct",
      providerModelId: "gpt-4o",
    },
    dataClassification: "public",
    dataPolicyConfirmed: true,
  };
}

function result(requestId: string): ExecutionTargetWizardResult {
  return {
    type: "execution_target_wizard_result",
    requestId,
    status: "previewed",
    code: "EXECUTION_TARGET_PREVIEWED",
    action: "approve-and-apply",
    message: "Execution target proposal is ready for approval.",
    proposal: {
      proposalId: "cfg_proposal",
      operation: "target.create",
      scope: "global",
      status: "valid",
      baseRevision: `sha256:${"a".repeat(64)}`,
      authorityImpact: "expands-write",
      approvalRequired: true,
      approvalStatus: "required",
      activation: "next-session",
      owners: ["execution-routing"],
      reconciliationTargets: ["execution-targets"],
      diagnostics: [],
      rollback: { restorable: true, summary: "The proposal can be restored." },
      target: {
        targetId: "target-openai-gpt-4o",
        label: "openai/gpt-4o",
        providerId: "openai",
        providerModelId: "gpt-4o",
        accountPolicyId: "fixture-account-policy",
        eligibleAccountCount: 1,
        dataClassification: "public",
        billingClass: "metered",
        capabilityPosture: "text-only",
        discoveryExpiresAt: "2027-01-01T00:00:00.000Z",
        evidenceExpiresAt: "2027-01-01T00:00:00.000Z",
      },
    },
  };
}
