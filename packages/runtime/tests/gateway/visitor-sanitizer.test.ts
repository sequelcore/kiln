import { describe, it, expect } from "vitest";
import { sanitizeVisitorInfo, formatVisitorContext } from "../../src/gateway/visitor-sanitizer.js";

describe("sanitizeVisitorInfo", () => {
  it("extracts valid name, email, phone", () => {
    const result = sanitizeVisitorInfo({ name: "Alice", email: "alice@example.com", phone: "+1 555-1234" });
    expect(result.displayName).toBe("Alice");
    expect(result.email).toBe("alice@example.com");
    expect(result.phone).toBe("+1 555-1234");
  });

  it("strips zero-width characters from name", () => {
    const result = sanitizeVisitorInfo({ name: "Al\u200Bice" });
    expect(result.displayName).toBe("Alice");
  });

  it("truncates name to 100 chars", () => {
    const result = sanitizeVisitorInfo({ name: "A".repeat(200) });
    expect(result.displayName).toHaveLength(100);
  });

  it("rejects invalid email format", () => {
    const result = sanitizeVisitorInfo({ email: "not-an-email" });
    expect(result.email).toBeUndefined();
  });

  it("rejects invalid phone format", () => {
    const result = sanitizeVisitorInfo({ phone: "abc" });
    expect(result.phone).toBeUndefined();
  });

  it("accepts valid phone formats", () => {
    expect(sanitizeVisitorInfo({ phone: "+52 (664) 123-4567" }).phone).toBe("+52 (664) 123-4567");
    expect(sanitizeVisitorInfo({ phone: "5551234567" }).phone).toBe("5551234567");
  });

  it("ignores non-string values", () => {
    const result = sanitizeVisitorInfo({ name: 42, email: true, phone: null });
    expect(result.displayName).toBeUndefined();
    expect(result.email).toBeUndefined();
    expect(result.phone).toBeUndefined();
  });

  it("ignores empty strings", () => {
    const result = sanitizeVisitorInfo({ name: "  ", email: "", phone: "   " });
    expect(result.displayName).toBeUndefined();
    expect(result.email).toBeUndefined();
    expect(result.phone).toBeUndefined();
  });

  it("sanitizes custom fields", () => {
    const result = sanitizeVisitorInfo({
      custom: { company: "Acme Corp", role: "Engineer" },
    });
    expect(result.custom).toEqual({ company: "Acme Corp", role: "Engineer" });
  });

  it("limits custom fields to 10", () => {
    const custom: Record<string, string> = {};
    for (let i = 0; i < 15; i++) custom[`field${i}`] = `value${i}`;
    const result = sanitizeVisitorInfo({ custom });
    expect(Object.keys(result.custom!)).toHaveLength(10);
  });

  it("ignores non-object custom fields", () => {
    const result = sanitizeVisitorInfo({ custom: "not-an-object" });
    expect(result.custom).toBeUndefined();
  });

  it("ignores array custom fields", () => {
    const result = sanitizeVisitorInfo({ custom: [1, 2, 3] });
    expect(result.custom).toBeUndefined();
  });

  it("returns empty object for empty input", () => {
    const result = sanitizeVisitorInfo({});
    expect(result).toEqual({});
  });
});

describe("formatVisitorContext", () => {
  it("formats name, email, phone", () => {
    const ctx = formatVisitorContext({ displayName: "Alice", email: "alice@test.com", phone: "+1234" });
    expect(ctx).toContain("Name: Alice");
    expect(ctx).toContain("Email: alice@test.com");
    expect(ctx).toContain("Phone: +1234");
  });

  it("includes custom fields", () => {
    const ctx = formatVisitorContext({ custom: { company: "Acme" } });
    expect(ctx).toContain("company: Acme");
  });

  it("returns undefined for empty visitor", () => {
    expect(formatVisitorContext({})).toBeUndefined();
  });
});
