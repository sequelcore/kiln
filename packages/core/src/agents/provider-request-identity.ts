import type { ProviderRequestIdentity } from "./index.js";

/** Returns only portable, bounded IDs suitable for provider headers and durable diagnostics. */
export function safeProviderRequestIdentity(identity: ProviderRequestIdentity | undefined): ProviderRequestIdentity | undefined {
  const projectId = safeProviderIdentityPart(identity?.projectId);
  const requestId = safeProviderIdentityPart(identity?.requestId);
  return projectId || requestId ? { ...(projectId ? { projectId } : {}), ...(requestId ? { requestId } : {}) } : undefined;
}

function safeProviderIdentityPart(value: string | undefined): string | undefined {
  return value !== undefined && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : undefined;
}
