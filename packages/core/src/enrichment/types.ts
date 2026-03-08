// Conversation enrichment types -- pure TypeScript interfaces, zero dependencies

/** Sentiment polarity */
export interface SentimentScore {
  readonly polarity: "positive" | "neutral" | "negative";
  readonly score: number; // -1.0 to 1.0
  readonly confidence: number; // 0-1
}

export type ResolutionStatus = "resolved" | "partial" | "unresolved" | "ambiguous";

export interface ResolutionResult {
  readonly status: ResolutionStatus;
  readonly confidence: number;
  readonly evidence: string;
}

export interface TopicTag {
  readonly label: string;
  readonly subtopic?: string;
  readonly confidence: number;
  readonly prominence: number; // 0.0-1.0
}

export interface CsatPrediction {
  readonly score: number; // 0-5
  readonly confidence: number; // 0-1
  readonly basis: readonly string[];
}

export type SentimentArcPattern =
  | "consistently_positive"
  | "consistently_negative"
  | "improving"
  | "declining"
  | "volatile"
  | "neutral_throughout";

export interface SentimentPoint {
  readonly turnIndex: number;
  readonly polarity: "positive" | "neutral" | "negative";
  readonly score: number;
}

export interface EffortComponents {
  readonly userTurns: number;
  readonly clarificationRequests: number;
  readonly toolErrors: number;
  readonly agentHandoffs: number;
  readonly escalated: boolean;
}

export interface AgentPerformanceMetrics {
  readonly agentId: string;
  readonly agentName: string;
  readonly turnsHandled: number;
  readonly resolutionContribution: "primary" | "partial" | "none";
  readonly sentimentDelta: number;
}

/** Full enrichment output for a completed conversation */
export interface ConversationEnrichment {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly enrichedAt: string;
  readonly summary: string;
  readonly topics: readonly TopicTag[];
  readonly topicDrift: boolean;
  readonly resolution: ResolutionResult;
  readonly effortScore: number;
  readonly effortComponents: EffortComponents;
  readonly csatPrediction: CsatPrediction;
  readonly sentimentArc: readonly SentimentPoint[];
  readonly sentimentArcPattern: SentimentArcPattern;
  readonly overallSentiment: SentimentScore;
  readonly agentPerformance: readonly AgentPerformanceMetrics[];
  readonly language?: string;
  readonly multilingual: boolean;
  readonly piiRedacted: boolean;
  readonly turnCount: number;
  readonly userTurnCount: number;
  readonly durationMs: number;
}

/** Minimal session data needed for enrichment */
export interface CompletedSession {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly conversationHistory: readonly {
    readonly role: string;
    readonly content: string;
  }[];
  readonly createdAt: Date;
  readonly closedAt: Date;
  readonly closedBy: "user" | "operator" | "session_timeout" | "resolved";
  readonly agentTurnHistory?: readonly {
    readonly agentId: string;
    readonly agentName: string;
    readonly fromTurn: number;
    readonly toTurn: number;
  }[];
  readonly toolExecutions?: readonly {
    readonly toolName: string;
    readonly success: boolean;
  }[];
  readonly escalated: boolean;
  readonly handoffCount: number;
}

/** Enrichment storage interface */
export interface EnrichmentStore {
  save(enrichment: ConversationEnrichment): Promise<void>;
  get(sessionId: string): Promise<ConversationEnrichment | undefined>;
  listByTenant(
    tenantId: string,
    limit?: number,
    cursor?: string,
  ): Promise<{
    readonly enrichments: readonly ConversationEnrichment[];
    readonly nextCursor?: string;
  }>;
  delete(sessionId: string): Promise<boolean>;
}

/** Enrichment pipeline interface */
export interface ConversationEnricher {
  enrich(session: CompletedSession): Promise<ConversationEnrichment | undefined>;
}
