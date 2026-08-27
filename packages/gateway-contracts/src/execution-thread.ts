/** Post-admission execution identity retained for session continuity. */
export interface ExecutionThreadMeta {
  readonly routeId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly providerSessionId?: string;
  readonly lastUsedAt?: string;
}
