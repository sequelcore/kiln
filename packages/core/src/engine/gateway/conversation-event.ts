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
  | "HANDOFF_MESSAGE_QUEUED"
  | "TOOL_CALLED"
  | "TOOL_EXECUTED"
  | "AGENT_ROUTED"
  | "AGENT_HANDOFF";

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
  /** Tool name -- present for TOOL_CALLED and TOOL_EXECUTED events */
  readonly toolName?: string;
  /** Tool input (truncated) -- present for TOOL_CALLED events */
  readonly toolInput?: Record<string, unknown>;
  /** Duration in ms -- present for TOOL_EXECUTED events */
  readonly durationMs?: number;
  /** Whether tool execution succeeded -- present for TOOL_EXECUTED events */
  readonly success?: boolean;
  /** Brief result summary (truncated to 200 chars) -- present for TOOL_EXECUTED events */
  readonly resultSummary?: string;
  /** Active agent ID -- present for AGENT_ROUTED events */
  readonly activeAgentId?: string;
  /** Active agent name -- present for AGENT_ROUTED events */
  readonly activeAgentName?: string;
  /** Previous agent ID -- present for AGENT_HANDOFF events */
  readonly fromAgentId?: string;
  /** Previous agent name -- present for AGENT_HANDOFF events */
  readonly fromAgentName?: string;
  /** New agent ID -- present for AGENT_HANDOFF events */
  readonly toAgentId?: string;
  /** New agent name -- present for AGENT_HANDOFF events */
  readonly toAgentName?: string;
  /** Handoff context brief -- present for AGENT_HANDOFF events */
  readonly handoffBrief?: string;
  /** Whether handoff was blocked by ping-pong guard -- present for AGENT_HANDOFF events */
  readonly handoffBlocked?: boolean;
  /** Reason for ping-pong block -- present for AGENT_HANDOFF events */
  readonly handoffBlockReason?: string;
  /** Routing tier used -- present for AGENT_ROUTED events */
  readonly routingTier?: "rule" | "embedding" | "fallback";
  /** Routing confidence score -- present for AGENT_ROUTED events with embedding tier */
  readonly routingConfidence?: number;
}

export interface ConversationEventBatch {
  readonly events: readonly ConversationEvent[];
}
