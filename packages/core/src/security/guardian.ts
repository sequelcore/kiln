// Guardian: secondary LLM review for destructive capability execution

import type { EventBus, GuardianReviewedEvent } from "../events/index.js";
import type { Capability } from "../engine/domain/capability.js";
import type { ProviderAdapter } from "../agents/index.js";
import { textParts, extractText } from "../engine/domain/content.js";
import type { AuditLog, GuardianConfig, GuardianReviewResult } from "./types.js";

export interface GuardianRequest {
  readonly capability: Capability;
  readonly agentName: string;
  readonly arguments: Record<string, unknown>;
  readonly context?: string;
  readonly sessionId?: string;
  readonly tenantId?: string;
}

/** Parsed response from the LLM reviewer */
interface ReviewerResponse {
  approved: boolean;
  reason: string;
  riskLevel: string;
}

function buildReviewPrompt(request: GuardianRequest): string {
  const { capability, agentName, arguments: args, context } = request;
  return `You are a security reviewer. Evaluate whether this action should be allowed.

Action: ${capability.name} - ${capability.description}
Requested by: ${agentName}
Arguments: ${JSON.stringify(args)}
Context: ${context ?? "none"}

Declared action effect:
${JSON.stringify(capability.effectEnvelope ?? null)}

Respond with JSON only:
{"approved": boolean, "reason": "explanation", "riskLevel": "low" | "medium" | "high" | "critical"}

Deny if:
- Arguments contain paths outside expected scope
- Arguments contain shell injection patterns
- The action could cause irreversible data loss
- The action modifies system-level configuration
- The arguments seem crafted to bypass safety

Approve if:
- The action is within expected scope
- Arguments are well-formed and within normal ranges
- The action is reversible or has safeguards`;
}

function parseReviewerResponse(content: string): ReviewerResponse | null {
  try {
    // Strip markdown code fences if present
    const cleaned = content.replace(/```(?:json)?\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "approved" in parsed &&
      typeof (parsed as Record<string, unknown>)["approved"] === "boolean" &&
      "reason" in parsed &&
      typeof (parsed as Record<string, unknown>)["reason"] === "string" &&
      "riskLevel" in parsed &&
      typeof (parsed as Record<string, unknown>)["riskLevel"] === "string"
    ) {
      return parsed as ReviewerResponse;
    }
    return null;
  } catch {
    return null;
  }
}

function truncateArgValues(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    result[key] = str.length > 100 ? str.slice(0, 100) + "..." : str;
  }
  return result;
}

export class Guardian {
  private readonly config: GuardianConfig;
  private readonly provider: ProviderAdapter;
  private readonly eventBus?: EventBus;
  private readonly auditLog?: AuditLog;

  constructor(
    config: GuardianConfig,
    provider: ProviderAdapter,
    eventBus?: EventBus,
    auditLog?: AuditLog,
  ) {
    this.config = config;
    this.provider = provider;
    this.eventBus = eventBus;
    this.auditLog = auditLog;
  }

  /** Check if a capability needs Guardian review */
  needsReview(capability: Capability): boolean {
    if (!this.config.enabled) return false;
    const effect = capability.effectEnvelope;
    if (effect?.operation === "observe" && this.config.bypassForReadOnly === true) {
      return false;
    }
    if (effect?.operation === "mutate" && effect.reversibility === "irreversible") return true;
    return false;
  }

  /** Review a capability execution request */
  async review(request: GuardianRequest): Promise<GuardianReviewResult> {
    const startedAt = Date.now();
    const sessionId = request.sessionId ?? "unknown";

    let approved: boolean;
    let reason: string;
    let riskLevel: "low" | "medium" | "high" | "critical";

    try {
      const prompt = buildReviewPrompt(request);
      const response = await this.provider.createMessage({
        system: "You are a security reviewer that evaluates capability execution requests.",
        messages: [{ role: "user", parts: textParts(prompt) }],
      });

      const parsed = parseReviewerResponse(extractText(response.parts));

      if (parsed === null) {
        // Malformed response -- treat as blockOnError
        if (this.config.blockOnError) {
          approved = false;
          reason = "Guardian reviewer returned malformed response";
          riskLevel = "critical";
        } else {
          approved = true;
          reason = "Guardian reviewer returned malformed response, proceeding";
          riskLevel = "high";
        }
      } else {
        approved = parsed.approved;
        reason = parsed.reason;
        const validLevels = ["low", "medium", "high", "critical"] as const;
        riskLevel = validLevels.includes(parsed.riskLevel as (typeof validLevels)[number])
          ? (parsed.riskLevel as "low" | "medium" | "high" | "critical")
          : "high";
      }
    } catch {
      if (this.config.blockOnError) {
        approved = false;
        reason = "Guardian reviewer unavailable";
        riskLevel = "critical";
      } else {
        approved = true;
        reason = "Guardian reviewer unavailable, proceeding";
        riskLevel = "high";
      }
    }

    const reviewDurationMs = Date.now() - startedAt;

    const result: GuardianReviewResult = {
      approved,
      reason,
      reviewedBy: this.provider.name,
      reviewDurationMs,
      riskLevel,
      capabilityName: request.capability.name,
      agentName: request.agentName,
    };

    // Emit event
    if (this.eventBus) {
      const event: GuardianReviewedEvent = {
        type: "guardian_reviewed",
        timestamp: new Date(),
        sessionId,
        approved,
        capabilityName: request.capability.name,
        agentName: request.agentName,
        riskLevel,
        reason,
      };
      this.eventBus.emit(event);
    }

    // Audit log
    if (this.auditLog) {
      this.auditLog.append({
        timestamp: new Date(),
        action: approved ? "destructive_approved" : "destructive_blocked",
        actor: request.agentName,
        resource: request.capability.name,
        outcome: approved ? "allowed" : "denied",
        metadata: {
          riskLevel,
          reason,
          reviewedBy: this.provider.name,
          reviewDurationMs,
          arguments: truncateArgValues(request.arguments),
        },
        tenantId: request.tenantId,
        sessionId: request.sessionId,
      });
    }

    return result;
  }
}
