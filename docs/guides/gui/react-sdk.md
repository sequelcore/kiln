# React SDK (@kilnai/react)

`@kilnai/react` provides typed HTTP and WebSocket chat hooks over Kiln's public
App Gateway contracts. Memory and operator telemetry remain owned by canonical
gateway and resource contracts; the SDK does not create private development
routes or surface-specific runtime state.

> [!IMPORTANT]
> The SDK is currently supported only as a workspace package in this source
> tree. Its package coordinate is provisional and expected to change before the
> next public release.

The SDK imports only types from `@kilnai/core`, never implementations or
runtime code. Peer dependencies are React 19+, `@kilnai/core`, and
`@kilnai/gateway-contracts`.

## Workspace use

```bash
bun install --frozen-lockfile
bun run --filter @kilnai/react test
```

Repository applications consume the package through `workspace:*`.

## KilnProvider

`KilnProvider` establishes the Kiln context for all hooks. Wrap the application
subtree that needs gateway access.

```typescript
interface KilnConfig {
  readonly baseUrl: string;
  readonly appName?: string;
  readonly userId?: string;
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
    <KilnProvider
      config={{
        baseUrl: "http://localhost:4800",
        appName: "my-app",
        userId: "user-123",
      }}
    >
      <Chat />
    </KilnProvider>
  );
}
```

`KilnProvider` creates one `ApiClient` for each `baseUrl`. The client is
memoized and recreated when `baseUrl`, `appName`, or `userId` changes. Calling
any hook outside a provider throws an explicit context error.

## useKilnContext

`useKilnContext` exposes the raw `ApiClient` and `KilnConfig` for advanced
integrations over documented gateway contracts.

```typescript
function useKilnContext(): {
  readonly config: KilnConfig;
  readonly client: ApiClient;
}
```

## useKilnChat

`useKilnChat` manages an HTTP chat session through
`POST /apps/{appName}/message` and keeps local message history.

```typescript
function useKilnChat(options?: ChatOptions): UseChatReturn

interface ChatOptions {
  readonly appName?: string;
  readonly sessionId?: string;
}

interface UseChatReturn {
  readonly messages: readonly ChatMessage[];
  send(content: string | ContentPart[]): Promise<void>;
  readonly isLoading: boolean;
  readonly error: Error | null;
  clearMessages(): void;
}
```

```tsx
import { useKilnChat } from "@kilnai/react";

function Chat() {
  const { messages, send, isLoading, error } = useKilnChat();

  return (
    <div>
      {messages.map((message) => (
        <p key={message.id}>{message.role}: {message.content}</p>
      ))}
      <button disabled={isLoading} onClick={() => send("Hello")}>Send</button>
      {error && <p>{error.message}</p>}
    </div>
  );
}
```

`send` accepts a plain string or a `ContentPart[]` value for multimodal input.
`clearMessages()` resets local history and clears the current error.

## useKilnWsChat

`useKilnWsChat` is the real-time alternative. It opens
`/apps/{appName}/ws`, sends typed request frames, and returns the same
`UseChatReturn` interface as the HTTP hook.

```tsx
import { useKilnWsChat } from "@kilnai/react";

function Chat() {
  const { messages, send, isLoading, error, clearMessages } = useKilnWsChat();
  // Render the same UI as useKilnChat.
}
```

The hook connects on mount and disconnects on unmount. `config.userId` is
encoded in the connection URL; if it is absent, the hook creates a stable UUID
for the component lifetime. Use this hook for embedded real-time interfaces
where low latency matters, and `useKilnChat` when HTTP is preferable.

## ApiClient

The low-level `ApiClient` is a fetch wrapper initialized with a `baseUrl`. It
provides `get<T>(path)`, `post<T>(path, body)`, and `delete<T>(path)`, parses
JSON responses, and throws on non-success status codes.

```typescript
import { ApiClient } from "@kilnai/react";

const client = new ApiClient("http://localhost:4800");
const health = await client.get<{ status: string }>("/health");
```

Access it directly only when the hooks do not cover a documented gateway use
case.
