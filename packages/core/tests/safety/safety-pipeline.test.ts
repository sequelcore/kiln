import { describe, it, expect, vi } from "vitest";
import { SafetyPipeline } from "../../src/safety/safety-pipeline.js";
import type { SafetyConfig } from "../../src/engine/domain/safety-config.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makePiiConfig(action: "detect" | "redact" | "block" = "detect"): SafetyConfig["pii"] {
  return { detect: ["email", "phone"], action };
}

function makeContentConfig(threshold = 0.5, action: "block" | "warn" | "log" = "block"): SafetyConfig["content"] {
  return {
    enabled: true,
    categories: { hate: { threshold, action } },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("SafetyPipeline", () => {
  it("full pipeline with PII + content + rails, all pass -> allowed: true", async () => {
    const config: SafetyConfig = {
      pii: makePiiConfig("detect"),
      content: makeContentConfig(0.9, "block"),
      rails: [{ type: "topic", block: ["forbidden"] }],
    };
    const pipeline = new SafetyPipeline(config);
    const result = await pipeline.evaluate("Hello, how are you?", "input");

    expect(result.allowed).toBe(true);
    expect(result.blockReason).toBeUndefined();
  });

  it("PII block action short-circuits: content and rails not evaluated", async () => {
    const config: SafetyConfig = {
      pii: makePiiConfig("block"),
      content: makeContentConfig(0.1, "block"), // would block if reached
      rails: [{ type: "topic", block: ["test"] }],
    };
    const pipeline = new SafetyPipeline(config);
    // email triggers PII detection
    const result = await pipeline.evaluate("Contact: user@example.com", "input");

    expect(result.allowed).toBe(false);
    expect(result.blockReason).toMatch(/PII detected/);
    expect(result.policyResults).toHaveLength(0); // rails never ran
    expect(result.content).toBeUndefined(); // content never ran
  });

  it("PII redact action: redactedText is set and pipeline continues", async () => {
    const config: SafetyConfig = {
      pii: makePiiConfig("redact"),
      content: makeContentConfig(0.9, "block"),
    };
    const pipeline = new SafetyPipeline(config);
    const result = await pipeline.evaluate("Email: user@example.com", "input");

    expect(result.allowed).toBe(true);
    expect(result.redactedText).toBeDefined();
    expect(result.redactedText).toContain("[REDACTED]");
    expect(result.pii).toBeDefined();
    expect(result.pii!.matches.length).toBeGreaterThan(0);
  });

  it("PII detect action: records matches, pipeline continues, no redaction", async () => {
    const config: SafetyConfig = {
      pii: makePiiConfig("detect"),
      content: makeContentConfig(0.9, "block"),
    };
    const pipeline = new SafetyPipeline(config);
    const result = await pipeline.evaluate("Email: user@example.com", "input");

    expect(result.allowed).toBe(true);
    expect(result.pii).toBeDefined();
    expect(result.pii!.matches.length).toBeGreaterThan(0);
    expect(result.redactedText).toBeUndefined(); // no redaction
  });

  it("content policy block: blocked when category exceeds threshold", async () => {
    const config: SafetyConfig = {
      content: { enabled: true, categories: { hate: { threshold: 0.1, action: "block" } } },
    };
    const pipeline = new SafetyPipeline(config);
    // "hate speech" triggers hate category pattern
    const result = await pipeline.evaluate("This is hate speech and racist content", "input");

    expect(result.allowed).toBe(false);
    expect(result.blockReason).toMatch(/Content policy violated/);
  });

  it("content policy with no violations: allowed", async () => {
    const config: SafetyConfig = {
      content: makeContentConfig(0.9, "block"),
    };
    const pipeline = new SafetyPipeline(config);
    const result = await pipeline.evaluate("Hello, I need some help with my account.", "input");

    expect(result.allowed).toBe(true);
    expect(result.blockReason).toBeUndefined();
  });

  it("rails block: first blocked rail short-circuits remaining rails", async () => {
    const config: SafetyConfig = {
      rails: [
        { type: "topic", block: ["forbidden"] },
        { type: "topic", block: ["another"] },
      ],
    };
    const pipeline = new SafetyPipeline(config);
    const result = await pipeline.evaluate("This is forbidden content", "input");

    expect(result.allowed).toBe(false);
    expect(result.blockReason).toMatch(/Blocked topic/);
    // Only first rail result because short-circuit
    expect(result.policyResults).toHaveLength(1);
    expect(result.policyResults[0]!.allowed).toBe(false);
  });

  it("escalation rail: allowed with escalate flag set", async () => {
    const config: SafetyConfig = {
      rails: [{ type: "escalation", triggers: ["urgent", "emergency"] }],
    };
    const pipeline = new SafetyPipeline(config);
    const result = await pipeline.evaluate("This is an urgent matter!", "input");

    expect(result.allowed).toBe(true);
    expect(result.policyResults).toHaveLength(1);
    expect(result.policyResults[0]!.escalate).toBe(true);
  });

  it("empty config (no pii, no content, no rails): always allowed", async () => {
    const config: SafetyConfig = {};
    const pipeline = new SafetyPipeline(config);
    const result = await pipeline.evaluate("Some text with email@example.com", "input");

    expect(result.allowed).toBe(true);
    expect(result.pii).toBeUndefined();
    expect(result.content).toBeUndefined();
    expect(result.policyResults).toHaveLength(0);
  });

  it("only PII configured: works without content/rails", async () => {
    const config: SafetyConfig = {
      pii: makePiiConfig("block"),
    };
    const pipeline = new SafetyPipeline(config);
    const resultClean = await pipeline.evaluate("Hello there", "input");
    expect(resultClean.allowed).toBe(true);

    const resultPii = await pipeline.evaluate("Call me at 555-123-4567", "input");
    expect(resultPii.allowed).toBe(false);
  });

  it("only rails configured: works without pii/content", async () => {
    const config: SafetyConfig = {
      rails: [{ type: "competitor", competitors: ["acme"], response: "We cannot discuss competitors." }],
    };
    const pipeline = new SafetyPipeline(config);
    const result = await pipeline.evaluate("How does Acme compare?", "input");

    expect(result.allowed).toBe(false);
    expect(result.pii).toBeUndefined();
    expect(result.content).toBeUndefined();
  });

  it("multiple PII matches: all types reported in blockReason", async () => {
    const config: SafetyConfig = {
      pii: { detect: ["email", "phone"], action: "block" },
    };
    const pipeline = new SafetyPipeline(config);
    const result = await pipeline.evaluate(
      "Email: user@example.com, Phone: 555-123-4567",
      "input",
    );

    expect(result.allowed).toBe(false);
    expect(result.blockReason).toContain("email");
    expect(result.blockReason).toContain("phone");
  });

  it("redacted text carries forward to content classification", async () => {
    const config: SafetyConfig = {
      pii: makePiiConfig("redact"),
      content: { enabled: true, categories: { hate: { threshold: 0.1, action: "block" } } },
    };
    const pipeline = new SafetyPipeline(config);
    // Only email present -- no hate content -- should pass content check on redacted text
    const result = await pipeline.evaluate("Contact: user@example.com", "input");

    expect(result.allowed).toBe(true);
    expect(result.redactedText).toBeDefined();
    expect(result.content).toBeDefined(); // content classifier ran on redacted text
  });
});
