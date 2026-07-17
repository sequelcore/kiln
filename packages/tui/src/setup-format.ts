import type {
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnSkillCatalogSnapshot,
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
  "sync-global-instruction-shims": "sync global instruction shims",
  "adopt-or-back-up-global-instructions": "adopt or back up global instructions",
  "review-global-instruction-drift": "review global instruction drift",
};

export function formatSetupSnapshot(snapshot: KilnConfigSetupSnapshot): string {
  const actions = snapshot.recommendedActions.length > 0
    ? snapshot.recommendedActions.map((action) => SETUP_ACTION_LABELS[action]).join(", ")
    : SETUP_ACTION_LABELS.none;
  const repoShims = snapshot.repoShims.length > 0
    ? snapshot.repoShims.map((shim) => `  - ${shim.target}: ${shim.status}`).join("\n")
    : "  - none";
  const globalInstructionShims = snapshot.globalInstructionShims.length > 0
    ? snapshot.globalInstructionShims.map((shim) => [
      `  - ${shim.targetId}: harness=${shim.harness} status=${shim.status} recommendation=${SETUP_ACTION_LABELS[shim.recommendation]}`,
      `    target=${shim.path}`,
    ].join("\n")).join("\n")
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
  const skills = formatSkillCatalog(snapshot.skills);
  return [
    `project: ${snapshot.projectRoot}`,
    `project context: ${snapshot.projectContext.status}`,
    `actions: ${actions}`,
    "repo shims:",
    repoShims,
    "global instruction shims:",
    globalInstructionShims,
    "native projections:",
    nativeProjections,
    "permission integrity:",
    permissionIntegrity,
    "skills:",
    skills,
  ].join("\n");
}

function formatSkillCatalog(skills: KilnSkillCatalogSnapshot | undefined): string {
  if (skills === undefined) {
    return "  - unavailable";
  }
  if (skills.entries.length === 0) {
    return "  - none configured or reported";
  }
  return [...skills.entries]
    .sort((left, right) => left.name.localeCompare(right.name) || left.origin.localeCompare(right.origin))
    .map((skill) => [
      `  - ${skill.name}: origin=${skill.origin} identity=${skill.builtIn ? "built-in" : skill.configured ? "configured" : "unconfigured"} admission=${skill.admission.state}`,
      `    admission reason=${skill.admission.reason}`,
      ...(skill.omissionReason ? [`    omission reason=${skill.omissionReason}`] : []),
      ...[...skill.projections]
        .sort((left, right) => left.target.localeCompare(right.target))
        .map((projection) => `    target=${projection.target} status=${projection.status} path=${projection.path}`),
    ].join("\n"))
    .join("\n");
}
