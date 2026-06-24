import type { ActionEffectEnvelope } from "../engine/domain/action-effect.js";
import { createSecretRef, type SecretRef } from "../credentials/index.js";

export type ExternalEvidenceSource = "x";

export type ExternalEvidenceCapability = "read_external_evidence";

export type ExternalEngagementProhibitedAction =
  | "publish_post"
  | "reply"
  | "like"
  | "repost"
  | "follow"
  | "send_direct_message";

export type CommunitySignalKind =
  | "pain_point"
  | "feature_request"
  | "objection"
  | "workflow_pattern"
  | "validation_evidence";

export type CommunitySignalRecommendation = "adopt" | "adapt" | "reject" | "later";

export type CommunitySignalConfidence = "low" | "medium" | "high";

export type CommunitySignalTheme =
  | "agent_quality"
  | "workflow_controls"
  | "cost_control"
  | "adoption_risk"
  | "useful_outcome";

export interface XPostReference {
  readonly platform: "x";
  readonly postId: string;
  readonly sourceUrl: string;
}

export interface ExternalEvidenceAuthor {
  readonly id: string;
  readonly username?: string;
  readonly displayName?: string;
}

export interface ExternalEvidenceMetrics {
  readonly replies?: number;
  readonly reposts?: number;
  readonly likes?: number;
  readonly quotes?: number;
  readonly bookmarks?: number;
  readonly impressions?: number;
}

export interface ExternalEvidenceArtifact {
  readonly platform: ExternalEvidenceSource;
  readonly artifactId: string;
  readonly kind: "post" | "reply" | "quote";
  readonly sourceUrl: string;
  readonly text: string;
  readonly author?: ExternalEvidenceAuthor;
  readonly metrics?: ExternalEvidenceMetrics;
  readonly retrievedAt: string;
  readonly parentArtifactId?: string;
  readonly conversationId?: string;
}

export interface CommunitySignal {
  readonly kind: CommunitySignalKind;
  readonly theme: CommunitySignalTheme;
  readonly summary: string;
  readonly evidenceArtifactIds: readonly string[];
  readonly recommendation: CommunitySignalRecommendation;
  readonly confidence: CommunitySignalConfidence;
}

export type FeatureCandidatePublicValue = "community-grounded" | "unclear";
export type FeatureCandidateArchitectureFit = "core-domain-first";
export type FeatureCandidateImplementationRisk = "medium" | "high";

export interface FeatureCandidateStandardsAssessment {
  readonly publicValue: FeatureCandidatePublicValue;
  readonly architectureFit: FeatureCandidateArchitectureFit;
  readonly implementationRisk: FeatureCandidateImplementationRisk;
  readonly notes: readonly string[];
}

export interface FeatureCandidate {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly sourceSignalKinds: readonly CommunitySignalKind[];
  readonly sourceThemes: readonly CommunitySignalTheme[];
  readonly evidenceArtifactIds: readonly string[];
  readonly recommendation: CommunitySignalRecommendation;
  readonly confidence: CommunitySignalConfidence;
  readonly standardsAssessment: FeatureCandidateStandardsAssessment;
}

export interface FeatureCandidateReport {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly sourceReportId: string;
  readonly candidates: readonly FeatureCandidate[];
}

export type FeatureCandidateDecisionKind = "accept" | "defer" | "reject" | "narrow";

export interface FeatureCandidateDecisionInput {
  readonly candidateId: string;
  readonly decision: FeatureCandidateDecisionKind;
  readonly evidenceArtifactIds: readonly string[];
  readonly reason?: string;
  readonly narrowedScope?: string;
}

export interface FeatureCandidateDecisionRecord {
  readonly candidateId: string;
  readonly candidateTitle: string;
  readonly decision: FeatureCandidateDecisionKind;
  readonly sourceThemes: readonly CommunitySignalTheme[];
  readonly evidenceArtifactIds: readonly string[];
  readonly reason?: string;
  readonly narrowedScope?: string;
}

export interface FeatureCandidateDecisionReport {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly sourceCandidateReportId: string;
  readonly decisions: readonly FeatureCandidateDecisionRecord[];
}

export interface ExternalEngagementReviewItem {
  readonly candidateId: string;
  readonly title: string;
  readonly recommendation: CommunitySignalRecommendation;
  readonly confidence: CommunitySignalConfidence;
  readonly evidenceArtifactIds: readonly string[];
  readonly reviewPrompts: readonly string[];
}

