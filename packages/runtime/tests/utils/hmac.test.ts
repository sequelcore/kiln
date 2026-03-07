import { describe, expect, it } from "vitest";
import { signHmacSha256, verifyHmacSha256 } from "../../src/utils/hmac.js";

describe("signHmacSha256", () => {
  it("returns a hex string", () => {
    const sig = signHmacSha256("secret", "payload");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("roundtrips with verifyHmacSha256", () => {
    const secret = "my-webhook-secret";
    const payload = '{"event":"task.completed"}';
    const sig = signHmacSha256(secret, payload);
    expect(verifyHmacSha256(secret, payload, sig)).toBe(true);
  });

  it("produces different signatures for different payloads", () => {
    const secret = "same-secret";
    const sig1 = signHmacSha256(secret, "payload-a");
    const sig2 = signHmacSha256(secret, "payload-b");
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different secrets", () => {
    const payload = "same-payload";
    const sig1 = signHmacSha256("secret-1", payload);
    const sig2 = signHmacSha256("secret-2", payload);
    expect(sig1).not.toBe(sig2);
  });
});
