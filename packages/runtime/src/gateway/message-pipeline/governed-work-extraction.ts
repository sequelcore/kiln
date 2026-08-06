// Extracted from the gateway message pipeline; behavior is intentionally unchanged.
import type {
  CanonicalPlanAnalysisFindingDraft,
  CanonicalPlanWorkItemDraft
} from "@kilnai/core";
import type {
  ToolExecutionSummary
} from "../../session/runtime-session-orchestrator.js";

export function extractPlanSubmissions(
  toolExecutions: readonly ToolExecutionSummary[] | undefined,
): readonly {
  readonly planId: string;
  readonly planHash: string;
  readonly mode: "plan";
  readonly objective: string;
  readonly nonGoals: readonly string[];
  readonly operatorDecisionsRequired: readonly string[];
  readonly assumptions: readonly string[];
  readonly affectedSurfaces: readonly string[];
  readonly riskClassification: "low" | "medium" | "high" | "critical";
  readonly workflowProfile: string;
  readonly workGovernancePosture: "direct" | "orchestrate" | "delegate";
  readonly workGovernanceRationale: string;
  readonly expectedEvidence: readonly string[];
  readonly verificationGates: readonly string[];
  readonly managedAgentDelegationCandidates: readonly string[];
  readonly approvalBoundaries: readonly string[];
  readonly rollbackNotes: string;
  readonly residualRisks: readonly string[];
  readonly sourceSpecificationId: string;
  readonly clarificationRecordIds: readonly string[];
  readonly constitutionSnapshotHash: string;
  readonly constitutionSnapshotIds: readonly string[];
  readonly proposedWorkItemCount: number;
  readonly proposedWorkItems: readonly CanonicalPlanWorkItemDraft[];
  readonly summary: string;
}[] {
  return (toolExecutions ?? [])
    .filter((execution) => execution.toolName === "submit_plan" && execution.success)
    .map((execution) => {
      const metadata = execution.metadata;
      const metadataPlanId = typeof metadata?.planId === "string" ? metadata.planId.trim() : "";
      const metadataPlanHash = typeof metadata?.planHash === "string" ? metadata.planHash.trim() : "";
      const metadataSummary = typeof metadata?.summary === "string" ? metadata.summary.trim() : "";
      const metadataWorkItemCount = typeof metadata?.proposedWorkItemCount === "number" ? metadata.proposedWorkItemCount : undefined;
      const objective = typeof metadata?.objective === "string"
        ? metadata.objective.trim()
        : (typeof execution.input?.objective === "string" ? execution.input.objective.trim() : "");
      const sourceSpecificationId = typeof metadata?.sourceSpecificationId === "string"
        ? metadata.sourceSpecificationId.trim()
        : (typeof execution.input?.sourceSpecificationId === "string"
          ? execution.input.sourceSpecificationId.trim()
          : "");
      const riskClassification = metadata?.riskClassification ?? execution.input?.riskClassification;
      const workflowProfile = typeof metadata?.workflowProfile === "string"
        ? metadata.workflowProfile.trim()
        : extractWorkflowProfile(execution.input?.workGovernanceRecommendation);
      const posture = metadata?.workGovernancePosture ?? extractWorkGovernancePosture(execution.input?.workGovernanceRecommendation);
      const workGovernanceRationale = typeof metadata?.workGovernanceRationale === "string"
        ? metadata.workGovernanceRationale.trim()
        : extractWorkGovernanceRationale(execution.input?.workGovernanceRecommendation);
      if (!objective || !sourceSpecificationId || !workflowProfile) return null;
      if (riskClassification !== "low" && riskClassification !== "medium" && riskClassification !== "high" && riskClassification !== "critical") {
        return null;
      }
      if (posture !== "direct" && posture !== "orchestrate" && posture !== "delegate") {
        return null;
      }
      const nonGoals = extractStringArray(metadata?.nonGoals).length > 0
        ? extractStringArray(metadata?.nonGoals)
        : extractStringArray(execution.input?.nonGoals);
      const operatorDecisionsRequired = extractStringArray(metadata?.operatorDecisionsRequired).length > 0
        ? extractStringArray(metadata?.operatorDecisionsRequired)
        : extractStringArray(execution.input?.operatorDecisionsRequired);
      const assumptions = extractStringArray(metadata?.assumptions).length > 0
        ? extractStringArray(metadata?.assumptions)
        : extractStringArray(execution.input?.assumptions);
      const affectedSurfaces = extractStringArray(metadata?.affectedSurfaces).length > 0
        ? extractStringArray(metadata?.affectedSurfaces)
        : extractStringArray(execution.input?.affectedSurfaces);
      const expectedEvidence = extractStringArray(metadata?.expectedEvidence).length > 0
        ? extractStringArray(metadata?.expectedEvidence)
        : extractStringArray(execution.input?.expectedEvidence);
      const verificationGates = extractStringArray(metadata?.verificationGates).length > 0
        ? extractStringArray(metadata?.verificationGates)
        : extractStringArray(execution.input?.verificationGates);
      const metadataWorkItems = extractPlanWorkItems(metadata?.proposedWorkItems);
      const proposedWorkItems = metadataWorkItems.length > 0
        ? metadataWorkItems
        : extractPlanWorkItems(execution.input?.proposedWorkItems);
      return {
        planId: metadataPlanId || execution.toolCallId || `plan:${execution.durationMs}`,
        planHash: metadataPlanHash,
        mode: "plan",
        objective,
        nonGoals,
        operatorDecisionsRequired,
        assumptions,
        affectedSurfaces,
        riskClassification,
        workflowProfile,
        workGovernancePosture: posture,
        workGovernanceRationale,
        expectedEvidence,
        verificationGates,
        managedAgentDelegationCandidates: extractStringArray(metadata?.managedAgentDelegationCandidates).length > 0
          ? extractStringArray(metadata?.managedAgentDelegationCandidates)
          : extractStringArray(execution.input?.managedAgentDelegationCandidates),
        approvalBoundaries: extractStringArray(metadata?.approvalBoundaries).length > 0
          ? extractStringArray(metadata?.approvalBoundaries)
          : extractStringArray(execution.input?.approvalBoundaries),
        rollbackNotes: typeof metadata?.rollbackNotes === "string"
          ? metadata.rollbackNotes.trim()
          : (typeof execution.input?.rollbackNotes === "string" ? execution.input.rollbackNotes.trim() : ""),
        residualRisks: extractStringArray(metadata?.residualRisks).length > 0
          ? extractStringArray(metadata?.residualRisks)
          : extractStringArray(execution.input?.residualRisks),
        sourceSpecificationId,
        clarificationRecordIds: extractStringArray(metadata?.clarificationRecordIds).length > 0
          ? extractStringArray(metadata?.clarificationRecordIds)
          : extractStringArray(execution.input?.clarificationRecordIds),
        constitutionSnapshotHash: typeof metadata?.constitutionSnapshotHash === "string"
          ? metadata.constitutionSnapshotHash.trim()
          : extractConstitutionSnapshotHash(execution.input?.constitutionSnapshot),
        constitutionSnapshotIds: extractStringArray(metadata?.constitutionSnapshotIds).length > 0
          ? extractStringArray(metadata?.constitutionSnapshotIds)
          : extractConstitutionSnapshotIds(execution.input?.constitutionSnapshot),
        proposedWorkItemCount: metadataWorkItemCount ?? proposedWorkItems.length,
        proposedWorkItems,
        summary: metadataSummary || [
          objective,
          nonGoals[0] ? `first non-goal: ${nonGoals[0]}` : undefined,
          expectedEvidence[0] ? `first evidence: ${expectedEvidence[0]}` : undefined,
        ].filter((part): part is string => part !== undefined).join(" · "),
      };
    })
    .filter((submission): submission is {
      readonly planId: string;
      readonly planHash: string;
      readonly mode: "plan";
      readonly objective: string;
      readonly nonGoals: readonly string[];
      readonly operatorDecisionsRequired: readonly string[];
      readonly assumptions: readonly string[];
      readonly affectedSurfaces: readonly string[];
      readonly riskClassification: "low" | "medium" | "high" | "critical";
      readonly workflowProfile: string;
      readonly workGovernancePosture: "direct" | "orchestrate" | "delegate";
      readonly workGovernanceRationale: string;
      readonly expectedEvidence: readonly string[];
      readonly verificationGates: readonly string[];
      readonly managedAgentDelegationCandidates: readonly string[];
      readonly approvalBoundaries: readonly string[];
      readonly rollbackNotes: string;
      readonly residualRisks: readonly string[];
      readonly sourceSpecificationId: string;
      readonly clarificationRecordIds: readonly string[];
      readonly constitutionSnapshotHash: string;
      readonly constitutionSnapshotIds: readonly string[];
      readonly proposedWorkItemCount: number;
      readonly proposedWorkItems: readonly CanonicalPlanWorkItemDraft[];
      readonly summary: string;
    } => submission !== null);
}

