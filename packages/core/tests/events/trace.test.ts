import { describe, it, expect } from "vitest";
import {
  createTraceContext,
  startSpan,
  endSpan,
  addSpanEvent,
} from "../../src/events/trace.js";

describe("createTraceContext", () => {
  it("returns a context with UUID traceId and the given sessionId", () => {
    const ctx = createTraceContext("session-42");

    expect(ctx.sessionId).toBe("session-42");
    expect(ctx.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(ctx.activeSpanId).toBeNull();
  });

  it("generates unique traceIds on successive calls", () => {
    const ctx1 = createTraceContext("s1");
    const ctx2 = createTraceContext("s2");
    expect(ctx1.traceId).not.toBe(ctx2.traceId);
  });
});

describe("startSpan", () => {
  it("creates a span with a new UUID spanId and records operation start", () => {
    const ctx = createTraceContext("session-1");
    const before = new Date();
    const { span } = startSpan(ctx, "plan", "phase");
    const after = new Date();

    expect(span.spanId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(span.traceId).toBe(ctx.traceId);
    expect(span.name).toBe("plan");
    expect(span.kind).toBe("phase");
    expect(span.status).toBe("ok");
    expect(span.events).toEqual([]);
    expect(span.startTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(span.startTime.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(span.endTime).toBeUndefined();
  });

  it("sets parentSpanId to null when context has no active span", () => {
    const ctx = createTraceContext("session-1");
    const { span } = startSpan(ctx, "root", "phase");
    expect(span.parentSpanId).toBeNull();
  });

  it("returns a child context with the new span as active", () => {
    const ctx = createTraceContext("session-1");
    const { span, childContext } = startSpan(ctx, "plan", "phase");

    expect(childContext.traceId).toBe(ctx.traceId);
    expect(childContext.sessionId).toBe(ctx.sessionId);
    expect(childContext.activeSpanId).toBe(span.spanId);
  });

  it("stores provided attributes on the span", () => {
    const ctx = createTraceContext("s");
    const attrs = { model: "claude-3", tokens: 100, streaming: true };
    const { span } = startSpan(ctx, "call-llm", "agent", attrs);
    expect(span.attributes).toEqual(attrs);
  });

  it("defaults to empty attributes when none provided", () => {
    const ctx = createTraceContext("s");
    const { span } = startSpan(ctx, "check", "gate");
    expect(span.attributes).toEqual({});
  });
});

describe("nested spans maintain correct parent-child relationships", () => {
  it("child span references parent span via parentSpanId", () => {
    const root = createTraceContext("session-1");
    const { span: parentSpan, childContext: parentCtx } = startSpan(root, "phase-plan", "phase");
    const { span: childSpan, childContext: childCtx } = startSpan(parentCtx, "call-agent", "agent");

    expect(childSpan.parentSpanId).toBe(parentSpan.spanId);
    expect(childSpan.traceId).toBe(parentSpan.traceId);
    expect(childCtx.activeSpanId).toBe(childSpan.spanId);
  });

  it("three-level nesting preserves the chain", () => {
    const root = createTraceContext("session-1");
    const { span: s1, childContext: c1 } = startSpan(root, "phase", "phase");
    const { span: s2, childContext: c2 } = startSpan(c1, "agent", "agent");
    const { span: s3 } = startSpan(c2, "tool", "tool");

    expect(s1.parentSpanId).toBeNull();
    expect(s2.parentSpanId).toBe(s1.spanId);
    expect(s3.parentSpanId).toBe(s2.spanId);

    // All share the same traceId
    expect(s1.traceId).toBe(s2.traceId);
    expect(s2.traceId).toBe(s3.traceId);
  });
});

describe("endSpan", () => {
  it("closes the span with an endTime", () => {
    const ctx = createTraceContext("s");
    const { span } = startSpan(ctx, "work", "phase");

    const before = new Date();
    const ended = endSpan(span);
    const after = new Date();

    expect(ended.endTime).toBeDefined();
    expect(ended.endTime!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ended.endTime!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("preserves original status when no override provided", () => {
    const ctx = createTraceContext("s");
    const { span } = startSpan(ctx, "work", "phase");
    const ended = endSpan(span);
    expect(ended.status).toBe("ok");
  });

  it("sets error status when specified", () => {
    const ctx = createTraceContext("s");
    const { span } = startSpan(ctx, "work", "phase");
    const ended = endSpan(span, "error");
    expect(ended.status).toBe("error");
  });

  it("sets cancelled status when specified", () => {
    const ctx = createTraceContext("s");
    const { span } = startSpan(ctx, "work", "phase");
    const ended = endSpan(span, "cancelled");
    expect(ended.status).toBe("cancelled");
  });

  it("does not mutate the original span (immutable)", () => {
    const ctx = createTraceContext("s");
    const { span } = startSpan(ctx, "work", "phase");
    const ended = endSpan(span, "error");

    expect(span.endTime).toBeUndefined();
    expect(span.status).toBe("ok");
    expect(ended.status).toBe("error");
  });
});

describe("addSpanEvent", () => {
  it("adds an event to the span with name and timestamp", () => {
    const ctx = createTraceContext("s");
    const { span } = startSpan(ctx, "work", "phase");

    const before = new Date();
    const updated = addSpanEvent(span, "checkpoint-saved");
    const after = new Date();

    expect(updated.events).toHaveLength(1);
    expect(updated.events[0]!.name).toBe("checkpoint-saved");
    expect(updated.events[0]!.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updated.events[0]!.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("includes attributes when provided", () => {
    const ctx = createTraceContext("s");
    const { span } = startSpan(ctx, "work", "phase");
    const updated = addSpanEvent(span, "retry", { attempt: 3, reason: "timeout" });

    expect(updated.events[0]!.attributes).toEqual({ attempt: 3, reason: "timeout" });
  });

  it("leaves attributes undefined when not provided", () => {
    const ctx = createTraceContext("s");
    const { span } = startSpan(ctx, "work", "phase");
    const updated = addSpanEvent(span, "done");

    expect(updated.events[0]!.attributes).toBeUndefined();
  });

  it("appends multiple events in order", () => {
    const ctx = createTraceContext("s");
    const { span } = startSpan(ctx, "work", "phase");

    const s1 = addSpanEvent(span, "first");
    const s2 = addSpanEvent(s1, "second");
    const s3 = addSpanEvent(s2, "third");

    expect(s3.events).toHaveLength(3);
    expect(s3.events[0]!.name).toBe("first");
    expect(s3.events[1]!.name).toBe("second");
    expect(s3.events[2]!.name).toBe("third");
  });

  it("does not mutate the original span (immutable)", () => {
    const ctx = createTraceContext("s");
    const { span } = startSpan(ctx, "work", "phase");
    const updated = addSpanEvent(span, "test");

    expect(span.events).toHaveLength(0);
    expect(updated.events).toHaveLength(1);
  });
});
