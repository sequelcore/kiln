# React SDK (@kilnai/react)

`@kilnai/react` is a React hooks library for building frontends that communicate with a Kiln Gateway. It provides typed hooks for chat, event streaming, approvals, and dev state. Memory is exposed through Gateway and resource-plane contracts rather than SDK-owned memory CRUD hooks.

The SDK imports only **types** from `@kilnai/core` — never implementations or runtime code. Peer dependency: React 19+.

## Installation

```bash
bun add @kilnai/react
```

## KilnProvider

`KilnProvider` establishes the Kiln context for all hooks. Wrap your application root (or the subtree that needs Kiln access) with it.

```typescript
interface KilnConfig {
  readonly baseUrl: string;              // Gateway URL, e.g. "http://localhost:4800"
  readonly appName?: string;             // Default App name for useKilnChat
  readonly userId?: string;              // User ID for session scoping
  readonly reconnectDelayMs?: number;    // SSE reconnect delay in milliseconds (default: 3000)
}

interface KilnProviderProps {
  readonly config: KilnConfig;
  readonly children: ReactNode;
}
```

```tsx
import { KilnProvider } from "@kilnai/react";

export function App() {
  return (
    <KilnProvider config={{ baseUrl: "http://localhost:4800", appName: "my-app", userId: "user-123" }}>
      <Chat />
    </KilnProvider>
  );
}
```

`KilnProvider` creates one `ApiClient` instance per unique `baseUrl`. The client is memoized and recreated only when `baseUrl`, `appName`, `userId`, or `reconnectDelayMs` changes.

Calling any hook outside a `KilnProvider` throws: `"useKilnContext must be used within a KilnProvider"`.

## useKilnContext

> **@internal** -- Exposes the raw `ApiClient` and `KilnConfig`. Intended for dev tooling (e.g. Studio), not public consumers.

```typescript
function useKilnContext(): { readonly config: KilnConfig; readonly client: ApiClient }
```

All hooks use `useKilnContext` internally. It is exported for advanced use cases where direct access to the `ApiClient` is needed, such as custom fetch calls or Studio-specific views.

## useKilnChat

Manages a chat session with a Kiln App. Sends messages via `POST /apps/{appName}/message` and maintains local message history.

```typescript
function useKilnChat(options?: ChatOptions): UseChatReturn

interface ChatOptions {
  readonly appName?: string;    // Overrides KilnProvider config.appName
  readonly sessionId?: string;  // Optional session hint
}

interface UseChatReturn {
  readonly messages: readonly ChatMessage[];
  send(content: string | ContentPart[]): Promise<void>;
  readonly isLoading: boolean;
  readonly error: Error | null;
  clearMessages(): void;
}

interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly parts?: readonly ContentPart[];  // Present for multimodal messages
  readonly timestamp: number;
}
```

```tsx
import { useKilnChat } from "@kilnai/react";

function Chat() {
  const { messages, send, isLoading, error } = useKilnChat();

  return (
    <div>
      {messages.map((m) => (
        <p key={m.id}><strong>{m.role}:</strong> {m.content}</p>
      ))}
      {isLoading && <p>Thinking...</p>}
      {error && <p>Error: {error.message}</p>}
      <button onClick={() => send("Hello")}>Send</button>
    </div>
  );
}
```

`send` accepts either a plain string or a `ContentPart[]` array for multimodal messages. `clearMessages()` resets local history and clears any error state.

## useKilnWsChat

WebSocket-based alternative to `useKilnChat`. Opens a persistent WebSocket to `/apps/{appName}/ws`, sends messages as JSON frames, and receives responses in real time. Returns the same `UseChatReturn` interface -- drop-in replacement.

```typescript
function useKilnWsChat(options?: ChatOptions): UseChatReturn
```

```tsx
import { useKilnWsChat } from "@kilnai/react";

function Chat() {
  const { messages, send, isLoading, error, clearMessages } = useKilnWsChat();
  // Identical API to useKilnChat -- same JSX works
}
```

**Protocol:** The hook sends `WsChatRequest` frames (`{ type: "message", content, parts? }`) and receives `WsChatFrame` responses:
- `done` -- full response with `content`, `parts`, `inputTokens`, `outputTokens`
- `error` -- server-side error with `message`
- `chunk` -- reserved for future streaming (not handled yet)

**Connection lifecycle:** Connects on mount, disconnects on unmount. The `userId` is encoded in the WebSocket URL query parameter at connection time. If `config.userId` is not set, a stable random UUID is generated once per component lifetime.

**When to use which:**
- `useKilnWsChat` -- Studio Playground and real-time UIs where low latency matters
- `useKilnChat` -- simpler integrations, server-rendered pages, or when HTTP is preferred

