<p align="center">
  <img src="https://raw.githubusercontent.com/sequelcore/kiln/main/docs/assets/mascot.png" alt="Kiln" width="120" />
</p>

<h1 align="center">@kilnai/react</h1>

<p align="center">
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache-2.0" /></a>
</p>

<p align="center">React hooks for building frontend apps on Kiln.</p>

---

## What is this?

> [!IMPORTANT]
> This is a provisional workspace package in a source-only development tree.
> There is no supported package installation for the current repository state.

`@kilnai/react` provides React hooks for connecting to a [Kiln](https://github.com/sequelcore/kiln) gateway. Supports HTTP, WebSocket, event streams, and dev-route approval controls. Memory is consumed through gateway/resource contracts, not SDK-owned memory CRUD hooks.

## Use in this workspace

```bash
bun install --frozen-lockfile
bun run --filter @kilnai/react test
```

Workspace consumers use the local package. It requires `react >= 19.0.0`,
`@kilnai/core`, and `@kilnai/gateway-contracts` as peer dependencies. These
package coordinates are expected to change before the next public release.

## Quick start

```tsx
import { KilnProvider, useKilnWsChat } from "@kilnai/react";

function App() {
  return (
    <KilnProvider config={{ baseUrl: "http://localhost:3000", appName: "my-agent" }}>
      <Chat />
    </KilnProvider>
  );
}

function Chat() {
  const { messages, send, isLoading, error } = useKilnWsChat();

  return (
    <div>
      {messages.map((msg, i) => (
        <div key={i}>{msg.role}: {msg.content}</div>
      ))}
      <button disabled={isLoading} onClick={() => send("Hello!")}>Send</button>
      {error && <div>{error.message}</div>}
    </div>
  );
}
```

## Hooks

### `useKilnChat`

HTTP-based chat through the app message endpoint.

```tsx
const { messages, send, isLoading } = useKilnChat();
```

### `useKilnWsChat`

WebSocket-based chat with a persistent connection while the component is mounted.

```tsx
const { messages, send, identify, isLoading, error } = useKilnWsChat();
```

### `useKilnEvents`

Subscribe to real-time gateway events via SSE.

```tsx
const { events, connected } = useKilnEvents();
```

### `useKilnState`

Access dev-mode gateway state (sessions, costs, events).

```tsx
const { state, refresh } = useKilnState();
```

### `useApproval`

Dev-route approval controls (`/dev/approve`, `/dev/reject`) for tools or playground workflows.
This is an SDK-facing approval surface; it does not make direct API providers
locally executable tool backends.

```tsx
const { approve, reject, isLoading, error } = useApproval();
await approve("approval-123");
await reject("Not safe to run", "approval-123");
```

## Clients

For non-React usage, the package also exports low-level clients:

```typescript
import { ApiClient, SseClient } from "@kilnai/react";

const api = new ApiClient("http://localhost:3000");
const sse = new SseClient("http://localhost:3000/dev/events", {
  onEvent(event) { console.log(event); },
  onConnect() { console.log("connected"); },
  onDisconnect() { console.log("disconnected"); },
});
```

## Documentation

- [React SDK guide](../../docs/guides/gui/react-sdk.md)
- [Examples](../../docs/examples/README.md)

## License

[Apache 2.0](../../LICENSE)
