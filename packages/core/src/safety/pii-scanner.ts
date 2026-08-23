// Deterministic PII scanner.

import type { PiiConfig, PiiType } from "../engine/domain/safety-config.js";
import type { PiiMatch, PiiScanResult } from "./types.js";

interface PiiPattern {
  readonly type: PiiType;
  readonly regex: RegExp;
}

/** Built-in regex patterns for PII detection */
export const PII_PATTERNS: readonly PiiPattern[] = [
  { type: "email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: "phone", regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
  { type: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: "credit_card", regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
  { type: "ip_address", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { type: "date_of_birth", regex: /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g },
];

/** Luhn algorithm: validates credit card numbers by checksum */
function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits.charAt(i), 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export class PiiScanner {
  private readonly config: PiiConfig;

  constructor(config: PiiConfig) {
    this.config = config;
  }

  /** Tier 1: regex-based scanning, filtered to config.detect types */
  scanHeuristic(input: string): PiiScanResult {
    const normalized = input.normalize("NFKC");
    const matches: PiiMatch[] = [];
    const allowlist = new Set(this.config.allowlist ?? []);

    for (const pattern of PII_PATTERNS) {
      if (!this.config.detect.includes(pattern.type)) continue;

      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(normalized)) !== null) {
        const value = match[0];
        if (allowlist.has(value)) continue;
        if (pattern.type === "credit_card" && !luhnCheck(value.replace(/\D/g, ""))) continue;

        matches.push({
          type: pattern.type,
          value,
          startIndex: match.index,
          endIndex: match.index + value.length,
        });
      }
    }

    return { matches, tier: "heuristic", scannedAt: new Date() };
  }

  async scan(input: string): Promise<PiiScanResult> {
    return this.scanHeuristic(input.normalize("NFKC"));
  }

  /** Replace PII matches with [REDACTED], processing end-to-start to preserve indices */
  redact(input: string, matches: readonly PiiMatch[]): string {
    if (matches.length === 0) return input;

    const sorted = [...matches].sort((a, b) => b.startIndex - a.startIndex);
    let result = input;

    for (const match of sorted) {
      result = result.slice(0, match.startIndex) + "[REDACTED]" + result.slice(match.endIndex);
    }

    return result;
  }
}
