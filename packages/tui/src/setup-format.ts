import type {
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnSkillCatalogSummarySnapshot,
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
  const mcp = snapshot.mcp?.servers.length
    ? snapshot.mcp.servers.map((server) => [
      `  - ${server.id}: source=${server.source} transport=${server.transport} enabled=${server.enabled ? "yes" : "no"} admission=${server.admission} trust=${server.trust}`,
      `    health=${server.health.state} discovery=${server.discovery.state} tools=${server.discovery.tools} resources=${server.discovery.resources} prompts=${server.discovery.prompts} admitted=${server.discovery.admitted}`,
      `    projection=${server.projection.state} compatibility=${server.projectionCompatibility.map((entry) => `${entry.harness}:${entry.status}`).join(",")}`,
    ].join("\n")).join("\n")
    : "  - none";
  const mcpDiagnostics = snapshot.mcp?.diagnostics.length
    ? snapshot.mcp.diagnostics.map((diagnostic) => `  - ${diagnostic.serverId}: ${diagnostic.code}: ${diagnostic.message}`).join("\n")
    : "  - none";
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
    "mcp servers:",
    mcp,
    "mcp diagnostics:",
    mcpDiagnostics,
  ].join("\n");
}

function formatSkillCatalog(skills: KilnSkillCatalogSummarySnapshot | undefined): string {
  if (skills === undefined) {
    return "  - unavailable";
  }
  return [
    `  - inventory=${skills.complete ? "complete" : "incomplete"}`,
    `    duplicates=${skills.equivalentDuplicates} collisions=divergent:${skills.divergentCollisions},case:${skills.caseCollisions}`,
    ...(skills.externalExposure ?? []).filter((entry) => entry.status !== "not-configured").map((entry) =>
      `    external ${entry.harness}=${entry.status} implicit:${entry.realizedImplicit} suppressed:${entry.suppressed} freshness:${entry.freshness}`),
    ...[...skills.harnesses]
      .sort((left, right) => left.harness.localeCompare(right.harness))
      .map((harness) => `    harness=${harness.harness} implicit=${harness.candidateCount} description-bytes=${harness.descriptionBytes} budget=${harness.budget.status}`),
    ...skills.issues.map((issue) => `    issue skill=${issue.skillName} harness=${issue.harness} kind=${issue.kind} status=${issue.projectionState} path=${issue.path}`),
    ...(skills.omittedIssueCount > 0 ? [`    issues omitted=${skills.omittedIssueCount} total=${skills.issueCount}`] : []),
  ].join("\n");
}
