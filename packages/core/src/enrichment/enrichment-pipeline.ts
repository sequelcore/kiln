import type { ProviderAdapter } from "../agents/index.js";
import type {
  ConversationEnricher,
  CompletedSession,
  ConversationEnrichment,
  SentimentArcPattern,
} from "./types.js";
import { computeEffortScore } from "./effort-score.js";
import { textPart } from "../engine/domain/content.js";

const MIN_USER_TURNS_FOR_LLM = 2;

const ENRICHMENT_SYSTEM_PROMPT = `You are a conversation analyst. Analyze a completed customer support conversation and extract structured metadata.

Return ONLY a valid JSON object with these fields:
{
  "summary": "<2-4 sentence summary of what happened>",
  "topics": [{"label": "...", "subtopic": "...", "confidence": 0.0-1.0, "prominence": 0.0-1.0}],
  "topicDrift": true|false,
  "resolution": {"status": "resolved|partial|unresolved|ambiguous", "confidence": 0.0-1.0, "evidence": "..."},
  "sentimentArc": [{"turnIndex": 0, "polarity": "positive|neutral|negative", "score": -1.0 to 1.0}],
  "overallSentiment": {"polarity": "positive|neutral|negative", "score": -1.0 to 1.0, "confidence": 0.0-1.0},
  "csatPrediction": {"score": 0.0-5.0, "confidence": 0.0-1.0, "basis": ["..."]},
  "agentContributions": [{"agentId": "...", "resolutionContribution": "primary|partial|none", "sentimentDelta": -1.0 to 1.0}],
  "language": "<ISO 639-1 code>",
  "multilingual": true|false,
  "clarificationRequests": 0
}

RULES:
- sentimentArc: USER turns only, ordered by turn index
- resolution: "resolved" requires the customer's original problem was addressed, NOT just a polite closing
- topics: ordered by prominence descending, max 5
- Do NOT include customer names, order numbers, email addresses, or phone numbers in any field
- If fewer than 2 user messages, return minimal analysis`;

export class LlmConversationEnricher implements ConversationEnricher {
  constructor(private readonly provider: ProviderAdapter) {}

  async enrich(
    session: CompletedSession,
  ): Promise<ConversationEnrichment | undefined> {
    const userTurnCount = session.conversationHistory.filter(
      (m) => m.role === "user",
    ).length;
    const durationMs = session.closedAt.getTime() - session.createdAt.getTime();

    // Build effort components from session data
    const toolErrors =
      session.toolExecutions?.filter((t) => !t.success).length ?? 0;
    const effortComponents = {
      userTurns: userTurnCount,
      clarificationRequests: 0, // Will be updated from LLM response
      toolErrors,
      agentHandoffs: session.handoffCount,
      escalated: session.escalated,
    };

    // Short conversation guard: skip LLM for <2 user turns
    if (userTurnCount < MIN_USER_TURNS_FOR_LLM) {
      return this.buildMinimalEnrichment(
        session,
        effortComponents,
        durationMs,
        userTurnCount,
      );
    }

    try {
      const transcript = session.conversationHistory
        .map((m, i) => `[Turn ${i}] ${m.role}: ${m.content}`)
        .join("\n");

      const response = await this.provider.createMessage({
        system: ENRICHMENT_SYSTEM_PROMPT,
        messages: [{ role: "user", parts: [textPart(transcript)] }],
        maxTokens: 1500,
      });

      // Extract text from response
      const responseText = response.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");

      // Parse JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(
        /```(?:json)?\s*([\s\S]*?)```/,
      ) ?? [null, responseText];
      const parsed = JSON.parse(jsonMatch[1]?.trim() ?? responseText.trim());

      // Update clarification requests from LLM
      const updatedEffort = {
        ...effortComponents,
        clarificationRequests: parsed.clarificationRequests ?? 0,
      };

      const sentimentArc = Array.isArray(parsed.sentimentArc)
        ? parsed.sentimentArc
        : [];
      const arcPattern = deriveSentimentArcPattern(sentimentArc);

      const enrichment: ConversationEnrichment = {
        sessionId: session.sessionId,
        tenantId: session.tenantId,
        enrichedAt: new Date().toISOString(),
        summary: String(parsed.summary ?? ""),
        topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 5) : [],
        topicDrift: Boolean(parsed.topicDrift),
        resolution: {
          status: parsed.resolution?.status ?? "ambiguous",
          confidence: parsed.resolution?.confidence ?? 0,
          evidence: String(parsed.resolution?.evidence ?? ""),
        },
        effortScore: computeEffortScore(updatedEffort),
        effortComponents: updatedEffort,
        csatPrediction: {
          score: parsed.csatPrediction?.score ?? 3,
          confidence: parsed.csatPrediction?.confidence ?? 0,
          basis: Array.isArray(parsed.csatPrediction?.basis)
            ? parsed.csatPrediction.basis
            : [],
        },
        sentimentArc,
        sentimentArcPattern: arcPattern,
        overallSentiment: {
          polarity: parsed.overallSentiment?.polarity ?? "neutral",
          score: parsed.overallSentiment?.score ?? 0,
          confidence: parsed.overallSentiment?.confidence ?? 0,
        },
        agentPerformance: this.buildAgentPerformance(
          session,
          parsed.agentContributions,
        ),
        language: parsed.language,
        multilingual: Boolean(parsed.multilingual),
        piiRedacted: false, // Set by the runner after PII scan
        turnCount: session.conversationHistory.length,
        userTurnCount,
        durationMs,
      };

