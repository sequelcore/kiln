export interface TraceSpan {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly kind: "phase" | "agent" | "tool" | "gate" | "checkpoint";
  readonly startTime: Date;
  readonly endTime?: Date;
  readonly status: "ok" | "error" | "cancelled";
  readonly attributes: Record<string, string | number | boolean>;
  readonly events: readonly SpanEvent[];
}

export interface SpanEvent {
  readonly name: string;
  readonly timestamp: Date;
  readonly attributes?: Record<string, string | number | boolean>;
}

export interface TraceContext {
  readonly traceId: string;
  readonly sessionId: string;
  readonly activeSpanId: string | null;
}

export function createTraceContext(sessionId: string): TraceContext {
  return {
    traceId: crypto.randomUUID(),
    sessionId,
    activeSpanId: null,
  };
}

export function startSpan(
  context: TraceContext,
  name: string,
  kind: TraceSpan["kind"],
  attributes: Record<string, string | number | boolean> = {},
): { span: TraceSpan; childContext: TraceContext } {
  const span: TraceSpan = {
    spanId: crypto.randomUUID(),
    traceId: context.traceId,
    parentSpanId: context.activeSpanId,
    name,
    kind,
    startTime: new Date(),
    status: "ok",
    attributes,
    events: [],
  };

  const childContext: TraceContext = {
    traceId: context.traceId,
    sessionId: context.sessionId,
    activeSpanId: span.spanId,
  };

  return { span, childContext };
}

export function endSpan(
  span: TraceSpan,
  status?: TraceSpan["status"],
): TraceSpan {
  return {
    ...span,
    endTime: new Date(),
    status: status ?? span.status,
  };
}

export function addSpanEvent(
  span: TraceSpan,
  name: string,
  attributes?: Record<string, string | number | boolean>,
): TraceSpan {
  const event: SpanEvent = {
    name,
    timestamp: new Date(),
    attributes,
  };

  return {
    ...span,
    events: [...span.events, event],
  };
}
