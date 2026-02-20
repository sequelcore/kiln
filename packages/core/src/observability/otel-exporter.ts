// Observability: OTelExporter -- implements EventStore, wraps @opentelemetry/api TracerProvider.
// @opentelemetry/api is a PEER DEPENDENCY in @kilnai/runtime, NOT a dependency of @kilnai/core.
// The TracerProvider is created and injected by the gateway-server, never imported here at runtime.

import type { TracerProvider, Tracer, Span, SpanStatusCode } from "@opentelemetry/api";
import type { KilnEvent } from "../events/index.js";
import type { EventStore } from "../events/event-store.js";
import { mapEventToSpan } from "./span-mapper.js";

export interface OTelExporterConfig {
    readonly serviceName: string;
    readonly attributes?: Record<string, string>;
}

/**
 * Implements EventStore by forwarding Kiln events to an OpenTelemetry TracerProvider.
 * Received events are mapped by SpanMapper then dispatched to the OTel API.
 *
 * This class is write-only. getBySession() and getAfter() throw errors -- retrieval
 * is handled by the OTel backend (Jaeger, Datadog, etc.), not this adapter.
 *
 * Active spans are tracked per-session in an internal Map, and cleaned up on session end.
 * Memory leaks are prevented by the span lifecycle (startSpan/endSpan pairing from SpanMapper).
 */
export class OTelExporter implements EventStore {
    private readonly tracer: Tracer;
    private readonly provider: TracerProvider;
    // sessionId -> (spanKey -> Span)
    // spanKey is derived from taskId / toolName / workerIndex for each startSpan operation
    private readonly activeSpans = new Map<string, Map<string, Span>>();

    constructor(tracerProvider: TracerProvider, config: OTelExporterConfig) {
        this.provider = tracerProvider;
        this.tracer = tracerProvider.getTracer(config.serviceName, "0.1.0");
    }

    async save(event: KilnEvent): Promise<void> {
        const operation = mapEventToSpan(event);
        const spans = this.getOrCreateSessionSpans(event.sessionId);

        switch (operation.action) {
            case "startSpan": {
                const spanKey = this.resolveSpanKey(event);
                const span = this.tracer.startSpan(operation.name);
                this.setAttributes(span, operation.attributes);
                spans.set(spanKey, span);
                break;
            }
            case "endSpan": {
                const spanKey = this.resolveSpanKey(event);
                const span = spans.get(spanKey) ?? this.getActiveSpan(spans);
                if (span) {
                    if (operation.attributes) {
                        this.setAttributes(span, operation.attributes);
                    }
                    // SpanStatusCode.OK = 1, ERROR = 2 -- access through the tracer provider's context
                    // We use numeric literals to avoid importing @opentelemetry/api at runtime in core.
                    const statusCode = operation.status === "error" ? (2 as SpanStatusCode) : (1 as SpanStatusCode);
                    span.setStatus({ code: statusCode });
                    span.end();
                    spans.delete(spanKey);
                    // Also delete by iteration if key-based lookup was a miss (fallback case)
                    for (const [k, s] of spans.entries()) {
                        if (s === span) { spans.delete(k); break; }
                    }
                    // Clean up empty session maps to avoid memory leaks
                    if (spans.size === 0) {
                        this.activeSpans.delete(event.sessionId);
                    }
                }
                break;
            }
            case "addEvent": {
                const activeSpan = this.getActiveSpan(spans);
                if (activeSpan) {
                    activeSpan.addEvent(operation.name, operation.attributes as Record<string, string | number | boolean>);
                }
                break;
            }
            case "setAttributes": {
                const activeSpan = this.getActiveSpan(spans);
                if (activeSpan) {
                    this.setAttributes(activeSpan, operation.attributes);
                }
                break;
            }
        }
    }

    getBySession(_sessionId: string): Promise<KilnEvent[]> {
        return Promise.reject(new Error("OTelExporter does not support retrieval. Query your OTel backend (Jaeger, Datadog, etc.)."));
    }

    getAfter(_sessionId: string, _afterId: string): Promise<KilnEvent[]> {
        return Promise.reject(new Error("OTelExporter does not support retrieval. Query your OTel backend (Jaeger, Datadog, etc.)."));
    }

    /**
     * Flush all pending spans and shut down the tracer provider.
     * Call this during graceful gateway shutdown.
     */
    async shutdown(): Promise<void> {
        // End any leaked spans (belt-and-suspenders)
        for (const spans of this.activeSpans.values()) {
            for (const span of spans.values()) {
                span.end();
            }
        }
        this.activeSpans.clear();

        // TracerProvider.shutdown() is available in the SDK implementations
        const providerWithShutdown = this.provider as { shutdown?: () => Promise<void> };
        if (typeof providerWithShutdown.shutdown === "function") {
            await providerWithShutdown.shutdown();
        }
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private getOrCreateSessionSpans(sessionId: string): Map<string, Span> {
        let spans = this.activeSpans.get(sessionId);
        if (!spans) {
            spans = new Map<string, Span>();
            this.activeSpans.set(sessionId, spans);
        }
        return spans;
    }

    /**
     * Derive a stable span key from the event's identifying fields.
     * For startSpan/endSpan pairs, the same key must be produced for both events.
     */
    private resolveSpanKey(event: KilnEvent): string {
        const e = event as unknown as Record<string, unknown>;
        // Tool spans: keyed by toolName + taskId
        if (typeof e["toolName"] === "string" && typeof e["taskId"] === "string") {
            return `tool:${e["toolName"]}:${e["taskId"]}`;
        }
        // Task spans: keyed by taskId
        if (typeof e["taskId"] === "string") {
            return `task:${e["taskId"]}`;
        }
        // Worker spans: keyed by workerIndex + taskId
        if (typeof e["workerIndex"] === "number") {
            return `worker:${String(e["workerIndex"])}`;
        }
        // Trigger spans: keyed by triggerName
        if (typeof e["triggerName"] === "string") {
            return `trigger:${e["triggerName"]}`;
        }
        // Phase spans: keyed by phase name
        if (typeof e["phase"] === "string") {
            return `phase:${e["phase"]}`;
        }
        // Fallback: event type
        return `event:${event.type}`;
    }

    /** Return the most recently started span for a session (stack-like access). */
    private getActiveSpan(spans: Map<string, Span>): Span | undefined {
        if (spans.size === 0) return undefined;
        // Return the last inserted span (Map preserves insertion order)
        let last: Span | undefined;
        for (const span of spans.values()) {
            last = span;
        }
        return last;
    }

    private setAttributes(span: Span, attributes: Record<string, string | number | boolean>): void {
        for (const [key, value] of Object.entries(attributes)) {
            span.setAttribute(key, value);
        }
    }
}
