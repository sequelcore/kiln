import { PII_PATTERNS } from "../safety/pii-scanner.js";
import type { WorkItem } from "../work-governance/work-item.js";

export type FeedbackReporterMode =
  | "quick"
  | "diagnostic"
  | "maintainer";

export type FeedbackEvidenceKind =
  | "session-summary"
  | "transcript-excerpt"
  | "tool-failure"
  | "command-output"
  | "environment"
  | "git-status"
  | "log-excerpt"
  | "file-change-summary"
  | "diagnostic-finding";

export type FeedbackRedactionKind =
  | "credential"
  | "email"
  | "phone";

type FeedbackPiiRedactionKind = Exclude<FeedbackRedactionKind, "credential">;

export interface FeedbackReporterInput {
  readonly mode: FeedbackReporterMode;
  readonly description: string;
  readonly expectedBehavior?: string;
  readonly actualBehavior: string;
}

export interface FeedbackEvidenceSelection {
  readonly includeSessionSummary: boolean;
  readonly includeTranscriptExcerpts: boolean;
  readonly includeToolFailures: boolean;
  readonly includeCommandOutput: boolean;
  readonly includeEnvironment: boolean;
  readonly includeGitStatus: boolean;
  readonly includeLogs: boolean;
  readonly includeFileChangeSummary: boolean;
  readonly includeDiagnosticFindings: boolean;
}

export interface FeedbackEvidenceItemInput {
  readonly kind: FeedbackEvidenceKind;
  readonly title: string;
  readonly content: string;
}

export interface FeedbackEvidenceItem {
  readonly kind: FeedbackEvidenceKind;
  readonly title: string;
  readonly content: string;
  readonly redactionApplied: boolean;
}

export interface FeedbackRedactionFinding {
  readonly kind: FeedbackRedactionKind;
  readonly label: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly replacement: string;
}

export interface FeedbackRedactionResult {
  readonly text: string;
  readonly findings: readonly FeedbackRedactionFinding[];
}

export interface FeedbackReport {
  readonly feedbackId: string;
  readonly createdAt: string;
  readonly sessionId: string;
  readonly mode: FeedbackReporterMode;
  readonly description: string;
  readonly expectedBehavior?: string;
  readonly actualBehavior: string;
}

export interface FeedbackBundleInput {
  readonly feedbackId: string;
  readonly createdAt: string;
  readonly sessionId: string;
  readonly reporter: FeedbackReporterInput;
  readonly evidenceSelection: FeedbackEvidenceSelection;
  readonly evidence: readonly FeedbackEvidenceItemInput[];
}

export interface FeedbackPublicationGate {
  readonly allowed: boolean;
  readonly reason: "local-only-default" | "requires-explicit-approval";
}

export interface FeedbackBundle {
  readonly feedbackId: string;
  readonly createdAt: string;
  readonly sessionId: string;
  readonly status: "local-draft";
  readonly report: FeedbackReport;
  readonly evidenceSelection: FeedbackEvidenceSelection;
  readonly evidence: readonly FeedbackEvidenceItem[];
  readonly redaction: {
    readonly applied: true;
    readonly findings: readonly FeedbackRedactionFinding[];
  };
  readonly publication: FeedbackPublicationGate;
}

export interface FeedbackIssueDraft {
  readonly feedbackId: string;
  readonly markdown: string;
  readonly publication: FeedbackPublicationGate;
}

export interface FeedbackPublicationApproval {
  readonly approved: boolean;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly resourceUris: readonly string[];
}

export type FeedbackIssueProviderName = "github";
export type FeedbackIssuePublicationMode = "draft" | "create";
export type FeedbackIssueProviderResponseStatus = "drafted" | "created";

export interface FeedbackIssueProviderRequest {
  readonly feedbackId: string;
  readonly title: string;
  readonly body: string;
  readonly approval: RedactedFeedbackApprovalEvidence;
}

