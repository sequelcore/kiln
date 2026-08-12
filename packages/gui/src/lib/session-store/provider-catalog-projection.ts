import type {
  GuiProviderCatalogStatus,
} from "@kilnai/gateway-contracts";
import { isGuiProviderModeless } from "@kilnai/gateway-contracts";
/**
 * Provider-catalog shape and canonical-eligibility projection. Runtime is the
 * authority on provider/model eligibility (`GuiProviderModelDiscoveryProjection`);
 * this module only normalizes the wire descriptor shape and reads that
 * eligibility decision, it never derives selectability locally. Pure, no
 * store dependency.
 */

export type ProviderCatalogStatus = GuiProviderCatalogStatus;

export interface ProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly group: "subscription" | "harness" | "direct-api";
  readonly free: boolean;
  readonly available: boolean;
  readonly models: readonly string[];
  readonly status?: string;
  readonly reason?: string;
  readonly authState?: string;
  readonly lastCheckedAt?: string;
}

export function normalizeProviderDescriptors(
  providers: readonly Partial<ProviderDescriptor>[],
): ProviderDescriptor[] {
  const providersById = new Map<string, ProviderDescriptor>();
  for (const provider of providers) {
    if (!provider || typeof provider !== "object") continue;
    const candidate = provider as Partial<ProviderDescriptor>;
    if (
      typeof candidate.id !== "string"
      || typeof candidate.label !== "string"
      || (candidate.group !== "subscription" && candidate.group !== "harness" && candidate.group !== "direct-api")
      || typeof candidate.free !== "boolean"
      || typeof candidate.available !== "boolean"
      || !Array.isArray(candidate.models)
    ) {
      continue;
    }
    const models = candidate.models.flatMap((model) => {
      if (typeof model !== "string") {
        return [];
      }
      const normalized = model.trim();
      return normalized.length > 0 ? [normalized] : [];
    });
    providersById.set(candidate.id, {
      id: candidate.id,
      label: candidate.label,
      group: candidate.group,
      free: candidate.free,
      available: candidate.available && (models.length > 0 || isGuiProviderModeless(candidate.id)),
      models,
      ...(typeof candidate.status === "string" ? { status: candidate.status } : {}),
      ...(typeof candidate.reason === "string" ? { reason: candidate.reason } : {}),
      ...(typeof candidate.authState === "string" ? { authState: candidate.authState } : {}),
      ...(typeof candidate.lastCheckedAt === "string" ? { lastCheckedAt: candidate.lastCheckedAt } : {}),
    });
  }
  return Array.from(providersById.values());
}

export function areProviderDescriptorsEqual(
  current: readonly ProviderDescriptor[],
  next: readonly ProviderDescriptor[],
): boolean {
  if (current.length !== next.length) {
    return false;
  }
  for (let index = 0; index < current.length; index += 1) {
    const left = current[index];
    const right = next[index];
    if (!left || !right) {
      return false;
    }
    if (
      left.id !== right.id
      || left.label !== right.label
      || left.group !== right.group
      || left.free !== right.free
      || left.available !== right.available
      || left.status !== right.status
      || left.reason !== right.reason
      || left.authState !== right.authState
      || left.lastCheckedAt !== right.lastCheckedAt
      || left.models.length !== right.models.length
    ) {
      return false;
    }
    for (let modelIndex = 0; modelIndex < left.models.length; modelIndex += 1) {
      if (left.models[modelIndex] !== right.models[modelIndex]) {
        return false;
      }
    }
  }
  return true;
}
