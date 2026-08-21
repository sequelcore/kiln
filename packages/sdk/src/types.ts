import type { ContentPart, WorkItem, WorkItemSnapshot } from "@kilnai/core";
import type {
  OperatorManagedAgentCapabilitySnapshot,
  OperatorManagedAgentInvocationEventPayload,
  OperatorTurnRequestedAuthority,
  OperatorSessionEvent,
  GuiCommunicationIntent,
  EffectivePromptObservation,
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnConfigStatusSnapshot,
  KilnEffectiveConfigFieldSnapshot,
  KilnEffectiveConfigSnapshot,
  VerifiedEfficiencyEvidenceProjection,
} from "@kilnai/gateway-contracts";

export interface KilnConfig {
  readonly baseUrl: string;
  readonly appName?: string;
  readonly userId?: string;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly parts?: readonly ContentPart[];
  readonly timestamp: number;
}

export interface ChatOptions {
  readonly appName?: string;
  readonly sessionId?: string;
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly communicationIntent?: GuiCommunicationIntent;
}

export interface ChatSendOptions {
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly communicationIntent?: GuiCommunicationIntent;
}

/** Visitor identity for the identify frame */
export interface VisitorInfo {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly custom?: Readonly<Record<string, string>>;
}

export interface UseChatReturn {
  readonly messages: readonly ChatMessage[];
  send(content: string | ContentPart[], options?: ChatSendOptions): Promise<void>;
  /** Send visitor identity to the gateway (WebSocket only, no-op for REST) */
  identify?(visitor: VisitorInfo): void;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly communicationEvidence: EffectivePromptObservation | null;
  clearMessages(): void;
}

export type InspectableWorkItemResource = WorkItem & {
  readonly resourceUri: string;
  readonly missingEvidence: readonly string[];
};

export type InspectableWorkItemSnapshotResource = Omit<WorkItemSnapshot, "items"> & {
  readonly items: readonly InspectableWorkItemResource[];
};

export type {
  GuiCommunicationIntent,
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnConfigStatusSnapshot,
  KilnEffectiveConfigFieldSnapshot,
  KilnEffectiveConfigSnapshot,
  OperatorManagedAgentCapabilitySnapshot,
  OperatorManagedAgentInvocationEventPayload,
  OperatorTurnRequestedAuthority,
  OperatorSessionEvent,
  EffectivePromptObservation,
  VerifiedEfficiencyEvidenceProjection,
};

/** WebSocket chat request frame (client -> server) */
export interface WsChatRequest {
  readonly type: "message";
  readonly content: string;
  readonly parts?: readonly ContentPart[];
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly communicationIntent?: GuiCommunicationIntent;
}

/** WebSocket chat response frame (server -> client) */
export type WsChatFrame =
  | { readonly type: "chunk"; readonly content: string }
  | {
      readonly type: "done";
      readonly content: string;
      readonly parts?: readonly ContentPart[];
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly effectivePromptObservation?: EffectivePromptObservation;
    }
  | { readonly type: "error"; readonly message: string };
