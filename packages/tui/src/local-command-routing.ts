const EXACT_LOCAL_COMMANDS = new Set([
  "/clear",
  "/theme",
  "/target",
  "/deliberation",
  "/authority",
  "/continue",
  "/plan",
  "/exec",
  "/setup",
  "/settings",
]);

/** Returns whether input is consumed by the TUI instead of sent to a model. */
export function isLocallyHandledTuiInput(text: string): boolean {
  return EXACT_LOCAL_COMMANDS.has(text) || text.startsWith("/settings ");
}
