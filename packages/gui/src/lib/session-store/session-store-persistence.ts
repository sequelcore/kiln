import { isObjectRecord, readString } from "./unknown-value.js";

/**
 * localStorage boundary for session-store persisted preferences: plan mode,
 * the continuation target, and the last explicit provider selection. Pure
 * (fails open on storage errors), no store dependency.
 */

const PLAN_MODE_KEY = "kiln.gui.planMode";
const CONTINUATION_TARGET_KEY = "kiln.gui.continuationTarget";
const PROVIDER_SELECTION_KEY = "kiln.gui.providerSelection:v1";

export function readStoredPlanMode(): boolean | null {
  try {
    const value = localStorage.getItem(PLAN_MODE_KEY);
    if (value === null) return null;
    return value === "true";
  } catch {
    return null;
  }
}

export function persistPlanMode(value: boolean): void {
  try {
    localStorage.setItem(PLAN_MODE_KEY, value ? "true" : "false");
  } catch {
    // fail-open
  }
}

export function readStoredProviderSelection(): { readonly provider: string; readonly model: string | null } | null {
  try {
    const raw = localStorage.getItem(PROVIDER_SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectRecord(parsed)) return null;
    const provider = readString(parsed.provider);
    if (!provider) return null;
    return {
      provider,
      model: readString(parsed.model),
    };
  } catch {
    return null;
  }
}

export function writeStoredProviderSelection(provider: string, model: string | null): void {
  try {
    localStorage.setItem(PROVIDER_SELECTION_KEY, JSON.stringify({
      provider,
      ...(model ? { model } : {}),
    }));
  } catch {
    // fail-open
  }
}

export function clearStoredContinuationTarget(): void {
  try {
    localStorage.removeItem(CONTINUATION_TARGET_KEY);
  } catch {
    // fail-open
  }
}