export function extractSpecificationSubmissions(
  toolExecutions: readonly ToolExecutionSummary[] | undefined,
): readonly {
  readonly specificationId: string;
  readonly status: "draft" | "ready_for_plan";
  readonly summary: string;
  readonly issueCodes: readonly string[];
  readonly blockingIssueCodes: readonly string[];
}[] {
  return (toolExecutions ?? [])
    .filter((execution) => execution.toolName === "submit_specification" && execution.success)
    .map((execution) => {
      const metadata = execution.metadata;
      const metadataSpecificationId = typeof metadata?.specificationId === "string"
        ? metadata.specificationId.trim()
        : "";
      const specificationId = metadataSpecificationId
        || (typeof execution.input?.specificationId === "string" && execution.input.specificationId.trim().length > 0
          ? execution.input.specificationId.trim()
          : (execution.toolCallId ? `spec:${execution.toolCallId}` : "spec:unknown"));
      const metadataStatus = metadata?.specificationStatus;
      const normalizedSummary = (execution.resultSummary ?? execution.output ?? "").toLowerCase();
      const status = metadataStatus === "ready_for_plan" || metadataStatus === "draft"
        ? metadataStatus
        : (normalizedSummary.includes("ready for planning") ? "ready_for_plan" : "draft");
      const issueCodes = extractIssueCodes(metadata?.issues);
      const blockingIssueCodes = extractStringArray(metadata?.blockingIssueCodes);
      if (!specificationId) {
        return null;
      }
      return {
        specificationId,
        status,
        summary: status === "ready_for_plan"
          ? `Specification ${specificationId} is ready for planning.`
          : `Specification ${specificationId} has unresolved validation issues.`,
        issueCodes,
        blockingIssueCodes,
      };
    })
    .filter((submission): submission is {
      readonly specificationId: string;
      readonly status: "draft" | "ready_for_plan";
      readonly summary: string;
      readonly issueCodes: readonly string[];
      readonly blockingIssueCodes: readonly string[];
    } => submission !== null);
}

