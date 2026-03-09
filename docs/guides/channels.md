# Channel Adapters

Channels are platform adapters that connect the Kiln engine to external messaging systems. Agents produce content without knowledge of the delivery platform; channel adapters handle all transport, authentication, and format concerns.

Sources: `packages/runtime/src/channels/`, `packages/core/src/engine/domain/channel.ts`

---

## Adapter Comparison

| Adapter | Class | Format | Transport | Auth | Modalities |
|---------|-------|--------|-----------|------|------------|
| CLI | `CliChannel` | full | stdin / stdout | None | text |
| Web | `WebChannel` | full | WebSocket (Hono) | Origin validation (`allowedOrigins`) | text, image, audio, file |
| WhatsApp | `WhatsAppChannel` | short | HTTPS (Business API v21.0) | HMAC-SHA256 (`appSecretEnv`) + verify token | text, image, audio, file |
| Instagram | `InstagramChannel` | short | HTTPS (Graph API v21.0) | HMAC-SHA256 (`appSecretEnv`) + verify token | text, image |
| Messenger | `MessengerChannel` | short | HTTPS (Graph API v21.0) | HMAC-SHA256 (`appSecretEnv`) + verify token | text, image |
| Slack | `SlackChannel` | full | HTTPS (Bot Events + Web API) | HMAC-SHA256 (signing secret) | text, image, file |
| Email | `EmailChannel` | full | API-based (Postmark, Resend, generic) | HMAC-SHA256 (`appSecretEnv`) | text, file |
| API | `ApiChannel` | structured | HTTP REST + SSE | API key (`apiKeyEnv`) | text, image, audio, file |

---

## Message Formats

**`short` — Plain Text.** Used by WhatsApp, Instagram, and Messenger. Markdown is stripped before delivery: code blocks become `[code block]`, inline code has backticks removed, bold and italic markers are stripped, and links are reduced to display text. Output is truncated per-channel (WhatsApp: 4,096 chars, Instagram: 1,000 chars, Messenger: 2,000 chars).

**`full` — Full Markdown.** Used by CLI, Web, Slack, and Email. Content is delivered without modification. Markdown renders natively in the Slack client, in the web console, and is converted to HTML for email delivery.

**`structured` — JSON Envelope.** Used by the REST API adapter. Content is placed inside a typed JSON object with explicit fields (`type`, `content`, `target`, `userId`, `threadId`), enabling programmatic consumers to parse and route responses without text parsing.

---

## Character Limits

| Channel | Max Characters | Behavior on Overflow |
|---------|---------------|---------------------|
| WhatsApp | 4,096 | Truncated |
| Messenger | 2,000 | Truncated |
| Instagram | 1,000 | Truncated |
| Email | Unlimited | No truncation |
| CLI / Web / Slack / API | Unlimited | No truncation |

---

## Meta Webhook Foundation

WhatsApp, Instagram, and Messenger share a common Meta webhook infrastructure layer (`meta-webhook-foundation.ts`). The shared layer provides:

- **Verification handshake:** `verifyMetaWebhook()` handles the one-time GET challenge for all three channels.
- **HMAC-SHA256 signature validation:** `validateMetaSignature()` verifies `X-Hub-Signature-256` on incoming POSTs using the App Secret.
- **Webhook deduplication:** A single `WebhookDedup` instance (shared across all three channels) tracks recently processed message IDs in a time-windowed set and silently drops duplicates. This protects against Meta's at-least-once delivery semantics without external state.

The channels diverge in payload structure: WhatsApp uses `entry[].changes[].value.messages[]`, while Instagram and Messenger use `entry[].messaging[]`. Each channel adapter parses its own payload format behind the shared foundation.

---

## Per-Channel Setup

### CLI

No configuration required. Used for local sessions and development.

```typescript
import { CliChannel } from "@kilnai/runtime";

const cli = new CliChannel();
cli.onMessage((msg) => { /* forward to orchestrator */ });
```

`send()` writes formatted text to `process.stdout`. `stream()` writes engine event lines to `process.stdout`.

**Gateway YAML:**

```yaml
channels:
  - type: cli
```

---

### Web

Manages WebSocket connections grouped by session. Clients can connect and disconnect without interrupting the session.

```typescript
import { WebChannel } from "@kilnai/runtime";

const web = new WebChannel();

// On WebSocket open (sessionId from handshake query params):
web.addClient(wsContext, sessionId);

// On WebSocket close:
web.removeClient(wsContext);
```

