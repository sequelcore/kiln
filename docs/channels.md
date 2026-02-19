# Channel Adapter Layer

## Overview

Channels are the platform adapters that connect the Kiln engine to external messaging systems. The `Channel` interface is an engine primitive: the orchestrator, agents, and memory subsystems produce content without any knowledge of the delivery platform. All platform-specific concerns — transport protocols, authentication, message length constraints, and format adaptation — are encapsulated inside channel adapter implementations.

The engine routes outgoing messages through channels transparently. Agents always address a `target` and a `format`; the channel resolves how that maps to a real platform API call or I/O operation.

## Channel Primitive

All adapters implement the `Channel` interface defined in `packages/core/src/engine/domain/channel.ts`.

```typescript
export type MessageFormat = "short" | "full" | "structured";

export interface IncomingMessage {
  readonly content: string;
  readonly source: string;
  readonly userId?: string;
  readonly threadId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface OutgoingMessage {
  readonly content: string;
  readonly target: string;
  readonly format?: MessageFormat;
  readonly userId?: string;
  readonly threadId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface EngineEvent {
  readonly type: string;
  readonly timestamp: Date;
  readonly payload: Record<string, unknown>;
}

export interface Channel {
  readonly name: string;
  readonly defaultFormat: MessageFormat;
  receive(message: IncomingMessage): Promise<void>;
  send(response: OutgoingMessage): Promise<void>;
  stream(events: AsyncIterable<EngineEvent>): Promise<void>;
}
```

**`receive()`** accepts a message from the external platform and forwards it to the registered message handler for processing.

**`send()`** delivers a formatted response to the target address on the external platform.

**`stream()`** consumes an `AsyncIterable<EngineEvent>` and forwards each event to the platform in real time. The concrete behavior varies by adapter: the web adapter sends JSON frames over WebSocket; the WhatsApp and Slack adapters post individual messages; the API adapter writes SSE frames.

## Message Formats

The `MessageFormat` type controls how `MessageFormatter.formatForChannel()` adapts content before delivery.

### `short` — Plain Text

Used by WhatsApp and SMS adapters. Markdown is stripped before delivery: code blocks become `[code block]`, inline code has backticks removed, bold and italic markers are stripped, headers lose their prefix characters, and links are reduced to their display text. The resulting plain text is truncated to 4,096 characters.

### `full` — Full Markdown

Used by CLI and Web (WebSocket) adapters, and Slack. Content is delivered without modification. Markdown renders natively in the Slack client and in the web console's terminal output component.

### `structured` — JSON Fields

Used by the REST API adapter. Content is placed inside a typed JSON envelope with explicit fields (`type`, `content`, `target`, `userId`, `threadId`), allowing programmatic consumers to parse and route responses without text parsing.

## Core Infrastructure

### EventBridge

**File:** `packages/runtime/src/channels/event-bridge.ts`

`EventBridge` bridges the synchronous push model of `EventBus` to the pull model required by `Channel.stream()`. The engine's `EventBus` fires events with `onAny()` callbacks; `Channel.stream()` expects an `AsyncIterable<EngineEvent>`. `EventBridge` connects these two models with a bounded internal queue.

```typescript
const bridge = new EventBridge(/* maxQueueSize = 1000 */);
bridge.connect(eventBus);        // subscribe to EventBus.onAny()
channel.stream(bridge.events()); // pipe to any Channel adapter
// ...
bridge.disconnect();             // flush queue, signal generator to complete
```

The queue holds up to 1,000 events. When the consumer is slower than the producer, events beyond the limit are silently dropped rather than causing unbounded memory growth. `disconnect()` signals the async generator to drain remaining queued events and then return.

`toEngineEvent()` converts an internal engine event (which carries a `sessionId`) to the `EngineEvent` shape required by the `Channel` interface, placing `sessionId` and remaining fields into the `payload` record.

### ChannelRegistry

**File:** `packages/runtime/src/channels/channel-registry.ts`

`ChannelRegistry` manages the set of active `Channel` instances for a running App.