export interface ExternalEngagementReviewReport {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly sourceCandidateReportId: string;
  readonly items: readonly ExternalEngagementReviewItem[];
  readonly markdown: string;
}

export interface XEvidenceRequestBudget {
  readonly rootPostReads: number;
  readonly replySearches: number;
  readonly maxReplyReads: number;
  readonly userReads: number;
  readonly maxPostReads: number;
  readonly estimatedRequests: number;
}

export interface XEvidenceQuery {
  readonly references: readonly XPostReference[];
  readonly maxRepliesPerPost: number;
}

export interface ExternalEvidenceReport {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly source: ExternalEvidenceSource;
  readonly capabilities: readonly ExternalEvidenceCapability[];
  readonly prohibitedActions: readonly ExternalEngagementProhibitedAction[];
  readonly query: XEvidenceQuery;
  readonly budget: XEvidenceRequestBudget;
  readonly artifacts: readonly ExternalEvidenceArtifact[];
  readonly signals: readonly CommunitySignal[];
}

export interface XReadAccessTokenRefInput {
  readonly envName?: string;
  readonly expiresAt?: string;
  readonly refreshSecretRefId?: string;
  readonly nextRefreshAt?: string;
}

export interface XOAuth2CredentialRefInput {
  readonly envName?: string;
}

export const EXTERNAL_EVIDENCE_READ_EFFECT: ActionEffectEnvelope = Object.freeze({
  operation: "observe",
  boundaries: Object.freeze(["network", "external-system"] as const),
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "authenticated",
  consequences: Object.freeze(["external-state"] as const),
  idempotency: "idempotent",
});

export const EXTERNAL_ENGAGEMENT_PHASE_ONE_PROHIBITED_ACTIONS: readonly ExternalEngagementProhibitedAction[] =
  Object.freeze([
    "publish_post",
    "reply",
    "like",
    "repost",
    "follow",
    "send_direct_message",
  ]);

