// Per-request trace context for structured logging across gateway entry points

export class TraceContext {
  readonly traceId: string;

  constructor(traceId?: string) {
    this.traceId = traceId ?? crypto.randomUUID();
  }

  log(component: string, message: string, data?: Record<string, unknown>): void {
    console.log(`[${this.traceId}] [${component}] ${message}`, data ? JSON.stringify(data) : "");
  }

  warn(component: string, message: string, data?: Record<string, unknown>): void {
    console.warn(`[${this.traceId}] [${component}] ${message}`, data ? JSON.stringify(data) : "");
  }

  error(component: string, message: string, data?: Record<string, unknown>): void {
    console.error(`[${this.traceId}] [${component}] ${message}`, data ? JSON.stringify(data) : "");
  }
}
