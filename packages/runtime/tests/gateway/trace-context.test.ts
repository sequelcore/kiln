import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TraceContext } from "../../src/gateway/trace-context.js";

describe("TraceContext", () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  beforeEach(() => {
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  it("generates a UUID when no traceId is provided", () => {
    const ctx = new TraceContext();
    expect(ctx.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("uses the provided traceId when given", () => {
    const ctx = new TraceContext("custom-trace-id");
    expect(ctx.traceId).toBe("custom-trace-id");
  });

  it("log calls console.log with correct format", () => {
    const ctx = new TraceContext("trace-123");
    ctx.log("pipeline", "Processing message");

    expect(console.log).toHaveBeenCalledWith(
      "[trace-123] [pipeline] Processing message",
      "",
    );
  });

  it("warn calls console.warn with correct format", () => {
    const ctx = new TraceContext("trace-456");
    ctx.warn("whatsapp", "Budget denied");

    expect(console.warn).toHaveBeenCalledWith(
      "[trace-456] [whatsapp] Budget denied",
      "",
    );
  });

  it("error calls console.error with correct format", () => {
    const ctx = new TraceContext("trace-789");
    ctx.error("gateway", "Internal failure");

    expect(console.error).toHaveBeenCalledWith(
      "[trace-789] [gateway] Internal failure",
      "",
    );
  });

  it("log with data includes JSON stringified data", () => {
    const ctx = new TraceContext("trace-data");
    ctx.log("pipeline", "Session ready", { sessionId: "s1", mode: "ai_active" });

    expect(console.log).toHaveBeenCalledWith(
      "[trace-data] [pipeline] Session ready",
      JSON.stringify({ sessionId: "s1", mode: "ai_active" }),
    );
  });

  it("log without data does not include extra data", () => {
    const ctx = new TraceContext("trace-nodata");
    ctx.log("pipeline", "Done");

    expect(console.log).toHaveBeenCalledWith(
      "[trace-nodata] [pipeline] Done",
      "",
    );
  });
});
