// Conversation events emitted by the gateway to product backends
// Fire-and-forget: same pattern as UsageReport in mode-b-config.ts

export type ConversationEventType =
  | "MESSAGE_RECEIVED"
  | "MESSAGE_SENT"
  | "SESSION_STARTED"
  | "SESSION_EXPIRED"
  | "DELIVERY_STATUS"
  | "ESCALATION_DETECTED"
  | "HANDOFF_INITIATED"
  | "HANDOFF_RELEASED"
  | "OPERATOR_MESSAGE_SENT"
  | "HANDOFF_MESSAGE_QUEUED";

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
  /** Current session mode -- present for handoff-related events */
  readonly sessionMode?: "ai_active" | "queued" | "human_active" | "resolved";
  /** Reason for escalation -- present for ESCALATION_DETECTED events */
  readonly escalationReason?: string;
  /** Additional detail about escalation -- present for ESCALATION_DETECTED events */
  readonly escalationDetail?: string;
  /** Conversation summary -- present for HANDOFF_INITIATED events */
  readonly summary?: string;
  /** Operator identifier -- present for OPERATOR_MESSAGE_SENT events */
  readonly operatorId?: string;
  /** Trace identifier for correlating handoff events */
  readonly traceId?: string;
}

export interface ConversationEventBatch {
  readonly events: readonly ConversationEvent[];
}
