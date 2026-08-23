import {
  KilnSettingsApplyRequestSchema,
  KilnSettingsProposalRequestSchema,
  projectKilnSettingsMutationResult,
  projectKilnSettingsProposal,
  type KilnConfigApprovalSurface,
  type KilnConfigMutationApproval,
  type KilnSettingsApplyRequest,
  type KilnSettingsMutationResult,
  type KilnSettingsProposalProjection,
  type KilnSettingsProposalRequest,
  type KilnSettingsSnapshot,
} from "@kilnai/gateway-contracts";
import {
  applyConfigMutation,
  approveConfigMutation,
  proposeConfigMutation,
  type ConfigMutationRequester,
} from "./config-mutation-authority.js";
import { reconcileConfigMutation } from "./config-mutation-reconciliation.js";
import { ConfigMutationStore } from "./config-mutation-store.js";
import { readConfigStatusSnapshot } from "./config-status.js";
import {
  admitSettingsProposalRecord,
  readSettingsSnapshot,
  type ReadSettingsSnapshotOptions,
} from "./config-settings.js";

export interface ConfigSettingsApprovalRequest {
  readonly proposalId: string;
  readonly approvedBy: string;
  readonly surface: KilnConfigApprovalSurface;
}

export interface ConfigSettingsApplicationPort {
  read(options?: ReadSettingsSnapshotOptions): Promise<KilnSettingsSnapshot>;
  propose(request: KilnSettingsProposalRequest): KilnSettingsProposalProjection;
  approve(request: ConfigSettingsApprovalRequest): KilnConfigMutationApproval | undefined;
  apply(request: KilnSettingsApplyRequest, requester: ConfigMutationRequester): Promise<KilnSettingsMutationResult>;
}

export interface CreateConfigSettingsApplicationOptions {
  readonly projectPath: string;
  readonly reconcile?: typeof reconcileConfigMutation;
}

/**
 * One application port for transported settings surfaces. Adapters may present
 * or transport these contracts, but none may derive policy, approval,
 * activation, reconciliation, or rollback semantics. The trusted CLI command
 * renders richer previews directly from the same mutation authority.
 */
export function createConfigSettingsApplication(
  options: CreateConfigSettingsApplicationOptions,
): ConfigSettingsApplicationPort {
  const store = new ConfigMutationStore(options.projectPath);
  return {
    async read(readOptions = {}) {
      return readSettingsSnapshot(
        await readConfigStatusSnapshot({ projectPath: options.projectPath, view: "settings" }),
        readOptions,
      );
    },
    propose(rawRequest) {
      const request = KilnSettingsProposalRequestSchema.parse(rawRequest);
      const record = proposeConfigMutation({
        projectPath: options.projectPath,
        operation: request.operation,
        payload: request,
      });
      store.saveProposal(record);
      return projectKilnSettingsProposal(record.proposal);
    },
    approve(request) {
      const record = admitSettingsProposalRecord(store.readProposal(request.proposalId), request.proposalId);
      if (!record.proposal.approvalRequired) return undefined;
      return approveConfigMutation({
        projectPath: options.projectPath,
        proposalId: request.proposalId,
        approvedBy: request.approvedBy,
        surface: request.surface,
      });
    },
    async apply(rawRequest, requester) {
      const request = KilnSettingsApplyRequestSchema.parse(rawRequest);
      admitSettingsProposalRecord(store.readProposal(request.proposalId), request.proposalId);
      return projectKilnSettingsMutationResult(await applyConfigMutation({
        projectPath: options.projectPath,
        proposalId: request.proposalId,
        ...(request.approvalId ? { approvalId: request.approvalId } : {}),
        requester,
        ...(options.reconcile ? { reconcile: options.reconcile } : {}),
        readEffectiveState: async (projectPath) => (
          await readConfigStatusSnapshot({ projectPath, view: "effective" })
        ).effectiveConfig,
      }));
    },
  };
}
