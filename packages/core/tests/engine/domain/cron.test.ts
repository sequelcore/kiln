import { describe, it, expect } from "vitest";
import { parseCronExpression, validateCronExpression, nextFireTime } from "../../../src/engine/domain/cron.js";

describe("parseCronExpression", () => {
  it("parses * * * * * (every minute)", () => {
    const expr = parseCronExpression("* * * * *");
    expect(expr.minutes).toHaveLength(60);
    expect(expr.hours).toHaveLength(24);
    expect(expr.daysOfMonth).toHaveLength(31);
    expect(expr.months).toHaveLength(12);
    expect(expr.daysOfWeek).toHaveLength(7);
  });

  it("parses specific values", () => {
    const expr = parseCronExpression("30 9 15 6 3");
    expect(expr.minutes).toEqual([30]);
    expect(expr.hours).toEqual([9]);
    expect(expr.daysOfMonth).toEqual([15]);
    expect(expr.months).toEqual([6]);
    expect(expr.daysOfWeek).toEqual([3]);
  });

  it("parses step expressions */15", () => {
    const expr = parseCronExpression("*/15 * * * *");
    expect(expr.minutes).toEqual([0, 15, 30, 45]);
  });

  it("parses range expressions 1-5", () => {
    const expr = parseCronExpression("* * * * 1-5");
    expect(expr.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it("parses list expressions 1,3,5", () => {
    const expr = parseCronExpression("0 9,12,18 * * *");
    expect(expr.hours).toEqual([9, 12, 18]);
  });

  it("parses range with step 0-30/10", () => {
    const expr = parseCronExpression("0-30/10 * * * *");
    expect(expr.minutes).toEqual([0, 10, 20, 30]);
  });

  it("parses combined: 0 9 * * 1-5 (9am weekdays)", () => {
    const expr = parseCronExpression("0 9 * * 1-5");
    expect(expr.minutes).toEqual([0]);
    expect(expr.hours).toEqual([9]);
    expect(expr.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it("throws for wrong number of fields", () => {
    expect(() => parseCronExpression("* * *")).toThrow("Expected 5 fields");
  });

  it("throws for invalid value", () => {
    expect(() => parseCronExpression("abc * * * *")).toThrow();
  });

  it("throws for out-of-range value", () => {
    expect(() => parseCronExpression("60 * * * *")).toThrow("out of bounds");
  });

  it("throws for invalid range", () => {
    expect(() => parseCronExpression("* * * * 5-2")).toThrow("Invalid range");
  });

  it("throws for step of 0", () => {
    expect(() => parseCronExpression("*/0 * * * *")).toThrow("Invalid step");
  });
});

describe("validateCronExpression", () => {
  it("returns null for valid expression", () => {
    expect(validateCronExpression("0 2 * * *")).toBeNull();
  });

  it("returns error message for invalid expression", () => {
    const result = validateCronExpression("bad");
    expect(result).toContain("Expected 5 fields");
  });
});

describe("nextFireTime", () => {
  it("calculates next fire for every-minute cron", () => {
    const expr = parseCronExpression("* * * * *");
    const after = new Date(2024, 0, 15, 10, 30, 0); // local time
    const next = nextFireTime(expr, after);
    expect(next.getMinutes()).toBe(31);
    expect(next.getHours()).toBe(10);
  });

  it("calculates next fire for specific time", () => {
    const expr = parseCronExpression("0 9 * * *");
    const after = new Date(2024, 0, 15, 10, 0, 0); // local time
    const next = nextFireTime(expr, after);
    // Should be next day at 9am
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  it("skips to correct day of week", () => {
    const expr = parseCronExpression("0 9 * * 1"); // Monday
    const after = new Date(2024, 0, 16, 10, 0, 0); // Tuesday local time
    const next = nextFireTime(expr, after);
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getHours()).toBe(9);
  });

  it("handles month boundaries", () => {
    const expr = parseCronExpression("0 0 1 * *"); // First of every month
    const after = new Date(2024, 0, 15, 0, 0, 0); // local time
    const next = nextFireTime(expr, after);
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(1);
  });
});