export function extractPlanAnalysisReports(
  toolExecutions: readonly ToolExecutionSummary[] | undefined,
): readonly {
  readonly reportId: string;
  readonly planId: string;
  readonly specificationId: string;
  readonly status: "blocked" | "ready";
  readonly highestSeverity: "critical" | "high" | "medium" | "low" | "none";
  readonly findingIds: readonly string[];
  readonly blockingFindingIds: readonly string[];
  readonly findingCount: number;
  readonly findings: readonly CanonicalPlanAnalysisFindingDraft[];
  readonly summary: string;
}[] {
  return (toolExecutions ?? [])
    .filter((execution) => execution.toolName === "submit_plan")
    .map((execution) => {
      const metadata = execution.metadata;
      const reportId = typeof metadata?.analysisReportId === "string" ? metadata.analysisReportId.trim() : "";
      const planId = typeof metadata?.planId === "string" ? metadata.planId.trim() : "";
      const specificationId = typeof metadata?.sourceSpecificationId === "string" ? metadata.sourceSpecificationId.trim() : "";
      const status = metadata?.analysisStatus;
      const highestSeverity = metadata?.analysisHighestSeverity;
      if (!reportId || !planId || !specificationId) {
        return null;
      }
      if (status !== "blocked" && status !== "ready") {
        return null;
      }
      if (
        highestSeverity !== "critical"
        && highestSeverity !== "high"
        && highestSeverity !== "medium"
        && highestSeverity !== "low"
        && highestSeverity !== "none"
      ) {
        return null;
      }
      const findingIds = extractStringArray(metadata?.analysisFindingIds);
      const blockingFindingIds = extractStringArray(metadata?.analysisBlockingFindingIds);
      const findings = extractAnalysisFindings(metadata?.analysisFindings);
      const findingCount = typeof metadata?.analysisFindingCount === "number" ? metadata.analysisFindingCount : findingIds.length;
      const summary = typeof metadata?.analysisSummary === "string"
        ? metadata.analysisSummary.trim()
        : (status === "blocked" ? "Critical analysis findings block approval." : "No critical findings.");
      return {
        reportId,
        planId,
        specificationId,
        status,
        highestSeverity,
        findingIds,
        blockingFindingIds,
        findingCount,
        findings,
        summary,
      };
    })
    .filter((report): report is {
      readonly reportId: string;
      readonly planId: string;
      readonly specificationId: string;
      readonly status: "blocked" | "ready";
      readonly highestSeverity: "critical" | "high" | "medium" | "low" | "none";
      readonly findingIds: readonly string[];
      readonly blockingFindingIds: readonly string[];
      readonly findingCount: number;
      readonly findings: readonly CanonicalPlanAnalysisFindingDraft[];
      readonly summary: string;
    } => report !== null);
}

