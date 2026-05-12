import { createHash } from "node:crypto";
import type { SessionPlan } from "./plan-state-store.js";
import type { SessionSpecification } from "./specification-state-store.js";
import type { ToolResourceChangeNotifier } from "../domain/tool-resource-notifications.js";

export type AnalysisFindingCategory =
  | "duplication"
  | "ambiguity"
  | "underspecification"
  | "constitution_conflict"
  | "coverage_gap"
  | "task_order_inconsistency"
  | "terminology_drift"
  | "evidence_mismatch";

export type AnalysisFindingSeverity = "critical" | "high" | "medium" | "low";
export type AnalysisFindingStatus = "open" | "superseded" | "closed" | "blocked";
export type AnalysisReportStatus = "blocked" | "ready";

export interface AnalysisFinding {
  readonly id: string;
  readonly fingerprint: string;
  readonly category: AnalysisFindingCategory;
  readonly severity: AnalysisFindingSeverity;
  readonly title: string;
  readonly detail: string;
  readonly references: readonly string[];
  readonly status: AnalysisFindingStatus;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly firstSeenSequence: number;
  readonly lastSeenSequence: number;
  readonly supersededByReportId?: string;
}

export interface AnalysisReport {
  readonly id: string;
  readonly specificationId: string;
  readonly planId: string;
  readonly status: AnalysisReportStatus;
  readonly summary: string;
  readonly findingIds: readonly string[];
  readonly blockingFindingIds: readonly string[];
  readonly highestSeverity: AnalysisFindingSeverity | "none";
  readonly createdAt: string;
  readonly sequence: number;
}

export interface AnalysisStateSnapshot {
  readonly reports: readonly AnalysisReport[];
  readonly findings: readonly AnalysisFinding[];
  readonly sequence: number;
}

export interface AnalyzePlanInput {
  readonly specification: SessionSpecification;
  readonly plan: SessionPlan;
}

export interface AnalysisStateStoreOptions {
  readonly now?: () => number;
  readonly resourceNotifications?: ToolResourceChangeNotifier;
}

interface DraftFinding {
  readonly category: AnalysisFindingCategory;
  readonly severity: AnalysisFindingSeverity;
  readonly title: string;
  readonly detail: string;
  readonly references: readonly string[];
}

export class AnalysisStateStore {
  private readonly now: () => number;
  private resourceNotifications: ToolResourceChangeNotifier | undefined;
  private readonly reports = new Map<string, AnalysisReport>();
  private readonly findings = new Map<string, AnalysisFinding>();
  private readonly findingIdsByFingerprint = new Map<string, string>();
  private nextReportId = 1;
  private nextFindingId = 1;
  private sequence = 0;

  constructor(options: AnalysisStateStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.resourceNotifications = options.resourceNotifications;
  }

  setResourceChangeNotifier(notifier: ToolResourceChangeNotifier): void {
    this.resourceNotifications = notifier;
  }

  analyzePlan(input: AnalyzePlanInput): {
    readonly report: AnalysisReport;
    readonly findings: readonly AnalysisFinding[];
  } {
    const drafts = collectFindings(input.specification, input.plan);
    const timestamp = this.timestamp();
    const findingIds: string[] = [];
    const findings: AnalysisFinding[] = [];
    this.sequence += 1;
    const reportId = this.allocateReportId();
    const activeFingerprints = new Set<string>();
    const activeCategories = new Set<AnalysisFindingCategory>();

    for (const draft of drafts) {
      const fingerprint = fingerprintFinding(input.specification.id, draft);
      activeFingerprints.add(fingerprint);
      activeCategories.add(draft.category);
      const activeStatus: AnalysisFindingStatus = draft.severity === "critical" ? "blocked" : "open";
      const existingId = this.findingIdsByFingerprint.get(fingerprint);
      if (existingId) {
        const existing = this.findings.get(existingId);
        if (existing) {
          const updated: AnalysisFinding = {
            ...existing,
            references: [...new Set([...existing.references, ...draft.references])],
            status: activeStatus,
            lastSeenAt: timestamp,
            lastSeenSequence: this.sequence,
            supersededByReportId: undefined,
          };
          this.findings.set(existing.id, updated);
          findingIds.push(existing.id);
          findings.push(updated);
          continue;
        }
      }
      const finding: AnalysisFinding = {
        id: this.allocateFindingId(),
        fingerprint,
        category: draft.category,
        severity: draft.severity,
        title: draft.title,
        detail: draft.detail,
        references: draft.references,
        status: activeStatus,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        firstSeenSequence: this.sequence,
        lastSeenSequence: this.sequence,
      };
      this.findings.set(finding.id, finding);
      this.findingIdsByFingerprint.set(fingerprint, finding.id);
      findingIds.push(finding.id);
      findings.push(finding);
    }

    const staleOpenFindings = this.listFindings().filter((candidate) => {
      if (candidate.status !== "open" && candidate.status !== "blocked") {
        return false;
      }
      if (!candidate.references.includes(`specification:${input.specification.id}`)) {
        return false;
      }
      return !activeFingerprints.has(candidate.fingerprint);
    });
    const supersededFindingIds: string[] = [];
    for (const stale of staleOpenFindings) {
      const status: AnalysisFindingStatus = activeCategories.has(stale.category) ? "superseded" : "closed";
      this.findings.set(stale.id, {
        ...stale,
        status,
        lastSeenAt: timestamp,
        lastSeenSequence: this.sequence,
        supersededByReportId: reportId,
      });
      supersededFindingIds.push(stale.id);
    }

    const blockingFindingIds = findings
      .filter((finding) => finding.status === "blocked")
      .map((finding) => finding.id);
    const highestSeverity = resolveHighestSeverity(findings);
    const report: AnalysisReport = {
      id: reportId,
      specificationId: input.specification.id,
      planId: input.plan.id,
      status: blockingFindingIds.length > 0 ? "blocked" : "ready",
      summary: blockingFindingIds.length > 0
        ? `${blockingFindingIds.length} critical findings block approval.`
        : "No critical findings. Ready for approval.",
      findingIds,
      blockingFindingIds,
      highestSeverity,
      createdAt: timestamp,
      sequence: this.sequence,
    };
    this.reports.set(report.id, report);
    this.notify(report.id, [...new Set([...findingIds, ...supersededFindingIds])]);
    return { report, findings };
  }

