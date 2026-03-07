import { describe, it, expect } from "vitest";
import { validateMetaSignature } from "../../src/gateway/meta-webhook-foundation.js";
import { signHmacSha256 } from "../../src/utils/hmac.js";

describe("meta-webhook-foundation", () => {
  describe("validateMetaSignature", () => {
    const secret = "test-app-secret";
    const body = '{"object":"instagram","entry":[]}';

    it("validates correct signature with sha256= prefix", () => {
      const sig = signHmacSha256(secret, body);
      expect(validateMetaSignature(body, `sha256=${sig}`, secret)).toBe(true);
    });

    it("validates correct signature without prefix", () => {
      const sig = signHmacSha256(secret, body);
      expect(validateMetaSignature(body, sig, secret)).toBe(true);
    });

    it("rejects tampered body", () => {
      const sig = signHmacSha256(secret, body);
      expect(validateMetaSignature(body + "x", `sha256=${sig}`, secret)).toBe(false);
    });

    it("rejects wrong secret", () => {
      const sig = signHmacSha256("wrong-secret", body);
      expect(validateMetaSignature(body, `sha256=${sig}`, secret)).toBe(false);
    });

    it("rejects garbage signature", () => {
      expect(validateMetaSignature(body, "sha256=badhex", secret)).toBe(false);
    });
  });
});
