import { AsyncLocalStorage } from "node:async_hooks";
import type {
  FormalVerificationFinishTransportEnvelope,
} from "@kilnai/core/tools";

interface RuntimeFormalVerificationFinishInvocationState {
  readonly registeredFinishTool: object;
  readonly transport: FormalVerificationFinishTransportEnvelope;
}

const invocationState = new AsyncLocalStorage<RuntimeFormalVerificationFinishInvocationState>();

/**
 * Read the transport for the currently executing Runtime-owned finish call.
 * The state is process-local and scoped to the attached Runtime async flow;
 * callers cannot establish it through the public Runtime API.
 */
export function readRuntimeFormalVerificationFinishTransport():
  | FormalVerificationFinishTransportEnvelope
  | undefined {
  return invocationState.getStore()?.transport;
}

/**
 * Verify that a finish tool and transport are the exact pair entered by the
 * attached Runtime. Structural envelopes and registry membership are not
 * sufficient provenance.
 */
export function isRuntimeOwnedFormalVerificationFinishInvocation(
  registeredFinishTool: object,
  transport: unknown,
): transport is FormalVerificationFinishTransportEnvelope {
  const state = invocationState.getStore();
  return state?.registeredFinishTool === registeredFinishTool
    && state.transport === transport;
}

/**
 * Internal issuer. It is deliberately omitted from the Runtime public
 * barrel; only the attached Runtime gateway can enter invocation state.
 */
export function runRuntimeFormalVerificationFinishInvocation<T>(
  registeredFinishTool: object,
  transport: FormalVerificationFinishTransportEnvelope,
  callback: () => Promise<T>,
): Promise<T> {
  return invocationState.run({ registeredFinishTool, transport }, callback);
}
