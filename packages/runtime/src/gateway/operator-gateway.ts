import { startTuiGateway, type OnProviderSwitch, type TuiGateway, type TuiGatewayOptions } from "./tui-gateway.js";

export interface OperatorGateway extends TuiGateway {}

export interface OperatorGatewayOptions extends TuiGatewayOptions {}

export type { OnProviderSwitch };

export type OnResumeSession = (sessionId: string, provider?: string) => void | Promise<void>;

type BaseOperatorSessionTransportOptions = Pick<
  TuiGatewayOptions,
  "sessionManager" | "systemPrompt" | "onClear" | "onProviderSwitch" | "contextArtifactCache" | "eventBus" | "executionMode"
>;

export interface OperatorSessionTransportOptions extends BaseOperatorSessionTransportOptions {
  readonly onResumeSession?: OnResumeSession;
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
