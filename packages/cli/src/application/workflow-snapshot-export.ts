import { createHash } from "node:crypto";

import type { ResolvedKilnConfig } from "../kiln-yaml-types.js";
import type { KilnInstructionProfileDefinition } from "./instruction-profile-loader.js";
import type { ProjectContextEvidence } from "./project-context.js";
import {
  evidenceMatrixForWorkflowProfile,
  verificationGatesForWorkflowProfile,
  WORK_GOVERNANCE_WORKFLOW_PROFILES,
} from "./work-governance-workflows.js";

const WORKFLOW_SNAPSHOT_EXPORT_VERSION = "2";
const WORKFLOW_SNAPSHOT_EXPORT_GENERATOR = "workflow-snapshot-export-v2";

export interface WorkflowSnapshotExportInput {
  readonly generatedAt: string;
  readonly generatedFiles: readonly string[];
  readonly projectContext: ProjectContextEvidence;
  readonly instructionProfiles: readonly KilnInstructionProfileDefinition[];
  readonly kilnConfig: ResolvedKilnConfig | null;
}

export interface WorkflowSnapshotExport {
  readonly manifest: WorkflowSnapshotManifest;
  readonly specification: WorkflowSnapshotSpecification;
  readonly plan: WorkflowSnapshotPlan;
  readonly workItems: readonly WorkflowSnapshotWorkItemProfile[];
  readonly instructionProfiles: readonly WorkflowSnapshotInstructionProfile[];
  readonly authorityPosture: WorkflowSnapshotAuthorityPosture;
  readonly modelPolicyGuidance: WorkflowSnapshotModelPolicyGuidance;
}

export interface WorkflowSnapshotManifest {
  readonly version: "2";
  readonly generator: "workflow-snapshot-export-v2";
  readonly generatedAt: string;
  readonly hash: string;
  readonly sourceIds: readonly string[];
  readonly generatedFiles: readonly string[];
}

export interface WorkflowSnapshotSpecification {
  readonly projectName: string;
  readonly packageManager: string | null;
  readonly workspacePackages: readonly string[];
  readonly commands: readonly WorkflowSnapshotCommand[];
  readonly canonicalDocs: readonly string[];
}

export interface WorkflowSnapshotCommand {
  readonly name: string;
  readonly command: string;
}

export interface WorkflowSnapshotPlan {
  readonly defaultPosture: string | null;
  readonly orchestrationTriggers: readonly string[];
  readonly evidenceBeforeDone: readonly string[];
}

export interface WorkflowSnapshotWorkItemProfile {
  readonly id: string;
  readonly description: string;
  readonly minimumRisk: string;
  readonly recommendedTaskAffinities: readonly string[];
  readonly defaultAccess: string;
  readonly requiredEvidence: readonly string[];
  readonly verificationGates: readonly string[];
  readonly evidenceMatrix: readonly WorkflowSnapshotEvidenceMatrixEntry[];
}

export interface WorkflowSnapshotEvidenceMatrixEntry {
  readonly evidence: string;
  readonly verificationGates: readonly string[];
}

export interface WorkflowSnapshotInstructionProfile {
  readonly id: string;
  readonly scope: string;
  readonly sourcePath: string;
  readonly doctrineFacets: readonly string[];
}

export interface WorkflowSnapshotAuthorityPosture {
  readonly defaultPosture: string | null;
  readonly requireDelegationFor: readonly string[];
  readonly requiredEvidence: readonly string[];
}

export interface WorkflowSnapshotModelPolicyGuidance {
  readonly defaultProvider: string | null;
  readonly defaultModel: string | null;
  readonly maxDepth: number | null;
  readonly parallelWorkers: number | null;
  readonly taskSuitabilityOverrideCount: number;
}

export function buildWorkflowSnapshotExport(input: WorkflowSnapshotExportInput): WorkflowSnapshotExport {
  const payload = {
    specification: buildSpecification(input.projectContext),
    plan: buildPlan(input.kilnConfig),
    workItems: buildWorkItemProfiles(),
    instructionProfiles: buildInstructionProfiles(input.instructionProfiles),
    authorityPosture: buildAuthorityPosture(input.kilnConfig),
    modelPolicyGuidance: buildModelPolicyGuidance(input.kilnConfig),
  };
  const manifestPayload = {
    ...payload,
    sourceIds: buildSourceIds(input),
    generatedFiles: sortText(input.generatedFiles),
  };

  return {
    manifest: {
      version: WORKFLOW_SNAPSHOT_EXPORT_VERSION,
      generator: WORKFLOW_SNAPSHOT_EXPORT_GENERATOR,
      generatedAt: input.generatedAt,
      hash: `sha256:${hashJson(manifestPayload)}`,
      sourceIds: manifestPayload.sourceIds,
      generatedFiles: manifestPayload.generatedFiles,
    },
    ...payload,
  };
}

