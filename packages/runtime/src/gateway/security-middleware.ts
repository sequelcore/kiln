// Security middleware: scans incoming messages for prompt injection before route handlers

import type { Context, Next } from "hono";
import type { PromptScanner, AuditLog, PromptInjectionConfig } from "@kilnai/core";

/**
 * Hono middleware that scans the incoming message body for prompt injection.
 *
 * - Extracts `message` or `content` field from POST body.
 * - On detection with blockOnDetection=true: returns 422 JSON.
 * - On detection with blockOnDetection=false: sets X-Kiln-Injection-Warning header.
 * - Always logs scan results to AuditLog if provided.
 */
export function securityMiddleware(
  scanner: PromptScanner,
  auditLog?: AuditLog,
  config?: PromptInjectionConfig,
): (c: Context, next: Next) => Promise<Response | void> {
  const blockOnDetection = config?.blockOnDetection ?? true;

  return async (c: Context, next: Next): Promise<Response | void> => {
    // Only scan POST requests with a body
    if (c.req.method !== "POST") {
      return next();
    }

    let body: Record<string, unknown> | undefined;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      // Can't parse body -- skip scanning, let downstream handle it
      return next();
    }

    const rawMessage = body?.["message"] ?? body?.["content"];
    if (typeof rawMessage !== "string" || rawMessage.length === 0) {
      return next();
    }

    const result = await scanner.scan(rawMessage);

    if (auditLog) {
      auditLog.append({
        timestamp: result.scannedAt,
        action: result.safe ? "injection_cleared" : "injection_detected",
        actor: "security-middleware",
        resource: c.req.path,
        outcome: result.safe ? "allowed" : "denied",
        metadata: {
          tier: result.tier,
          threats: result.threats.length,
          inputLength: result.inputLength,
        },
      });
    }

    if (!result.safe) {
      if (blockOnDetection) {
        return c.json(
          {
            error: "injection_detected",
            threats: result.threats.map((t) => ({
              pattern: t.pattern,
              severity: t.severity,
              description: t.description,
            })),
          },
          422,
        );
      } else {
        c.header("X-Kiln-Injection-Warning", "true");
      }
    }

    return next();
  };
}
