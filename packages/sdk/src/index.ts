export { KilnProvider } from "./provider.js";
/** @internal Exposes raw ApiClient -- intended for dev tooling (e.g. Studio), not public consumers. */
export { useKilnContext } from "./provider.js";
export type { KilnProviderProps } from "./provider.js";

export { useApproval } from "./use-approval.js";
export type { UseApprovalReturn } from "./use-approval.js";
export { useKilnChat } from "./use-kiln-chat.js";
export { useKilnWsChat } from "./use-kiln-ws-chat.js";
export { useKilnEvents } from "./use-kiln-events.js";
/** @dev Only works with dev-mode gateway (`/dev/memory` routes). */
export { useKilnMemory } from "./use-kiln-memory.js";
export { useKilnState } from "./use-kiln-state.js";

export { ApiClient } from "./api-client.js";
export { SseClient } from "./sse-client.js";
export type { SseCallbacks } from "./sse-client.js";

export type {
  KilnConfig,
  ChatMessage,
  ChatOptions,
  UseChatReturn,
  UseEventsReturn,
  UseMemoryReturn,
  UseStateReturn,
  MemoryEntry,
  CreateMemoryInput,
  KilnEventData,
  WsChatRequest,
  WsChatFrame,
} from "./types.js";
