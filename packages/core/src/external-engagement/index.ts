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
  const evidenceByKind = new Map<CommunitySignalKind, string[]>();
  for (const artifact of input.artifacts) {
    const text = artifact.text.toLowerCase();
    for (const definition of COMMUNITY_SIGNAL_DEFINITIONS) {
      if (!definition.patterns.some((pattern) => pattern.test(text))) {
        continue;
      }
      const existing = evidenceByKind.get(definition.kind) ?? [];
      if (!existing.includes(artifact.artifactId)) {
        existing.push(artifact.artifactId);
      }
      evidenceByKind.set(definition.kind, existing);
    }
  }

  return Object.freeze(COMMUNITY_SIGNAL_DEFINITIONS.flatMap((definition): CommunitySignal[] => {
    const evidenceArtifactIds = evidenceByKind.get(definition.kind) ?? [];
    if (evidenceArtifactIds.length === 0) {
      return [];
    }
    return [{
      kind: definition.kind,
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
    candidates: Object.freeze(input.signals.map((signal) => buildFeatureCandidate(signal))),
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
  readonly kind: CommunitySignalKind;
  readonly summary: string;
  readonly recommendation: CommunitySignalRecommendation;
  readonly patterns: readonly RegExp[];
}[] = Object.freeze([
  {
    kind: "pain_point",
    summary: "Evidence reports agent or workflow failure, friction, cost, or low-quality output.",
    recommendation: "adapt",
    patterns: [/fail/u, /friction/u, /cost/u, /paid/u, /risk/u, /risky/u, /slop/u, /useless/u, /confusing/u, /slow/u],
  },
  {
    kind: "feature_request",
    summary: "Evidence asks for an added capability, support path, or product workflow.",
    recommendation: "adapt",
    patterns: [/\bneed\b/u, /\bneeds\b/u, /\bwant\b/u, /\bwish\b/u, /\bshould\b/u, /\bcould\b/u, /\bwould\b/u, /\badd\b/u, /\bsupport\b/u],
  },
  {
    kind: "objection",
    summary: "Evidence raises concerns, tradeoffs, objections, or reasons not to adopt blindly.",
    recommendation: "later",
    patterns: [/\bbut\b/u, /\bhowever\b/u, /\bconcern/u, /\bwhy\b/u, /\bworst\b/u, /\boverengineer/u, /\btradeoff/u],
  },
  {
    kind: "workflow_pattern",
    summary: "Evidence describes repeatable process controls such as plans, review gates, tests, guardrails, or caches.",
    recommendation: "adopt",
    patterns: [/\bworkflow\b/u, /\bprocess\b/u, /\breview\b/u, /\bgate\b/u, /\btest\b/u, /\bguardrail/u, /\bplan/u, /\bloop\b/u, /\bcache/u, /\bcached\b/u],
  },
  {
    kind: "validation_evidence",
    summary: "Evidence reports useful outcomes, found issues, shipped work, or practical validation.",
    recommendation: "adapt",
    patterns: [/\buseful\b/u, /\bfound\b/u, /\bfixed\b/u, /\bshipped\b/u, /\bworks\b/u, /\bvalidated\b/u],
  },
]);

function buildFeatureCandidate(signal: CommunitySignal): FeatureCandidate {
  const standardsAssessment: FeatureCandidateStandardsAssessment = {
    publicValue: signal.evidenceArtifactIds.length > 0 ? "community-grounded" : "unclear",
    architectureFit: "core-domain-first",
    implementationRisk: signal.kind === "objection" ? "high" : "medium",
    notes: Object.freeze([
      "Keep source evidence separate from write-capable actions.",
      "Prefer pure domain contracts before provider adapters.",
      "Avoid compatibility shims, generated boilerplate, and hidden side effects.",
    ]),
  };
  return Object.freeze({
    id: `candidate-${signal.kind.replaceAll("_", "-")}`,
    title: featureCandidateTitle(signal.kind),
    summary: signal.summary,
    sourceSignalKinds: Object.freeze([signal.kind]),
    evidenceArtifactIds: Object.freeze([...signal.evidenceArtifactIds]),
    recommendation: signal.recommendation,
    confidence: signal.confidence,
    standardsAssessment,
  });
}

function featureCandidateTitle(kind: CommunitySignalKind): string {
  if (kind === "pain_point") {
    return "Governed pain point support";
  }
  if (kind === "feature_request") {
    return "Evidence-backed feature request support";
  }
  if (kind === "objection") {
    return "Objection and risk review support";
  }
  if (kind === "workflow_pattern") {
    return "Governed workflow pattern support";
  }
  return "Validation evidence support";
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
