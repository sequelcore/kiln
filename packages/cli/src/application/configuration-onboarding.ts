import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  KilnConfigurationOnboardingApplyRequestSchema,
  KilnConfigurationOnboardingResultSchema,
  KilnConfigurationOnboardingSnapshotSchema,
  type KilnConfigApprovalSurface,
  type KilnConfigurationOnboardingApplyRequest,
  type KilnConfigurationOnboardingBlocker,
  type KilnConfigurationOnboardingMutationSummary,
  type KilnConfigurationOnboardingResult,
  type KilnConfigurationOnboardingSnapshot,
} from "@kilnai/gateway-contracts";
import {
  readGlobalConfig as readDefaultGlobalConfig,
  readGlobalExecutionTargetAuthority,
  resolveGlobalConfigPath,
  type KilnGlobalConfig,
} from "../config/global-config.js";
import { deriveEffectiveKilnYaml } from "../config/config-merger.js";
import { readKilnYaml, type KilnProjectConfig } from "../kiln-yaml.js";
import {
  applyConfigMutation,
  approveConfigMutation,
  proposeConfigMutation,
  type ApplyConfigMutationInput,
  type ProposeConfigMutationInput,
} from "./config-mutation-authority.js";
import {
  ConfigMutationStore,
  type InterruptedConfigMutation,
  type ConfigMutationProposalRecord,
  type StoredConfigMutationSettlement,
} from "./config-mutation-store.js";

type OnboardingPosture = KilnConfigurationOnboardingApplyRequest["posture"];

export interface ConfigurationOnboardingProjectState {
  readonly exists: boolean;
  readonly config?: KilnProjectConfig;
  readonly error?: unknown;
}

export interface ConfigurationOnboardingDependencies {
  /** Reads the validated global V4 configuration. */
  readonly readGlobalConfig?: () => KilnGlobalConfig | null;
  /** Verifies that the global catalog's referenced evidence is current and projectable. */
  readonly readTargetAuthority?: (config: KilnGlobalConfig, globalConfigPath: string) => unknown;
  /** Reads project state without exposing its path in the wire result. */
  readonly readProjectConfig?: (projectPath: string) => ConfigurationOnboardingProjectState;
  readonly proposeMutation?: (input: ProposeConfigMutationInput) => ConfigMutationProposalRecord;
  readonly approveMutation?: typeof approveConfigMutation;
  readonly applyMutation?: (input: ApplyConfigMutationInput) => ReturnType<typeof applyConfigMutation>;
  readonly saveProposal?: (projectPath: string, record: ConfigMutationProposalRecord) => void;
  readonly readLatestSettlement?: (
    projectPath: string,
    operation: ProposeConfigMutationInput["operation"],
  ) => StoredConfigMutationSettlement | null;
  readonly hasActiveMutation?: (
    projectPath: string,
    operation: ProposeConfigMutationInput["operation"],
  ) => boolean;
  readonly readInterruptedMutation?: (
    projectPath: string,
    operation: ProposeConfigMutationInput["operation"],
  ) => InterruptedConfigMutation | null;
}

export interface ReadConfigurationOnboardingInput {
  readonly projectPath: string;
  readonly posture?: OnboardingPosture;
  readonly globalConfigPath?: string;
  readonly dependencies?: ConfigurationOnboardingDependencies;
}

export interface ApplyConfigurationOnboardingInput {
  readonly projectPath: string;
  readonly request: unknown;
  readonly globalConfigPath?: string;
  /** Approves each authority-expanding operation created by this call. */
  readonly approve?: boolean;
  readonly approvedBy?: string;
  readonly approvalSurface?: KilnConfigApprovalSurface;
  readonly dependencies?: ConfigurationOnboardingDependencies;
}

const defaultDependencies: Required<Pick<
  ConfigurationOnboardingDependencies,
  "readGlobalConfig" | "readTargetAuthority" | "readProjectConfig" | "proposeMutation" | "approveMutation" | "applyMutation" | "saveProposal" | "readLatestSettlement" | "hasActiveMutation" | "readInterruptedMutation"
>> = {
  readGlobalConfig: readDefaultGlobalConfig,
  readTargetAuthority: (config, globalConfigPath) => readGlobalExecutionTargetAuthority(config, { globalConfigPath }),
  readProjectConfig: readProjectConfigState,
  proposeMutation: proposeConfigMutation,
  approveMutation: approveConfigMutation,
  applyMutation: applyConfigMutation,
  saveProposal: (projectPath, record) => new ConfigMutationStore(projectPath).saveProposal(record),
  readLatestSettlement: (projectPath, operation) => new ConfigMutationStore(projectPath).readLatestSettlement(operation),
  hasActiveMutation: (projectPath, operation) => new ConfigMutationStore(projectPath).hasActiveProgress(operation),
  readInterruptedMutation: (projectPath, operation) => new ConfigMutationStore(projectPath).readInterruptedMutation(operation),
};
type ConfigurationOnboardingPorts = typeof defaultDependencies;

