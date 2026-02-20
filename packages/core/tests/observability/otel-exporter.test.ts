import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TracerProvider, Tracer, Span } from "@opentelemetry/api";
import { OTelExporter } from "../../src/observability/otel-exporter.js";

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function makeMockSpan(): Span {
    return {
        setAttribute: vi.fn(),
        addEvent: vi.fn(),
        setStatus: vi.fn(),
        end: vi.fn(),
        // Minimal stubs for remaining Span properties
        spanContext: vi.fn().mockReturnValue({}),
        updateName: vi.fn(),
        setAttributes: vi.fn(),
        recordException: vi.fn(),
        isRecording: vi.fn().mockReturnValue(true),
    } as unknown as Span;
}

function makeMockTracer(span: Span): Tracer {
    return {
        startSpan: vi.fn().mockReturnValue(span),
        startActiveSpan: vi.fn(),
    } as unknown as Tracer;
}

function makeMockProvider(tracer: Tracer, withShutdown = true): TracerProvider {
    const p: Record<string, unknown> = {
        getTracer: vi.fn().mockReturnValue(tracer),
    };
    if (withShutdown) {
        p["shutdown"] = vi.fn().mockResolvedValue(undefined);
    }
    return p as unknown as TracerProvider;
}

const SESSION = "sess-test";
const TS = new Date();