  listReports(): readonly AnalysisReport[] {
    return Array.from(this.reports.values()).sort((left, right) => left.sequence - right.sequence);
  }

  getReport(id: string): AnalysisReport | undefined {
    return this.reports.get(id);
  }

  latestReport(): AnalysisReport | undefined {
    return this.listReports().at(-1);
  }

  listFindings(): readonly AnalysisFinding[] {
    return Array.from(this.findings.values()).sort((left, right) => left.firstSeenSequence - right.firstSeenSequence);
  }

  getFinding(id: string): AnalysisFinding | undefined {
    return this.findings.get(id);
  }

  snapshot(): AnalysisStateSnapshot {
    return {
      reports: this.listReports(),
      findings: this.listFindings(),
      sequence: this.sequence,
    };
  }

  private notify(reportId: string, findingIds: readonly string[]): void {
    this.resourceNotifications?.notifyResourceUpdated("kiln://session/analysis-reports");
    this.resourceNotifications?.notifyResourceUpdated(`kiln://session/analysis-reports/${reportId}`);
    this.resourceNotifications?.notifyResourceUpdated("kiln://session/analysis-findings");
    for (const findingId of findingIds) {
      this.resourceNotifications?.notifyResourceUpdated(`kiln://session/analysis-findings/${findingId}`);
    }
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }

  private allocateReportId(): string {
    let id = `analysis_report_${this.nextReportId++}`;
    while (this.reports.has(id)) {
      id = `analysis_report_${this.nextReportId++}`;
    }
    return id;
  }

  private allocateFindingId(): string {
    let id = `analysis_finding_${this.nextFindingId++}`;
    while (this.findings.has(id)) {
      id = `analysis_finding_${this.nextFindingId++}`;
    }
    return id;
  }
}

