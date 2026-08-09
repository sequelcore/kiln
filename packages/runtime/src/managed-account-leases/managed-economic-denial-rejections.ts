import type { SessionManagedEconomicRejection } from "@kilnai/core";
import type {
  ManagedEconomicAuthorityDecisionEvidence,
  ManagedEconomicCommitmentAcquireResult,
} from "./managed-account-lease-authority.js";

/** Projects authority denial facts without account or credential data. */
export function projectManagedEconomicDenialRejections(
  result: Exclude<ManagedEconomicCommitmentAcquireResult, { readonly status: "committed" }>,
): readonly SessionManagedEconomicRejection[] {
  if (result.status === "conflict") return [{ stage: "commitment-conflict", reason: result.reason }];
  const economicSelection = result.decision.rejected.map((rejection): SessionManagedEconomicRejection => ({
    stage: "economic-selection", routeId: rejection.alternativeIdentity.route.routeId, reason: rejection.reason,
  }));
  return [...economicSelection, ...projectAuthorityRejections(result.evidence)];
}

function projectAuthorityRejections(evidence: ManagedEconomicAuthorityDecisionEvidence): readonly SessionManagedEconomicRejection[] {
  const localCapacity: SessionManagedEconomicRejection[] = [];
  const accounts = new Map<string, {
    readonly routeId: string;
    readonly reason: Extract<SessionManagedEconomicRejection, { readonly stage: "account-selection" }>["reason"];
    count: number;
  }>();
  for (const rejection of evidence.authorityRejections) {
    if (rejection.stage === "local-capacity") {
      localCapacity.push({ stage: "local-capacity", routeId: rejection.routeId, reason: rejection.reason });
      continue;
    }
    for (const account of rejection.rejections) {
      const key = `${rejection.routeId}\u0000${account.reason}`;
      const existing = accounts.get(key);
      if (existing) existing.count += 1;
      else accounts.set(key, { routeId: rejection.routeId, reason: account.reason, count: 1 });
    }
  }
  return [
    ...[...accounts.values()].map((rejection) => ({ stage: "account-selection" as const, ...rejection })),
    ...localCapacity,
  ];
}
