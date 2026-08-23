import { describe, it, expect } from "vitest";
import { validateSafetyConfig } from "../../../src/engine/domain/safety-config.js";
import type { SafetyConfig } from "../../../src/engine/domain/safety-config.js";

describe("validateSafetyConfig", () => {
  it("valid config with all sections returns no errors", () => {
    const config: SafetyConfig = {
      pii: {
        detect: ["email", "phone"],
        action: "redact",
        allowlist: ["noreply@example.com"],
      },
      content: {
        enabled: true,
        categories: {
          hate: { threshold: 0.8, action: "block" },
          violence: { threshold: 0.5, action: "warn" },
        },
      },
      rails: [
        { type: "topic", block: ["gambling"] },
        { type: "competitor", competitors: ["CompetitorX"], response: "We don't discuss competitors." },
        { type: "escalation", triggers: ["speak to a human"] },
        { type: "compliance", required: ["disclaimer"], forbid: ["guaranteed returns"] },
      ],
    };

    expect(validateSafetyConfig(config)).toHaveLength(0);
  });

  it("valid minimal config (empty object) returns no errors", () => {
    expect(validateSafetyConfig({})).toHaveLength(0);
  });

  describe("pii validation", () => {
    it("pii with empty detect array produces error", () => {
      const config: SafetyConfig = {
        pii: { detect: [], action: "redact" },
      };
      const errors = validateSafetyConfig(config);
      expect(errors.some((e) => e.field === "pii.detect")).toBe(true);
    });

    it("pii with invalid PiiType produces error", () => {
      const config = {
        pii: { detect: ["email", "passport_number"], action: "redact" },
      } as unknown as SafetyConfig;
      const errors = validateSafetyConfig(config);
      expect(errors.some((e) => e.field === "pii.detect[1]")).toBe(true);
    });

    it("pii with invalid action produces error", () => {
      const config = {
        pii: { detect: ["email"], action: "ignore" },
      } as unknown as SafetyConfig;
      const errors = validateSafetyConfig(config);
      expect(errors.some((e) => e.field === "pii.action")).toBe(true);
    });
  });

  describe("content validation", () => {
    it("content category with threshold > 1 produces error", () => {
      const config: SafetyConfig = {
        content: {
          enabled: true,
          categories: { hate: { threshold: 1.5, action: "block" } },
        },
      };
      const errors = validateSafetyConfig(config);
      expect(errors.some((e) => e.field === "content.categories.hate.threshold")).toBe(true);
    });

    it("content category with threshold < 0 produces error", () => {
      const config: SafetyConfig = {
        content: {
          enabled: true,
          categories: { violence: { threshold: -0.1, action: "block" } },
        },
      };
      const errors = validateSafetyConfig(config);
      expect(errors.some((e) => e.field === "content.categories.violence.threshold")).toBe(true);
    });

    it("content category with invalid action produces error", () => {
      const config = {
        content: {
          enabled: true,
          categories: { hate: { threshold: 0.5, action: "delete" } },
        },
      } as unknown as SafetyConfig;
      const errors = validateSafetyConfig(config);
      expect(errors.some((e) => e.field === "content.categories.hate.action")).toBe(true);
    });
  });

  describe("rails validation", () => {
    it("topic rail with neither block nor escalate produces error", () => {
      const config: SafetyConfig = {
        rails: [{ type: "topic" }],
      };
      const errors = validateSafetyConfig(config);
      expect(errors.some((e) => e.field === "rails[0]")).toBe(true);
    });

    it("competitor rail missing competitors produces error", () => {
      const config = {
        rails: [{ type: "competitor", competitors: [], response: "We don't discuss competitors." }],
      } as unknown as SafetyConfig;
      const errors = validateSafetyConfig(config);
      expect(errors.some((e) => e.field === "rails[0].competitors")).toBe(true);
    });

    it("competitor rail missing response produces error", () => {
      const config = {
        rails: [{ type: "competitor", competitors: ["CompetitorX"], response: "" }],
      } as unknown as SafetyConfig;
      const errors = validateSafetyConfig(config);
      expect(errors.some((e) => e.field === "rails[0].response")).toBe(true);
    });

    it("escalation rail missing triggers produces error", () => {
      const config = {
        rails: [{ type: "escalation", triggers: [] }],
      } as unknown as SafetyConfig;
      const errors = validateSafetyConfig(config);
      expect(errors.some((e) => e.field === "rails[0].triggers")).toBe(true);
    });

    it("compliance rail with neither required nor forbid produces error", () => {
      const config: SafetyConfig = {
        rails: [{ type: "compliance" }],
      };
      const errors = validateSafetyConfig(config);
      expect(errors.some((e) => e.field === "rails[0]")).toBe(true);
    });

    it("unknown rail type produces error", () => {
      const config = {
        rails: [{ type: "custom_rail" }],
      } as unknown as SafetyConfig;
      const errors = validateSafetyConfig(config);
      expect(errors.some((e) => e.field === "rails[0].type")).toBe(true);
    });

    it("multiple validation errors collected together", () => {
      const config = {
        pii: { detect: [], action: "ignore" },
        content: {
          enabled: true,
          categories: { hate: { threshold: 2.0, action: "delete" } },
        },
        rails: [
          { type: "topic" },
          { type: "competitor", competitors: [], response: "" },
        ],
      } as unknown as SafetyConfig;
      const errors = validateSafetyConfig(config);
      expect(errors.length).toBeGreaterThanOrEqual(4);
    });
  });
});
