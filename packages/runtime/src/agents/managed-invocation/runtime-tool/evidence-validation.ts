// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// Pure predicates: substantive-evidence check, required-tools/capabilities/read-paths
// admission against a route profile.
import type { ManagedAgentInvocationRecord } from "@kilnai/core";
import { posix } from "node:path";
import { RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON } from "../../../session/runtime-session-orchestrator.types.js";
import type { ManagedInvocationRouteProfile } from "./types.js";
import { unique } from "./catalog-descriptions.js";

export function hasSubstantiveManagedInvocationEvidence(record: ManagedAgentInvocationRecord): boolean {
  if (record.lifecycleState !== "completed") {
    return false;
  }
  const summary = record.resultHandoff?.summary.trim();
  if (!summary || isNonSubstantiveManagedInvocationSummary(summary)) {
    return false;
  }
  return (record.resultHandoff?.resourceUris.length ?? 0) > 0;
}

function isNonSubstantiveManagedInvocationSummary(summary: string): boolean {
  return summary === "Direct provider managed invocation completed."
    || summary.startsWith("Direct provider managed invocation finished without final handoff text.")
    || summary.includes(RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON)
    || summary.startsWith("Managed invocation state transition is still pending after the tool-round budget was exhausted.");
}

export function missingManagedInvocationRequiredTools(
  requiredToolNames: readonly string[],
  allowedToolNames: readonly string[],
): readonly string[] {
  const allowed = new Set(allowedToolNames);
  return unique(requiredToolNames).filter((toolName) => !allowed.has(toolName));
}

export function missingManagedInvocationRequiredCapabilities(
  requiredToolNames: readonly string[],
  profileDefaults: ManagedInvocationRouteProfile,
): readonly string[] {
  const missing: string[] = [];
  if (unique(requiredToolNames).some(requiresNetworkCapability) && profileDefaults.networkAllowed !== true) {
    missing.push("network");
  }
  if (requiredToolNames.includes("browser_observe") && !profileDefaults.allowedToolNames.includes("browser_observe")) {
    missing.push("browserObservation");
  }
  return missing;
}

export function missingManagedInvocationRequiredReadPaths(
  requiredReadPaths: readonly string[],
  profileDefaults: ManagedInvocationRouteProfile,
): readonly string[] {
  return unique(requiredReadPaths)
    .filter((requiredPath) => !managedInvocationCanReadPath(requiredPath, profileDefaults));
}

function managedInvocationCanReadPath(
  requiredPath: string,
  profileDefaults: ManagedInvocationRouteProfile,
): boolean {
  const normalizedRequired = normalizeManagedInvocationReadPath(
    requiredPath,
    profileDefaults.workingDirectory.path,
  );
  if (!normalizedRequired) {
    return false;
  }
  const deniedPaths = profileDefaults.readAuthority?.workspace.deniedPaths ?? [];
  if (deniedPaths.some((deniedPath) => pathEqualsOrContains(normalizeManagedInvocationReadPath(deniedPath), normalizedRequired))) {
    return false;
  }
  return effectiveManagedInvocationReadRoots(profileDefaults)
    .some((allowedPath) => pathEqualsOrContains(normalizeManagedInvocationReadPath(allowedPath), normalizedRequired));
}

export function effectiveManagedInvocationReadRoots(
  profileDefaults: ManagedInvocationRouteProfile,
): readonly string[] {
  return unique([
    profileDefaults.workingDirectory.path,
    ...(profileDefaults.readAuthority?.workspace.allowedPaths ?? []),
  ]);
}

function pathEqualsOrContains(rootPath: string | undefined, candidatePath: string): boolean {
  if (!rootPath) {
    return false;
  }
  return rootPath === candidatePath || candidatePath.startsWith(`${rootPath}/`);
}

function normalizeManagedInvocationReadPath(pathValue: string, relativeRoot?: string): string | undefined {
  const normalized = pathValue.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (normalized.length === 0) {
    return undefined;
  }
  if (managedInvocationPathIsAbsolute(normalized) || !relativeRoot) {
    return posix.normalize(normalized);
  }
  const root = relativeRoot.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  return root.length > 0
    ? posix.normalize(`${root}/${normalized}`)
    : posix.normalize(normalized);
}

function managedInvocationPathIsAbsolute(pathValue: string): boolean {
  return pathValue.startsWith("/") || /^[A-Za-z]:\//.test(pathValue);
}

export function requiresNetworkCapability(toolName: string): boolean {
  return toolName.startsWith("web_") || toolName.startsWith("browser_");
}
