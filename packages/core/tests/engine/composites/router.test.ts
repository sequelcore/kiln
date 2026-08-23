import { describe, it, expect } from "vitest";
import type { Router } from "../../../src/engine/composites/router.js";
import { validateRouter } from "../../../src/engine/composites/router.js";

function makeRouter(overrides: Partial<Router> = {}): Router {
  return {
    fallback: "general",
    ...overrides,
  };
}

describe("Router composite", () => {
  describe("interface conformance", () => {
    it("accepts a valid Router", () => {
      const router = makeRouter();
      expect(router.fallback).toBe("general");
    });
  });

  describe("validateRouter", () => {
    it("returns empty array for valid config", () => {
      expect(validateRouter(makeRouter())).toEqual([]);
    });

    it("reports empty fallback", () => {
      const errors = validateRouter(makeRouter({ fallback: "" }));
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("fallback");
    });

  });
});
