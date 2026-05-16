/** Widget configuration, typically read from script tag data attributes */
export interface WidgetConfig {
  readonly gatewayUrl: string;
  readonly appName: string;
  readonly widgetId: string;
  readonly position?: "bottom-right" | "bottom-left";
  readonly theme?: "light" | "dark" | "auto";
  readonly greeting?: string;
  readonly placeholder?: string;
  /** Optional tenant/product logo shown in the panel header. */
  readonly logoUrl?: string;
  /** Optional accessible label for logoUrl. Defaults to appName. */
  readonly logoAlt?: string;
}

/** Visitor identity submitted via the identify frame */
export interface VisitorInfo {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly custom?: Readonly<Record<string, string>>;
}

/** Pre-chat form field descriptor received from the gateway */
export interface PreChatFieldConfig {
  readonly key: string;
  readonly label: string;
  readonly type: "text" | "email" | "phone";
  readonly required: boolean;
}

/** Pre-chat form config received via welcome frame */
export interface PreChatFormFrame {
  readonly enabled: boolean;
  readonly fields: readonly PreChatFieldConfig[];
  readonly submitLabel?: string;
}

/** Outbound frame: client -> server */
export type WsOutboundFrame =
  | { readonly type: "message"; readonly content: string; readonly parts?: readonly unknown[] }
  | { readonly type: "identify"; readonly visitor: VisitorInfo };

/** Inbound frame: server -> client */
export type WsInboundFrame =
  | { readonly type: "done"; readonly content: string; readonly parts?: readonly unknown[]; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly type: "error"; readonly message: string; readonly code?: string }
  | { readonly type: "welcome"; readonly greeting?: string; readonly suggestions?: readonly string[]; readonly preChatForm?: PreChatFormFrame }
  | { readonly type: "suggestions"; readonly items: readonly string[] };

/** Chat message for UI rendering */
export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly parts?: readonly unknown[];
  readonly timestamp: number;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
