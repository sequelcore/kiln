// Webhook handler: Hono route handler + HMAC-SHA256 signature validation
// Mounts under /webhooks/{appName}{trigger.path}

import { Hono } from "hono";
import type { EventBus, WebhookTrigger, WebhookReceivedEvent } from "@kilnai/core";
import { executeTrigger } from "./trigger-executor.js";
import type { TriggerExecutionContext } from "./trigger-executor.js";
import { verifyHmacSha256 } from "../utils/hmac.js";

/** Validate HMAC-SHA256 webhook signature (strips optional "sha256=" prefix) */
export function validateWebhookSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  const sig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  return verifyHmacSha256(secret, body, sig);
}

export interface WebhookHandlerConfig {
  readonly appName: string;
  readonly eventBus: EventBus;
}

/** Create a Hono app with routes for all webhook triggers of an app */
export function createWebhookHandler(
  triggers: readonly WebhookTrigger[],
  config: WebhookHandlerConfig,
): Hono {
  const app = new Hono();

  for (const trigger of triggers) {
    if (trigger.enabled === false) continue;

    const method = trigger.method ?? "POST";
    const routePath = trigger.path;

    const handler = async (c: import("hono").Context) => {
      const body = await c.req.text();

      // Emit webhook_received event
      const receivedEvent: WebhookReceivedEvent = {
        type: "webhook_received",
        timestamp: new Date(),
        sessionId: `webhook-${config.appName}-${trigger.name}`,
        path: trigger.path,
        appName: config.appName,
        triggerName: trigger.name,
        method,
      };
      config.eventBus.emit(receivedEvent);

      // Validate signature if secretEnv is configured
      if (trigger.secretEnv) {
        const secret = process.env[trigger.secretEnv];
        if (!secret) {
          return c.json({ error: "Webhook secret not configured" }, 500);
        }

        const signature =
          c.req.header("x-hub-signature-256") ??
          c.req.header("x-signature-256") ??
          c.req.header("x-webhook-signature") ??
          "";

        if (!signature || !validateWebhookSignature(body, signature, secret)) {
          return c.json({ error: "Invalid signature" }, 401);
        }
      }

      // Parse payload
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(body) as Record<string, unknown>;
      } catch {
        // Non-JSON body -- use empty payload
      }

      const ctx: TriggerExecutionContext = {
        appName: config.appName,
        eventBus: config.eventBus,
        sessionId: `webhook-${config.appName}-${trigger.name}-${Date.now()}`,
      };

      try {
        const result = executeTrigger(trigger, payload, ctx);
        return c.json({ ok: true, team: result.team, task: result.task });
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : "Trigger execution failed" },
          500,
        );
      }
    };

    app.on(method, routePath, handler);
  }

  return app;
}