/**
 * Builds the shared first-run read model. A project is ready only against an
 * already-admitted direct target in the current global V4 catalog; this
 * function never discovers providers or manufactures target evidence.
 */
export function readConfigurationOnboarding(
  input: ReadConfigurationOnboardingInput,
): KilnConfigurationOnboardingSnapshot {
  const dependencies = mergeDependencies(input.dependencies);
  const globalConfigPath = input.globalConfigPath ?? resolveGlobalConfigPath();
  const blockers: KilnConfigurationOnboardingBlocker[] = [];
  let globalConfig: KilnGlobalConfig | null = null;

  try {
    globalConfig = dependencies.readGlobalConfig();
  } catch {
    blockers.push({ code: "global-config-invalid", message: "Global configuration is invalid and must be re-adopted." });
  }
  if (globalConfig === null && blockers.length === 0) {
    blockers.push({ code: "global-config-unavailable", message: "Adopt global configuration before onboarding a project." });
  }

  const projectState = dependencies.readProjectConfig(input.projectPath);
  if (projectState.error !== undefined) {
    blockers.push({ code: "project-config-invalid", message: "Project configuration is not structurally admitted." });
  }
  if (globalConfig && projectState.config && projectState.error === undefined) {
    try {
      deriveEffectiveKilnYaml(globalConfig, projectState.config);
    } catch {
      blockers.push({ code: "project-config-invalid", message: "Project configuration is not admitted against current global policy." });
    }
  }

  let projectReconciliationPending = false;
  let targetReconciliationPending = false;
  try {
    projectReconciliationPending = reconciliationPending(input.projectPath, "project.adopt", dependencies);
    targetReconciliationPending = reconciliationPending(input.projectPath, "target.select", dependencies);
  } catch {
    blockers.push({ code: "project-config-invalid", message: "Configuration mutation evidence is not structurally admitted." });
  }

  const directTargets = globalConfig?.targetCatalog?.targets.filter((target) => target.kind === "direct") ?? [];
  if (globalConfig && directTargets.length === 0) {
    blockers.push({ code: "target-unavailable", message: "Connect and admit a direct target before onboarding this project." });
  } else if (globalConfig && globalConfig.targetCatalog) {
    try {
      const authority = dependencies.readTargetAuthority(globalConfig, globalConfigPath);
      if (authority === undefined || authority === null || authority === false) {
        blockers.push({ code: "target-unavailable", message: "No current admitted direct target evidence is available." });
      }
    } catch {
      blockers.push({ code: "target-unavailable", message: "No current admitted direct target evidence is available." });
    }
  }

  const configuredDefault = globalConfig?.targetRouting?.defaultTargetId;
  const directTargetIds = new Set(directTargets.map((target) => target.id));
  if (configuredDefault !== undefined && !directTargetIds.has(configuredDefault)) {
    blockers.push({ code: "target-not-admitted", message: "The configured default target is not an admitted direct target." });
  }

  const projectPosture = projectState.config?.permissions?.sandbox;
  const projectApproval = projectState.config?.permissions?.approval;
  const effectivePosture: OnboardingPosture = input.posture ?? "read-only";
  if (projectPosture === "danger-full-access") {
    blockers.push({ code: "permission-posture-unavailable", message: "Project permission posture is not admitted for onboarding." });
  }

  const targets = directTargets.map((target) => ({
    id: target.id,
    label: target.label,
    providerId: target.providerId,
    providerModelId: target.providerModelId,
    selected: target.id === configuredDefault,
  }));
  const defaultTargetId = configuredDefault && directTargetIds.has(configuredDefault) ? configuredDefault : null;
  const status = blockers.length > 0
    ? "blocked"
    : projectState.exists
      && projectState.config
      && projectPosture === "read-only"
      && isSafeApproval(projectApproval)
      && defaultTargetId !== null
      && !projectReconciliationPending
      && !targetReconciliationPending
      ? "complete"
      : "ready";
  const nextAction = blockers.length > 0
    ? nextActionForBlocker(blockers[0]!)
    : status === "complete"
      ? "Start the first turn."
      : projectReconciliationPending || targetReconciliationPending
        ? "Retry onboarding to reconcile the committed configuration before the first turn."
      : defaultTargetId === null
        ? "Select an admitted direct target and apply onboarding."
        : "Apply onboarding to this project.";

  return KilnConfigurationOnboardingSnapshotSchema.parse({
    schemaVersion: 1,
    status,
    scope: "project",
    posture: effectivePosture,
    targets,
    defaultTargetId,
    blockers,
    nextAction,
  });
}

