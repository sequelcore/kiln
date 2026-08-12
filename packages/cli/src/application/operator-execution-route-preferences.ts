import {
  defaultGlobalConfig,
  mutateGlobalConfig,
  type KilnGlobalConfig,
} from "../config/global-config.js";

export interface OperatorExecutionRouteSelectionPreference {
  readonly routeId: string;
  readonly accountOverrideId: string | null;
}

function normalizeCanonicalId(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    return null;
  }
  return value;
}

export function resolveGuiExecutionRouteSelectionPreference(
  config: KilnGlobalConfig | null | undefined,
): OperatorExecutionRouteSelectionPreference | null {
  const routeId = normalizeCanonicalId(config?.ui?.executionRouteSelection?.routeId);
  if (!routeId) return null;
  return {
    routeId,
    accountOverrideId: normalizeCanonicalId(config?.ui?.executionRouteSelection?.accountOverrideId),
  };
}

export function persistGuiExecutionRouteSelectionPreference(
  routeId: string,
  accountOverrideId: string | null | undefined,
  configOverride?: KilnGlobalConfig | null,
): void {
  const resolvedRouteId = normalizeCanonicalId(routeId);
  if (!resolvedRouteId) return;
  const resolvedAccountOverrideId = normalizeCanonicalId(accountOverrideId);
  mutateGlobalConfig((persisted) => {
    const current = persisted ?? configOverride ?? defaultGlobalConfig();
    return {
      ...current,
      ui: {
        ...current.ui,
        executionRouteSelection: {
          routeId: resolvedRouteId,
          ...(resolvedAccountOverrideId ? { accountOverrideId: resolvedAccountOverrideId } : {}),
        },
      },
    };
  });
}