export interface FeedbackIssueProviderResponse {
  readonly provider: FeedbackIssueProviderName;
  readonly status: FeedbackIssueProviderResponseStatus;
  readonly externalId?: string;
  readonly url?: string;
  readonly rawResponsePreview?: string;
}

export interface FeedbackIssueProviderPort {
  readonly provider: FeedbackIssueProviderName;
  readonly mode: FeedbackIssuePublicationMode;
  createIssue(request: FeedbackIssueProviderRequest): Promise<FeedbackIssueProviderResponse>;
}

export interface RedactedFeedbackApprovalEvidence {
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly resourceUris: readonly string[];
}

export interface FeedbackIssuePublicationDraft {
  readonly feedbackId: string;
  readonly provider: FeedbackIssueProviderName;
  readonly mode: FeedbackIssuePublicationMode;
  readonly approval: RedactedFeedbackApprovalEvidence;
  readonly providerResponse: FeedbackIssueProviderResponse;
  readonly publication: FeedbackPublicationGate;
}

export interface FeedbackIssuePublicationDraftInput {
  readonly bundle: FeedbackBundle;
  readonly issueDraft: FeedbackIssueDraft;
  readonly approval: FeedbackPublicationApproval;
  readonly provider: FeedbackIssueProviderPort;
}

export interface FeedbackDraftPullRequestInput {
  readonly workItem: WorkItem;
  readonly approval: FeedbackPublicationApproval;
  readonly branchName: string;
  readonly title: string;
  readonly body: string;
  readonly changedFiles: readonly string[];
  readonly reviewEvidenceUris: readonly string[];
}

export interface FeedbackDraftPullRequestMetadata {
  readonly feedbackId: string;
  readonly sourceFeedbackId: string;
  readonly repairWorkItemId: string;
  readonly status: "draft-local";
  readonly branchName: string;
  readonly title: string;
  readonly body: string;
  readonly changedFiles: readonly string[];
  readonly reviewEvidenceUris: readonly string[];
  readonly approval: RedactedFeedbackApprovalEvidence;
  readonly evidence: {
    readonly tests: boolean;
    readonly typecheck: boolean;
    readonly review: boolean;
    readonly residualRisk: boolean;
  };
  readonly publication: FeedbackPublicationGate;
}

interface RedactionPattern {
  readonly kind: FeedbackRedactionKind;
  readonly label: string;
  readonly replacement: string;
  readonly regex: RegExp;
}

const REDACTION_PATTERNS: readonly RedactionPattern[] = [
  {
    kind: "credential",
    label: "authorization-bearer",
    replacement: "[REDACTED:credential]",
    regex: /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi,
  },
  {
    kind: "credential",
    label: "openai-api-key",
    replacement: "[REDACTED:credential]",
    regex: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    kind: "credential",
    label: "github-token",
    replacement: "[REDACTED:credential]",
    regex: /\b(?:github_pat|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{8,}\b/g,
  },
  ...PII_PATTERNS
    .filter((pattern): pattern is { readonly type: FeedbackPiiRedactionKind; readonly regex: RegExp } =>
      pattern.type === "email" || pattern.type === "phone"
    )
    .map((pattern): RedactionPattern => ({
      kind: pattern.type,
      label: pattern.type,
      replacement: `[REDACTED:${pattern.type}]`,
      regex: pattern.regex,
    })),
];

export function redactFeedbackText(input: string): FeedbackRedactionResult {
  const normalized = input.normalize("NFKC");
  const matches: FeedbackRedactionFinding[] = [];

  for (const pattern of REDACTION_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(normalized)) !== null) {
      if (overlapsExistingMatch(matches, match.index, match.index + match[0].length)) continue;
      matches.push({
        kind: pattern.kind,
        label: pattern.label,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        replacement: pattern.replacement,
      });
    }
  }

  const sorted = [...matches].sort((left, right) => {
    if (left.startIndex !== right.startIndex) return left.startIndex - right.startIndex;
    return right.endIndex - left.endIndex;
  });

  let text = normalized;
  for (const finding of [...sorted].reverse()) {
    text = `${text.slice(0, finding.startIndex)}${finding.replacement}${text.slice(finding.endIndex)}`;
  }

  return {
    text,
    findings: sorted,
  };
}