`send()` delivers a JSON frame `{ type: "output", text, target, userId, threadId }` to clients in the session matching `response.userId`, or broadcasts to all sessions when `userId` is absent. `stream()` broadcasts `{ type: "event", event, data, timestamp }` per engine event to all sessions.

**Gateway YAML:**

```yaml
channels:
  - type: web
```

When an App declares a `web` channel binding, the Gateway mounts a WebSocket upgrade route at `GET /apps/:appName/ws`. Clients connect via standard WebSocket and exchange JSON frames:

- **Inbound** (client to server): `IncomingMessage` JSON (`{ parts, source, userId?, threadId? }`)
- **Outbound** (server to client): `{ type: "output", text, target?, userId?, threadId? }` for messages, `{ type: "event", event, data, timestamp }` for engine events

The WebSocket lifecycle is managed by `ws-routes.ts` using Hono's `upgradeWebSocket` helper with `createBunWebSocket()`.

**Authentication:** Two auth modes for WebSocket:

- **Dev mode:** A `validateToken` callback validates `?token=` query params (via `DevTokenStore` sliding-window TTL).
- **Production mode:** `apiKeyEnv` on the channel binding validates `?apiKey=` query params. Dev mode takes priority when both are configured.

Invalid or missing credentials receive a `401` response before upgrade. If the dev token validator returns a `userId`, it is used as the session key.

**Multi-tenant mode.** For SaaS products with `multiTenant: true`, the Gateway mounts `ws-tenant-routes.ts` instead. Clients connect with `?widgetId=UUID`, which resolves to a tenant via `TenantRegistry.resolveByWidgetId()`. The tenant's system prompt, billing, and idle timeout are applied per-session. When a tenant defines multiple `agents` with `routing` config, each message is routed to the appropriate agent via a 3-tier cascade: regex rules (Tier 1), embedding similarity via AgentRAG (Tier 2, threshold configurable via `embeddingThreshold`, default 0.75), or fallback. Agent switches include a warm handoff brief (LLM-generated context summary) and are subject to the ping-pong guard (`maxHandoffs`, `rerouteAfterTurns`). AGENT_ROUTED conversation events include `routingTier` and `routingConfidence` for observability. Use `POST /tenants/:id/routing/test` to dry-run routing. See [Concepts: Multi-Agent Routing](../concepts.md#multi-agent-routing).

**WebSocket heartbeat.** The gateway sends a `ping` frame every 30 seconds. Clients must respond with a `pong` within 90 seconds or the connection is closed. The `@kilnai/widget` and `@kilnai/react` (useKilnWsChat) handle pong responses automatically. Custom WebSocket clients must implement pong handling to maintain the connection.

**Origin validation** is enforced on multi-tenant WebSocket connections. After tenant resolution, the `Origin` header is checked against `TenantConfig.allowedOrigins` (with fallback to the channel-level `allowedOrigins`). Localhost and 127.0.0.1 are always allowed. Connections from disallowed origins receive a `403` before upgrade.

```yaml
channels:
  - type: web
    multiTenant: true
    adminTokenEnv: MY_ADMIN_TOKEN
    allowedOrigins:
      - https://myapp.com
```

**Visitor Identity & Persistence.** The widget persists visitor identity across sessions using `localStorage`. A randomly generated `userId` is stored under `kiln_uid_{widgetId}` and reused on subsequent visits. This enables contact memory recall for returning visitors.

The widget supports an `identify` WebSocket frame for sending structured visitor metadata (name, email, phone, custom fields). Identity can be sent at any point during a conversation. The gateway sanitizes all visitor input (length limits, format validation, zero-width character removal) before injecting it into the system prompt or conversation events.

```typescript
// Programmatic identity (from your app's auth)
const widget = new KilnWidget(config);
// Identity is sent automatically if stored, or via pre-chat form
```

**Pre-Chat Form.** Tenants can configure an optional pre-chat form that collects visitor information before the conversation starts. The form configuration is delivered via the WebSocket welcome frame and rendered in the widget. Returning visitors with stored identity data skip the form automatically.

Configure via `TenantConfig.preChatForm`:

