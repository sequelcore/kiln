import { describe, it, expect } from "vitest";
import { PiiScanner } from "../../src/safety/pii-scanner.js";
import type { PiiConfig } from "../../src/engine/domain/safety-config.js";

function makeConfig(overrides: Partial<PiiConfig> = {}): PiiConfig {
  return {
    detect: ["email", "phone", "ssn", "credit_card", "ip_address", "date_of_birth"],
    action: "detect",
    ...overrides,
  };
}

describe("PiiScanner", () => {
  describe("scanHeuristic", () => {
    it("detects email", () => {
      const scanner = new PiiScanner(makeConfig());
      const result = scanner.scanHeuristic("Contact me at user@example.com for details.");
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.type).toBe("email");
      expect(result.matches[0]!.value).toBe("user@example.com");
    });

    it("detects phone number", () => {
      const scanner = new PiiScanner(makeConfig());
      const result = scanner.scanHeuristic("Call me at 555-123-4567 anytime.");
      expect(result.matches.some((m) => m.type === "phone")).toBe(true);
    });

    it("detects SSN", () => {
      const scanner = new PiiScanner(makeConfig());
      const result = scanner.scanHeuristic("SSN: 123-45-6789");
      expect(result.matches.some((m) => m.type === "ssn")).toBe(true);
    });

    it("detects credit card with valid Luhn checksum", () => {
      const scanner = new PiiScanner(makeConfig());
      const result = scanner.scanHeuristic("Card: 4111 1111 1111 1111");
      expect(result.matches.some((m) => m.type === "credit_card")).toBe(true);
    });

    it("detects Mastercard test number (Luhn valid)", () => {
      const scanner = new PiiScanner(makeConfig());
      const result = scanner.scanHeuristic("Card: 5500 0000 0000 0004");
      expect(result.matches.some((m) => m.type === "credit_card")).toBe(true);
    });

    it("ignores 16-digit sequence that fails Luhn check", () => {
      const scanner = new PiiScanner(makeConfig());
      const result = scanner.scanHeuristic("Card: 1234 5678 9012 3456");
      expect(result.matches.some((m) => m.type === "credit_card")).toBe(false);
    });

    it("ignores another Luhn-invalid 16-digit sequence", () => {
      const scanner = new PiiScanner(makeConfig());
      const result = scanner.scanHeuristic("Num: 0000-0000-0000-0001");
      expect(result.matches.some((m) => m.type === "credit_card")).toBe(false);
    });

    it("detects IP address", () => {
      const scanner = new PiiScanner(makeConfig());
      const result = scanner.scanHeuristic("Server at 192.168.1.100");
      expect(result.matches.some((m) => m.type === "ip_address")).toBe(true);
    });

    it("detects date of birth", () => {
      const scanner = new PiiScanner(makeConfig());
      const result = scanner.scanHeuristic("Born on 03/15/1990");
      expect(result.matches.some((m) => m.type === "date_of_birth")).toBe(true);
    });

    it("only detects configured types", () => {
      const scanner = new PiiScanner(makeConfig({ detect: ["email"] }));
      const result = scanner.scanHeuristic("Email: user@example.com, phone: 555-123-4567");
      expect(result.matches.every((m) => m.type === "email")).toBe(true);
      expect(result.matches.some((m) => m.type === "phone")).toBe(false);
    });

    it("allowlist filtering skips matching values", () => {
      const scanner = new PiiScanner(makeConfig({ detect: ["email"], allowlist: ["noreply@example.com"] }));
      const result = scanner.scanHeuristic("Send to noreply@example.com or user@example.com");
      expect(result.matches.every((m) => m.value !== "noreply@example.com")).toBe(true);
      expect(result.matches.some((m) => m.value === "user@example.com")).toBe(true);
    });

    it("returns tier 'heuristic'", () => {
      const scanner = new PiiScanner(makeConfig());
      const result = scanner.scanHeuristic("nothing special");
      expect(result.tier).toBe("heuristic");
    });

    it("multiple matches in same text", () => {
      const scanner = new PiiScanner(makeConfig({ detect: ["email"] }));
      const result = scanner.scanHeuristic("a@b.com and c@d.com");
      expect(result.matches).toHaveLength(2);
    });
  });

  describe("redact", () => {
    it("replaces matches with [REDACTED]", () => {
      const scanner = new PiiScanner(makeConfig({ detect: ["email"] }));
      const result = scanner.scanHeuristic("user@example.com");
      const redacted = scanner.redact("user@example.com", result.matches);
      expect(redacted).toBe("[REDACTED]");
    });

    it("preserves text around matches", () => {
      const scanner = new PiiScanner(makeConfig({ detect: ["email"] }));
      const input = "Contact user@example.com now";
      const result = scanner.scanHeuristic(input);
      const redacted = scanner.redact(input, result.matches);
      expect(redacted).toBe("Contact [REDACTED] now");
    });
  });

  it("scan remains deterministic", async () => {
    const scanner = new PiiScanner(makeConfig({ detect: ["email"] }));
    const result = await scanner.scan("user@example.com");
    expect(result.tier).toBe("heuristic");
    expect(result.matches).toHaveLength(1);
  });
});