      return enrichment;
    } catch {
      // Enrichment failures are non-critical, return minimal
      return this.buildMinimalEnrichment(
        session,
        effortComponents,
        durationMs,
        userTurnCount,
      );
    }
  }

  private buildMinimalEnrichment(
    session: CompletedSession,
    effortComponents: {
      userTurns: number;
      clarificationRequests: number;
      toolErrors: number;
      agentHandoffs: number;
      escalated: boolean;
    },
    durationMs: number,
    userTurnCount: number,
  ): ConversationEnrichment {
    return {
      sessionId: session.sessionId,
      tenantId: session.tenantId,
      enrichedAt: new Date().toISOString(),
      summary: "",
      topics: [],
      topicDrift: false,
      resolution: {
        status: "ambiguous",
        confidence: 0,
        evidence: "Insufficient data",
      },
      effortScore: computeEffortScore(effortComponents),
      effortComponents,
      csatPrediction: { score: 3, confidence: 0, basis: [] },
      sentimentArc: [],
      sentimentArcPattern: "neutral_throughout",
      overallSentiment: { polarity: "neutral", score: 0, confidence: 0 },
      agentPerformance: [],
      multilingual: false,
      piiRedacted: false,
      turnCount: session.conversationHistory.length,
      userTurnCount,
      durationMs,
    };
  }

  private buildAgentPerformance(
    session: CompletedSession,
    contributions?: readonly {
      agentId: string;
      resolutionContribution: string;
      sentimentDelta: number;
    }[],
  ): ConversationEnrichment["agentPerformance"] {
    if (!session.agentTurnHistory || session.agentTurnHistory.length === 0)
      return [];
    return session.agentTurnHistory.map((agent) => {
      const contribution = contributions?.find(
        (c) => c.agentId === agent.agentId,
      );
      return {
        agentId: agent.agentId,
        agentName: agent.agentName,
        turnsHandled: agent.toTurn - agent.fromTurn + 1,
        resolutionContribution:
          (contribution?.resolutionContribution as
            | "primary"
            | "partial"
            | "none") ?? "none",
        sentimentDelta: contribution?.sentimentDelta ?? 0,
      };
    });
  }
}

export function deriveSentimentArcPattern(
  arc: readonly { score: number }[],
): SentimentArcPattern {
  if (arc.length < 2) return "neutral_throughout";

  const scores = arc.map((p) => p.score);
  const allPositive = scores.every((s) => s > 0.1);
  const allNegative = scores.every((s) => s < -0.1);
  const allNeutral = scores.every((s) => Math.abs(s) <= 0.1);

  if (allPositive) return "consistently_positive";
  if (allNegative) return "consistently_negative";
  if (allNeutral) return "neutral_throughout";

  // Check trend: improving or declining
  const firstHalf = scores.slice(0, Math.ceil(scores.length / 2));
  const secondHalf = scores.slice(Math.ceil(scores.length / 2));
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  const diff = avgSecond - avgFirst;
  if (diff > 0.3) return "improving";
  if (diff < -0.3) return "declining";

  // Check volatility
  let volatility = 0;
  for (let i = 1; i < scores.length; i++) {
    volatility += Math.abs(scores[i]! - scores[i - 1]!);
  }
  if (volatility / scores.length > 0.4) return "volatile";

  return "neutral_throughout";
}
