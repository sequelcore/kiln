import type { ToolResourceChangeNotifier } from "../domain/tool-resource-notifications.js";

export type SpecificationValidationCode =
  | "ambiguity"
  | "missing_non_goals"
  | "vague_success_criteria"
  | "undefined_actors"
  | "unclear_data_lifecycle"
  | "ux_edge_cases"
  | "security_privacy_posture"
  | "external_dependencies"
  | "completion_signals";

export interface SpecificationValidationIssue {
  readonly code: SpecificationValidationCode;
  readonly field: string;
  readonly message: string;
  readonly blocking: boolean;
}

export interface ConstitutionSnapshot {
  readonly instructionProfileHash: string;
  readonly instructionProfileIds: readonly string[];
}

export interface SessionSpecification {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly nonGoals: readonly string[];
  readonly successCriteria: readonly string[];
  readonly actors: readonly string[];
  readonly dataLifecycle: string;
  readonly uxEdgeCases: readonly string[];
  readonly securityPrivacy: string;
  readonly externalDependencies: readonly string[];
  readonly completionSignals: readonly string[];
  readonly constitutionSnapshot: ConstitutionSnapshot;
  readonly clarificationIds: readonly string[];
  readonly issues: readonly SpecificationValidationIssue[];
  readonly status: "draft" | "ready_for_plan";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sequence: number;
}

export interface ClarificationRecord {
  readonly id: string;
  readonly specificationId: string;
  readonly question: string;
  readonly answer: string;
  readonly affectedSection: string;
  readonly rationale: string;
  readonly createdAt: string;
  readonly sequence: number;
}

export interface SpecificationStateSnapshot {
  readonly specifications: readonly SessionSpecification[];
  readonly clarifications: readonly ClarificationRecord[];
  readonly sequence: number;
}

export interface SpecificationStateStoreOptions {
  readonly now?: () => number;
  readonly resourceNotifications?: ToolResourceChangeNotifier;
}

export class SpecificationStateStore {
  private readonly now: () => number;
  private resourceNotifications: ToolResourceChangeNotifier | undefined;
  private readonly specifications = new Map<string, SessionSpecification>();
  private readonly clarifications = new Map<string, ClarificationRecord>();
  private nextSpecificationId = 1;
  private nextClarificationId = 1;
  private sequence = 0;

  constructor(options: SpecificationStateStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.resourceNotifications = options.resourceNotifications;
  }

  setResourceChangeNotifier(notifier: ToolResourceChangeNotifier): void {
    this.resourceNotifications = notifier;
  }

  upsertSpecification(input: {
    readonly id?: string;
    readonly title: string;
    readonly objective: string;
    readonly nonGoals: readonly string[];
    readonly successCriteria: readonly string[];
    readonly actors: readonly string[];
    readonly dataLifecycle: string;
    readonly uxEdgeCases: readonly string[];
    readonly securityPrivacy: string;
    readonly externalDependencies: readonly string[];
    readonly completionSignals: readonly string[];
    readonly constitutionSnapshot: ConstitutionSnapshot;
  }): SessionSpecification {
    const id = input.id ?? this.allocateSpecificationId();
    const previous = this.specifications.get(id);
    const createdAt = previous?.createdAt ?? this.timestamp();
    const updatedAt = this.timestamp();
    const clarificationIds = previous?.clarificationIds ?? [];
    const issues = validateSpecificationInput(input);
    const status = issues.some((issue) => issue.blocking) ? "draft" : "ready_for_plan";
    this.sequence += 1;
    const specification: SessionSpecification = {
      id,
      title: input.title,
      objective: input.objective,
      nonGoals: uniqueText(input.nonGoals),
      successCriteria: uniqueText(input.successCriteria),
      actors: uniqueText(input.actors),
      dataLifecycle: input.dataLifecycle,
      uxEdgeCases: uniqueText(input.uxEdgeCases),
      securityPrivacy: input.securityPrivacy,
      externalDependencies: uniqueText(input.externalDependencies),
      completionSignals: uniqueText(input.completionSignals),
      constitutionSnapshot: {
        instructionProfileHash: input.constitutionSnapshot.instructionProfileHash,
        instructionProfileIds: uniqueText(input.constitutionSnapshot.instructionProfileIds),
      },
      clarificationIds,
      issues,
      status,
      createdAt,
      updatedAt,
      sequence: this.sequence,
    };
    this.specifications.set(id, specification);
    this.notifySpecificationChanges(id);
    return specification;
  }

  recordClarification(input: {
    readonly specificationId: string;
    readonly question: string;
    readonly answer: string;
    readonly affectedSection: string;
    readonly rationale: string;
  }): {
    readonly clarification: ClarificationRecord;
    readonly specification: SessionSpecification;
  } | {
    readonly error: string;
  } {
    const specification = this.specifications.get(input.specificationId);
    if (!specification) {
      return { error: `Specification not found: ${input.specificationId}` };
    }

    const normalizedSection = normalizeKey(input.affectedSection);
    const normalizedQuestion = normalizeKey(input.question);
    const normalizedAnswer = normalizeKey(input.answer);

    for (const clarificationId of specification.clarificationIds) {
      const existing = this.clarifications.get(clarificationId);
      if (!existing) {
        continue;
      }
      const sameKey = normalizeKey(existing.affectedSection) === normalizedSection
        && normalizeKey(existing.question) === normalizedQuestion;
      if (!sameKey) {
        continue;
      }
      if (normalizeKey(existing.answer) !== normalizedAnswer) {
        return {
          error: "Clarification contradicts an existing answer for the same affected section and question.",
        };
      }
      return {
        clarification: existing,
        specification,
      };
    }

    const clarification: ClarificationRecord = {
      id: this.allocateClarificationId(),
      specificationId: specification.id,
      question: input.question,
      answer: input.answer,
      affectedSection: input.affectedSection,
      rationale: input.rationale,
      createdAt: this.timestamp(),
      sequence: this.sequence + 1,
    };
    this.sequence += 1;
    this.clarifications.set(clarification.id, clarification);
    const updatedSpecification: SessionSpecification = {
      ...specification,
      clarificationIds: uniqueText([...specification.clarificationIds, clarification.id]),
      updatedAt: this.timestamp(),
      sequence: this.sequence,
    };
    this.specifications.set(specification.id, updatedSpecification);
    this.notifySpecificationChanges(specification.id, clarification.id);

    return {
      clarification,
      specification: updatedSpecification,
    };
  }