/** Applies one project adoption and, when necessary, one existing target selection. */
export async function applyConfigurationOnboarding(
  input: ApplyConfigurationOnboardingInput,
): Promise<KilnConfigurationOnboardingResult> {
  const dependencies = mergeDependencies(input.dependencies);
  let request: KilnConfigurationOnboardingApplyRequest;
  try {
    request = KilnConfigurationOnboardingApplyRequestSchema.parse(input.request);
  } catch {
    return onboardingResult("rejected", null, null, [{
      code: "mutation-rejected",
      message: "Onboarding request is not admitted by the shared contract.",
    }], "Correct the onboarding request and retry.");
  }

  const snapshot = readConfigurationOnboarding({
    projectPath: input.projectPath,
    posture: request.posture,
    globalConfigPath: input.globalConfigPath,
    dependencies,
  });
  if (snapshot.status === "blocked") {
    return onboardingResult("blocked", null, null, snapshot.blockers, snapshot.nextAction);
  }

  const selectedTargetId = request.targetId ?? snapshot.defaultTargetId;
  if (selectedTargetId === null || !snapshot.targets.some((target) => target.id === selectedTargetId)) {
    return onboardingResult("blocked", null, null, [{
      code: "target-not-admitted",
      message: "Choose one of the currently admitted direct targets.",
    }], "Select an admitted direct target and retry onboarding.");
  }

  if (snapshot.defaultTargetId !== selectedTargetId && input.approve !== true) {
    return onboardingResult(
      "rejected",
      null,
      null,
      [],
      "Repeat onboarding with explicit approval for target selection.",
    );
  }

  const projectState = dependencies.readProjectConfig(input.projectPath);
  const projectReconciliationPending = reconciliationPending(input.projectPath, "project.adopt", dependencies);
  const targetReconciliationPending = reconciliationPending(input.projectPath, "target.select", dependencies);
  let projectSummary: KilnConfigurationOnboardingMutationSummary | null = null;
  const projectAlreadySafe = projectState.config?.permissions?.sandbox === "read-only"
    && isSafeApproval(projectState.config.permissions.approval)
    && !projectReconciliationPending;
  if (!projectAlreadySafe) {
    projectSummary = await runMutation({
      input,
      dependencies,
      operation: "project.adopt",
      payload: { scope: "project", posture: request.posture },
    });
    if (projectSummary.outcome === "rejected") {
      return onboardingResult("rejected", projectSummary, null, [], "Resolve the project adoption diagnostics and retry.");
    }
  }

  let targetSummary: KilnConfigurationOnboardingMutationSummary | null = null;
  if (snapshot.defaultTargetId !== selectedTargetId || targetReconciliationPending) {
    targetSummary = await runMutation({
      input,
      dependencies,
      operation: "target.select",
      payload: { targetId: selectedTargetId },
    });
  }

  if (targetSummary?.outcome === "rejected") {
    return onboardingResult(
      projectSummary?.outcome === "committed" || projectSummary?.outcome === "committed-reconciliation-failed" ? "partial" : "rejected",
      projectSummary,
      targetSummary,
      [],
      "Repeat onboarding with explicit approval for target selection.",
    );
  }
  if (projectSummary?.outcome === "committed-reconciliation-failed" || targetSummary?.outcome === "committed-reconciliation-failed") {
    return onboardingResult("partial", projectSummary, targetSummary, [], "Reconciliation needs attention before the first turn.");
  }
  return onboardingResult("committed", projectSummary, targetSummary, [], "Start the first turn.");
}

