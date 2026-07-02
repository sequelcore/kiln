import type {
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
} from "@kilnai/gateway-contracts";

const SETUP_ACTION_LABELS: Record<KilnConfigSetupAction, string> = {
  none: "none",
  "adopt-project-context": "adopt project context",
  "review-project-context": "review project context",
  "sync-repo-shims": "sync repo shims",
  "sync-native-projections": "sync native projections",
  "review-and-force-sync-repo-shims": "review shim drift",
  "adopt-or-back-up-native-guidance": "adopt native guidance",
  "review-native-projection-drift": "review native drift",
};

export function formatSetupSnapshot(snapshot: KilnConfigSetupSnapshot): string {
  const actions = snapshot.recommendedActions.length > 0
    ? snapshot.recommendedActions.map((action) => SETUP_ACTION_LABELS[action]).join(", ")
    : SETUP_ACTION_LABELS.none;
  const repoShims = snapshot.repoShims.length > 0
    ? snapshot.repoShims.map((shim) => `  - ${shim.target}: ${shim.status}`).join("\n")
    : "  - none";
  const nativeProjections = snapshot.nativeProjections.length > 0
    ? snapshot.nativeProjections.map((projection) => `  - ${projection.targetId}: ${projection.status}`).join("\n")
    : "  - none";
  const permissionIntegrity = snapshot.permissionIntegrity.length > 0
    ? snapshot.permissionIntegrity.map((integrity) => [
      `  - ${integrity.harness}: ${integrity.classification}`,
      `    desired=${integrity.desired.profile} persisted=${integrity.persistedNative?.profile ?? "-"} effective=${integrity.effectiveRuntime?.profile ?? "unproven"}`,
      `    enforcement=${integrity.enforcement.strength} approval required=${integrity.remediationRequiresApproval ? "yes" : "no"}`,
      `    action=${integrity.recommendation}`,
    ].join("\n")).join("\n")
    : "  - none";
  return [
    `project: ${snapshot.projectRoot}`,
    `project context: ${snapshot.projectContext.status}`,
    `actions: ${actions}`,
    "repo shims:",
    repoShims,
    "native projections:",
    nativeProjections,
    "permission integrity:",
    permissionIntegrity,
  ].join("\n");
}
