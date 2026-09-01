import type {
  ContextUsageProjection,
  ProviderRequestEvidence,
  ProviderRequestObservation,
} from "@kilnai/core";
import { projectProviderRequestObservation } from "@kilnai/runtime";

/** Projects Runtime request evidence into one content-free row per physical attempt. */
export function projectProviderRequestObservations(input: {
  readonly requests: readonly ProviderRequestEvidence[];
  readonly routeId?: string;
  readonly contextUsage?: ContextUsageProjection;
}): readonly ProviderRequestObservation[] {
  return input.requests.flatMap((request) => {
    const attempts = request.physicalAttempts?.length ? request.physicalAttempts : [undefined];
    return attempts.map((attempt, attemptIndex) => projectProviderRequestObservation(
      request,
      input.routeId,
      input.contextUsage,
      attempt,
      request.providerResponseObserved !== false
        && (attempt === undefined || attemptIndex === attempts.length - 1),
    ));
  });
}
