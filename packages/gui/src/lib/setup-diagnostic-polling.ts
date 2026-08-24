import type { KilnConfigSetupSnapshot } from "@kilnai/gateway-contracts";

const SETUP_DIAGNOSTIC_POLL_INTERVAL_MS = 750;

/** Poll only while the bounded background diagnostic owner is unsettled. */
export function setupDiagnosticRefetchInterval(
  snapshot: Pick<KilnConfigSetupSnapshot, "skillDiagnostics"> | undefined,
): number | false {
  const state = snapshot?.skillDiagnostics.state;
  return state === "pending" || state === "stale"
    ? SETUP_DIAGNOSTIC_POLL_INTERVAL_MS
    : false;
}
