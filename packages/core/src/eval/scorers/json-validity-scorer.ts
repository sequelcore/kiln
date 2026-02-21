// JsonValidityScorer: validates output is parseable JSON with optional key-presence check

import type { EvalInput, EvalScore, Scorer } from "../types.js";

export class JsonValidityScorer implements Scorer {
  readonly name = "json-validity";

  constructor(private readonly schema?: Record<string, unknown>) {}

  async score(input: EvalInput): Promise<EvalScore> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.output);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { name: this.name, score: 0, reasoning: `invalid JSON: ${msg}` };
    }
    if (this.schema && typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      const requiredKeys = Object.keys(this.schema);
      const missingKeys = requiredKeys.filter((k) => !(k in obj));
      if (missingKeys.length > 0) {
        return {
          name: this.name,
          score: 0,
          reasoning: `valid JSON but missing keys: ${missingKeys.join(", ")}`,
        };
      }
    }
    return { name: this.name, score: 1, reasoning: "valid JSON" };
  }
}
