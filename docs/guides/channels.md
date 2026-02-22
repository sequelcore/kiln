# Channel Adapters

Channels are platform adapters that connect the Kiln engine to external messaging systems. Agents produce content without knowledge of the delivery platform; channel adapters handle all transport, authentication, and format concerns.

Sources: `packages/runtime/src/channels/`, `packages/core/src/engine/domain/channel.ts`

---

## Adapter Comparison

| Adapter | Class | Format | Transport | Auth | Modalities |
|---------|-------|--------|-----------|------|------------|
| CLI | `CliChannel` | full | stdin / stdout | None | text |
| Web | `WebChannel` | full | WebSocket (Hono) | Session-level (delegated) | text, image, audio, file |
| WhatsApp | `WhatsAppChannel` | short | HTTPS (Business API v21.0) | Bearer token + verify token | text, image, audio, file |
| Slack | `SlackChannel` | full | HTTPS (Bot Events + Web API) | Bearer token + HMAC-SHA256 | text, image, file |
| API | `ApiChannel` | structured | HTTP REST + SSE | Optional API key | text, image, audio, file |
| Voice | `VoiceChannel` | full | STT/TTS pipeline | None | text, audio |

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

Manages a set of concurrent WebSocket connections. Clients can connect and disconnect without interrupting the session.

```typescript
import { WebChannel } from "@kilnai/runtime";

const web = new WebChannel();

// On WebSocket open:
web.addClient(wsContext);

// On WebSocket close:
web.removeClient(wsContext);
```

`send()` broadcasts a JSON frame `{ type: "output", text, target, userId, threadId }` to all clients with `readyState === 1`. `stream()` broadcasts `{ type: "event", event, data, timestamp }` per engine event.

**Gateway YAML:**

```yaml
channels:
  - type: web
```

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

**Gateway YAML:**

```yaml
channels:
  - type: whatsapp
    phoneNumber: "+521234567890"
```

The `phoneNumber` in `gateway.yaml` must be unique across all Apps.

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

const api = new ApiChannel({ apiKey: process.env.API_KEY }); // omit apiKey to disable auth
```

**API key validation:**

```typescript
const key = c.req.header("x-api-key") ?? "";
if (!api.validateApiKey(key)) return c.json({ error: "Unauthorized" }, 401);
```

If no `apiKey` was configured, `validateApiKey()` always returns `true`.

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
```

The `path` must be unique across all Apps in `gateway.yaml`.

---

### Voice

Provides a voice interface using STT (speech-to-text) and TTS (text-to-speech) adapters.

```typescript
import { VoiceChannel, OpenAISttAdapter, OpenAITtsAdapter } from "@kilnai/runtime";

const voice = new VoiceChannel({
  stt: new OpenAISttAdapter({ apiKey: process.env.OPENAI_API_KEY }),
  tts: new OpenAITtsAdapter({
    apiKey: process.env.OPENAI_API_KEY,
    voice: "alloy",
  }),
});
```

`receive()` transcribes `AudioPart` content via `SttAdapter` and passes `TextPart` content through unchanged. `send()` synthesizes text parts via `TtsAdapter`.

**Available adapters:**
- `OpenAISttAdapter` — OpenAI Whisper API, fetch-based
- `OpenAITtsAdapter` — OpenAI TTS API, fetch-based

**YAML configuration:**

```yaml
channels: [voice]

voice:
  stt:
    provider: openai
    apiKeyEnv: OPENAI_API_KEY
    model: whisper-1
  tts:
    provider: openai
    apiKeyEnv: OPENAI_API_KEY
    voice: alloy
```

**Gateway YAML:**

```yaml
channels:
  - type: voice
```

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
