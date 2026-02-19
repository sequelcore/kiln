// Engine composite: Router -- pattern rules -> classifier -> fallback team
// 3-layer routing: pattern rules (~80%) -> classifier agent (~15%) -> fallback (~5%)

import type { Agent } from "../domain/agent.js";

/** A pattern rule mapping a regex string to a team name */
export interface PatternRule {
  readonly match: string;
  readonly team: string;
}

/** Routes incoming requests to teams via rules, classifier, or fallback */
export interface Router {
  readonly rules: readonly PatternRule[];
  readonly classifier?: Agent;
  readonly fallback: string;
}

/** Validation error for router configuration */
export interface RouterValidationError {
  readonly field: string;
  readonly message: string;
}

/** Validate a Router composite configuration */
export function validateRouter(router: Router): RouterValidationError[] {
  const errors: RouterValidationError[] = [];

  if (!router.fallback || typeof router.fallback !== "string") {
    errors.push({ field: "fallback", message: "must be a non-empty string" });
  }

  for (let i = 0; i < router.rules.length; i++) {
    const rule = router.rules[i]!;

    if (!rule.match || typeof rule.match !== "string") {
      errors.push({ field: `rules[${i}].match`, message: "must be a non-empty string" });
    } else {
      try {
        new RegExp(rule.match);
      } catch {
        errors.push({ field: `rules[${i}].match`, message: `invalid regex: "${rule.match}"` });
      }
    }

    if (!rule.team || typeof rule.team !== "string") {
      errors.push({ field: `rules[${i}].team`, message: "must be a non-empty string" });
    }
  }

  if (router.classifier !== undefined && router.classifier.tier !== "fast") {
    errors.push({ field: "classifier.tier", message: 'classifier agent must have tier "fast"' });
  }

  return errors;
}
