export interface SessionLedger {
  readonly currentPhase: string;
  readonly resumedFrom?: string;
  readonly workingDirectory?: string;
  readonly worktreePath?: string;
  readonly lastError?: string;
  readonly lastProvider?: string;
  readonly toolCallCount?: number;
  readonly turnDepth?: number;
}

export function renderSessionLedger(ledger: SessionLedger): string | undefined {
  const lines: string[] = [];

  if (ledger.currentPhase.trim() !== "") {
    lines.push(`Current phase: ${ledger.currentPhase}`);
  }
  if (ledger.resumedFrom && ledger.resumedFrom.trim() !== "") {
    lines.push(`Resumed from session: ${ledger.resumedFrom}`);
  }
  if (ledger.workingDirectory && ledger.workingDirectory.trim() !== "") {
    lines.push(`Working directory: ${ledger.workingDirectory}`);
  }
  if (ledger.worktreePath && ledger.worktreePath.trim() !== "") {
    lines.push(`Isolated worktree: ${ledger.worktreePath}`);
  }
  if (ledger.lastProvider && ledger.lastProvider.trim() !== "") {
    lines.push(`Last successful provider: ${ledger.lastProvider}`);
  }
  if (ledger.toolCallCount !== undefined) {
    lines.push(`Tool calls so far: ${ledger.toolCallCount}`);
  }
  if (ledger.turnDepth !== undefined) {
    lines.push(`Turn depth so far: ${ledger.turnDepth}`);
  }
  if (ledger.lastError && ledger.lastError.trim() !== "") {
    lines.push(`Last error: ${ledger.lastError}`);
  }

  return lines.length > 0 ? lines.join("\n") : undefined;
}