| Method | Description |
|--------|-------------|
| `register(channel)` | Add a channel by its `name` property. |
| `unregister(name)` | Remove a channel, returns `true` if it existed. |
| `get(name)` | Retrieve a specific channel by name. |
| `getAll()` | Return a snapshot of all registered channels. |
| `sendTo(name, message)` | Deliver to one channel; returns `false` if not found. |
| `broadcast(message)` | Deliver to all channels with `Promise.allSettled`. |
| `streamTo(name, events)` | Pipe an event iterable to one channel's `stream()`. |

`broadcast()` uses `Promise.allSettled` so that a failure on one channel does not prevent delivery to the others.

### MessageFormatter

**File:** `packages/runtime/src/channels/message-formatter.ts`

Two exported functions form the single source of truth for message formatting across all adapters.

**`formatSdkMessage(msg)`** converts a raw SDK message (from the Agent SDK generator) into an `OutputLine` with `.text`, `.stream` (`"stdout"`, `"stderr"`, or `"system"`), and `.timestamp`. Handled types: `system/init`, `assistant/text`, `assistant/tool_use`, `assistant/tool_result`, `result/success`, `result/error`. Returns `null` for unknown types.

**`formatForChannel(content, format)`** applies the format-specific transformation described in the Message Formats section above.

The internal `stripMarkdown()` function handles: fenced code blocks, inline code, bold, italic, ATX headers, and Markdown links. It is not exported; it is applied exclusively by the `short` path of `formatForChannel()`.

### ChannelRouter

**File:** `packages/runtime/src/channels/channel-router.ts`

`ChannelRouter` routes an `IncomingMessage` from any channel to the correct team, resolves the sender's engine-unified identity, and sends the response back through the originating channel.

```typescript
export interface RouteResult {
  readonly team: string;
  readonly engineUserId: string | null;
  readonly channelName: string;
  readonly message: IncomingMessage;
}

export interface ChannelRouterRule {
  readonly match: RegExp;
  readonly team: string;
}
```

Routing pipeline for each call to `route(channelName, message)`:

1. **Identity resolution.** If an `IdentityResolver` is configured and `message.userId` is present, `IdentityResolver.resolve(channelName, platformUserId)` maps the platform-specific user ID to an engine user ID. If resolution returns `null`, `engineUserId` is `null` in the `RouteResult`.

2. **Pattern matching.** Each `ChannelRouterRule.match` regex is tested against `message.content` in declaration order. The first match sets the target team. If no rule matches, the `fallbackTeam` is used.

3. **Dispatch and response.** If an `onRoute()` handler is registered, it receives the `RouteResult` and may return an `OutgoingMessage`. If a response is returned, it is delivered via `ChannelRegistry.get(channelName).send()` — the response always flows back through the channel that received the original message.

`resolveTeam(content)` is a synchronous convenience method that applies only the pattern-matching step, returning the team name without performing identity resolution or dispatch.

### IdentityResolver

**File:** `packages/runtime/src/channels/channel-router.ts`

```typescript
export interface IdentityResolver {
  resolve(channelName: string, platformUserId: string): Promise<string | null>;
}
```

`InMemoryIdentityResolver` is a development and test implementation backed by a `Map`. Production deployments provide a custom resolver that queries a user identity store.

```typescript
const resolver = new InMemoryIdentityResolver();
resolver.addMapping("whatsapp", "+521234567890", "user:abc123");
```

## Channel Adapters

### Adapter Comparison

| Adapter | Class | Format | Transport | Authentication | Typical Use |
|---------|-------|--------|-----------|----------------|-------------|
| CLI | `CliChannel` | `full` | stdin / stdout | None | Local sessions, development |
| Web | `WebChannel` | `full` | WebSocket (Hono) | Session-level (delegated) | Web console dashboard |
| WhatsApp | `WhatsAppChannel` | `short` | HTTPS (Business API v21.0) | Bearer token + verify token | WhatsApp Business messaging |
| Slack | `SlackChannel` | `full` | HTTPS (Bot Events + Web API) | Bearer token + HMAC-SHA256 | Slack workspace bot |
| API | `ApiChannel` | `structured` | HTTP REST + SSE | Optional API key | Programmatic integrations |