function collectFindings(specification: SessionSpecification, plan: SessionPlan): readonly DraftFinding[] {
  const findings: DraftFinding[] = [];
  const refs = [`specification:${specification.id}`, `plan:${plan.id}`];
  const add = (
    category: AnalysisFindingCategory,
    severity: AnalysisFindingSeverity,
    title: string,
    detail: string,
    references: readonly string[] = refs,
  ): void => {
    findings.push({ category, severity, title, detail, references });
  };

  if (specification.constitutionSnapshot.instructionProfileHash !== plan.constitutionSnapshot.instructionProfileHash) {
    add(
      "constitution_conflict",
      "critical",
      "Constitution Snapshot Mismatch",
      "Plan and specification instruction-profile hashes differ.",
    );
  }

  const workItemIds = new Set(plan.proposedWorkItems.map((item) => item.id));
  for (const item of plan.proposedWorkItems) {
    for (const dependency of item.dependencies) {
      if (!workItemIds.has(dependency)) {
        add(
          "task_order_inconsistency",
          "critical",
          "Missing Work Item Dependency",
          `Work item '${item.id}' depends on unknown item '${dependency}'.`,
          [...refs, `work-item:${item.id}`],
        );
      }
    }
  }
  for (const cycle of detectDependencyCycles(plan.proposedWorkItems)) {
    add(
      "task_order_inconsistency",
      "critical",
      "Work Item Dependency Cycle",
      `Work item dependencies contain a cycle: ${cycle.join(" -> ")} -> ${cycle[0]}.`,
      [...refs, ...cycle.map((itemId) => `work-item:${itemId}`)],
    );
  }

  const normalizedSummaries = new Map<string, string[]>();
  for (const item of plan.proposedWorkItems) {
    const key = normalizeText(item.summary);
    if (!key) continue;
    const ids = normalizedSummaries.get(key) ?? [];
    ids.push(item.id);
    normalizedSummaries.set(key, ids);
  }
  for (const [summary, ids] of normalizedSummaries.entries()) {
    if (ids.length > 1) {
      add(
        "duplication",
        "medium",
        "Duplicated Work Item Summary",
        `Work items ${ids.join(", ")} share the same summary: '${summary}'.`,
      );
    }
  }

  if (containsAmbiguousLanguage(specification.objective) || containsAmbiguousLanguage(plan.objective)) {
    add(
      "ambiguity",
      "medium",
      "Ambiguous Objective Language",
      "Objective contains ambiguous words that can weaken plan/spec consistency.",
    );
  }

  if (plan.assumptions.length === 0) {
    add(
      "underspecification",
      "high",
      "Missing Plan Assumptions",
      "Plan does not declare assumptions, reducing traceability for approval.",
    );
  }

  for (const criterion of specification.successCriteria) {
    const criterionTokens = tokenize(criterion);
    if (criterionTokens.length === 0) {
      continue;
    }
    const covered = plan.proposedWorkItems.some((item) => hasTokenOverlap(criterionTokens, tokenize(item.summary)));
    if (!covered) {
      add(
        "coverage_gap",
        "high",
        "Specification Criterion Lacks Work Item Coverage",
        `No proposed work item appears to cover success criterion: '${criterion}'.`,
      );
    }
  }

  const workItemEvidence = new Set(
    plan.proposedWorkItems.flatMap((item) => item.expectedEvidence.map(normalizeText)).filter(Boolean),
  );
  const missingEvidence = plan.expectedEvidence.filter((evidence) => {
    const normalized = normalizeText(evidence);
    return normalized && !workItemEvidence.has(normalized);
  });
  if (missingEvidence.length > 0) {
    add(
      "evidence_mismatch",
      "high",
      "Plan Evidence Lacks Work Item Coverage",
      `Plan-level evidence is not covered by proposed work items: ${missingEvidence.join(", ")}.`,
    );
  }

  for (const actor of specification.actors) {
    const actorKey = normalizeText(actor);
    if (!actorKey) continue;
    const mentioned = normalizeText(plan.objective).includes(actorKey)
      || plan.proposedWorkItems.some((item) => normalizeText(item.summary).includes(actorKey));
    if (!mentioned) {
      add(
        "terminology_drift",
        "low",
        "Actor Terminology Drift",
        `Actor '${actor}' from specification is not referenced in plan objective/work items.`,
      );
    }
  }

  return findings;
}

function fingerprintFinding(
  specificationId: string,
  finding: DraftFinding,
): string {
  const hash = createHash("sha256");
  hash.update(specificationId);
  hash.update("|");
  hash.update(finding.category);
  hash.update("|");
  hash.update(finding.title);
  hash.update("|");
  hash.update(finding.detail);
  return hash.digest("hex");
}

function detectDependencyCycles(
  workItems: SessionPlan["proposedWorkItems"],
): readonly string[][] {
  const knownIds = new Set(workItems.map((item) => item.id));
  const adjacency = new Map<string, readonly string[]>();
  for (const item of workItems) {
    adjacency.set(
      item.id,
      item.dependencies.filter((dependency) => knownIds.has(dependency)),
    );
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();

  const normalizeCycle = (cycle: readonly string[]): readonly string[] => {
    if (cycle.length <= 1) {
      return cycle;
    }
    let minIndex = 0;
    for (let index = 1; index < cycle.length; index += 1) {
      if (cycle[index]!.localeCompare(cycle[minIndex]!) < 0) {
        minIndex = index;
      }
    }
    return cycle.slice(minIndex).concat(cycle.slice(0, minIndex));
  };

  const dfs = (nodeId: string): void => {
    visiting.add(nodeId);
    stack.push(nodeId);
    const dependencies = adjacency.get(nodeId) ?? [];
    for (const dependencyId of dependencies) {
      if (visiting.has(dependencyId)) {
        const cycleStart = stack.indexOf(dependencyId);
        if (cycleStart >= 0) {
          const cycle = stack.slice(cycleStart);
          const normalized = normalizeCycle(cycle);
          const key = normalized.join("->");
          if (!seenCycleKeys.has(key)) {
            seenCycleKeys.add(key);
            cycles.push([...normalized]);
          }
        }
        continue;
      }
      if (!visited.has(dependencyId)) {
        dfs(dependencyId);
      }
    }
    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const workItem of workItems) {
    if (!visited.has(workItem.id)) {
      dfs(workItem.id);
    }
  }

  return cycles;
}

function resolveHighestSeverity(findings: readonly AnalysisFinding[]): AnalysisFindingSeverity | "none" {
  const rank: Record<AnalysisFindingSeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  let highest: AnalysisFindingSeverity | "none" = "none";
  let highestRank = 0;
  for (const finding of findings) {
    const current = rank[finding.severity];
    if (current > highestRank) {
      highest = finding.severity;
      highestRank = current;
    }
  }
  return highest;
}

function containsAmbiguousLanguage(value: string): boolean {
  const normalized = normalizeText(value);
  return normalized.includes("maybe")
    || normalized.includes("possibly")
    || normalized.includes("somehow")
    || normalized.includes("etc")
    || normalized.includes("and so on");
}

function tokenize(value: string): readonly string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function hasTokenOverlap(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const rightSet = new Set(right);
  return left.some((token) => rightSet.has(token));
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}