```json
{
  "preChatForm": {
    "enabled": true,
    "fields": [
      { "key": "name", "label": "Your name", "type": "text", "required": true },
      { "key": "email", "label": "Email", "type": "email", "required": false },
      { "key": "phone", "label": "Phone", "type": "phone", "required": false }
    ],
    "submitLabel": "Start Chat"
  }
}
```

Field types: `text`, `email`, `phone`. Maximum 10 fields per form. Field keys must be unique. When the visitor submits the form, the widget sends an `identify` frame and transitions to the chat view. The gateway passes `displayName` (from `visitor.name`) in all subsequent `ConversationEvent` emissions for the web channel.

**Embeddable Widget.** The `@kilnai/widget` package provides a ready-made chat UI for embedding on any website. It connects to the gateway WebSocket, manages reconnection, and renders inside a Shadow DOM for style isolation.

```html
<script
  src="https://cdn.jsdelivr.net/npm/@kilnai/widget@latest/dist/widget.js"
  data-gateway="https://gw.example.com"
  data-app="my-app"
  data-widget-id="550e8400-e29b-41d4-a716-446655440000"
  data-theme="auto"
  data-greeting="Hello! How can I help?"
  async></script>
```

Configuration via `data-*` attributes on the script tag:

| Attribute | Required | Description |
|-----------|----------|-------------|
| `data-gateway` | Yes | Gateway URL (https or wss) |
| `data-app` | Yes | App name in gateway.yaml |
| `data-widget-id` | Yes | Widget UUID (from tenant provisioning) |
| `data-position` | No | `bottom-right` (default) or `bottom-left` |
| `data-theme` | No | `light`, `dark`, or `auto` (default) |
| `data-greeting` | No | Initial assistant message |
| `data-placeholder` | No | Input placeholder text |

---

### WhatsApp

Connects to the WhatsApp Business Cloud API at `graph.facebook.com/v21.0` using native `fetch` (no SDK).

```typescript
import { WhatsAppChannel } from "@kilnai/runtime";

const whatsapp = new WhatsAppChannel({
  phoneNumberId: process.env.WA_PHONE_NUMBER_ID,
  accessToken: process.env.WA_ACCESS_TOKEN,
  verifyToken: process.env.WA_VERIFY_TOKEN,
});
```

**Webhook verification.** Meta sends a one-time GET to confirm the webhook URL:

```typescript
// Hono GET handler:
const challenge = whatsapp.verifyWebhook(
  c.req.query("hub.mode"),
  c.req.query("hub.verify_token"),
  c.req.query("hub.challenge"),
);
if (challenge) return c.text(challenge);
return c.text("Forbidden", 403);
```

Returns the challenge string if `mode === "subscribe"` and the token matches; returns `null` otherwise.

**Incoming messages:**

```typescript
import { textParts } from "@kilnai/core";

const body = await c.req.json();
const msg = body.entry[0].changes[0].value.messages[0];

await whatsapp.receive({
  parts: textParts(msg.text.body),
  source: "whatsapp",
  userId: msg.from,      // E.164 phone number
  threadId: msg.id,
});
```

**Outgoing messages.** `send()` posts to the Cloud API. `response.target` must be the recipient's E.164 phone number. Content is formatted as `short` before delivery.

**Webhook signature verification.** Configure `appSecretEnv` on the channel binding to verify `X-Hub-Signature-256` HMAC-SHA256 signatures on incoming POST requests from Meta. The gateway applies `requireWebhookSignature` middleware automatically. Requests with missing or invalid signatures receive `401`. If `appSecretEnv` is not configured, a warning is logged at startup and signatures are not verified.

**Gateway YAML:**

```yaml
channels:
  - type: whatsapp
    phoneNumber: "+521234567890"
    appSecretEnv: META_APP_SECRET
```

The `phoneNumber` in `gateway.yaml` must be unique across all Apps.

**Webhook deduplication.** Meta delivers webhooks with at-least-once semantics, meaning the same message may be delivered multiple times. The `WebhookDedup` class (shared across WhatsApp, Instagram, and Messenger) tracks recently processed message IDs in a time-windowed set and silently drops duplicates. This prevents double-processing of messages without requiring external state.

**Multi-tenant mode.** For SaaS products serving multiple businesses through one WhatsApp number, use `multiTenant: true` with `verifyTokenEnv`. This enables tenant resolution by `phone_number_id`, persistent per-tenant memory (SQLite + FTS5), and builtin `notify_owner` tool for real-time escalation to the business owner. See [`examples/whatsapp-bot/`](../../examples/whatsapp-bot/) for a complete working example.