export function createFeedbackBundle(input: FeedbackBundleInput): FeedbackBundle {
  assertNonEmpty(input.feedbackId, "feedbackId");
  assertValidIsoTimestamp(input.createdAt, "createdAt");
  assertNonEmpty(input.sessionId, "sessionId");
  assertNonEmpty(input.reporter.description, "reporter.description");
  assertNonEmpty(input.reporter.actualBehavior, "reporter.actualBehavior");

  const description = redactFeedbackText(input.reporter.description);
  const expectedBehavior = input.reporter.expectedBehavior
    ? redactFeedbackText(input.reporter.expectedBehavior)
    : undefined;
  const actualBehavior = redactFeedbackText(input.reporter.actualBehavior);
  const evidence = input.evidence
    .filter((item) => evidenceSelected(item.kind, input.evidenceSelection))
    .map((item): FeedbackEvidenceItem => {
      assertNonEmpty(item.title, "evidence.title");
      const redacted = redactFeedbackText(item.content);
      return {
        kind: item.kind,
        title: item.title,
        content: redacted.text,
        redactionApplied: redacted.findings.length > 0,
      };
    });

  const findings = [
    ...description.findings,
    ...(expectedBehavior?.findings ?? []),
    ...actualBehavior.findings,
    ...input.evidence
      .filter((item) => evidenceSelected(item.kind, input.evidenceSelection))
      .flatMap((item) => redactFeedbackText(item.content).findings),
  ];

  return {
    feedbackId: input.feedbackId,
    createdAt: input.createdAt,
    sessionId: input.sessionId,
    status: "local-draft",
    report: {
      feedbackId: input.feedbackId,
      createdAt: input.createdAt,
      sessionId: input.sessionId,
      mode: input.reporter.mode,
      description: description.text,
      ...(expectedBehavior ? { expectedBehavior: expectedBehavior.text } : {}),
      actualBehavior: actualBehavior.text,
    },
    evidenceSelection: input.evidenceSelection,
    evidence,
    redaction: {
      applied: true,
      findings,
    },
    publication: localOnlyPublicationGate(),
  };
}

export function createFeedbackIssueDraft(bundle: FeedbackBundle): FeedbackIssueDraft {
  const lines = [
    `# Feedback: ${bundle.feedbackId}`,
    "",
    "## Summary",
    bundle.report.description,
    "",
    "## Expected",
    bundle.report.expectedBehavior ?? "_Not provided._",
    "",
    "## Actual",
    bundle.report.actualBehavior,
    "",
    "## Session",
    `- Session: ${bundle.sessionId}`,
    `- Created at: ${bundle.createdAt}`,
    `- Mode: ${bundle.report.mode}`,
    "",
    "## Selected Evidence",
    ...renderEvidence(bundle.evidence),
    "",
    "## Privacy",
    `- Redaction applied: ${bundle.redaction.applied ? "yes" : "no"}`,
    `- Redaction findings: ${bundle.redaction.findings.length}`,
    "- Publication: local draft only until explicit approval",
    "",
  ];

  return {
    feedbackId: bundle.feedbackId,
    markdown: lines.join("\n"),
    publication: {
      allowed: false,
      reason: "requires-explicit-approval",
    },
  };
}

