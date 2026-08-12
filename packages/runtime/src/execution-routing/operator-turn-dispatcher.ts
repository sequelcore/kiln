import { createHash } from "node:crypto";
import type { ContentPart, OperatorExecutionIntent } from "@kilnai/core";
import type {
  GuiOutboundFrame,
  GuiProviderDiscoveryResult,
} from "@kilnai/gateway-contracts";
import type { ProcessResult } from "../gateway/message-pipeline/index.js";
import type {
  OperatorSessionCommittedExecution,
  OperatorSessionExecutionDispatch,
  OperatorSessionExecutionResult,
  OperatorSessionExecutionRoutingService,
} from "./operator-session-execution-routing-service.js";

/**
 * The committed part of an operator turn. Adapter construction and the
 * existing orchestrator/session pipeline belong here and are unreachable
 * until the routing service has fenced shared capacity and re-resolved the
 * credential identity.
 */
export interface OperatorTurnDispatchRequest<Payload> {
  readonly executionId: string;
  readonly intentFingerprint: string;
  readonly intent: OperatorExecutionIntent;
  /** Opaque turn context consumed only by the composition-owned callback. */
  readonly payload: Payload;
}

export interface OperatorTurnGuiDispatchPayload {
  readonly surface: "gui";
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly userParts: readonly ContentPart[];
  readonly sessionId?: string;
  readonly systemPrompt: string;
  readonly message: Extract<GuiOutboundFrame, { type: "message" }>;
  readonly providerDiscovery: readonly GuiProviderDiscoveryResult[];
  readonly freshSessionRequested: boolean;
  readonly abortSignal?: AbortSignal;
  readonly operatorTimeZone?: string;
}

export interface OperatorTurnTuiDispatchPayload {
  readonly surface: "tui";
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly userParts: readonly ContentPart[];
  readonly systemPrompt: string;
  readonly message: Extract<GuiOutboundFrame, { type: "message" }>;
  readonly providerDiscovery: readonly GuiProviderDiscoveryResult[];
  readonly operatorTimeZone?: string;
}

export type OperatorTurnDispatchPayload =
  | OperatorTurnGuiDispatchPayload
  | OperatorTurnTuiDispatchPayload;

export type OperatorTurnDispatchResult = ProcessResult;

/**
 * Composition-owned hand-off to the gateway's local session/orchestrator.
 * Binding is one-shot so a second surface cannot replace the executor after
 * the dispatcher has been composed.
 */
export class OperatorSessionExecutionBridge<Credential, Payload, Result>
  implements OperatorSessionExecutionDispatch<Credential, Payload, Result> {
  #handler: ((input: OperatorSessionCommittedExecution<Credential, Payload>) => Promise<Result>) | undefined;

  bind(
    handler: (input: OperatorSessionCommittedExecution<Credential, Payload>) => Promise<Result>,
  ): void {
    if (this.#handler) {
      throw new Error("The operator session execution bridge is already bound.");
    }
    this.#handler = handler;
  }

  dispatchCommittedTurn(
    input: OperatorSessionCommittedExecution<Credential, Payload>,
  ): Promise<Result> {
    if (!this.#handler) {
      throw new Error("The operator session execution bridge is not bound.");
    }
    return this.#handler(input);
  }
}

/** Surface-facing port; it hides credential and adapter types from GUI/TUI. */
export interface OperatorTurnDispatchPort<Payload, Result> {
  dispatchTurn(request: OperatorTurnDispatchRequest<Payload>): Promise<OperatorSessionExecutionResult<Result>>;
}

/**
 * Sole per-turn runtime facade for operator execution routing.
 *
 * Route picker admission is UX evidence. This facade is the execution
 * authority: every GUI/TUI turn must pass through the same composition-owned
 * service and can only provide turn context as data.
 */
export class OperatorTurnDispatcher<Payload = unknown, Result = unknown, Credential = unknown>
  implements OperatorTurnDispatchPort<Payload, Result> {
  readonly #routing: OperatorSessionExecutionRoutingService<Credential, Payload, Result>;

  constructor(routing: OperatorSessionExecutionRoutingService<Credential, Payload, Result>) {
    this.#routing = routing;
  }

  dispatchTurn(request: OperatorTurnDispatchRequest<Payload>): Promise<OperatorSessionExecutionResult<Result>> {
    return this.#routing.execute(request);
  }
}

/** Stable fingerprint for the authority idempotency key supplied by a surface. */
export function fingerprintOperatorTurnIntent(input: {
  readonly executionId: string;
  readonly intent: OperatorExecutionIntent;
}): `sha256:${string}` {
  const canonical = JSON.stringify({
    executionId: input.executionId,
    routeId: input.intent.routeId,
    ...(input.intent.accountOverrideId ? { accountOverrideId: input.intent.accountOverrideId } : {}),
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}
