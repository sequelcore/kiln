/** Secret-free provider evidence proving a fenced request reached a terminal error response. */
export interface ProviderDispatchTerminalEvidence {
  readonly outcome: "provider-error";
  readonly requestId: string;
  readonly status: number;
  readonly observedAt: string;
}

/**
 * Internal execution-kernel signal. Provider text is deliberately discarded;
 * callers persist only the bounded evidence.
 */
export class ProviderDispatchTerminalError extends Error {
  override readonly name = "ProviderDispatchTerminalError";

  constructor(
    readonly evidence: ProviderDispatchTerminalEvidence,
    _cause: unknown,
  ) {
    super("The provider returned a terminal error response.");
  }
}
