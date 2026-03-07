// Email auto-reply loop prevention -- pure functions
// Prevents infinite loops when AI replies trigger vacation responders, bounces, or mailing lists

const AUTOMATED_PRECEDENCE = new Set(["bulk", "junk", "list"]);
const IGNORED_PREFIXES = ["noreply@", "no-reply@", "mailer-daemon@", "postmaster@", "bounce@", "auto@"];

/** Check if inbound email headers indicate an auto-reply (RFC 3834) */
export function isAutoReply(headers: Record<string, string>): boolean {
  const autoSubmitted = headers["auto-submitted"] ?? headers["Auto-Submitted"];
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return true;

  const precedence = (headers["precedence"] ?? headers["Precedence"] ?? "").toLowerCase();
  if (AUTOMATED_PRECEDENCE.has(precedence)) return true;

  if (headers["x-auto-response-suppress"] ?? headers["X-Auto-Response-Suppress"]) return true;

  const returnPath = headers["return-path"] ?? headers["Return-Path"];
  if (returnPath === "<>" || returnPath === "") return true;

  return false;
}

/** Check if the sender address should be ignored (system addresses) */
export function isIgnoredSender(from: string): boolean {
  if (!from) return true;
  const lower = from.toLowerCase().trim();
  if (!lower) return true;
  return IGNORED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Combined rejection check -- returns reason string for logging */
export function shouldRejectEmail(
  from: string,
  headers: Record<string, string>,
): { reject: boolean; reason?: string } {
  if (isIgnoredSender(from)) {
    return { reject: true, reason: `ignored sender: ${from}` };
  }
  if (isAutoReply(headers)) {
    return { reject: true, reason: "auto-reply detected via headers" };
  }
  return { reject: false };
}
