import type { AgentMessage } from "@kilnai/core";
import { extractText } from "@kilnai/core";

export interface AbuseSignal {
  readonly type: "repetition" | "sequential";
  readonly confidence: number;
  readonly detail: string;
}

export interface AbuseDetectionConfig {
  readonly windowSize?: number;
  readonly repetitionThreshold?: number;
}

const ABUSE_KEYWORDS = ["continue", "go on", "next", "more", "keep going"];

export function detectRepetitiveAbuse(
  userText: string,
  recentHistory: readonly AgentMessage[],
  config?: AbuseDetectionConfig,
): AbuseSignal | null {
  const windowSize = config?.windowSize ?? 5;
  const threshold = config?.repetitionThreshold ?? 0.6;

  // Extract recent user messages
  const recentUserTexts: string[] = [];
  for (let i = recentHistory.length - 1; i >= 0 && recentUserTexts.length < windowSize; i--) {
    if (recentHistory[i]!.role === "user") {
      recentUserTexts.push(extractText(recentHistory[i]!.parts).toLowerCase().trim());
    }
  }

  if (recentUserTexts.length < 2) return null;

  const currentLower = userText.toLowerCase().trim();

  // Check 1: Exact repetition (same message repeated)
  const exactMatches = recentUserTexts.filter(t => t === currentLower).length;
  if (exactMatches / recentUserTexts.length >= threshold) {
    return {
      type: "repetition",
      confidence: exactMatches / recentUserTexts.length,
      detail: `Repeated message "${currentLower.slice(0, 50)}" ${exactMatches}/${recentUserTexts.length} times`,
    };
  }

  // Check 2: Abuse keyword spam (continue/next/more repeatedly)
  const keywordMessages = [currentLower, ...recentUserTexts];
  const keywordMatches = keywordMessages.filter(t =>
    ABUSE_KEYWORDS.some(kw => t === kw || t.startsWith(kw + " ") || t.endsWith(" " + kw))
  ).length;
  if (keywordMatches / keywordMessages.length >= threshold) {
    return {
      type: "repetition",
      confidence: keywordMatches / keywordMessages.length,
      detail: `Abuse keyword pattern detected ${keywordMatches}/${keywordMessages.length} messages`,
    };
  }

  // Check 3: Sequential counting (1, 2, 3, 4...)
  const allTexts = [currentLower, ...recentUserTexts];
  const numberCount = allTexts.filter(t => /^\d+$/.test(t)).length;
  if (numberCount >= 3 && numberCount / allTexts.length >= threshold) {
    return {
      type: "sequential",
      confidence: numberCount / allTexts.length,
      detail: `Sequential number pattern: ${numberCount}/${allTexts.length} messages are bare numbers`,
    };
  }

  return null;
}
