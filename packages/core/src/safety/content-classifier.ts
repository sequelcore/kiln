// Content Classifier: two-tier classification (heuristic patterns + optional LLM deep scan)

import type { ContentConfig, ContentCategory, ContentAction } from "../engine/domain/safety-config.js";
import type { ContentScore, ContentClassificationResult } from "./types.js";

interface ContentPattern {
  readonly category: ContentCategory;
  readonly patterns: readonly RegExp[];
  readonly weight: number;
}

/** Built-in heuristic patterns per content category with base confidence weights */
export const CONTENT_PATTERNS: readonly ContentPattern[] = [
  {
    category: "hate",
    patterns: [/\bhate\s+speech\b/i, /\bracist\b/i, /\bbigot\b/i, /\bslur\b/i, /\bxenophob/i],
    weight: 0.3,
  },
  {
    category: "violence",
    patterns: [/\bkill\b/i, /\bmurder\b/i, /\bassault\b/i, /\bweapon\b/i, /\bthreat\b/i],
    weight: 0.25,
  },
  {
    category: "sexual",
    patterns: [/\bexplicit\b/i, /\bnsfw\b/i, /\bpornograph/i],
    weight: 0.3,
  },
  {
    category: "self_harm",
    patterns: [/\bsuicid/i, /\bself[- ]harm\b/i, /\bcut\s+myself\b/i],
    weight: 0.35,
  },
  {
    category: "harassment",
    patterns: [/\bbully\b/i, /\bharass/i, /\bstalk/i, /\bintimid/i],
    weight: 0.25,
  },
  {
    category: "misinformation",
    patterns: [/\bfake\s+news\b/i, /\bconspiracy\b/i, /\bhoax\b/i],
    weight: 0.2,
  },
];

/** Provider interface for Tier 2 deep classification */
export interface ContentDeepScanProvider {
  classify(input: string): Promise<ContentScore[]>;
}

export class ContentClassifier {
  private readonly config: ContentConfig;

  constructor(config: ContentConfig) {
    this.config = config;
  }

  /** Tier 1: heuristic pattern matching, match count * weight capped at 1.0 */
  classifyHeuristic(input: string): ContentClassificationResult {
    const scores: ContentScore[] = [];

    for (const pattern of CONTENT_PATTERNS) {
      let matchCount = 0;
      for (const regex of pattern.patterns) {
        const r = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
        const matches = input.match(r);
        if (matches) matchCount += matches.length;
      }

      if (matchCount > 0) {
        const confidence = Math.min(1.0, matchCount * pattern.weight);
        scores.push({ category: pattern.category, confidence });
      }
    }

    return { scores, tier: "heuristic", scannedAt: new Date() };
  }

  /** Tier 2: LLM-based classification (fail-open) */
  async classifyDeep(input: string, provider: ContentDeepScanProvider): Promise<ContentClassificationResult> {
    try {
      const scores = await provider.classify(input);
      return { scores, tier: "deep", scannedAt: new Date() };
    } catch {
      return { scores: [], tier: "deep", scannedAt: new Date() };
    }
  }

  /** Combined classification: always Tier 1, Tier 2 if config.deepScan */
  async classify(input: string, provider?: ContentDeepScanProvider): Promise<ContentClassificationResult> {
    const heuristic = this.classifyHeuristic(input);

    if (this.config.deepScan && provider) {
      const deep = await this.classifyDeep(input, provider);
      // Merge: take the higher confidence for each category
      const merged = new Map<ContentCategory, number>();
      for (const s of heuristic.scores) merged.set(s.category, s.confidence);
      for (const s of deep.scores) {
        const existing = merged.get(s.category) ?? 0;
        merged.set(s.category, Math.max(existing, s.confidence));
      }
      const scores: ContentScore[] = [];
      for (const [category, confidence] of merged) {
        scores.push({ category, confidence });
      }
      return { scores, tier: "deep", scannedAt: new Date() };
    }

    return heuristic;
  }

  /** Compare scores against configured thresholds. Returns categories that exceed threshold. */
  evaluateThresholds(scores: readonly ContentScore[]): { category: ContentCategory; confidence: number; action: ContentAction }[] {
    const violations: { category: ContentCategory; confidence: number; action: ContentAction }[] = [];

    for (const score of scores) {
      const catConfig = this.config.categories[score.category];
      if (!catConfig) continue;
      if (score.confidence >= catConfig.threshold) {
        violations.push({
          category: score.category,
          confidence: score.confidence,
          action: catConfig.action,
        });
      }
    }

    return violations;
  }
}
