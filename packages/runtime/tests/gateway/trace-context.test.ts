import { EOL } from "node:os";
import { describe, expect, it } from "vitest";
import {
  TraceContext,
  createProcessTraceSink,
  type RuntimeTraceRecord,
  type RuntimeTraceSink,
} from "../../src/gateway/trace-context.js";

class MemoryTraceSink implements RuntimeTraceSink {
  readonly records: RuntimeTraceRecord[] = [];

  write(record: RuntimeTraceRecord): void {
    this.records.push(record);
  }
}

class MemoryOutput {
  readonly writes: string[] = [];

  write(chunk: string | Uint8Array): boolean {
    this.writes.push(chunk.toString());
    return true;
  }
}

describe("TraceContext", () => {
  it("generates a UUID when no traceId is provided", () => {
    const ctx = new TraceContext(undefined, new MemoryTraceSink());
    expect(ctx.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("emits structured records instead of formatting through the global console", () => {
    const sink = new MemoryTraceSink();
    const ctx = new TraceContext("trace-data", sink);

    ctx.log("pipeline", "Session ready", { sessionId: "s1", mode: "ai_active" });
    ctx.warn("pipeline", "Resume hydration failed", { sessionId: "s1" });
    ctx.error("pipeline", "Turn failed");

    expect(sink.records).toEqual([
      expect.objectContaining({
        severity: "info",
        traceId: "trace-data",
        component: "pipeline",
        message: "Session ready",
        attributes: { sessionId: "s1", mode: "ai_active" },
        observedAt: expect.any(String),
      }),
      expect.objectContaining({
        severity: "warn",
        traceId: "trace-data",
        component: "pipeline",
        message: "Resume hydration failed",
        attributes: { sessionId: "s1" },
        observedAt: expect.any(String),
      }),
      expect.objectContaining({
        severity: "error",
        traceId: "trace-data",
        component: "pipeline",
        message: "Turn failed",
        observedAt: expect.any(String),
      }),
    ]);
  });

  it("renders each human trace record with one platform-correct write", () => {
    const stdout = new MemoryOutput();
    const stderr = new MemoryOutput();
    const sink = createProcessTraceSink({ stdout, stderr, format: "human" });

    sink.write({
      observedAt: "2026-07-18T12:00:00.000Z",
      severity: "info",
      traceId: "trace-123",
      component: "pipeline",
      message: "Session ready",
      attributes: { sessionId: "s1" },
    });
    sink.write({
      observedAt: "2026-07-18T12:00:01.000Z",
      severity: "warn",
      traceId: "trace-123",
      component: "billing",
      message: "Pricing unavailable",
    });

    expect(stdout.writes).toEqual([
      `[trace-123] [pipeline] Session ready {"sessionId":"s1"}${EOL}`,
    ]);
    expect(stderr.writes).toEqual([
      `[trace-123] [billing] Warning: Pricing unavailable${EOL}`,
    ]);
  });

  it("renders stable JSON Lines records without splitting metadata into another write", () => {
    const stdout = new MemoryOutput();
    const stderr = new MemoryOutput();
    const sink = createProcessTraceSink({ stdout, stderr, format: "json" });
    const record: RuntimeTraceRecord = {
      observedAt: "2026-07-18T12:00:00.000Z",
      severity: "error",
      traceId: "trace-json",
      component: "gateway",
      message: "Internal failure",
      attributes: { retryable: false },
    };

    sink.write(record);

    expect(stdout.writes).toEqual([]);
    expect(stderr.writes).toEqual([`${JSON.stringify(record)}${EOL}`]);
  });

  it("filters routine traces below the configured operational severity", () => {
    const stdout = new MemoryOutput();
    const stderr = new MemoryOutput();
    const sink = createProcessTraceSink({
      stdout,
      stderr,
      format: "human",
      minSeverity: "warn",
    });

    sink.write({
      observedAt: "2026-07-18T12:00:00.000Z",
      severity: "info",
      traceId: "trace-filter",
      component: "pipeline",
      message: "Routine progress",
    });

    expect(stdout.writes).toEqual([]);
    expect(stderr.writes).toEqual([]);
  });

  it("keeps diagnostics non-fatal when attributes cannot be serialized", () => {
    const stdout = new MemoryOutput();
    const stderr = new MemoryOutput();
    const sink = createProcessTraceSink({ stdout, stderr, format: "json" });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => sink.write({
      observedAt: "2026-07-18T12:00:00.000Z",
      severity: "error",
      traceId: "trace-cyclic",
      component: "gateway",
      message: "Diagnostic serialization failed",
      attributes: cyclic,
    })).not.toThrow();
    expect(stderr.writes).toHaveLength(1);
    expect(JSON.parse(stderr.writes[0]!)).toMatchObject({
      traceId: "trace-cyclic",
      attributes: { serializationError: "unserializable trace attributes" },
    });
  });
});
