export const SESSION_HISTORY_GROUP_IDS = [
  "active",
  "needs-attention",
  "today",
  "yesterday",
  "previous-7-days",
  "older",
] as const;

export type SessionHistoryGroupId = typeof SESSION_HISTORY_GROUP_IDS[number];

const COLLAPSED_GROUPS_KEY = "kiln.gui.sessionHistory.collapsedGroups:v1";
const admittedGroupIds = new Set<string>(SESSION_HISTORY_GROUP_IDS);
const persistedGroupIds = new Set<SessionHistoryGroupId>([
  "today",
  "yesterday",
  "previous-7-days",
  "older",
]);

function isSessionHistoryGroupId(value: unknown): value is SessionHistoryGroupId {
  return typeof value === "string" && admittedGroupIds.has(value);
}

export function readCollapsedSessionGroupIds(): ReadonlySet<SessionHistoryGroupId> {
  try {
    const stored = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? "[]");
    return new Set(
      Array.isArray(stored)
        ? stored.filter(isSessionHistoryGroupId).filter((id) => persistedGroupIds.has(id))
        : [],
    );
  } catch {
    return new Set();
  }
}

export function persistCollapsedSessionGroupIds(ids: ReadonlySet<SessionHistoryGroupId>): void {
  try {
    localStorage.setItem(
      COLLAPSED_GROUPS_KEY,
      JSON.stringify([...ids].filter(isSessionHistoryGroupId).filter((id) => persistedGroupIds.has(id))),
    );
  } catch {
    // Browser storage can be unavailable; disclosure state remains usable in memory.
  }
}
