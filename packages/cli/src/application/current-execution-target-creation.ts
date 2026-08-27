import type {
  ExecutionTargetWizardRequest,
  ExecutionTargetWizardResult,
  KilnConfigApprovalSurface,
} from "@kilnai/gateway-contracts";
import type {
  ExecutionTargetWizardCurrentEvidence,
  ExecutionTargetWizardDiscoveryEvidence,
} from "./execution-target-wizard-admission.js";
import type { ExecutionTargetEvidenceRevision } from "../config/execution-target-evidence-store.js";
import {
  admitExecutionTargetWizardRequest,
  ExecutionTargetWizardAdmissionError,
} from "./execution-target-wizard-admission.js";
import { createExecutionTarget } from "./execution-target-creation.js";

export interface ExecutionTargetWizardCommitResult {
  readonly status: "created" | "committed-refresh-failed";
  readonly revision: ExecutionTargetEvidenceRevision;
}

export async function createCurrentExecutionTarget(input: {
  readonly request: ExecutionTargetWizardRequest;
  readonly admittedEvidence: ExecutionTargetWizardDiscoveryEvidence;
  readonly projectPath: string;
  readonly approvalSurface: KilnConfigApprovalSurface;
  readonly resolveCurrentEvidence: () => Promise<ExecutionTargetWizardCurrentEvidence>;
  readonly commit?: (input: {
    readonly draft: import("./execution-target-draft.js").CompleteExecutionTargetDraft;
    readonly expectedRevision: string;
    readonly currentIntent: import("../config/execution-target-evidence-store.js").ExecutionTargetCatalogIntent;
    readonly currentEvidence: import("../config/execution-target-evidence-store.js").ExecutionTargetEvidenceSnapshot;
    readonly projectPath: string;
    readonly approvalSurface: KilnConfigApprovalSurface;
    readonly operatorApproved: boolean;
  }) => Promise<ExecutionTargetWizardCommitResult>;
}): Promise<ExecutionTargetWizardResult> {
  try {
    const initial = await input.resolveCurrentEvidence();
    const admitted = admitExecutionTargetWizardRequest({
      request: input.request,
      admittedEvidence: input.admittedEvidence,
      current: initial,
    });
    if (input.request.action === "preview") {
      return {
        type: "execution_target_wizard_result",
        requestId: input.request.requestId,
        status: "previewed",
        code: "EXECUTION_TARGET_PREVIEWED",
        action: "approve-and-apply",
        message: "Execution target proposal is ready for approval.",
        proposal: admitted.proposal,
      };
    }

    const current = await input.resolveCurrentEvidence();
    const revalidated = admitExecutionTargetWizardRequest({
      request: input.request,
      admittedEvidence: input.admittedEvidence,
      current,
    });
    if (revalidated.proposal.proposalId !== input.request.proposalId) {
      return rejectedResult(input.request.requestId, "TARGET_REVISION_CONFLICT", "refresh-and-retry", "The preview no longer matches current evidence.");
    }
    const commit = await (input.commit ?? (async (commitInput) => {
      const committed = await createExecutionTarget(commitInput);
      return {
        status: committed.status,
        revision: parseExecutionTargetWizardRevision(committed.revision),
      };
    }))({
      draft: revalidated.draft,
      expectedRevision: current.revision,
      currentIntent: current.targetIntent,
      currentEvidence: current.targetEvidence,
      projectPath: input.projectPath,
      approvalSurface: input.approvalSurface,
      operatorApproved: true,
    });
    if (commit.status === "committed-refresh-failed") {
      return {
        type: "execution_target_wizard_result",
        requestId: input.request.requestId,
        status: "committed-refresh-failed",
        code: "EXECUTION_TARGET_COMMITTED_REFRESH_FAILED",
        action: "refresh-catalog",
        message: "Execution target was committed, but refreshed route evidence is unavailable.",
        revision: commit.revision,
        proposal: revalidated.proposal,
      };
    }
    let refreshed: ExecutionTargetWizardCurrentEvidence;
    try {
      refreshed = await input.resolveCurrentEvidence();
    } catch {
      return {
        type: "execution_target_wizard_result",
        requestId: input.request.requestId,
        status: "committed-refresh-failed",
        code: "EXECUTION_TARGET_COMMITTED_REFRESH_FAILED",
        action: "refresh-catalog",
        message: "Execution target was committed, but refreshed route evidence is unavailable.",
        revision: commit.revision,
        proposal: revalidated.proposal,
      };
    }
    return {
      type: "execution_target_wizard_result",
      requestId: input.request.requestId,
      status: "created",
      code: "EXECUTION_TARGET_CREATED",
      action: "none",
      message: "Execution target created.",
      revision: commit.revision,
      proposal: revalidated.proposal,
      modelCatalog: refreshed.catalog,
    };
  } catch (error) {
    if (error instanceof ExecutionTargetWizardAdmissionError) {
      return rejectedResult(input.request.requestId, error.code, error.action === "approve-and-apply" ? "refresh-and-retry" : error.action, error.message);
    }
    return rejectedResult(input.request.requestId, "TARGET_CREATE_REJECTED", "refresh-and-retry", "Execution target creation was rejected; refresh and try again.");
  }
}

function rejectedResult(
  requestId: string,
  code: Exclude<ExecutionTargetWizardResult, { status: "created" | "previewed" | "committed-refresh-failed" }>["code"],
  action: Exclude<ExecutionTargetWizardResult, { status: "created" | "previewed" | "committed-refresh-failed" }>["action"],
  message: string,
): ExecutionTargetWizardResult {
  return {
    type: "execution_target_wizard_result",
    requestId,
    status: "rejected",
    code,
    action,
    message: sanitizeMessage(message),
  };
}

function sanitizeMessage(message: string): string {
  return message.replace(/(?:[A-Za-z]:)?[\\/][^\s;]+/gu, "the affected configuration").slice(0, 512);
}

export function parseExecutionTargetWizardRevision(value: string): ExecutionTargetEvidenceRevision {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error("The committed execution-target revision is invalid.");
  }
  return value as ExecutionTargetEvidenceRevision;
}
