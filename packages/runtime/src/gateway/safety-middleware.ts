// Safety middleware: PII detection, content classification, and policy rails on channel I/O

import type { Context, Next } from "hono";
import type { SafetyPipeline, SafetyPipelineResult, EventBus, AuditLog, SafetyDirection } from "@kilnai/core";
import type { PiiDetectedEvent, ContentClassifiedEvent, PolicyEvaluatedEvent } from "@kilnai/core";

/**
 * Hono middleware factory for enterprise safety scanning.
 * Scans BOTH input (before next()) AND output (after next()).
 *
 * Input scan:
 * - Extracts message/content from POST body
 * - On block: returns 422 JSON
 * - On redact: stores redacted text in context
 *
 * Output scan:
 * - Reads response body content
 * - On block: replaces response with safe fallback
 * - On redact: returns response with redacted content
 */
export function safetyMiddleware(
  pipeline: SafetyPipeline,
  options?: {
    eventBus?: EventBus;
    auditLog?: AuditLog;
  },
): (c: Context, next: Next) => Promise<Response | void> {
  return async (c: Context, next: Next): Promise<Response | void> => {
    // Only scan POST requests with a body
    if (c.req.method !== "POST") {
      return next();
    }

    let body: Record<string, unknown> | undefined;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return next();
    }

    const rawMessage = body?.["message"] ?? body?.["content"];
    if (typeof rawMessage !== "string" || rawMessage.length === 0) {
      return next();
    }

    // --- Input scan ---
    const inputResult = await pipeline.evaluate(rawMessage, "input");

    emitEvents(options?.eventBus, inputResult, "input", c.req.header("x-session-id") ?? "unknown");
    logAudit(options?.auditLog, inputResult, "input", c.req.path);

    if (!inputResult.allowed) {
      return c.json(
        {
          error: "safety_blocked",
          reason: inputResult.blockReason ?? "Input blocked by safety policy",
        },
        422,
      );
    }

    // Store redacted text for downstream handlers
    if (inputResult.redactedText) {
      c.set("safetyRedactedMessage", inputResult.redactedText);
    }

    // --- Continue to handler ---
    await next();

    // --- Output scan ---
    if (!c.res || c.res.bodyUsed) return;

    let responseText: string | undefined;
    try {
      const clone = c.res.clone();
      const responseBody = (await clone.json()) as Record<string, unknown>;
      responseText = typeof responseBody?.["content"] === "string"
        ? (responseBody["content"] as string)
        : typeof responseBody?.["message"] === "string"
          ? (responseBody["message"] as string)
          : undefined;
    } catch {
      // Not JSON or no content field -- skip output scan
      return;
    }

    if (!responseText) return;

    const outputResult = await pipeline.evaluate(responseText, "output");

    emitEvents(options?.eventBus, outputResult, "output", c.req.header("x-session-id") ?? "unknown");
    logAudit(options?.auditLog, outputResult, "output", c.req.path);

    if (!outputResult.allowed) {
      // Replace response with safe fallback
      c.res = c.json(
        {
          content: "I'm unable to provide that response due to safety policies.",
          safety_blocked: true,
          reason: outputResult.blockReason,
        },
        200,
      );
      return;
    }

    if (outputResult.redactedText) {
      // Replace response content with redacted version
      try {
        const clone = c.res.clone();
        const responseBody = (await clone.json()) as Record<string, unknown>;
        const field = typeof responseBody?.["content"] === "string" ? "content" : "message";
        c.res = c.json({ ...responseBody, [field]: outputResult.redactedText }, c.res.status as 200);
      } catch {
        // Can't modify response -- leave as-is
      }
    }
  };
}

function emitEvents(
  eventBus: EventBus | undefined,
  result: SafetyPipelineResult,
  direction: SafetyDirection,
  sessionId: string,
): void {
  if (!eventBus) return;

  if (result.pii && result.pii.matches.length > 0) {
    const piiEvent: PiiDetectedEvent = {
      type: "pii_detected",
      timestamp: new Date(),
      sessionId,
      direction,
      piiTypes: result.pii.matches.map((m) => m.type),
      action: result.allowed ? "detect" : "block",
      count: result.pii.matches.length,
      tier: result.pii.tier,
    };
    eventBus.emit(piiEvent);
  }

  if (result.content && result.content.scores.length > 0) {
    const categories: Record<string, number> = {};
    for (const s of result.content.scores) {
      categories[s.category] = s.confidence;
    }
    const contentEvent: ContentClassifiedEvent = {
      type: "content_classified",
      timestamp: new Date(),
      sessionId,
      direction,
      categories,
      blocked: !result.allowed,
      tier: result.content.tier,
    };
    eventBus.emit(contentEvent);
  }

  for (const pr of result.policyResults) {
    const policyEvent: PolicyEvaluatedEvent = {
      type: "policy_evaluated",
      timestamp: new Date(),
      sessionId,
      railType: pr.railType,
      allowed: pr.allowed,
      reason: pr.reason,
      direction,
    };
    eventBus.emit(policyEvent);
  }
}

function logAudit(
  auditLog: AuditLog | undefined,
  result: SafetyPipelineResult,
  direction: SafetyDirection,
  resource: string,
): void {
  if (!auditLog) return;

  if (result.pii && result.pii.matches.length > 0) {
    auditLog.append({
      timestamp: new Date(),
      action: "pii_detected",
      actor: "safety-middleware",
      resource,
      outcome: result.allowed ? "allowed" : "denied",
      metadata: { direction, count: result.pii.matches.length, tier: result.pii.tier },
    });
  }

  if (result.content && result.content.scores.length > 0) {
    auditLog.append({
      timestamp: new Date(),
      action: "content_classified",
      actor: "safety-middleware",
      resource,
      outcome: result.allowed ? "allowed" : "denied",
      metadata: { direction, tier: result.content.tier },
    });
  }

  for (const pr of result.policyResults) {
    if (!pr.allowed || pr.escalate) {
      auditLog.append({
        timestamp: new Date(),
        action: "policy_evaluated",
        actor: "safety-middleware",
        resource,
        outcome: pr.allowed ? "allowed" : "denied",
        metadata: { direction, railType: pr.railType, reason: pr.reason },
      });
    }
  }
}