function buildSpecification(projectContext: ProjectContextEvidence): WorkflowSnapshotSpecification {
  return {
    projectName: projectContext.projectName,
    packageManager: projectContext.packageManager,
    workspacePackages: sortText(projectContext.workspacePackages),
    commands: projectContext.scripts
      .map(([name, command]) => ({ name, command }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    canonicalDocs: sortText(projectContext.docs),
  };
}

function buildPlan(kilnConfig: ResolvedKilnConfig | null): WorkflowSnapshotPlan {
  const workGovernance = kilnConfig?.workGovernance;
  return {
    defaultPosture: workGovernance?.defaultPosture ?? null,
    orchestrationTriggers: sortText(workGovernance?.requireDelegationFor ?? []),
    evidenceBeforeDone: [...(workGovernance?.requiredEvidence ?? [])],
  };
}

function buildWorkItemProfiles(): readonly WorkflowSnapshotWorkItemProfile[] {
  return WORK_GOVERNANCE_WORKFLOW_PROFILES.map((profile) => ({
    id: profile.id,
    description: profile.description,
    minimumRisk: profile.minimumRisk,
    recommendedTaskAffinities: [...profile.recommendedTaskAffinities],
    defaultAccess: profile.defaultAccess,
    requiredEvidence: [...profile.requiredEvidence],
    verificationGates: [...verificationGatesForWorkflowProfile(profile)],
    evidenceMatrix: evidenceMatrixForWorkflowProfile(profile).map((entry) => ({
      evidence: entry.evidence,
      verificationGates: [...entry.verificationGates],
    })),
  }));
}

function buildInstructionProfiles(
  profiles: readonly KilnInstructionProfileDefinition[],
): readonly WorkflowSnapshotInstructionProfile[] {
  return [...profiles]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((profile) => ({
      id: profile.name,
      scope: profile.scope,
      sourcePath: profile.filePath.replace(/\\/g, "/"),
      doctrineFacets: doctrineFacets(profile),
    }));
}

function buildAuthorityPosture(kilnConfig: ResolvedKilnConfig | null): WorkflowSnapshotAuthorityPosture {
  const workGovernance = kilnConfig?.workGovernance;
  return {
    defaultPosture: workGovernance?.defaultPosture ?? null,
    requireDelegationFor: sortText(workGovernance?.requireDelegationFor ?? []),
    requiredEvidence: [...(workGovernance?.requiredEvidence ?? [])],
  };
}

function buildModelPolicyGuidance(kilnConfig: ResolvedKilnConfig | null): WorkflowSnapshotModelPolicyGuidance {
  return {
    defaultProvider: kilnConfig?.provider ?? null,
    defaultModel: kilnConfig?.model?.default ?? null,
    maxDepth: kilnConfig?.maxDepth ?? null,
    parallelWorkers: kilnConfig?.parallelWorkers ?? null,
    taskSuitabilityOverrideCount: kilnConfig?.modelTaskSuitability?.length ?? 0,
  };
}

function buildSourceIds(input: WorkflowSnapshotExportInput): readonly string[] {
  const sourceIds = [
    `project-context:${input.projectContext.projectName}`,
    ...input.instructionProfiles
      .map((profile) => `instruction-profile:${profile.name}`)
      .sort((left, right) => left.localeCompare(right)),
    input.kilnConfig?.workGovernance ? "work-governance:resolved-kiln-config" : undefined,
    input.kilnConfig ? "model-policy:resolved-kiln-config" : undefined,
    "workflow-profiles:static",
  ].filter((sourceId): sourceId is string => sourceId !== undefined);

  return sourceIds;
}

function doctrineFacets(profile: KilnInstructionProfileDefinition): readonly string[] {
  const doctrine = profile.doctrine;
  if (!doctrine) {
    return [];
  }
  return [
    doctrine.principles && doctrine.principles.length > 0 ? "principles" : undefined,
    doctrine.workflow && doctrine.workflow.length > 0 ? "workflow" : undefined,
    doctrine.qualityGates && doctrine.qualityGates.length > 0 ? "quality-gates" : undefined,
    doctrine.reviewPosture && doctrine.reviewPosture.length > 0 ? "review-posture" : undefined,
    doctrine.delegation && doctrine.delegation.length > 0 ? "delegation" : undefined,
    doctrine.executionDiscipline && doctrine.executionDiscipline.length > 0
      ? "execution-discipline"
      : undefined,
  ].filter((facet): facet is string => facet !== undefined);
}

function sortText(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
