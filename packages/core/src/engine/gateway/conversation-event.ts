// Conversation events emitted by the gateway to product backends
// Fire-and-forget: same pattern as UsageReport in mode-b-config.ts

export type ConversationEventType =
  | "MESSAGE_RECEIVED"
  | "MESSAGE_SENT"
  | "SESSION_STARTED"
  | "SESSION_EXPIRED"
  | "DELIVERY_STATUS";

export interface ConversationEvent {
  readonly eventType: ConversationEventType;
  readonly tenantId: string;
  readonly channel: string;
  readonly externalUserId: string;
  readonly displayName?: string;
  readonly messageContent?: string;
  readonly messageRole?: string;
  readonly timestamp: string;
  /** WhatsApp message ID (wamid) -- present for DELIVERY_STATUS events */
  readonly whatsappMessageId?: string;
  /** Delivery status -- present for DELIVERY_STATUS events */
  readonly deliveryStatus?: "sent" | "delivered" | "read" | "failed";
  /** Meta error code -- present for failed DELIVERY_STATUS events */
  readonly errorCode?: number;
}

export interface ConversationEventBatch {
  readonly events: readonly ConversationEvent[];
}
