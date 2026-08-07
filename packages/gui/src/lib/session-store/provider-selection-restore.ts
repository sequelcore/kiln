import { readStoredProviderSelection } from "./session-store-persistence.js";
import { providerSupportsSelection } from "./provider-catalog-projection.js";
import type { SessionStoreState } from "./session-store-state.js";

/**
 * Decides whether a persisted provider selection should be restored right
 * now, given catalog readiness and any active/explicit selection already in
 * place. Shared between connection-lifecycle (on sender attach) and
 * provider-lifecycle (on welcome/catalog refresh); no single slice owns it.
 * Pure, no store dependency.
 */

export function resolveStoredProviderSelectionRestore(
  state: SessionStoreState,
  options: { readonly allowActiveOverride?: boolean } = {},
): { readonly provider: string; readonly model: string | null } | null {
  if (
    state.providerSwitching
    || state.providerCatalogStatus !== "ready"
    || !state.outboundSend
  ) {
    return null;
  }
  const stored = readStoredProviderSelection();
  if (!stored) {
    return null;
  }
  const provider = state.providers.find((candidate) => candidate.id === stored.provider);
  if (!provider || !providerSupportsSelection(provider, stored.model, state.providerModelDiscovery)) {
    return null;
  }
  if (!options.allowActiveOverride && (state.activeProvider || state.providerExplicitSelection)) {
    return null;
  }
  if (options.allowActiveOverride && state.activeProvider === stored.provider && state.activeModel === stored.model) {
    return null;
  }
  return stored;
}