### CLI (`CliChannel`)

**File:** `packages/runtime/src/channels/cli-channel.ts`

Wraps `process.stdin` and `process.stdout` as a `Channel`. Used during local CLI sessions. No configuration is required.

```typescript
const cli = new CliChannel();
cli.onMessage((msg) => { /* orchestrator processes msg */ });
```

- `send()` writes `formatForChannel(content, "full") + "\n"` to `process.stdout`.
- `stream()` writes `[type] {payload JSON}` lines to `process.stdout` for each engine event.
- `receive()` calls the registered `onMessage` handler. The handler is wired by the session layer.

### Web (`WebChannel`)

**File:** `packages/runtime/src/channels/web-channel.ts`

Wraps Hono WebSocket connections as a `Channel`. Manages a set of concurrent client connections. Clients can connect and disconnect at any time without interrupting the session.

```typescript
const web = new WebChannel();
web.addClient(wsContext);     // on WebSocket open
web.removeClient(wsContext);  // on WebSocket close
```

- `send()` broadcasts a JSON frame `{ type: "output", text, target, userId, threadId }` to all clients whose `readyState === 1`. If a `send()` call throws, the client is removed from the set automatically.
- `stream()` broadcasts a JSON frame `{ type: "event", event, data, timestamp }` per engine event.
- `clientCount` is exposed for monitoring.

The `WebSocketLike` interface (`{ send(data: string): void; readonly readyState: number }`) is compatible with Hono's `WSContext` and the standard browser `WebSocket`.

### WhatsApp (`WhatsAppChannel`)

**File:** `packages/runtime/src/channels/whatsapp-channel.ts`

Connects to the WhatsApp Business Cloud API at `graph.facebook.com/v21.0`. No third-party SDK is used; all calls use native `fetch`.

**Configuration:**

```typescript
const whatsapp = new WhatsAppChannel({
  phoneNumberId: "PHONE_NUMBER_ID",  // from WhatsApp Business settings
  accessToken: "ACCESS_TOKEN",       // permanent or system user token
  verifyToken: "MY_VERIFY_TOKEN",    // arbitrary secret set in Meta dashboard
});
```

**Webhook verification.** The Meta platform sends a one-time GET request to confirm the webhook URL. Call `verifyWebhook(mode, token, challenge)` inside your webhook handler:

```typescript
// In Hono GET handler for the webhook path:
const challenge = whatsapp.verifyWebhook(
  c.req.query("hub.mode"),
  c.req.query("hub.verify_token"),
  c.req.query("hub.challenge"),
);
if (challenge) return c.text(challenge);
return c.text("Forbidden", 403);
```

Returns the `challenge` string if `mode === "subscribe"` and `token` matches `verifyToken`; returns `null` otherwise.

**Incoming messages.** Parse the Cloud API webhook payload and pass it to `receive()`:

```typescript
const body = await c.req.json();
const msg = body.entry[0].changes[0].value.messages[0];
await whatsapp.receive({
  content: msg.text.body,
  source: "whatsapp",
  userId: msg.from,       // E.164 phone number
  threadId: msg.id,
});
```

**Outgoing messages.** `send()` posts to the Cloud API. `response.target` must be the recipient's E.164 phone number. Content is formatted as `short` before delivery.

### Slack (`SlackChannel`)

**File:** `packages/runtime/src/channels/slack-channel.ts`

Connects to the Slack Bot Events API (inbound) and the Slack Web API `chat.postMessage` endpoint (outbound). No third-party SDK is used.

**Configuration:**

```typescript
const slack = new SlackChannel({
  botToken: "xoxb-...",      // Bot User OAuth Token from Slack app settings
  signingSecret: "...",      // Signing secret from Slack app settings
});
```

**Request verification.** All Slack webhook requests must be verified before processing. Call `verifyRequest()` inside your webhook handler:

