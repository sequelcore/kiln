// Conversation events emitted by the gateway to product backends
// Fire-and-forget: same pattern as UsageReport in mode-b-config.ts

export type ConversationEventType =
  | "MESSAGE_RECEIVED"
  | "MESSAGE_SENT"
  | "SESSION_STARTED"
  | "SESSION_EXPIRED";

export interface ConversationEvent {
  readonly eventType: ConversationEventType;
  readonly tenantId: string;
  readonly channel: string;
  readonly externalUserId: string;
  readonly displayName?: string;
  readonly messageContent?: string;
  readonly messageRole?: string;
  readonly timestamp: string;
}

export interface ConversationEventBatch {
  readonly events: readonly ConversationEvent[];
}
