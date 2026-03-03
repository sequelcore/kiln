<p align="center">
  <img src="https://raw.githubusercontent.com/sequelcore/kiln/main/docs/assets/mascot.png" alt="Kiln" width="120" />
</p>

<h1 align="center">@kilnai/react</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@kilnai/react"><img src="https://img.shields.io/npm/v/@kilnai/react.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

<p align="center">React hooks for building frontend apps on Kiln.</p>

---

## What is this?

`@kilnai/react` provides React hooks for connecting to a [Kiln](https://github.com/sequelcore/kiln) gateway. Supports both HTTP (SSE) and WebSocket transports, memory management, event streams, and human-in-the-loop approval flows.

## Install

```bash
bun add @kilnai/react
```

Requires `react >= 19.0.0` and `@kilnai/core` as peer dependencies.

## Quick start

```tsx
import { KilnProvider, useKilnWsChat } from "@kilnai/react";

function App() {
  return (
    <KilnProvider config={{ gatewayUrl: "ws://localhost:3000", appName: "my-agent" }}>
      <Chat />
    </KilnProvider>
  );
}

function Chat() {
  const { messages, send, isConnected } = useKilnWsChat({ userId: "user-1" });

  return (
    <div>
      {messages.map((msg, i) => (
        <div key={i}>{msg.role}: {msg.content}</div>
      ))}
      <button onClick={() => send("Hello!")}>Send</button>
    </div>
  );
}
```

## Hooks

### `useKilnChat`

HTTP-based chat with SSE streaming.

```tsx
const { messages, send, isLoading } = useKilnChat({ userId: "user-1" });
```

### `useKilnWsChat`

WebSocket-based chat with auto-reconnect.

```tsx
const { messages, send, isConnected, connectionStatus } = useKilnWsChat({
  userId: "user-1",
  widgetId: "my-widget", // for multi-tenant
});
```

### `useKilnEvents`

Subscribe to real-time gateway events via SSE.

```tsx
const { events, isConnected } = useKilnEvents();
```

### `useKilnMemory`

Read, write, and search agent memory.

```tsx
const { entries, store, recall, forget } = useKilnMemory({ scope: "user", userId: "user-1" });
```

### `useKilnState`

Access dev-mode gateway state (sessions, costs, events).

```tsx
const { state, refresh } = useKilnState();
```

### `useApproval`

Human-in-the-loop approval gates for sensitive operations.

```tsx
const { pending, approve, reject } = useApproval();
```

## Clients

For non-React usage, the package also exports low-level clients:

```typescript
import { ApiClient, SseClient } from "@kilnai/react";

const api = new ApiClient({ baseUrl: "http://localhost:3000" });
const sse = new SseClient({ url: "http://localhost:3000/dev/events" });
```

## Documentation

- [React SDK Guide](https://github.com/sequelcore/kiln/blob/main/docs/sdk/react-hooks.md)
- [Examples](https://github.com/sequelcore/kiln/tree/main/examples)

## License

[MIT](https://github.com/sequelcore/kiln/blob/main/LICENSE)
