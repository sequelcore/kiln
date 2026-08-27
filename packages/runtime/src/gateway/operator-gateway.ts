import { startTuiGateway, type TuiGateway, type TuiGatewayOptions } from "./tui-gateway.js";
import type { RuntimeSessionHydrator } from "./message-pipeline/index.js";
import type {
  OperatorSessionExecutionBridge,
  OperatorSessionAuthorityAdmissionBridge,
  OperatorTurnDispatchPort,
  OperatorTurnDispatchResult,
  OperatorTurnGuiDispatchPayload,
  OperatorTurnTuiDispatchPayload,
} from "../execution-routing/operator-turn-dispatcher.js";
import type { AuthorityAdmissionEvidenceStore } from "../session/authority-admission-evidence.js";
import type { RuntimeModelRoundActionClaimStore } from "../execution-kernel/runtime-model-round-action-claim.js";
import type { RuntimeToolActionClaimStore } from "../execution-kernel/runtime-tool-action-claim.js";
import type { ConfiguredExecutionCredential } from "../managed-account-leases/configured-execution-account-runtime.js";

export interface OperatorGateway extends TuiGateway {}

export interface OperatorGatewayOptions extends TuiGatewayOptions {}

export type OnContinueSession = (sessionId: string, routeId?: string) => void | Promise<void>;

type BaseOperatorSessionTransportOptions<Payload> = Omit<Pick<
  TuiGatewayOptions,
  "sessionManager" | "createProvider" | "systemPrompt" | "onClear" | "executionTargetSelection" | "operatorTurnDispatcher" | "operatorTurnExecutionBridge" | "contextArtifactCache" | "artifactStore" | "voiceConfig" | "sttAdapter" | "ttsAdapter" | "eventBus" | "executionMode" | "managedInvocation" | "sessionTurnBudget" | "persistCanonicalSessionEvents"
>, "operatorTurnDispatcher" | "operatorTurnExecutionBridge"> & {
  readonly operatorTurnDispatcher: OperatorTurnDispatchPort<Payload, OperatorTurnDispatchResult>;
  readonly operatorTurnExecutionBridge: OperatorSessionExecutionBridge<ConfiguredExecutionCredential, Payload, OperatorTurnDispatchResult>;
  readonly operatorAuthorityAdmissionBridge: OperatorSessionAuthorityAdmissionBridge<Payload>;
  readonly authorityAdmissionEvidenceStore: AuthorityAdmissionEvidenceStore;
  readonly runtimeModelRoundActionClaims: RuntimeModelRoundActionClaimStore;
  readonly runtimeToolActionClaims: RuntimeToolActionClaimStore;
  readonly runtimeMediaActionClaims: import("../execution-kernel/runtime-media-action-claim.js").RuntimeMediaActionClaimContext;
};

export type OperatorSessionTransportOptions<Payload = OperatorTurnTuiDispatchPayload> = BaseOperatorSessionTransportOptions<Payload> & {
  /** IANA timezone from the operator's validated global identity. */
  readonly operatorTimeZone?: string;
  readonly onContinueSession?: OnContinueSession;
  readonly resumeSessionHydrator?: RuntimeSessionHydrator;
  readonly workingDirectory?: string;
  readonly domainLabel?: string;
};

export type OperatorGuiSessionTransportOptions = OperatorSessionTransportOptions<OperatorTurnGuiDispatchPayload>;

/**
 * Neutral operator gateway alias retained while the TUI client is still present.
 * The transport stays identical; only the naming moves toward ADR-006.
 */
export async function startOperatorGateway(
  options: OperatorGatewayOptions,
): Promise<OperatorGateway> {
  return startTuiGateway(options);
}