const X_POST_URL_PATTERN = /^https:\/\/(?:x|twitter)\.com\/[^/?#]+\/status\/(\d+)(?:[/?#].*)?$/u;
const X_POST_ID_PATTERN = /^\d{5,}$/u;
const X_ID_BATCH_SIZE = 100;
const DEFAULT_X_ACCESS_TOKEN_ENV = "KILN_X_OAUTH2_ACCESS_TOKEN";
const DEFAULT_X_REFRESH_TOKEN_ENV = "KILN_X_OAUTH2_REFRESH_TOKEN";
const DEFAULT_X_CLIENT_ID_ENV = "KILN_X_CLIENT_ID";
const DEFAULT_X_CLIENT_SECRET_ENV = "KILN_X_CLIENT_SECRET";

export function createXReadAccessTokenRef(input: XReadAccessTokenRefInput = {}): SecretRef {
  return createSecretRef({
    id: "x-oauth2-access-token",
    purpose: "external-engagement:x:read",
    scopes: ["x:post.read", "x:user.read"],
    source: { kind: "env", name: input.envName ?? DEFAULT_X_ACCESS_TOKEN_ENV },
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...(input.refreshSecretRefId || input.nextRefreshAt
      ? {
          refresh: {
            kind: "oauth2-refresh-token",
            ...(input.refreshSecretRefId ? { refreshSecretRefId: input.refreshSecretRefId } : {}),
            ...(input.nextRefreshAt ? { nextRefreshAt: input.nextRefreshAt } : {}),
          },
        }
      : {}),
  });
}

export function createXOAuth2RefreshTokenRef(input: XOAuth2CredentialRefInput = {}): SecretRef {
  return createSecretRef({
    id: "x-oauth2-refresh-token",
    purpose: "external-engagement:x:oauth2-refresh",
    scopes: ["x:oauth2.refresh"],
    source: { kind: "env", name: input.envName ?? DEFAULT_X_REFRESH_TOKEN_ENV },
  });
}

export function createXOAuth2ClientIdRef(input: XOAuth2CredentialRefInput = {}): SecretRef {
  return createSecretRef({
    id: "x-oauth2-client-id",
    purpose: "external-engagement:x:oauth2-client",
    scopes: ["x:oauth2.token"],
    source: { kind: "env", name: input.envName ?? DEFAULT_X_CLIENT_ID_ENV },
  });
}

export function createXOAuth2ClientSecretRef(input: XOAuth2CredentialRefInput = {}): SecretRef {
  return createSecretRef({
    id: "x-oauth2-client-secret",
    purpose: "external-engagement:x:oauth2-client",
    scopes: ["x:oauth2.token"],
    source: { kind: "env", name: input.envName ?? DEFAULT_X_CLIENT_SECRET_ENV },
  });
}

export function normalizeXPostReferences(input: readonly string[]): readonly XPostReference[] {
  const references: XPostReference[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    const parsed = parseXPostReference(value);
    if (seen.has(parsed.postId)) {
      continue;
    }
    seen.add(parsed.postId);
    references.push(parsed);
  }
  return Object.freeze(references);
}

export function estimateXEvidenceRequestBudget(input: {
  readonly rootPostCount: number;
  readonly maxRepliesPerPost: number;
  readonly includeAuthors: boolean;
}): XEvidenceRequestBudget {
  const rootPostReads = positiveInteger(input.rootPostCount, "rootPostCount");
  const maxRepliesPerPost = nonNegativeInteger(input.maxRepliesPerPost, "maxRepliesPerPost");
  const replySearches = maxRepliesPerPost > 0 ? rootPostReads : 0;
  const maxReplyReads = rootPostReads * maxRepliesPerPost;
  const maxPostReads = rootPostReads + maxReplyReads;
  const userReads = input.includeAuthors ? maxPostReads : 0;
  const estimatedRequests =
    batchCount(rootPostReads, X_ID_BATCH_SIZE) +
    replySearches +
    (input.includeAuthors ? batchCount(userReads, X_ID_BATCH_SIZE) : 0);

  return {
    rootPostReads,
    replySearches,
    maxReplyReads,
    userReads,
    maxPostReads,
    estimatedRequests,
  };
}

export function buildExternalEvidenceReport(input: {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly source: ExternalEvidenceSource;
  readonly query: XEvidenceQuery;
  readonly budget: XEvidenceRequestBudget;
  readonly artifacts: readonly ExternalEvidenceArtifact[];
  readonly signals?: readonly CommunitySignal[];
}): ExternalEvidenceReport {
  return Object.freeze({
    reportId: requireNonEmpty(input.reportId, "reportId"),
    generatedAt: requireNonEmpty(input.generatedAt, "generatedAt"),
    source: input.source,
    capabilities: Object.freeze(["read_external_evidence"] as const),
    prohibitedActions: EXTERNAL_ENGAGEMENT_PHASE_ONE_PROHIBITED_ACTIONS,
    query: input.query,
    budget: input.budget,
    artifacts: Object.freeze([...input.artifacts]),
    signals: Object.freeze([...(input.signals ?? [])]),
  });
}

export function extractCommunitySignalsFromEvidence(input: {
  readonly artifacts: readonly ExternalEvidenceArtifact[];
}): readonly CommunitySignal[] {
  const evidenceByDefinitionId = new Map<string, string[]>();
  for (const artifact of input.artifacts) {
    const text = artifact.text.toLowerCase();
    const matches = COMMUNITY_SIGNAL_DEFINITIONS
      .filter((definition) => definition.patterns.some((pattern) => pattern.test(text)))
      .sort((left, right) =>
        left.selectionPriority - right.selectionPriority || left.selectionRank - right.selectionRank)
      .slice(0, MAX_SIGNALS_PER_ARTIFACT);
    for (const definition of matches) {
      const existing = evidenceByDefinitionId.get(definition.id) ?? [];
      if (!existing.includes(artifact.artifactId)) {
        existing.push(artifact.artifactId);
      }
      evidenceByDefinitionId.set(definition.id, existing);
    }
  }

  return Object.freeze(COMMUNITY_SIGNAL_DEFINITIONS.flatMap((definition): CommunitySignal[] => {
    const evidenceArtifactIds = evidenceByDefinitionId.get(definition.id) ?? [];
    if (evidenceArtifactIds.length === 0) {
      return [];
    }
    return [{
      kind: definition.kind,
      theme: definition.theme,
      summary: definition.summary,
      evidenceArtifactIds: Object.freeze([...evidenceArtifactIds]),
      recommendation: definition.recommendation,
      confidence: evidenceArtifactIds.length >= 2 ? "medium" : "low",
    }];
  }));
}

export function buildFeatureCandidateReport(input: {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly sourceReportId: string;
  readonly signals: readonly CommunitySignal[];
}): FeatureCandidateReport {
  return Object.freeze({
    reportId: requireNonEmpty(input.reportId, "reportId"),
    generatedAt: requireNonEmpty(input.generatedAt, "generatedAt"),
    sourceReportId: requireNonEmpty(input.sourceReportId, "sourceReportId"),
    candidates: Object.freeze(groupSignalsByTheme(input.signals).map((signals) => buildFeatureCandidate(signals))),
  });
}

export function buildExternalEngagementReviewReport(input: {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly candidateReport: FeatureCandidateReport;
}): ExternalEngagementReviewReport {
  const items = input.candidateReport.candidates.map((candidate): ExternalEngagementReviewItem => ({
    candidateId: candidate.id,
    title: candidate.title,
    recommendation: candidate.recommendation,
    confidence: candidate.confidence,
    evidenceArtifactIds: Object.freeze([...candidate.evidenceArtifactIds]),
    reviewPrompts: REVIEW_PROMPTS,
  }));
  return Object.freeze({
    reportId: requireNonEmpty(input.reportId, "reportId"),
    generatedAt: requireNonEmpty(input.generatedAt, "generatedAt"),
    sourceCandidateReportId: input.candidateReport.reportId,
    items: Object.freeze(items),
    markdown: renderExternalEngagementReviewMarkdown(input.candidateReport, items),
  });
}

export function buildFeatureCandidateDecisionReport(input: {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly candidateReport: FeatureCandidateReport;
  readonly decisions: readonly FeatureCandidateDecisionInput[];
}): FeatureCandidateDecisionReport {
  const candidatesById = new Map(input.candidateReport.candidates.map((candidate) => [candidate.id, candidate]));
  const seenCandidateIds = new Set<string>();
  const decisions = input.decisions.map((decisionInput): FeatureCandidateDecisionRecord => {
    const candidateId = requireNonEmpty(decisionInput.candidateId, "candidateId");
    if (seenCandidateIds.has(candidateId)) {
      throw new Error(`Duplicate decision for candidate ${candidateId}`);
    }
    seenCandidateIds.add(candidateId);
    const candidate = candidatesById.get(candidateId);
    if (!candidate) {
      throw new Error(`Decision references unknown candidate ${candidateId}`);
    }
    const decision = requireDecisionKind(decisionInput.decision);
    const evidenceArtifactIds = unique(decisionInput.evidenceArtifactIds.map((artifactId) =>
      requireNonEmpty(artifactId, "evidenceArtifactId")));
    if (evidenceArtifactIds.length === 0) {
      throw new Error(`Decision for candidate ${candidateId} requires at least one evidence artifact id`);
    }
    for (const artifactId of evidenceArtifactIds) {
      if (!candidate.evidenceArtifactIds.includes(artifactId)) {
        throw new Error(`Evidence artifact ${artifactId} is not part of candidate ${candidateId}`);
      }
    }
    const reason = optionalNonEmpty(decisionInput.reason, "reason");
    if ((decision === "accept" || decision === "reject" || decision === "narrow") && !reason) {
      throw new Error(`Decision ${decision} for candidate ${candidateId} requires a reason`);
    }
    const narrowedScope = optionalNonEmpty(decisionInput.narrowedScope, "narrowedScope");
    if (decision === "narrow" && !narrowedScope) {
      throw new Error(`Decision narrow for candidate ${candidateId} requires narrowedScope`);
    }
    return Object.freeze({
      candidateId,
      candidateTitle: candidate.title,
      decision,
      sourceThemes: Object.freeze([...candidate.sourceThemes]),
      evidenceArtifactIds,
      ...(reason ? { reason } : {}),
      ...(narrowedScope ? { narrowedScope } : {}),
    });
  });
  return Object.freeze({
    reportId: requireNonEmpty(input.reportId, "reportId"),
    generatedAt: requireNonEmpty(input.generatedAt, "generatedAt"),
    sourceCandidateReportId: input.candidateReport.reportId,
    decisions: Object.freeze(decisions),
  });
}

function parseXPostReference(value: string): XPostReference {
  const urlMatch = value.match(X_POST_URL_PATTERN);
  if (urlMatch?.[1]) {
    return {
      platform: "x",
      postId: urlMatch[1],
      sourceUrl: value,
    };
  }
  if (X_POST_ID_PATTERN.test(value)) {
    return {
      platform: "x",
      postId: value,
      sourceUrl: `https://x.com/i/status/${value}`,
    };
  }
  throw new Error(`Unsupported X post reference: ${value}`);
}

const COMMUNITY_SIGNAL_DEFINITIONS: readonly {
  readonly id: string;
  readonly kind: CommunitySignalKind;
  readonly theme: CommunitySignalTheme;
  readonly summary: string;
  readonly recommendation: CommunitySignalRecommendation;
  readonly patterns: readonly RegExp[];
  readonly selectionPriority: number;
  readonly selectionRank: number;
}[] = Object.freeze([
  {
    id: "agent-quality-pain",
    kind: "pain_point",
    theme: "agent_quality",
    summary: "Evidence reports agent or workflow failure, friction, or low-quality output.",
    recommendation: "adapt",
    patterns: [/fail/u, /friction/u, /slop/u, /useless/u, /confusing/u, /slow/u],
    selectionPriority: 10,
    selectionRank: 10,
  },
  {
    id: "workflow-controls-pattern",
    kind: "workflow_pattern",
    theme: "workflow_controls",
    summary: "Evidence describes repeatable process controls such as plans, review gates, tests, guardrails, or loops.",
    recommendation: "adopt",
    patterns: [/\bprocess\b/u, /\breview\b/u, /\bgate\b/u, /\btest\b/u, /\bguardrail/u, /\bplan/u, /\bplanning\b/u, /\bloop\b/u],
    selectionPriority: 20,
    selectionRank: 30,
  },
  {
    id: "cost-control-pain",
    kind: "pain_point",
    theme: "cost_control",
    summary: "Evidence highlights cost, paid API, cache, budget, or spend-control pressure.",
    recommendation: "adapt",
    patterns: [/\bcost\b/u, /\bpaid\b/u, /\bbudget\b/u, /\bspend\b/u, /\brisky\b/u],
    selectionPriority: 10,
    selectionRank: 20,
  },
  {
    id: "cost-control-workflow",
    kind: "workflow_pattern",
    theme: "cost_control",
    summary: "Evidence describes cache or budget controls as part of repeatable research workflow.",
    recommendation: "adopt",
    patterns: [/\bcache\b/u, /\bcached\b/u, /\bbudget\b/u, /\bpaid\b/u],
    selectionPriority: 20,
    selectionRank: 20,
  },
  {
    id: "adoption-risk-objection",
    kind: "objection",
    theme: "adoption_risk",
    summary: "Evidence raises concerns, tradeoffs, objections, or reasons not to adopt blindly.",
    recommendation: "later",
    patterns: [/\bbut\b/u, /\bhowever\b/u, /\bconcern/u, /\bwhy\b/u, /\bworst\b/u, /\boverengineer/u, /\btradeoff/u],
    selectionPriority: 30,
    selectionRank: 40,
  },
  {
    id: "useful-outcome-validation",
    kind: "validation_evidence",
    theme: "useful_outcome",
    summary: "Evidence reports useful outcomes, found issues, shipped work, or practical validation.",
    recommendation: "adapt",
    patterns: [/\buseful\b/u, /\bfound\b/u, /\bfixed\b/u, /\bshipped\b/u, /\bworks\b/u, /\bvalidated\b/u],
    selectionPriority: 30,
    selectionRank: 50,
  },
  {
    id: "feature-request",
    kind: "feature_request",
    theme: "workflow_controls",
    summary: "Evidence asks for an added capability, support path, or product workflow.",
    recommendation: "adapt",
    patterns: [/\bneed\b/u, /\bneeds\b/u, /\bwant\b/u, /\bwish\b/u, /\bshould\b/u, /\bcould\b/u, /\bwould\b/u, /\badd\b/u, /\bsupport\b/u],
    selectionPriority: 40,
    selectionRank: 60,
  },
]);

const MAX_SIGNALS_PER_ARTIFACT = 2;

const REVIEW_PROMPTS: readonly string[] = Object.freeze([
  "Does this candidate solve a public Kiln user need, not only an internal Sequel workflow?",
  "Can this be implemented through core domain contracts before provider adapters?",
  "What would make this safe to reject, defer, or narrow?",
]);

function buildFeatureCandidate(signals: readonly CommunitySignal[]): FeatureCandidate {
  const primary = signals[0]!;
  const evidenceArtifactIds = unique(signals.flatMap((signal) => signal.evidenceArtifactIds));
  const standardsAssessment: FeatureCandidateStandardsAssessment = {
    publicValue: evidenceArtifactIds.length > 0 ? "community-grounded" : "unclear",
    architectureFit: "core-domain-first",
    implementationRisk: signals.some((signal) => signal.kind === "objection") ? "high" : "medium",
    notes: Object.freeze([
      "Keep source evidence separate from write-capable actions.",
      "Prefer pure domain contracts before provider adapters.",
      "Avoid compatibility shims, generated boilerplate, and hidden side effects.",
    ]),
  };
  return Object.freeze({
    id: `candidate-${primary.theme.replaceAll("_", "-")}`,
    title: featureCandidateTitle(primary.theme),
    summary: primary.summary,
    sourceSignalKinds: unique(signals.map((signal) => signal.kind)),
    sourceThemes: Object.freeze([primary.theme]),
    evidenceArtifactIds,
    recommendation: strongestRecommendation(signals.map((signal) => signal.recommendation)),
    confidence: strongestConfidence([...signals.map((signal) => signal.confidence), evidenceArtifactIds.length >= 2 ? "medium" : "low"]),
    standardsAssessment,
  });
}

function groupSignalsByTheme(signals: readonly CommunitySignal[]): readonly (readonly CommunitySignal[])[] {
  const byTheme = new Map<CommunitySignalTheme, CommunitySignal[]>();
  for (const signal of signals) {
    byTheme.set(signal.theme, [...(byTheme.get(signal.theme) ?? []), signal]);
  }
  return Object.freeze([...byTheme.values()].map((group) => Object.freeze([...group])));
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}

function strongestRecommendation(
  recommendations: readonly CommunitySignalRecommendation[],
): CommunitySignalRecommendation {
  for (const recommendation of ["adopt", "adapt", "later", "reject"] as const) {
    if (recommendations.includes(recommendation)) {
      return recommendation;
    }
  }
  return "later";
}

function strongestConfidence(confidences: readonly CommunitySignalConfidence[]): CommunitySignalConfidence {
  if (confidences.includes("high")) {
    return "high";
  }
  if (confidences.includes("medium")) {
    return "medium";
  }
  return "low";
}

function featureCandidateTitle(theme: CommunitySignalTheme): string {
  if (theme === "agent_quality") {
    return "Agent quality and reliability support";
  }
  if (theme === "workflow_controls") {
    return "Governed workflow pattern support";
  }
  if (theme === "cost_control") {
    return "Cost-aware evidence workflow support";
  }
  if (theme === "adoption_risk") {
    return "Objection and risk review support";
  }
  return "Validation evidence support";
}

function renderExternalEngagementReviewMarkdown(
  candidateReport: FeatureCandidateReport,
  items: readonly ExternalEngagementReviewItem[],
): string {
  const lines = [
    "# External Engagement Review",
    "",
    `Source candidate report: ${candidateReport.reportId}`,
  ];
  for (const item of items) {
    const candidate = candidateReport.candidates.find((entry) => entry.id === item.candidateId);
    lines.push(
      "",
      `## ${item.title}`,
      "",
      `- Candidate: ${item.candidateId}`,
      `- Recommendation: ${item.recommendation}`,
      `- Confidence: ${item.confidence}`,
      `- Evidence artifacts: ${item.evidenceArtifactIds.join(", ")}`,
      `- Themes: ${(candidate?.sourceThemes ?? []).join(", ")}`,
      "",
      "Review prompts:",
      ...item.reviewPrompts.map((prompt) => `- ${prompt}`),
    );
  }
  return lines.join("\n");
}

function batchCount(count: number, batchSize: number): number {
  return count === 0 ? 0 : Math.ceil(count / batchSize);
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} must be non-empty`);
  }
  return trimmed;
}

function optionalNonEmpty(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNonEmpty(value, field);
}

function requireDecisionKind(value: FeatureCandidateDecisionKind): FeatureCandidateDecisionKind {
  if (value === "accept" || value === "defer" || value === "reject" || value === "narrow") {
    return value;
  }
  throw new Error(`Unsupported feature candidate decision: ${String(value)}`);
}