export async function createFeedbackIssuePublicationDraft(
  input: FeedbackIssuePublicationDraftInput,
): Promise<FeedbackIssuePublicationDraft> {
  if (input.bundle.status !== "local-draft") {
    throw new Error("Feedback issue publication requires a local draft bundle.");
  }
  if (input.issueDraft.feedbackId !== input.bundle.feedbackId) {
    throw new Error("Feedback issue publication draft must match the feedback bundle.");
  }
  const approval = requirePublicationApproval({
    approval: input.approval,
    feedbackId: input.bundle.feedbackId,
    evidenceKind: "approval",
    message: "Feedback issue publication requires explicit approval.",
  });
  const providerResponse = redactProviderResponse(await input.provider.createIssue({
    feedbackId: input.bundle.feedbackId,
    title: `Feedback: ${input.bundle.feedbackId}`,
    body: input.issueDraft.markdown,
    approval,
  }));
  if (providerResponse.provider !== input.provider.provider) {
    throw new Error("Feedback issue provider response must match the approved provider.");
  }

  return {
    feedbackId: input.bundle.feedbackId,
    provider: input.provider.provider,
    mode: input.provider.mode,
    approval,
    providerResponse,
    publication: {
      allowed: false,
      reason: "requires-explicit-approval",
    },
  };
}

export function createFeedbackDraftPullRequestMetadata(
  input: FeedbackDraftPullRequestInput,
): FeedbackDraftPullRequestMetadata {
  const repair = input.workItem.feedbackRepair;
  if (!repair || input.workItem.status !== "completed") {
    throw new Error("Feedback draft PR requires a completed feedback repair work item.");
  }
  requireWorkItemEvidence(input.workItem, "tests", "Feedback draft PR requires passing repair tests.");
  requireWorkItemEvidence(input.workItem, "typecheck", "Feedback draft PR requires passing repair typecheck.");
  requireWorkItemEvidence(input.workItem, "managed-agent-review", "Feedback draft PR requires managed-agent review evidence.");
  requireWorkItemEvidence(input.workItem, "residual-risk", "Feedback draft PR requires residual risk closeout.");
  for (const gate of [...repair.verificationCriteria, "managed-agent review"]) {
    if (!input.workItem.verificationGateResults.some((result) => result.gate === gate && result.status === "passed")) {
      throw new Error("Feedback draft PR requires passing repair verification gates.");
    }
  }
  if (!input.workItem.residualRisk?.trim()) {
    throw new Error("Feedback draft PR requires residual risk closeout.");
  }
  const approval = requirePublicationApproval({
    approval: input.approval,
    feedbackId: repair.feedbackId,
    evidenceKind: "pr-approval",
    message: "Feedback draft PR requires explicit approval.",
  });
  const branchName = redactRequiredText(input.branchName, "Feedback draft PR requires a branch name.");
  const title = redactRequiredText(input.title, "Feedback draft PR requires a title.");
  const body = redactRequiredText(input.body, "Feedback draft PR requires a body.");
  const changedFiles = normalizeRequiredRedactedList(input.changedFiles, "Feedback draft PR requires changed files.");
  const reviewEvidenceUris = normalizeRequiredList(input.reviewEvidenceUris, "Feedback draft PR requires review evidence.");

  return {
    feedbackId: repair.feedbackId,
    sourceFeedbackId: repair.feedbackId,
    repairWorkItemId: input.workItem.id,
    status: "draft-local",
    branchName,
    title,
    body,
    changedFiles,
    reviewEvidenceUris,
    approval,
    evidence: {
      tests: true,
      typecheck: true,
      review: true,
      residualRisk: true,
    },
    publication: {
      allowed: false,
      reason: "requires-explicit-approval",
    },
  };
}

function evidenceSelected(kind: FeedbackEvidenceKind, selection: FeedbackEvidenceSelection): boolean {
  switch (kind) {
    case "session-summary":
      return selection.includeSessionSummary;
    case "transcript-excerpt":
      return selection.includeTranscriptExcerpts;
    case "tool-failure":
      return selection.includeToolFailures;
    case "command-output":
      return selection.includeCommandOutput;
    case "environment":
      return selection.includeEnvironment;
    case "git-status":
      return selection.includeGitStatus;
    case "log-excerpt":
      return selection.includeLogs;
    case "file-change-summary":
      return selection.includeFileChangeSummary;
    case "diagnostic-finding":
      return selection.includeDiagnosticFindings;
  }
}

