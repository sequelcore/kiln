import { readStoredExecutionTargetSelection } from "./session-store-persistence.js";
import type { SessionStoreState } from "./session-store-state.js";

export function resolveStoredExecutionTargetSelectionRestore(
  state: SessionStoreState,
  options: { readonly allowActiveOverride?: boolean } = {},
): { readonly targetId: string; readonly accountOverrideId?: string } | null {
  if (state.executionTargetSelecting || state.providerCatalogStatus !== "ready" || !state.outboundSend) return null;
  const stored = readStoredExecutionTargetSelection();
  if (!stored) return null;
  const target = state.modelCatalog.models
    .flatMap((model) => model.targets)
    .find((candidate) => candidate.targetId === stored.targetId);
  if (target?.availability !== "available") return null;
  if (!options.allowActiveOverride && state.activeTargetId) return null;
  if (options.allowActiveOverride && state.activeTargetId === stored.targetId) return null;
  return stored;
}
