import {
  resolveCommunicationIntent,
  type CommunicationIntent,
  type CommunicationIntentCandidate,
  type ResolvedCommunicationIntent,
} from "@kilnai/core";

/**
 * Combines persisted candidates with the current operator request at the
 * Runtime boundary. Surfaces transport intent but never recompute precedence.
 */
export function resolveOperatorCommunicationIntent(
  configured: readonly CommunicationIntentCandidate[] | undefined,
  user: CommunicationIntent | undefined,
): ResolvedCommunicationIntent | undefined {
  const candidates = [
    ...(configured ?? []),
    ...(user ? [{ source: "user" as const, intent: user }] : []),
  ];
  return candidates.length > 0 ? resolveCommunicationIntent(candidates) : undefined;
}