  listSpecifications(): readonly SessionSpecification[] {
    return Array.from(this.specifications.values()).sort((left, right) => left.sequence - right.sequence);
  }

  listClarifications(specificationId?: string): readonly ClarificationRecord[] {
    return Array.from(this.clarifications.values())
      .filter((record) => specificationId === undefined || record.specificationId === specificationId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  getSpecification(id: string): SessionSpecification | undefined {
    return this.specifications.get(id);
  }

  latestSpecification(): SessionSpecification | undefined {
    return this.listSpecifications().at(-1);
  }

  snapshot(): SpecificationStateSnapshot {
    return {
      specifications: this.listSpecifications(),
      clarifications: this.listClarifications(),
      sequence: this.sequence,
    };
  }

  private allocateSpecificationId(): string {
    let id = `spec_${this.nextSpecificationId++}`;
    while (this.specifications.has(id)) {
      id = `spec_${this.nextSpecificationId++}`;
    }
    return id;
  }

  private allocateClarificationId(): string {
    let id = `clar_${this.nextClarificationId++}`;
    while (this.clarifications.has(id)) {
      id = `clar_${this.nextClarificationId++}`;
    }
    return id;
  }

  private notifySpecificationChanges(specificationId: string, clarificationId?: string): void {
    this.resourceNotifications?.notifyResourceUpdated("kiln://session/specifications");
    this.resourceNotifications?.notifyResourceUpdated(`kiln://session/specifications/${specificationId}`);
    this.resourceNotifications?.notifyResourceUpdated("kiln://session/clarifications");
    void clarificationId;
    this.resourceNotifications?.notifyResourceUpdated(`kiln://session/clarifications/${specificationId}`);
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }
}

function validateSpecificationInput(input: {
  readonly objective: string;
  readonly nonGoals: readonly string[];
  readonly successCriteria: readonly string[];
  readonly actors: readonly string[];
  readonly dataLifecycle: string;
  readonly uxEdgeCases: readonly string[];
  readonly securityPrivacy: string;
  readonly externalDependencies: readonly string[];
  readonly completionSignals: readonly string[];
}): readonly SpecificationValidationIssue[] {
  const issues: SpecificationValidationIssue[] = [];

  if (containsAmbiguousLanguage(input.objective)) {
    issues.push({
      code: "ambiguity",
      field: "objective",
      message: "Objective contains ambiguous wording that should be clarified.",
      blocking: true,
    });
  }
  if (input.nonGoals.length === 0) {
    issues.push({
      code: "missing_non_goals",
      field: "nonGoals",
      message: "At least one non-goal is required.",
      blocking: true,
    });
  }
  if (input.successCriteria.length === 0 || input.successCriteria.some((criterion) => containsAmbiguousLanguage(criterion))) {
    issues.push({
      code: "vague_success_criteria",
      field: "successCriteria",
      message: "Success criteria are missing or vague.",
      blocking: true,
    });
  }
  if (input.actors.length === 0) {
    issues.push({
      code: "undefined_actors",
      field: "actors",
      message: "At least one actor is required.",
      blocking: true,
    });
  }
  if (input.dataLifecycle.trim().length === 0 || containsAmbiguousLanguage(input.dataLifecycle)) {
    issues.push({
      code: "unclear_data_lifecycle",
      field: "dataLifecycle",
      message: "Data lifecycle description is missing or unclear.",
      blocking: true,
    });
  }
  if (input.uxEdgeCases.length === 0) {
    issues.push({
      code: "ux_edge_cases",
      field: "uxEdgeCases",
      message: "List known UX edge cases before planning.",
      blocking: false,
    });
  }
  if (input.securityPrivacy.trim().length === 0 || containsAmbiguousLanguage(input.securityPrivacy)) {
    issues.push({
      code: "security_privacy_posture",
      field: "securityPrivacy",
      message: "Security/privacy posture is missing or unclear.",
      blocking: true,
    });
  }
  if (input.externalDependencies.length === 0) {
    issues.push({
      code: "external_dependencies",
      field: "externalDependencies",
      message: "Declare external dependencies explicitly (use 'none' if not applicable).",
      blocking: false,
    });
  }
  if (input.completionSignals.length === 0) {
    issues.push({
      code: "completion_signals",
      field: "completionSignals",
      message: "At least one completion signal is required.",
      blocking: true,
    });
  }

  return issues;
}

function containsAmbiguousLanguage(value: string): boolean {
  const normalized = normalizeKey(value);
  if (!normalized) {
    return true;
  }
  const tokens = ["maybe", "probably", "possibly", "etc", "tbd", "later"];
  return tokens.some((token) => normalized.includes(token));
}

function uniqueText(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}
