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
| Slack | `SlackChannel` | full | HTTPS (Bot Events + Web API) | HMAC-SHA256 (signing secret) | text, image, file |
| API | `ApiChannel` | structured | HTTP REST + SSE | API key (`apiKeyEnv`) | text, image, audio, file |

---

## Message Formats

**`short` — Plain Text.** Used by WhatsApp. Markdown is stripped before delivery: code blocks become `[code block]`, inline code has backticks removed, bold and italic markers are stripped, and links are reduced to display text. Output is truncated to 4,096 characters.

**`full` — Full Markdown.** Used by CLI, Web, and Slack. Content is delivered without modification. Markdown renders natively in the Slack client and in the web console.

**`structured` — JSON Envelope.** Used by the REST API adapter. Content is placed inside a typed JSON object with explicit fields (`type`, `content`, `target`, `userId`, `threadId`), enabling programmatic consumers to parse and route responses without text parsing.

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

**Multi-tenant mode.** For SaaS products with `multiTenant: true`, the Gateway mounts `ws-tenant-routes.ts` instead. Clients connect with `?widgetId=UUID`, which resolves to a tenant via `TenantRegistry.resolveByWidgetId()`. The tenant's system prompt, billing, and idle timeout are applied per-session.

**Origin validation** is enforced on multi-tenant WebSocket connections. After tenant resolution, the `Origin` header is checked against `TenantConfig.allowedOrigins` (with fallback to the channel-level `allowedOrigins`). Localhost and 127.0.0.1 are always allowed. Connections from disallowed origins receive a `403` before upgrade.

```yaml
channels:
  - type: web
    multiTenant: true
    adminTokenEnv: MY_ADMIN_TOKEN
    allowedOrigins:
      - https://myapp.com
```

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

**Multi-tenant mode.** For SaaS products serving multiple businesses through one WhatsApp number, use `multiTenant: true` with `verifyTokenEnv`. This enables tenant resolution by `phone_number_id`, persistent per-tenant memory (SQLite + FTS5), and builtin `notify_owner` tool for real-time escalation to the business owner. See [`examples/whatsapp-bot/`](../../examples/whatsapp-bot/) for a complete working example.

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

## Integration with Gateway

Channels are declared per-App in `gateway.yaml` via channel bindings. The Gateway instantiates the corresponding adapter for each binding and mounts its routes under the Hono router. Each App has its own isolated set of channel instances.

See [Gateway YAML Reference](../configuration/gateway-yaml.md) for the full binding schema and validation rules.
