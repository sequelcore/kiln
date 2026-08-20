import { defineExecutionCatalog } from "@kilnai/core";
import { fingerprintOperatorTurnIntent } from "@kilnai/runtime";
import { isDirectApiProvider, type ProviderId } from "../wrapper/session-registry.js";
import { createOperatorTurnDispatchComposition } from "./operator-turn-dispatch-composition.js";
import { runSession } from "./run-session.js";
import type {
  RunSessionOptions,
  RunSessionResult,
  RunSessionRouteCandidate,
} from "./run-session.js";

type CanonicalRunSessionPayload = Omit<RunSessionOptions, "routeCandidates">;

export interface CanonicalRunSessionDispatcher {
  readonly dispatch: (payload: CanonicalRunSessionPayload) => Promise<RunSessionResult>;
  readonly close: () => void;
}

/**
 * Dispatches one direct-provider session through canonical route/account
 * admission and binds the post-fence credential to the provider adapter.
 */
export function createCanonicalRunSessionDispatcher(input: {
  readonly catalog: ReturnType<typeof defineExecutionCatalog>;
  readonly cwd: string;
  readonly authorityStateRoot?: string;
  readonly executionId: string;
  readonly routeId: string;
  readonly accountOverrideId?: string;
  readonly routeEvidence?: Pick<RunSessionRouteCandidate, "deliberationResolution">;
}): CanonicalRunSessionDispatcher {
  const composition = createOperatorTurnDispatchComposition<CanonicalRunSessionPayload, RunSessionResult>({
    catalog: input.catalog,
    cwd: input.authorityStateRoot ?? input.cwd,
  });
  composition.bridge.bind(async ({ admission, binding, credential, payload }) => {
    const provider = admission.providerId as ProviderId;
    if (!isDirectApiProvider(provider)) {
      throw new Error(`Execution target '${admission.routeId}' resolved to an unsupported direct provider.`);
    }
    return runSession({
      ...payload,
      routeCandidates: [{
        provider,
        model: admission.providerModelId,
        credentialBinding: {
          routeId: binding.routeId,
          accountId: binding.accountId,
          credentialId: binding.credentialId,
          credentialRevision: binding.credentialRevision,
        },
        executionCredential: credential,
        ...(input.routeEvidence ?? {}),
      }],
    });
  });

  return {
    dispatch: (payload) => {
      const intent = {
        routeId: input.routeId,
        ...(input.accountOverrideId ? { accountOverrideId: input.accountOverrideId } : {}),
      };
      return composition.dispatcher.dispatchTurn({
        executionId: input.executionId,
        intentFingerprint: fingerprintOperatorTurnIntent({ executionId: input.executionId, intent }),
        intent,
        payload,
      }).then(({ result }) => result);
    },
    close: composition.close,
  };
}