## useKilnEvents

Connects to the Gateway's SSE event stream at `/dev/events`. Maintains a typed event buffer capped at 500 events.

```typescript
function useKilnEvents(): UseEventsReturn

interface UseEventsReturn {
  readonly events: readonly KilnEventData[];
  readonly connected: boolean;
  clear(): void;
}

interface KilnEventData {
  readonly type: string;                    // e.g. "phase_changed", "tool_called"
  readonly timestamp: string;
  readonly data: Record<string, unknown>;
}
```

```tsx
import { useKilnEvents } from "@kilnai/react";

function EventLog() {
  const { events, connected, clear } = useKilnEvents();

  return (
    <div>
      <span>{connected ? "Connected" : "Disconnected"}</span>
      <button onClick={clear}>Clear</button>
      {events.map((e, i) => (
        <p key={i}>[{e.type}] {JSON.stringify(e.data)}</p>
      ))}
    </div>
  );
}
```

The hook connects on mount and disconnects on unmount. `SseClient` handles auto-reconnect automatically. `connected` reflects the current connection state.

This hook is intended for dev tooling and the Studio. For production monitoring, consume events directly from the Gateway's SSE endpoint.

## useKilnState

Fetches Gateway state, cost tracking, and loaded App names from the dev API. Fetches from three endpoints in parallel: `/dev/state`, `/dev/cost`, `/dev/apps`.

```typescript
function useKilnState(): UseStateReturn

interface UseStateReturn {
  readonly state: Record<string, unknown>;
  readonly cost: Record<string, unknown>;
  readonly apps: readonly string[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  refresh(): Promise<void>;
}
```

```tsx
import { useKilnState } from "@kilnai/react";

function StatusBar() {
  const { apps, cost, isLoading, error, refresh } = useKilnState();

  return (
    <div>
      <span>Apps: {apps.join(", ")}</span>
      <button onClick={refresh} disabled={isLoading}>Refresh</button>
      {error && <p>Error: {error.message}</p>}
    </div>
  );
}
```

State is not loaded automatically on mount. Call `refresh()` to fetch. Failed requests are captured in the `error` field -- dev endpoints may not be available in all environments.

## useApproval

Provides approve/reject actions for pending phase gates via the dev API.

```typescript
function useApproval(): UseApprovalReturn

interface UseApprovalReturn {
  readonly approve: (sessionId?: string) => Promise<void>;
  readonly reject: (reason: string, sessionId?: string) => Promise<void>;
  readonly isLoading: boolean;
  readonly error: Error | null;
}
```

```tsx
import { useApproval } from "@kilnai/react";

function ApprovalPanel() {
  const { approve, reject, isLoading, error } = useApproval();

  return (
    <div>
      <button onClick={() => approve()} disabled={isLoading}>Approve</button>
      <button onClick={() => reject("not ready")} disabled={isLoading}>Reject</button>
      {error && <p>Error: {error.message}</p>}
    </div>
  );
}
```

`approve(sessionId?)` calls `POST /dev/approve`. `reject(reason, sessionId?)` calls `POST /dev/reject`. When `sessionId` is omitted, the gateway targets the first session in `awaiting_approval` state.

## ApiClient and SseClient

The SDK exposes two low-level clients for direct use:

**`ApiClient`** is a fetch wrapper initialized with a `baseUrl`. Methods: `get<T>(path)`, `post<T>(path, body)`, `delete<T>(path)`. Parses JSON responses and throws on non-2xx status.

**`SseClient`** is an `EventSource` wrapper with auto-reconnect. Accepts `onEvent`, `onConnect`, and `onDisconnect` callbacks. Call `connect()` to start and `disconnect()` to stop.

`SseClient` uses **named SSE events** — it subscribes to all 31 engine event types (e.g., `phase_changed`, `tool_called`, `pii_detected`) via `EventSource.addEventListener()` rather than the generic `onmessage` handler. This means the server must emit frames with an `event:` field:

```
event: phase_changed
data: {"phase":"implement","phaseName":"Implement","timestamp":"..."}
```

On connect, the server replays recent event history (up to 50 events) so that late-joining clients receive context.

```typescript
import { ApiClient, SseClient } from "@kilnai/react";

const client = new ApiClient("http://localhost:4800");
const data = await client.get<Record<string, unknown>>("/dev/state");

const sse = new SseClient("http://localhost:4800/dev/events", {
  onEvent(event) { console.log(event); },
  onConnect() { console.log("connected"); },
  onDisconnect() { console.log("disconnected"); },
});
sse.connect();
```

Both clients are used internally by the hooks. Access them directly only when the hooks do not cover your use case.
