import type {
  ApprovalReceivedEvent,
  ApprovalRequestedEvent,
  CanonicalSessionEvent,
  EventBus,
  KilnEvent,
} from "@kilnai/core";
import type { GuiInboundFrame } from "@kilnai/gateway-contracts";
import type { ApprovalGateRegistry } from "./approval-registry.js";
import { toOperatorSessionEventFrame } from "./operator-session-event-frame.js";

interface OperatorActivitySocket {
  send(data: string): void;
}

export interface OperatorActivityStreamerOptions {
  readonly approvalRegistry: ApprovalGateRegistry;
  readonly instanceId: string;
  readonly onRuntimeEvent?: (event: KilnEvent, send: (frame: GuiInboundFrame) => void) => void;
}

/**
 * Projects one canonical Runtime activity stream to a replaceable operator
 * socket. Presentation disconnects never own or cancel execution.
 */
export class OperatorActivityStreamer {
  readonly #approvalRegistry: ApprovalGateRegistry;
  readonly #instanceId: string;
  readonly #onRuntimeEvent?: OperatorActivityStreamerOptions["onRuntimeEvent"];
  readonly #pendingApprovals = new Set<string>();
  #socket: OperatorActivitySocket | null = null;
  #eventBus: EventBus | null = null;
  #eventHandler: ((event: KilnEvent) => void) | null = null;
  #lastKnownSessionId: string | undefined;
  #approvalBridge: {
    approve(approvalId: string): void;
    reject(approvalId: string, reason: string): void;
  } | null = null;

  constructor(options: OperatorActivityStreamerOptions) {
    this.#approvalRegistry = options.approvalRegistry;
    this.#instanceId = options.instanceId;
    this.#onRuntimeEvent = options.onRuntimeEvent;
  }

  bindApprovalBridge(bridge: {
    approve(approvalId: string): void;
    reject(approvalId: string, reason: string): void;
  }): void {
    this.#approvalBridge = bridge;
  }

  selectSession(sessionId: string): void {
    this.#lastKnownSessionId = sessionId;
  }

  register(socket: OperatorActivitySocket, eventBus?: EventBus): void {
    this.#detachEventBus();
    this.#socket = socket;
    this.#eventBus = eventBus ?? null;
    if (!this.#eventBus) return;
    this.#eventHandler = (event) => this.#observeRuntimeEvent(event);
    this.#eventBus.onAny(this.#eventHandler);
  }

  unregister(socket: OperatorActivitySocket): void {
    if (this.#socket !== socket) return;
    this.#socket = null;
    this.#detachEventBus();
  }

  forwardSessionEvents(events: readonly CanonicalSessionEvent[]): void {
    for (const event of events) {
      this.sendFrame(
        toOperatorSessionEventFrame(event, {
          eventId: event.eventId,
          sequence: event.sequence,
          instanceId: this.#instanceId,
        }),
      );
    }
  }

  sendFrame(frame: GuiInboundFrame): void {
    this.#socket?.send(JSON.stringify(frame));
  }

  currentSessionId(): string | undefined {
    return this.#lastKnownSessionId;
  }

  #observeRuntimeEvent(event: KilnEvent): void {
    if (event.type === "approval_requested") {
      this.#observeApprovalRequested(event as ApprovalRequestedEvent);
    } else if (event.type === "approval_received") {
      this.#observeApprovalReceived(event as ApprovalReceivedEvent);
    }
    this.#onRuntimeEvent?.(event, (frame) => this.sendFrame(frame));
  }

  #observeApprovalRequested(event: ApprovalRequestedEvent): void {
    const { sessionId, approvalId } = event;
    if (!sessionId || !approvalId) return;
    this.#pendingApprovals.add(approvalId);
    this.#approvalRegistry.register(approvalId, {
      approve: () => this.#approvalBridge?.approve(approvalId),
      reject: (reason) => this.#approvalBridge?.reject(approvalId, reason),
      status: () => (this.#pendingApprovals.has(approvalId) ? "awaiting_approval" : "resolved"),
    });
  }

  #observeApprovalReceived(event: ApprovalReceivedEvent): void {
    const { sessionId, approvalId } = event;
    if (!sessionId || !approvalId) return;
    this.#pendingApprovals.delete(approvalId);
    this.#approvalRegistry.unregister(approvalId);
  }

  #detachEventBus(): void {
    if (this.#eventBus && this.#eventHandler) {
      this.#eventBus.offAny(this.#eventHandler);
    }
    this.#eventBus = null;
    this.#eventHandler = null;
  }
}
