// Events configuration for conversation event emission
// Follows the same pattern as BillingConfig in mode-b-config.ts

export interface EventsConfig {
  readonly webhook: string;
  readonly headers?: Readonly<Record<string, string>>;
}
