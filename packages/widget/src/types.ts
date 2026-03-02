/** Widget configuration, typically read from script tag data attributes */
export interface WidgetConfig {
  readonly gatewayUrl: string;
  readonly appName: string;
  readonly widgetId: string;
  readonly position?: "bottom-right" | "bottom-left";
  readonly theme?: "light" | "dark" | "auto";
  readonly greeting?: string;
  readonly placeholder?: string;
}

/** Outbound frame: client -> server */
export interface WsOutboundFrame {
  readonly type: "message";
  readonly content: string;
}

/** Inbound frame: server -> client */
export type WsInboundFrame =
  | { readonly type: "done"; readonly content: string; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly type: "error"; readonly message: string };

/** Chat message for UI rendering */
export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
