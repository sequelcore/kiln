// Channel adapters -- multi-platform message delivery (Phase 20)

export { EventBridge, toEngineEvent } from "./event-bridge.js";
export { ChannelRegistry } from "./channel-registry.js";
export { formatSdkMessage, formatForChannel } from "./message-formatter.js";
export type { OutputLine } from "./message-formatter.js";
export type { ChannelConfig, ChannelStatus, IdentityMapping, IdentityResolver } from "./types.js";
export { InMemoryIdentityResolver } from "./types.js";
export { CliChannel } from "./cli-channel.js";
export { WebChannel } from "./web-channel.js";
export type { WebSocketLike } from "./web-channel.js";
export { ChannelRouter } from "./channel-router.js";
export type { RouteResult, ChannelRouterRule } from "./channel-router.js";
export { WhatsAppChannel } from "./whatsapp-channel.js";
export type { WhatsAppConfig } from "./whatsapp-channel.js";
export { SlackChannel } from "./slack-channel.js";
export type { SlackConfig } from "./slack-channel.js";
export { ApiChannel } from "./api-channel.js";
export type { SseWriter } from "./api-channel.js";
