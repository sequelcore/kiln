/**
 * Timestamp and id generation for locally-originated store records (optimistic
 * messages, request correlation ids). Pure, no store dependency.
 */

export function nowIso(): string {
  return new Date().toISOString();
}

export function createMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