async function runMutation(input: {
  readonly input: ApplyConfigurationOnboardingInput;
  readonly dependencies: ConfigurationOnboardingPorts;
  readonly operation: ProposeConfigMutationInput["operation"];
  readonly payload: unknown;
}): Promise<KilnConfigurationOnboardingMutationSummary> {
  const globalConfigPath = input.input.globalConfigPath ?? resolveGlobalConfigPath();
  const interrupted = input.dependencies.readInterruptedMutation(input.input.projectPath, input.operation);
  if (interrupted !== null) {
    const result = await input.dependencies.applyMutation({
      projectPath: input.input.projectPath,
      proposalId: interrupted.record.proposal.proposalId,
      ...(interrupted.approvalId === undefined ? {} : { approvalId: interrupted.approvalId }),
      requester: "operator",
      globalConfigPath,
      readEffectiveState: async () => undefined,
    });
    return mutationSummary(result.settlement.outcome, result.replayed, result.settlement.diagnostics);
  }
  const record = input.dependencies.proposeMutation({
    projectPath: input.input.projectPath,
    operation: input.operation,
    payload: input.payload,
    globalConfigPath,
  });
  if (record.proposal.status !== "valid") {
    return mutationSummary("rejected", false, record.proposal.diagnostics);
  }
  input.dependencies.saveProposal(input.input.projectPath, record);

  let approvalId: string | undefined;
  if (input.input.approve === true && record.proposal.approvalRequired) {
    approvalId = input.dependencies.approveMutation({
      projectPath: input.input.projectPath,
      proposalId: record.proposal.proposalId,
      approvedBy: input.input.approvedBy,
      surface: input.input.approvalSurface ?? "cli",
    }).approvalId;
  }
  const result = await input.dependencies.applyMutation({
    projectPath: input.input.projectPath,
    proposalId: record.proposal.proposalId,
    ...(approvalId === undefined ? {} : { approvalId }),
    requester: "operator",
    globalConfigPath,
    readEffectiveState: async () => undefined,
  });
  return mutationSummary(result.settlement.outcome, result.replayed, result.settlement.diagnostics);
}

function mergeDependencies(input: ConfigurationOnboardingDependencies = {}): ConfigurationOnboardingPorts {
  return { ...defaultDependencies, ...input };
}

function reconciliationPending(
  projectPath: string,
  operation: ProposeConfigMutationInput["operation"],
  dependencies: ConfigurationOnboardingPorts,
): boolean {
  return dependencies.hasActiveMutation(projectPath, operation)
    || dependencies.readLatestSettlement(projectPath, operation)?.outcome === "committed-reconciliation-failed";
}

function readProjectConfigState(projectPath: string): ConfigurationOnboardingProjectState {
  const kilnPath = join(projectPath, ".kiln", "kiln.yaml");
  if (!existsSync(kilnPath)) return { exists: false };
  try {
    return { exists: true, config: readKilnYaml(join(projectPath, ".kiln")) ?? undefined };
  } catch (error) {
    // Do not return parser text: it can contain an operator path or another
    // value that is not part of the onboarding wire contract.
    return { exists: true, error };
  }
}

function mutationSummary(
  outcome: KilnConfigurationOnboardingMutationSummary["outcome"],
  replayed: boolean,
  diagnostics: readonly { readonly severity: "error" | "warning"; readonly field: string; readonly message: string }[],
): KilnConfigurationOnboardingMutationSummary {
  return {
    outcome,
    replayed,
    diagnostics: diagnostics.map((entry) => ({
      severity: entry.severity,
      field: safeDiagnosticField(entry.field),
      message: safeDiagnosticMessage(entry.message),
    })),
  };
}

function onboardingResult(
  status: KilnConfigurationOnboardingResult["status"],
  projectAdoption: KilnConfigurationOnboardingMutationSummary | null,
  targetSelection: KilnConfigurationOnboardingMutationSummary | null,
  blockers: readonly KilnConfigurationOnboardingBlocker[],
  nextAction: string | null,
): KilnConfigurationOnboardingResult {
  return KilnConfigurationOnboardingResultSchema.parse({
    schemaVersion: 1,
    status,
    projectAdoption,
    targetSelection,
    blockers,
    nextAction,
  });
}

function nextActionForBlocker(blocker: KilnConfigurationOnboardingBlocker): string {
  switch (blocker.code) {
    case "global-config-unavailable":
    case "global-config-invalid":
    case "target-unavailable":
      return "Admit a current direct target, then retry onboarding.";
    case "target-not-admitted":
      return "Select an admitted direct target, then retry onboarding.";
    case "project-config-invalid":
      return "Review or replace the project configuration, then retry onboarding.";
    default:
      return "Resolve the onboarding blocker, then retry.";
  }
}

function safeDiagnosticField(field: string): string {
  return /[\\/]|^[A-Za-z]:/u.test(field) ? "configuration" : field.slice(0, 128);
}

function safeDiagnosticMessage(message: string): string {
  if (/secret|token|credential|api.?key/iu.test(message)) return "Configuration mutation was rejected.";
  if (/(?:\b[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|(?:^|[\s("'=])\/(?:[^\s/]+\/|[^\s]+))/u.test(message)) {
    return "Configuration mutation requires attention.";
  }
  return message
    .slice(0, 512);
}

function isSafeApproval(value: unknown): value is "on-request" | "on-failure" | "untrusted" {
  return value === "on-request" || value === "on-failure" || value === "untrusted";
}
