/**
 * Correlation-id minting and diagnostic logging for outbound provider-switch
 * and provider-auth requests. Pure aside from module-level ordinal counters
 * and an opt-in console log; no store dependency.
 */

let executionTargetSelectionRequestOrdinal = 0;
let modelCatalogRefreshRequestOrdinal = 0;
let providerAuthRequestOrdinal = 0;

export function nextExecutionTargetSelectionRequestId(): string {
  executionTargetSelectionRequestOrdinal += 1;
  return `execution-target-selection:${Date.now()}:${executionTargetSelectionRequestOrdinal}`;
}

export function nextModelCatalogRefreshRequestId(): string {
  modelCatalogRefreshRequestOrdinal += 1;
  return `model-catalog-refresh:${Date.now()}:${modelCatalogRefreshRequestOrdinal}`;
}

export function nextProviderAuthRequestId(): string {
  providerAuthRequestOrdinal += 1;
  return `provider-auth:${Date.now()}:${providerAuthRequestOrdinal}`;
}

export function providerRequiresSelectedModelMessage(provider: string): string {
  return `Provider '${provider}' requires a selected model.`;
}

export function providerAuthDebug(message: string, context?: Record<string, unknown>): void {
  const env = (import.meta as { readonly env?: Record<string, string | undefined> }).env;
  const enabled = /^(1|true|yes)$/i.test(
    env?.VITE_KILN_PROVIDER_AUTH_DEBUG?.trim()
    ?? env?.KILN_PROVIDER_AUTH_DEBUG?.trim()
    ?? "",
  );
  if (!enabled) {
    return;
  }
  console.warn(`[gui-session-store:provider-auth][debug] ${message}`, context ?? {});
}