```typescript
const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
const signature = c.req.header("x-slack-signature") ?? "";
const rawBody = await c.req.text();

if (!slack.verifyRequest(timestamp, rawBody, signature)) {
  return c.text("Unauthorized", 401);
}
```

`verifyRequest()` computes `HMAC-SHA256("v0:{timestamp}:{body}", signingSecret)`, prepends `"v0="`, and compares against the provided signature using a timing-safe buffer comparison (`node:crypto` `timingSafeEqual`). Returns `false` if lengths differ or the HMAC does not match.

**Incoming messages.** Parse the Slack Events API payload and call `receive()`:

```typescript
await slack.receive({
  content: event.text,
  source: "slack",
  userId: event.user,
  threadId: event.thread_ts ?? event.ts,
});
```

**Outgoing messages.** `send()` posts to `chat.postMessage`. If `response.threadId` is set, it is sent as `thread_ts`, posting the reply in-thread. `response.target` must be the Slack channel ID.

### API (`ApiChannel`)

**File:** `packages/runtime/src/channels/api-channel.ts`

Provides a REST + Server-Sent Events interface for programmatic API consumers.

**Configuration:**

```typescript
const api = new ApiChannel({ apiKey: "secret-key" }); // omit apiKey to disable auth
```

**API key validation.** Call `validateApiKey()` in your route middleware before forwarding messages to the channel. If no `apiKey` was configured, `validateApiKey()` always returns `true`.

```typescript
const key = c.req.header("x-api-key") ?? "";
if (!api.validateApiKey(key)) return c.json({ error: "Unauthorized" }, 401);
```

**Incoming messages.** Parse the request body and call `receive()`:

```typescript
await api.receive({ content: body.message, source: "api", userId: body.userId });
```

**Outgoing messages.** `send()` does two things:

1. Queues the `OutgoingMessage` in a bounded response queue (maximum 100 items). When the queue is full, the oldest entry is discarded.
2. Broadcasts an SSE frame `data: { type: "message", content, target, userId, threadId }` to all connected SSE clients.

**REST polling.** Consumers that do not maintain an SSE connection can poll `pollResponses()`:

```typescript
app.get("/responses", (c) => {
  const responses = api.pollResponses(); // returns and clears the queue
  return c.json(responses);
});
```

**SSE streaming.** Register and deregister SSE writers as clients connect and disconnect:

```typescript
api.addSseClient(writer);
api.removeSseClient(writer);
```

`stream()` forwards engine events as SSE frames: `data: { type: "event", event, payload, timestamp }`.

## Routing

Incoming messages follow a two-step routing pipeline through `ChannelRouter`:

```
IncomingMessage
  -> IdentityResolver.resolve(channelName, platformUserId)
  -> ChannelRouterRule[] (regex match on content, first wins)
  -> fallbackTeam (if no rule matches)
  -> onRoute() handler
  -> OutgoingMessage via Channel.send() on source channel
```

Pattern rules are defined as `{ match: RegExp, team: string }` pairs. Rules are evaluated in declaration order; evaluation stops at the first match. If no rule matches, the configured `fallbackTeam` is used. The fallback guarantees that every message is dispatched, even if no routing rules are configured.

The `onRoute()` callback receives the full `RouteResult` (resolved team, resolved user ID, originating channel name, original message) and returns either an `OutgoingMessage` to deliver or `null` to suppress the response.

## Integration with Gateway

In the Gateway, channels are declared per-App in `gateway.yaml` via `GatewayChannelBinding`. Each binding specifies a `type` and type-specific parameters.

```yaml
port: 4800
apps:
  - name: my-app
    config: apps/my-app.yaml
    channels:
      - type: api
        path: /api/my-app
      - type: whatsapp
        phoneNumber: "+521234567890"
```

The `gateway-server.ts` reads these bindings, instantiates the corresponding adapter for each binding, and mounts the adapter's routes under the Gateway's Hono router. Each App receives its own isolated set of channel instances; there is no cross-App channel sharing.

Channel bindings are validated by `validateGatewayConfig()` at startup. Duplicate API paths and duplicate phone numbers within the same gateway configuration are rejected with descriptive validation errors before the server starts.
