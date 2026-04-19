import type { ContentPart } from "@kilnai/core";
import type { ModeBSession } from "../../mode-b-session.js";

export interface EscalationSignal {
  readonly reason: "keyword" | "loop" | "confidence" | "tool_failure" | "custom";
  readonly confidence: number;
  readonly detail: string;
}

export interface EscalationDetector {
  checkPreLLM(userText: string): EscalationSignal | null;
  checkPostLLM(session: ModeBSession, responseParts: readonly ContentPart[]): EscalationSignal | null;
}

const DEFAULT_KEYWORDS: readonly string[] = [
  "agent", "human", "person", "representative",
  "agente", "humano", "persona", "representante",
  "hablar con alguien", "talk to someone",
];

export interface DefaultEscalationDetectorConfig {
  readonly keywords?: readonly string[];
  readonly loopThreshold?: number;
  readonly loopWindowSize?: number;
}

export class DefaultEscalationDetector implements EscalationDetector {
  private readonly keywords: readonly string[];
  private readonly loopThreshold: number;
  private readonly loopWindowSize: number;

  constructor(config?: DefaultEscalationDetectorConfig) {
    this.keywords = config?.keywords ?? DEFAULT_KEYWORDS;
    this.loopThreshold = config?.loopThreshold ?? 0.85;
    this.loopWindowSize = config?.loopWindowSize ?? 3;
  }

  checkPreLLM(userText: string): EscalationSignal | null {
    const lower = userText.toLowerCase().trim();

    // Check multi-word keywords first (they must match as full phrases)
    for (const keyword of this.keywords) {
      if (keyword.includes(" ")) {
        if (lower.includes(keyword.toLowerCase())) {
          return {
            reason: "keyword",
            confidence: 0.9,
            detail: `Matched phrase: "${keyword}"`,
          };
        }
      }
    }

    // Check single-word keywords (must be whole words)
    const words = lower.split(/\s+/);
    for (const keyword of this.keywords) {
      if (!keyword.includes(" ") && words.includes(keyword.toLowerCase())) {
        return {
          reason: "keyword",
          confidence: 0.8,
          detail: `Matched keyword: "${keyword}"`,
        };
      }
    }

    return null;
  }

  checkPostLLM(session: ModeBSession, _responseParts: readonly ContentPart[]): EscalationSignal | null {
    const recentTexts = session.lastAssistantTexts(this.loopWindowSize);
    if (recentTexts.length < this.loopWindowSize) return null;

    // Check pairwise similarity
    for (let i = 0; i < recentTexts.length - 1; i++) {
      const similarity = wordOverlapSimilarity(recentTexts[i]!, recentTexts[i + 1]!);
      if (similarity < this.loopThreshold) return null;
    }

    return {
      reason: "loop",
      confidence: 0.85,
      detail: `Last ${this.loopWindowSize} responses have similarity > ${this.loopThreshold}`,
    };
  }
}

/** Simple word overlap similarity (Jaccard index on word sets) */
export function wordOverlapSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 0));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 0));

  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
