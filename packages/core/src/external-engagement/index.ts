import type { ActionEffectEnvelope } from "../engine/domain/action-effect.js";

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
