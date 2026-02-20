// Engine primitive: Trigger -- event-driven workflow activation
// 7th primitive: webhook, event, schedule trigger types

/** Supported trigger types */
export type TriggerType = "webhook" | "event" | "schedule";

/** Webhook trigger: HTTP endpoint that starts a workflow */
export interface WebhookTrigger {
  readonly name: string;
  readonly type: "webhook";
  readonly team: string;
  readonly task?: string;           // supports {{payload.field}} interpolation
  readonly enabled?: boolean;       // default true
  readonly path: string;            // e.g. "/hooks/deploy"
  readonly method?: "POST" | "PUT"; // default POST
  readonly secretEnv?: string;      // env var for HMAC-SHA256 secret
}

/** Event trigger: activates on internal EventBus events */
export interface EventTrigger {
  readonly name: string;
  readonly type: "event";
  readonly team: string;
  readonly task?: string;
  readonly enabled?: boolean;
  readonly event: string;           // EventType value
  readonly filter?: Record<string, unknown>;
}

/** Schedule trigger: cron-based periodic activation */
export interface ScheduleTrigger {
  readonly name: string;
  readonly type: "schedule";
  readonly team: string;
  readonly task?: string;
  readonly enabled?: boolean;
  readonly cron: string;            // 5-field: "0 2 * * *"
  readonly timezone?: string;       // IANA, default "UTC"
}

/** Union of all trigger types */
export type Trigger = WebhookTrigger | EventTrigger | ScheduleTrigger;

/** Trigger validation error */
export interface TriggerValidationError {
  readonly field: string;
  readonly message: string;
}

/** Validate a trigger configuration */
export function validateTrigger(trigger: Trigger, teamNames: readonly string[]): TriggerValidationError[] {
  const errors: TriggerValidationError[] = [];

  if (!trigger.name || typeof trigger.name !== "string") {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }

  if (!teamNames.includes(trigger.team)) {
    errors.push({ field: "team", message: `references unknown team "${trigger.team}"` });
  }

  switch (trigger.type) {
    case "webhook":
      if (!trigger.path || typeof trigger.path !== "string") {
        errors.push({ field: "path", message: "must be a non-empty string" });
      } else if (!trigger.path.startsWith("/")) {
        errors.push({ field: "path", message: "must start with /" });
      }
      if (trigger.method !== undefined && trigger.method !== "POST" && trigger.method !== "PUT") {
        errors.push({ field: "method", message: 'must be "POST" or "PUT"' });
      }
      break;
    case "event":
      if (!trigger.event || typeof trigger.event !== "string") {
        errors.push({ field: "event", message: "must be a non-empty string" });
      }
      break;
    case "schedule":
      if (!trigger.cron || typeof trigger.cron !== "string") {
        errors.push({ field: "cron", message: "must be a non-empty string" });
      }
      break;
    default:
      errors.push({ field: "type", message: "must be webhook, event, or schedule" });
  }

  return errors;
}
