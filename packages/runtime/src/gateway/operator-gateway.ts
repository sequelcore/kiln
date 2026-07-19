import { startTuiGateway, type OnProviderSwitch, type TuiGateway, type TuiGatewayOptions } from "./tui-gateway.js";
import type { RuntimeSessionHydrator } from "./message-pipeline.js";

export interface OperatorGateway extends TuiGateway {}

export interface OperatorGatewayOptions extends TuiGatewayOptions {}

export type { OnProviderSwitch };

export type OnContinueSession = (sessionId: string, provider?: string) => void | Promise<void>;

type BaseOperatorSessionTransportOptions = Pick<
  TuiGatewayOptions,
  "sessionManager" | "systemPrompt" | "onClear" | "onProviderSwitch" | "contextArtifactCache" | "artifactStore" | "voiceConfig" | "sttAdapter" | "ttsAdapter" | "eventBus" | "executionMode" | "managedInvocation" | "budgetAdmission"
>;

export interface OperatorSessionTransportOptions extends BaseOperatorSessionTransportOptions {
  /** IANA timezone from the operator's validated global identity. */
  readonly operatorTimeZone?: string;
  readonly onContinueSession?: OnContinueSession;
  readonly resumeSessionHydrator?: RuntimeSessionHydrator;
  readonly workingDirectory?: string;
  readonly domainLabel?: string;
}

/**
 * Neutral operator gateway alias retained while the TUI client is still present.
 * The transport stays identical; only the naming moves toward ADR-006.
 */
export async function startOperatorGateway(
  options: OperatorGatewayOptions,
): Promise<OperatorGateway> {
  return startTuiGateway(options);
}
