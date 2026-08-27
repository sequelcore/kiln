import { isObjectRecord, readString } from "./unknown-value.js";

/**
 * localStorage boundary for session-store persisted preferences: plan mode,
 * the continuation target, and the last explicit execution-route selection. Pure
 * (fails open on storage errors), no store dependency.
 */

const PLAN_MODE_KEY = "kiln.gui.planMode";
const CONTINUATION_TARGET_KEY = "kiln.gui.continuationTarget";
const EXECUTION_TARGET_SELECTION_KEY = "kiln.gui.executionTargetSelection:v2";

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

export function readStoredExecutionTargetSelection(): { readonly targetId: string; readonly accountOverrideId?: string } | null {
  try {
    const raw = localStorage.getItem(EXECUTION_TARGET_SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectRecord(parsed)) return null;
    const targetId = readString(parsed.targetId);
    if (!targetId) return null;
    return {
      targetId,
      ...(readString(parsed.accountOverrideId) ? { accountOverrideId: readString(parsed.accountOverrideId)! } : {}),
    };
  } catch {
    return null;
  }
}

export function writeStoredExecutionTargetSelection(targetId: string, accountOverrideId?: string): void {
  try {
    localStorage.setItem(EXECUTION_TARGET_SELECTION_KEY, JSON.stringify({
      targetId,
      ...(accountOverrideId ? { accountOverrideId } : {}),
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
