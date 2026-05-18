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
import { PII_PATTERNS } from "../safety/pii-scanner.js";
