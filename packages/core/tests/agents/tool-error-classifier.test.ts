import { describe, it, expect } from "vitest";
import { classifyToolError } from "../../src/agents/tool-error-classifier.js";

describe("classifyToolError", () => {
  describe("validation errors", () => {
    it("classifies 400 as validation", () => {
      expect(classifyToolError(new Error("HTTP 400 Bad Request"))).toBe("validation");
    });

    it("classifies 422 as validation", () => {
      expect(classifyToolError(new Error("HTTP 422 Unprocessable Entity"))).toBe("validation");
    });

    it("classifies validation keyword as validation", () => {
      expect(classifyToolError(new Error("Validation failed: missing field 'name'"))).toBe("validation");
    });

    it("classifies invalid keyword as validation", () => {
      expect(classifyToolError(new Error("Invalid parameter: timeout must be positive"))).toBe("validation");
    });

    it("classifies schema keyword as validation", () => {
      expect(classifyToolError(new Error("Schema validation error"))).toBe("validation");
    });

    it("classifies bad request as validation", () => {
      expect(classifyToolError(new Error("Bad request: missing required field"))).toBe("validation");
    });
  });

  describe("transient errors", () => {
    it("classifies 429 as transient", () => {
      expect(classifyToolError(new Error("HTTP 429 Too Many Requests"))).toBe("transient");
    });

    it("classifies 502 as transient", () => {
      expect(classifyToolError(new Error("HTTP 502 Bad Gateway"))).toBe("transient");
    });

    it("classifies 503 as transient", () => {
      expect(classifyToolError(new Error("HTTP 503 Service Unavailable"))).toBe("transient");
    });

    it("classifies 504 as transient", () => {
      expect(classifyToolError(new Error("HTTP 504 Gateway Timeout"))).toBe("transient");
    });

    it("classifies timeout keyword as transient", () => {
      expect(classifyToolError(new Error("Request timeout after 30s"))).toBe("transient");
    });

    it("classifies rate limit as transient", () => {
      expect(classifyToolError(new Error("Rate limit exceeded"))).toBe("transient");
    });

    it("classifies ECONNRESET as transient", () => {
      expect(classifyToolError(new Error("ECONNRESET: connection reset by peer"))).toBe("transient");
    });

    it("classifies ECONNREFUSED as transient", () => {
      expect(classifyToolError(new Error("ECONNREFUSED: connection refused"))).toBe("transient");
    });
  });

  describe("fatal errors", () => {
    it("classifies unknown errors as fatal", () => {
      expect(classifyToolError(new Error("Something completely unexpected"))).toBe("fatal");
    });

    it("classifies 404 as fatal", () => {
      expect(classifyToolError(new Error("HTTP 404 Not Found"))).toBe("fatal");
    });

    it("classifies 500 as fatal", () => {
      expect(classifyToolError(new Error("HTTP 500 Internal Server Error"))).toBe("fatal");
    });

    it("classifies non-Error as fatal", () => {
      expect(classifyToolError("string error")).toBe("fatal");
      expect(classifyToolError(42)).toBe("fatal");
      expect(classifyToolError(null)).toBe("fatal");
      expect(classifyToolError(undefined)).toBe("fatal");
    });
  });
});
