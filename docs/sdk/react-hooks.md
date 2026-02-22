# React SDK (@kilnai/react)

`@kilnai/react` is a React hooks library for building frontends that communicate with a Kiln Gateway. It provides typed hooks for chat, event streaming, memory management, and dev state.

The SDK imports only **types** from `@kilnai/core` — never implementations or runtime code. Peer dependency: React 19+.

## Installation

```bash
bun add @kilnai/react
```

## KilnProvider

`KilnProvider` establishes the Kiln context for all hooks. Wrap your application root (or the subtree that needs Kiln access) with it.

```typescript
interface KilnConfig {
  readonly baseUrl: string;    // Gateway URL, e.g. "http://localhost:4800"
  readonly appName?: string;   // Default App name for useKilnChat
  readonly userId?: string;    // User ID for session scoping
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

`KilnProvider` creates one `ApiClient` instance per unique `baseUrl`. The client is memoized and recreated only when `baseUrl`, `appName`, or `userId` changes.

Calling any hook outside a `KilnProvider` throws: `"useKilnContext must be used within a KilnProvider"`.

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

## useKilnMemory

Provides CRUD access to a specific memory scope via the dev API.

```typescript
function useKilnMemory(scope: string): UseMemoryReturn

interface UseMemoryReturn {
  readonly entries: readonly MemoryEntry[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  refresh(): Promise<void>;
  create(entry: CreateMemoryInput): Promise<void>;
  remove(id: string): Promise<void>;
}

interface MemoryEntry {
  readonly id: string;
  readonly scope: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

interface CreateMemoryInput {
  readonly scope: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}
```

```tsx
import { useKilnMemory } from "@kilnai/react";

function MemoryPanel() {
  const { entries, isLoading, refresh, create, remove } = useKilnMemory("user");

  return (
    <div>
      <button onClick={refresh}>Refresh</button>
      {entries.map((e) => (
        <div key={e.id}>
          <span>{e.content}</span>
          <button onClick={() => remove(e.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
```

Entries are not loaded automatically on mount — call `refresh()` explicitly. `create()` calls `POST /dev/memory` then calls `refresh()`. `remove()` calls `DELETE /dev/memory/{id}` then calls `refresh()`.

Scope values match the engine's `MemoryScope` type: `"user"`, `"agent:{role}"`, `"team:{name}"`, `"project:{path}"`, `"org"`.

## useKilnState

Fetches Gateway state, cost tracking, and loaded App names from the dev API. Fetches from three endpoints in parallel: `/dev/state`, `/dev/cost`, `/dev/apps`.

```typescript
function useKilnState(): UseStateReturn

interface UseStateReturn {
  readonly state: Record<string, unknown>;
  readonly cost: Record<string, unknown>;
  readonly apps: readonly string[];
  readonly isLoading: boolean;
  refresh(): Promise<void>;
}
```

```tsx
import { useKilnState } from "@kilnai/react";

function StatusBar() {
  const { apps, cost, isLoading, refresh } = useKilnState();

  return (
    <div>
      <span>Apps: {apps.join(", ")}</span>
      <button onClick={refresh} disabled={isLoading}>Refresh</button>
    </div>
  );
}
```

State is not loaded automatically on mount. Call `refresh()` to fetch. Errors are silently swallowed — dev endpoints may not be available in all environments.

## ApiClient and SseClient

The SDK exposes two low-level clients for direct use:

**`ApiClient`** is a fetch wrapper initialized with a `baseUrl`. Methods: `get<T>(path)`, `post<T>(path, body)`, `delete<T>(path)`. Parses JSON responses and throws on non-2xx status.

**`SseClient`** is an `EventSource` wrapper with auto-reconnect. Accepts `onEvent`, `onConnect`, and `onDisconnect` callbacks. Call `connect()` to start and `disconnect()` to stop.

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
