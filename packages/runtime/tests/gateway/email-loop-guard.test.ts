import { describe, it, expect } from "vitest";
import { isAutoReply, isIgnoredSender, shouldRejectEmail } from "../../src/gateway/email-loop-guard.js";

describe("isAutoReply", () => {
  it("detects Auto-Submitted header with auto-replied", () => {
    expect(isAutoReply({ "Auto-Submitted": "auto-replied" })).toBe(true);
  });

  it("detects Auto-Submitted header with auto-generated", () => {
    expect(isAutoReply({ "auto-submitted": "auto-generated" })).toBe(true);
  });

  it("allows Auto-Submitted: no", () => {
    expect(isAutoReply({ "Auto-Submitted": "no" })).toBe(false);
  });

  it("detects Precedence: bulk", () => {
    expect(isAutoReply({ Precedence: "bulk" })).toBe(true);
  });

  it("detects Precedence: junk", () => {
    expect(isAutoReply({ Precedence: "junk" })).toBe(true);
  });

  it("detects Precedence: list", () => {
    expect(isAutoReply({ precedence: "list" })).toBe(true);
  });

  it("detects X-Auto-Response-Suppress header", () => {
    expect(isAutoReply({ "X-Auto-Response-Suppress": "OOF, AutoReply" })).toBe(true);
  });

  it("detects empty Return-Path (bounce)", () => {
    expect(isAutoReply({ "Return-Path": "<>" })).toBe(true);
  });

  it("returns false for normal email headers", () => {
    expect(isAutoReply({ From: "user@example.com", Subject: "Hello" })).toBe(false);
  });

  it("returns false for empty headers", () => {
    expect(isAutoReply({})).toBe(false);
  });
});

describe("isIgnoredSender", () => {
  it("catches noreply@ addresses", () => {
    expect(isIgnoredSender("noreply@example.com")).toBe(true);
  });

  it("catches no-reply@ addresses", () => {
    expect(isIgnoredSender("no-reply@company.com")).toBe(true);
  });

  it("catches mailer-daemon@ addresses", () => {
    expect(isIgnoredSender("MAILER-DAEMON@mail.example.com")).toBe(true);
  });

  it("catches postmaster@ addresses", () => {
    expect(isIgnoredSender("postmaster@example.com")).toBe(true);
  });

  it("catches bounce@ addresses", () => {
    expect(isIgnoredSender("bounce@example.com")).toBe(true);
  });

  it("catches auto@ addresses", () => {
    expect(isIgnoredSender("auto@example.com")).toBe(true);
  });

  it("allows normal email addresses", () => {
    expect(isIgnoredSender("john@example.com")).toBe(false);
  });

  it("allows addresses containing noreply in domain", () => {
    expect(isIgnoredSender("user@noreply.example.com")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isIgnoredSender("")).toBe(true);
  });
});

describe("shouldRejectEmail", () => {
  it("rejects ignored senders first", () => {
    const result = shouldRejectEmail("noreply@example.com", {});
    expect(result.reject).toBe(true);
    expect(result.reason).toContain("ignored sender");
  });

  it("rejects auto-replies via headers", () => {
    const result = shouldRejectEmail("user@example.com", { "Auto-Submitted": "auto-replied" });
    expect(result.reject).toBe(true);
    expect(result.reason).toContain("auto-reply");
  });

  it("allows normal emails", () => {
    const result = shouldRejectEmail("user@example.com", { From: "user@example.com" });
    expect(result.reject).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});
