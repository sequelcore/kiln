// Multi-agent routing: selects which agent handles a message based on regex rules + fallback
// Stateless, created per-call. Fail-open on broken regex rules.

import type { ContentPart, TenantRoutingConfig } from "@kilnai/core";
import { extractText } from "@kilnai/core";

export interface RoutingResult {
  readonly agentId: string;
  readonly tier: "rule" | "fallback";
  readonly matchedPattern?: string;
  readonly confidence?: number;
}
export interface TenantRouter {
  route(userParts: readonly ContentPart[]): RoutingResult;
}
interface CompiledRule {
  readonly regex: RegExp;
  readonly agentId: string;
  readonly pattern: string;
}

export class DefaultTenantRouter implements TenantRouter {
  private readonly compiledRules: readonly CompiledRule[];
  private readonly fallbackAgentId: string;

  constructor(config: TenantRoutingConfig) {
    this.fallbackAgentId = config.fallback;

    const rules: CompiledRule[] = [];
    for (const rule of config.rules ?? []) {
      try {
        rules.push({
          regex: new RegExp(rule.match, "i"),
          agentId: rule.agent,
          pattern: rule.match,
        });
      } catch {
        // Skip broken regex -- fail-open
      }
    }
    this.compiledRules = rules;
  }

  route(userParts: readonly ContentPart[]): RoutingResult {
    const text = extractText(userParts);

    for (const rule of this.compiledRules) {
      if (rule.regex.test(text)) {
        return {
          agentId: rule.agentId,
          tier: "rule",
          matchedPattern: rule.pattern,
        };
      }
    }

    return {
      agentId: this.fallbackAgentId,
      tier: "fallback",
    };
  }
}
