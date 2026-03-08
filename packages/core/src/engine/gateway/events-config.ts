// Events configuration for conversation event emission
// Follows the same pattern as BillingConfig in mode-b-config.ts

export interface EventsConfig {
  readonly webhook: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Max retry attempts for failed POSTs (default: 3). Only 5xx and network errors are retried. */
  readonly retryAttempts?: number;
  /** Base backoff in ms for exponential retry (default: 1000). Doubles each attempt. */
  readonly retryBackoffMs?: number;
}