export function extractAnalysisFindings(value: unknown): readonly CanonicalPlanAnalysisFindingDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const findings: CanonicalPlanAnalysisFindingDraft[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = readNonEmptyString(record.id);
    const fingerprint = readNonEmptyString(record.fingerprint);
    const category = record.category;
    const severity = record.severity;
    const title = readNonEmptyString(record.title);
    const detail = readNonEmptyString(record.detail);
    const status = record.status;
    if (
      !id
      || !fingerprint
      || !isAnalysisFindingCategory(category)
      || !isAnalysisFindingSeverity(severity)
      || !title
      || !detail
      || !isAnalysisFindingStatus(status)
    ) {
      continue;
    }
    findings.push({
      id,
      fingerprint,
      category,
      severity,
      title,
      detail,
      references: extractStringArray(record.references),
      status,
    });
  }
  return findings;
}

export function extractClarificationRecords(
  toolExecutions: readonly ToolExecutionSummary[] | undefined,
): readonly {
  readonly specificationId: string;
  readonly clarificationId: string;
  readonly affectedSection: string;
}[] {
  return (toolExecutions ?? [])
    .filter((execution) => execution.toolName === "record_clarification" && execution.success)
    .map((execution) => {
      const metadata = execution.metadata;
      const specificationId = typeof metadata?.specificationId === "string"
        ? metadata.specificationId.trim()
        : (typeof execution.input?.specificationId === "string"
          ? execution.input.specificationId.trim()
          : "");
      const clarificationId = typeof metadata?.clarificationId === "string"
        ? metadata.clarificationId.trim()
        : (execution.toolCallId ? `clar:${execution.toolCallId}` : "");
      const affectedSection = typeof metadata?.affectedSection === "string"
        ? metadata.affectedSection.trim()
        : (typeof execution.input?.affectedSection === "string"
          ? execution.input.affectedSection.trim()
          : "");
      if (!specificationId || !clarificationId) {
        return null;
      }
      return {
        specificationId,
        clarificationId,
        affectedSection,
      };
    })
    .filter((clarification): clarification is {
      readonly specificationId: string;
      readonly clarificationId: string;
      readonly affectedSection: string;
    } => clarification !== null);
}

function extractStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((entry) => typeof entry === "string" ? [entry.trim()] : [])
    .filter((entry) => entry.length > 0);
}

function extractConstitutionSnapshotHash(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const record = value as Record<string, unknown>;
  return typeof record.instructionProfileHash === "string"
    ? record.instructionProfileHash.trim()
    : "";
}

function extractConstitutionSnapshotIds(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  return extractStringArray(record.instructionProfileIds);
}

function extractWorkGovernanceRationale(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const record = value as Record<string, unknown>;
  return typeof record.rationale === "string" ? record.rationale.trim() : "";
}

function extractPlanWorkItems(value: unknown): readonly CanonicalPlanWorkItemDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: CanonicalPlanWorkItemDraft[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = readNonEmptyString(record.id);
    const summary = readNonEmptyString(record.summary);
    const workflowProfile = readNonEmptyString(record.workflowProfile);
    const risk = record.risk;
    if (
      !id
      || !summary
      || !workflowProfile
      || (risk !== "low" && risk !== "medium" && risk !== "high" && risk !== "critical")
    ) {
      continue;
    }
    items.push({
      id,
      summary,
      workflowProfile,
      risk,
      expectedEvidence: extractStringArray(record.expectedEvidence),
      verificationGates: extractStringArray(record.verificationGates),
      dependencies: extractStringArray(record.dependencies),
    });
  }
  return items;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isAnalysisFindingCategory(value: unknown): value is CanonicalPlanAnalysisFindingDraft["category"] {
  return value === "duplication"
    || value === "ambiguity"
    || value === "underspecification"
    || value === "constitution_conflict"
    || value === "coverage_gap"
    || value === "task_order_inconsistency"
    || value === "terminology_drift"
    || value === "evidence_mismatch";
}

function isAnalysisFindingSeverity(value: unknown): value is CanonicalPlanAnalysisFindingDraft["severity"] {
  return value === "critical" || value === "high" || value === "medium" || value === "low";
}

function isAnalysisFindingStatus(value: unknown): value is CanonicalPlanAnalysisFindingDraft["status"] {
  return value === "open" || value === "superseded" || value === "closed" || value === "blocked";
}

function extractIssueCodes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    return typeof record.code === "string" && record.code.trim().length > 0
      ? [record.code.trim()]
      : [];
  });
}

function extractWorkflowProfile(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const record = value as Record<string, unknown>;
  return typeof record.workflowProfile === "string" ? record.workflowProfile.trim() : "";
}

function extractWorkGovernancePosture(
  value: unknown,
): "direct" | "orchestrate" | "delegate" | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const posture = record.posture;
  return posture === "direct" || posture === "orchestrate" || posture === "delegate"
    ? posture
    : undefined;
}