function renderEvidence(evidence: readonly FeedbackEvidenceItem[]): string[] {
  if (evidence.length === 0) return ["_No evidence selected._"];
  return evidence.flatMap((item) => {
    const fence = markdownFenceFor(item.content);
    return [
      `### ${item.title}`,
      "",
      `Kind: \`${item.kind}\``,
      "",
      `${fence}text`,
      item.content,
      fence,
      "",
    ];
  });
}

function redactProviderResponse(response: FeedbackIssueProviderResponse): FeedbackIssueProviderResponse {
  return {
    provider: response.provider,
    status: response.status,
    ...(response.externalId ? { externalId: redactFeedbackText(response.externalId).text } : {}),
    ...(response.url ? { url: redactFeedbackText(response.url).text } : {}),
    ...(response.rawResponsePreview ? { rawResponsePreview: redactFeedbackText(response.rawResponsePreview).text } : {}),
  };
}

function requirePublicationApproval(input: {
  readonly approval: FeedbackPublicationApproval;
  readonly feedbackId: string;
  readonly evidenceKind: "approval" | "pr-approval";
  readonly message: string;
}): RedactedFeedbackApprovalEvidence {
  if (input.approval.approved !== true) {
    throw new Error(input.message);
  }
  const approvedBy = redactRequiredText(input.approval.approvedBy, "Feedback publication approval actor is required.");
  const approvedAt = requireCanonicalUtcTimestamp(input.approval.approvedAt, "Feedback publication approval timestamp is required.");
  const resourceUris = normalizeRequiredList(input.approval.resourceUris, "Feedback publication requires approval evidence.");
  const expected = `kiln://feedback/${encodeURIComponent(input.feedbackId)}/${input.evidenceKind}`;
  if (!resourceUris.every((uri) => uri === expected)) {
    throw new Error("Feedback publication approval evidence must be the local feedback resource URI.");
  }
  return {
    approvedBy,
    approvedAt,
    resourceUris,
  };
}

function requireWorkItemEvidence(workItem: WorkItem, evidence: string, message: string): void {
  if (!workItem.providedEvidence.includes(evidence)) {
    throw new Error(message);
  }
}

function redactRequiredText(value: string, message: string): string {
  const redacted = redactFeedbackText(value).text.trim();
  if (!redacted) {
    throw new Error(message);
  }
  return redacted;
}

function normalizeRequiredRedactedList(values: readonly string[], message: string): readonly string[] {
  return normalizeRequiredList(values.map((value) => redactFeedbackText(value).text), message);
}

function normalizeRequiredList(values: readonly string[], message: string): readonly string[] {
  const normalized = [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
  if (normalized.length === 0) {
    throw new Error(message);
  }
  return normalized;
}

function requireCanonicalUtcTimestamp(value: string, message: string): string {
  const timestamp = value.trim();
  const canonicalUtcIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const parsed = Date.parse(timestamp);
  if (!canonicalUtcIso.test(timestamp) || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new Error(message);
  }
  return timestamp;
}

function markdownFenceFor(content: string): string {
  const backtickRuns = content.match(/`+/g) ?? [];
  const longestRun = backtickRuns.reduce((longest, run) => Math.max(longest, run.length), 0);
  return "`".repeat(Math.max(3, longestRun + 1));
}

function overlapsExistingMatch(
  matches: readonly FeedbackRedactionFinding[],
  startIndex: number,
  endIndex: number,
): boolean {
  return matches.some((match) => startIndex < match.endIndex && endIndex > match.startIndex);
}

function localOnlyPublicationGate(): FeedbackPublicationGate {
  return {
    allowed: false,
    reason: "local-only-default",
  };
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new RangeError(`${field} is required.`);
  }
}

function assertValidIsoTimestamp(value: string, field: string): void {
  const canonicalUtcIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const parsed = Date.parse(value);
  if (!canonicalUtcIso.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new RangeError(`${field} must be a canonical ISO UTC timestamp.`);
  }
}