**Coexistence mode.** When a tenant uses the same phone number on both the WhatsApp Business App and the Cloud API (Meta's coexistence feature), Kiln can detect when the business owner responds from the app and automatically pause the AI agent.

Enable via `TenantConfig.whatsappCoexistence`:

```json
{
  "whatsappCoexistence": {
    "enabled": true,
    "autoReleaseMs": 300000
  }
}
```

When enabled, Kiln subscribes to Meta's `smb_message_echoes` webhook field. When the business sends a message from the WhatsApp Business App:

1. The session transitions to `human_active` -- AI stops responding
2. The business message is injected into session history (preserves context)
3. A `HUMAN_TAKEOVER` conversation event is emitted with `handoffSource: "whatsapp_coexistence"`

**Auto-release.** When `autoReleaseMs` is set (e.g., 300000 = 5 minutes), the AI automatically resumes on the next customer message after the human has been idle for that duration. A `HANDOFF_RELEASED` event is emitted. Set to `0` (default) for manual release only via the `/release` admin API.

**Limitations.** Coexistence mode is subject to Meta's restrictions: broadcast lists are disabled, throughput is limited to 20 msg/s, and it is not available in the EU, UK, Australia, Japan, and some other countries. Official Business Account (blue badge) is not supported for coexistence accounts. See [Meta: Onboarding WhatsApp Business App users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/) for the full list of restrictions.

---

### Instagram DM

Connects to the Instagram Messaging API via `graph.facebook.com/v21.0` using native `fetch` (no SDK). Shares the Meta webhook foundation with WhatsApp and Messenger for verification and HMAC-SHA256 signature validation.

```typescript
import { InstagramChannel } from "@kilnai/runtime";

const instagram = new InstagramChannel({
  accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
});
```

**Webhook verification.** Same flow as WhatsApp -- Meta sends a GET challenge, the handler returns `hub.challenge` when the token matches `verifyTokenEnv`.

**Incoming messages.** Instagram DM webhooks deliver messages via the `messaging` field in `entry[].messaging[]`. Text and image attachments are supported. The webhook route resolves tenants by Instagram Page ID via `TenantRegistry.resolveByInstagramPageId()`.

**Outgoing messages.** `send()` posts to `graph.facebook.com/v21.0/me/messages` with the recipient's Instagram-scoped ID (IGSID). Content is formatted as `short` (plain text, 1,000 character limit). Image parts are sent as separate attachment messages.

**Gateway YAML:**

```yaml
channels:
  - type: instagram
    appSecretEnv: META_APP_SECRET
    verifyTokenEnv: META_VERIFY_TOKEN
```

**Multi-tenant mode.** For SaaS products serving multiple businesses, tenant resolution uses the `instagramPageId` field on `TenantConfig`. Each tenant configures its own `instagramAccessToken` for outbound delivery.

---

### Facebook Messenger

Connects to the Messenger Platform API via `graph.facebook.com/v21.0` using native `fetch` (no SDK). Shares the Meta webhook foundation with WhatsApp and Instagram.

```typescript
import { MessengerChannel } from "@kilnai/runtime";

const messenger = new MessengerChannel({
  accessToken: process.env.MESSENGER_ACCESS_TOKEN,
});
```

**Webhook verification.** Same Meta challenge-response flow as WhatsApp and Instagram.

**Incoming messages.** Messenger webhooks deliver messages via `entry[].messaging[]`. Text and image attachments are supported. The webhook route resolves tenants by Facebook Page ID via `TenantRegistry.resolveByMessengerPageId()`.

**Outgoing messages.** `send()` posts to `graph.facebook.com/v21.0/me/messages` with the recipient's Page-Scoped ID (PSID). Content is formatted as `short` (plain text, 2,000 character limit). Image parts are sent as separate attachment messages.

**Gateway YAML:**

```yaml
channels:
  - type: messenger
    appSecretEnv: META_APP_SECRET
    verifyTokenEnv: META_VERIFY_TOKEN
```

**Multi-tenant mode.** Tenant resolution uses the `messengerPageId` field on `TenantConfig`. Each tenant configures its own `messengerAccessToken` for outbound delivery.

---

### Email

Connects to email providers via the `EmailTransport` interface. Supports Postmark, Resend, and generic HTTP transports. Uses `full` format with markdown preserved and HTML rendering via inline CSS templates.

```typescript
import { EmailChannel } from "@kilnai/runtime";

const email = new EmailChannel({
  fromAddress: "support@example.com",
  fromName: "Support AI",
  transport: { provider: "postmark", apiKey: process.env.POSTMARK_API_KEY },
});
```

**Inbound messages.** Email arrives via provider-agnostic webhooks (e.g., CloudMailin, Postmark inbound). The webhook route parses sender, subject, and body from the POST payload. Tenant resolution uses `TenantRegistry.resolveByEmailAddress()` with case-insensitive matching on the recipient address.

**Outbound messages.** `send()` renders the AI response as HTML using the email template engine (inline CSS, branding support) and delivers via the configured transport. File parts are sent as attachments.

**Threading.** Email threads are tracked via Message-ID chains using `EmailThreadStore`. Replies include `In-Reply-To` and `References` headers to maintain threading in email clients. An `InMemoryEmailThreadStore` ships for development; `SqliteEmailThreadStore` provides persistent thread tracking across gateway restarts for production deployments.

**Loop prevention.** The `EmailLoopGuard` prevents auto-reply storms:
- **RFC 3834 detection:** Checks `Auto-Submitted`, `X-Auto-Response-Suppress`, and `Precedence` headers
- **Ignored senders:** Configurable list of addresses that are silently dropped (e.g., `noreply@`, `mailer-daemon@`)
- **Self-send detection:** Messages from the configured `fromAddress` are rejected

**System prompt.** Email sessions receive an additional system prompt instruction for professional email tone with structured paragraphs.

**Gateway YAML:**

```yaml
channels:
  - type: email
    appSecretEnv: EMAIL_WEBHOOK_SECRET
```

**Multi-tenant mode.** Tenant resolution uses the `emailAddress` field on `TenantConfig` (case-insensitive). Each tenant configures `emailFromAddress`, `emailFromName`, and `emailTransportConfig` for outbound delivery.

---

### Slack

Connects to the Slack Bot Events API (inbound) and `chat.postMessage` endpoint (outbound). No SDK.

```typescript
import { SlackChannel } from "@kilnai/runtime";

const slack = new SlackChannel({
  botToken: process.env.SLACK_BOT_TOKEN,       // xoxb-...
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});
```

**Request verification.** All Slack webhook requests must be verified:

```typescript
const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
const signature = c.req.header("x-slack-signature") ?? "";
const rawBody = await c.req.text();

if (!slack.verifyRequest(timestamp, rawBody, signature)) {
  return c.text("Unauthorized", 401);
}
```

`verifyRequest()` computes `HMAC-SHA256("v0:{timestamp}:{body}", signingSecret)`, prepends `"v0="`, and compares against the provided signature using timing-safe comparison.

**Incoming messages:**

```typescript
import { textParts } from "@kilnai/core";

await slack.receive({
  parts: textParts(event.text),
  source: "slack",
  userId: event.user,
  threadId: event.thread_ts ?? event.ts,
});
```

**Outgoing messages.** `send()` posts to `chat.postMessage`. When `response.threadId` is set, the reply posts in-thread. `response.target` must be the Slack channel ID.

**Gateway YAML:**

```yaml
channels:
  - type: slack
    botToken: xoxb-...
```

---

### API

Provides a REST + Server-Sent Events interface for programmatic consumers.

```typescript
import { ApiChannel } from "@kilnai/runtime";

const api = new ApiChannel();
```

**API key authentication** is configured at the gateway level via `apiKeyEnv` on the channel binding in `gateway.yaml`. The gateway applies `requireApiKey` middleware automatically when configured.

**Incoming messages:**

```typescript
import { textParts } from "@kilnai/core";

await api.receive({
  parts: textParts(body.message),
  source: "api",
  userId: body.userId,
});
```

**Outgoing messages.** `send()` queues the message (max 100 items, oldest discarded when full) and broadcasts an SSE frame to connected clients.

**REST polling** (for consumers without SSE):

```typescript
app.get("/responses", (c) => {
  const responses = api.pollResponses(); // returns and clears the queue
  return c.json(responses);
});
```

**SSE streaming:**

```typescript
api.addSseClient(writer);    // on SSE connection open
api.removeSseClient(writer); // on SSE connection close
```

`stream()` forwards engine events as SSE frames: `data: { type: "event", event, payload, timestamp }`.

**Gateway YAML:**

```yaml
channels:
  - type: api
    path: /api/my-app
    apiKeyEnv: MY_APP_API_KEY
```

The `path` must be unique across all Apps in `gateway.yaml`. When `apiKeyEnv` is configured, the gateway applies `requireApiKey` middleware on all routes under that path. Clients must include `X-Api-Key: <key>` in request headers. If `apiKeyEnv` is not configured, a warning is logged at startup and endpoints are unauthenticated.

---

## Content Parts

All messages use `parts: readonly ContentPart[]` -- a discriminated union of four types:

| Type | Key Fields |
|------|-----------|
| `TextPart` | `type: "text"`, `text` |
| `ImagePart` | `type: "image"`, `mimeType`, `data?`, `url?` |
| `AudioPart` | `type: "audio"`, `mimeType`, `data?`, `url?`, `durationMs?` |
| `FilePart` | `type: "file"`, `mimeType`, `data?`, `url?`, `filename?` |

See [Architecture Reference](../architecture.md) for the full TypeScript interface definitions.

Helper functions from `@kilnai/core`:

```typescript
import { textPart, textParts, extractText, hasModality } from "@kilnai/core";

textPart("hello")             // -> TextPart
textParts("hello")            // -> readonly ContentPart[] with one TextPart
extractText(parts)            // -> concatenated string from all TextParts
hasModality(parts, "image")   // -> true if any ImagePart is present
```

---

## Routing

Incoming messages flow through `ChannelRouter` before reaching a team:

```
IncomingMessage
  -> IdentityResolver.resolve(channelName, platformUserId)   // platform ID -> engine user ID
  -> ChannelRouterRule[] (regex on extractText(parts), first match wins)
  -> fallbackTeam (if no rule matches)
  -> onRoute() handler
  -> OutgoingMessage via Channel.send() on source channel
```

`resolveTeam(content)` is a synchronous method that applies only the pattern-matching step without identity resolution or dispatch.

**Identity resolution:**

```typescript
import { InMemoryIdentityResolver } from "@kilnai/runtime";

const resolver = new InMemoryIdentityResolver();
resolver.addMapping("whatsapp", "+521234567890", "user:abc123");
```

Production deployments provide a custom `IdentityResolver` that queries a user identity store.

---

## Handoff Integration

Channels participate in the human handoff workflow. When a session is in `queued` or `human_active` mode, messages from end users are stored in the session history but AI does not respond -- the channel receives a `queued: true` signal instead of AI output.

**WebSocket (multi-tenant).** `ws-tenant-routes.ts` emits `HANDOFF_MESSAGE_QUEUED` conversation events when a message arrives for a non-`ai_active` session, and `ESCALATION_DETECTED` events when the escalation detector triggers. Operator messages sent via the handoff API are delivered as WebSocket frames to the connected user.

**WhatsApp.** `whatsapp-webhook-routes.ts` follows the same pattern: `HANDOFF_MESSAGE_QUEUED` and `ESCALATION_DETECTED` events are emitted. Operator messages are delivered via the WhatsApp Business API (`sendWhatsAppMessage`).

**Instagram.** `instagram-webhook-routes.ts` follows the same pattern as WhatsApp. Operator messages are delivered via the Instagram Send API.

**Messenger.** `messenger-webhook-routes.ts` follows the same pattern as WhatsApp. Operator messages are delivered via the Messenger Send API.

**Email.** `email-webhook-routes.ts` handles handoff for email. Queued messages are stored and `HANDOFF_MESSAGE_QUEUED` events are emitted. Operator messages are delivered as email replies with proper threading headers.

**REST API.** The shared `message-pipeline.ts` handles handoff for API channel requests. The response includes `{ queued: true }` when a message is queued for human review.

All channels call `SessionRegistry.save()` after processing to persist session mutations (critical for Redis-backed stores).

See [Gateway YAML Reference](../configuration/gateway-yaml.md#session--handoff) for the handoff API routes and event types.

---

## Integration with Gateway

Channels are declared per-App in `gateway.yaml` via channel bindings. The Gateway instantiates the corresponding adapter for each binding and mounts its routes under the Hono router. Each App has its own isolated set of channel instances.

See [Gateway YAML Reference](../configuration/gateway-yaml.md) for the full binding schema and validation rules.