function baseEvent(overrides: Record<string, unknown>) {
    return { sessionId: SESSION, timestamp: TS, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OTelExporter", () => {
    let span: Span;
    let tracer: Tracer;
    let provider: TracerProvider;
    let exporter: OTelExporter;

    beforeEach(() => {
        span = makeMockSpan();
        tracer = makeMockTracer(span);
        provider = makeMockProvider(tracer);
        exporter = new OTelExporter(provider, { serviceName: "test-svc" });
    });

    describe("constructor", () => {
        it("calls getTracer with serviceName", () => {
            expect(provider.getTracer).toHaveBeenCalledWith("test-svc", "0.1.0");
        });
    });

    describe("save() -- startSpan", () => {
        it("calls tracer.startSpan for phase_changed event", async () => {
            await exporter.save(
                baseEvent({ type: "phase_changed", phase: "implement", phaseName: "Implement", phaseDescription: "Write code" }) as never,
            );
            expect(tracer.startSpan).toHaveBeenCalledWith("Implement");
            expect(span.setAttribute).toHaveBeenCalled();
        });

        it("calls tracer.startSpan for tool_called event", async () => {
            await exporter.save(
                baseEvent({ type: "tool_called", toolName: "read_file", taskId: "t-1", workerIndex: 0 }) as never,
            );
            expect(tracer.startSpan).toHaveBeenCalledWith("read_file");
        });

        it("calls tracer.startSpan for worker_assigned event", async () => {
            await exporter.save(
                baseEvent({ type: "worker_assigned", workerIndex: 1, taskId: "t-1" }) as never,
            );
            expect(tracer.startSpan).toHaveBeenCalledWith("worker-1");
        });

        it("calls tracer.startSpan for task_started event", async () => {
            await exporter.save(
                baseEvent({ type: "task_started", taskId: "t-2", statement: "Do work", parentId: null }) as never,
            );
            expect(tracer.startSpan).toHaveBeenCalledWith("Do work");
        });

        it("calls tracer.startSpan for webhook_received event", async () => {
            await exporter.save(
                baseEvent({ type: "webhook_received", path: "/webhook/gh", appName: "app", triggerName: "gh", method: "POST" }) as never,
            );
            expect(tracer.startSpan).toHaveBeenCalledWith("trigger.webhook");
        });
    });

    describe("save() -- endSpan", () => {
        it("ends the active span for task_completed and calls span.end()", async () => {
            // Start a task span first
            await exporter.save(
                baseEvent({ type: "task_started", taskId: "t-1", statement: "Do work", parentId: null }) as never,
            );
            // End it
            await exporter.save(
                baseEvent({ type: "task_completed", taskId: "t-1", status: "done", action: "complete" }) as never,
            );
            expect(span.end).toHaveBeenCalled();
        });

        it("sets status to error for error event", async () => {
            // Start a phase span first
            await exporter.save(
                baseEvent({ type: "phase_changed", phase: "implement", phaseName: "Implement", phaseDescription: "" }) as never,
            );
            await exporter.save(
                baseEvent({ type: "error", message: "Oops", code: "TOOL_FAILED", taskId: null }) as never,
            );
            expect(span.setStatus).toHaveBeenCalledWith(expect.objectContaining({ code: 2 }));
        });

        it("sets ok status for successful tool_result", async () => {
            await exporter.save(
                baseEvent({ type: "tool_called", toolName: "write_file", taskId: "t-1", workerIndex: 0 }) as never,
            );
            await exporter.save(
                baseEvent({ type: "tool_result", toolName: "write_file", taskId: "t-1", durationMs: 10, success: true }) as never,
            );
            expect(span.setStatus).toHaveBeenCalledWith(expect.objectContaining({ code: 1 }));
            expect(span.end).toHaveBeenCalled();
        });

        it("does nothing when no active span exists for the key", async () => {
            // task_completed without a prior task_started -- should not throw
            await expect(
                exporter.save(baseEvent({ type: "task_completed", taskId: "nonexistent", status: "done", action: "skip" }) as never),
            ).resolves.toBeUndefined();
        });
    });

    describe("save() -- addEvent", () => {
        it("calls addEvent on the active span for thinking", async () => {
            // Start a span to have an active one
            await exporter.save(
                baseEvent({ type: "phase_changed", phase: "impl", phaseName: "Impl", phaseDescription: "" }) as never,
            );
            await exporter.save(
                baseEvent({ type: "thinking", role: "architect", content: "I think..." }) as never,
            );
            expect(span.addEvent).toHaveBeenCalledWith("thinking", expect.any(Object));
        });

        it("calls addEvent for memory_saved", async () => {
            await exporter.save(
                baseEvent({ type: "phase_changed", phase: "impl", phaseName: "Impl", phaseDescription: "" }) as never,
            );
            await exporter.save(
                baseEvent({ type: "memory_saved", memoryId: "m-1", layer: "user", tags: ["a"] }) as never,
            );
            expect(span.addEvent).toHaveBeenCalledWith("memory.saved", expect.any(Object));
        });

        it("does not throw when no active span for addEvent", async () => {
            // No span started -- should silently no-op
            await expect(
                exporter.save(baseEvent({ type: "thinking", role: "r", content: "..." }) as never),
            ).resolves.toBeUndefined();
        });
    });

    describe("save() -- setAttributes", () => {
        it("calls setAttribute on active span for cost_update", async () => {
            await exporter.save(
                baseEvent({ type: "phase_changed", phase: "impl", phaseName: "Impl", phaseDescription: "" }) as never,
            );
            await exporter.save(
                baseEvent({ type: "cost_update", inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, totalCostUsd: 0.001, byRole: {} }) as never,
            );
            expect(span.setAttribute).toHaveBeenCalledWith("totalCostUsd", 0.001);
        });
    });

    describe("getBySession()", () => {
        it("rejects with an explanatory error", async () => {
            await expect(exporter.getBySession("any")).rejects.toThrow("does not support retrieval");
        });
    });

    describe("getAfter()", () => {
        it("rejects with an explanatory error", async () => {
            await expect(exporter.getAfter("any", "after-id")).rejects.toThrow("does not support retrieval");
        });
    });

    describe("shutdown()", () => {
        it("calls provider.shutdown() when available", async () => {
            await exporter.shutdown();
            const mockProvider = provider as unknown as { shutdown: ReturnType<typeof vi.fn> };
            expect(mockProvider.shutdown).toHaveBeenCalled();
        });

        it("does not throw when provider has no shutdown method", async () => {
            const noShutdownProvider = makeMockProvider(tracer, false);
            const exp = new OTelExporter(noShutdownProvider, { serviceName: "x" });
            await expect(exp.shutdown()).resolves.toBeUndefined();
        });

        it("ends any leaked active spans during shutdown", async () => {
            const leakSpan = makeMockSpan();
            const leakTracer = makeMockTracer(leakSpan);
            const leakProvider = makeMockProvider(leakTracer);
            const leakExp = new OTelExporter(leakProvider, { serviceName: "leak" });

            // Start a span that's never ended
            await leakExp.save(
                baseEvent({ type: "phase_changed", phase: "stuck", phaseName: "Stuck", phaseDescription: "" }) as never,
            );
            await leakExp.shutdown();
            expect(leakSpan.end).toHaveBeenCalled();
        });
    });
});
