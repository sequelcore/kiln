# Triggers

Triggers activate workflows in response to external or internal events. Three types are supported: webhook (HTTP request), event (internal EventBus), and schedule (cron).

Sources: `packages/runtime/src/trigger/`, `packages/core/src/engine/domain/trigger.ts`

---

## Overview

Triggers are declared in `app.yaml` under the `triggers` key. On startup, the Gateway's `TriggerRegistry` registers each trigger, mounts webhook routes, subscribes event listeners, and starts cron schedulers. Triggers dispatch a task to the specified team when they fire.

All trigger types share these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique identifier within the App. |
| `type` | `webhook \| event \| schedule` | Yes | Trigger type. |
| `team` | `string` | Yes | Team to dispatch the task to. Must exist in `teams`. |
| `task` | `string` | No | Task description. Supports `{{payload.field}}` interpolation. |
| `enabled` | `boolean` | No | Defaults to `true`. |

---

## Webhook Triggers

Fires when an HTTP request is received at the configured path.

```yaml
triggers:
  - name: on-deploy
    type: webhook
    path: /hooks/deploy
    method: POST
    team: ops
    task: "Deployment by {{payload.actor}} on {{payload.branch}}"
    secretEnv: DEPLOY_WEBHOOK_SECRET
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | HTTP path for the webhook endpoint. Must be unique across all Apps in the Gateway. |
| `method` | `"POST" \| "PUT"` | No | Accepted HTTP method. Defaults to `POST`. |
| `secretEnv` | `string` | No | Name of the environment variable holding the HMAC-SHA256 validation secret. |

**HMAC-SHA256 validation.** When `secretEnv` is set, `validateWebhookSignature()` reads the secret from the named environment variable and validates the `X-Hub-Signature-256` (or equivalent) header on every request. Validation uses `crypto.timingSafeEqual` to prevent timing attacks. Requests with missing or invalid signatures receive a `401` response.

If `secretEnv` is omitted, signature validation is skipped (suitable for internal webhooks on private networks).

---

## Event Triggers

Fires when a matching event is emitted on the internal EventBus.

```yaml
triggers:
  - name: on-phase-verify
    type: event
    event: phase_changed
    filter:
      phaseName: verify
    team: quality
    task: "Verify the implementation for phase: {{payload.phaseName}}"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | `string` | Yes | EventBus event type name to listen for. |
| `filter` | `Record<string, unknown>` | No | Shallow equality filter on event payload fields. All keys must match for the trigger to fire. |

**Filter matching.** `EventListener` uses shallow equality: each key in `filter` must be present in the event payload with an identical value. Partial matches do not fire the trigger. An empty or absent `filter` matches all events of the specified type.

**Available event types** (selection):

| Event | When it fires |
|-------|--------------|
| `phase_changed` | Workflow transitions to a new phase |
| `task_completed` | A task node is marked complete |
| `tool_called` | An agent invokes a capability |
| `verification_result` | A quality gate check completes |
| `error` | An engine error is emitted |
| `approval_requested` | A human approval gate is reached |

See `packages/core/src/events/event-bus.ts` for the full list of 32 event types.

---

## Schedule Triggers

Fires at intervals defined by a cron expression.

```yaml
triggers:
  - name: nightly-audit
    type: schedule
    cron: "0 2 * * *"
    timezone: America/Los_Angeles
    team: security
    task: "Run nightly security and dependency audit"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cron` | `string` | Yes | 5-field cron expression: `minute hour day-of-month month day-of-week`. |
| `timezone` | `string` | No | IANA timezone string. Defaults to `UTC`. |

**Cron format.** The cron parser (`packages/core/src/engine/domain/cron.ts`) is a zero-dependency implementation supporting standard 5-field expressions:

| Field | Range | Special Characters |
|-------|-------|--------------------|
| minute | 0–59 | `*`, `,`, `-`, `/` |
| hour | 0–23 | `*`, `,`, `-`, `/` |
| day of month | 1–31 | `*`, `,`, `-`, `/` |
| month | 1–12 | `*`, `,`, `-`, `/` |
| day of week | 0–6 (0 = Sunday) | `*`, `,`, `-`, `/` |

Examples:

```
"0 2 * * *"        every day at 02:00
"*/15 * * * *"     every 15 minutes
"0 9 * * 1-5"      weekdays at 09:00
"0 0 1 * *"        first day of every month at midnight
```

The `Scheduler` uses `nextFireTime()` from the cron parser to compute the delay for each `setTimeout` chain. After each firing, the next delay is recomputed from the current time.

---

## Task Template Interpolation

The `task` field on all trigger types supports `{{payload.field}}` template syntax. At execution time, `executeTrigger()` replaces each `{{...}}` expression with the corresponding value from the trigger's payload.

```yaml
task: "Deploy {{payload.branch}} triggered by {{payload.actor}} at {{payload.timestamp}}"
```

For webhook triggers, `payload` is the parsed JSON request body. For event triggers, `payload` is the EventBus event payload. For schedule triggers, `payload` contains `{ cron, triggerName, firedAt }`.

Undefined fields are left as-is (the template expression is not replaced).

---

## Events Emitted

| Event | When |
|-------|------|
| `webhook_received` | An HTTP request arrives at a webhook path (before validation) |
| `trigger_fired` | `executeTrigger()` dispatches the task to the team |
| `trigger_failed` | `executeTrigger()` encounters an error during dispatch |
| `schedule_fired` | The scheduler fires a cron trigger |

---

## Trigger Lifecycle in the Gateway

1. **Registration:** `TriggerRegistry.register(appName, triggers)` is called for each App during startup.
2. **Webhook mounting:** For each webhook trigger, a Hono route is created and mounted on the Gateway's router at the declared `path`.
3. **Event listener startup:** `EventListener` instances subscribe to the EventBus for each event trigger. Subscriptions are active until `TriggerRegistry.stop()` is called.
4. **Scheduler startup:** `Scheduler.start()` computes the first `nextFireTime()` for each schedule trigger and sets the initial `setTimeout`.
5. **Shutdown:** On SIGINT or SIGTERM, `TriggerRegistry.stop()` cancels all pending timeouts and removes all EventBus subscriptions.

Trigger names must be unique within an App. Webhook paths must be unique across all Apps in the Gateway.
